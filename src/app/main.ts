// Corral window = a CLIENT of corrald. It owns no agents: quit it, crash it, agents keep running.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { codeVersion } from "../version.ts";

const [repoArg, ...tasks] = process.argv.slice(2);
const SOCK = join(homedir(), ".corral", "corrald.sock");

app.whenReady().then(async () => {
	// ── connect to the daemon first; no daemon = nothing to show ──
	const connect = () =>
		new Promise<net.Socket>((ok, fail) => {
			const s = net.connect(SOCK, () => ok(s));
			s.once("error", fail);
		});
	// ── version handshake (Paradev: hello + protocolVersion, restart a mismatched daemon). ours: the version is
	// a hash of the daemon's source, and the check runs BEFORE any window exists, so no stale UI state survives.
	// own throwaway connection: live agents broadcast output to every client, and a half-read line must never
	// leak into the main connection's parser.
	const probe = () =>
		new Promise<"none" | { version?: string; pid?: number }>((ok) => {
			const s = net.connect(SOCK);
			s.once("error", () => ok("none"));
			let buf = "";
			const done = (r: { version?: string; pid?: number }) => (s.destroy(), ok(r));
			const t = setTimeout(() => done({}), 1000); // pre-handshake daemon never answers "hello"
			s.on("connect", () => s.write(JSON.stringify({ type: "hello", reqId: 0 }) + "\n"));
			s.on("data", (d) => {
				buf += d;
				for (const line of buf.split("\n"))
					if (line.includes('"reqId":0')) {
						clearTimeout(t);
						return done(JSON.parse(line));
					}
			});
		});
	// old daemons don't report a pid: ask the kernel who's listening on the socket
	const socketOwner = () => {
		try {
			return Number(execFileSync("lsof", ["-t", SOCK], { encoding: "utf8" }).split("\n")[0]) || undefined;
		} catch {
			return undefined;
		}
	};
	const found = await probe();
	if (found !== "none" && found.version !== codeVersion()) {
		// stale daemon: kill it (SIGHUPs its agents; their pens stay, threads show up resumable) and wait for
		// the socket to stop answering, so the auto-start below spawns the fresh code
		const pid = found.pid ?? socketOwner();
		console.log(`corrald outdated (running ${found.version ?? "pre-handshake"}, source ${codeVersion()}) → restarting pid ${pid}`);
		if (pid) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {}
			for (let i = 0; i < 30 && (await connect().then((s) => (s.destroy(), true)).catch(() => false)); i++)
				await new Promise((r) => setTimeout(r, 100));
		}
	}

	let sock: net.Socket;
	try {
		sock = await connect();
	} catch {
		// AUTO-START: no daemon → launch one. detached = setsid(): new session, no controlling
		// terminal, so neither closing the terminal nor quitting Corral can SIGHUP it.
		mkdirSync(join(homedir(), ".corral"), { recursive: true });
		const log = openSync(join(homedir(), ".corral", "corrald.log"), "a");
		const daemon = resolve(import.meta.dirname, "..", "daemon.ts");
		spawn(process.env.CORRAL_NODE ?? "node", [daemon], {
			detached: true,
			stdio: ["ignore", log, log],
			env: process.env,
		}).unref(); // don't keep Corral alive waiting on it
		closeSync(log);
		let s: net.Socket | undefined;
		for (let i = 0; i < 50 && !s; i++) {
			await new Promise((r) => setTimeout(r, 100));
			s = await connect().catch(() => undefined);
		}
		if (!s) {
			dialog.showErrorBox("corrald won't start", "See ~/.corral/corrald.log, or run it by hand:\n\n  npm run daemon");
			return app.quit();
		}
		sock = s;
	}

	const win = new BrowserWindow({
		width: 1300,
		height: 850,
		backgroundColor: "#121212",
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 16, y: 16 },
		webPreferences: {
			preload: resolve(import.meta.dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	const devUrl = process.env.CORRAL_DEV_URL;
	// links (e.g. a PR url) open in the real browser. never a new electron window: it would inherit our preload bridge
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) shell.openExternal(url);
		return { action: "deny" };
	});
	if (devUrl) win.loadURL(devUrl);
	else
		win.loadFile(resolve(import.meta.dirname, "../../dist/ui/index.html"), {
			query: process.env.CORRAL_WEBGL ? { webgl: "1" } : {},
		});

	// ── the wire: one JSON per line, both ways ──
	const write = (msg: object) => sock.write(JSON.stringify(msg) + "\n");
	const pending = new Map<number, (data: any) => void>();
	const exitWaiters = new Map<number, () => void>(); // agent id → resolve when the daemon says it exited
	let reqs = 0;
	// request/response on top of a stream: tag with reqId, resolve when the matching reply arrives
	const rpc = (msg: object) =>
		new Promise<any>((ok) => {
			const reqId = ++reqs;
			pending.set(reqId, ok);
			write({ ...msg, reqId });
		});

	let buf = "";
	sock.setEncoding("utf8");
	sock.on("data", (chunk: string) => {
		buf += chunk;
		let nl: number;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const msg = JSON.parse(buf.slice(0, nl));
			buf = buf.slice(nl + 1);
			if (msg.type === "reply") {
				pending.get(msg.reqId)?.(msg);
				pending.delete(msg.reqId);
			} else {
				if (msg.type === "exited") exitWaiters.get(msg.id)?.();
				win.webContents.send(msg.type, msg); // out / exited / status → UI
			}
		}
	});
	sock.on("close", () => {
		if (!win.isDestroyed()) dialog.showErrorBox("Lost corrald", "The daemon went away. Agents it owned are gone.");
	});

	// ── UI → daemon ──
	ipcMain.handle("new-thread", async (_e, { repo, task, size }) => {
		const r = await rpc({ type: "spawn", repo, task, size });
		return r.error ? { error: r.error } : r.thread;
	});
	ipcMain.handle("resume", async (_e, { meta, size }) => (await rpc({ type: "resume", meta, size })) as { id: number });
	ipcMain.handle("kill", async (_e, id: number) => await rpc({ type: "kill", id }));
	ipcMain.on("in", (_e, { id, text }) => write({ type: "in", id, text }));
	// daemon resizes the PTY; the kernel then sends SIGWINCH to the agent
	ipcMain.on("resize", (_e, { id, cols, rows }) => write({ type: "resize", id, cols, rows }));

	// ── local-only stuff: reading git on disk needs no agent ──
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });

	// git IS the database of pens: every worktree under ~/.corral/pens is one
	ipcMain.handle("list-pens", (_e, repo: string) => {
		const pensDir = join(homedir(), ".corral", "pens");
		return git(repo, "worktree", "list", "--porcelain")
			.split("\n\n")
			.map((block) => ({
				pen: block.match(/^worktree (.+)$/m)?.[1] ?? "",
				branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "",
			}))
			.filter((p) => p.pen.startsWith(pensDir) && p.branch.startsWith("corral/"))
			.map((p) => ({ ...p, repo, task: p.branch.replace(/^corral\//, "").replace(/-\d+$/, "").replace(/-/g, " ") }));
	});

	// files panel: what changed + the whole tree
	ipcMain.handle("files", (_e, pen: string) => {
		try {
			const changed = git(pen, "status", "--porcelain", "-uall")
				.split("\n")
				.filter(Boolean)
				.map((l) => ({ status: l.slice(0, 2).trim() || "?", path: l.slice(3) }));
			const all = git(pen, "ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
			return { changed, all };
		} catch (err) {
			return { changed: [], all: [], error: String((err as Error).message) };
		}
	});

	// ── pen lifecycle: merge (local), open PR (GitHub), delete. separate actions, like Paradev ──
	const fail = (err: unknown) => ({ error: String((err as Error).message ?? err) });

	// kill the agent and wait for the "exited" broadcast, so claude can't write into a pen we're touching.
	// (not polling `list`: it replays every agent's scrollback each call.) 5s cap: SIGKILL lands at 3s.
	async function stopAgent(id: number | null) {
		if (id === null) return;
		const dead = new Promise<void>((r) => {
			exitWaiters.set(id, r);
			setTimeout(r, 5000);
		});
		const r = (await rpc({ type: "kill", id })) as { error?: string };
		if (!r.error) await dead; // "no such agent" = already dead, nothing to wait for
		exitWaiters.delete(id);
	}
	// claude edits files but never commits: without this, merge/PR would carry nothing
	function commitIfDirty(pen: string, message: string) {
		if (!git(pen, "status", "--porcelain").trim()) return;
		git(pen, "add", "-A");
		git(pen, "commit", "-q", "-m", message);
	}

	// merge locally into whatever branch the repo has checked out. pen is KEPT (delete is its own action)
	ipcMain.handle("merge", async (_e, { id, repo, pen, branch, message }) => {
		try {
			await stopAgent(id);
			commitIfDirty(pen, message);
			try {
				git(repo, "merge", "--no-edit", branch);
			} catch (err) {
				try { git(repo, "merge", "--abort"); } catch {} // nothing to abort if merge refused to start
				return { error: `merge failed, nothing changed: ${(err as Error).message}` };
			}
			return { ok: true };
		} catch (err) {
			return fail(err);
		}
	});

	// push the branch and open a PR on GitHub. agent keeps running: a PR isn't the end of the work
	ipcMain.handle("open-pr", async (_e, { pen, branch, message }) => {
		try {
			commitIfDirty(pen, message);
			git(pen, "push", "-q", "-u", "origin", branch);
			const url = execFileSync("gh", ["pr", "create", "--head", branch, "--title", message, "--body", "Opened from Corral."], {
				cwd: pen,
				encoding: "utf8",
			}).trim();
			return { ok: true, url };
		} catch (err) {
			return fail(err);
		}
	});

	// delete: refuses unmerged work unless force. fast path stolen from Paradev's removeWorktree:
	// rename (instant, same fs) → prune (git forgets it) → rm -rf in the background (UI never waits on node_modules)
	ipcMain.handle("delete-pen", async (_e, { id, repo, pen, branch, force }) => {
		try {
			const dirty = git(pen, "status", "--porcelain").trim() !== "";
			const merged = git(repo, "branch", "--merged", "HEAD", "--format=%(refname:short)").split("\n").includes(branch);
			if (!force && (dirty || !merged)) return { needsForce: true, dirty, merged };
			await stopAgent(id);
			const tmp = join(dirname(pen), `.corral-delete-${Date.now()}`);
			renameSync(pen, tmp);
			git(repo, "worktree", "prune");
			git(repo, "branch", "-D", branch); // safe to force: we checked merged/dirty above (or the user said force)
			spawn("/bin/rm", ["-rf", tmp], { detached: true, stdio: "ignore" }).unref();
			return { ok: true };
		} catch (err) {
			return fail(err);
		}
	});

	ipcMain.handle("pick-repo", async () => {
		const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	});

	win.webContents.on("did-finish-load", async () => {
		// RE-ATTACH: whatever the daemon is running shows up again
		const { threads } = await rpc({ type: "list" });
		for (const t of threads) win.webContents.send("thread", t);

		// optional CLI preload: `npm run app <repo> "task" ...`
		if (repoArg) {
			const repo = resolve(repoArg);
			win.webContents.send("workspace", repo);
			for (const task of tasks) {
				const r = await rpc({ type: "spawn", repo, task });
				if (!r.error) win.webContents.send("thread", r.thread);
			}
		}

		// dev hook: CORRAL_SHOT=out.png → screenshot own window after a delay, then quit
		const shot = process.env.CORRAL_SHOT;
		if (shot && process.env.CORRAL_SHOT_RESIZE) setTimeout(() => win.setSize(1000, 700), 1500); // mid-run resize → proves SIGWINCH path
		if (shot)
			setTimeout(async () => {
				writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
				app.quit();
			}, Number(process.env.CORRAL_SHOT_DELAY ?? 3000));
	});
});

app.on("window-all-closed", () => app.quit());
