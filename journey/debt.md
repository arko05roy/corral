# debt
- No cleanup cmd: pens + branches leak; rerunning the same task crashes on "branch already exists".
- createPen throw at startup is uncaught (app dies silently).
- nodeIntegration on / contextIsolation off in renderer (insecure shortcut; needs preload bridge).
- Fixed 100x30 terminal size; no resize when window changes.
- Claude folder-trust prompt on every new pen.
- cli.ts duplicates pens.ts.
- Pens are naked (.env, node_modules missing); ports shared.
