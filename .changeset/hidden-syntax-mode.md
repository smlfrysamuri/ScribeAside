---
"scribeaside": minor
---

Add an optional hidden-syntax rendering mode. Set `scribeaside.syntaxMode` to `"hidden"` and markdown markers — heading `#` prefixes, emphasis delimiters, highlight `==`, link brackets and URLs, blockquote `>` prefixes, and task bullets — collapse on every line the cursor is not touching, so a page reads as rendered while you edit it. Task checkboxes stay visible and clickable; code fences, table pipes, and frontmatter stay muted. The document text is never modified, so search, export, and copy/paste still see the raw markdown. The default `"muted"` mode is unchanged.
