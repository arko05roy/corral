// git recipes. COMMAND PATTERN: the renderer names an action + sends form fields; only these exact recipes run.
// it never sends raw git args, so one XSS in a file preview can't become `git push --force`.
// no electron in here: plain functions over a pen/repo path, testable with plain node.
import { execFile, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ASYNC on purpose: a push takes seconds, and a sync exec would freeze electron's whole main process.
// GIT_TERMINAL_PROMPT=0: if git ever wants a password it fails fast with an error instead of hanging forever.
export const git = (cwd: string, ...args: string[]) =>
	new Promise<string>((ok, fail) =>
		execFile(
			"git",
			["-C", cwd, ...args],
			{ encoding: "utf8", maxBuffer: 64 << 20, timeout: 90_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
			(err, stdout, stderr) => (err ? fail(Object.assign(err, { stderr })) : ok(stdout)),
		),
	);
const ok = (cwd: string, ...args: string[]) => git(cwd, ...args).then(() => true, () => false);
// run a non-git CLI (claude, gh) with optional stdin
export const sh = (cmd: string, args: string[], opts: { cwd?: string; input?: string; timeout: number }) =>
	new Promise<{ status: number | null; stdout: string; stderr: string; error?: Error }>((done) => {
		const c = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
		let stdout = "";
		let stderr = "";
		const t = setTimeout(() => c.kill("SIGKILL"), opts.timeout);
		c.stdout.on("data", (d) => (stdout += d));
		c.stderr.on("data", (d) => (stderr += d));
		c.on("error", (error) => (clearTimeout(t), done({ status: null, stdout, stderr, error })));
		c.on("close", (status) => (clearTimeout(t), done({ status, stdout, stderr })));
		c.stdin.end(opts.input ?? "");
	});
// git's stderr often opens with noise ("To github.com:…"): lead with the lines that say what went wrong
const errText = (err: unknown) => {
	const e = err as { stderr?: string; message?: string };
	const lines = (e.stderr?.trim() || e.message || String(err)).split("\n").map((l) => l.trim()).filter(Boolean);
	const key = lines.filter((l) => /^(error|fatal|hint: Updates were rejected)|rejected|CONFLICT/i.test(l));
	return [...new Set([...key, ...lines])].slice(0, 6).join("\n");
};

// the main checkout's branch + the pen's fork point (see main.ts penBase for the why)
const commonDir = async (pen: string) => resolve(pen, (await git(pen, "rev-parse", "--git-common-dir")).trim());
export const mainBranch = async (pen: string) => (await git(pen, `--git-dir=${await commonDir(pen)}`, "rev-parse", "--abbrev-ref", "HEAD")).trim();
export const mergeBase = async (pen: string) => (await git(pen, "merge-base", "HEAD", await mainBranch(pen))).trim();
const head = async (pen: string) => (await git(pen, "rev-parse", "HEAD")).trim();

async function validBranch(cwd: string, name: string) {
	if (!name || !(await ok(cwd, "check-ref-format", "--branch", name))) throw new Error(`"${name}" isn't a valid branch name`);
	return name;
}
// "origin/feature/login" → "feature/login"; null if never pushed
const upstreamBranch = (cwd: string) =>
	git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}").then((u) => u.trim().replace(/^origin\//, ""), () => null);
const hasRemote = async (cwd: string) => (await git(cwd, "remote")).trim().split("\n").includes("origin");
const dirty = async (cwd: string) => (await git(cwd, "status", "--porcelain")).trim() !== "";
async function commitAll(pen: string, message: string) {
	if (!message.trim()) throw new Error("commit message is empty");
	await git(pen, "add", "-A");
	await git(pen, "commit", "-q", "-m", message);
}
// merge-ish ops must never leave a half-merged pen: abort and report instead
async function tryOrAbort(pen: string, run: () => Promise<unknown>, abort: string[]) {
	try {
		await run();
	} catch (err) {
		await ok(pen, ...abort);
		throw new Error(`conflict, nothing changed:\n${errText(err)}`);
	}
}
// "git@github.com:me/x.git" / "https://github.com/me/x.git" → "https://github.com/me/x"
export async function webUrl(cwd: string) {
	if (!(await hasRemote(cwd))) return null;
	const u = (await git(cwd, "remote", "get-url", "origin")).trim();
	const m = u.match(/^(?:git@|https:\/\/)([^/:]+)[/:](.+?)(?:\.git)?$/);
	return m ? `https://${m[1]}/${m[2]}` : null;
}
// branches checked out in OTHER pens: internal, never offered as push/pull targets
async function otherPenBranches(pen: string) {
	const me = resolve(pen);
	return (await git(pen, "worktree", "list", "--porcelain"))
		.split("\n\n")
		.map((b) => ({ path: b.match(/^worktree (.+)$/m)?.[1] ?? "", branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "" }))
		.filter((w) => w.branch && resolve(w.path) !== me && w.path.includes("/.corral/pens/"))
		.map((w) => w.branch);
}

// the main worktree = the first block of `git worktree list` (your real checkout, e.g. ~/Desktop/port)
async function mainCheckout(pen: string) {
	return (await git(pen, "worktree", "list", "--porcelain")).match(/^worktree (.+)$/m)![1];
}

// everything the panel shows: branch, ahead/behind its upstream, branches for dropdowns, recent history
export async function info(pen: string) {
	await fetchQuietly(pen);
	const [branch, remote, upstream, headSha] = await Promise.all([
		git(pen, "rev-parse", "--abbrev-ref", "HEAD").then((b) => b.trim()),
		hasRemote(pen),
		git(pen, "rev-parse", "--abbrev-ref", "@{upstream}").then((u) => u.trim(), () => null), // null: never pushed
		head(pen),
	]);
	let ahead = 0;
	let behind = 0;
	if (upstream) [behind, ahead] = (await git(pen, "rev-list", "--left-right", "--count", "@{upstream}...HEAD")).trim().split(/\s+/).map(Number);
	const [local, remoteRaw, logRaw, stashRaw, main, web, isDirty, hide] = await Promise.all([
		git(pen, "branch", "--format=%(refname:short)"),
		remote ? git(pen, "branch", "-r", "--format=%(refname:short)") : "",
		git(pen, "log", "-15", "--format=%h%x1f%s%x1f%ar%x1f%an"),
		git(pen, "stash", "list"),
		mainBranch(pen),
		webUrl(pen),
		dirty(pen),
		otherPenBranches(pen),
	]);
	// commits on no remote at all (works before the first push, when there's no upstream to compare with)
	const unpushed = remote ? Number((await git(pen, "rev-list", "--count", "HEAD", "--not", "--remotes")).trim()) : 0;
	// commits on GitHub's main whose CHANGE isn't in this thread (--cherry-pick: a squash of our own work doesn't count)
	const mainAhead = remote
		? await git(pen, "rev-list", "--count", "--right-only", "--cherry-pick", "--no-merges", `HEAD...origin/${main}`).then((n) => Number(n.trim()), () => 0)
		: 0;
	const remoteBranches = remoteRaw.split("\n").filter((b) => b && !b.endsWith("/HEAD")).map((b) => b.replace(/^origin\//, ""));
	const log = logRaw
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const [hash, subject, when, author] = l.split("\x1f");
			return { hash, subject, when, author };
		});
	return {
		branch,
		head: headSha,
		main,
		upstream,
		ahead,
		behind,
		remote,
		web,
		dirty: isDirty,
		unpushed,
		mainAhead,
		branches: [...new Set([...local.split("\n").filter(Boolean), ...remoteBranches])].filter((b) => !hide.includes(b)),
		log,
		stashes: stashRaw.split("\n").filter(Boolean).length,
	};
}

// lazy git: push to `to`, integrating first if it moved on GitHub. rebase when every commit we'd move is
// local-only (rewriting them is safe, and rebase drops commits whose PATCH is already there, e.g. after a
// squash merge). merge when some were already pushed somewhere (rewriting those breaks other copies).
async function integrateAndPush(pen: string, to: string, track: boolean) {
	await git(pen, "fetch", "-q", "origin");
	const remoteHas = await ok(pen, "rev-parse", "--verify", "-q", `refs/remotes/origin/${to}`);
	let note = "";
	if (remoteHas && !(await ok(pen, "merge-base", "--is-ancestor", `origin/${to}`, "HEAD"))) {
		const total = Number((await git(pen, "rev-list", "--count", `origin/${to}..HEAD`)).trim());
		const localOnly = Number((await git(pen, "rev-list", "--count", `origin/${to}..HEAD`, "--not", "--remotes")).trim());
		if (localOnly === total) {
			await tryOrAbort(pen, () => git(pen, "rebase", `origin/${to}`), ["rebase", "--abort"]);
			const after = Number((await git(pen, "rev-list", "--count", `origin/${to}..HEAD`)).trim());
			const skipped = total - after;
			note = ` Rebased onto the latest ${to} first${skipped ? ` (skipped ${skipped} commit${skipped === 1 ? "" : "s"} already in ${to})` : ""}.`;
		} else {
			await tryOrAbort(pen, () => git(pen, "merge", "--no-edit", `origin/${to}`), ["merge", "--abort"]);
			note = ` Merged the latest ${to} in first.`;
		}
	}
	await git(pen, "push", ...(track ? ["-u"] : []), "origin", `HEAD:refs/heads/${to}`);
	return note;
}

// fetch at most once a minute per pen: the panel polls info every 5s, GitHub doesn't need to hear about it
const lastFetch = new Map<string, number>();
async function fetchQuietly(pen: string) {
	if (Date.now() - (lastFetch.get(pen) ?? 0) < 60_000) return;
	lastFetch.set(pen, Date.now());
	await ok(pen, "fetch", "-q", "origin"); // offline/no remote → just keep the old picture
}

export type Fields = { message?: string; branch?: string };

// the whitelist. each recipe: validate fields → exact git calls → short human result
export const actions: Record<string, (pen: string, f: Fields) => Promise<string>> = {
	async commit(pen, f) {
		if (!(await dirty(pen))) throw new Error("nothing to commit");
		await commitAll(pen, f.message ?? "");
		return "Committed.";
	},
	async "commit-push"(pen, f) {
		const to = await validBranch(pen, f.branch ?? "");
		if (!(await hasRemote(pen))) throw new Error("no GitHub remote yet: use Connect GitHub first");
		if (await dirty(pen)) await commitAll(pen, f.message ?? "");
		// track (-u) only the pen's own branch or a brand-new one. pushing into main/someone's branch with -u
		// would make every later plain "Push" silently go there too
		const mine = (await git(pen, "rev-parse", "--abbrev-ref", "HEAD")).trim();
		const exists = await ok(pen, "ls-remote", "--exit-code", "--heads", "origin", to);
		const track = to === mine || !exists;
		const note = await integrateAndPush(pen, to, track);
		return `Pushed to ${to}.${note}`;
	},
	async push(pen) {
		if (!(await hasRemote(pen))) throw new Error("no GitHub remote yet: use Connect GitHub first");
		// to the upstream if there is one ("Commit & push → feature/login" sets it). plain `push origin HEAD`
		// would go to a branch named like the LOCAL one, silently somewhere else
		const to = (await upstreamBranch(pen)) ?? (await git(pen, "rev-parse", "--abbrev-ref", "HEAD")).trim();
		const note = await integrateAndPush(pen, to, true);
		return `Pushed to ${to}.${note}`;
	},
	async amend(pen, f) {
		if ((await head(pen)) === (await mergeBase(pen))) throw new Error("no commit of this pen's to amend yet");
		await git(pen, "add", "-A");
		if (f.message?.trim()) await git(pen, "commit", "-q", "--amend", "-m", f.message);
		else await git(pen, "commit", "-q", "--amend", "--no-edit");
		return "Amended the last commit.";
	},
	async pull(pen, f) {
		const from = await validBranch(pen, f.branch ?? "");
		if (!(await hasRemote(pen))) throw new Error("no remote to pull from");
		if (await dirty(pen)) throw new Error("commit or stash your changes first");
		await git(pen, "fetch", "-q", "origin", from);
		await tryOrAbort(pen, () => git(pen, "merge", "--no-edit", `origin/${from}`), ["merge", "--abort"]);
		return `Pulled ${from}.`;
	},
	async fetch(pen) {
		if (!(await hasRemote(pen))) throw new Error("no remote to fetch from");
		await git(pen, "fetch", "-q", "--all", "--prune");
		return "Fetched.";
	},
	async "sync-main"(pen) {
		if (await dirty(pen)) throw new Error("commit or stash your changes first");
		const m = await mainBranch(pen);
		await tryOrAbort(pen, () => git(pen, "merge", "--no-edit", m), ["merge", "--abort"]);
		return `Merged the latest ${m} into this pen.`;
	},
	async "rebase-main"(pen) {
		if (await dirty(pen)) throw new Error("commit or stash your changes first");
		const m = await mainBranch(pen);
		await tryOrAbort(pen, () => git(pen, "rebase", m), ["rebase", "--abort"]);
		return `Rebased onto ${m}.`;
	},
	async undo(pen) {
		// never below the fork point: those commits are main's, not this pen's
		if ((await head(pen)) === (await mergeBase(pen))) throw new Error("no commit of this pen's to undo");
		// already on GitHub → undoing rewrites history and the next push needs --force. refuse
		if ((await upstreamBranch(pen)) && (await ok(pen, "merge-base", "--is-ancestor", "HEAD", "@{upstream}")))
			throw new Error("that commit is already pushed: undoing it would need a force push");
		await git(pen, "reset", "-q", "--soft", "HEAD~1");
		return "Undid the last commit. Its changes are back as uncommitted.";
	},
	// pull GitHub's main into your REAL checkout (fast-forward only: never a merge commit, never touches your
	// uncommitted work). after a PR merge or a push straight to main, your local main is otherwise behind
	async "update-main"(pen) {
		const repo = await mainCheckout(pen);
		const m = await mainBranch(pen);
		if (!(await hasRemote(repo))) throw new Error("no GitHub remote");
		await git(repo, "fetch", "-q", "origin", m);
		try {
			await git(repo, "merge", "-q", "--ff-only", `origin/${m}`);
		} catch (err) {
			throw new Error(`couldn't fast-forward ${m} in ${repo}: it has its own commits or changes in the way.\n${errText(err)}`);
		}
		return `Your local ${m} matches GitHub.`;
	},
	async discard(pen) {
		await git(pen, "reset", "-q", "--hard", "HEAD");
		await git(pen, "clean", "-fdq");
		return "Discarded all uncommitted changes.";
	},
	async stash(pen, f) {
		if (!(await dirty(pen))) throw new Error("nothing to stash");
		await git(pen, "stash", "push", "-u", "-m", f.message?.trim() || "corral stash");
		return "Stashed.";
	},
	async "stash-pop"(pen) {
		await tryOrAbort(pen, () => git(pen, "stash", "pop"), ["reset", "-q", "--merge"]);
		return "Restored the stash.";
	},
};

export async function run(pen: string, action: string, f: Fields) {
	const recipe = Object.hasOwn(actions, action) ? actions[action] : null;
	if (!recipe) return { error: `unknown action ${action}` };
	try {
		return { ok: true, text: await recipe(pen, f) };
	} catch (err) {
		return { error: errText(err) };
	}
}

// ✨ commit message from the diff: claude -p, diff on stdin, one message out
export async function aiMessage(pen: string, agent = "claude") {
	try {
		const base = await mergeBase(pen);
		const diff = ((await git(pen, "diff", base)) || (await git(pen, "status", "--porcelain"))).slice(0, 60_000);
		if (!diff.trim()) return { error: "no changes to describe" };
		const prompt = "Write a git commit message for this diff: one imperative subject line under 72 chars, then optionally a blank line and 1-3 short bullet points. Output ONLY the message.";
		const r = await sh(agent, ["-p", prompt], { cwd: pen, input: diff, timeout: 60_000 });
		if (r.error || r.status !== 0) return { error: `claude failed: ${r.error?.message ?? r.stderr.slice(0, 300)}` };
		return { text: r.stdout.trim().replace(/^```\w*\n?|```$/g, "").trim() };
	} catch (err) {
		return { error: errText(err) };
	}
}

// ── repo setup: plain folder → git → GitHub ──
export async function repoInfo(repo: string) {
	const isGit = await ok(repo, "rev-parse", "--is-inside-work-tree");
	const hasCommit = isGit && (await ok(repo, "rev-parse", "--verify", "-q", "HEAD"));
	return { isGit, hasCommit, remote: isGit && (await hasRemote(repo)), web: isGit ? await webUrl(repo) : null };
}

const DEFAULT_IGNORE = ["node_modules/", ".env", ".env.*", "!.env.example", "dist/", "build/", ".next/", ".DS_Store", "*.log", ""].join("\n");

export async function init(repo: string) {
	try {
		if (!(await ok(repo, "rev-parse", "--is-inside-work-tree"))) await git(repo, "init", "-q", "-b", "main");
		// pens only contain COMMITTED files, so the folder must be committed. ignore junk + secrets first
		const ignore = join(repo, ".gitignore");
		if (!existsSync(ignore)) writeFileSync(ignore, DEFAULT_IGNORE);
		if (!(await ok(repo, "rev-parse", "--verify", "-q", "HEAD"))) {
			await git(repo, "add", "-A");
			await git(repo, "commit", "-q", "--allow-empty", "-m", "Initial commit");
		}
		return { ok: true, text: "Git repo ready." };
	} catch (err) {
		return { error: errText(err) };
	}
}

// gh does the GitHub side: create the repo, add origin, push
export async function connectGitHub(repo: string, name: string, visibility: "private" | "public") {
	if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return { error: "repo name: letters, numbers, . _ - only" };
	const auth = await sh("gh", ["auth", "status"], { timeout: 15_000 });
	if (auth.error) return { error: "GitHub CLI (gh) isn't installed: brew install gh" };
	if (auth.status !== 0) return { error: "Not logged in to GitHub. Run in a terminal: gh auth login" };
	const r = await sh("gh", ["repo", "create", name, `--${visibility}`, "--source", repo, "--remote", "origin", "--push"], { timeout: 120_000 });
	if (r.status !== 0) return { error: (r.stderr || r.stdout).trim().split("\n").slice(0, 4).join("\n") };
	return { ok: true, text: "Connected to GitHub.", url: await webUrl(repo) };
}

// ── pull requests, via gh (it reads the repo from the pen's origin) ──
const ghJson = async (pen: string, args: string[]) => {
	const r = await sh("gh", args, { cwd: pen, timeout: 30_000 });
	if (r.error) throw new Error("GitHub CLI (gh) isn't installed: brew install gh");
	if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").slice(0, 3).join("\n"));
	return JSON.parse(r.stdout || "null");
};
type Check = { __typename: string; name?: string; context?: string; state?: string; status?: string; conclusion?: string; detailsUrl?: string; targetUrl?: string };
// two shapes: StatusContext (state) and CheckRun (status + conclusion) → one verdict per check
function verdict(c: Check): "pass" | "fail" | "pending" | "skip" {
	if (c.__typename === "StatusContext") return c.state === "SUCCESS" ? "pass" : c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "fail";
	if (c.status !== "COMPLETED") return "pending";
	if (c.conclusion === "SUCCESS" || c.conclusion === "NEUTRAL") return "pass";
	if (c.conclusion === "SKIPPED") return "skip";
	return "fail";
}
const summarize = (checks: Check[] = []) => {
	const v = checks.map(verdict);
	return { total: v.length, pass: v.filter((x) => x === "pass").length, fail: v.filter((x) => x === "fail").length, pending: v.filter((x) => x === "pending").length };
};
const LIST = "number,title,state,headRefName,baseRefName,isDraft,url,author,reviewDecision,mergeStateStatus,additions,deletions,changedFiles,updatedAt,statusCheckRollup";

export async function prs(pen: string, state: "open" | "merged" | "closed" | "all" = "open") {
	try {
		const list = await ghJson(pen, ["pr", "list", "--state", state, "--limit", "40", "--json", LIST]);
		return { prs: list.map((p: any) => ({ ...p, author: p.author?.login, checks: summarize(p.statusCheckRollup), statusCheckRollup: undefined })) };
	} catch (err) {
		return { error: errText(err) };
	}
}

export async function pr(pen: string, num: number) {
	if (!Number.isInteger(num) || num < 1) return { error: "bad PR number" };
	try {
		const [p, repo] = await Promise.all([
			ghJson(pen, ["pr", "view", String(num), "--json", `${LIST},body,mergeable,files,comments,reviews,commits`]),
			ghJson(pen, ["repo", "view", "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,viewerPermission"]),
		]);
		return {
			pr: {
				...p,
				author: p.author?.login,
				checks: summarize(p.statusCheckRollup),
				checkList: (p.statusCheckRollup ?? []).map((c: Check) => ({ name: c.name || c.context, verdict: verdict(c), url: c.detailsUrl || c.targetUrl })),
				statusCheckRollup: undefined,
				files: (p.files ?? []).map((f: any) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
				comments: [...(p.comments ?? []), ...(p.reviews ?? []).filter((r: any) => r.body)]
					.map((c: any) => ({ author: c.author?.login, bot: !!c.author?.is_bot || /\[bot\]$/.test(c.author?.login ?? ""), body: c.body, at: c.createdAt || c.submittedAt, state: c.state }))
					.sort((a: any, b: any) => (a.at < b.at ? -1 : 1)),
				commits: (p.commits ?? []).length,
				reviews: undefined,
				methods: [repo.squashMergeAllowed && "squash", repo.mergeCommitAllowed && "merge", repo.rebaseMergeAllowed && "rebase"].filter(Boolean),
				canMerge: ["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission),
			},
		};
	} catch (err) {
		return { error: errText(err) };
	}
}

// this thread's own PR (if any), for the git panel header
export async function prForBranch(pen: string) {
	try {
		const branch = (await git(pen, "rev-parse", "--abbrev-ref", "HEAD")).trim();
		const up = (await upstreamBranch(pen)) ?? branch;
		const list = await ghJson(pen, ["pr", "list", "--head", up, "--state", "all", "--limit", "1", "--json", "number,title,state,url,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,headRefOid"]);
		const p = list[0];
		return { pr: p ? { ...p, checks: summarize(p.statusCheckRollup), statusCheckRollup: undefined } : null };
	} catch (err) {
		return { error: errText(err) };
	}
}

// merge WITHOUT gh's --delete-branch: that also deletes the local branch and checks out main in the
// current folder, which blows up in a pen (main is already checked out in your real repo).
// we delete the GitHub branch ourselves instead.
export async function prMerge(pen: string, num: number, method: string, deleteBranch: boolean) {
	if (!Number.isInteger(num) || num < 1) return { error: "bad PR number" };
	if (!["squash", "merge", "rebase"].includes(method)) return { error: "bad merge method" };
	try {
		const p = await ghJson(pen, ["pr", "view", String(num), "--json", "headRefName,state"]);
		if (p.state !== "OPEN") return { error: `PR #${num} is ${p.state.toLowerCase()}` };
		const r = await sh("gh", ["pr", "merge", String(num), `--${method}`], { cwd: pen, timeout: 60_000 });
		if (r.status !== 0) return { error: (r.stderr || r.stdout).trim().split("\n").slice(0, 4).join("\n") };
		if (deleteBranch) await ok(pen, "push", "origin", "--delete", p.headRefName);
		return { ok: true, text: `Merged #${num}${deleteBranch ? ` and deleted ${p.headRefName} on GitHub` : ""}.` };
	} catch (err) {
		return { error: errText(err) };
	}
}

export async function prAct(pen: string, num: number, act: "close" | "ready" | "reopen" | "comment", body = "") {
	if (!Number.isInteger(num) || num < 1) return { error: "bad PR number" };
	const args: Record<string, string[]> = {
		close: ["pr", "close", String(num)],
		reopen: ["pr", "reopen", String(num)],
		ready: ["pr", "ready", String(num)],
		comment: ["pr", "comment", String(num), "--body", body],
	};
	if (!args[act]) return { error: "unknown PR action" };
	if (act === "comment" && !body.trim()) return { error: "comment is empty" };
	const r = await sh("gh", args[act], { cwd: pen, timeout: 30_000 });
	if (r.status !== 0) return { error: (r.stderr || r.stdout).trim().split("\n").slice(0, 3).join("\n") };
	return { ok: true, text: { close: `Closed #${num}.`, reopen: `Reopened #${num}.`, ready: `#${num} is ready for review.`, comment: "Comment posted." }[act] };
}

// clean-up gate, asked of GITHUB (not local git): a squash merge makes a new commit, so locally the branch
// never looks "merged". done = PR merged + nothing uncommitted + HEAD is exactly what got merged
export async function mergedAndClean(pen: string) {
	const r = await prForBranch(pen);
	if (r.error) return { error: r.error };
	const p = r.pr as { state: string; headRefOid: string; number: number } | null;
	if (!p || p.state !== "MERGED") return { error: "this thread's PR isn't merged" };
	if (await dirty(pen)) return { error: "there are uncommitted changes since the merge" };
	if ((await head(pen)) !== p.headRefOid) return { error: "there are new commits since the merge" };
	return { ok: true, number: p.number };
}
