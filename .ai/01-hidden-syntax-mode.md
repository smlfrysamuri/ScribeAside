# 01 — Hidden-syntax rendering mode

Adds an optional `scribeaside.syntaxMode` setting with values `muted` (today's behaviour, the default) and
`hidden`. In hidden mode the markdown marker characters on lines the cursor is not touching are
collapsed with zero-width `Decoration.replace({})`, so a page reads as rendered while staying a plain
text buffer. Default users see no change at all: muted mode must emit a byte-identical decoration set
and must not pay a single extra rebuild. The tree is shippable when this doc's checkpoint is green.

## What you are building

| Piece | Home file | Role |
|---|---|---|
| `SyntaxMode` | `src/webview/types.ts` (new type) | `'muted' \| 'hidden'`, added to `ScribeAsideSettings` |
| `DecorationEntry` / `MarkerConstruct` | `src/webview/hiddenRanges.ts` (new) | Tagged intermediate the scan pass emits instead of finished ranges |
| `computeActiveLines` / `mergeRanges` / `isRevealed` / `materialize` | `src/webview/hiddenRanges.ts` | Pure, DOM-free helpers — the whole selection-aware half, unit-testable under plain Mocha |
| `scanDecorations` | `src/webview/decorations.ts` | Today's `buildDecorations` body, retargeted to emit entries |
| `markdownDecorations(mode)` | `src/webview/decorations.ts` | Plugin **factory** replacing today's plugin constant; caches the scan, re-materializes on selection change in hidden mode only |
| `scribeaside.syntaxMode` | `package.json`, `extension.ts`, `editor.ts`, tests, README | The setting, through the repo's 9-touchpoint checklist |

The pure helpers live in their own file rather than in `decorations.ts` because `decorations.ts`
pulls in `@codemirror/language`'s `syntaxTree` and the whole GFM node vocabulary; the merge and
active-line arithmetic is the part with real edge cases and it deserves a unit test that constructs
nothing heavier than an `EditorState`.

## Why replace decorations, and why line-granular reveal

CSS `display: none` was rejected. CodeMirror's coordinate system (`posAtCoords`, `coordsAtPos`, and
`drawSelection`, which this editor enables at `src/webview/editor.ts:636`) measures live DOM, so an
invisible-but-present span still occupies a position in the measurement model and produces caret
glitches. `Decoration.replace` is CodeMirror's first-class collapse mechanism and leaves the document
text untouched, so copy/paste, `searchLines`, `deriveTitle`, storage, and the two click handlers in
`src/webview/decorations.ts:446-505` all keep working unchanged — they read `state.doc`, never the DOM.

No `atomicRanges`. Hidden ranges only ever exist on lines no selection range touches, and arriving on
a line — by arrow key or by click — reveals it inside the same view update, so the cursor never dwells
inside a collapsed range. Replace decorations do not change document offsets either, so there is no
position mapping to write.

Reveal is keyed on the selection alone, not on `view.hasFocus`. That means line 1 of a freshly opened
note shows its markers, because `init` leaves the cursor at position 0. This matches Obsidian's Live
Preview and keeps the rebuild predicate a pure function of `state`, which is what makes the muted-mode
no-op guarantee checkable.

## Facts you'll rely on

`Decoration.replace` returns a *point* decoration. Two point decorations that partially overlap are
not a well-defined rendering, so the materializer merges the hidden ranges before emitting any — after
merging, partial overlap is impossible by construction. This matters because the current builder
already emits duplicate `muted` ranges from two known sources: the deeply-nested-list fallback pass
(`src/webview/decorations.ts:365-371`) re-runs `decorateListItem` on lines the tree walk skipped, and
the `==highlight==` regex pass (`:390-409`) runs over line text without knowing whether the match sits
inside a link whose URL span is already muted.

Inline replace decorations may be supplied from a `ViewPlugin`; *block* replaces and replaces that
cover a line break may not. Every marker range this builder produces is contained in one line, and
merging can never bridge a newline — two ranges merge when `next.from <= last.to`, and the first
position of line N+1 is `line(N).to + 1`, never `line(N).to`.

