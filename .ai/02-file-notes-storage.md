# 02 — File-backed notes storage

Builds the storage half of team notes: a `NotesStorage`-shaped class whose pages are `.md` files in a
workspace folder, so a team can commit them. Nothing in this doc is reachable from the UI — no command
registers it, no scope selects it, `extension.ts` is not touched. The tree is expected to behave
exactly as it does today when this checkpoint closes; the new class is proved by unit tests alone.
`03` wires it up.

## What you are building

| Piece | Home file | Role |
|---|---|---|
| `INotesStorage` | `src/storageTypes.ts` (new) | The structural contract both storages satisfy — extracted, not invented |
| `slugify`, `timestampFileName`, `uniqueFileName` | `src/slug.ts` (new) | Filename derivation, shared with `exportPage` |
| `FileNotesStorage` | `src/FileNotesStorage.ts` (new) | Synchronous cache over an async folder of `.md` files, plus a watcher |
| `workspace.fs`, `FileType`, `RelativePattern`, `createFileSystemWatcher` | `src/test/unit/vscodeStub.ts` | In-memory filesystem and a manually-fired watcher for the tests |
| `fileNotesStorage.test.ts` | `src/test/unit/` (new) | The whole behavioural contract |

`storageTypes.ts` sits at `src/` root next to the two storage classes rather than under `webview/`,
because `webview/types.ts` is the wire protocol shared with the browser bundle and `INotesStorage` is
extension-host-only — it names `vscode` concepts indirectly and must never be pulled into
`dist/webview.js`.

## Why filename-is-identity, and why no index file

`Page.id` is the filename. Order is the alphabetical filename sort. There is no manifest.

An `index.json` listing page order and ids would be a merge hotspot: every teammate who adds a page
rewrites the same line, so the common case — two people adding notes on separate branches — conflicts
every time, which is precisely the case the feature exists to serve. Frontmatter `id:` keys avoid the
manifest but mutate the user's own content and still need a second source for ordering. With the
filename carrying identity, parallel adds are independent file creations that git merges without
help, and conflicts are confined to a page two people actually both edited.

The accepted costs: renaming a file outside VS Code reads as a delete plus an add (the active-page
pointer falls back to a neighbour), and there is no drag-to-reorder — ScribeAside has none today in any
scope, so nothing regresses.

`activeId` is per-user state, not team state. It lives in `workspaceState` under
`scribeaside.teamActiveId` and is never written into the folder; putting it in a file would make every
teammate's page switch a dirty working tree.

## Facts you'll rely on

`NotesStorage` (`src/NotesStorage.ts:62-153`) is entirely synchronous over an in-memory
`cachedState`, and persists with a fire-and-forget `Memento.update` whose rejection is only logged
(`:147-152`). Both providers and `handleWebviewMessage` call it synchronously and never await. The
file-backed class has to present the same synchronous surface, so writes are cached immediately and
flushed to disk behind a debounce — the same durability profile as today, moved from a memento to a
file.

`NotesStorage.getState()` self-heals: an empty store gets a welcome page written into it (`:76-79`).
`FileNotesStorage.getState()` must **not** do that. `getState` is called from `updateStatusBar` at
activation (`src/extension.ts:89-99`), so a self-healing implementation would create the folder and a
file on disk merely because the extension started, in every workspace, whether or not the user ever
opts into team notes.

`workspace.fs.stat` rejects on a missing path; there is no `exists`. The probe is a `try`/`catch`
around `stat`, and the result also has to be checked for `FileType.Directory` — a *file* named
`.scribeaside` must report unavailable, not throw later on `readDirectory`.

`exportPage` (`src/extension.ts:260-289`) already contains the slug expression
`title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'`. That is the
function `slug.ts` extracts; `exportPage` becomes its first caller so the extraction is proved by the
existing manual export path rather than by a new test only.

Unit tests resolve `vscode` through the require hook in `src/test/unit/mochaSetup.ts`, which redirects
to `src/test/unit/vscodeStub.ts`. Anything `FileNotesStorage` touches on the `vscode` namespace has to
exist in that stub or the tests fail at load, not at assert.

## Steps

