import { MergeView } from "@codemirror/merge";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { languageFor, viewerBase } from "./code";

type Loaded = Awaited<ReturnType<typeof window.corral.readFile>> & { base?: string };

// one read-only file, CodeMirror inside. diff = side by side: merge-base (left) vs the pen now (right).
// v0: loads once on open (no live refresh yet)
export function CodeView({ pen, path, diff = false }: { pen: string; path: string; diff?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	const [file, setFile] = useState<Loaded | null>(null);

	useEffect(() => {
		let live = true;
		setFile(null);
		Promise.all([window.corral.readFile(pen, path), diff ? window.corral.readBase(pen, path) : null]).then(([now, base]) => {
			if (!live) return;
			if (base?.binary) return setFile({ binary: true });
			setFile({ ...now, base: base?.text });
		});
		return () => {
			live = false;
		};
	}, [pen, path, diff]);

	useEffect(() => {
		if (file?.text === undefined || !ref.current) return;
		// language lives in a Compartment: a swappable slot. show plain text NOW, highlight once the grammar loads
		const langA = new Compartment();
		const langB = new Compartment();
		let views: EditorView[];
		let destroy: () => void;
		if (diff) {
			const mv = new MergeView({
				parent: ref.current,
				// wrap: side by side halves the width, so long lines wrap instead of two horizontal scrollbars
				a: { doc: file.base ?? "", extensions: [viewerBase, EditorView.lineWrapping, langA.of([])] },
				b: { doc: file.text, extensions: [viewerBase, EditorView.lineWrapping, langB.of([])] },
				highlightChanges: true, // word-level highlights inside changed lines
				gutter: true,
				collapseUnchanged: { margin: 3, minSize: 6 }, // only scroll through what changed, GitHub-style
			});
			views = [mv.a, mv.b];
			destroy = () => mv.destroy();
		} else {
			const view = new EditorView({
				parent: ref.current,
				state: EditorState.create({ doc: file.text, extensions: [viewerBase, langB.of([])] }),
			});
			views = [view];
			destroy = () => view.destroy();
		}
		// take focus from the terminal: ⌘F works at once, and Esc (closes the modal) can't reach claude,
		// where Esc means "interrupt"
		views[views.length - 1].focus();
		let live = true;
		languageFor(path).then((ext) => {
			if (!live) return;
			if (diff) views[0].dispatch({ effects: langA.reconfigure(ext) });
			views[views.length - 1].dispatch({ effects: langB.reconfigure(ext) });
		});
		return () => {
			live = false;
			destroy();
		};
	}, [file, path, diff]);

	if (!file) return <div className="code-view" />;
	if (file.error) return <p className="code-note">Can't open {path}: {file.error}</p>;
	if (file.binary) return <p className="code-note">{path} is a binary file{file.size ? ` (${kb(file.size)})` : ""}.</p>;
	if (file.tooBig) return <p className="code-note">{path} is too big to show ({kb(file.size)}).</p>;
	if (!diff) return <div className="code-view" ref={ref} />;
	return (
		<div className="diff-wrap">
			<div className="diff-head">
				<span>
					<i style={{ background: "#f07178" }} />
					Before · fork point{file.base === "" ? " (new file)" : ""}
				</span>
				<span>
					<i style={{ background: "#a6d189" }} />
					After · this pen
				</span>
			</div>
			<div className="code-view diff" ref={ref} />
		</div>
	);
}

const kb = (n = 0) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
