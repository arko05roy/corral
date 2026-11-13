// the git command center: bottom of the files panel + the file modal.
// actions are DATA (command pattern, UI side): one row per command, one generic dialog renders any of them.
import {
	ArrowDownToLine,
	ArrowUpFromLine,
	Archive,
	ArchiveRestore,
	Copy,
	GitBranch,
	GitCommitHorizontal,
	GitMerge,
	GitPullRequestArrow,
	GitPullRequest,
	History,
	PenLine,
	RefreshCw,
	RotateCcw,
	Sparkles,
	Trash2,
	Undo2,
	Upload,
	Shuffle,
	ExternalLink,
	CloudDownload,
	CheckCircle2,
	type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CheckDot, PrModal } from "./PrModal";
import type { GitInfo, PrSummary, Thread } from "./terms";

type Field = "message" | "branch";
type Spec = {
	id: string;
	label: string;
	icon: LucideIcon;
	title: string;
	desc: (i: GitInfo, t: Thread) => string;
	fields?: Field[];
	branch?: (i: GitInfo) => string; // default for the branch picker
	cta: string;
	danger?: boolean;
	hidden?: (i: GitInfo) => boolean;
	off?: (i: GitInfo) => string | null; // shown but can't do anything right now: the reason, on hover
	// custom runners for the pen-lifecycle actions that already had their own IPC
	run?: (t: Thread, f: { message: string; branch: string }, force: boolean) => Promise<{ ok?: true; text?: string; url?: string; error?: string; needsForce?: true; dirty?: boolean; merged?: boolean }>;
};

const alive = (t: Thread) => (t.alive ? t.id : null);