### Step 1 — `src/storageTypes.ts`: the contract

- [x] Create the file with `export interface INotesStorage` carrying exactly the seven methods
  `handleWebviewMessage` and `extension.ts` already call on a storage: `getState(): NotesState`,
  `updateContent(id: string, content: string): void`, `newPage(): NotesState`,
  `deletePage(id: string): NotesState`, `switchPage(id: string): NotesState`,
  `previousPage(): NotesState`, `nextPage(): NotesState`.

  Import `NotesState` as a type from `./webview/types`. No `vscode` import — the interface must stay
  free of host types so a test can implement it with a literal.

### Step 2 — `src/slug.ts`: filename derivation

- [x] `export const slugify = (title: string): string` — the expression lifted verbatim from
  `exportPage`, including the `|| 'note'` fallback for a title with no alphanumerics.

- [x] `export const timestampFileName = (date: Date): string` — `note-YYYYMMDD-HHmmss.md` from the
  date's **local** components, zero-padded. Local rather than UTC because the name is a human-facing
  ordering cue in a file tree, and a team spread across zones still gets a stable sort either way.

- [x] `export const uniqueFileName = (name: string, taken: ReadonlySet<string>): string` — returns
  `name` when free, else inserts `-2`, `-3`, … before the `.md` extension until it is. Two pages
  created inside the same second is the case this exists for.

### Step 3 — `src/NotesStorage.ts`: declare the contract

- [x] Add `implements INotesStorage` to the class. No behaviour change; it turns the structural
  agreement into a checked one, so a later edit to either class that breaks the shared shape fails at
  compile time instead of at a call site.

### Step 4 — `src/handleWebviewMessage.ts`, `src/SidebarProvider.ts`, `src/PanelProvider.ts`

- [x] Swap the `NotesStorage` type import for `INotesStorage` in all three: the `storage` parameter
  (`handleWebviewMessage.ts:7`) and the `getStorage: () => NotesStorage` constructor fields
  (`SidebarProvider.ts:20`, `PanelProvider.ts:17`).

  Type-only. These are the sites that decide whether a third storage can be handed to the existing
  webview plumbing at all, and they are the reason `INotesStorage` is extracted rather than
  `FileNotesStorage` simply being duck-typed in.

### Step 5 — `src/test/unit/vscodeStub.ts`: filesystem and watcher

The stub currently covers `Uri`, `workspace.workspaceFolders`, `workspace.openTextDocument`,
`workspace.getConfiguration`, `env`, and three `window` message functions. Add, keeping the existing
`record()` call-log style:

- [x] `export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }`.

- [x] An in-memory file map keyed by `uri.toString()`, plus test-facing helpers
  `fsReset()`, `fsWriteFile(path, content)`, `fsMkdir(path)`, `fsRead(path)`, `fsList()`, so a test can
  seed a folder without going through the class under test.

- [x] `workspace.fs` with `stat`, `readDirectory`, `readFile`, `writeFile`, `delete`,
  `createDirectory`. `stat` and `readFile` reject for a missing path — the class's availability probe
  depends on that rejection, and a stub that resolves `undefined` would make the unavailable-folder
  test pass for the wrong reason.

- [x] `writeFile` **creates missing parent directories**, matching the real
  `workspace.fs.writeFile` (the "no mkdirp logic required" note in the typings is on the
  `FileSystemProvider` interface, not the consumer-facing `FileSystem` one). A stricter stub turns
  ScribeAside silently re-creating a deleted folder into a visible error and hides the bug. Add
  `fsSetWriteDelay(ms)` too, so a test can hold a write in flight and interleave a delete, a second
  write, or a `flush()` against it — every write-ordering bug above is invisible without it.

- [x] `export class RelativePattern` storing `{ base, pattern }`, and
  `workspace.createFileSystemWatcher` returning an object with `onDidCreate`/`onDidChange`/
  `onDidDelete` registering callbacks and a `dispose()`. Expose `fireWatcher(kind, path)` so tests
  drive external events directly; a stub that watched the in-memory map would also fire on the
  class's own writes and make the self-write suppression test meaningless.