Ordering is load-bearing for the byte-identical guarantee. `buildDecorations` sorts by `from` only
(`:411`) and then hands the array to `Decoration.set(…, true)`, which sorts again by
`(from, startSide)`. Both sorts are stable, so ties resolve to the original push order, and the push
order decides DOM nesting. Muted mode therefore has to walk the entry list in emission order and
convert one-for-one — any regrouping is a behaviour change even when every range is identical.

`Decoration.mark` throws on an empty range. The existing helpers guard this (`:250-253`, `:402`); the
materializer adds the same guard for replaces so a zero-width merge result can never reach CodeMirror.

## Steps

### Step 1 — `src/webview/types.ts`: the mode type

- [x] Add `export type SyntaxMode = 'muted' | 'hidden'`.

- [x] Add `syntaxMode: SyntaxMode` to `ScribeAsideSettings` (`:26-33`).

This lands first because `hiddenRanges.ts`, `decorations.ts`, `editor.ts`, and `extension.ts` all
name the type, and nothing resolves until it exists.

### Step 2 — `src/webview/hiddenRanges.ts`: the pure half

Create the file. It imports `Decoration` and `Range` from `@codemirror/view` / `@codemirror/state`
and `EditorState` as a type only — no `syntaxTree`, no DOM.

- [x] `export type MarkerConstruct` — the string union
  `'heading' | 'emphasis' | 'link' | 'highlight' | 'task' | 'blockquote' | 'ol' | 'hr' | 'fence' | 'table' | 'frontmatter'`.
  One tag per site in the current builder that pushes a muted range.

- [x] `export const HIDEABLE_CONSTRUCTS: ReadonlySet<MarkerConstruct>` — `heading`, `emphasis`,
  `link`, `highlight`, `task`, `blockquote`. Everything else stays muted in hidden mode; the
  per-construct reasoning is in the table below.

- [x] `export interface CharRange { from: number; to: number }` — a half-open-ish span used for both
  active lines and hidden ranges; both ends are treated as inclusive by `isRevealed`.

- [x] `export type DecorationEntry` — a discriminated union:

```ts
export interface StyleEntry {
  kind: 'style'
  range: Range<Decoration>
}

export interface MarkerEntry {
  kind: 'marker'
  from: number
  to: number
  construct: MarkerConstruct
  deco: Decoration
  hideFrom?: number
  hideTo?: number
}
```

  `StyleEntry` carries a finished `Range` because content styling is mode-independent and re-deriving
  it would risk drift. `MarkerEntry` keeps `from`/`to` loose because the materializer decides what to
  do with them, and carries `deco` because not every marker uses the plain `muted` mark — headings use
  `headingPrefixMark`, which is `scribeaside-muted scribeaside-heading` (`src/webview/decorations.ts:33-35`).

  `hideFrom`/`hideTo` let the collapsed span differ from the muted span, defaulting to `from`/`to`.
  Two constructs need it, and both were caught by the paired review rather than by this doc's first
  draft:

  - **Tasks.** `taskListPattern`'s first capture group is `^(\s*[-*+]\s+)` — it swallows the leading
    indentation. Collapsing the whole muted span therefore renders `  - [ ] nested` flush left, and a
    three-level task list loses every level of nesting while a plain bullet list beside it keeps all
    of them. `hideFrom` starts the collapse at the first non-space character.

  - **Nested blockquotes.** `blockquotePrefixPattern` matches one `> `, so `> > inner` would collapse
    the outer marker and strand the inner one. `hideTo` extends the collapse across the full
    `/^(?:>\s?)+/` prefix. Muted mode still dims only the first, exactly as before.

- [x] `export const mergeRanges = (ranges: readonly CharRange[]): CharRange[]` — sort a copy by
  `(from, to)`, then fold: extend the last output range when `next.from <= last.to`, else start a new
  one. Merges overlapping, nested, duplicate, and touching ranges. Never mutates the input.

