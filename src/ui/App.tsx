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
	SquarePen,
	Terminal as TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fitTerm, getTerm, openTerm, type Thread } from "./terms";

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
		upsert([{ ...t, alive: true }]);
		setActive(t.pen);
	};

	async function select(t: Thread) {
		setActive(t.pen);
		if (t.id === null) {
			const { id } = await window.corral.resume(t.pen);
			upsert([{ ...t, id, alive: true }]);
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
					<Hills className="foot-hills" />
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
							{filesOpen && <Files pen={current.pen} />}
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
								className={`thread ${t.pen === props.active ? "active" : ""} ${t.alive ? "alive" : t.id === null ? "dormant" : "dead"}`}
								onClick={() => props.onSelect(t)}
								title={t.id === null ? `${t.branch} · click to resume` : t.branch}
							>
								<span className="lamp" aria-label={t.alive ? "agent running" : "agent not running"} />
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
		const res = await window.corral.newThread(props.repo, text);
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
				<Hills className="hero-hills" />
				<h1>What's the next job?</h1>
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

function Files({ pen }: { pen: string }) {
	const [data, setData] = useState<Awaited<ReturnType<typeof window.corral.files>> | null>(null);
	const [tab, setTab] = useState<"changes" | "files">("changes");

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
		</aside>
	);
}

// Engraved hills: hatched ridge lines, straight out of the prairie etching.
function Hills({ className }: { className?: string }) {
	const lines = Array.from({ length: 22 }, (_, i) => i);
	return (
		<svg className={className} viewBox="0 0 240 70" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
			<defs>
				<clipPath id={`hills-${className}`}>
					<path d="M0 46 Q30 30 58 40 T120 36 Q150 22 172 18 Q196 14 214 30 T240 34 V70 H0Z" />
				</clipPath>
			</defs>
			<g clipPath={`url(#hills-${className})`} stroke="currentColor" strokeWidth="0.8" opacity="0.7" fill="none">
				{lines.map((i) => (
					<path key={i} d={`M-10 ${16 + i * 2.6} Q60 ${12 + i * 2.6} 130 ${18 + i * 2.6} T260 ${14 + i * 2.6}`} />
				))}
			</g>
			<path
				d="M0 46 Q30 30 58 40 T120 36 Q150 22 172 18 Q196 14 214 30 T240 34"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.3"
			/>
		</svg>
	);
}
