# 05 — Reader mode

Adds a rendered read-only view of the active page — real heading sizes, real tables, horizontal
rules, highlighted code blocks — that the sidebar and panel can flip into and out of. The editor
keeps its uniform-line-height constraint because it must; the reader is plain HTML in the same
webview, so it has no such constraint. This is the piece that lets ScribeAside replace the native markdown
preview for people who want it docked in a sidebar.

Also fixes a latent bug found while surveying: on webview `ready` the host sends only `init`, never
`settings` (`src/handleWebviewMessage.ts:12-13`), so a freshly resolved sidebar runs on default
settings until the next scope switch or configuration change.

## What you are building

| Piece | Home file | Role |
|---|---|---|
| `renderMarkdown` | `src/webview/renderer.ts` (new) | Pure `string → string` HTML renderer: markdown-it, GFM parity with the editor (tables, strikethrough, task lists, `==highlight==`, autolink), lezer-highlighted fences |
| `setReaderMode` message | `src/webview/types.ts` | Extension → webview `{ type: 'setReaderMode'; enabled }` |
| `exitReaderMode` message | `src/webview/types.ts` | Webview → extension, posted on double-click in the rendered view |
| Reader container + guards | `src/webview/index.ts` | Lazily created `#reader` div; while active, `command` and `setCursor` messages are ignored and `init`/`replaceContent` re-render |
| `onReady` callback | both providers + `handleWebviewMessage.ts` | Lets the extension push settings and reader state after every webview `ready` — the latent-bug fix |
| `scribeaside.enterReaderMode` / `scribeaside.exitReaderMode` | `package.json`, `extension.ts` | Two commands so the title-bar icon can differ per state (`$(open-preview)` / `$(edit)`); both bound to `Ctrl/Cmd+Shift+V` with complementary `when` clauses, giving toggle semantics |
| Reader state | `extension.ts` | Host-owned boolean, persisted in `globalState['scribeaside.readerMode']`, mirrored to context key `scribeaside.readerMode`, pushed to the webview |
| Reader styles | `src/webview/styles.css` | Preview-grade typography under `#reader`, `tok-*` token colors mirroring the editor palette |

## Design constraints

- **The document is never mutated by the reader.** `renderMarkdown` reads the editor's doc; edits
  cannot happen while the editor is hidden. Flipping back is lossless by construction.
- **Host owns the mode.** The webview never flips itself; double-click posts `exitReaderMode` and the
  host round-trips the change. One source of truth means the title-bar icon, context key, keybinding
  `when` clauses, and webview can never disagree.
- **No CSP change, no new webview capability** (the sidebar-safety invariant). Raw HTML in notes is
  escaped (`html: false`); `linkify` and markdown-it's default `validateLink` reject `javascript:`.
  Images still do not load — the CSP has no `img-src`, unchanged.
- **Checkboxes render disabled**, exactly like the native preview. Toggling from the rendered view
  needs source-position mapping and is out of scope; the editor's click-to-toggle is one flip away.
- **Reader state is global, not per-scope** — it is a display preference like the syntax mode, and
  `globalState` is where those live when they are not workspace settings.

## Facts you'll rely on

- The editor's fence palette (`src/webview/editor.ts:323-405`) maps lezer tags to
  `--vscode-debugTokenExpression-*` / `--vscode-symbolIcon-*` variables. The reader uses
  `classHighlighter` from `@lezer/highlight`, whose fixed `tok-keyword`, `tok-string`, … classes get
  the same variables in CSS, so both surfaces color code identically.
- `codeLanguages` (`src/webview/codeLanguages.ts`) already eagerly constructs every
  `LanguageSupport`; `LanguageDescription.matchLanguageName` resolves fence info strings, and
  `support.language.parser.parse(code)` needs no async loading.
- markdown-it's `highlight` option: returning a string that starts with `<pre` replaces the whole
  fence; returning `''` falls back to escaped plain text — that is the unknown-language path.
- Injected `html_inline` tokens render their `content` verbatim regardless of `html: false`; the
  option gates the parser, not the renderer. That is how the task-list checkbox is emitted.
- Sidebar webviews are torn down on collapse and re-resolved on expand, so anything not re-sent on
  `ready` is lost — the reason the `onReady` hook, not activation order, carries settings and
  reader state.
- `handleWebviewMessage`'s `openLink` case (`src/handleWebviewMessage.ts:23-41`) already opens
  http(s) externally and relative paths as workspace text documents; the reader's click handler
  reuses it, so cross-links between `.ai` docs open in the editor just as the editor surface does.

## Steps

### Step 1 — dependencies

- [x] `pnpm add markdown-it markdown-it-mark`, `pnpm add -D @types/markdown-it`. `markdown-it-mark`
  ships no types: declare the module in `src/global.d.ts`.

