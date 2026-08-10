---
title: ScribeAside Feature Test
tags: test
---

# Welcome to the Feature Test

This note tests every ScribeAside feature. Work through each section.

## Text Formatting

Here is **bold text**, *italic text*, ~~strikethrough~~, `inline code`, and ==highlighted text==.

Try the shortcuts: select a word and press Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+Shift+`, Ctrl+Shift+E.

## Lists

### Unordered

- First item
- Second item
  * Nested with different marker
    + Deeply nested

### Ordered

1. Step one
2. Step two
  1. Sub-step A
  2. Sub-step B
    1. Deep sub-step
    2. Another deep one
  3. Sub-step C
3. Step three

### Tasks

- [x] Completed task
- [ ] Uncompleted task
  - [x] Nested completed
  - [ ] Nested uncompleted
    - [ ] Deeply nested task
- [ ] Click the brackets to toggle

Try Tab/Shift+Tab on any list item to indent/outdent.

## Code Blocks

```ts
const greet = (name: string): string => {
  // This should be syntax highlighted
  return `Hello, ${name}!`
}
```

```python
def fibonacci(n: int) -> list[int]:
    """Generate fibonacci sequence."""
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result
```

## Links

- [External link](https://github.com) — Cmd/Ctrl+click to open in browser
- [File link](./README.md) — Cmd/Ctrl+click to open in editor
- Select this text and paste a URL to test paste-as-link

## Blockquote

> This is a blockquote.
> It can span multiple lines.

## Table

| Feature      | Status | Priority |
| ------------ | ------ | -------- |
| Bold         | Done   | High     |
| Highlight    | Done   | Medium   |
| Folding      | Done   | Low      |

## Horizontal Rule

---

## Search Test

This section contains the word banana for search testing. Try Cmd/Ctrl+F to find it in this note, or Cmd/Ctrl+Shift+F to search across all pages.

## Heading Cycle Test

Place your cursor on the line below and press Ctrl+Shift+H repeatedly:

This line will cycle through heading levels

## Empty Section Below

### This heading has no content — it should NOT be foldable

## Syntax Mode Test

Set `scribeaside.syntaxMode` to `hidden` and read back through this note. On every line the cursor is not on:

- Heading `#` prefixes, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==`, `[link](url)` brackets, `> ` quote prefixes, and `- ` task bullets should all be gone.
- Task checkboxes `[ ]` should still be visible and still clickable.
- Table pipes, code fences, and the frontmatter `---` lines should be unchanged.

Nested tasks must keep their indentation, and nothing inside the Code Blocks section above may change — a fenced block must render exactly the characters it contains in both modes.

Move the cursor onto a line and its markers must come back immediately. Arrow up and down through the Lists and Code Blocks sections — the cursor must land where it looks like it should, with no skipped or doubled lines. Then set the setting back to `muted` and confirm the note renders exactly as it did before.

## Team Notes Test

Needs a real workspace folder. Work through in order:

1. With no `.scribeaside` folder present, confirm the title-bar icon still toggles Workspace ↔ Global as it always has, and the page picker lists only those two scopes.
2. Run **ScribeAside: Switch to Team Notes** and accept the prompt. The folder appears, the view switches, and the title-bar icon now cycles through three scopes.
3. Type into the team page. After about a third of a second a `note-YYYYMMDD-HHmmss.md` file appears in `.scribeaside` containing what you typed.
4. Create a page and do not type in it. No file appears — that is deliberate, not a bug.
5. Open that `.md` file in a normal editor tab, change it, and save. The ScribeAside view updates to match, and your cursor stays where it was.
6. Delete a page from ScribeAside: the file disappears. Delete a file from the explorer: the page disappears and the view moves to a neighbour.
7. Run **ScribeAside: Copy Page To...** from Workspace scope, pick Team, and confirm a new file appears while the view stays put.
8. Set `scribeaside.teamNotesFolder` to `notes` while in Team scope. With no `notes` folder present the scope falls back to Workspace and the cycle drops to two stops.

## Reader Mode Test

Work through with this note open:

1. Press `Cmd/Ctrl+Shift+V` (or the title-bar preview icon). The page re-renders like the built-in markdown preview: `# Welcome to the Feature Test` becomes a large heading, the Table section becomes a real bordered table, `---` becomes a horizontal rule, the fenced blocks above are syntax-colored, and `==highlighted text==` has its yellow background with no `==` visible.
2. Task checkboxes render as real checkboxes — checked ones checked — but do not respond to clicks. That is deliberate; flip back to the editor to toggle them.
3. Single-click a link: it opens (external URL in the browser, relative path in an editor tab) without the page navigating away.
4. While reading, press `Cmd/Ctrl+B` and the other formatting shortcuts — nothing may change. Flip back and confirm the content is byte-identical.
5. Double-click anywhere in the rendered page — you are back in the editor. Press `Cmd/Ctrl+Shift+V` twice and confirm both directions work from the keyboard.
6. In reader mode, switch pages with the title-bar arrows: each page arrives rendered. Then collapse and re-expand the sidebar view: it must come back still in reader mode.
7. In Team scope with reader mode on, edit the current page's file in a normal editor tab and save. The rendered view updates in place.
