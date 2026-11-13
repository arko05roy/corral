# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): v3 → v5. Agents survive closing Corral; viewer + merge-base diff; full git + PR lifecycle in-app.
Last step: committed v5 (viewer, diff, file logos, git command center, PR window, short branch names, merged cleanup).
Next step: dogfood v5. Then pillar 2: shell tabs + splits (daemon spawns zsh PTYs). Debt: viewer live refresh, PR inline diff + reviews, add tsc.
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH, agent hooks, files as IPC, race conditions / torn reads, file locks, atomic rename, idempotency, SIGHUP, daemon / client-server split, Unix domain sockets, stream framing (NDJSON), request/response over a stream (reqId), replay buffer., initial window size / stale frames in flight, version skew / version handshake, Electron drag regions eat clicks, merge-base, command pattern (whitelisted actions), sync exec blocks the event loop, patch-id (rebase drops cherry-picked dupes), untrusted HTML sanitizing, CSP.
Run: `npm run daemon` (tab 1), `npm run app` (tab 2). Dev: CORRAL_SHOT, CORRAL_SHOT_DELAY, CORRAL_SHOT_RESIZE, CORRAL_WEBGL, CORRAL_AGENT (set on the DAEMON now), CORRAL_DEBUG.