- [x] `export const computeActiveLines = (state: EditorState): CharRange[]` — for each range in
  `state.selection.ranges`, emit `{from: doc.lineAt(range.from).from, to: doc.lineAt(range.to).to}`,
  then `mergeRanges` the result. Skip the second `lineAt` when `range.to` is already inside the first
  line — that is the collapsed-cursor case, which is every keystroke.

- [x] `export const isRevealed = (from, to, active: readonly CharRange[]): boolean` — true when the
  span touches any active range: `!(to < r.from || from > r.to)`. Inclusive at both ends so a marker
  ending exactly at the active line's last position counts as revealed, while the first position of
  the next line does not.

- [x] `export const materialize = (entries, mode, active): Range<Decoration>[]`.

  1. Muted mode: map the entries in order — `style` yields its stored range, `marker` yields
     `deco.range(from, to)`. Return immediately. This branch is the byte-identity guarantee, so it
     must not sort, filter, or regroup.

  2. Hidden mode: walk the entries once, pushing style ranges and non-hideable or revealed markers to
     the output in place, and collecting the rest into a `hidden` array.

  3. `mergeRanges(hidden)`, then append one `Decoration.replace({})` range per merged span, skipping
     any span where `to <= from`.

  A module-level `const hiddenMark = Decoration.replace({})` is reused for every span; the decoration
  is stateless.

### Step 3 — `src/webview/decorations.ts`: scan/materialize split

- [x] Add two local push helpers above the per-node helpers so each call site stays one line:
  `pushStyle(out, deco, from, to)`, `pushLine(out, deco, at)` (line decorations are `deco.range(at)`
  with `to === from`), and `pushMarker(out, from, to, construct, deco = muted)`.

- [x] Change every `decorate*` helper's first parameter from `decorations: Range<Decoration>[]` to
  `entries: DecorationEntry[]` and convert each push, preserving order exactly. The classification:

  - `decorateHeading` (`:60-77`) — prefix → `pushMarker(…, 'heading', headingPrefixMark)`; the
    `headingMarks[level]` range → `pushStyle`.

  - `decorateStrongEmphasis`, `decorateEmphasis`, `decorateStrikethrough`, `decorateInlineCode`
    (`:79-133`) — both delimiter ranges → `'emphasis'`; the content mark → `pushStyle`.

  - `decorateLink` (`:135-151`) — all four muted ranges (`[`, `](`, the URL, `)`) → `'link'`; the
    `linkTextMark` range → `pushStyle`. The three trailing ranges are adjacent and will merge into one
    replace; the leading `[` stays its own span because `linkTextMark` sits between them and style
    entries do not participate in merging.

  - `decorateBlockquote` (`:153-171`) — the per-line `Decoration.line` → `pushLine`; the `> ` prefix →
    `'blockquote'` with `hideTo` at the end of the full nested prefix.

  - `decorateListItem` (`:175-223`) — the task-marker prefix → `'task'` with `hideFrom` past the
    indent;
    the `scribeaside-task-bracket` and `scribeaside-task-checked` marks → `pushStyle`; the unordered bullet
    (`listBulletMark`) → `pushStyle`, it is not a muted marker today; the ordered-list number → `'ol'`.

  - `decorateHorizontalRule` (`:225-234`) — the muted span → `'hr'`; the line class → `pushLine`.

  - `decorateFencedCode` (`:236-259`) — the fence-line muted spans → `'fence'`; `scribeaside-code-line` →
    `pushLine`.

  - `decorateTable` (`:261-294`) — separator row and every `|` → `'table'`; the header and line
    classes → `pushLine`.

  - The frontmatter block inside the builder (`:373-388`) → `'frontmatter'`.

  - The `==highlight==` pass (`:390-409`) — the two `==` spans → `'highlight'`; the content mark →
    `pushStyle`.

