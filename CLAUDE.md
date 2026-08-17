# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

ScribeAside is a VS Code extension for writing markdown notes directly inside the editor. It uses a muted-syntax approach: markdown characters stay visible but dimmed, while content is styled live (headings are large, bold is bold, etc.). Optional hidden-syntax and fully rendered reader modes sit on top of that.

Lineage: the abandoned `sidebar-markdown-notes` extension was rewritten with CodeMirror 6 as `mdpad` by tbekaert; ScribeAside is a standalone fork of `mdpad` maintained by smlfrysamuri. Everything is GPL-3.0-or-later. Identifiers use the `scribeaside` prefix throughout — no `mdpad.*` command, setting, or storage key is read for backwards compatibility.

## Commands

```bash
# Development
pnpm webpack          # Build both bundles (development mode)
pnpm webpack-dev      # Build + watch mode

# Quality
pnpm lint             # Biome check on src/
pnpm format           # Biome auto-fix on src/

# Tests
pnpm test:unit        # Mocha unit tests
pnpm test:e2e         # Playwright e2e tests (webview + mocked VS Code API)
pnpm test:e2e:ui      # Playwright UI mode for debugging
pnpm test:integration # VS Code integration tests

# Test in VS Code
# Press F5 — launches extension host with the "watch" build task

# Release
pnpm changeset         # Create a changeset for your changes
pnpm changeset status  # Show pending changesets
```

## Architecture

Two webpack bundles from one config file:

**Extension host** (`dist/extension.js`, target: node):
- `src/extension.ts` — Entry point. `activate` is async (it probes the team-notes folder before registering anything) and `deactivate` returns a promise (it flushes pending team-notes writes). Triple storage (workspace + global + team) routed through a `Record<Scope, ScopeEntry>` registry — add a scope by adding a row, never by adding a ternary arm. Settings Sync for global notes. Commands: `openInEditor`, `focusNotes`, `newPage`, `deletePage`, `previousPage`, `nextPage`, `exportPage`, `copyPageTo`, `switchToGlobal/Workspace/Team`, `refreshTeamNotes`, `enterReaderMode`/`exitReaderMode` (`Cmd/Ctrl+Shift+V` toggles via complementary `when` clauses), `toggleBold/Italic/Strikethrough/Code/Highlight/Heading`. Reader-mode state is host-owned (`globalState['scribeaside.readerMode']` + context key), pushed to the webview as `{type: 'setReaderMode'}`; the webview never flips itself. Settings and reader state are re-sent on every webview `ready` (the `onReady` handler) because sidebar webviews are torn down on collapse. Formatting commands post a `{type: 'command', command}` message to the active webview — keybindings live in `package.json` (all scoped to `when: scribeaside.focused`) so formatting works uniformly as `Cmd/Ctrl+letter` and page actions (`Cmd/Ctrl+N` new, `Cmd/Ctrl+W` delete, `Cmd/Ctrl+Shift+[` / `Cmd/Ctrl+Shift+]` prev/next) fire only while the scribeaside webview is focused on both macOS and Windows/Linux.
- `src/SidebarProvider.ts` — `WebviewViewProvider` for the Explorer sidebar. Accepts storage getter for scope switching.
- `src/PanelProvider.ts` — Singleton `WebviewPanel` for floating editor. Exclusive mode: only sidebar or panel active at a time. Accepts storage getter for scope switching.
- `src/storageTypes.ts` — `INotesStorage`, the structural contract both storages satisfy. Host-only; never import it from `webview/`.
- `src/NotesStorage.ts` — CRUD over any `vscode.Memento` (workspaceState or globalState). Cached reads. Stores `{ pages: Page[], activeId }`.
- `src/FileNotesStorage.ts` — the same contract over a folder of `.md` files, walked recursively (`MAX_DEPTH` 8, symlinked directories skipped). Synchronous cache, per-page 300 ms debounced writes, `flush()` on shutdown and scope switch, `refresh()` for the user-triggered reload, and a `**/*` watcher whose self-write suppression is by **content comparison** (a "we just wrote" flag has timing to get wrong; content does not). The watcher glob is deliberately not `**/*.md`: a deleted *subfolder* is reported as the folder's own uri, and `handleExternalDelete` needs that event to drop the pages beneath it. Four invariants hold the durability story together, and each one exists because breaking it loses data silently: `getState()` never writes; writes for one page are **chained, never concurrent**, so they cannot land out of order or escape `flush()`; a delete waits for any in-flight write and is gated on `writing` as well as `onDisk`; and every write probes the folder first, because `workspace.fs.writeFile` would otherwise re-create a folder the user deleted.
- `src/notePaths.ts` — pure helpers over the relative-path page ids team notes use (`dirOf`, `baseOf`, `joinId`, `childFolders`, `comparePageIds`, `isSafeRelativeId`). Host-side only; the memento scopes never produce a `/`, so every helper degrades to "the whole id is the filename".
- `src/typography.ts` — pure `resolveTypography`, the one place ScribeAside reads another extension's settings: `markdown.preview.fontFamily/fontSize/lineHeight` fill in per key where no `scribeaside.*` value answers. Only **explicitly set** values count on either side, which is why `extension.ts` feeds it `inspect()` results rather than `get()` — a default would make every install look configured and lock the fallback out forever. `inherit` is the "nobody answered" marker it returns, not a CSS keyword.
- `src/slug.ts` — `slugify` (shared with `exportPage`), `timestampFileName`, `uniqueFileName`.
- `src/deriveTitle.ts` — Page title derivation: frontmatter `title:` field > first heading > first non-empty line. Skips frontmatter block.
- `src/searchLines.ts` — Shared search helper for find-in-note and search-across-pages.
- `src/handleWebviewMessage.ts` — Shared message handler used by both providers.
- `src/getWebviewHtml.ts` — HTML generation with nonce-based CSP.

