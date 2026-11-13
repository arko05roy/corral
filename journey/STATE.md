# corral STATE
Goal: Corral = the one window: a terminal (shells, survive restarts) + agents in isolated workspaces + code viewer + git/PRs.
Milestone (session 2): v6.0: Corral is a terminal. Shells by default, live folder via OSC 7, repo list persisted.
Last step: committed + pushed v6.0.
Next step: v6.1: "Open folder" + isolated workspace from a shell; attach git panel + file viewer to a shell's live cwd. Then tabs/splits, claude() wrapper for lamps.
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH, agent hooks, files as IPC, race conditions / torn reads, file locks, atomic rename, idempotency, SIGHUP, daemon / client-server split, Unix domain sockets, stream framing (NDJSON), request/response over a stream (reqId), replay buffer., initial window size / stale frames in flight, version skew / version handshake, Electron drag regions eat clicks, merge-base, command pattern (whitelisted actions), sync exec blocks the event loop, patch-id (rebase drops cherry-picked dupes), untrusted HTML sanitizing, CSP, login shells, xterm paint-while-hidden, shell integration (OSC 7, ZDOTDIR injection), in-band signaling.
Run: `npm run daemon` (tab 1), `npm run app` (tab 2). Dev: CORRAL_SHOT, CORRAL_SHOT_DELAY, CORRAL_SHOT_RESIZE, CORRAL_WEBGL, CORRAL_AGENT (set on the DAEMON now), CORRAL_DEBUG.
