import * as pty from "node-pty";

const term = pty.spawn("node", ["-e", 'console.log("stdin isTTY:", process.stdin.isTTY)'], {
	cols: 80,
	rows: 24,
	cwd: process.cwd(),
	env: process.env as Record<string, string>,
});
term.onData((d) => process.stdout.write(`[from pty] ${JSON.stringify(d)}\n`));
term.onExit(({ exitCode }) => console.log("exit", exitCode));
