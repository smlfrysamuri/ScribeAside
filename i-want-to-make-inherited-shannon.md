# mdpad: hidden-syntax rendering mode + git-shareable team notes

## Context

`mdpad` (X:\.github\vscode-mdpad) is a VS Code extension for markdown notes in the sidebar/panel, built on CodeMirror 6 with a **muted-syntax** approach (markers visible but dimmed). Zach wants:

1. **(Top priority) An optional hidden-syntax rendering mode** — markdown markers (`#`, `**`, `==`, `[](…)`) hidden while editing, so pages read as rendered.
2. **Git-shareable team notes** — notes stored as files a team can commit to a repo, instead of only VS Code's internal Memento storage.
3. **Process compliance with the scaffolding-guidance standard** (`X:\Escamote\.ai\meta\scaffolding-discipline.md`), adapted for agent-authored code: staged `.ai` docs per checkpoint that agents implement from.

**Immutable requirement:** the extension MUST keep rendering correctly in the sidebar webview. Any sub-feature that would break sidebar operation gets rescoped or dropped.

Zach cannot review TypeScript himself, so every implementation agent (including me when I write code directly) is paired with an independent review agent, maximally parallelized.

## Locked design decisions (confirmed by Zach)

| Decision | Choice |
|---|---|
| Hidden-mode cursor behavior | **Reveal on active line** (Obsidian Live Preview style): markers hidden except on lines touched by cursor/selection |
| Typography | **Uniform line heights kept** — headings stay same-size/weight-only; hidden mode only removes marker characters (the old `headingScale` feature was deleted in commit `6d9acee` for breaking CM6 pixel-based cursor navigation; we do not reintroduce that bug class) |
| Team storage shape | **New third scope backed by a folder of .md files** in the workspace (`.mdpad/` by default), one file per page, git-diffable |
| Process | **Staged `.ai` docs in the repo, one per checkpoint**, per the discipline (survey-verified citations, ordered steps, consumer sweep, self-verifiable checkpoints, "what comes next"); implementation agents build FROM the docs; items checked off as work lands |

## Survey facts the plan is built on (verified 2026-08-09)

- `src/webview/decorations.ts`: single ViewPlugin `markdownDecorations` (`:419-440`), only `Decoration.mark`/`Decoration.line`; every helper already computes **exact marker ranges** before applying the `muted` mark. No `WidgetType`/`replace`/`atomicRanges` anywhere in repo history. Update predicate (`:427-435`) = `docChanged || viewportChanged || syntaxTree change` — no `selectionSet`. Perf budget: median keystroke < 50 ms on a 5000-line doc (`src/test/e2e/perf.spec.ts`).
- `src/webview/editor.ts`: `codeMirrorSettings` Compartment + `buildSettingsExtensions` (`:568-598`) + `applySettings` (`:670-677`) = live-reconfig hook; `markdownDecorations` currently registered outside it (`:649`); defaults duplicated at `:624-631`.
- `src/NotesStorage.ts`: `Page {id, content}`, `NotesState {pages, activeId}`, **fully synchronous API** over `vscode.Memento` with in-memory cache; fire-and-forget writes; `getState()` self-heals by writing a welcome page.
- Storage seam: `getActiveStorage()` closure (`extension.ts:18-19`); consumers duck-type structurally. Scope is a hardcoded `'workspace' | 'global'` union in ~10 places in `extension.ts` + two menu `when` clauses keyed on context `mdpad.scope`. No file-watching exists; `exportPage` (`extension.ts:260-289`) has a reusable slugifier. `init` message steals focus + resets cursor. `deactivate()` empty; webview saves 500 ms trailing-debounced.
- Conventions: 9-touchpoint new-setting checklist (package.json, `types.ts`, `getSettings()`, editor defaults + `buildSettingsExtensions`, `e2e/utils.ts` duplicated interface, `unit/settings.test.ts` literals, README table, test-content.md, changeset); one e2e spec per feature domain; integration test asserts exact command list; changeset mandatory per user-facing change; webview CSP has no `img-src`.

---

## Feature A — hidden-syntax mode

### Mechanism: zero-width `Decoration.replace({})` on marker ranges

