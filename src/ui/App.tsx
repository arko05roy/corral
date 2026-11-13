import {
	ArrowUp,
	ChevronDown,
	ChevronRight,
	FileText,
	Folder,
	FolderPlus,
	GitBranch,
	Lightbulb,
	PanelRight,
	Plus,
	Square,
	SquarePen,
	Terminal as TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bornAtSize, fitTerm, getTerm, lastSize, openTerm, type Thread } from "./terms";

const repoName = (p: string) => p.split("/").pop() ?? p;

export function App() {
	const [workspaces, setWorkspaces] = useState<string[]>([]);
	const [threads, setThreads] = useState<Thread[]>([]);
	const [active, setActive] = useState<string | null>(null); // pen path; null = composer home
	const [homeRepo, setHomeRepo] = useState<string | null>(null);
	const [filesOpen, setFilesOpen] = useState(true);

	const upsert = (incoming: Thread[]) =>
		setThreads((ts) => {
			const byPen = new Map(ts.map((t) => [t.pen, t]));
			for (const t of incoming) byPen.set(t.pen, { ...byPen.get(t.pen), ...t });
			return [...byPen.values()];
		});

	const addWorkspace = async (repo: string) => {
		setWorkspaces((ws) => (ws.includes(repo) ? ws : [...ws, repo]));
		setHomeRepo((r) => r ?? repo);
		try {
			const old = await window.corral.listPens(repo);
			setThreads((ts) => {
				const known = new Set(ts.map((t) => t.pen));
				return [...ts, ...old.filter((p) => !known.has(p.pen)).map((p) => ({ ...p, id: null, alive: false }))];
			});
		} catch {}
	};

	const addThread = (t: Thread) => {
		addWorkspace(t.repo);
		upsert([{ ...t, alive: true, state: t.state ?? "working" }]); // daemon tells us the state on re-attach
		setActive(t.pen);
	};

	async function select(t: Thread) {
		setActive(t.pen);
		if (!t.alive) {
			// dormant (never ran this session) or dead (exited/killed): either way, wake it with --continue
			const size = lastSize;
			const { id } = await window.corral.resume({ repo: t.repo, task: t.task, branch: t.branch, pen: t.pen }, size);
			if (size) bornAtSize.add(id);
			upsert([{ ...t, id, alive: true, state: "waiting" }]); // resumed = sitting at the prompt
		}
	}

	async function pickRepo() {
		const repo = await window.corral.pickRepo();
		if (repo) {
			addWorkspace(repo);
			setHomeRepo(repo);
		}
	}

	useEffect(() => {
		const offs = [
			window.corral.on("workspace", addWorkspace),
			window.corral.on("thread", addThread),
			window.corral.on("out", ({ id, text }) => getTerm(id).write(text)),
			window.corral.on("status", ({ id, state }) =>
				setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, state } : t))),
			),
			window.corral.on("exited", ({ id }) =>
				setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, alive: false } : t))),
			),
		];
		return () => offs.forEach((off) => off());
	}, []);

	const current = threads.find((t) => t.pen === active);

	return (
		<div className="app">
			<aside className="side">
				<div className="drag" />
				<button className="new-thread-btn" onClick={() => setActive(null)}>
					<SquarePen size={15} strokeWidth={1.75} />
					New thread
				</button>

				<div className="section-label">
					<span>Repos</span>
					<button className="icon-btn" onClick={pickRepo} title="Add repo" aria-label="Add repo">
						<FolderPlus size={14} strokeWidth={1.75} />
					</button>
				</div>

				<nav className="repos">
					{workspaces.length === 0 && <p className="hint">Add a repo to see its threads here.</p>}
					{workspaces.map((repo) => (
						<RepoGroup
							key={repo}
							repo={repo}
							threads={threads.filter((t) => t.repo === repo)}
							active={active}
							onSelect={select}
							onNew={() => {
								setHomeRepo(repo);
								setActive(null);
							}}
						/>
					))}
				</nav>

				<footer className="side-foot">
					<span className="wordmark">Corral</span>
				</footer>
			</aside>

			<main className="main">
				{current ? (
					<>
						<header className="topbar">
							<span className="task">{current.task}</span>
							<span className="chip mono">
								<GitBranch size={12} strokeWidth={1.75} />
								{current.branch}
							</span>
							<span className="spacer" />
							{current.alive && current.id !== null && (
								<button
									className="icon-btn"
									onClick={() => window.corral.kill(current.id!)}
									title="Stop agent (pen is kept; click the thread to resume)"
									aria-label="Stop agent"
								>
									<Square size={13} strokeWidth={1.75} />
								</button>
							)}
							<button
								className={`icon-btn ${filesOpen ? "on" : ""}`}
								onClick={() => setFilesOpen((o) => !o)}
								title="Toggle files"
								aria-label="Toggle files"
							>
								<PanelRight size={15} strokeWidth={1.75} />
							</button>
						</header>
						<div className="workarea">
							<div className="sky">
								{threads
									.filter((t) => t.id !== null)
									.map((t) => (
										<Screen key={t.id} id={t.id!} shown={t.pen === active} />
									))}
							</div>
							{filesOpen && (
								<Files
									thread={current}
									onDeleted={() => {
										setThreads((ts) => ts.filter((t) => t.pen !== current.pen));
										setActive(null); // back to composer home: the pen no longer exists
									}}
								/>
							)}
						</div>
					</>
				) : (
					<Home
						repos={workspaces}
						repo={homeRepo}
						setRepo={setHomeRepo}
						onAddRepo={pickRepo}
						onCreated={addThread}
					/>
				)}
			</main>
		</div>
	);
}

