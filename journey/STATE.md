# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): v3, v3.1, v4, v4.1, v4.2 done. Agents survive closing Corral; threads can be stopped + resumed.
Last step: verified + committed v4.2 kill-thread (SIGHUP → exited in 901ms, resume works).
Next step: cleanup cmd for dead worktrees.
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH, agent hooks, files as IPC, race conditions / torn reads, file locks, atomic rename, idempotency, SIGHUP, daemon / client-server split, Unix domain sockets, stream framing (NDJSON), request/response over a stream (reqId), replay buffer.
Run: `npm run daemon` (tab 1), `npm run app` (tab 2). Dev: CORRAL_SHOT, CORRAL_SHOT_DELAY, CORRAL_SHOT_RESIZE, CORRAL_WEBGL, CORRAL_AGENT (set on the DAEMON now), CORRAL_DEBUG.
