---
"scribeaside": minor
---

Follow VS Code's markdown preview typography settings. `markdown.preview.fontFamily`, `markdown.preview.fontSize`, and `markdown.preview.lineHeight` now style both the editor and reader mode, so the appearance you configured for the built-in preview does not have to be configured a second time.

The fallback is per key and never overrides ScribeAside: a `scribeaside.*` value you set always wins, and the preview setting is consulted only for the keys you left alone. Defaults on either side do not count as an answer, so an install that has configured neither renders exactly as before.

Also new:

- `scribeaside.fontSize` — a CSS size (`"15px"`, `"1.1em"`) or a bare number of pixels, for a note font size independent of the markdown preview's.
- Reader mode now honours `scribeaside.fontFamily`, `scribeaside.fontSize`, and `scribeaside.lineHeight`, which previously only reached the editor.