export const ACTIONS: Spec[] = [
	// ── primary ──
	{ id: "commit-push", label: "Commit & push", icon: Upload, title: "Commit & push", fields: ["message", "branch"], cta: "Commit & push",
		branch: (i) => i.upstream?.replace(/^origin\//, "") ?? i.branch,
		desc: (i) => (i.dirty ? "Commits every change in this pen, then pushes to the branch you pick. A new name creates it on GitHub." : "Nothing uncommitted: pushes the existing commits to the branch you pick.") },
	{ id: "pull", label: "Pull", icon: ArrowDownToLine, title: "Pull from a branch", fields: ["branch"], cta: "Pull", branch: (i) => i.main,
		desc: () => "Fetches the branch from GitHub and merges it into this pen. On a conflict nothing changes." },
	{ id: "pr", label: "Raise PR", icon: GitPullRequestArrow, title: "Raise a pull request", fields: ["message"], cta: "Open PR",
		desc: (i) => `Commits, pushes ${i.branch} and opens a PR on GitHub. The message becomes the PR title.`,
		run: (t, f) => window.corral.openPr({ pen: t.pen, branch: t.branch, message: f.message }) },
	// ── save ──
	{ id: "commit", off: (i) => (i.dirty ? null : "Nothing to commit: Claude already committed its work. Push it."), label: "Commit", icon: GitCommitHorizontal, title: "Commit", fields: ["message"], cta: "Commit", desc: () => "Commits every change in this pen locally. Nothing leaves your machine." },
	{ id: "push", label: "Push", icon: ArrowUpFromLine, title: "Push", cta: "Push", desc: (i) => `Pushes this pen's commits to ${i.upstream ?? "a new branch named " + i.branch}.` },
	{ id: "amend", label: "Amend", icon: PenLine, title: "Amend last commit", fields: ["message"], cta: "Amend",
		desc: () => "Folds uncommitted changes into the last commit. Leave the message empty to keep the old one." },
	// ── sync ──
	{ id: "update-main", label: "Update local main", icon: CloudDownload, title: "Update your local main", cta: "Update", hidden: (i) => !i.remote,
		desc: (i) => `Fast-forwards ${i.main} in your real checkout to match GitHub. Never makes a merge commit, never touches your uncommitted work.` },
	{ id: "cleanup", label: "Clean up", icon: CheckCircle2, title: "Merged · clean up this thread", cta: "Clean up", hidden: () => true,
		desc: (i) => `The PR is merged into ${i.main}. This pulls the new ${i.main} into your real checkout, then deletes this thread's folder and branch. Nothing is lost: the work is in ${i.main} now.`,
		run: (t) => window.corral.prCleanup({ id: alive(t), repo: t.repo, pen: t.pen, branch: t.branch }) },
	{ id: "fetch", label: "Fetch", icon: CloudDownload, title: "Fetch", cta: "Fetch", desc: () => "Downloads what's new on GitHub without changing your files." },
	{ id: "sync-main", label: "Sync with main", icon: RefreshCw, title: "Sync with main", cta: "Merge it in", desc: (i) => `Merges the latest ${i.main} into this pen, so Claude works on fresh code.` },
	{ id: "rebase-main", label: "Rebase on main", icon: Shuffle, title: "Rebase onto main", cta: "Rebase", desc: (i) => `Replays this pen's commits on top of ${i.main}. Cleaner history than a merge.` },
	{ id: "merge", label: "Merge into main", icon: GitMerge, title: "Merge into your repo", fields: ["message"], cta: "Merge",
		desc: (i) => `Commits, then merges this pen into ${i.main} in your real repo. The pen is kept.`,
		run: (t, f) => window.corral.merge({ id: alive(t), repo: t.repo, pen: t.pen, branch: t.branch, message: f.message }) },
	// ── undo ──
	{ id: "undo", label: "Undo commit", icon: Undo2, title: "Undo last commit", cta: "Undo", desc: () => "Removes the last commit but keeps its changes as uncommitted. Refuses if it's already pushed." },
	{ id: "stash", off: (i) => (i.dirty ? null : "Nothing to stash."), label: "Stash", icon: Archive, title: "Stash changes", fields: ["message"], cta: "Stash", desc: () => "Shelves every uncommitted change so the pen is clean. Pop it back anytime." },
	{ id: "stash-pop", label: "Pop stash", icon: ArchiveRestore, title: "Pop stash", cta: "Pop", hidden: (i) => i.stashes === 0, desc: (i) => `Brings back the latest of ${i.stashes} stash${i.stashes === 1 ? "" : "es"}.` },
	{ id: "discard", off: (i) => (i.dirty ? null : "Nothing to discard."), label: "Discard all", icon: RotateCcw, title: "Discard all changes", cta: "Discard everything", danger: true,
		desc: () => "Throws away every uncommitted change and new file in this pen. This can't be undone." },
	// ── ship / misc ──
	{ id: "history", label: "History", icon: History, title: "History", cta: "Close", desc: () => "" },
	{ id: "prs", label: "Pull requests", icon: GitPullRequest, title: "", cta: "", hidden: (i) => !i.remote, desc: () => "Every PR in this repo: checks, files, comments, merge." },
	{ id: "github", label: "Open on GitHub", icon: ExternalLink, title: "", cta: "", hidden: (i) => !i.web, desc: () => "" },
	{ id: "copy", label: "Copy branch", icon: Copy, title: "", cta: "", desc: () => "" },
	{ id: "delete", label: "Delete pen", icon: Trash2, title: "Delete this pen", cta: "Delete", danger: true,
		desc: () => "Stops the agent, removes the pen's folder and its local branch.",
		run: (t, _f, force) => window.corral.deletePen({ id: alive(t), repo: t.repo, pen: t.pen, branch: t.branch, force }) },
];
// grouped list (user's pick): one full-width primary, then small labelled groups
const GROUPS: [string, string[]][] = [
	["Sync", ["pull", "sync-main", "update-main", "fetch", "rebase-main"]],
	["Ship", ["pr", "prs", "merge", "github", "copy"]],
	["Save", ["commit", "amend", "push"]],
	["Undo", ["undo", "stash", "stash-pop", "discard", "history", "delete"]],
];

export function useGitInfo(pen: string) {
	const [info, setInfo] = useState<GitInfo | null>(null);
	const load = useCallback(() => window.corral.gitInfo(pen).then((i) => !i.error && setInfo(i)), [pen]);
	useEffect(() => {
		setInfo(null);
		load();
		const t = setInterval(load, 5000);
		return () => clearInterval(t);
	}, [load]);
	return [info, load] as const;
}

export function GitPanel({ thread, onDeleted }: { thread: Thread; onDeleted: () => void }) {
	const [info, reload] = useGitInfo(thread.pen);
	const [open, setOpen] = useState<Spec | null>(null);
	const [toast, setToast] = useState<{ text: string; url?: string; error?: boolean } | null>(null);
	useEffect(() => setToast(null), [thread.pen]);
	// this thread's PR, under the branch name. 20s refresh: watch checks go green without touching anything
	type MyPr = Pick<PrSummary, "number" | "title" | "state" | "url" | "isDraft" | "checks" | "headRefOid">;
	const [myPr, setMyPr] = useState<MyPr | null>(null);
	const [prWin, setPrWin] = useState<number | "list" | null>(null);
	useEffect(() => {
		let live = true;
		setMyPr(null);
		const load = () => window.corral.prForBranch(thread.pen).then((r) => live && !r.error && setMyPr(r.pr ?? null));
		load();
		const t = setInterval(load, 20_000);
		return () => {
			live = false;
			clearInterval(t);
		};
	}, [thread.pen]);
	if (!info) return <div className="git-panel" />;

	const click = (s: Spec) => {
		setToast(null);
		if (s.id === "github") return window.corral.openUrl(`${info.web}/tree/${info.upstream?.replace(/^origin\//, "") ?? info.branch}`);
		if (s.id === "prs") return setPrWin(myPr?.number ?? "list");
		if (s.id === "copy") {
			navigator.clipboard.writeText(info.branch);
			return setToast({ text: `Copied ${info.branch}` });
		}
		setOpen(s);
	};
	const byId = Object.fromEntries(
		ACTIONS.filter((a) => !a.hidden?.(info) && !(a.id === "pr" && myPr?.state === "OPEN")).map((a) => [a.id, a]),
	);
	// commits not on GitHub: vs the upstream when there is one, else "on no remote at all" (before the first push)
	const toPush = info.upstream ? info.ahead : info.unpushed;
	const upToDate = !info.dirty && toPush === 0;
	// DONE state: this thread's PR is merged and nothing happened since → the only thing left is cleaning up
	const merged = myPr?.state === "MERGED" && !info.dirty && myPr.headRefOid === info.head;
	const cp = byId["commit-push"];
	const cleanup = ACTIONS.find((a) => a.id === "cleanup")!;
	return (
		<div className="git-panel">
			<div className="git-head">
				<GitBranch size={13} strokeWidth={1.75} />
				<span className="git-branch mono" title={info.branch}>{info.upstream?.replace(/^origin\//, "") ?? info.branch}</span>
				{toPush > 0 && <span className="git-count" title={`${toPush} commit${toPush === 1 ? "" : "s"} not on GitHub yet`}>↑{toPush}</span>}
				{info.behind > 0 && <span className="git-count" title={`${info.behind} new on GitHub for this branch`}>↓{info.behind}</span>}
				{info.mainAhead > 0 && (
					<span className="git-count main" title={`${info.main} moved ahead by ${info.mainAhead}. Pushing to ${info.main} folds it in automatically; Sync with main brings it into this thread.`}>
						{info.main} +{info.mainAhead}
					</span>
				)}
				{!info.remote && <span className="git-local">local only</span>}
			</div>
			{myPr && (
				<button className={`git-pr s-${myPr.isDraft ? "DRAFT" : myPr.state}`} onClick={() => setPrWin(myPr.number)} title={myPr.title}>
					<GitPullRequest size={13} strokeWidth={1.75} />
					<span className="mono">#{myPr.number}</span>
					<span className="t">{myPr.title}</span>
					<CheckDot c={myPr.checks} />
					<em>{myPr.isDraft ? "draft" : myPr.state.toLowerCase()}</em>
				</button>
			)}
			{merged ? (
				<button className="git-main merged" onClick={() => click(cleanup)}>
					<CheckCircle2 size={15} strokeWidth={2} />
					Merged · Clean up
				</button>
			) : (
				<button className="git-main" onClick={() => click(cp)} disabled={upToDate || !info.remote} title={!info.remote ? "Connect GitHub first (Home screen)" : ""}>
					<cp.icon size={15} strokeWidth={2} />
					{upToDate ? "Up to date" : info.dirty ? "Commit & push" : `Push ${toPush} commit${toPush === 1 ? "" : "s"}`}
				</button>
			)}
			<div className="git-groups">
				{GROUPS.map(([name, ids]) => {
					const items = ids.map((id) => byId[id]).filter(Boolean);
					return (
						<section key={name}>
							<h4>{name}</h4>
							<div className="git-grid">
								{items.map((a) => (
									<button key={a.id} className={a.danger ? "danger" : ""} onClick={() => click(a)} disabled={!!a.off?.(info)} title={a.off?.(info) ?? (a.desc(info, thread) || a.label)}>
										<a.icon size={13} strokeWidth={1.75} />
										<span>{a.label}</span>
									</button>
								))}
							</div>
						</section>
					);
				})}
			</div>
			{toast && (
				<p className={`git-toast ${toast.error ? "err" : ""}`}>
					{toast.text}{" "}
					{toast.url && <button className="link" onClick={() => window.corral.openUrl(toast.url!)}>{toast.url.replace(/^https:\/\/github.com\//, "")}</button>}
				</p>
			)}
			{prWin !== null && (
				<PrModal
					pen={thread.pen}
					focus={prWin === "list" ? null : prWin}
					onClose={() => {
						setPrWin(null);
						reload();
						window.corral.prForBranch(thread.pen).then((r) => !r.error && setMyPr(r.pr ?? null));
					}}
				/>
			)}
			{open && (
				<ActionDialog
					spec={open}
					info={info}
					thread={thread}
					onClose={() => setOpen(null)}
					onDone={(r) => {
						setOpen(null);
						reload();
						if (open.id === "delete" || open.id === "cleanup") return onDeleted();
						setToast({ text: r.text ?? "Done.", url: r.url });
					}}
				/>
			)}
		</div>
	);
}

function ActionDialog({ spec, info, thread, onClose, onDone }: { spec: Spec; info: GitInfo; thread: Thread; onClose: () => void; onDone: (r: { text?: string; url?: string }) => void }) {
	const [message, setMessage] = useState(spec.fields?.includes("message") ? `corral: ${thread.task}` : "");
	const [branch, setBranch] = useState(spec.branch?.(info) ?? "");
	const [busy, setBusy] = useState<false | "run" | "ai">(false);
	const [err, setErr] = useState<string | null>(null);
	const [force, setForce] = useState(false); // delete: second click after the unmerged warning
	const history = spec.id === "history";

	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation(); // close only this dialog, not the file modal behind it
				onClose();
			}
		};
		window.addEventListener("keydown", k, true);
		return () => window.removeEventListener("keydown", k, true);
	}, [onClose]);

	async function ai() {
		setBusy("ai");
		setErr(null);
		const r = await window.corral.gitAiMessage(thread.pen);
		setBusy(false);
		if (r.error) setErr(r.error);
		else setMessage(r.text!);
	}
	async function go() {
		if (history) return onClose();
		setBusy("run");
		setErr(null);
		const r = spec.run ? await spec.run(thread, { message, branch }, force) : await window.corral.gitRun(thread.pen, spec.id, { message, branch });
		setBusy(false);
		if ("needsForce" in r && r.needsForce) {
			setForce(true);
			return setErr(`This pen has ${[r.dirty && "uncommitted changes", !r.merged && "work that isn't merged"].filter(Boolean).join(" and ")}. Deleting throws it away for good.`);
		}
		if (r.error) return setErr(r.error);
		onDone({ text: r.text ?? (spec.id === "merge" ? `Merged into ${info.main}.` : spec.id === "pr" ? "PR opened:" : undefined), url: r.url });
	}

	return (
		<div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<form className={`dialog ${history ? "wide" : ""}`} onSubmit={(e) => (e.preventDefault(), go())}>
				<header>
					<spec.icon size={16} strokeWidth={1.75} />
					<h3>{spec.title}</h3>
				</header>
				{!history && <p className="dialog-desc">{spec.desc(info, thread)}</p>}
				{history && (
					<ul className="history">
						{info.log.map((c) => (
							<li key={c.hash}>
								<span className="mono hash">{c.hash}</span>
								<span className="subject">{c.subject}</span>
								<span className="when">{c.when}</span>
							</li>
						))}
					</ul>
				)}
				{spec.fields?.includes("branch") && (
					<BranchPicker info={info} value={branch} onChange={setBranch} mode={spec.id === "pull" ? "pull" : "push"} />
				)}
				{spec.fields?.includes("message") && (
					<label className="field">
						<span>
							{spec.id === "pr" ? "Title" : spec.id === "stash" ? "Name" : "Message"}
							<button type="button" className="ai" onClick={ai} disabled={!!busy} title="Let Claude write it from the diff">
								<Sparkles size={12} strokeWidth={1.75} />
								{busy === "ai" ? "Writing…" : "Write it for me"}
							</button>
						</span>
						<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} autoFocus spellCheck={false} />
					</label>
				)}
				{err && <p className="dialog-err">{err}</p>}
				<footer>
					{!history && (
						<button type="button" onClick={onClose} disabled={!!busy}>
							Cancel
						</button>
					)}
					<button type="submit" className={`primary ${spec.danger ? "danger" : ""}`} disabled={!!busy}>
						{busy === "run" ? "Working…" : force ? "Delete anyway" : spec.cta}
					</button>
				</footer>
			</form>
		</div>
	);
}

// plain folder → git → GitHub. lives under the composer: only shows what's missing for the picked repo
export function RepoSetup({ repo }: { repo: string | null }) {
	const [info, setInfo] = useState<Awaited<ReturnType<typeof window.corral.repoInfo>> | null>(null);
	const [name, setName] = useState("");
	const [visibility, setVisibility] = useState<"private" | "public">("private");
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ text: string; url?: string | null; error?: boolean } | null>(null);
	const load = useCallback(() => {
		if (repo) window.corral.repoInfo(repo).then(setInfo);
	}, [repo]);
	useEffect(() => {
		setInfo(null);
		setMsg(null);
		setName(repo?.split("/").pop()?.replace(/[^A-Za-z0-9._-]+/g, "-") ?? "");
		load();
	}, [repo, load]);
	if (!repo || !info || info.error) return null;
	if (info.isGit && info.hasCommit && info.remote) return null;

	const act = async (p: Promise<{ ok?: true; text?: string; url?: string | null; error?: string }>) => {
		setBusy(true);
		setMsg(null);
		const r = await p;
		setBusy(false);
		setMsg(r.error ? { text: r.error, error: true } : { text: r.text ?? "Done.", url: r.url });
		load();
	};
	const needsGit = !info.isGit || !info.hasCommit;
	return (
		<div className="repo-setup">
			{needsGit ? (
				<>
					<div>
						<b>{info.isGit ? "This repo has no commits yet." : "This folder isn't a git repo yet."}</b>
						<p>Corral gives every agent its own copy of your code through git. Init adds a .gitignore (node_modules, .env, builds) and makes the first commit.</p>
					</div>
					<button className="primary" disabled={busy} onClick={() => act(window.corral.repoInit(repo))}>
						<GitBranch size={14} strokeWidth={1.75} />
						{busy ? "Setting up…" : "Init git"}
					</button>
				</>
			) : (
				<>
					<div>
						<b>Not on GitHub yet.</b>
						<p>Creates the repo on your GitHub account and pushes. Unlocks push, pull and PRs.</p>
						<div className="repo-gh-row">
							<input className="mono" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="Repo name" />
							<div className="seg">
								<button className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>Private</button>
								<button className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>Public</button>
							</div>
						</div>
					</div>
					<button className="primary" disabled={busy || !name} onClick={() => act(window.corral.repoGitHub(repo, name, visibility))}>
						<GitHubMark />
						{busy ? "Creating…" : "Create on GitHub"}
					</button>
				</>
			)}
			{msg && (
				<p className={`repo-msg ${msg.error ? "err" : ""}`}>
					{msg.text}{" "}
					{msg.url && <button className="link" onClick={() => window.corral.openUrl(msg.url!)}>{msg.url.replace(/^https:\/\//, "")}</button>}
				</p>
			)}
		</div>
	);
}

// GitHub's mark (Octicons, MIT): lucide dropped brand logos
export function GitHubMark({ size = 14 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

// a real list of choices, not an <input list>: a datalist only suggests what matches the typed text, so a
// prefilled branch name hid every other option (that's how "main" went missing)
function BranchPicker({ info, value, onChange, mode }: { info: GitInfo; value: string; onChange: (b: string) => void; mode: "push" | "pull" }) {
	const mine = info.branch;
	const known = new Set([info.main, mine, ...info.branches]);
	const [custom, setCustom] = useState(!known.has(value) && value !== "");
	const others = info.branches.filter((b) => b !== info.main && b !== mine);
	const opts: { b: string; label: string; note?: string }[] = [
		{ b: info.main, label: info.main, note: mode === "push" ? "straight into main" : "the main branch" },
		...(mode === "push" ? [{ b: mine, label: mine, note: "this thread's branch" }] : info.branches.includes(mine) ? [{ b: mine, label: mine, note: "this thread's branch" }] : []),
		...others.map((b) => ({ b, label: b })),
	];
	return (
		<div className="field">
			<span>{mode === "pull" ? "Pull from" : "Push to"}</span>
			<div className="branch-list" role="radiogroup">
				{opts.map((o) => (
					<button type="button" key={o.b} role="radio" aria-checked={!custom && value === o.b} className={!custom && value === o.b ? "on" : ""} onClick={() => (setCustom(false), onChange(o.b))}>
						<GitBranch size={13} strokeWidth={1.75} />
						<span className="mono">{o.label}</span>
						{o.note && <em>{o.note}</em>}
					</button>
				))}
				{mode === "push" && (
					<button type="button" role="radio" aria-checked={custom} className={custom ? "on" : ""} onClick={() => (setCustom(true), onChange(""))}>
						<span className="plus">＋</span>
						<span>New branch…</span>
					</button>
				)}
			</div>
			{custom && <input className="mono" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="new-branch-name" autoFocus spellCheck={false} />}
		</div>
	);
}
