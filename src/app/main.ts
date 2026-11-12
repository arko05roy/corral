import { resolve } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import * as pty from "node-pty";
import { createPen } from "../pens.ts";

const [repoArg, ...tasks] = process.argv.slice(2);
const repo = resolve(repoArg);
const agentCmd = process.env.CORRAL_AGENT ?? "claude";
const agents: pty.IPty[] = [];

app.whenReady().then(() => {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: { nodeIntegration: true, contextIsolation: false },
	});
	win.loadFile(resolve(import.meta.dirname, "index.html"));

	win.webContents.on("did-finish-load", () => {
		tasks.forEach((task, i) => {
			const { pen, branch } = createPen(repo, task, i + 1);
			win.webContents.send("pen", { id: i, task, branch });

			const term = pty.spawn(agentCmd, [task], {
				cols: 100,
				rows: 30,
				cwd: pen,
				env: process.env as Record<string, string>,
			});
			term.onData((text) => {
				if (process.env.CORRAL_DEBUG) process.stdout.write(`[pen ${i + 1}] ${JSON.stringify(text)}\n`);
				win.webContents.send("out", { id: i, text });
			});
			term.onExit(({ exitCode }) => win.webContents.send("out", { id: i, text: `\n[agent exited: ${exitCode}]\n` }));
			agents[i] = term;
		});
	});

	ipcMain.on("in", (_e, { id, text }) => agents[id]?.write(text));
});

app.on("window-all-closed", () => app.quit());
