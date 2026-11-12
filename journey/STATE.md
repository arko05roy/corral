# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): v3 + v3.1 committed. Lamps show working / needs-you from Claude hooks.
Last step: committed v3.1 (agent status).
Next step: #3 agents survive closing the app (user picked). Start: user proposes how.
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator, PTY window size + SIGWINCH (signals = push), agent hooks, cross-process channel via files, race condition / torn reads, file locks (advisory), atomic rename, idempotency.
Run: `npm run app`. Dev: CORRAL_SHOT=out.png, CORRAL_SHOT_DELAY=ms, CORRAL_SHOT_RESIZE=1, CORRAL_WEBGL=1, CORRAL_AGENT=<script>, CORRAL_DEBUG=1 (status events).