- [x] `export const setConfigValue` / a `getConfiguration` that returns real values, so future tests
  can set `scribeaside.teamNotesFolder`. Today's stub returns `undefined` for every key.

### Step 6 — `src/FileNotesStorage.ts`

- [x] Constructor options interface `FileNotesStorageOptions`:

  - `folderUri: vscode.Uri` — the folder to own. Resolved by the caller, so the class needs no
    configuration or workspace knowledge and a test can point it anywhere.

  - `getActiveId: () => string | undefined` and `setActiveId: (id: string) => void` — the per-user
    active page pointer, injected rather than read from `workspaceState` directly.

  - `onExternalChange: (change: { activeContentChanged: boolean }) => void` — fired after the cache
    has already been updated from a watcher event. The flag distinguishes "redraw the status bar"
    from "push new content into the webview".

  - `debounceMs?: number` — default 300. Injected so tests do not sleep.

  - `now?: () => Date` — default `() => new Date()`. Injected so filename tests are deterministic.

- [x] Fields: `cache: NotesState`, `available: boolean`, `onDisk: Set<string>` (files known to exist),
  `pending: Map<string, Timeout>` (debounce timers by page id), `writing: Map<string, Promise<void>>`
  (in-flight writes by page id), `lastWritten: Map<string, string>` (content of the last write we
  issued), and the watcher disposables.

- [x] `get isAvailable(): boolean`.

- [x] `async initialize(): Promise<void>` — never rejects; every failure path sets `available = false`
  and returns. Ordered stages:

  1. `stat` the folder; on rejection, or when the result is not a `Directory`, mark unavailable, seed
     the cache with a single empty draft page so `getState()` still returns something renderable, and
     return.

  2. `readDirectory`, keep entries whose type is `File` and whose name ends in `.md`, sort by
     `localeCompare`.

  3. Read each file; a file that fails to read is skipped rather than aborting the load — one
     unreadable note must not take the whole scope offline.

  4. When no pages were found, seed one empty draft (see the lazy-write rule below).

  5. Set `activeId` from `getActiveId()` when that id is among the pages, else the first page.

  6. Mark available and start the watcher.

- [x] `getState(): NotesState` — returns the cache. Writes nothing, ever.

- [x] `updateContent(id, content)` — no-op when unavailable or when the page is unknown or the content
  is unchanged; otherwise update the cache and schedule a debounced write.

- [x] The **lazy first write** rule, applied in the write path, not the callers: a page that is not in
  `onDisk` and whose content is empty is not written. That is what keeps activation from creating
  files, and it is why `newPage()` can create a page without touching the disk. The visible
  consequence, which belongs in the docs: a page you create and never type into does not survive a
  reload.

- [x] `newPage()` — generates `uniqueFileName(timestampFileName(now()), <existing ids>)`, inserts the
  page at its **sorted** position rather than appending, sets it active. Sorted insert keeps the
  in-memory order equal to the order a fresh `initialize()` would produce; appending would let the
  list disagree with itself after a reload when a teammate's file sorts later.

- [x] **Writes for one page are chained, never concurrent.** `writeNow` queues onto whatever is
  already in `writing` for that id rather than starting a second write, and `doWrite` re-reads the
  page's current content when it actually runs. Three things follow, and the paired review reproduced
  all of them against the first version, which did not chain:

  - Two overlapping writes can land out of order, so disk keeps `v1` while the cache holds `v2` — and
    the watcher then suppresses its own echo, so nothing reports the divergence.

  - `writing.set(id, …)` overwrites the map entry, so `flush()`'s `Promise.all` awaited only the newer
    write and resolved while the older one was still in flight. Chaining makes awaiting the tracked
    promise await everything queued before it, which is what makes `flush()` honest.

  - The trigger needs no exotic timing: a scope switch calls `flush()`, which fires a pending debounce
    on top of an in-flight write. All it takes is a filesystem slower than the gap between two
    keystrokes — a network share, WSL, remote-SSH, or a virus scanner.

