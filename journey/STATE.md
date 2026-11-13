# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): v3 → v4.3 done. Agents survive closing Corral; threads stop/resume; pens merge / open PR / delete. User says it's becoming useful.
Last step: committed v4.3 (merge/PR/delete confirmed in app; spawn-at-real-size fix untested).
Next step: restart daemon when idle, verify new thread renders clean from frame 1. Then dogfood + debt (Changes tab after commit, squash-merge false alarm, add tsc).
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH, agent hooks, files as IPC, race conditions / torn reads, file locks, atomic rename, idempotency, SIGHUP, daemon / client-server split, Unix domain sockets, stream framing (NDJSON), request/response over a stream (reqId), replay buffer., initial window size / stale frames in flight.
Run: `npm run daemon` (tab 1), `npm run app` (tab 2). Dev: CORRAL_SHOT, CORRAL_SHOT_DELAY, CORRAL_SHOT_RESIZE, CORRAL_WEBGL, CORRAL_AGENT (set on the DAEMON now), CORRAL_DEBUG.
