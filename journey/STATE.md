# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): v3, v3.1, v4 done. Agents survive closing Corral (corrald daemon + replay).
Last step: committed + pushed v4.
Next step: kill-thread + cleanup cmd. (Auto-start verified by user.)
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH, agent hooks, files as IPC, race conditions / torn reads, file locks, atomic rename, idempotency, SIGHUP, daemon / client-server split, Unix domain sockets, stream framing (NDJSON), request/response over a stream (reqId), replay buffer.
Run: `npm run daemon` (tab 1), `npm run app` (tab 2). Dev: CORRAL_SHOT, CORRAL_SHOT_DELAY, CORRAL_SHOT_RESIZE, CORRAL_WEBGL, CORRAL_AGENT (set on the DAEMON now), CORRAL_DEBUG.