- [x] Collect a `codeLines: Set<number>` during the tree walk, from both `FencedCode` and `CodeBlock`
  nodes, and tag anything the two whole-document passes emit on those lines with the non-hideable
  construct `'code'`.

  ⚠ This is the step that silently corrupts a document if you skip it. The fallback list pass
  (`:365-371`) and the highlight pass run over raw line text and cannot tell code from prose, so a
  fence containing `- [ ] not a task` gets a `'task'` marker. In muted mode that was a cosmetic dimmed
  `- ` inside a code block; in hidden mode it **deletes characters from the rendered code block**,
  which reads as ScribeAside corrupting code rather than as a decoration-tagging bug. Caught by the paired
  review, not by this doc's first draft.

- [x] Rename `buildDecorations` to `scanDecorations(view: EditorView): DecorationEntry[]`, returning
  the entry array. Drop the trailing sort and `Decoration.set` from it — those move to the plugin.

- [x] Add `const buildSet = (entries, state, mode): DecorationSet`: call `materialize` with
  `mode === 'hidden' ? computeActiveLines(state) : EMPTY_ACTIVE`, sort the result by `from` (the same
  `(a, b) => a.from - b.from` as today), and return `Decoration.set(ranges, true)`.

- [x] Replace the exported plugin constant with a factory:

```ts
export const markdownDecorations = (mode: SyntaxMode) =>
  ViewPlugin.fromClass(
    class {
      entries: DecorationEntry[]
      decorations: DecorationSet
      ...
    },
    { decorations: v => v.decorations },
  )
```

  The instance keeps `entries` alongside `decorations`. `update` computes
  `structural = update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)`
  — the existing predicate verbatim (`:427-435`) — and:

  1. On `structural`, re-scan and rebuild.

  2. Otherwise, when `mode === 'hidden' && update.selectionSet`, rebuild from the cached entries
     without re-scanning.

  3. Otherwise do nothing.

  In muted mode branch 2 is unreachable, so the plugin's work per update is identical to today's.

### Step 4 — `src/webview/editor.ts`: registration moves into its own compartment

- [x] Add a module-level `const decorationPlugins: Record<SyntaxMode, Extension>` built once from
  `markdownDecorations('muted')` and `markdownDecorations('hidden')`.

  Build both eagerly and reuse them. A `ViewPlugin` value is compared by identity when a compartment
  is reconfigured, so a settings message that does not change the mode leaves the plugin instance —
  and its cached scan — untouched. Calling the factory at reconfigure time instead would destroy and
  reconstruct the plugin on every `settings` message, and `sendInitToActive`
  (`src/extension.ts:78-87`) sends one on every page switch.

- [x] Add a second `Compartment`, `syntaxModeExtension`, and wrap the existing `markdownDecorations`
  slot at `:649` with `syntaxModeExtension.of(decorationPlugins.muted)`.

  **Deviation from the original plan, which put the plugin inside `buildSettingsExtensions`.**
  Extension-list position decides decoration precedence, which decides DOM nesting when two marks
  cover the same range. Moving the plugin into the settings compartment would have hoisted it above
  `syntaxHighlighting(codeHighlight)` (`:634`), reordering the nesting of code-highlight spans against
  `scribeaside-inline-code` and `scribeaside-task-bracket` — a real muted-mode change, and exactly what the
  byte-identity guarantee exists to prevent. A dedicated compartment at the original position is
  reconfigurable and keeps the order.

- [x] `applySettings` (`:670-677`) dispatches both reconfigure effects in one transaction.

- [x] Add `syntaxMode: 'muted'` to the inline defaults at `:624-631`.

⚠ The `attachClickHandlers` call at `:659` stays exactly where it is. It binds to `view.dom`, not to
the plugin, so it survives every reconfigure and is mode-agnostic. If it were moved into the
compartment it would be re-bound on each settings message and checkbox clicks would fire once per
accumulated listener — which reads as "clicking a checkbox toggles it twice", not as a settings bug.

### Step 5 — `src/extension.ts`: read the setting

- [x] In `getSettings` (`:57-67`), add
  `syntaxMode: config.get<SyntaxMode>('syntaxMode', 'muted')`, importing the type from
  `./webview/types`.

