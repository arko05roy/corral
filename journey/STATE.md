# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): v3 → v4.4 done. Agents survive closing Corral; stop/resume; merge / PR / delete; stale daemon auto-replaced on launch.
Last step: committed v4.4 daemon version handshake (verified live: 61772 → 78993).
Next step: confirm new threads render clean (v4.3 size fix, first run on fresh daemon). Then diff viewer → setup scripts. Debt: Changes tab after commit, squash-merge false alarm, add tsc.
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH, agent hooks, files as IPC, race conditions / torn reads, file locks, atomic rename, idempotency, SIGHUP, daemon / client-server split, Unix domain sockets, stream framing (NDJSON), request/response over a stream (reqId), replay buffer., initial window size / stale frames in flight, version skew / version handshake, Electron drag regions eat clicks.
Run: `npm run daemon` (tab 1), `npm run app` (tab 2). Dev: CORRAL_SHOT, CORRAL_SHOT_DELAY, CORRAL_SHOT_RESIZE, CORRAL_WEBGL, CORRAL_AGENT (set on the DAEMON now), CORRAL_DEBUG.
