# reveals (Paradev = ~/Desktop/superset)
- apps/desktop/src/renderer/index.html: empty shell + React (index.tsx), CSP meta, theme-boot before body. Stack: Electron + electron-vite + React 19 + Tailwind 4 + xterm 6.1 beta + lucide-react.
- docs/screenshots/new-workspace-from-plugin.png: layout we copied (New Workspace button, PROJECTS section, composer home with chips).
- apps/desktop/src/renderer/lib/terminal/terminal-addons.ts loadAddons(): WebGL loaded in rAF after open (post-open measure race), per-terminal fallback to DOM on context loss + refresh, never latch failure; browsers cap live WebGL contexts.
