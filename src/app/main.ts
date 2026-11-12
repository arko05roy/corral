import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as pty from "node-pty";
import { createPen } from "../pens.ts";

const [repoArg, ...tasks] = process.argv.slice(2);
const agentCmd = process.env.CORRAL_AGENT ?? "claude";
const agents = new Map<number, pty.IPty>();
let n = 0;

app.whenReady().then(() => {
	const win = new BrowserWindow({
		width: 1300,
		height: 850,
		backgroundColor: "#EFE6D2",
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

	function newThread(repo: string, task: string) {
		const { pen, branch } = createPen(repo, task, n + 1);
		return { ...spawnAgent(pen, [task]), repo, task, branch, pen };
	}

	function spawnAgent(pen: string, args: string[]) {
		const id = ++n;
		const term = pty.spawn(agentCmd, args, {
			cols: 100,
			rows: 30,
			cwd: pen,
			env: process.env as Record<string, string>,
		});
		term.onData((text) => win.webContents.send("out", { id, text }));
		term.onExit(({ exitCode }) => {
			win.webContents.send("out", { id, text: `\r\n[agent exited: ${exitCode}]\r\n` });
			win.webContents.send("exited", { id });
			agents.delete(id);
		});
		agents.set(id, term);
		return { id };
	}

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
	ipcMain.handle("resume", (_e, pen: string) => spawnAgent(pen, agentCmd === "claude" ? ["--continue"] : []));

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

	// UI → main: requests that need an answer
	ipcMain.handle("pick-repo", async () => {
		const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	});
	ipcMain.handle("new-thread", (_e, { repo, task }) => {
		try {
			return newThread(repo, task);
		} catch (err) {
			return { error: String((err as Error).message) };
		}
	});
	ipcMain.on("in", (_e, { id, text }) => agents.get(id)?.write(text));
	// set the PTY's window size; the kernel then sends SIGWINCH to the agent
	ipcMain.on("resize", (_e, { id, cols, rows }) => {
		if (cols > 0 && rows > 0) agents.get(id)?.resize(cols, rows);
	});

	// optional CLI preload: `npm run app <repo> "task" ...`
	win.webContents.on("did-finish-load", () => {
		if (!repoArg) return;
		const repo = resolve(repoArg);
		win.webContents.send("workspace", repo);
		for (const task of tasks) win.webContents.send("thread", newThread(repo, task));

		// dev hook: CORRAL_SHOT=out.png → screenshot own window after 3s, then quit
		const shot = process.env.CORRAL_SHOT;
		if (shot && process.env.CORRAL_SHOT_RESIZE) setTimeout(() => win.setSize(1000, 700), 1500); // mid-run resize → proves SIGWINCH path
		if (shot)
			setTimeout(async () => {
				writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
				app.quit();
			}, 3000);
	});
});

app.on("window-all-closed", () => app.quit());
