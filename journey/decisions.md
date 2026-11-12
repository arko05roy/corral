# decisions
- 2026-11-12: TS on Node 26, native type stripping, zero deps.
- 2026-11-12: v0 isolation = full `cp -r` of repo per task (user pick, honor-system prompts rejected as fragile).
- 2026-11-12: UI = Electron (user pick over local web page), same shape as Paradev.
- 2026-11-12: node-pty for PTYs; our own postinstall chmods spawn-helper (1.1.0 ships it non-executable; its install scripts don't fix it).
- 2026-11-12: xterm.js for the panel emulator (user pick over hand-rolling). Input box removed: raw keystrokes go straight to the PTY.