function RepoGroup(props: {
	repo: string;
	threads: Thread[];
	active: string | null;
	onSelect: (t: Thread) => void;
	onNew: () => void;
}) {
	const [open, setOpen] = useState(true);
	const Chevron = open ? ChevronDown : ChevronRight;
	return (
		<section className="repo">
			<div className="repo-row">
				<button className="repo-name" onClick={() => setOpen((o) => !o)} title={props.repo}>
					<Chevron size={13} strokeWidth={1.75} className="chev" />
					<Folder size={14} strokeWidth={1.75} />
					<span>{repoName(props.repo)}</span>
				</button>
				<button className="icon-btn" onClick={props.onNew} title="New thread in this repo" aria-label="New thread in this repo">
					<Plus size={14} strokeWidth={1.75} />
				</button>
			</div>
			{open && (
				<ul>
					{props.threads.map((t) => (
						<li key={t.pen}>
							<button
								className={`thread ${t.pen === props.active ? "active" : ""} ${t.alive ? `alive ${t.state ?? ""}` : t.id === null ? "dormant" : "dead"}`}
								onClick={() => props.onSelect(t)}
								title={t.alive ? t.branch : `${t.branch} · click to resume`}
							>
								<span className="lamp" aria-label={!t.alive ? "agent not running" : t.state === "waiting" ? "needs you" : "working"} />
								<span className="name">{t.task}</span>
							</button>
						</li>
					))}
					{props.threads.length === 0 && <li className="hint small">No threads yet.</li>}
				</ul>
			)}
		</section>
	);
}

const SUGGESTIONS = [
	"Walk me through how this repo is put together",
	"Find one flaky test and make it reliable",
	"Tighten error messages users actually see",
];

