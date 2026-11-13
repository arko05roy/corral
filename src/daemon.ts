// corrald: owns every agent's PTY so agents outlive the Corral window.
// Clients (the Electron app) talk to it over a Unix socket, one JSON message per line.
import * as fs from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as pty from "node-pty";
import { createPen } from "./pens.ts";
import { codeVersion } from "./version.ts";

const VERSION = codeVersion(); // hashed once at boot: the code this process actually loaded

const HOME = join(homedir(), ".corral");
const SOCK = join(HOME, "corrald.sock");
const STATUS_DIR = join(HOME, "status");
// ids restart at 1 each daemon boot → old status files would light the wrong lamps
fs.rmSync(STATUS_DIR, { recursive: true, force: true });
fs.mkdirSync(STATUS_DIR, { recursive: true });

const agentCmd = process.env.CORRAL_AGENT ?? "claude";

// ── hooks (moved here from main.ts: whoever owns the agents owns their status) ──
// write temp → rename: rename() is atomic, so we never read a half-written file
const HOOK_CMD = 'f="$HOME/.corral/status/$CORRAL_THREAD.json"; cat > "$f.$$.tmp" && mv -f "$f.$$.tmp" "$f"';
const hook = [{ hooks: [{ type: "command", command: HOOK_CMD }] }];
const HOOK_SETTINGS = JSON.stringify({
	hooks: { UserPromptSubmit: hook, PreToolUse: hook, Notification: hook, Stop: hook },
});
const STATE_OF: Record<string, "working" | "waiting"> = {
	UserPromptSubmit: "working",
	PreToolUse: "working",
	Notification: "waiting",
	Stop: "waiting",
};
// launched from inside a Claude session? don't pass its child-session marker on (kills transcripts → --continue)
const agentEnv = () => {
	const { CLAUDE_CODE_CHILD_SESSION: _, ...env } = process.env;
	return env;
};

type Agent = {
	id: number;
	kind: "agent" | "shell"; // agent = corral launched claude in a pen; shell = plain $SHELL, you run what you want
	cwd: string; // where it started. (shells key on "shell:<id>", not the folder: two shells in ~ must stay two)
	term: pty.IPty;
	repo: string;
	task: string;
	branch: string;
	pen: string;
	state: "working" | "waiting";
	history: string; // replay buffer: last ~2MB of output, sent to clients that attach late
};
const HISTORY_MAX = 2 * 1024 * 1024;
const agents = new Map<number, Agent>();
const clients = new Set<net.Socket>();
let n = 0;

const send = (c: net.Socket, msg: object) => c.write(JSON.stringify(msg) + "\n");
const broadcast = (msg: object) => clients.forEach((c) => send(c, msg));
const info = (a: Agent) => ({ id: a.id, kind: a.kind, cwd: a.cwd, repo: a.repo, task: a.task, branch: a.branch, pen: a.pen, state: a.state, alive: true });

type Size = { cols: number; rows: number };
const ptyOpts = (cwd: string, id: number, size?: Size) => ({
	name: "xterm-256color", // node-pty's default "xterm-color" advertises 8 colors: CLIs looked washed out
	// born at the UI's real size when it knows it: a guessed size = the first frames land on the wrong grid
	cols: size?.cols || 100,
	rows: size?.rows || 30,
	cwd,
	// hooks (and anything else) launched inside inherit this and know which session they belong to
	env: { ...agentEnv(), CORRAL_THREAD: String(id), TERM_PROGRAM: "corral" } as Record<string, string>,
});

// everything that isn't claude-specific: replay buffer, broadcast, exit. shared by agents and shells
function track(term: pty.IPty, meta: Omit<Agent, "term" | "history">) {
	const a: Agent = { ...meta, term, history: "" };
	term.onData((text) => {
		a.history += text;
		if (a.history.length > HISTORY_MAX) {
			// drop the oldest, then skip to the next newline so we never start mid escape-code / mid emoji
			const cut = a.history.length - HISTORY_MAX;
			const nl = a.history.indexOf("\n", cut);
			a.history = a.history.slice(nl >= 0 ? nl + 1 : cut);
		}
		broadcast({ type: "out", id: a.id, text });
	});
	term.onExit(({ exitCode }) => {
		broadcast({ type: "out", id: a.id, text: `\r\n[process exited: ${exitCode}]\r\n` });
		broadcast({ type: "exited", id: a.id });
		agents.delete(a.id);
	});
	agents.set(a.id, a);
	return a;
}

function spawnAgent(meta: Pick<Agent, "repo" | "task" | "branch" | "pen">, args: string[], state: Agent["state"], size?: Size) {
	const id = ++n;
	const isClaude = basename(agentCmd) === "claude";
	const term = pty.spawn(agentCmd, isClaude ? ["--settings", HOOK_SETTINGS, ...args] : args, ptyOpts(meta.pen, id, size));
	return track(term, { id, kind: "agent", cwd: meta.pen, state, ...meta });
}

// ── zsh SHELL INTEGRATION, injected (never edits your dotfiles) ──
// zsh reads .zshenv → .zprofile → .zshrc → .zlogin from $ZDOTDIR. we point ZDOTDIR at our folder; each of our
// files loads YOUR real file of the same name, then steps aside. .zshrc adds the hook: before every prompt,
// print OSC 7 (ESC ] 7 ; file://host/path BEL) = "I'm in <path> now", invisible, read by xterm.
// .zlogin (last file) puts your ZDOTDIR back, so a `zsh` you start inside behaves normally.
const ZDOT = join(HOME, "zsh");
const chain = (f: string, tail = "") =>
	`# corral shell integration: load your real ${f}, then ours\n` +
	`__corral_zdot="$ZDOTDIR"; ZDOTDIR="\${CORRAL_USER_ZDOTDIR:-$HOME}"\n` +
	`[ -f "$ZDOTDIR/${f}" ] && source "$ZDOTDIR/${f}"\n` +
	`ZDOTDIR="$__corral_zdot"\n${tail}`;
