---
"scribeaside": minor
---

Remember where you had scrolled to. Collapsing the sidebar destroys the webview, so a note used to come back at the top of itself no matter how far down you had been reading; now it reopens where you left it. The same applies to switching pages and back, to reloading the window, and to reader mode, which also stops jumping to the top when someone else edits the file you are reading.

Positions are kept per note for the fifty notes visited most recently, and the editor's is stored as a line rather than a pixel offset, so resizing the sidebar while it was hidden still brings you back to the same place.