function Home(props: {
	repos: string[];
	repo: string | null;
	setRepo: (r: string) => void;
	onAddRepo: () => void;
	onCreated: (t: Thread) => void;
}) {
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const box = useRef<HTMLTextAreaElement>(null);

	useEffect(() => box.current?.focus(), []);

	async function start() {
		const text = prompt.trim();
		if (!text || busy) return;
		if (!props.repo) return setError("Add a repo first, then start the thread.");
		setBusy(true);
		const size = lastSize; // born at the real panel size (Paradev: spawn with the measured xterm cols/rows)
		const res = await window.corral.newThread(props.repo, text, size);
		if (size && !("error" in res) && res.id !== null) bornAtSize.add(res.id);
		setBusy(false);
		if ("error" in res) return setError(res.error.split("\n")[0]);
		setPrompt("");
		setError("");
		props.onCreated(res);
	}

	return (
		<div className="home">
			<div className="drag top" />
			<div className="hero">
				<div className="hero-mark">
					<TerminalIcon size={26} strokeWidth={1.5} />
				</div>
				<h1>What's the next task?</h1>
			</div>

			<div className="composer-wrap">
				<ul className="suggestions">
					{SUGGESTIONS.map((s) => (
						<li key={s}>
							<button onClick={() => (setPrompt(s), box.current?.focus())}>
								<Lightbulb size={14} strokeWidth={1.75} />
								{s}
							</button>
						</li>
					))}
				</ul>

				<div className="composer">
					<textarea
						ref={box}
						value={prompt}
						rows={3}
						placeholder="Describe the task. Each thread gets its own branch and its own agent."
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								start();
							}
						}}
					/>
					<div className="composer-bar">
						<span className="chip">
							<TerminalIcon size={12} strokeWidth={1.75} />
							claude
						</span>
						{props.repos.length > 0 ? (
							<label className="chip select">
								<Folder size={12} strokeWidth={1.75} />
								<select value={props.repo ?? ""} onChange={(e) => props.setRepo(e.target.value)}>
									{props.repos.map((r) => (
										<option key={r} value={r}>
											{repoName(r)}
										</option>
									))}
								</select>
								<ChevronDown size={12} strokeWidth={1.75} />
							</label>
						) : (
							<button className="chip" onClick={props.onAddRepo}>
								<FolderPlus size={12} strokeWidth={1.75} />
								Add a repo
							</button>
						)}
						<span className="spacer" />
						<button className="send" onClick={start} disabled={busy || !prompt.trim()} aria-label="Start thread">
							<ArrowUp size={16} strokeWidth={2} />
						</button>
					</div>
				</div>
				<p className={`composer-note ${error ? "error" : ""}`}>
					{error || (busy ? "Creating the branch and starting the agent…" : "⏎ to start · ⇧⏎ for a new line")}
				</p>
			</div>
		</div>
	);
}

function Screen({ id, shown }: { id: number; shown: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		openTerm(id, ref.current!);
	}, [id]);
	useEffect(() => {
		if (!shown) return; // hidden panels are 0×0, never fit those
		fitTerm(id);
		getTerm(id).focus();
		const ro = new ResizeObserver(() => fitTerm(id)); // window drag, files panel toggle…
		ro.observe(ref.current!);
		return () => ro.disconnect();
	}, [shown, id]);
	return <div ref={ref} className={`screen ${shown ? "shown" : ""}`} />;
}

type Tree = { [name: string]: Tree };

function buildTree(paths: string[]): Tree {
	const root: Tree = {};
	for (const p of paths) {
		let node = root;
		for (const part of p.split("/")) node = node[part] ??= {};
	}
	return root;
}

const sortKids = (node: Tree) =>
	Object.keys(node).sort((a, b) => {
		const ad = Object.keys(node[a]).length > 0,
			bd = Object.keys(node[b]).length > 0;
		return ad === bd ? a.localeCompare(b) : ad ? -1 : 1; // folders first
	});

function TreeNode({ name, node, depth }: { name: string; node: Tree; depth: number }) {
	const [open, setOpen] = useState(false);
	const kids = sortKids(node);
	const pad = { paddingLeft: 12 + depth * 14 };
	if (kids.length === 0)
		return (
			<li className="row" style={pad}>
				<FileText size={13} strokeWidth={1.5} />
				<span>{name}</span>
			</li>
		);
	const Chevron = open ? ChevronDown : ChevronRight;
	return (
		<li>
			<button className="row" style={pad} onClick={() => setOpen((o) => !o)}>
				<Chevron size={12} strokeWidth={1.75} />
				<span>{name}</span>
			</button>
			{open && <ul>{kids.map((k) => <TreeNode key={k} name={k} node={node[k]} depth={depth + 1} />)}</ul>}
		</li>
	);
}

