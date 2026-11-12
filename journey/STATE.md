# corral STATE
Goal: run multiple Claudes on one repo without collisions, and drive them from one app.
Milestone (session 2): DONE. v3 committed: React UI in Paradev layout + Corral theme, old pens from git, files panel, terminal sized to panel.
Last step: committed v3; mascot/WebGL parked.
Next step: user picks: agent status (thinking vs waiting on you → lamps) / cleanup cmd / agents survive app close / mascot via xterm 6.1.
Open debt: see debt.md.
Concepts discovered: git worktree, isatty, PTY, terminal emulator (escape codes, grid + cursor), PTY window size + SIGWINCH (signals = push not poll).
Run: `npm run app` (builds UI). Dev: CORRAL_SHOT=out.png self-screenshot, CORRAL_SHOT_RESIZE=1, CORRAL_WEBGL=1, CORRAL_AGENT=<script>.
