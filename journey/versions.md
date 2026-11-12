# versions
- v0: cp -r repo per task, `claude -p` headless, logs to file. Real repo: 4.9s + 1.2GB per pen, symlinks broken.
- v1: `git worktree add -b corral/<slug>` per task. 1.6s + 287MB per pen (files only), shared .git, symlinks intact.
