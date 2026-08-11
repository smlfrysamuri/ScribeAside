// Page ids in the folder-backed (team) scope are paths relative to the notes
// folder, always with `/` separators — `note.md` at the root, `design/spec.md`
// one level down. The memento-backed scopes never produce a `/`, so every
// helper here degrades to "the whole id is the filename, the folder is ''".

export const dirOf = (id: string): string => {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? '' : id.slice(0, slash)
}

export const baseOf = (id: string): string => id.slice(id.lastIndexOf('/') + 1)

export const joinId = (dir: string, name: string): string =>
  dir ? `${dir}/${name}` : name

// Ordering is the plain path sort, and it has to be the *same* comparator
// everywhere: load() sorts the flattened walk with it and insertPage() places
// new pages with it, so the in-memory list can never disagree with what a
// fresh load would produce.
export const comparePageIds = (a: string, b: string): number =>
  a.localeCompare(b)

// A relative id is only ever built from names the filesystem handed us, but it
// then goes straight back into Uri.joinPath. `..` would escape the notes
// folder, so it is rejected at the boundary rather than trusted.
export const isSafeRelativeId = (id: string): boolean =>
  id.length > 0 &&
  !id.startsWith('/') &&
  !id.includes('\\') &&
  !id
    .split('/')
    .some(segment => segment === '' || segment === '.' || segment === '..')

export interface FolderEntry {
  name: string
  // Path relative to the notes folder, e.g. `design/api`.
  path: string
  // Notes anywhere beneath the folder, not just directly inside it — a folder
  // holding nothing but subfolders would otherwise read as empty.
  noteCount: number
}

export const childFolders = (
  ids: readonly string[],
  dir: string,
): FolderEntry[] => {
  const prefix = dir ? `${dir}/` : ''
  const counts = new Map<string, number>()
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue
    const rest = id.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) continue
    const name = rest.slice(0, slash)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, noteCount]) => ({ name, path: prefix + name, noteCount }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// The deepest existing ancestor of `dir` — used after a refresh or an external
// delete empties the folder the picker was browsing, so it can fall back
// instead of showing a directory that no longer holds anything.
export const nearestExistingDir = (
  ids: readonly string[],
  dir: string,
): string => {
  let current = dir
  while (current && !ids.some(id => id.startsWith(`${current}/`))) {
    current = dirOf(current)
  }
  return current
}