function Files({ thread, onDeleted }: { thread: Thread; onDeleted: () => void }) {
	const pen = thread.pen;
	const [data, setData] = useState<Awaited<ReturnType<typeof window.corral.files>> | null>(null);
	const [tab, setTab] = useState<"changes" | "files">("changes");
	// pen actions. mode: which box is open. merge/pr = review changes + edit commit message, then confirm
	const [mode, setMode] = useState<null | "merge" | "pr" | "delete">(null);
	const [msg, setMsg] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [done, setDone] = useState<{ text: string; url?: string } | null>(null);
	const [warn, setWarn] = useState<string | null>(null); // delete: unmerged/dirty → needs a second click
	useEffect(() => {
		setMode(null);
		setErr(null);
		setDone(null);
		setWarn(null);
	}, [pen]);

	const id = thread.alive ? thread.id : null;
	const open = (m: "merge" | "pr") => {
		setTab("changes");
		setMsg(`corral: ${thread.task}`);
		setErr(null);
		setDone(null);
		setMode(m);
	};
	async function run<T extends { error?: string }>(p: Promise<T>) {
		setBusy(true);
		setErr(null);
		const r = await p;
		setBusy(false);
		if (r.error) setErr(r.error);
		return r;
	}
	async function confirm() {
		const message = msg.trim() || `corral: ${thread.task}`;
		if (mode === "merge") {
			const r = await run(window.corral.merge({ id, repo: thread.repo, pen, branch: thread.branch, message }));
			if (r.ok) setDone({ text: `Merged ${thread.branch} into your current branch.` });
		} else if (mode === "pr") {
			const r = await run(window.corral.openPr({ pen, branch: thread.branch, message }));
			if (r.ok) setDone({ text: "PR opened:", url: r.url });
		}
		setMode(null);
	}
	async function del(force: boolean) {
		setMode("delete");
		const r = await run(window.corral.deletePen({ id, repo: thread.repo, pen, branch: thread.branch, force }));
		if (r.needsForce) {
			setWarn(
				[r.dirty && "uncommitted changes", !r.merged && "work not merged into your current branch"].filter(Boolean).join(" and ") +
					". Deleting throws it away for good.",
			);
		} else if (r.ok) onDeleted();
	}

	useEffect(() => {
		let live = true;
		const load = () => window.corral.files(pen).then((d) => live && setData(d));
		load();
		const timer = setInterval(load, 2000); // only the thread you're looking at
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [pen]);

	const tree = buildTree(data?.all ?? []);
	const n = data?.changed.length ?? 0;
	return (
		<aside className="files">
			<div className="tabs">
				<button className={tab === "changes" ? "on" : ""} onClick={() => setTab("changes")}>
					Changes{n > 0 && <span className="count">{n}</span>}
				</button>
				<button className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>
					Files
				</button>
			</div>
			{tab === "changes" ? (
				n ? (
					<ul className="changed">
						{data!.changed.map((f) => (
							<li key={f.path} className="row" title={f.path}>
								<span className="path">{f.path}</span>
								<span className={`badge s-${f.status[0]}`}>{f.status[0]}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="quiet">The agent hasn't changed anything yet.</p>
				)
			) : (
				<ul className="tree">
					{sortKids(tree).map((k) => (
						<TreeNode key={k} name={k} node={tree[k]} depth={0} />
					))}
				</ul>
			)}
			<div className="merge">
				{done && (
					<p className="quiet">
						{done.text}{" "}
						{done.url && (
							<a href={done.url} target="_blank" rel="noreferrer">
								{done.url.replace(/^https:\/\/github.com\//, "")}
							</a>
						)}
					</p>
				)}
				{err && <p className="merge-err">{err}</p>}
				{mode === "merge" || mode === "pr" ? (
					<>
						<p className="quiet">
							Commits {n || "no"} change{n === 1 ? "" : "s"} above, then{" "}
							{mode === "merge" ? (
								<>merges <b>{thread.branch}</b> into your repo's current branch. The pen is kept.</>
							) : (
								<>pushes <b>{thread.branch}</b> and opens a PR on GitHub.</>
							)}
						</p>
						<textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} disabled={busy} />
						<div className="merge-row">
							<button onClick={() => setMode(null)} disabled={busy}>Cancel</button>
							<button className="merge-btn" onClick={confirm} disabled={busy}>
								{busy ? "Working…" : mode === "merge" ? "Merge" : "Open PR"}
							</button>
						</div>
					</>
				) : mode === "delete" && warn ? (
					<>
						<p className="merge-err">This pen has {warn}</p>
						<div className="merge-row">
							<button onClick={() => { setMode(null); setWarn(null); }} disabled={busy}>Cancel</button>
							<button className="merge-btn danger" onClick={() => del(true)} disabled={busy}>
								{busy ? "Deleting…" : "Delete anyway"}
							</button>
						</div>
					</>
				) : (
					<div className="merge-row">
						<button className="merge-btn" onClick={() => open("merge")} disabled={busy}>Merge</button>
						<button className="merge-btn" onClick={() => open("pr")} disabled={busy}>Open PR</button>
						<button className="merge-btn danger" onClick={() => del(false)} disabled={busy}>
							{busy ? "…" : "Delete"}
						</button>
					</div>
				)}
			</div>
		</aside>
	);
}