### Step 6 — `package.json`: contribute the setting

- [x] Add to `contributes.configuration.properties` (`:314-350`):

```json
"scribeaside.syntaxMode": {
  "type": "string",
  "enum": ["muted", "hidden"],
  "enumDescriptions": [
    "Markdown characters stay visible but dimmed.",
    "Markdown characters are hidden except on the line the cursor is on."
  ],
  "default": "muted",
  "description": "How markdown syntax characters are rendered."
}
```

This is the repo's first `enum` setting; `enumDescriptions` is positional and must stay aligned with
`enum`.

### Step 7 — test-side settings plumbing

- [x] `src/test/e2e/utils.ts` — add `syntaxMode: 'muted' | 'hidden'` to the duplicated `ScribeAsideSettings`
  interface (`:3-10`) and `syntaxMode: 'muted'` to `DEFAULT_SETTINGS` (`:12-19`). The duplicate exists
  because the e2e project is excluded from `tsconfig.json`; it has to be updated by hand.

- [x] `src/test/unit/settings.test.ts` — add `syntaxMode` to both `applySettings` object literals
  (`:53-61`, `:74-81`); use `'hidden'` in the first so the reconfigure path is exercised with a
  non-default mode.

### Step 8 — hidden-mode unit tests

- [x] New `src/test/unit/hiddenRanges.test.ts`, plain Mocha, no jsdom:

  - `mergeRanges`: empty input; single range; disjoint; overlapping; touching (`to === next.from`);
    nested; duplicate; unsorted input; input not mutated.

  - `computeActiveLines`: collapsed cursor mid-line; selection spanning three lines; two disjoint
    cursors on non-adjacent lines; cursor at position 0 of an empty document.

  - `isRevealed`: marker inside the active line; marker at the active line's last position; marker at
    the first position of the following line; multi-range active list.

  - `materialize`: muted mode returns one range per entry in input order and never emits a replace;
    hidden mode leaves style entries alone, keeps non-hideable constructs muted, merges two adjacent
    hideable markers into a single replace, and drops a zero-width span.

### Step 9 — hidden-mode e2e

Each of these sends `{syntaxMode: 'hidden'}` through the existing `initEditor` settings parameter. The
cursor sits at position 0 after `init`, so **line 1 is always revealed** — every hiding assertion has
to target line 2 or later, or it will fail for the right reason and look like the feature is broken.

- [x] `src/test/e2e/decorations.spec.ts`, new `describe('decorations — hidden mode')`: heading prefix,
  bold/italic/strike/inline-code delimiters, `==` pairs, link brackets and URL, blockquote `> `, and
  the task `- ` are absent from the rendered line text; the `[ ]` bracket, table pipes, fence
  backticks, and frontmatter `---` are still present; clicking into a hidden line reveals it and
  arrowing away re-hides it; a selection spanning three lines reveals all three.

- [x] `src/test/e2e/settings.spec.ts`: toggling `syntaxMode` from `muted` to `hidden` and back through
  a `settings` message changes the rendered text both ways, with content unchanged
  (`getEditorContent`).

- [x] `src/test/e2e/interactions.spec.ts`: checkbox click and `Ctrl+click` on a link, both on a hidden
  (non-cursor) line, behave exactly as in muted mode.

- [x] `src/test/e2e/folding.spec.ts`: fold and unfold an H2 section in hidden mode. Fold ranges start
  at `line.to` and heading markers start at `line.from`, so they should compose; this case is what
  proves it rather than assuming it.

- [x] `src/test/e2e/perf.spec.ts`: a hidden-mode keystroke test on the same 5000-line document, and a
  cursor-move (`ArrowDown`) test that exercises the materialize-only path. Same 50 ms budget. Leave
  the existing default-mode test untouched — it is the control.

## Checkpoint

Run from `X:\.github\ScribeAside`:

- [x] `pnpm lint` — see the caveat below
- [x] `pnpm compile`
- [x] `pnpm webpack`
- [x] `pnpm test:unit` — 168 passing
- [x] `pnpm test:e2e` — 123 passing
- [x] `pnpm test:integration` — 20 passing

