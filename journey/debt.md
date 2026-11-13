# debt
- No cleanup cmd: pens + branches leak (user has old t1/ts/t5 pens in ~/.corral/pens).
- createPen throw at startup (CLI preload path) is uncaught.
- Claude folder-trust prompt on every new pen.
- cli.ts duplicates pens.ts.
- Pens are naked (.env, node_modules missing); ports shared.
- Claude mascot (block chars) striped: lineHeight 1.2 gaps. WebGL renderer fixes blocks but draws text ~1/3 size in our setup (ruled out: font timing, addon version, rAF race, resize, dpr, transparency). Behind CORRAL_WEBGL=1. Next lead: xterm 6.1 beta like Paradev.
- Files panel polls git every 2s (push version = fs watcher).
- CSP allows 'unsafe-inline' scripts (Vite dev preamble).
- Claude's own UI colors (grey user-message bar) ignore our palette; try Claude /theme ANSI option.
- Daemon auto-started by app (detached/setsid, log ~/.corral/corrald.log); uses `node` from PATH (CORRAL_NODE overrides) — breaks if launched from Finder without PATH.
- Daemon dying kills its agents (it holds the PTY masters now).
- Replay is raw bytes: full-screen TUIs can look scrambled at a new size until they redraw (tmux keeps a virtual screen instead).
- Daemon has no auth beyond socket perms; no "kill thread" command yet.
- Status channel is one-way and samples bursts; status files never cleaned up.
## fixed in v3
- ~~nodeIntegration on~~ → preload bridge + contextIsolation.
- ~~Fixed 100x30~~ → fit addon + pty.resize (SIGWINCH).
- ~~"branch already exists" on restart~~ → createPen skips taken names.
- ~~Agents die with the app~~ → corrald + replay buffer (v4).
