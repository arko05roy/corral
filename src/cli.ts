import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

const [repoArg, ...tasks] = process.argv.slice(2);
if (!repoArg || tasks.length === 0) {
	console.error('usage: corral <repo> "<task 1>" ["<task 2>" ...]');
	process.exit(1);
}

const repo = resolve(repoArg);
const pensDir = join(homedir(), ".corral", "pens");
const agentCmd = process.env.CORRAL_AGENT ?? "claude";

const slug = (s: string) =>
	s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

tasks.forEach((task, i) => {
	const pen = join(pensDir, `${basename(repo)}-${Date.now()}-${i + 1}`);
	mkdirSync(pensDir, { recursive: true });

	const t0 = performance.now();
	const branch = `corral/${slug(task)}-${i + 1}`;
	execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", branch, pen, "HEAD"]);
	const ms = Math.round(performance.now() - t0);
	console.log(`[pen ${i + 1}] worktree on ${branch} -> ${pen} (${ms}ms)`);

	const log = createWriteStream(join(pen, "corral.log"));
	const child = spawn(agentCmd, ["-p", task], { cwd: pen });
	child.stdout.pipe(log);
	child.stderr.pipe(log);
	child.on("error", (err) =>
		console.error(`[pen ${i + 1}] could not start agent: ${err.message}`),
	);
	child.on("exit", (code) =>
		console.log(`[pen ${i + 1}] agent exited (${code}) — see ${pen}/corral.log`),
	);
});