⚠ `pnpm lint` cannot pass in a Windows checkout with `core.autocrlf=true`: the index stores LF, the
working tree holds CRLF, and Biome's formatter reports every line of every file — including files no
change touched. Confirm with `git ls-files --eol src/NotesStorage.ts` (`i/lf w/crlf`). To get a real
signal, copy `src/` to a scratch directory, strip `\r`, and run
`biome check <copy>/src --config-path <copy>`. That was done here: the only remaining diagnostics are
the two pre-existing warnings (`noUnusedFunctionParameters` on `mdFoldService`'s `lineEnd`,
`noImportantStyles` ×4 in `styles.css`). CI runs on Linux and is unaffected.

Item order matters here, and the first two items are the control:

1. **The pre-existing decoration suite passes unchanged.** `decorations.spec.ts`'s original tests and
   `perf.spec.ts`'s original test were not edited; they are what proves muted mode is byte-identical
   after the scan/materialize split. If a new hidden-mode test fails while these pass, the split is
   sound and only the new path is wrong.

2. **`perf.spec.ts` prints its `perf: median=…` line and the median is under 50 ms in default mode.**
   Same test, same doc, same budget as before this doc.

3. Hidden-mode e2e assertions above are green, including the fold case.

4. Hidden-mode keystroke and cursor-move medians are inside budget. The two hidden-mode tests time
   the **synchronous dispatch only**: awaiting `requestMeasure` puts a ~16.7 ms floor (one 60 Hz
   frame) under every sample, which is what the first draft of these tests measured — all three
   medians came out at 16.7 ms because that is the frame period, not the work. The default-mode test
   keeps its original rAF-inclusive form so it stays a stable control.

   Measured: muted keystroke 16.8 ms (rAF-inclusive control), hidden keystroke 8.8 ms, hidden cursor
   move 3.1 ms. The cursor-move path lands well under the keystroke path exactly as predicted — no
   tree walk, one linear pass over the cached entries — and it gets a tighter 25 ms budget because
   that is the new code path.

5. **Manual F5 smoke, both modes, in the real sidebar — OUTSTANDING, needs a human.** The e2e suite runs the same bundle but in a
   plain page, not inside a webview inside a sidebar view, so it cannot prove the immutable
   requirement. Open the ScribeAside view, paste `.github/test-content.md`, and in each mode confirm:
   text renders, arrow-key navigation up and down through headings and lists lands where it looks
   like it should, clicking a checkbox toggles it once, and `Ctrl+click` on the two links works.
   Then switch `scribeaside.syntaxMode` live in Settings and confirm the view re-renders without a reload.

## What comes next

- **Team notes (`02`)** is fully independent of this doc — different files, no shared state. It only
  waits on this one because both touch `package.json` and `extension.ts`, and taking A's small edits
  first makes B's larger refactor a clean rebase.

- **Checkbox widgets, hidden fences, hidden table pipes, and a CSS horizontal rule** are deliberately
  out. Each needs a `WidgetType` or a layout change, which is the one category the immutable
  sidebar requirement will not absorb on faith; `[ ]` stays visible precisely because it keeps
  click-to-toggle working with zero new machinery. Hiding fence lines also leaves a confusing blank
  line where the fence was, and hiding pipes destroys the alignment `tableFormatter` maintains.

- **Focus-gated reveal** — hiding line 1's markers when the editor is not focused — is a real
  refinement and cheap (`update.focusChanged` already exists), but it makes the decoration set a
  function of something other than `state`, which is exactly what the muted-mode no-op guarantee is
  checked against. Worth revisiting once hidden mode has real usage.

- **Viewport-limited materialization** is the reserve lever if the cursor-move budget ever fails on
  slower CI hardware. Not built now because the measured path is a single linear pass and building it
  speculatively would add a viewport dependency to a function that is currently pure.

Everything lands bare per the repo's conventions — the reasoning stays in this doc, not in the code.
