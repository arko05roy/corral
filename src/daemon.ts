// corrald: owns every agent's PTY so agents outlive the Corral window.
// Clients (the Electron app) talk to it over a Unix socket, one JSON message per line.
import * as fs from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as pty from "node-pty";
import { createPen } from "./pens.ts";

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
const info = (a: Agent) => ({ id: a.id, repo: a.repo, task: a.task, branch: a.branch, pen: a.pen, state: a.state, alive: true });

function spawnAgent(meta: Omit<Agent, "id" | "term" | "state">, args: string[], state: Agent["state"]) {
	const id = ++n;
	const isClaude = basename(agentCmd) === "claude";
	const term = pty.spawn(agentCmd, isClaude ? ["--settings", HOOK_SETTINGS, ...args] : args, {
		cols: 100,
		rows: 30,
		cwd: meta.pen,
		// hooks are claude's children → they inherit this and know which thread they belong to
		env: { ...agentEnv(), CORRAL_THREAD: String(id) } as Record<string, string>,
	});
	const a: Agent = { id, term, state, history: "", ...meta };
	term.onData((text) => {
		a.history += text;
		if (a.history.length > HISTORY_MAX) {
			// drop the oldest, then skip to the next newline so we never start mid escape-code / mid emoji
			const cut = a.history.length - HISTORY_MAX;
			const nl = a.history.indexOf("\n", cut);
			a.history = a.history.slice(nl >= 0 ? nl + 1 : cut);
		}
		broadcast({ type: "out", id, text });
	});
	term.onExit(({ exitCode }) => {
		broadcast({ type: "out", id, text: `\r\n[agent exited: ${exitCode}]\r\n` });
		broadcast({ type: "exited", id });
		agents.delete(id);
	});
	agents.set(id, a);
	return a;
}

// one handler per message type. `reply` answers a request (matched by reqId on the client side).
function handle(c: net.Socket, msg: any) {
	const reply = (data: object) => send(c, { type: "reply", reqId: msg.reqId, ...data });
	switch (msg.type) {
		case "list":
			// replay FIRST, then the reply. one ordered socket + same sync tick = no live byte can cut in between
			for (const a of agents.values()) if (a.history) send(c, { type: "out", id: a.id, text: a.history });
			return reply({ threads: [...agents.values()].map(info) });
		case "spawn":
			try {
				const { pen, branch } = createPen(msg.repo, msg.task, n + 1);
				const a = spawnAgent({ repo: msg.repo, task: msg.task, branch, pen }, [msg.task], "working");
				return reply({ thread: info(a) });
			} catch (err) {
				return reply({ error: String((err as Error).message) });
			}
		case "resume": {
			const a = spawnAgent(msg.meta, agentCmd === "claude" ? ["--continue"] : [], "waiting");
			return reply({ id: a.id });
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
	console.log(`corrald listening on ${SOCK} (agent: ${agentCmd})`);
});
