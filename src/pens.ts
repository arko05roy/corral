import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const slug = (s: string) =>
	s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function createPen(repo: string, task: string, n: number) {
	const pensDir = join(homedir(), ".corral", "pens");
	mkdirSync(pensDir, { recursive: true });
	const pen = join(pensDir, `${basename(repo)}-${Date.now()}-${n}`);
	const branch = `corral/${slug(task)}-${n}`;
	execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", branch, pen, "HEAD"]);
	return { pen, branch };
}
