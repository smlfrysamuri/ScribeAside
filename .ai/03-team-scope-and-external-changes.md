# 03 — Team scope, scope registry, and external changes

Makes the folder storage from `02` reachable: a third scope alongside Workspace and Global, backed by
`<workspace>/<mdpad.teamNotesFolder>`. The hardcoded two-value scope union in `extension.ts` becomes a
registry, two commands are added (`switchToTeam`, `copyPageTo`), and a new `replaceContent` message
pushes a teammate's edit into the webview without stealing focus. Gated on `02` being **verified**,
not merely written: every step here asserts against `FileNotesStorage`'s cache semantics, and
debugging both layers at once is what this ordering exists to avoid.

## What you are building

| Piece | Home file | Role |
|---|---|---|
| `Scope`, `SCOPES`, `SCOPE_ORDER` | `src/extension.ts` | The registry that replaces ten hardcoded ternaries |
| `mdpad.switchToTeam`, `mdpad.copyPageTo` | `src/extension.ts`, `package.json` | Entry point and the adoption bridge |
| `mdpad.teamNotesFolder` | `package.json`, `extension.ts` | Folder name, default `.mdpad` |
| `mdpad.teamAvailable` | context key | Makes the title-bar scope cycle two-stop or three-stop |
| `{type:'replaceContent'}` | `src/webview/types.ts`, `src/webview/index.ts` | External edit → editor, without `.focus()` |
| async `activate`, promise-returning `deactivate` | `src/extension.ts` | Folder probe at startup; pending writes flushed at shutdown |

## Why a registry, and why the cycle is `when`-clause driven

Scope appears as a hardcoded `'workspace' | 'global'` ternary in ten places in `extension.ts` —
`getActiveStorage` (`:18-19`), `scopeLabel` (`:54-55`), the status-bar icon (`:94-95`), `selectPage`'s
six (`:190-202`), and `searchPages`' two `searchScope` calls (`:359-365`). Adding a third arm to each
is where a consumer sweep goes wrong: a ternary silently gives the newcomer the *other* branch's
behaviour instead of failing to compile. A `Record<Scope, ScopeEntry>` plus a `SCOPE_ORDER` array
turns each of those sites into a loop, and adding a fourth scope later would then be one table row.

The title-bar button shows the **next** scope in the cycle rather than a menu. Workspace → Global →
Team → Workspace when a team folder exists; Workspace → Global → Workspace when it does not, which is
what `mdpad.teamAvailable` gates. A user with no team folder therefore sees today's two-stop toggle
exactly as before, and discovers the feature through the command palette entry, which is the one that
offers to create the folder.

## Facts you'll rely on

`activate` is currently synchronous (`src/extension.ts:9`) and `deactivate` is an empty
`(): void` (`:492`). Both change signature. VS Code awaits an async `activate` before resolving any
view, and awaits a promise-returning `deactivate` during shutdown — which is the only place pending
debounced writes can be flushed.

The `init` message steals focus: `webview/index.ts:57-60` calls `editor.view.focus()` after
`setContent`. That is correct for its existing callers, every one of which follows a deliberate user
action. It is wrong for a teammate's edit arriving while the user is typing somewhere else, which is
why `replaceContent` is a new message rather than a reuse of `init`. `setContent`
(`webview/editor.ts:661-668`) dispatches a whole-document change, and CodeMirror maps the selection
through it, so the cursor clamps without extra code.

`sendInitToActive` (`:78-87`) sends `init` **and** `settings` on every scope switch and page change.
`replaceContent` must not go through it.

`mdpad.scope` is persisted in `workspaceState` (`:110`) and read back at activation (`:13-16`). A
value saved by this version can be `'team'`, and the folder may be gone by the next launch, so the
read has to be validated rather than trusted.

`workspaceFolders?.[0]` is what every existing path uses (`handleWebviewMessage.ts:28`,
`exportPage`), so team notes use folder 0 too. With no folder open at all, `switchToTeam` has nowhere
to put the folder and must say so rather than failing quietly.

