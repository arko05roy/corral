# Corral

A terminal for working with coding agents. Shells that survive closing the app, isolated git worktrees so several agents can work on one repo without trampling each other, a code viewer with diffs, and a git + pull request panel so you rarely need another app.

Built from scratch as a learning project, one failure at a time. The full story (versions, decisions, dead ends) is in [`journey/`](journey/).

## What it does

- **Terminal first.** Plain `$SHELL` sessions in a sidebar. Type `claude`, `codex`, or anything else. A `~` shell exists by default; new terminals open in the current terminal's folder.
- **Sessions survive the app.** A background daemon (`corrald`) owns every terminal. Quit Corral, reopen it, and your shells and agents are still running, with their scrollback.
- **Isolated workspaces.** Each agent thread gets its own git worktree and branch (short names like `fix-login-bug`), so parallel agents never edit the same files.
- **Code viewer and diffs.** Click a file to open it in a floating window (CodeMirror 6, real file icons). Changed files open as a side-by-side diff against the point where the thread forked, so work landing on `main` never shows up as fake changes.
- **Git panel.** Commit, push (including straight into `main`), pull from any branch, sync or rebase on main, undo, stash, discard, history. Pushing integrates first when the target branch moved. Optional AI commit messages via `claude -p`.
- **Pull requests in the app.** List, checks, changed files, comments, and merge (squash / merge / rebase), close, reopen, ready for review, comment. After a PR merges, one click updates your local `main` and removes the thread.
- **Repo setup.** `git init` with a sensible `.gitignore`, and "Create on GitHub" for folders that aren't on GitHub yet.

## Requirements

- macOS
- Node.js 23.6 or newer (the backend runs `.ts` files directly)
- git
- Optional: [`gh`](https://cli.github.com/) logged in (`gh auth login`) for pull requests and repo creation
- Optional: [`claude`](https://docs.anthropic.com/en/docs/claude-code) for agent threads and AI commit messages

## Quick start

```sh
npm install
npm run app
```

`npm run app` builds the UI and opens Corral. It starts `corrald` in the background if it isn't running, and restarts it automatically when the daemon's code has changed.

To run the daemon in the foreground instead (handy for its logs):

```sh
npm run daemon   # tab 1
npm run app      # tab 2
```

## How it works

```
 Corral app (Electron)                 corrald (daemon, detached)
 ┌───────────────────────┐   unix      ┌────────────────────────────┐
 │ React UI + xterm.js   │  socket     │ owns every PTY             │
 │ CodeMirror, git panel │◀──NDJSON──▶ │ replay buffer per session  │
 │ main process: git/gh  │  + reqId    │ shells ($SHELL -l), agents │
 └───────────────────────┘             └────────────────────────────┘
           │                                       │
           ▼                                       ▼
   git worktrees in ~/.corral/pens       zsh reports its folder (OSC 7)
```

- **PTY + xterm.js.** Programs only behave like they're in a terminal when they get a pseudo-terminal. Resizes go through `pty.resize`, which sends `SIGWINCH`.
- **Daemon / client split.** Closing a PTY's master sends `SIGHUP` to everything in it, so the PTYs live in a detached daemon. The app is a client over `~/.corral/corrald.sock` (owner-only). On connect it gets the scrollback replayed.
- **Version handshake.** The daemon reports a hash of its own source. If it doesn't match the code on disk, the app replaces it before opening the window.
- **Agent status.** Claude hooks write a status file per session (temp file + atomic rename), which drives the working / waiting lamps.
- **Shell integration.** zsh is started with `ZDOTDIR` pointing at Corral's own startup files, which load yours first and then add a hook that prints `OSC 7` (the current folder) before each prompt. Your dotfiles are never edited.
- **Git recipes.** The UI names an action (`commit-push`, `pull`, …) and sends form fields. Only the whitelisted recipes in `src/app/git.ts` run, asynchronously and without password prompts.
- **Untrusted content.** PR comments are rendered with `marked` and sanitized with DOMPurify; the window can't navigate away, and links open in your browser.

## Project layout

```
src/
  daemon.ts        corrald: PTYs, replay buffers, hooks, shell integration, version handshake
  pens.ts          git worktree per thread, short branch names
  version.ts       hash of the daemon's source
  cli.ts           the original v0/v1 command-line prototype
  app/
    main.ts        Electron main process: daemon client, IPC, files, diffs
    git.ts         git + gh recipes (commit, push, pull, PRs, repo setup)
    preload.cjs    the bridge exposed to the UI as window.corral
  ui/
    App.tsx        layout, sidebar, terminals, file lists
    terms.ts       xterm instances (outside React), OSC 7 handler
    CodeView.tsx   CodeMirror viewer and side-by-side diff
    git.tsx        git panel, action dialogs, repo setup
    PrModal.tsx    pull request window
    Markdown.tsx   sanitized markdown for PR bodies and comments
scripts/
  build-icons.mjs  extracts the file icons used by the UI from vscode-icons
journey/           build log: state, versions, decisions, debt
```

## Where Corral keeps things

| Path | What |
| --- | --- |
| `~/.corral/pens/` | one git worktree per agent thread |
| `~/.corral/corrald.sock` | the daemon's socket |
| `~/.corral/corrald.log` | daemon log |
| `~/.corral/workspaces.json` | repos shown in the sidebar |
| `~/.corral/zsh/` | the injected zsh startup files |
| `~/.corral/status/` | agent status files written by hooks |

## Development

| Variable | Effect |
| --- | --- |
| `CORRAL_AGENT` | command used for agent threads (default `claude`); set on the daemon |
| `CORRAL_WEBGL=1` | use xterm's WebGL renderer |
| `CORRAL_SHOT=out.png` | screenshot the window after `CORRAL_SHOT_DELAY` ms, then quit |
| `CORRAL_SHOT_RESIZE=1` | resize the window during a screenshot run |
| `CORRAL_NODE` | Node binary used to start the daemon |

After changing the icon mappings, regenerate the icon set with `node scripts/build-icons.mjs`.

## Known gaps

- macOS and zsh only. Other shells work but don't report their folder.
- Status lamps only work for agents Corral launched, not for a `claude` you type into a shell.
- The file viewer doesn't refresh live while an agent edits the file.
- Shells don't have the git panel or file viewer yet.

More in [`journey/debt.md`](journey/debt.md).