**Webview** (`dist/webview.js`, target: web):
- `src/webview/index.ts` — Entry point. Mounts editor, handles postMessage, owns the reader-mode container and its guards.
- `src/webview/editor.ts` — CodeMirror 6 with GFM, VS Code theme, list indent/outdent (`Tab`/`Shift-Tab`), ordered-list continuation on `Enter`, paste-as-link, auto-close fences. Uses a `codeMirrorSettings` Compartment for live setting reconfiguration (line numbers, line wrapping, folding). Typography is deliberately *not* in that compartment: font family, font size and line height are read from the `--scribeaside-font-*`/`--scribeaside-line-height` custom properties in the static `vsCodeTheme`, so one source styles both the editor and the reader. Formatting shortcuts (bold/italic/strike/code/highlight/heading) are NOT in the CodeMirror keymap — they are handled by the extension host via `package.json` keybindings and the `ScribeAsideCommand` message protocol; `src/webview/index.ts` applies them with `wrapSelection` / `toggleHeading`.
- `src/webview/decorations.ts` — Syntax-decoration ViewPlugin, built as a factory `markdownDecorations(mode)`. `scanDecorations` walks the tree and the regex passes once and emits *tagged entries*; `materialize` turns entries into ranges per mode. Click handlers for checkboxes and links read `state.doc`, never the DOM, so they work in both modes.
- `src/webview/hiddenRanges.ts` — the pure, DOM-free half of hidden mode: `mergeRanges`, `computeActiveLines`, `isRevealed`, `materialize`, and the `HIDEABLE_CONSTRUCTS` policy. Unit-tested with nothing heavier than an `EditorState`.
- `src/webview/editor.ts` contains section folding: `foldService` for H2/H3/frontmatter fold ranges, `foldGutter` (with line numbers), inline `FoldWidget` (without line numbers).
- `src/webview/codeLanguages.ts` — Eagerly loaded language grammars for syntax highlighting in fenced code blocks.
- `src/webview/listPatterns.ts` — Shared regex patterns and constants for list handling.
- `src/webview/tableFormatter.ts` — Auto-aligns table columns on 500ms debounce after edits.
- `src/webview/renderer.ts` — `renderMarkdown` for reader mode: markdown-it (`html: false`, so raw HTML is escaped) + markdown-it-mark + a local disabled-checkbox task-list rule; fenced code highlighted with the same `codeLanguages` grammars via `classHighlighter` (`tok-*` classes styled in CSS with the same theme variables as the editor's `codeHighlight` palette). While reading, the webview drops `command`/`setCursor` messages and re-renders on `init`/`replaceContent`; double-click posts `exitReaderMode`.
- `src/webview/typography.ts` — writes the host-resolved font family, size and line height onto the root element as custom properties, and *removes* a property when the value is `inherit` so the `:root` default in `styles.css` (the VS Code font) applies again. Called before `applySettings`, whose dispatch is what schedules CodeMirror's re-measure for the new metrics.
- `src/webview/styles.css` — All styles: layout, VS Code CSS variable mapping, decoration classes. The `:root` block holds the typography defaults `src/webview/typography.ts` overrides.
- `src/webview/types.ts` — Shared types: Page, NotesState, ScribeAsideSettings, message protocol.

**E2E tests** (`src/test/e2e/`, target: browser via Playwright):
- `harness.html` — standalone HTML with mocked `acquireVsCodeApi` that loads `dist/webview.js`. Used by Playwright tests to exercise the webview outside VS Code.
- `utils.ts` — shared helpers: `initEditor`, `sendMessage`, `getPostedMessages`, `getCursorPos`, etc.
- `*.spec.ts` — one file per feature domain (e.g. `lists.spec.ts`, `shortcuts.spec.ts`, `decorations.spec.ts`, `settings.spec.ts`). See conventions below.

The webview exposes its `EditorView` on `window.__scribeasideView` for test inspection.

## Key Design Decision

**Muted syntax is the default and must stay byte-identical.** All markdown characters stay visible but dimmed using `--vscode-editorLineNumber-foreground`. No widget replacements, no raw mode toggle. This avoids layout jumps, cursor issues, and CPU spikes from the original Typora-style approach.

`scribeaside.syntaxMode: "hidden"` is opt-in on top of that: markers on lines no selection touches are collapsed with zero-width `Decoration.replace({})`, revealing again the moment the cursor arrives. Two rules make it safe to keep:

- **Muted mode must emit the identical decoration set, in the identical order.** Order decides DOM nesting, so `materialize`'s muted branch walks entries in emission order and converts one-for-one. Anything that regroups, sorts, or filters there is a behaviour change even when every range is the same. The same reason keeps the decoration plugin in its own `Compartment` at its original position in `createEditor`'s extension list rather than inside `buildSettingsExtensions` — moving it would reorder decoration precedence against `syntaxHighlighting`.
- **Hidden ranges are merged before any replace is emitted**, which makes partial overlap between two replace decorations impossible by construction. Markers never span a line break, and nothing inside a code block is ever collapsed — hidden mode must not change what a code block appears to contain.

A marker's muted span and its hidden span can differ (`hideFrom`/`hideTo`): a task bullet mutes its whole `  - ` prefix but collapses only the bullet, or nested tasks flatten to the left margin.

**Uniform line heights.** All lines must have the same height — no per-line `font-size`, `line-height`, `padding`, `margin`, or `border` that would change a line's height. CodeMirror's vertical cursor navigation (arrow keys) uses pixel-based calculations that break with inconsistent line heights, especially when scrolled. Headings are distinguished by `font-weight` only, not size. Inline code and code blocks use monospace font but no size change.

## Settings Sync

Global notes can optionally be synced across devices via VS Code's Settings Sync (`context.globalState.setKeysForSync`). This is **opt-in** (disabled by default via `scribeaside.syncGlobalNotes`) because there is no VS Code API to remove data from the sync remote once it's been synced. Disabling the setting stops future syncing but does not delete already-synced data.

## Team notes

The third scope is backed by a folder of `.md` files (`scribeaside.teamNotesFolder`, default `.scribeaside`) so a team can commit them. **The path relative to that folder is `Page.id`** — `note.md` at the top level, `design/spec.md` one down, always `/`-separated — and ordering is the alphabetical path sort. There is deliberately no index file, because an index is a merge hotspot that conflicts on exactly the case the feature exists for (two people adding notes). Files are never renamed on a title change; that would rewrite git history for a cosmetic edit.

The same comparator (`comparePageIds`) must sort `load()`'s flattened walk and place `insertPage`'s new pages, or the in-memory list stops matching what a fresh load would produce. Ids coming off disk or out of a watcher event pass `isSafeRelativeId` before they are joined back onto a Uri. Name collisions are resolved **per folder**, so two folders may each hold a note created in the same second without one growing a `-2` suffix.

`activeId` is per-user (`workspaceState['scribeaside.teamActiveId']`) and never written into the folder. Conflict policy is last-writer-wins, documented in the README; there is no merge UI.

`scribeaside.refreshTeamNotes` rebuilds the storage through `reloadTeamStorage` rather than calling `FileNotesStorage.refresh()`, because the folder may not have existed when the window opened (no storage object yet) and a watcher that missed events is a plausible reason to be running the command at all. `switchToTeam` re-probes a storage that reports unavailable for the same reason: a stale "missing" answer would offer to create a folder that is already there.

`scribeaside.teamNotesView` (`tree` default, `flat`) only affects `selectPage`. Tree mode filters the current scope's pages to one directory and offers `childFolders` plus a `..` entry; other scopes are appended at the top level only, so opening a folder is not buried under two unrelated note lists.

## Naming

- Product name: always PascalCase `ScribeAside` in user-facing text (UI, docs, commit messages) and in TypeScript type names (e.g. `ScribeAsideSettings`). Lowercase `scribeaside` is the identifier form only — command IDs, settings keys, context keys, CSS classes.
- Command prefix: `scribeaside` (use `category: "ScribeAside"` in package.json, not a title prefix)
- View ID: `scribeaside.notesView`
- Panel ID: `scribeaside.panel`
- Storage keys: `scribeaside.notes` (memento scopes), `scribeaside.teamActiveId` (per-user team page pointer)
- Context keys: `scribeaside.focused`, `scribeaside.inEditor`, `scribeaside.scope` (`workspace` | `global` | `team`), `scribeaside.teamAvailable`, `scribeaside.readerMode`
- Storage keys (global): `scribeaside.readerMode` (display preference, not a workspace setting)

## Manual QA

- `.github/test-content.md` — exercises every scribeaside feature. Copy-paste into scribeaside for manual QA. **Keep updated** when adding features.
- `.github/welcome-content.md` — the default welcome note shown to new users. **Keep in sync** with `WELCOME_CONTENT` in `src/NotesStorage.ts` when updating either.

## Conventions

- Biome for linting and formatting (via `@bekaert-dev/biome-config` shared preset).
- Changesets for versioning: **every commit that changes user-facing behavior or fixes a bug MUST include a changeset file.** Run `pnpm changeset` to create one before committing. The release workflow creates a version PR on push to main, and publishes to both marketplaces on merge.
- License: GPL-3.0-or-later.

### E2E test organization

- **One spec file per feature domain**, not per difficulty or depth. File name = feature (e.g. `lists.spec.ts` covers all list behavior: continuation, indent/outdent, ordered, tasks, deep nesting).
- **Edge cases live in the same file** as the happy path, grouped under a `describe('<feature> — edge cases')` block. Do not create separate `*-edge-cases.spec.ts` files.
- **Decoration/CSS-class assertions go in `decorations.spec.ts`** regardless of which markdown construct they test.
- **Settings propagation goes in `settings.spec.ts`** (font, line numbers, list indent size, etc.), because it cuts across features. Feature-specific settings tests (e.g. the `folding` toggle) stay with the feature.
- **Inter-process protocol tests go in `messaging.spec.ts`** (host ↔ webview messages, debounce, ready signal).
- Inside a file, split tests into `describe('<feature> — <sub-area>')` blocks rather than splitting across files. Example: `lists.spec.ts` has describes for `basic indent/outdent shortcuts`, `continuation on Enter`, `unordered deep nesting`, `ordered indent/outdent`, `task lists`, `tab edge cases`.