- [x] **Probe the folder before every write.** `workspace.fs.writeFile` creates missing parent
  directories, so deleting `.scribeaside` in the Explorer would otherwise bring it silently back on the next
  keystroke — the opposite of the opt-in the folder represents. A failed probe calls
  `markUnavailable()`: cancel pending writes, warn once, and fire the new `onUnavailable` option so
  `extension.ts` can drop the context key and fall the scope back to Workspace.

- [x] `deletePage(id)` — remove from the cache, cancel any pending debounce for that id, drop its
  `lastWritten`, and delete the file if it was on disk **or a write for it is in flight**. The file
  delete must **await the in-flight write for that id first**: a write that lands after the delete
  recreates the file, and the page comes back on the next reload. When the list empties, seed a fresh
  draft, matching
  `NotesStorage.deletePage` (`src/NotesStorage.ts:107-110`). When the deleted page was active, move
  the pointer to `Math.min(idx, len - 1)`, same rule as the memento implementation.

  ⚠ Capture "was this the active page" **before** the splice, in both `deletePage` and the watcher's
  delete handler. Seeding the replacement draft reassigns `activeId`, so a comparison made afterwards
  reads false for the one case that matters most — the last page being deleted. In `deletePage` that
  costs only a stale per-user pointer; in the watcher handler it means `onExternalChange` reports
  `activeContentChanged: false` and the webview keeps displaying a note whose file is gone.

  ⚠ Gate the delete on `onDisk.has(id) || writing.has(id)`, not on `onDisk` alone. `onDisk.add` only
  happens *after* `writeFile` resolves, so a page created, typed into, and deleted while its very
  first write is still running is not in `onDisk` at the moment of the delete — the delete is skipped
  entirely, the write lands, and the file survives with content. The watcher's own create event is
  then suppressed by the `lastWritten` check, so the ghost is invisible until the next reload.

- [x] `switchPage`, `previousPage`, `nextPage` — index arithmetic identical to `NotesStorage`
  (`:118-145`), routing every `activeId` assignment through the injected `setActiveId` so the pointer
  persists per user.

- [x] `async flush(): Promise<void>` — fire every pending debounce immediately, then await all
  in-flight writes **and all outstanding deletes**; repeat while any set is non-empty, with a small
  bounded number of rounds so a pathological loop cannot hang shutdown. Deletes are tracked in their
  own `deleting` map for exactly this reason: without it, `deactivate` resolves while a delete is
  still in flight, the window closes, and the deleted page is back on next launch.

- [x] `dispose(): void` — dispose the watcher and its subscriptions. Separate from `flush()` because
  the two have different callers: scope-switch flushes without disposing, a settings change that
  moves the folder does both.

