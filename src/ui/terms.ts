import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

// One xterm per thread, living OUTSIDE React so re-renders never nuke scrollback.
const terms = new Map<number, Terminal>();

const theme = {
	background: "#12121200", // transparent: the panel behind it paints #121212
	foreground: "#e5e5e5",
	cursor: "#e5e5e5",
	cursorAccent: "#121212",
	selectionBackground: "#ffffff30",
	black: "#1c1c1c", red: "#f07178", green: "#a6d189", yellow: "#e5c07b",
	blue: "#82aaff", magenta: "#c792ea", cyan: "#89ddff", white: "#d4d4d4",
	brightBlack: "#6b6b6b", brightRed: "#ff8b92", brightGreen: "#c3e88d", brightYellow: "#ffcb6b",
	brightBlue: "#9cc4ff", brightMagenta: "#ddb0f6", brightCyan: "#a3f7ff", brightWhite: "#fafafa",
};

export function getTerm(id: number) {
	let t = terms.get(id);
	if (!t) {
		t = new Terminal({
			cols: 100,
			rows: 30,
			theme,
			allowTransparency: true,
			fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
			fontSize: 13,
			lineHeight: 1.2,
		});
		const fit = new FitAddon();
		t.loadAddon(fit);
		fits.set(id, fit);
		t.onData((text) => window.corral.send(id, text));
		// grid changed size → tell the PTY → kernel sends SIGWINCH → agent redraws
		t.onResize(({ cols, rows }) => window.corral.resize(id, cols, rows));
		terms.set(id, t);
	}
	return t;
}

const fits = new Map<number, FitAddon>();
// agents the UI spawned at a measured size: they need no forced redraw
export const bornAtSize = new Set<number>();

// open into the DOM, then switch to the GPU renderer: it draws block/box chars (▛█▜) as exact
// cell-filling rects instead of font glyphs, so pixel art doesn't get gaps from lineHeight.
export async function openTerm(id: number, el: HTMLElement) {
	const t = getTerm(id);
	if (t.element) return;
	if (!bornAtSize.has(id)) forceRedraw(id); // spawned before we knew the real size
	t.open(el);
	// GPU renderer bakes glyphs into a texture once: font must be loaded first or it bakes the wrong metrics
	await document.fonts.load('400 13px "SF Mono"').catch(() => {});
	// and wait a frame: loading WebGL right after open() races xterm's own post-open measuring
	// (same fix as Paradev: terminal-addons.ts loadAddons())
	await new Promise(requestAnimationFrame);
	try {
		if (!new URLSearchParams(location.search).has("webgl")) return fitTerm(id); // opt-in: CORRAL_WEBGL=1
		const gl = new WebglAddon();
		gl.onContextLoss(() => {
			gl.dispose(); // GPU hiccup → fall back to DOM renderer
			t.refresh(0, t.rows - 1);
		});
		t.loadAddon(gl);
	} catch {}
	fitTerm(id); // cell size changed with the real font → re-measure
}

// last real size any terminal fitted to. every thread renders in the same panel, so this is the size
// a NEW agent should be born at (Paradev: createOrAttach({ cols: xterm.cols, rows: xterm.rows })).
export let lastSize: { cols: number; rows: number } | null = null;

// measure the panel's pixels ÷ one cell's pixels → real cols×rows. Skips hidden (0×0) panels.
export function fitTerm(id: number) {
	const t = terms.get(id);
	const el = t?.element?.parentElement;
	if (!t || !el || el.clientWidth === 0 || el.clientHeight === 0) return;
	fits.get(id)?.fit();
	lastSize = { cols: t.cols, rows: t.rows };
}

// fallback when the agent was born at a GUESSED size (first thread after launch, re-attached agents):
// frames drawn for the guess may land after our resize. a 1-col wiggle once things settle forces a clean
// full redraw — what dragging the window did by hand. (Paradev's version: refit timers at 100/350ms.)
export function forceRedraw(id: number) {
	setTimeout(() => {
		const t = terms.get(id);
		if (!t?.element || t.cols < 2) return;
		t.resize(t.cols - 1, t.rows); // → onResize → PTY resize → SIGWINCH
		setTimeout(() => fitTerm(id), 60); // back to the real size → second SIGWINCH → full redraw
	}, 350);
}

declare global {
	interface Window {
		corral: {
			pickRepo(): Promise<string | null>;
			newThread(repo: string, task: string, size: { cols: number; rows: number } | null): Promise<Thread | { error: string }>;
			listPens(repo: string): Promise<Omit<Thread, "id">[]>;
			resume(meta: { repo: string; task: string; branch: string; pen: string }, size: { cols: number; rows: number } | null): Promise<{ id: number }>;
			files(pen: string): Promise<{ changed: { status: string; path: string }[]; all: string[]; error?: string }>;
			kill(id: number): Promise<{ ok?: true; error?: string }>;
			merge(args: { id: number | null; repo: string; pen: string; branch: string; message: string }): Promise<{ ok?: true; error?: string }>;
			openPr(args: { pen: string; branch: string; message: string }): Promise<{ ok?: true; url?: string; error?: string }>;
			deletePen(args: { id: number | null; repo: string; pen: string; branch: string; force: boolean }): Promise<{
				ok?: true;
				error?: string;
				needsForce?: true;
				dirty?: boolean;
				merged?: boolean;
			}>;
			send(id: number, text: string): void;
			resize(id: number, cols: number, rows: number): void;
			on(channel: string, fn: (data: any) => void): () => void;
		};
	}
}

// id = live agent session (null = old pen, nothing running yet). pen = its folder, the stable key.
export type Thread = {
	id: number | null;
	repo: string;
	task: string;
	branch: string;
	pen: string;
	alive?: boolean;
	state?: "working" | "waiting"; // from Claude hooks
};
