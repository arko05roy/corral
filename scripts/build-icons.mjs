// build-time: pull only the file/folder logos we map out of vscode-icons (MIT, 1700+ icons, ~5MB)
// into src/ui/file-icons.json. run: node scripts/build-icons.mjs
import { writeFileSync } from "node:fs";
import { getIconData } from "@iconify/utils";
import { createRequire } from "node:module";

const set = createRequire(import.meta.url)("@iconify-json/vscode-icons/icons.json");

// exact filename (lowercase) → icon. checked first: package.json is json, but it's npm's
const names = {
	"package.json": "npm", "package-lock.json": "npm", ".npmrc": "npm", "pnpm-lock.yaml": "pnpm", "pnpm-workspace.yaml": "pnpm",
	".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git",
	"tsconfig.json": "tsconfig", "jsconfig.json": "tsconfig",
	"eslint.config.mjs": "eslint", "eslint.config.js": "eslint", ".eslintrc": "eslint", ".eslintrc.json": "eslint",
	"next.config.ts": "next", "next.config.js": "next", "next.config.mjs": "next", "next-env.d.ts": "next",
	"vite.config.ts": "vite", "vite.config.js": "vite",
	"tailwind.config.ts": "tailwind", "tailwind.config.js": "tailwind",
	"postcss.config.mjs": "postcss", "postcss.config.js": "postcss",
	".prettierrc": "prettier", "prettier.config.js": "prettier", "babel.config.js": "babel",
	".env": "dotenv", ".env.local": "dotenv", ".env.example": "dotenv", ".env.production": "dotenv",
	license: "license", "license.md": "license", dockerfile: "docker", "docker-compose.yml": "docker",
	"cargo.toml": "cargo", "cargo.lock": "cargo", "claude.md": "claude", "agents.md": "agents",
	"favicon.ico": "favicon", "flake.nix": "nix",
};
// extension → icon (longest match wins, so .d.ts beats .ts)
const exts = {
	"d.ts": "typescriptdef", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "reactts", jsx: "reactjs",
	js: "js", mjs: "js", cjs: "js", json: "json", jsonc: "json", md: "markdown", mdx: "markdown",
	css: "css", scss: "scss", sass: "scss", html: "html", htm: "html", vue: "vue", svelte: "svelte",
	py: "python", rs: "rust", go: "go", yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql", prisma: "prisma",
	sol: "solidity", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", java: "java", swift: "swift", xml: "xml",
	sh: "shell", zsh: "shell", bash: "shell", nix: "nix", txt: "text", log: "text", pdf: "pdf", svg: "svg",
	png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", avif: "image",
	mp4: "video", mov: "video", webm: "video", mp3: "audio", wav: "audio", ogg: "audio",
	woff: "font", woff2: "font", ttf: "font", otf: "font", zip: "zip", gz: "zip", tar: "zip", lock: "text",
};
// folder name (lowercase) → folder icon (each has an -opened twin)
const folders = {
	src: "src", app: "app", components: "component", component: "component", lib: "library", libs: "library",
	public: "public", static: "public", test: "test", tests: "test", __tests__: "test", spec: "test", e2e: "e2e",
	scripts: "script", script: "script", docs: "docs", doc: "docs", journey: "docs", config: "config", configs: "config",
	assets: "asset", asset: "asset", images: "images", img: "images", icons: "images", styles: "style", css: "style",
	node_modules: "node", ".github": "github", ".git": "git", hooks: "hook", utils: "helper", helpers: "helper",
	api: "api", dist: "dist", build: "dist", out: "dist", ".vscode": "vscode", server: "server", client: "client",
	db: "db", database: "db", migrations: "db", models: "model", types: "typescript", routes: "route",
	middleware: "middleware", plugins: "plugin", packages: "package", modules: "module", tools: "tools",
	bin: "binary", cli: "cli", fonts: "fonts", locales: "locale", i18n: "locale", mocks: "mock", templates: "template",
	themes: "theme", tmp: "temp", temp: "temp", logs: "log", videos: "video", audio: "audio",
};

const icons = {};
const add = (name) => {
	const d = getIconData(set, name);
	if (!d) throw new Error(`no icon ${name}`);
	icons[name] = { body: d.body, w: d.width ?? set.width ?? 32, h: d.height ?? set.height ?? 32 };
	return name;
};
const file = (k) => add(`file-type-${k}`);
const out = {
	names: Object.fromEntries(Object.entries(names).map(([n, k]) => [n, file(k)])),
	exts: Object.fromEntries(Object.entries(exts).map(([e, k]) => [e, file(k)])),
	folders: Object.fromEntries(
		Object.entries(folders).map(([n, k]) => [n, [add(`folder-type-${k}`), add(`folder-type-${k}-opened`)]]),
	),
	file: add("default-file"),
	folder: [add("default-folder"), add("default-folder-opened")],
	icons,
};
writeFileSync(new URL("../src/ui/file-icons.json", import.meta.url), JSON.stringify(out));
console.log(`${Object.keys(icons).length} icons, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
