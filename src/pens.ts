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
	// counter resets every launch, so skip numbers whose branch already exists
	const exists = (b: string) => {
		try {
			execFileSync("git", ["-C", repo, "rev-parse", "--verify", "-q", `refs/heads/${b}`]);
			return true;
		} catch {
			return false;
		}
	};
	// short readable name ("banchor-live-link"), a number only when taken
	const name = branchName(task);
	let branch = name;
	for (let i = 2; exists(branch); i++) branch = `${name}-${i}`;
	execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", branch, pen, "HEAD"]);
	// the full task lives in git's own per-branch description field (the short name can't hold it)
	execFileSync("git", ["-C", repo, "config", `branch.${branch}.description`, task]);
	return { pen, branch };
}

const STOP = new Set(
	"a an the to for of in on at by with and or but is are was were be been it its this that these those there here i me my we our you your can could should would will please just also so then than into from as do does did need want there's whose which who what when where how some any all".split(" "),
);
// "for the banchor app, there is a live link https://banchor.vercel.app you can add" → "banchor-app-live-link"
export function branchName(task: string) {
	const words = task
		.toLowerCase()
		.replace(/https?:\/\/(?:www\.)?([a-z0-9-]+)[^\s]*/g, " $1 ") // a URL becomes its name: banchor.vercel.app → banchor
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !STOP.has(w));
	const picked: string[] = [];
	for (const w of words) {
		if (picked.includes(w)) continue;
		if ([...picked, w].join("-").length > 32) break;
		picked.push(w);
		if (picked.length === 4) break;
	}
	return picked.join("-") || "thread";
}
