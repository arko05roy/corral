// CodeMirror 6 setup: Corral's look, not VS Code's. syntax colors reuse the terminal's ANSI palette,
// so code in the viewer and code claude prints in the terminal feel like one family.
import { defaultKeymap } from "@codemirror/commands";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const c = {
	fg: "#e5e5e5",
	dim: "#6b6b6b",
	red: "#f07178",
	green: "#a6d189",
	yellow: "#e5c07b",
	blue: "#82aaff",
	magenta: "#c792ea",
	cyan: "#89ddff",
	orange: "#f2a93b", // --amber
};

export const corralTheme = EditorView.theme(
	{
		"&": { height: "100%", color: c.fg, backgroundColor: "var(--bg)", fontSize: "13px" },
		".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
		".cm-content": { padding: "10px 0", caretColor: c.fg },
		".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-faint)", border: "none", paddingLeft: "6px" },
		".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 8px", minWidth: "36px" },
		".cm-activeLine": { backgroundColor: "#ffffff07" },
		".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-dim)" },
		"&.cm-focused": { outline: "none" },
		".cm-cursor": { borderLeftColor: c.fg },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#ffffff26 !important" },
		".cm-selectionMatch": { backgroundColor: "#ffffff14" },
		".cm-searchMatch": { backgroundColor: "#f2a93b33", outline: "1px solid #f2a93b66" },
		".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#f2a93b66" },
		// ⌘F panel: Corral chrome instead of CM's default grey form
		".cm-panels": { backgroundColor: "var(--panel)", color: "var(--fg-2)", borderTop: "1px solid var(--line)" },
		".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
		".cm-panel.cm-search": { padding: "8px 10px", fontFamily: "var(--ui)", fontSize: "12px" },
		".cm-panel.cm-search input, .cm-panel.cm-search button": {
			fontFamily: "var(--ui)",
			fontSize: "12px",
			backgroundColor: "var(--muted)",
			color: "var(--fg)",
			border: "1px solid var(--line)",
			borderRadius: "6px",
			padding: "3px 8px",
			backgroundImage: "none",
		},
		".cm-panel.cm-search label": { fontSize: "12px", color: "var(--fg-dim)" },
		".cm-panel.cm-search [name=close]": { color: "var(--fg-dim)", background: "none", border: "none" },
	},
	{ dark: true },
);

export const corralHighlight = HighlightStyle.define([
	{ tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: c.magenta },
	{ tag: [t.string, t.special(t.string), t.regexp], color: c.green },
	{ tag: [t.number, t.bool, t.null, t.atom], color: c.orange },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.blue },
	{ tag: [t.typeName, t.className, t.namespace], color: c.yellow },
	{ tag: [t.propertyName, t.attributeName], color: c.cyan },
	{ tag: [t.tagName, t.heading], color: c.red },
	{ tag: [t.comment, t.lineComment, t.blockComment], color: c.dim, fontStyle: "italic" },
	{ tag: [t.operator, t.punctuation, t.bracket], color: "#a1a1a1" },
	{ tag: t.definition(t.variableName), color: c.fg },
	{ tag: t.link, color: c.blue, textDecoration: "underline" },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.invalid, color: c.red },
]);

// shared by the viewer and both sides of the diff
export const viewerBase: Extension = [
	lineNumbers(),
	highlightActiveLine(),
	drawSelection(),
	search({ top: false }),
	highlightSelectionMatches(),
	keymap.of([...searchKeymap, ...defaultKeymap]),
	EditorState.readOnly.of(true), // read-only but still focusable: select, copy, ⌘F all work; typing doesn't
	corralTheme,
	syntaxHighlighting(corralHighlight),
];

// filename → language, loaded lazily: opening a .py never ships the rust parser
export async function languageFor(path: string): Promise<Extension> {
	const desc = LanguageDescription.matchFilename(languages, path);
	if (!desc) return [];
	try {
		return await desc.load();
	} catch {
		return []; // unknown/broken grammar → plain text beats a crash
	}
}
