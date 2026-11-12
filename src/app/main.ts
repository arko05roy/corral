// Corral window = a CLIENT of corrald. It owns no agents: quit it, crash it, agents keep running.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const [repoArg, ...tasks] = process.argv.slice(2);
const SOCK = join(homedir(), ".corral", "corrald.sock");

app.whenReady().then(async () => {
	// ── connect to the daemon first; no daemon = nothing to show ──
	let sock: net.Socket;
	try {
		sock = await new Promise<net.Socket>((ok, fail) => {
			const s = net.connect(SOCK, () => ok(s));
			s.once("error", fail);
		});
	} catch {
		dialog.showErrorBox("corrald isn't running", "Start it in a terminal first:\n\n  npm run daemon");
		return app.quit();
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
	if (devUrl) win.loadURL(devUrl);
	else
		win.loadFile(resolve(import.meta.dirname, "../../dist/ui/index.html"), {
			query: process.env.CORRAL_WEBGL ? { webgl: "1" } : {},
		});

	// ── the wire: one JSON per line, both ways ──
	const write = (msg: object) => sock.write(JSON.stringify(msg) + "\n");
	const pending = new Map<number, (data: any) => void>();
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
			} else win.webContents.send(msg.type, msg); // out / exited / status → UI
		}
	});
	sock.on("close", () => {
		if (!win.isDestroyed()) dialog.showErrorBox("Lost corrald", "The daemon went away. Agents it owned are gone.");
	});

	// ── UI → daemon ──
	ipcMain.handle("new-thread", async (_e, { repo, task }) => {
		const r = await rpc({ type: "spawn", repo, task });
		return r.error ? { error: r.error } : r.thread;
	});
	ipcMain.handle("resume", async (_e, meta) => (await rpc({ type: "resume", meta })) as { id: number });
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
