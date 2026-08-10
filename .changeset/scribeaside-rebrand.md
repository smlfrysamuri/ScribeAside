---
"scribeaside": minor
---

Rebrand to **ScribeAside**, a standalone fork of [mdpad](https://github.com/tbekaert/vscode-mdpad) by tbekaert, now maintained by smlfrysamuri. Both remain GPL-3.0-or-later.

**Breaking:** every identifier moved from the `mdpad.*` prefix to `scribeaside.*` — commands, settings, context keys, the view and panel IDs, and the stored notes state. Nothing under the old prefix is read, so custom keybindings and settings must be updated by hand:

- Settings: `mdpad.syntaxMode` → `scribeaside.syntaxMode`, and likewise for `fontFamily`, `lineHeight`, `lineWrapping`, `folding`, `listIndentSize`, `lineNumbers`, `teamNotesFolder`, and `syncGlobalNotes`.
- Commands: `mdpad.newPage` → `scribeaside.newPage`, and so on for every command. The palette category is now **ScribeAside**.
- Team notes: the default folder is `.scribeaside` instead of `.mdpad`. Point `scribeaside.teamNotesFolder` at `".mdpad"` to keep using an existing committed folder.
- Workspace and global notes are stored under a new key and a new extension ID, so they do not carry over from an mdpad install. Export the pages you want to keep before switching.