- CSS `display:none` rejected: CM6's coordinate system (posAtCoords/coordsAtPos, drawSelection) measures live DOM; invisible-but-present spans cause caret glitches. `Decoration.replace` is CM's first-class collapse mechanism; document text is untouched so copy/paste, search, deriveTitle, storage, and click handlers keep working.
- **No `atomicRanges`**: hidden ranges exist only on non-active lines; arriving on a line (arrow keys or click) reveals it within the same view update, so the cursor never dwells inside a hidden range. Replace decorations never change doc offsets — no mapping code needed.

### Setting: `mdpad.syntaxMode: 'muted' | 'hidden'`, default `'muted'`

First enum setting in the repo (`enum` + `enumDescriptions`). Default `'muted'` = zero behavior change for existing users. Threaded through the full 9-touchpoint checklist. Wire-up: change `markdownDecorations` to a factory `markdownDecorations(mode)`, move its registration from `editor.ts:649` into `buildSettingsExtensions` so mode toggles live via the existing Compartment reconfigure. (The plugin has no listeners, so no `destroy()` concerns; `attachClickHandlers` stays attached once to `view.dom`, mode-agnostic.)

### Builder refactor: scan/materialize split (the perf answer)

- **Phase 1 — scan** (expensive, cached on plugin instance): existing tree walk + regex passes, but helpers emit *tagged* entries — `{kind:'style', deco, from, to}` for content styling, `{kind:'marker', from, to, construct}` for everything that today gets `muted`. Runs on today's predicate only.
- **Phase 2 — materialize** (cheap, selection-aware): muted mode emits markers as `muted` (byte-identical to today; predicate unchanged — zero perf delta for default users). Hidden mode computes active lines from `state.selection.ranges`; active-line markers → `muted` (normal editable reveal); inactive-line markers → **sort + merge overlapping/adjacent ranges**, one `Decoration.replace({})` per merged range (merging makes partial replace-replace overlaps impossible by construction). `selectionSet` is added to the rebuild predicate **only in hidden mode**, and selection-only updates run phase 2 alone — O(ranges), well inside the 50 ms budget. Held-in-reserve lever if perf ever fails: viewport-limited materialization.
- Pure helpers (`computeActiveLines`, `mergeRanges`, materializer) go in new `src/webview/hiddenRanges.ts` for plain Mocha unit testing.

### Per-construct behavior in hidden mode (inactive lines)

| Construct | Behavior |
|---|---|
| Headings | Hide `#…# ` prefix; keep weight-only `mdpad-heading-N` styling |
| Bold/italic/strike/inline-code/`==highlight==` | Hide delimiters; keep content style marks |
| Links | Hide `[`, `](url)`; keep underlined `mdpad-link-text` — Cmd+click still works (URL re-read from doc text, which still contains it) |
| Task lists | Hide leading `- `; **keep `[ ]`/`[x]` visible** — preserves click-to-toggle with zero new machinery (real checkbox widget explicitly out of scope v1: sidebar risk) |
| Blockquotes | Hide `> `; existing border-left CSS already provides the quote visual |
| Bullets/ordered numbers | Unchanged (carry content meaning; Obsidian keeps them too) |
| Fenced code, tables, frontmatter | **Unchanged/muted** — hiding fences leaves confusing blank lines; hiding pipes destroys tableFormatter's visible alignment; frontmatter is metadata. Rescoped out deliberately |
| Horizontal rule | v1 unchanged; optional CSS-gradient polish later (no images — CSP) |

**Folding**: expected to compose (fold ranges start at line end, heading markers at line start); verified by a dedicated e2e case. **What stays identical:** line heights, font sizes, CSP, message protocol shape, click-handler wiring, entire muted-mode output. No new webview capabilities → sidebar and panel run the same bundle, nothing can diverge between them.

## Feature B — team notes (file-backed third scope)

### Storage design: filename-is-identity, no index file

- New `src/FileNotesStorage.ts` implementing extracted structural interface `INotesStorage` (new `src/storageTypes.ts`; type-only swap in `handleWebviewMessage.ts`, both providers, `extension.ts`).
- Folder: `<workspaceFolders[0]>/<mdpad.teamNotesFolder>` (new string setting, default `".mdpad"`). One `page.md` per page; **`Page.id` = filename**. Order = alphabetical filename sort. `activeId` = per-user `workspaceState['mdpad.teamActiveId']` — never written to the folder, never pollutes git.
- Rationale vs. `index.json`: an index is a merge hotspot — every teammate's page-add collides on it, defeating the feature's purpose. Vs. frontmatter `id:`: mutates user content and still needs an order source. With filename-as-identity, parallel page-adds merge trivially; conflicts confine to the page both people edited. Accepted trade-offs: external rename = delete+add (activeId falls back gracefully), no drag-reorder (mdpad has none today).
- Filenames on `newPage`: `note-YYYYMMDD-HHmmss.md` (slugifier extracted from `exportPage` into shared `src/slug.ts`); collision → `-2` suffix; files are NOT renamed on title change (protects git history); display titles still come from `deriveTitle(content)`.

