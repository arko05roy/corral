import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

// One xterm per thread, living OUTSIDE React so re-renders never nuke scrollback.
const terms = new Map<number, Terminal>();

const theme = {
	background: "#14286E00",
	foreground: "#EFE6D2",
	cursor: "#F2A93B",
	cursorAccent: "#14286E",
	selectionBackground: "#EFE6D244",
	black: "#0B1640", red: "#E8806B", green: "#A9C98A", yellow: "#F2A93B",
	blue: "#8FA6F0", magenta: "#C9A2E0", cyan: "#8CCBD6", white: "#EFE6D2",
	brightBlack: "#7D8AC0", brightRed: "#F2A08E", brightGreen: "#C4DDA8", brightYellow: "#F7C878",
	brightBlue: "#B4C4F7", brightMagenta: "#DCC0EC", brightCyan: "#B0DDE5", brightWhite: "#FFFFFF",
};

export function getTerm(id: number) {
	let t = terms.get(id);
	if (!t) {
		t = new Terminal({
			cols: 100,
			rows: 30,
			theme,
			allowTransparency: true,
			fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
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

// open into the DOM, then switch to the GPU renderer: it draws block/box chars (▛█▜) as exact
// cell-filling rects instead of font glyphs, so pixel art doesn't get gaps from lineHeight.
export async function openTerm(id: number, el: HTMLElement) {
	const t = getTerm(id);
	if (t.element) return;
	t.open(el);
	// GPU renderer bakes glyphs into a texture once: font must be loaded first or it bakes the wrong metrics
	await document.fonts.load('400 13px "IBM Plex Mono"').catch(() => {});
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

// measure the panel's pixels ÷ one cell's pixels → real cols×rows. Skips hidden (0×0) panels.
export function fitTerm(id: number) {
	const el = terms.get(id)?.element?.parentElement;
	if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
	fits.get(id)?.fit();
}

declare global {
	interface Window {
		corral: {
			pickRepo(): Promise<string | null>;
			newThread(repo: string, task: string): Promise<Thread | { error: string }>;
			listPens(repo: string): Promise<Omit<Thread, "id">[]>;
			resume(meta: { repo: string; task: string; branch: string; pen: string }): Promise<{ id: number }>;
			files(pen: string): Promise<{ changed: { status: string; path: string }[]; all: string[]; error?: string }>;
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