- [x] The watcher handlers, on `RelativePattern(folderUri, '*.md')`:

  - **create / change**: ignore the event when a debounce is pending or a write is in flight for that
    id — we are mid-edit and last-writer-wins means us. Read the file; ignore when the content equals
    the cached content or equals `lastWritten` for that id. Otherwise update the cache (or insert the
    page when the filename is new) and fire `onExternalChange`.

    ⚠ Suppression is by **content comparison, not by a "we just wrote" flag**. A flag has to be
    cleared on a timer, and the event for a write can arrive after the next edit has already started,
    so the flag is either cleared too early (the editor reloads its own text and the cursor jumps) or
    too late (a teammate's edit is swallowed). Content comparison has no timing to get wrong.

    ⚠ Re-check `pending`/`writing` **after** the `await readFile`, not only before it. The user can
    type inside the read's latency; without the second check their keystroke is overwritten by the
    file's text, `replaceContent` wipes it out of the editor, and the pending write then puts the
    teammate's version back — so the edit never existed.

  - **delete**: an id already absent from the cache means we deleted it ourselves, so return. Removing
    it otherwise mirrors `deletePage`'s pointer arithmetic and fires `onExternalChange` with
    `activeContentChanged` set when the deleted page was the active one.

- [x] Conflict policy for v1, and say it in the README at `04`: last writer wins. There is no merge UI
  and no attempt to reconcile two simultaneous edits of one page.

### Step 7 — `src/extension.ts`: the one line this doc does touch

- [x] Replace `exportPage`'s inline slug expression (`:266-270`) with a `slugify(title)` call.

  This is the consumer sweep result for `slug.ts`: the expression exists in exactly one place today,
  and leaving the copy behind would let the two drift the first time either is adjusted.

### Step 8 — `src/test/unit/fileNotesStorage.test.ts`

- [x] Cases, each with the stub filesystem seeded directly:

  - Loads pages from a seeded folder, ordered by filename, with content intact.
  - Reports unavailable when the folder is missing, and when the path is a file rather than a folder.
  - `getState()` on an unavailable folder returns a renderable empty state and writes nothing —
    assert the stub filesystem is still empty afterwards.
  - `getState()` on an existing but empty folder returns one draft page and writes nothing.
  - `updateContent` on the draft creates the file once the content is non-empty, and does not create
    it while the content is empty.
  - Debounce coalescing: three `updateContent` calls inside the window produce one `writeFile`.
  - `flush()` writes immediately and resolves after the write lands.
  - `newPage` names files `note-YYYYMMDD-HHmmss.md` from the injected clock, and a same-second
    collision gets the `-2` suffix.
  - `deletePage` removes the file, and a pending write for that page does not resurrect it.
  - Deleting the last page leaves one empty draft.
  - A watcher change event whose content equals the cache is ignored (no `onExternalChange`).
  - A watcher change event with genuinely new content updates the cache and reports
    `activeContentChanged: true` for the active page, `false` for another page.
  - A watcher create event for an unknown filename inserts the page in sorted position.
  - A watcher delete event for the active page advances the active pointer.
  - `activeId` round-trips through the injected getter/setter and is never written to the folder —
    assert no non-`.md` file was created.

## Checkpoint

- [x] `pnpm lint` (LF-normalized copy — see the caveat in `01`)
- [x] `pnpm compile`
- [x] `pnpm webpack`
- [x] `pnpm test:unit` — 202 passing
- [x] `pnpm test:e2e` — 123 passing, unchanged
- [x] `pnpm test:integration` — 20 passing, unchanged

Ordered so a failure isolates:

1. **The control: `notesStorage.test.ts`'s 20 existing cases still pass.** `NotesStorage` gained an
   `implements` clause and nothing else; if these fail, the interface is wrong, not the new class.

2. **The e2e and integration suites are unchanged-green.** This doc adds no command, no setting, and
   no message. Any movement there means a type-only swap in Step 4 was not type-only.

3. `fileNotesStorage.test.ts` passes, including the two cases that prove the negative — that
   `getState()` leaves the stub filesystem empty, and that a missing folder yields
   `isAvailable === false` rather than a rejection.

4. **`exportPage` still exports — OUTSTANDING, needs a human.** Step 7 rewrote a working path, so it needs its own check: F5, write
   a note titled `# Hello World!`, run **ScribeAside: Export Current Page**, and confirm the dialog offers
   `hello-world.md`. This is the manual item; the slug function's own unit coverage does not prove the
   call site was rewired correctly.

Nothing else is runnable here on purpose: no scope selects the new storage, so there is no F5
behaviour to observe beyond the export regression above.

## What comes next

- **`03` wires the scope in** — the registry in `extension.ts`, the `switchToTeam` and `copyPageTo`
  commands, the `replaceContent` message, and the watcher-to-webview push. It is gated on this
  checkpoint being *verified*, not merely written, because every one of those pieces asserts against
  `FileNotesStorage`'s cache semantics and would otherwise be debugging two layers at once.

- **Multi-root workspaces beyond folder 0** are out. Every existing path in the extension already uses
  `workspaceFolders[0]` (`handleWebviewMessage.ts:28`), and a per-root team scope needs a root picker
  in the UI, which is a larger design than this feature.

- **A merge-conflict UI** is out. Git already surfaces conflict markers in the file, and ScribeAside renders
  them as text, which is an honest — if plain — representation. Building anything better means
  deciding what a three-way merge of prose means.

- **Renaming a page's file from a title change** is out, deliberately: it rewrites git history for a
  cosmetic edit, and a note whose title changes twice leaves two dead files behind.

Everything lands bare per the repo's conventions — the reasoning stays in this doc, not in the code.
