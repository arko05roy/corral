import {
	ArrowUp,
	ChevronDown,
	ChevronRight,
	Folder,
	FolderPlus,
	GitBranch,
	Lightbulb,
	PanelRight,
	Plus,
	Square,
	SquarePen,
	Terminal as TerminalIcon,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CodeView } from "./CodeView";
import { FileIcon, FolderIcon } from "./FileIcon";
import { GitPanel, RepoSetup } from "./git";
import { bornAtSize, fitTerm, getTerm, lastSize, onCwd, openTerm, type Thread } from "./terms";

const repoName = (p: string) => p.split("/").pop() ?? p;

export function App() {
	const [workspaces, setWorkspaces] = useState<string[]>([]);
	const [threads, setThreads] = useState<Thread[]>([]);
	const [active, setActive] = useState<string | null>(null); // pen path; null = composer home
	const [homeRepo, setHomeRepo] = useState<string | null>(null);
	const [filesOpen, setFilesOpen] = useState(true);
	// open file tabs, per pen: switching threads brings back that thread's tabs. active null = the terminal
	const [tabs, setTabs] = useState<Record<string, { open: string[]; active: string | null }>>({});
	const tabsOf = (pen: string) => tabs[pen] ?? { open: [], active: null };
	// per open file: diff (merge-base vs now) or plain view. Changes → diff, Files → plain, toggle in the modal
	const [diffs, setDiffs] = useState<Record<string, boolean>>({});
	const isDiff = (pen: string, path: string) => diffs[`${pen}\n${path}`] ?? false;
	const setDiff = (pen: string, path: string, on: boolean) => setDiffs((d) => ({ ...d, [`${pen}\n${path}`]: on }));
	const openFile = (pen: string, path: string, diff?: boolean) => {
		if (diff !== undefined) setDiff(pen, path, diff);
		setTabs((all) => {
			const cur = all[pen] ?? { open: [], active: null };
			return { ...all, [pen]: { open: cur.open.includes(path) ? cur.open : [...cur.open, path], active: path } };
		});
	};
	const showTab = (pen: string, path: string | null) =>
		setTabs((all) => ({ ...all, [pen]: { ...(all[pen] ?? { open: [] }), active: path } }));
	const closeFile = (pen: string, path: string) =>
		setTabs((all) => {
			const cur = all[pen] ?? { open: [], active: null };
			const i = cur.open.indexOf(path);
			const open = cur.open.filter((p) => p !== path);
			// closing the active tab → its left neighbour, or back to the terminal
			const active = cur.active === path ? (open[i - 1] ?? open[i] ?? null) : cur.active;
			return { ...all, [pen]: { open, active } };
		});

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
		if (t.kind !== "shell") addWorkspace(t.repo);
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

	async function newShell(cwd: string | null = null) {
		const size = lastSize;
		const t = await window.corral.newShell(cwd, size);
		if (size && t.id !== null) bornAtSize.add(t.id);
		addThread(t);
	}

	async function pickRepo() {
		const repo = await window.corral.pickRepo();
		if (repo) {
			addWorkspace(repo);
			setHomeRepo(repo);
		}
	}

	// OSC 7 → each shell's live folder. a different host = you ssh'd somewhere: shown, never used for "+"
	const [localHost, setLocalHost] = useState("");
	useEffect(() => {
		window.corral.hostname().then(setLocalHost);
		return onCwd((id, path, host) =>
			setThreads((ts) => ts.map((t) => (t.id === id && t.kind === "shell" ? { ...t, cwd: path, host } : t))),
		);
	}, []);
	const sameHost = (h?: string) => !h || h.toLowerCase().replace(/\.local$/, "") === localHost.toLowerCase().replace(/\.local$/, "");
	const shellLabel = (t: Thread) => {
		const dir = t.cwd ?? "";
		const name = /^\/Users\/[^/]+\/?$/.test(dir) ? "~" : dir.split("/").filter(Boolean).pop() ?? "/";
		return sameHost(t.host) ? name : `${t.host?.split(".")[0]}:${name}`;
	};

	useEffect(() => {
		const offs = [
			window.corral.on("workspace", addWorkspace),
			window.corral.on("thread", addThread),
			window.corral.on("out", ({ id, text }) => getTerm(id).write(text)),
			window.corral.on("status", ({ id, state }) =>
				setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, state } : t))),
			),
			window.corral.on("exited", ({ id }) =>
				setThreads((ts) => {
					const gone = ts.find((t) => t.id === id);
					// a shell that exits (you typed `exit`) is just gone: nothing to resume, unlike an agent's pen
					if (gone?.kind === "shell") {
						const rest = ts.filter((t) => t.id !== id);
						setActive((a) => (a === gone.pen ? (rest.find((t) => t.kind === "shell")?.pen ?? null) : a));
						return rest;
					}
					return ts.map((t) => (t.id === id ? { ...t, alive: false } : t));
				}),
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
					<span>Terminals</span>
					<button
						className="icon-btn"
						onClick={() => {
							const cur = threads.find((t) => t.pen === active && t.kind === "shell");
							newShell(cur && sameHost(cur.host) ? (cur.cwd ?? null) : null);
						}}
						title="New terminal (starts where the current one is)"
						aria-label="New terminal"
					>
						<Plus size={14} strokeWidth={1.75} />
					</button>
				</div>
				<nav className="shells">
					{threads
						.filter((t) => t.kind === "shell")
						.map((t) => (
							<button key={t.pen} className={`thread shell ${t.pen === active ? "active" : ""}`} onClick={() => setActive(t.pen)} title={t.cwd}>
								<TerminalIcon size={13} strokeWidth={1.75} />
								<span className="name">{shellLabel(t)}</span>
							</button>
						))}
				</nav>

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
							<span className="task">{current.kind === "shell" ? "Terminal" : current.task}</span>
							{current.kind === "shell" ? (
								<span className="chip mono" title={current.cwd}>
									<Folder size={12} strokeWidth={1.75} />
									{current.cwd?.replace(/^\/Users\/[^/]+/, "~")}
								</span>
							) : (
								<span className="chip mono">
									<GitBranch size={12} strokeWidth={1.75} />
									{current.branch}
								</span>
							)}
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
							{current.kind !== "shell" && <button
								className={`icon-btn ${filesOpen ? "on" : ""}`}
								onClick={() => setFilesOpen((o) => !o)}
								title="Toggle files"
								aria-label="Toggle files"
							>
								<PanelRight size={15} strokeWidth={1.75} />
							</button>}
						</header>
						<div className="workarea">
							<div className="sky">
								{threads
									.filter((t) => t.id !== null)
									.map((t) => (
										<Screen key={t.id} id={t.id!} shown={t.pen === active} />
									))}
							</div>
							{filesOpen && current.kind !== "shell" && (
								<Files
									thread={current}
									onOpen={(path, diff) => openFile(current.pen, path, diff)}
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
			{current && tabsOf(current.pen).active !== null && (
				<FileModal
					thread={current}
					onDeleted={() => {
						setThreads((ts) => ts.filter((t) => t.pen !== current.pen));
						setActive(null);
					}}
					pen={current.pen}
					open={tabsOf(current.pen).open}
					active={tabsOf(current.pen).active!}
					diff={isDiff(current.pen, tabsOf(current.pen).active!)}
					onToggleDiff={(on) => setDiff(current.pen, tabsOf(current.pen).active!, on)}
					onShow={(p, d) => openFile(current.pen, p, d)}
					onClose={() => showTab(current.pen, null)}
					onCloseTab={(p) => closeFile(current.pen, p)}
				/>
			)}
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
				<RepoSetup repo={props.repo} />
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
		// xterm stops PAINTING while hidden (display:none) but keeps buffering output. on show nothing tells it to
		// repaint (same size → fit is a no-op, no SIGWINCH) = black screen. wait a frame for display:block, then
		// force every row to be redrawn from the buffer
		const raf = requestAnimationFrame(() => {
			const t = getTerm(id);
			t.refresh(0, t.rows - 1);
		});
		const ro = new ResizeObserver(() => fitTerm(id)); // window drag, files panel toggle…
		ro.observe(ref.current!);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
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

function TreeNode(props: {
	name: string;
	node: Tree;
	depth: number;
	dir: string;
	onOpen: (path: string, diff?: boolean) => void;
	status: Record<string, string>; // path → M/A/D/? for files claude touched
	current: string | null; // file open in the modal
}) {
	const { name, node, depth, dir, onOpen, status, current } = props;
	const path = dir ? `${dir}/${name}` : name;
	// folders holding the open file start expanded, so you can see where it lives
	const [open, setOpen] = useState(() => !!current?.startsWith(path + "/"));
	const kids = sortKids(node);
	const pad = { paddingLeft: 10 + depth * 14 };
	if (kids.length === 0) {
		const s = status[path];
		return (
			<li>
				<button className={`row ${s ? `st-${s === "?" ? "U" : s}` : ""} ${path === current ? "on" : ""}`} style={pad} onClick={() => onOpen(path)} title={path}>
					<span className="chev" />
					<FileIcon path={path} />
					<span className="name">{name}</span>
					{s && <span className="letter">{s === "?" ? "U" : s}</span>}
				</button>
			</li>
		);
	}
	const Chevron = open ? ChevronDown : ChevronRight;
	const dirty = !open && Object.keys(status).some((p) => p.startsWith(path + "/")); // closed folder hiding changes
	return (
		<li>
			<button className="row folder" style={pad} onClick={() => setOpen((o) => !o)}>
				<Chevron className="chev" size={12} strokeWidth={1.75} />
				<FolderIcon name={name} open={open} />
				<span className="name">{name}</span>
				{dirty && <span className="dot" />}
			</button>
			{open && <ul>{kids.map((k) => <TreeNode key={k} name={k} node={node[k]} depth={depth + 1} dir={path} onOpen={onOpen} status={status} current={current} />)}</ul>}
		</li>
	);
}

type PenFiles = Awaited<ReturnType<typeof window.corral.files>>;
type ListTab = "changes" | "files";

// git status + file list of one pen, re-polled every 2s while mounted (only for threads you're looking at)
function usePenFiles(pen: string) {
	const [data, setData] = useState<PenFiles | null>(null);
	useEffect(() => {
		let live = true;
		const load = () => window.corral.files(pen).then((d) => live && setData(d));
		load();
		const timer = setInterval(load, 2000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [pen]);
	return data;
}

// Changes / Files tabs + their lists. shared by the side panel and the file modal
function FileLists({ data, tab, setTab, onOpen, current }: { data: PenFiles | null; tab: ListTab; setTab: (t: ListTab) => void; onOpen: (path: string, diff?: boolean) => void; current?: string | null }) {
	const tree = buildTree(data?.all ?? []);
	const n = data?.changed.length ?? 0;
	// path → git status, so the Files tree can tint what claude touched
	const status: Record<string, string> = {};
	for (const f of data?.changed ?? []) status[f.path] = f.status;
	return (
		<>
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
							<li key={f.path} className={`row ${f.path === current ? "on" : ""} ${f.status === "D" ? "gone" : ""}`} title={f.path} onClick={() => f.status !== "D" && onOpen(f.path, true)}>
								<FileIcon path={f.path} />
								<span className="name">{f.path.split("/").pop()}</span>
								<span className="dir">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
								<span className={`badge s-${f.status}`}>{f.status === "?" ? "U" : f.status}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="quiet">The agent hasn't changed anything yet.</p>
				)
			) : (
				<ul className="tree">
					{sortKids(tree).map((k) => (
						<TreeNode key={k} name={k} node={tree[k]} depth={0} dir="" onOpen={onOpen} status={status} current={current ?? null} />
					))}
				</ul>
			)}
		</>
	);
}

// the editor as a floating window over a blurred app (user's sketch): file view left, tree right.
// Esc or a click on the backdrop closes it; open tabs are kept for next time.
function FileModal(props: {
	thread: Thread;
	onDeleted: () => void;
	pen: string;
	open: string[];
	active: string;
	diff: boolean;
	onToggleDiff: (on: boolean) => void;
	onShow: (p: string, diff?: boolean) => void;
	onClose: () => void;
	onCloseTab: (p: string) => void;
}) {
	const { thread, onDeleted, pen, open, active, diff, onToggleDiff, onShow, onClose, onCloseTab } = props;
	const data = usePenFiles(pen);
	const [tab, setTab] = useState<ListTab>(diff ? "changes" : "files");
	const changed = data?.changed.find((f) => f.path === active);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="modal-code">
				<nav className="tabstrip">
					{open.map((p) => (
						<div key={p} className={`tab ${active === p ? "on" : ""}`} title={p}>
							<button className="tab-name" onClick={() => onShow(p)}>
								<FileIcon path={p} size={13} />
								{p.split("/").pop()}
							</button>
							<button className="tab-x" onClick={() => onCloseTab(p)} aria-label={`Close ${p}`}>
								<X size={12} strokeWidth={2} />
							</button>
						</div>
					))}
					<span className="spacer" />
					<span className="tab-path mono">{active}</span>
					{changed && changed.status !== "D" && (
						<div className="seg">
							<button className={diff ? "on" : ""} onClick={() => onToggleDiff(true)}>Diff</button>
							<button className={!diff ? "on" : ""} onClick={() => onToggleDiff(false)}>File</button>
						</div>
					)}
				</nav>
				<div className="file-pane">
					<CodeView key={pen + active + diff} pen={pen} path={active} diff={diff && !!changed} />
				</div>
			</div>
			<aside className="modal-tree files">
				<FileLists data={data} tab={tab} setTab={setTab} onOpen={onShow} current={active} />
				<GitPanel thread={thread} onDeleted={onDeleted} />
			</aside>
		</div>
	);
}

function Files({ thread, onDeleted, onOpen }: { thread: Thread; onDeleted: () => void; onOpen: (path: string, diff?: boolean) => void }) {
	const data = usePenFiles(thread.pen);
	const [tab, setTab] = useState<ListTab>("changes");
	return (
		<aside className="files">
			<FileLists data={data} tab={tab} setTab={setTab} onOpen={onOpen} />
			<GitPanel thread={thread} onDeleted={onDeleted} />
		</aside>
	);
}

