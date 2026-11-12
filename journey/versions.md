# versions
- v0: cp -r repo per task, `claude -p` headless, logs to file. Real repo: 4.9s + 1.2GB per pen, symlinks broken.
- v1: `git worktree add -b corral/<slug>` per task. 1.6s + 287MB per pen (files only), shared .git, symlinks intact.
- v2: Electron app. Interactive claude in a node-pty PTY per pen, xterm.js panel per pen, IPC carries bytes both ways. Path there: pipes -> claude saw isatty()=false and went headless; node-pty -> raw escape codes in <pre>; xterm.js -> works.
- v3: React + Vite renderer, Paradev-style layout (sidebar repos/threads, composer home, files panel w/ Changes/Files tabs) in Corral theme (cream paper, cobalt ink, amber lamps, etched hills). Preload bridge replaces nodeIntegration. Old pens read from `git worktree list` (git = the pen database), resumed with `claude --continue`. Terminal sized to panel via fit addon → pty.resize → SIGWINCH. Bug found on the way: fit addon ignores parent padding under border-box → overshot cols/rows; fixed with inset.
