<img src="images/icon.png" alt="mdpad icon" width="128" />

# mdpad

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/tbekaert.mdpad.svg?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=tbekaert.mdpad)
[![Open VSX](https://img.shields.io/open-vsx/v/tbekaert/mdpad?label=Open%20VSX)](https://open-vsx.org/extension/tbekaert/mdpad)
[![Installs](https://vsmarketplacebadges.dev/installs-short/tbekaert.mdpad.svg?label=Installs)](https://marketplace.visualstudio.com/items?itemName=tbekaert.mdpad)
[![CI](https://github.com/tbekaert/vscode-mdpad/actions/workflows/ci.yml/badge.svg)](https://github.com/tbekaert/vscode-mdpad/actions/workflows/ci.yml)
[![License: GPL v3+](https://img.shields.io/github/license/tbekaert/vscode-mdpad)](https://www.gnu.org/licenses/gpl-3.0)

A lightweight markdown notepad inside VS Code. Type markdown and see it styled live — syntax stays visible but dimmed, content is formatted as you write.

<img src="images/demo.gif" alt="mdpad demo" width="363" />

## Quick Start

1. Install mdpad from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tbekaert.mdpad) or [Open VSX](https://open-vsx.org/extension/tbekaert/mdpad)
2. Click the **mdpad icon** in the activity bar (left side)
3. Start typing markdown

That's it. Your notes persist across restarts, per workspace. Toggle to **Global** scope for notes that follow you across all workspaces.

## Features

### Writing

#### Muted-syntax editing

Markdown characters (`#`, `**`, `*`, `` ` ``, `~~`, `==`) stay visible but dimmed. Content is styled live — headings are bold, bold is bold, code is monospace, and `==highlighted text==` gets a yellow background.

#### Hidden-syntax editing

Set `mdpad.syntaxMode` to `"hidden"` and the markers disappear on every line the cursor is not touching, so a page reads as rendered while you edit it. Move the cursor onto a line and its markers come back, ready to edit.

Headings, bold, italic, strikethrough, inline code, highlights, links, blockquote `>` prefixes, and task-list bullets all collapse. Task checkboxes (`[ ]` / `[x]`) stay visible so they remain clickable, and code fences, table pipes, and frontmatter stay muted — hiding those would leave blank lines or break the visible table alignment. The document text never changes, so search, export, and copy/paste still see the raw markdown.

#### Rendered view (reader mode)

Press `Cmd/Ctrl+Shift+V` (or click the preview icon in the title bar) to flip the current page into a fully rendered, read-only view — real heading sizes, real tables, horizontal rules, and syntax-highlighted code blocks, like the built-in markdown preview but living wherever mdpad lives, including the sidebar. Press `Cmd/Ctrl+Shift+V` again (or double-click the page, or click the edit icon) to jump back into the editor.

While reading, links open with a single click, checkboxes are shown but not clickable, and external edits to team-notes files re-render in place. The view you chose is remembered across restarts.

#### Frontmatter

Type `---` at the top of a note to create a YAML frontmatter block. Keys are muted, values stay readable. The closing `---` is auto-inserted.

Use `title:` to set a custom page title that overrides the auto-derived one:

```yaml
---
title: My Custom Title
---
```

#### Lists

- Bullet and numbered list markers are styled with muted syntax
- **Tab / Shift+Tab** to indent and outdent list items
- Unordered lists automatically cycle markers by depth: `-` → `*` → `+`
- Ordered lists renumber automatically when indenting or outdenting

#### Code blocks

Fenced code blocks get syntax highlighting for 19 languages including JavaScript, TypeScript, Python, JSON, HTML, CSS, SQL, Rust, Go, Java, C/C++, and more — see the [full list below](#supported-code-block-languages). Typing ` ``` ` auto-inserts the closing fence.

#### Section folding

Collapse H2 and H3 sections and frontmatter blocks (enable via `mdpad.folding` setting). Click the chevron at the right end of a foldable line to fold/unfold. Only sections with content can be folded.

#### GFM support

Headings, bold, italic, strikethrough, links, blockquotes, task lists, fenced code blocks, tables, and horizontal rules.

### Organizing

#### Workspace & Global notes

Notes default to workspace scope — tied to the current project. Click the scope toggle in the title bar to switch to global notes, accessible from any workspace. The page picker lists notes from every available scope. Optionally sync global notes across devices via VS Code Settings Sync (opt-in, disabled by default).

#### Team notes

Workspace and global notes live in VS Code's internal storage, which is fine for you and useless for your team. Team notes instead live as plain markdown files in a folder inside your repo, one file per page, so they can be committed and reviewed like anything else.

Run **mdpad: Switch to Team Notes** to get started. If the folder (`.mdpad` by default, see `mdpad.teamNotesFolder`) does not exist yet, mdpad offers to create it. Once it exists, the title-bar scope toggle cycles Workspace → Global → Team. Use **mdpad: Copy Page To...** to move a note you already have into the team folder.

How it behaves:

- **The filename is the page's identity**, and pages are ordered by filename. New pages are named `note-YYYYMMDD-HHmmss.md` and are *not* renamed when you change a note's title, so git history stays intact. Displayed titles still come from the note's content.
- **Which page you have open is yours alone.** It is stored per-user in workspace state, never written into the folder, so switching pages never dirties your working tree.
- **Empty pages are not written.** Create a page and never type in it, and no file appears.
- **Edits from outside are picked up.** Change a note in a normal editor tab, pull a teammate's commit, or switch branches, and the view updates in place — without stealing your cursor. What you are typing always wins: if you have unsaved keystrokes, the incoming change is skipped rather than overwriting them, and your version is saved a moment later.
- **Deleting the folder switches you out.** Remove the folder in the Explorer, or check out a branch without it, and mdpad falls back to workspace notes instead of quietly re-creating it.
- **Conflicts are ordinary git conflicts.** Two people editing the same page at the same time is last-writer-wins within a session; across branches it is a normal merge conflict in one file. There is no merge UI. Because pages are separate files, two people *adding* notes never conflict at all.

#### Multiple pages

Create, switch, and delete note pages from the toolbar dropdown. Page titles are derived from the frontmatter `title:` field, or the first heading, or the first line of content.

#### Export

Run **mdpad: Export Current Page** to save the active note as a `.md` file.

#### Editor tab

Run **mdpad: Open in Editor** from the command palette to open mdpad as a standalone editor tab. This detaches it from the sidebar view.

#### Placing mdpad

mdpad lives in its own activity bar icon by default. You can drag it to any location in VS Code:

- **Explorer sidebar** — drag the mdpad view into the Explorer panel
- **Secondary sidebar** — drag it to the right side panel for side-by-side with code
- **Bottom panel** — drag it next to Terminal and Problems

To move: right-click the mdpad view header and select **Move View To...**, or simply drag and drop.

### Interacting

#### Keyboard shortcuts

| Action          | Shortcut                       |
| --------------- | ------------------------------ |
| Bold            | `Cmd/Ctrl+B`                   |
| Italic          | `Cmd/Ctrl+I`                   |
| Strikethrough   | `Cmd/Ctrl+D`                   |
| Inline code     | `Cmd/Ctrl+K`                   |
| Highlight       | `Cmd/Ctrl+E`                   |
| Heading cycle   | `Cmd/Ctrl+H`                   |
| Find            | `Cmd/Ctrl+F`                   |
| Search pages    | `Cmd/Ctrl+Shift+F`             |
| New page        | `Cmd/Ctrl+N`                   |
| Previous page   | `Cmd/Ctrl+Shift+[`             |
| Next page       | `Cmd/Ctrl+Shift+]`             |
| Delete page     | `Cmd/Ctrl+W`                   |
| Reader mode     | `Cmd/Ctrl+Shift+V`             |
| Focus mdpad     | `Cmd/Ctrl+Alt+M`               |
| Indent list     | `Tab`                          |
| Outdent list    | `Shift+Tab`                    |
| Move line up    | `Alt+↑`                        |
| Move line down  | `Alt+↓`                        |
| Copy line up    | `Shift+Alt+↑`                  |
| Copy line down  | `Shift+Alt+↓`                  |

All formatting and page shortcuts are scoped to `when: mdpad.focused` so they only fire when the mdpad editor has focus. The **Focus mdpad** shortcut (`Cmd/Ctrl+Alt+M`) is global — press it to jump to mdpad from anywhere, or press again to return to your editor.

#### Interactive elements

- **Checkboxes** — click the rendered `[ ]` or `[x]` to toggle task list items
- **Links** — `Cmd+click` (Mac) or `Ctrl+click` (Windows/Linux) to open URLs or file paths in the editor
- **Paste-as-link** — paste a URL over a text selection to auto-wrap it as `[text](url)`
- **Tables** — columns align automatically as you type

#### Search

- **Find in note** (`Cmd/Ctrl+F`) — search within the current page
- **Search across pages** (`Cmd/Ctrl+Shift+F`) — search content across all pages in every available scope

#### Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `mdpad.fontFamily` | `"inherit"` | Font family. `"inherit"` uses the VS Code theme font. |
| `mdpad.lineHeight` | `1.6` | Line height in the editor. |
| `mdpad.lineWrapping` | `true` | Wrap long lines. |
| `mdpad.folding` | `false` | Enable section folding for H2, H3, and frontmatter. |
| `mdpad.listIndentSize` | `2` | Spaces per list indent level. |
| `mdpad.lineNumbers` | `false` | Show line numbers in the gutter. |
| `mdpad.syntaxMode` | `"muted"` | How markdown syntax characters are rendered — `"muted"` dims them, `"hidden"` collapses them except on the line the cursor is on. |
| `mdpad.teamNotesFolder` | `".mdpad"` | Folder for team notes, relative to the first workspace folder. One markdown file per page. |
| `mdpad.syncGlobalNotes` | `false` | Sync global notes across devices via Settings Sync. Opt-in — once synced, data cannot be removed from the remote. |

#### Theme-aware

Adapts to any VS Code color theme — dark, light, or high contrast.

## Known Limitations

### Uniform line heights

All lines in the editor share the same height. Headings are distinguished by bold weight, not font size. Inline code and code blocks use a monospace font but at the same size as body text. (Reader mode has no such constraint — it is not an editor — which is where large headings and rendered tables live.)

This is a deliberate constraint: CodeMirror's vertical cursor navigation (arrow keys) uses pixel-based calculations that break when lines have different heights (from varying font sizes, padding, or margins). The issue becomes noticeable when scrolled — the cursor can jump multiple lines or land in the wrong position.

### Code block fence editing

Clicking on a fenced code block delimiter (` ``` `) may snap the cursor inside the code block rather than onto the fence line itself. This is a CodeMirror behavior related to how nested language parsers handle the boundary between the fence and the code content. You can still edit fences by placing the cursor with arrow keys.

## Supported code block languages

<details>
<summary>Full list of 19 languages with their fence aliases</summary>

| Language    | Fence aliases                         |
| ----------- | ------------------------------------- |
| JavaScript  | `js`, `javascript`, `ecmascript`, `node` |
| TypeScript  | `ts`, `typescript`                    |
| JSX         | `jsx`                                 |
| TSX         | `tsx`                                 |
| Python      | `python`, `py`                        |
| JSON        | `json`, `json5`                       |
| HTML        | `html`, `xhtml`                       |
| CSS         | `css`                                 |
| LESS        | `less`                                |
| Sass        | `sass`, `scss`                        |
| SQL         | `sql`                                 |
| XML         | `xml`, `rss`, `wsdl`, `xsd`           |
| Rust        | `rust`, `rs`                          |
| Java        | `java`                                |
| C / C++     | `cpp`, `c++`, `c`                     |
| PHP         | `php`                                 |
| Go          | `go`, `golang`                        |
| YAML        | `yaml`, `yml`                         |
| Markdown    | `markdown`, `md`                      |

</details>

## Contributing

Contributions welcome! Clone the repo and press `F5` to launch the extension in a development host. Use `.github/test-content.md` for manual QA — paste it into mdpad to verify all features. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

```bash
git clone https://github.com/tbekaert/vscode-mdpad.git
cd vscode-mdpad
pnpm install
```

Before submitting a PR, verify your change:

```bash
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm test:integration
```

## License

GPL-3.0-or-later