## Steps

### Step 1 — `src/webview/types.ts`: the message

- [x] Add `| { type: 'replaceContent'; content: string }` to `ExtensionMessage`.

Hoisted to Step 1 because `extension.ts` posts it and `webview/index.ts` handles it; the union has to
exist before either compiles.

### Step 2 — `src/webview/index.ts`: handle it

- [x] Add a `case 'replaceContent'` to the message switch that calls `editor?.setContent(message.content)`.

  ⚠ No `editor?.view.focus()`. This is the step that silently does the wrong thing if you copy the
  `init` case: it compiles, the content updates, and the symptom is that the user's cursor jumps out
  of whatever file they were editing whenever a teammate saves — which reads as VS Code stealing
  focus, not as an mdpad message handler.

- [x] **Skip the update when the webview holds edits the host has not seen.** Track `syncedContent`:
  the last content the two agreed on, set when the host sends content and again when a local edit is
  posted back. When `doc !== syncedContent`, drop the `replaceContent`.

  The webview's save debounce (`webview/index.ts:38-47`) is trailing-only, so during continuous
  typing the extension host receives nothing at all — `FileNotesStorage`'s "we are mid-edit" guard is
  not even engaged, and a `git checkout` mid-paragraph would replace the document wholesale and
  discard the paragraph. Losing the remote change instead is strictly better: it is still in the file
  and in git, and the local edit wins by the documented last-writer-wins rule a moment later.

- [x] Cap that debounce with a 2 s max wait, so a fast typist cannot hold an unbounded amount of
  unsent text in the webview. Trailing-only with no ceiling means a burst with no 500 ms pause never
  reaches the host at all.

### Step 3 — `package.json`: setting, commands, menus

- [x] `mdpad.teamNotesFolder`: string, default `".mdpad"`, described as relative to the first
  workspace folder.

- [x] Commands `mdpad.switchToTeam` (title "Switch to Team Notes", icon `$(organization)`) and
  `mdpad.copyPageTo` (title "Copy Page To…", icon `$(copy)`), both `category: "mdpad"`.

- [x] `view/title` entries, all in `navigation@5` so they occupy the single existing scope-toggle slot:

  - `mdpad.switchToGlobal` — `mdpad.scope == workspace`
  - `mdpad.switchToTeam` — `mdpad.scope == global && mdpad.teamAvailable`
  - `mdpad.switchToWorkspace` — `mdpad.scope == global && !mdpad.teamAvailable`
  - `mdpad.switchToWorkspace` — `mdpad.scope == team`

  The existing `switchToGlobal`/`switchToWorkspace` entries are replaced by these four; leaving the
  old unconditional `mdpad.scope == global → switchToWorkspace` entry in place would put two buttons
  in the slot whenever a team folder exists.

- [x] `mdpad.copyPageTo` in the overflow group, `2_mdpad@3`.

### Step 4 — `src/extension.ts`: the registry

- [x] `type Scope = 'workspace' | 'global' | 'team'`, `const SCOPE_ORDER: Scope[]` in cycle order, and

```ts
interface ScopeEntry {
  label: string
  icon: string
  storage: () => INotesStorage
  available: () => boolean
}
```

  `storage` and `available` are getters rather than values because the team entry's storage object is
  replaced whenever `mdpad.teamNotesFolder` changes, and a captured reference would keep writing to
  the old folder.

- [x] Rewrite each ternary site as a registry read: `getActiveStorage`, `scopeLabel`, the status-bar
  icon, `selectPage`, `searchPages`.

  `selectPage` builds the active scope's items first (with the `$(check)` prefix on the active page),
  then a separator, then each *other available* scope's items in `SCOPE_ORDER`. `searchPages` loops
  every available scope. Both must skip unavailable scopes — an unavailable team storage returns a
  one-page draft, and listing a phantom "Empty note" under a folder that does not exist is the
  failure mode here.

