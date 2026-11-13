// Corral window = a CLIENT of corrald. It owns no agents: quit it, crash it, agents keep running.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { codeVersion } from "../version.ts";
import * as G from "./git.ts";

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
	// the app window never navigates away from corral (a stray link click would replace the whole UI)
	win.webContents.on("will-navigate", (e, url) => {
		if (url !== win.webContents.getURL()) {
			e.preventDefault();
			if (url.startsWith("https://")) shell.openExternal(url);
		}
	});
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
			// a pen = a worktree living in ~/.corral/pens. (branch names are short and prefix-free now)
			.filter((p) => p.pen.startsWith(pensDir) && p.branch)
			.map((p) => {
				// the full task is the branch description; old corral/<slug>-<n> pens fall back to the slug
				let task = "";
				try {
					task = git(repo, "config", "--get", `branch.${p.branch}.description`).trim();
				} catch {}
				return { ...p, repo, task: task || p.branch.replace(/^corral\//, "").replace(/-\d+$/, "").replace(/-/g, " ") };
			});
	});

	// files panel: what changed + the whole tree
	// MERGE-BASE: the last commit the pen and the real repo both have = the moment the pen forked.
	// diffing against it shows only what the pen did: work you commit on main after that never shows up as a
	// phantom "claude deleted this", and committed pen work (merge, PR, claude's own commits) stays visible.
	// from inside a pen, --git-common-dir is the shared .git, where HEAD = the main checkout's HEAD.
	const penBase = (pen: string) => {
		const common = resolve(pen, git(pen, "rev-parse", "--git-common-dir").trim());
		const mainHead = git(pen, `--git-dir=${common}`, "rev-parse", "HEAD").trim();
		const mainName = git(pen, `--git-dir=${common}`, "rev-parse", "--abbrev-ref", "HEAD").trim();
		// newest point shared with your local main OR GitHub's main: after "push → main" your local checkout
		// is still behind, and diffing against it would list already-shipped work as changes
		let remoteMain: string[] = [];
		try {
			remoteMain = [git(pen, "rev-parse", "--verify", "-q", `refs/remotes/origin/${mainName}`).trim()];
		} catch {} // no remote / never fetched
		return git(pen, "merge-base", "HEAD", mainHead, ...remoteMain).trim();
	};

	ipcMain.handle("files", (_e, pen: string) => {
		try {
			// tracked: working tree vs merge-base (covers committed AND uncommitted). untracked: new files
			const changed = git(pen, "diff", "--name-status", penBase(pen))
				.split("\n")
				.filter(Boolean)
				.map((l) => {
					const f = l.split("\t"); // "M\tpath" or "R100\told\tnew": the last field is the current path
					return { status: f[0][0], path: f[f.length - 1] };
				});
			for (const p of git(pen, "ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean))
				changed.push({ status: "?", path: p });
			const all = git(pen, "ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
			return { changed, all };
		} catch (err) {
			return { changed: [], all: [], error: String((err as Error).message) };
		}
	});

	// ── file viewer: read one file from a pen ──
	// path comes from the renderer: resolve it and refuse anything outside the pen (../../.ssh/id_rsa)
	const inPen = (pen: string, rel: string) => {
		const abs = resolve(pen, rel);
		return abs.startsWith(resolve(pen) + "/") ? abs : null;
	};
	ipcMain.handle("read-file", (_e, { pen, path }: { pen: string; path: string }) => {
		const abs = inPen(pen, path);
		if (!abs) return { error: "path outside the pen" };
		try {
			const size = statSync(abs).size;
			if (size > 5 << 20) return { tooBig: true, size }; // the string still has to cross IPC whole
			const buf = readFileSync(abs);
			if (buf.subarray(0, 8192).includes(0)) return { binary: true, size }; // NUL byte = not text
			return { text: buf.toString("utf8") };
		} catch (err) {
			return { error: String((err as Error).message) }; // deleted file in Changes → ENOENT, that's fine
		}
	});

	// the diff's left side: the file as it was at the merge-base. not in that commit → new file → ""
	ipcMain.handle("read-base", (_e, { pen, path }: { pen: string; path: string }) => {
		if (!inPen(pen, path)) return { error: "path outside the pen" };
		try {
			const text = execFileSync("git", ["-C", pen, "show", `${penBase(pen)}:${path}`], { encoding: "utf8", maxBuffer: 5 << 20 });
			if (text.slice(0, 8192).includes("\0")) return { binary: true };
			return { text };
		} catch {
			return { text: "" }; // didn't exist at the fork point: claude created it
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
	// ── git command center: thin pass-through to the whitelisted recipes in git.ts ──
	// destructive recipes (discard, undo) must only ever touch a pen, never your real checkout
	const PENS = join(homedir(), ".corral", "pens") + "/";
	const isPen = (p: unknown): p is string => typeof p === "string" && resolve(p).startsWith(PENS) && existsSync(p);
	const isRepo = (p: unknown): p is string => typeof p === "string" && p.startsWith("/") && existsSync(p) && statSync(p).isDirectory();
	ipcMain.handle("git-info", (_e, pen: string) => {
		if (!isPen(pen)) return { error: "not a pen" };
		return G.info(pen).catch((err) => ({ error: String((err as Error).message) }));
	});
	ipcMain.handle("git-run", (_e, { pen, action, fields }) => (isPen(pen) ? G.run(pen, String(action), fields ?? {}) : { error: "not a pen" }));
	// pull requests (gh). read + merge/close/ready/comment, all scoped to a pen's repo
	ipcMain.handle("pr-list", (_e, { pen, state }) => (isPen(pen) ? G.prs(pen, ["open", "merged", "closed", "all"].includes(state) ? state : "open") : { error: "not a pen" }));
	ipcMain.handle("pr-view", (_e, { pen, num }) => (isPen(pen) ? G.pr(pen, Number(num)) : { error: "not a pen" }));
	ipcMain.handle("pr-for-branch", (_e, pen: string) => (isPen(pen) ? G.prForBranch(pen) : { error: "not a pen" }));
	ipcMain.handle("pr-merge", (_e, { pen, num, method, deleteBranch }) => (isPen(pen) ? G.prMerge(pen, Number(num), String(method), !!deleteBranch) : { error: "not a pen" }));
	ipcMain.handle("pr-act", (_e, { pen, num, act, body }) => (isPen(pen) ? G.prAct(pen, Number(num), act, String(body ?? "")) : { error: "not a pen" }));
	ipcMain.handle("git-ai-message", (_e, pen: string) => (isPen(pen) ? G.aiMessage(pen, process.env.CORRAL_AGENT ?? "claude") : { error: "not a pen" }));
	ipcMain.handle("open-url", (_e, url: string) => {
		if (/^https:\/\//.test(url)) shell.openExternal(url); // https only: never file:// or app links
	});
	// repo setup: plain folder → git init → GitHub
	ipcMain.handle("repo-info", (_e, repo: string) => (isRepo(repo) ? G.repoInfo(repo) : { error: "not a folder" }));
	ipcMain.handle("repo-init", (_e, repo: string) => (isRepo(repo) ? G.init(repo) : { error: "not a folder" }));
	ipcMain.handle("repo-github", (_e, { repo, name, visibility }) =>
		isRepo(repo) ? G.connectGitHub(repo, String(name), visibility === "public" ? "public" : "private") : { error: "not a folder" },
	);

	ipcMain.handle("open-pr", async (_e, { pen, branch, message }) => {
		// async (G.git / G.sh): a push + gh round-trip takes seconds and must not freeze the main process
		try {
			commitIfDirty(pen, message);
			await G.git(pen, "push", "-q", "-u", "origin", branch);
			const r = await G.sh("gh", ["pr", "create", "--head", branch, "--title", message, "--body", "Opened from Corral."], { cwd: pen, timeout: 60_000 });
			if (r.error || r.status !== 0) return { error: (r.error?.message ?? (r.stderr || r.stdout)).trim().split("\n").slice(0, 4).join("\n") };
			return { ok: true, url: r.stdout.trim().split("\n").pop() };
		} catch (err) {
			return { error: String((err as { stderr?: string }).stderr || (err as Error).message) };
		}
	});

	// delete: refuses unmerged work unless force. fast path stolen from Paradev's removeWorktree:
	// rename (instant, same fs) → prune (git forgets it) → rm -rf in the background (UI never waits on node_modules)
	ipcMain.handle("delete-pen", async (_e, { id, repo, pen, branch, force }) => {
		try {
			const dirty = git(pen, "status", "--porcelain").trim() !== "";
			const merged = git(repo, "branch", "--merged", "HEAD", "--format=%(refname:short)").split("\n").includes(branch);
			if (!force && (dirty || !merged)) return { needsForce: true, dirty, merged };
			await removePen(id, repo, pen, branch);
			return { ok: true };
		} catch (err) {
			return fail(err);
		}
	});
	async function removePen(id: number | null, repo: string, pen: string, branch: string) {
		await stopAgent(id);
		const tmp = join(dirname(pen), `.corral-delete-${Date.now()}`);
		renameSync(pen, tmp);
		git(repo, "worktree", "prune");
		git(repo, "branch", "-D", branch); // safe to force: callers checked merged/dirty (or the user said force)
		spawn("/bin/rm", ["-rf", tmp], { detached: true, stdio: "ignore" }).unref();
	}

	// after a PR merge: GitHub (not local git) confirms it's merged → fast-forward your real main → delete the thread
	ipcMain.handle("pr-cleanup", async (_e, { id, repo, pen, branch }) => {
		if (!isPen(pen)) return { error: "not a pen" };
		const done = await G.mergedAndClean(pen);
		if (done.error) return { error: done.error };
		const up = await G.run(pen, "update-main", {}); // best effort: a dirty main shouldn't block the cleanup
		try {
			await removePen(id, repo, pen, branch);
		} catch (err) {
			return fail(err);
		}
		return { ok: true, text: up.ok ? `Cleaned up #${done.number}. ${up.text}` : `Thread deleted. Local main not updated: ${up.error}` };
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
