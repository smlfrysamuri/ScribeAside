---
"mdpad": minor
---

Add team notes: a third note scope backed by a folder of markdown files in your workspace, so notes can be committed and shared with a team. Run **mdpad: Switch to Team Notes** and mdpad offers to create the folder (`.mdpad` by default, configurable via `mdpad.teamNotesFolder`); after that the title-bar scope toggle cycles Workspace → Global → Team, and the page picker and cross-page search cover all three.

One markdown file per page, with the filename as the page's identity and no index file, so two people adding notes on separate branches merge without conflicts. Which page you have open is stored per-user and never written into the folder. Edits made outside mdpad — another editor tab, a pull, a branch switch — are picked up in place without stealing focus. Empty pages are not written to disk. Conflicting edits to the same page are last-writer-wins and surface as an ordinary git conflict; there is no merge UI.

Also adds **mdpad: Copy Page To...** for moving an existing note into another scope.