- [x] `setScope(scope)`: falls back to `'workspace'` when the requested scope is unavailable, then
  delegates to `applyScope` and calls the existing `switchAndUpdate`.

- [x] **The flush-on-leaving-team belongs in `applyScope`, not `setScope`.** `selectPage` and
  `searchPages` change scope by calling `applyScope` directly, so a flush attached to `setScope` is
  simply skipped when the user leaves Team scope by picking a page in another one.

### Step 5 — `src/extension.ts`: team storage lifecycle

- [x] Module-level `let teamStorage: FileNotesStorage | undefined`, assigned inside `activate`.
  Module scope, not activate scope, because `deactivate` needs it.

- [x] `teamFolderUri()` — joins `workspaceFolders[0].uri` with the configured folder name, split on
  `/` or `\` so a nested value like `docs/notes` works. Returns `undefined` with no workspace folder,
  and drops `.` and `..` segments: the setting names a folder *inside* the workspace, and a stray
  `../` should not put note files outside the repo they exist to be committed to.

- [x] `buildTeamStorage()` — constructs `FileNotesStorage` with `workspaceState` getters/setters for
  `mdpad.teamActiveId` and the external-change handler.

- [x] `publishTeamAvailability()` — sets the `mdpad.teamAvailable` context key. Call it after the
  initial probe, after folder creation, and after a configuration reload; a stale key leaves the
  title-bar cycle pointing at a scope that no longer resolves.

- [x] `handleTeamExternalChange(change)` — returns immediately unless the team scope is current; posts
  `replaceContent` with the active page's content when `change.activeContentChanged`; always refreshes
  the status bar, because a teammate adding or deleting a page changes the `(n/m)` counter.

  Declare it **before** `buildTeamStorage` so the closure it is passed into is never constructed
  against an uninitialised binding.

- [x] `activate` becomes `async`: build the team storage and `await teamStorage.initialize()` before
  registering anything, then resolve the saved scope against `SCOPE_ORDER` and availability. The probe
  is a single `stat` that rejects fast when the folder is absent, and doing it up front avoids
  activating in Workspace scope and visibly jumping to Team a tick later.

- [x] `deactivate` becomes `async (): Promise<void>` awaiting `teamStorage?.flush()`.

- [x] Push `{ dispose: () => teamStorage?.dispose() }` onto `context.subscriptions` so the watcher goes
  away with the extension.

### Step 6 — `src/extension.ts`: the two commands

- [x] `mdpad.switchToTeam`:

  1. No workspace folder → `showErrorMessage` and return.
  2. Storage not built yet (the workspace was opened after activation) → build it and
     **`initialize()` before prompting**, or step 4's modal offers to create a folder that is already
     sitting there.
  3. `teamFolderUri()` returned nothing because the setting is `"."`, `".."`, or `"/"` → say so.
     Returning silently leaves the user with no folder, no switch, and no explanation.
  4. Folder missing → modal `showInformationMessage` offering to create it; on decline, return.
  5. `createDirectory`, then `initialize()` again, then `publishTeamAvailability()`.
  6. Still unavailable → return without switching.
  7. `setScope('team')`.

- [x] `mdpad.copyPageTo`: QuickPick over the other available scopes; `newPage()` on the target followed
  by `updateContent(target.getState().activeId, content)`; confirm with an information message. Does
  not switch scope — copying is for seeding a team folder from notes you already have, and yanking the
  view to the destination would lose your place.

### Step 7 — `src/extension.ts`: configuration reload

- [x] In the existing `onDidChangeConfiguration` handler (`:475-487`), add a
  `mdpad.teamNotesFolder` branch that flushes and disposes the old storage, rebuilds, re-initializes,
  republishes availability, and — when the team scope is current — either falls back to Workspace or
  refreshes.

  ⚠ The handler's first branch is `affectsConfiguration('mdpad')`, which is true for this key too and
  will send a `settings` message to the webview. That is harmless (the webview ignores unknown fields)
  but it means the new branch must be additive, not an `else if`, or the folder change will be
  swallowed whenever any other mdpad setting changed in the same event.

### Step 8 — tests

- [x] `src/test/integration/extension.test.ts`: add `mdpad.switchToTeam` and `mdpad.copyPageTo` to
  `expectedCommands`. This list is the repo's guard that a contributed command actually registers.

- [x] `src/test/e2e/messaging.spec.ts`: `replaceContent` replaces the document; it does **not** focus
  the editor (contrast with `init`, which does); a cursor past the new end clamps into range.

- [x] `src/test/unit/handleWebviewMessage.test.ts` — no change needed; it already exercises the
  storage through a literal object, which is exactly what `INotesStorage` now formalises.

## Checkpoint

- [x] `pnpm lint` (LF-normalized copy — see the caveat in `01`)
- [x] `pnpm compile`
- [x] `pnpm webpack`
- [x] `pnpm test:unit` — 206 passing
- [x] `pnpm test:e2e` — 129 passing
- [x] `pnpm test:integration` — 22 passing

Ordered so a failure isolates, controls first:

1. **The integration suite's original 19 commands still register.** `activate` changed signature and
   grew an `await` before every `registerCommand`; if activation now throws, this is where it shows,
   and it shows before anything team-specific is exercised.

2. **The e2e suite is unchanged-green apart from the new `messaging.spec.ts` cases.** The webview
   gained one message case and nothing else.

3. The two new commands register.

4. **Manual, needs a real workspace — OUTSTANDING, needs a human — the paths no automated test in this repo can reach:**

   - **Regression control first.** With no `.mdpad` folder present, the title-bar button still toggles
     Workspace ↔ Global exactly as before, and the page picker lists both scopes and nothing else.
     Step 4 rewrote both of those paths, so they get their own check before any new behaviour.
   - Run **mdpad: Switch to Team Notes** in a workspace with no `.mdpad`; accept the prompt; confirm
     the folder appears, the view switches, and the title bar now cycles through three scopes.
   - Type into the team page; after ~300 ms a `note-YYYYMMDD-HHmmss.md` appears in `.mdpad` with the
     text in it. Create a page and do *not* type: no file appears — that is the lazy-write rule, not a
     bug.
   - Edit that file in a normal VS Code editor tab and save. The mdpad view updates to match, and the
     cursor does **not** jump into mdpad from wherever you were.
   - Delete a page from mdpad; the file disappears. Delete a file from the explorer; the page
     disappears and the view moves to a neighbour.
   - Run **mdpad: Copy Page To…** from Workspace scope, pick Team, and confirm a new file appears
     while the view stays on the Workspace page.
   - Change `mdpad.teamNotesFolder` to `notes` while in Team scope: with no `notes` folder present the
     scope falls back to Workspace and the title-bar cycle drops to two stops.
   - Clone the workspace to a second folder, edit the same page in both, and confirm the conflict is
     an ordinary git conflict in one file — the documented last-writer-wins policy, not silent loss.

## What comes next

- **`04`** is documentation and changesets only: README sections for team notes and hidden mode's
  interaction with it, `CLAUDE.md`'s architecture list, `.github/test-content.md`, and the welcome
  content sync.

- **Syncing `activeId` between teammates** is deliberately absent. It is per-user state; sharing it
  would make one person's page switch move everyone else's view.

- **A "team notes" welcome page** is not written on folder creation. `getState()` never writing is the
  invariant that keeps activation from touching the disk, and seeding a welcome file would put a
  commit in someone's working tree they did not ask for.

- **Rename and reorder UI** stays out for the reason in `02`: filenames are identity, so a rename is a
  delete plus an add, and doing that from inside mdpad would rewrite git history for a cosmetic edit.

Everything lands bare per the repo's conventions — the reasoning stays in this doc, not in the code.