### Sync facade over async FS

- `async initialize()` reads folder + files into the in-memory `NotesState` cache at activation **only if the folder exists** (`workspace.fs.stat` probe); otherwise scope reports unavailable. **`getState()` never writes** — no welcome page, no folder creation on activation; empty-but-initialized returns an in-memory draft whose file is created on first non-empty edit.
- Writes: mutate cache synchronously, per-page debounced (300 ms) `workspace.fs.writeFile`, fire-and-forget with error toast (mirrors existing `setState` pattern); injectable delay for tests. `flush()` awaits pending writes — called from `deactivate()` (changed to return the promise), scope switch away, and before `deletePage` removes its file.
- Watcher: `createFileSystemWatcher(RelativePattern(folderUri, '*.md'))`. Self-write suppression by **content comparison** (event content === cache → ignore; robust against event timing). External change to the active page pushes via the new message below. Delete events remove from cache and advance activeId. Conflict policy v1: last-writer-wins, documented.

### New message + scope registry

- New `ExtensionMessage` variant `{type:'replaceContent', content}` handled in `webview/index.ts` by `setContent` only — **no `.focus()`** (the existing `init` steals focus; it remains untouched for its callers). `setContent`'s whole-doc dispatch maps/clamps the cursor automatically.
- `extension.ts` scope refactor: `type Scope = 'workspace' | 'global' | 'team'` + registry `Record<Scope, {storage, icon, label, available()}>` (team icon `$(organization)`). `getActiveStorage`, `scopeLabel`, `setScope`, status bar, `selectPage`, `searchPages` become registry loops. Context keys: `mdpad.scope` 3-valued + new `mdpad.teamAvailable`. New commands: `mdpad.switchToTeam` (prompts to create the folder if absent; error if no workspace folder) and `mdpad.copyPageTo` (QuickPick: copy active page to another scope — the adoption bridge). View-title toggle becomes a cycle via `when`-clause menu entries. Saved scope `'team'` with missing folder falls back to `'workspace'`. `mdpad.teamNotesFolder` changes handled in `onDidChangeConfiguration` (dispose watcher, re-probe).
- Out of scope v1: multi-root beyond folder 0 (matches existing behavior), rename/reorder UI, merge-conflict UI, activeId syncing.

---

## Execution: work packages, parallel lanes, paired reviewers

Feature A and B are near-disjoint. Shared files (`package.json`, `types.ts`, `extension.ts`) get A's small touches first; B's big refactor rebases trivially.

| Package | Files (core) | Depends on |
|---|---|---|
| **A1** decoration engine | `decorations.ts`, new `hiddenRanges.ts`, new `unit/hiddenRanges.test.ts` | — |
| **A2** settings plumbing | `package.json` (config), `types.ts`, `extension.ts:57-67`, `editor.ts`, `e2e/utils.ts`, `unit/settings.test.ts`, README, test-content.md | A1's factory signature (frozen up front → parallel start) |
| **A3** hidden-mode e2e | `decorations.spec.ts`, `settings.spec.ts`, `interactions.spec.ts`, `folding.spec.ts`, `perf.spec.ts` | A1+A2 for green; spec-writing starts immediately |
| **B1** file storage core | new `storageTypes.ts`, new `FileNotesStorage.ts`, new `slug.ts`, `NotesStorage.ts` (implements interface), type-only import swaps, `unit/vscodeStub.ts` (+in-memory `workspace.fs` + watcher stub), new `unit/fileNotesStorage.test.ts` | — (fully parallel with lane A) |
| **B2** scope registry + commands | `extension.ts` (registry, switchToTeam, copyPageTo, deactivate flush, watcher lifecycle), `package.json` (commands/menus/setting), `integration/extension.test.ts` | B1; after A2 (extension.ts/package.json) |
| **B3** external-change pipeline | `types.ts` (replaceContent), `webview/index.ts`, `extension.ts` (watcher→push), `messaging.spec.ts`, storage unit tests | B1+B2; after A2 (types.ts) |
| **B4** docs + polish | README, CLAUDE.md, test-content.md, welcome content sync (`NotesStorage.ts` + `.github/welcome-content.md`), changesets | all |