### Step 2 — `src/webview/renderer.ts`

- [x] `renderMarkdown(md: string): string`. markdown-it with `html: false`, `linkify: true`,
  `highlight` = the lezer fence path above. Plugins: `markdown-it-mark`; a local core rule after
  `inline` that turns a leading `[ ] ` / `[x] ` text child of a `list_item_open → paragraph_open →
  inline` sequence into a disabled checkbox `html_inline` token and tags the item
  `scribeaside-task-item`.

### Step 3 — protocol and webview

- [x] `types.ts`: add both messages.
- [x] `index.ts`: `setReaderMode(enabled)` toggles `scribeaside-reader-active` on `<body>`, lazily creates
  `#reader` with a click handler (anchors → `openLink` post, default prevented) and a dblclick
  handler (→ `exitReaderMode` post). While active: `init`/`replaceContent` still update the editor
  but skip `focus()` and re-render the reader; `command` and `setCursor` are dropped. On
  deactivate: `requestMeasure()` then `focus()` — the editor was `display: none` and CodeMirror
  must re-measure.

### Step 4 — ready pipeline

- [x] `handleWebviewMessage` gains an optional `onReady` callback invoked in the `ready` case after
  `sendInit`. Both providers accept it as a constructor parameter and forward it. The extension
  passes one that sends settings and the current reader state to the active surface.

### Step 5 — extension host

- [x] `applyReaderMode(enabled)`: module-let boolean + `globalState.update` + `setContext` + post
  `setReaderMode` to the active surface. Register both commands. Wire the webview's
  `exitReaderMode` message through the providers' new callback to `applyReaderMode(false)`.

### Step 6 — `package.json`

- [x] Two command entries with icons; two `view/title` navigation menu entries gated on
  `scribeaside.readerMode`; two `Ctrl/Cmd+Shift+V` keybindings gated on `scribeaside.focused` and complementary
  `scribeaside.readerMode` values.

### Step 7 — styles

- [x] `#reader` hidden by default; `.scribeaside-reader-active` shows it and hides `#editor`. Typography:
  stepped heading sizes with the native preview's bottom borders on h1/h2, spaced paragraphs and
  lists, bordered tables with header emphasis, background-tinted `pre` blocks with x-scroll,
  blockquote border, `<mark>` matching `.scribeaside-highlight`, links in
  `--vscode-textLink-foreground`, `tok-*` colors copied variable-for-variable from the editor
  palette.

### Step 8 — tests and docs

- [x] `src/test/unit/renderer.test.ts`: headings, table structure, task checkboxes (checked,
  unchecked, disabled), `==mark==`, raw-HTML escaping, `javascript:` link rejection, fenced code
  with known and unknown languages.
- [x] `src/test/e2e/reader.spec.ts`: enter/leave via `setReaderMode`, editor hidden while active,
  rendered h1/table present, `init` re-render while active, command messages dropped while active,
  dblclick posts `exitReaderMode`, anchor click posts `openLink` instead of navigating.
- [x] Integration command list +2. README (feature section + command), CLAUDE.md, welcome content
  (both copies), test-content QA section, changeset `reader-mode` (`"scribeaside": minor`).

## Checkpoint

- [x] `pnpm lint`, `pnpm compile`, `pnpm webpack`
- [x] `pnpm test:unit` — 233 passing
- [x] `pnpm test:e2e` — 140 passing
- [x] `pnpm test:integration` — 24 passing
- [x] Independent review agent over the full diff; four should-fix findings, all resolved before
  close: `ready` responses now target the provider that fired them (a background panel was
  swallowing a re-expanded sidebar's settings) and land before `init`; double-clicking a link opens
  it once instead of opening twice and exiting; bare emails are not autolinked and `mailto:` opens
  externally; accepting a find/search result exits reader mode so the cursor jump is not dropped.

1. **Control: `messaging.spec.ts` unchanged-green** — the reader shares the message switch with
   every existing message; this suite is the guard that the guards only bite in reader mode.
2. Manual, in VSCodium: flip both directions from the title bar and the keybinding; confirm the
   status-bar page navigation re-renders the reader; confirm an external edit to a team-scope file
   re-renders while reading.

## What comes next

- **Scroll-position sync between the two views** — needs a source-line ↔ rendered-element map
  (markdown-it `token.map` carries it), deferred until the plain flip proves annoying.
- **Click-to-edit at the clicked paragraph** — same map, same reason.
- **Checkbox toggling from the rendered view** — same map again; today the editor is one
  `Ctrl+Shift+V` away.
- **Images** stay blocked by the CSP unless `img-src` is deliberately added and reviewed against
  the sidebar-safety invariant.
