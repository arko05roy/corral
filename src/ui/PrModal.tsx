// pull requests without leaving the app: list + detail in a blurred floating window (user's ask).
// everything goes through gh in main.ts; nothing here talks to GitHub directly.
import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, MessageSquare, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FileIcon } from "./FileIcon";
import { Markdown } from "./Markdown";
import type { Checks, PrDetail, PrState, PrSummary } from "./terms";

const STATES: { id: PrState; label: string }[] = [
	{ id: "open", label: "Open" },
	{ id: "merged", label: "Merged" },
	{ id: "closed", label: "Closed" },
];
const METHOD_LABEL = { squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" } as const;

export function PrModal({ pen, focus, onClose }: { pen: string; focus: number | null; onClose: () => void }) {
	const [state, setState] = useState<PrState>("open");
	const [list, setList] = useState<PrSummary[] | null>(null);
	const [listErr, setListErr] = useState<string | null>(null);
	const [sel, setSel] = useState<number | null>(focus);

	const loadList = useCallback(() => {
		setListErr(null);
		window.corral.prList(pen, state).then((r) => {
			if (r.error) return setListErr(r.error);
			setList(r.prs!);
			setSel((s) => s ?? r.prs![0]?.number ?? null);
		});
	}, [pen, state]);
	useEffect(() => {
		setList(null);
		loadList();
	}, [loadList]);

	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation(); // close only this window, not the file modal behind it
			onClose();
		};
		window.addEventListener("keydown", k, true);
		return () => window.removeEventListener("keydown", k, true);
	}, [onClose]);

	return (
		<div className="modal-backdrop pr-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<aside className="pr-list">
				<header>
					<GitPullRequest size={15} strokeWidth={1.75} />
					<h3>Pull requests</h3>
					<button className="icon-btn" onClick={onClose} aria-label="Close">
						<X size={14} />
					</button>
				</header>
				<div className="seg pr-states">
					{STATES.map((s) => (
						<button key={s.id} className={state === s.id ? "on" : ""} onClick={() => setState(s.id)}>
							{s.label}
						</button>
					))}
				</div>
				{listErr && <p className="pr-err">{listErr}</p>}
				{list && !list.length && <p className="quiet">No {state} pull requests.</p>}
				<ul>
					{list?.map((p) => (
						<li key={p.number}>
							<button className={sel === p.number ? "on" : ""} onClick={() => setSel(p.number)}>
								<StateIcon pr={p} />
								<div className="pr-row">
									<span className="pr-title">{p.title}</span>
									<span className="pr-meta">
										#{p.number} · <span className="mono">{p.headRefName}</span> → <span className="mono">{p.baseRefName}</span>
									</span>
								</div>
								<div className="pr-side">
									<CheckDot c={p.checks} />
									<span className="pr-diff">
										<b className="add">+{p.additions}</b> <b className="del">−{p.deletions}</b>
									</span>
								</div>
							</button>
						</li>
					))}
				</ul>
			</aside>
			<section className="pr-detail">
				{sel ? <PrView key={sel} pen={pen} num={sel} onChanged={loadList} /> : <p className="quiet pr-empty">Pick a pull request.</p>}
			</section>
		</div>
	);
}