**Parallel lanes:** Lane 1 = A1 → A2 → A3 (A2/A3 overlap A1). Lane 2 = B1 concurrently. Then B2 → B3, then B4. **Every implementation agent gets a paired independent review agent** (A1's and B1's reviews run concurrently); code I write directly also gets a spawned reviewer before its checkpoint closes.

**Scaffolding-doc process (per Zach's discipline, adapted):** before each checkpoint's implementation starts, I write a staged doc at `.ai/<nn>-<name>.md` in the repo — survey-verified citations, ordered resolvable steps, consumer sweep (e.g. every site matching scope siblings for B2), self-verifiable checkpoint with named instruments, "what comes next" with reasons. Implementation agents build FROM the doc; items get checked off as they land; docs are updated to as-built state at checkpoint close. Add `.ai/**` to `.vscodeignore` so docs never ship in the VSIX. C1's doc is written first so Feature A implementation starts while B's docs are still being authored (Zach's priority-ordering requirement).

### Checkpoints (each closes with compile → lint → webpack → unit → e2e → integration all green)

- **C1 (A1+A2+A3):** hidden mode shippable. Exit: existing decoration/perf/folding suites unchanged-green (proves muted mode byte-identical), new hidden suites green, hidden-mode perf < 50 ms, **manual F5 smoke of the real sidebar in both modes** (explicit item — e2e runs the same bundle but in a plain page, not the real sidebar).
- **C2 (B1):** storage core green in isolation (unit only; no user-visible change).
- **C3 (B2+B3):** third scope end-to-end: create-folder flow, scope cycle, selectPage/searchPages across three scopes, external-edit reload without focus theft, command-list test updated.
- **C4 (B4):** docs, welcome-content sync, changesets (`hidden-syntax-mode` + `team-notes-scope`, both `"mdpad": minor`).

## Verification

- **Unit:** `hiddenRanges.test.ts` (mergeRanges: overlapping/adjacent/duplicate/nested; activeLines multi-range; materializer both modes); `fileNotesStorage.test.ts` (load+ordering, lazy first-write, debounce coalescing, flush, delete, slug collisions, self-write suppression, external change/delete, no-folder unavailability, never-writes-on-getState); settings literals extended.
- **E2E:** hidden-mode DOM assertions in `decorations.spec.ts` (marker text absent on inactive lines, present after click-in, re-hidden on leave; tables/fences/frontmatter unchanged; multi-line selection reveals all touched lines); live toggle both ways in `settings.spec.ts`; checkbox + cmd-click link in hidden mode in `interactions.spec.ts`; fold/unfold under hidden mode in `folding.spec.ts`; hidden-mode 5000-line keystroke + cursor-move timings in `perf.spec.ts` (existing default test untouched); `replaceContent` focus/clamp behavior in `messaging.spec.ts`.
- **Integration:** command list +`mdpad.switchToTeam`, +`mdpad.copyPageTo`.
- **Manual:** F5 sidebar smoke both modes (C1); team-notes flow with a real git clone + external edit (C3); `.github/test-content.md` torture cases.

## Risks

1. **selectionSet rebuild cost** — default mode never sees the new predicate; hidden mode pays O(ranges) on cursor moves; perf spec enforces; viewport lever in reserve.
2. **Sidebar regression (immutable)** — no new webview APIs/widgets/images/CSP changes; widget-requiring polish pre-declared droppable; manual sidebar smoke is a formal C1 exit criterion.
3. **Replace-overlap crashes** — merge pass makes partial overlaps impossible; unit tests target known duplicate sources (list fallback pass, `==` inside links).
4. **File-storage data loss** — debounce + flush on deactivate/switch/delete; content-comparison watcher suppression; residual exposure (~800 ms before OS kill) same class as today's memento path, documented.
5. **Scope refactor churn** — mechanically loop-shaped, confined to `extension.ts` + menus, guarded by integration command-list test + manual smoke.
