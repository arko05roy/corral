# design
- Pen = git worktree on its own branch under ~/.corral/pens/. One shared .git ("brain"), many working trees.
- Agent runs with cwd = pen, headless (`-p`), output piped to pen/corral.log.
- Agent command overridable via CORRAL_AGENT (dev/fake-agent.sh for tests).