fs.mkdirSync(ZDOT, { recursive: true });
fs.writeFileSync(join(ZDOT, ".zshenv"), chain(".zshenv"));
fs.writeFileSync(join(ZDOT, ".zprofile"), chain(".zprofile"));
fs.writeFileSync(
	join(ZDOT, ".zshrc"),
	chain(
		".zshrc",
		`__corral_osc7() { printf '\\e]7;file://%s%s\\a' "$HOST" "\${PWD// /%20}" }\n` +
			`autoload -Uz add-zsh-hook && add-zsh-hook precmd __corral_osc7\n`,
	),
);
fs.writeFileSync(
	join(ZDOT, ".zlogin"),
	chain(".zlogin", `if [ -n "$CORRAL_USER_ZDOTDIR" ]; then export ZDOTDIR="$CORRAL_USER_ZDOTDIR"; else unset ZDOTDIR; fi\n`),
);

// a plain login shell (-l: loads .zprofile, so homebrew's PATH and friends exist, like Ghostty/Terminal.app)
function spawnShell(cwd: string, size?: Size) {
	const id = ++n;
	const dir = cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory() ? cwd : homedir();
	const sh = process.env.SHELL || "/bin/zsh";
	const opts = ptyOpts(dir, id, size);
	if (basename(sh) === "zsh") {
		// remember YOUR ZDOTDIR (if you set one) so our files can find your real dotfiles, then point zsh at ours
		if (process.env.ZDOTDIR) opts.env.CORRAL_USER_ZDOTDIR = process.env.ZDOTDIR;
		opts.env.ZDOTDIR = ZDOT;
	}
	const term = pty.spawn(sh, ["-l"], opts);
	const label = dir === homedir() ? "~" : basename(dir);
	return track(term, { id, kind: "shell", cwd: dir, state: "waiting", repo: "", task: label, branch: "", pen: `shell:${id}` });
}

// one handler per message type. `reply` answers a request (matched by reqId on the client side).
function handle(c: net.Socket, msg: any) {
	const reply = (data: object) => send(c, { type: "reply", reqId: msg.reqId, ...data });
	switch (msg.type) {
		case "hello":
			// handshake: the app compares our version with the source on disk to spot a stale daemon
			return reply({ version: VERSION, pid: process.pid, agents: agents.size });
		case "list":
			// replay FIRST, then the reply. one ordered socket + same sync tick = no live byte can cut in between
			for (const a of agents.values()) if (a.history) send(c, { type: "out", id: a.id, text: a.history });
			return reply({ threads: [...agents.values()].map(info) });
		case "spawn":
			try {
				const { pen, branch } = createPen(msg.repo, msg.task, n + 1);
				const a = spawnAgent({ repo: msg.repo, task: msg.task, branch, pen }, [msg.task], "working", msg.size);
				return reply({ thread: info(a) });
			} catch (err) {
				return reply({ error: String((err as Error).message) });
			}
		case "shell": {
			const a = spawnShell(msg.cwd ?? homedir(), msg.size);
			return reply({ thread: info(a) });
		}
		case "resume": {
			const a = spawnAgent(msg.meta, agentCmd === "claude" ? ["--continue"] : [], "waiting", msg.size);
			return reply({ id: a.id });
		}
		case "kill": {
			// SIGHUP = "your terminal hung up": what claude would get if a real terminal closed.
			// pen stays on disk, so the thread can be resumed. Ignored for 3s → SIGKILL (can't be caught).
			const a = agents.get(msg.id);
			if (!a) return reply({ error: "no such agent" });
			a.term.kill("SIGHUP");
			setTimeout(() => {
				if (agents.get(msg.id) === a) a.term.kill("SIGKILL");
			}, 3000);
			return reply({ ok: true }); // the "exited" broadcast comes from onExit, like any other death
		}
		case "in":
			return agents.get(msg.id)?.term.write(msg.text);
		case "resize":
			if (msg.cols > 0 && msg.rows > 0) agents.get(msg.id)?.term.resize(msg.cols, msg.rows);
			return;
	}
}

// status files → broadcast (same v0 channel as before, now owned by the daemon)
fs.watch(STATUS_DIR, (_event, file) => {
	const id = Number(file?.replace(/\.json$/, ""));
	const a = agents.get(id);
	if (!a) return;
	try {
		const state = STATE_OF[JSON.parse(fs.readFileSync(join(STATUS_DIR, file!), "utf8")).hook_event_name];
		if (state && state !== a.state) {
			a.state = state;
			broadcast({ type: "status", id, state });
		}
	} catch {}
});

const server = net.createServer((c) => {
	clients.add(c);
	let buf = "";
	c.setEncoding("utf8");
	// framing: data arrives in arbitrary chunks. split on \n, keep the unfinished tail for next time.
	c.on("data", (chunk: string) => {
		buf += chunk;
		let nl: number;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			if (line) handle(c, JSON.parse(line));
		}
	});
	c.on("close", () => clients.delete(c));
	c.on("error", () => clients.delete(c));
});

// a crashed daemon leaves its socket file behind → listen() would fail with EADDRINUSE
fs.rmSync(SOCK, { force: true });
process.umask(0o077); // socket is BORN owner-only (chmod after listen would leave a tiny open window)
server.listen(SOCK, () => {
	fs.chmodSync(SOCK, 0o600); // belt and braces: only this user may connect; the kernel enforces it
	console.log(`corrald listening on ${SOCK} (agent: ${agentCmd}, version: ${VERSION})`);
});