function PrView({ pen, num, onChanged }: { pen: string; num: number; onChanged: () => void }) {
	const [pr, setPr] = useState<PrDetail | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [method, setMethod] = useState<string>("squash");
	const [del, setDel] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const [comment, setComment] = useState("");

	const load = useCallback(
		() =>
			window.corral.prView(pen, num).then((r) => {
				if (r.error) return setErr(r.error);
				setPr(r.pr!);
				setMethod((m) => (r.pr!.methods.includes(m as never) ? m : r.pr!.methods[0]));
			}),
		[pen, num],
	);
	useEffect(() => {
		load();
	}, [load]);

	async function act(name: string, p: Promise<{ ok?: true; text?: string; error?: string }>) {
		setBusy(name);
		setErr(null);
		setDone(null);
		const r = await p;
		setBusy(null);
		if (r.error) return setErr(r.error);
		setDone(r.text ?? "Done.");
		if (name === "comment") setComment("");
		await load();
		onChanged();
	}

	if (!pr) return <div className="pr-view">{err ? <p className="pr-err">{err}</p> : <p className="quiet">Loading #{num}…</p>}</div>;

	// why the merge button is off, in words (not just a grey button)
	const blocker =
		pr.state !== "OPEN" ? null
		: !pr.canMerge ? "You don't have permission to merge here."
		: pr.isDraft ? "Draft: mark it ready for review first."
		: pr.mergeable === "CONFLICTING" ? "Conflicts with the base branch: sync it first."
		: pr.checks.fail > 0 ? `${pr.checks.fail} check${pr.checks.fail === 1 ? "" : "s"} failing.`
		: pr.checks.pending > 0 ? "Checks are still running." : null;
	const hardBlock = pr.state !== "OPEN" || !pr.canMerge || pr.isDraft || pr.mergeable === "CONFLICTING";

	return (
		<div className="pr-view">
			<header className="pr-head">
				<div>
					<h2>
						{pr.title} <span className="pr-num">#{pr.number}</span>
					</h2>
					<p className="pr-meta">
						<span className={`pr-badge s-${pr.isDraft ? "DRAFT" : pr.state}`}>{pr.isDraft ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase()}</span>
						<b>{pr.author}</b> wants to merge {pr.commits} commit{pr.commits === 1 ? "" : "s"} into <span className="mono">{pr.baseRefName}</span> from{" "}
						<span className="mono">{pr.headRefName}</span>
					</p>
				</div>
				<button className="ghost" onClick={() => window.corral.openUrl(pr.url)}>
					<ExternalLink size={13} /> GitHub
				</button>
			</header>

			<div className="pr-body">
				{pr.body?.trim() && (
					<div className="pr-desc">
						<Markdown text={pr.body} />
					</div>
				)}

				<h4>Checks</h4>
				{pr.checkList.length ? (
					<ul className="pr-checks">
						{pr.checkList.map((c, i) => (
							<li key={i}>
								<span className={`v v-${c.verdict}`}>{c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : c.verdict === "pending" ? "●" : "–"}</span>
								<span>{c.name}</span>
								{c.url && (
									<button className="link-quiet" onClick={() => window.corral.openUrl(c.url!)}>
										details
									</button>
								)}
							</li>
						))}
					</ul>
				) : (
					<p className="quiet">No checks on this PR.</p>
				)}

				<h4>
					Files changed <span className="count">{pr.files.length}</span>
				</h4>
				<ul className="pr-files">
					{pr.files.map((f) => (
						<li key={f.path}>
							<FileIcon path={f.path} size={14} />
							<span className="mono">{f.path}</span>
							<span className="pr-diff">
								<b className="add">+{f.additions}</b> <b className="del">−{f.deletions}</b>
							</span>
						</li>
					))}
				</ul>

				<h4>
					Conversation <span className="count">{pr.comments.length}</span>
				</h4>
				{pr.comments.map((c, i) => (
					<Comment key={i} c={c} />
				))}
				{pr.state === "OPEN" && (
					<div className="pr-reply">
						<textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Leave a comment…" rows={2} />
						<button disabled={!comment.trim() || !!busy} onClick={() => act("comment", window.corral.prAct(pen, num, "comment", comment))}>
							<MessageSquare size={13} /> {busy === "comment" ? "Posting…" : "Comment"}
						</button>
					</div>
				)}
			</div>

			<footer className="pr-foot">
				{err && <p className="pr-err">{err}</p>}
				{done && <p className="pr-done">{done}</p>}
				{pr.state === "OPEN" ? (
					<>
						{blocker && <p className={`pr-block ${hardBlock ? "hard" : ""}`}>{blocker}</p>}
						<div className="pr-actions">
							<button className="ghost danger" disabled={!!busy} onClick={() => act("close", window.corral.prAct(pen, num, "close"))}>
								{busy === "close" ? "Closing…" : "Close PR"}
							</button>
							{pr.isDraft && (
								<button className="ghost" disabled={!!busy} onClick={() => act("ready", window.corral.prAct(pen, num, "ready"))}>
									{busy === "ready" ? "…" : "Ready for review"}
								</button>
							)}
							<span className="spacer" />
							<label className="pr-del">
								<input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} /> delete branch
							</label>
							<select value={method} onChange={(e) => setMethod(e.target.value)} disabled={!!busy}>
								{pr.methods.map((m) => (
									<option key={m} value={m}>
										{METHOD_LABEL[m]}
									</option>
								))}
							</select>
							<button className="primary" disabled={hardBlock || !!busy} onClick={() => act("merge", window.corral.prMerge(pen, num, method, del))}>
								<GitMerge size={14} /> {busy === "merge" ? "Merging…" : "Merge"}
							</button>
						</div>
					</>
				) : pr.state === "CLOSED" ? (
					<div className="pr-actions">
						<span className="spacer" />
						<button className="ghost" disabled={!!busy} onClick={() => act("reopen", window.corral.prAct(pen, num, "reopen"))}>
							{busy === "reopen" ? "…" : "Reopen PR"}
						</button>
					</div>
				) : (
					<p className="pr-done">Merged. 🎉</p>
				)}
			</footer>
		</div>
	);
}

function StateIcon({ pr }: { pr: Pick<PrSummary, "state" | "isDraft"> }) {
	if (pr.isDraft) return <GitPullRequestDraft className="si s-DRAFT" size={15} strokeWidth={1.75} />;
	if (pr.state === "MERGED") return <GitMerge className="si s-MERGED" size={15} strokeWidth={1.75} />;
	if (pr.state === "CLOSED") return <GitPullRequestClosed className="si s-CLOSED" size={15} strokeWidth={1.75} />;
	return <GitPullRequest className="si s-OPEN" size={15} strokeWidth={1.75} />;
}

export function CheckDot({ c }: { c: Checks }) {
	if (!c.total) return null;
	const v = c.fail ? "fail" : c.pending ? "pending" : "pass";
	return <span className={`dotv v-${v}`} title={`${c.pass}/${c.total} checks passing${c.fail ? `, ${c.fail} failing` : ""}${c.pending ? `, ${c.pending} running` : ""}`} />;
}

// bots (vercel, github-actions…) collapse to one line: they're noise most of the time
function Comment({ c }: { c: PrDetail["comments"][number] }) {
	const [open, setOpen] = useState(!c.bot);
	const when = new Date(c.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	return (
		<div className={`pr-comment ${c.bot ? "bot" : ""}`}>
			<button className="pr-meta pr-comment-head" onClick={() => c.bot && setOpen((o) => !o)} disabled={!c.bot}>
				<b>{c.author}</b>
				{c.bot && <span className="pr-badge">bot</span>}
				{c.state && c.state !== "COMMENTED" && <span className={`pr-badge s-${c.state}`}>{c.state.toLowerCase().replace("_", " ")}</span>}
				<span>· {when}</span>
				{c.bot && <em>{open ? "hide" : "show"}</em>}
			</button>
			{open && (
				<div className="pr-desc">
					<Markdown text={c.body} />
				</div>
			)}
		</div>
	);
}
