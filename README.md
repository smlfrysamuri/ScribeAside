<img src="images/icon.png" alt="ScribeAside icon" width="128" />

# ScribeAside

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/smlfrysamuri.scribeaside.svg?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=smlfrysamuri.scribeaside)
[![Open VSX](https://img.shields.io/open-vsx/v/smlfrysamuri/scribeaside?label=Open%20VSX)](https://open-vsx.org/extension/smlfrysamuri/scribeaside)
[![CI](https://github.com/smlfrysamuri/ScribeAside/actions/workflows/ci.yml/badge.svg)](https://github.com/smlfrysamuri/ScribeAside/actions/workflows/ci.yml)
[![License: GPL v3+](https://img.shields.io/github/license/smlfrysamuri/ScribeAside)](https://www.gnu.org/licenses/gpl-3.0)

A markdown notepad that lives beside your code. Type markdown and see it styled live — or hide the syntax entirely, or flip the page into a fully rendered view. No separate preview pane, no mode-switching ceremony.

<img src="images/demo.gif" alt="ScribeAside demo" width="363" />

## About this fork

ScribeAside is a **standalone fork** of [mdpad](https://github.com/tbekaert/vscode-mdpad), originally created by [tbekaert](https://github.com/tbekaert) and licensed under the GNU GPL v3.0 or later. It is now developed independently under the name **ScribeAside**, maintained by [smlfrysamuri](https://github.com/smlfrysamuri), who directs what gets built and reviews every change. The improvements over mdpad — the fully rendered reader mode, hidden-syntax editing, and the committable team-notes scope — were implemented with AI assistance; see [AI assistance](#ai-assistance) below.

It is not a drop-in upgrade: every command, setting, and storage key uses the `scribeaside.*` prefix, so ScribeAside does not read notes or configuration left behind by mdpad. Both projects remain GPL-3.0-or-later.

## Quick start

1. Install ScribeAside from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=smlfrysamuri.scribeaside) or [Open VSX](https://open-vsx.org/extension/smlfrysamuri/scribeaside)
2. Click the **ScribeAside icon** in the activity bar
3. Start typing markdown

Notes persist across restarts, scoped to the current workspace. Switch to **Global** for notes that follow you everywhere, or **Team** for notes committed to your repo.

## Three ways to see a page

| Mode | What you get | How |
| ---- | ------------ | --- |
| **Muted** (default) | Markdown characters stay visible but dimmed; content is styled live | Default |
| **Hidden** | Markers collapse on every line the cursor isn't touching, so the page reads as rendered while you edit | Set `scribeaside.syntaxMode` to `"hidden"` |
| **Reader** | Fully rendered, read-only — real heading sizes, tables, rules, highlighted code | `Cmd/Ctrl+Shift+V`, or the title-bar preview icon |

Hidden mode never touches the document text, so search, export, and copy/paste still see raw markdown. Task checkboxes stay visible (so they stay clickable), and code fences, table pipes, and frontmatter stay merely muted — collapsing those would leave blank lines or break visible alignment. Reader mode remembers itself across restarts; double-click to jump back into the editor.

## Features

### Writing

- **GFM** — headings, bold, italic, strikethrough, `==highlight==`, links, blockquotes, task lists, tables, fenced code, horizontal rules
- **Code blocks** — syntax highlighting for [19 languages](#supported-code-block-languages); typing ` ``` ` auto-inserts the closing fence
- **Lists** — `Tab` / `Shift+Tab` to indent and outdent, markers cycle by depth (`-` → `*` → `+`), ordered lists renumber automatically
- **Frontmatter** — type `---` at the top of a note to open a YAML block (the closing `---` is auto-inserted); `title:` overrides the derived page title
- **Tables** — columns realign as you type
- **Section folding** — collapse H2/H3 sections and frontmatter (enable via `scribeaside.folding`)

### Organizing

- **Multiple pages** — create, switch, and delete from the toolbar. Titles come from frontmatter `title:`, then the first heading, then the first line
- **Workspace & Global scopes** — global notes work in any workspace and can optionally ride VS Code Settings Sync (opt-in; once synced, the data cannot be removed from the remote)
- **Team notes** — a scope backed by real `.md` files in your repo, so notes can be committed and reviewed
- **Export & copy** — save the active note as `.md`, or copy a page into another scope
- **Editor tab** — **ScribeAside: Open in Editor** detaches the view into a full editor tab
- **Anywhere you want it** — drag the view into the Explorer, the secondary sidebar, or the bottom panel

#### How team notes behave

Workspace and global notes live in VS Code's internal storage, which is useless to your teammates. Team notes instead live in a folder (`.scribeaside` by default, see `scribeaside.teamNotesFolder`) as one markdown file per page. Run **ScribeAside: Switch to Team Notes** and you'll be offered the folder if it doesn't exist yet.

- **The filename is the page's identity**, and pages sort by filename. There is deliberately no index file — an index is a merge hotspot that conflicts on exactly the case the feature exists for. New pages are named `note-YYYYMMDD-HHmmss.md` and are never renamed on a title change, so git history stays intact
- **Which page you have open is yours alone** — stored per-user, never written into the folder, so switching pages never dirties your tree
- **Empty pages are not written** — create a page, never type in it, and no file appears
- **Outside edits are picked up** — another editor tab, a pull, a branch switch — the view updates in place without stealing your cursor. Unsaved keystrokes always win: an incoming change is skipped rather than clobbering them
- **Deleting the folder switches you out**, back to workspace notes, instead of quietly re-creating it
- **Conflicts are ordinary git conflicts** — last-writer-wins within a session, a normal one-file merge conflict across branches. No merge UI. Because pages are separate files, two people *adding* notes never conflict

### Interacting

- **Checkboxes** — click `[ ]` / `[x]` to toggle
- **Links** — `Cmd/Ctrl+click` to open URLs externally or file paths in the editor
- **Paste-as-link** — paste a URL over selected text to wrap it as `[text](url)`
- **Find** (`Cmd/Ctrl+F`) in the current note, **Search** (`Cmd/Ctrl+Shift+F`) across every page in every scope
- **Theme-aware** — adapts to any VS Code color theme, including high contrast

## Keyboard shortcuts

| Action | Shortcut | Action | Shortcut |
| ------ | -------- | ------ | -------- |
| Bold | `Cmd/Ctrl+B` | New page | `Cmd/Ctrl+N` |
| Italic | `Cmd/Ctrl+I` | Delete page | `Cmd/Ctrl+W` |
| Strikethrough | `Cmd/Ctrl+D` | Previous page | `Cmd/Ctrl+Shift+[` |
| Inline code | `Cmd/Ctrl+K` | Next page | `Cmd/Ctrl+Shift+]` |
| Highlight | `Cmd/Ctrl+E` | Reader mode | `Cmd/Ctrl+Shift+V` |
| Heading cycle | `Cmd/Ctrl+H` | Focus ScribeAside | `Cmd/Ctrl+Alt+M` |
| Find | `Cmd/Ctrl+F` | Indent / outdent list | `Tab` / `Shift+Tab` |
| Search pages | `Cmd/Ctrl+Shift+F` | Move / copy line | `Alt+↑↓` / `Shift+Alt+↑↓` |

Every shortcut except **Focus ScribeAside** is scoped to `when: scribeaside.focused`, so nothing fires while you're in a normal editor. `Cmd/Ctrl+Alt+M` is global — press it to jump into ScribeAside, press it again to jump back.

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `scribeaside.syntaxMode` | `"muted"` | `"muted"` dims markdown characters; `"hidden"` collapses them except on the cursor's line |
| `scribeaside.fontFamily` | `"inherit"` | Font family. `"inherit"` uses the VS Code theme font |
| `scribeaside.lineHeight` | `1.6` | Line height in the editor |
| `scribeaside.lineWrapping` | `true` | Wrap long lines |
| `scribeaside.lineNumbers` | `false` | Show line numbers in the gutter |
| `scribeaside.folding` | `false` | Enable section folding for H2, H3, and frontmatter |
| `scribeaside.listIndentSize` | `2` | Spaces per list indent level |
| `scribeaside.teamNotesFolder` | `".scribeaside"` | Folder for team notes, relative to the first workspace folder |
| `scribeaside.syncGlobalNotes` | `false` | Sync global notes via Settings Sync. Opt-in — synced data cannot be removed from the remote |

## Known limitations

**Uniform line heights.** Every editor line shares one height, so headings are distinguished by weight rather than size, and code uses a monospace font at body size. This is deliberate: CodeMirror's vertical cursor navigation is pixel-based and breaks when line heights vary — the cursor jumps or lands wrong once you've scrolled. Reader mode has no such constraint, which is where real heading sizes and rendered tables live.

**Code fence editing.** Clicking a ` ``` ` delimiter may snap the cursor inside the code block instead of onto the fence line — a CodeMirror behavior at the nested-parser boundary. Arrow keys reach the fence reliably.

## Supported code block languages

<details>
<summary>Full list of 19 languages with their fence aliases</summary>

| Language    | Fence aliases                            |
| ----------- | ---------------------------------------- |
| JavaScript  | `js`, `javascript`, `ecmascript`, `node` |
| TypeScript  | `ts`, `typescript`                       |
| JSX         | `jsx`                                    |
| TSX         | `tsx`                                    |
| Python      | `python`, `py`                           |
| JSON        | `json`, `json5`                          |
| HTML        | `html`, `xhtml`                          |
| CSS         | `css`                                    |
| LESS        | `less`                                   |
| Sass        | `sass`, `scss`                           |
| SQL         | `sql`                                    |
| XML         | `xml`, `rss`, `wsdl`, `xsd`              |
| Rust        | `rust`, `rs`                             |
| Java        | `java`                                   |
| C / C++     | `cpp`, `c++`, `c`                        |
| PHP         | `php`                                    |
| Go          | `go`, `golang`                           |
| YAML        | `yaml`, `yml`                            |
| Markdown    | `markdown`, `md`                         |

</details>

## Contributing

Contributions welcome. Clone the repo and press `F5` to launch a development host; paste `.github/test-content.md` into ScribeAside for manual QA. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

```bash
git clone https://github.com/smlfrysamuri/ScribeAside.git
cd ScribeAside
pnpm install
```

Before opening a PR:

```bash
pnpm lint && pnpm test:unit && pnpm test:e2e && pnpm test:integration
```

## AI assistance

The code in this fork — feature implementation, test coverage, the rebrand from mdpad to ScribeAside, and this documentation — was written by Anthropic's Claude (via Claude Code), working from the maintainer's direction on what to build and how it should behave. Every change was reviewed, tested, and accepted by the maintainer before landing.

## License

GPL-3.0-or-later. Original work © the [mdpad](https://github.com/tbekaert/vscode-mdpad) authors; fork changes © the ScribeAside contributors. See [LICENSE](LICENSE).
