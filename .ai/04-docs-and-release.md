# 04 — Documentation and release

Closes the two features by writing down what they are and how they fail. No behaviour changes: the
only executable line touched is `WELCOME_CONTENT` in `src/NotesStorage.ts`, and that is a string.

## What you are building

| Piece | Home file | Role |
|---|---|---|
| Team-notes and hidden-mode sections | `README.md` | The user-facing description, including the conflict policy |
| Architecture entries | `CLAUDE.md` | The four new modules, the third scope, the new keys |
| Welcome text | `src/NotesStorage.ts` + `.github/welcome-content.md` | Two copies that must stay identical |
| Manual QA | `.github/test-content.md` | Already carries the hidden-mode section from `01`; team notes get one too |
| `team-notes-scope` | `.changeset/` | `"mdpad": minor`, alongside `01`'s `hidden-syntax-mode` |

## Facts you'll rely on

`CLAUDE.md` § Manual QA states that `WELCOME_CONTENT` in `src/NotesStorage.ts:6-55` and
`.github/welcome-content.md` are kept in sync. They currently differ only in the Tips table's column
padding — the `.md` copy has been through mdpad's table formatter and the TypeScript template literal
has not. That difference is pre-existing and cosmetic; the prose must match line for line.

Two changesets are open at the end of this work, `hidden-syntax-mode` (written at `01`) and
`team-notes-scope`. Both are `minor`. The release workflow aggregates them into one version PR.

## Steps

### Step 1 — `README.md`

- [x] Under **Organizing**, add a **Team notes** section after "Workspace & Global notes": what the
  folder is, that identity is the filename, that `activeId` is per-user and never committed, that
  empty pages are not written, and that the conflict policy is last-writer-wins with git as the merge
  tool. Name `mdpad: Switch to Team Notes` as the entry point and `mdpad: Copy Page To…` as the way to
  move existing notes in.

- [x] Add `mdpad.teamNotesFolder` to the settings table.

- [x] Update the "Search across pages" line — it says "both scopes" and there are now up to three.

### Step 2 — `CLAUDE.md`

- [x] Extend the `src/extension.ts` bullet with the scope registry, the third scope, and the two new
  commands; add bullets for `src/storageTypes.ts`, `src/FileNotesStorage.ts`, `src/slug.ts`, and
  `src/webview/hiddenRanges.ts`.

- [x] Add hidden-syntax mode next to the muted-syntax design decision, stated as *muted is still the
  default and must stay byte-identical* — that is the constraint a future contributor needs, not the
  feature description.

- [x] Add a Team notes section mirroring the Settings Sync one, and add `mdpad.teamActiveId` and the
  `mdpad.teamAvailable` context key to § Naming.

### Step 3 — welcome content, both copies

- [x] Replace the "Globe icon" tip with one that names the scope cycle, mention **Copy Page To…** in
  the overflow-menu tip, and add a one-line pointer to `mdpad.syntaxMode`.

- [x] Make the same edit in `.github/welcome-content.md`. A drift here is invisible until a new user
  installs the extension, which is why it is its own checkpoint item below.

### Step 4 — `.github/test-content.md`

- [x] Add a Team Notes section listing the manual sequence from `03`'s checkpoint, so the QA pass has
  it without needing the `.ai` docs.

### Step 5 — `.changeset/team-notes-scope.md`

- [x] `"mdpad": minor`, describing the scope, the folder layout, the two commands, the external-edit
  reload, and the last-writer-wins policy.

## Checkpoint

- [x] `pnpm lint` (LF-normalized copy — see the caveat in `01`)
- [x] `pnpm compile`
- [x] `pnpm webpack`
- [x] `pnpm test:unit` — 206 passing
- [x] `pnpm test:e2e` — 129 passing
- [x] `pnpm test:integration` — 22 passing

1. **Control: `notesStorage.test.ts`'s "returns initial state with one welcome page" still passes.**
   It asserts `content.includes('Welcome to mdpad')`, so it is the guard that a `WELCOME_CONTENT` edit
   did not break the template literal — the one executable risk in this doc.

2. `diff` the prose of `WELCOME_CONTENT` against `.github/welcome-content.md`: identical apart from
   the pre-existing table padding.

3. `pnpm changeset status` lists both `hidden-syntax-mode` and `team-notes-scope`.

## What comes next

- **The manual passes that no suite can reach**: `01`'s F5 sidebar smoke in both syntax modes, `02`'s
  export-slug regression, and `03`'s team-notes flow against a real git clone. They are the reason the
  automated checkpoints above are necessary but not sufficient, and they are listed in their own docs
  rather than repeated here.

- **A team-notes welcome page** is still not written on folder creation, for the reason in `03`:
  `getState()` never writing is what keeps activation off the disk.

Everything lands bare per the repo's conventions — the reasoning stays in this doc, not in the code.
