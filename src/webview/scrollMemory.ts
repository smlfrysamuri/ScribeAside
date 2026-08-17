// Where the user had scrolled to, remembered across the webview's own death.
//
// A sidebar webview is thrown away when the view is collapsed and rebuilt from
// an empty document when it comes back, so nothing the editor holds survives on
// its own: the host re-sends the note and the editor lands at the top of it.
// These entries ride in the webview's persisted state (`setState`/`getState`),
// which is the one thing VS Code carries across that teardown, and they are
// keyed by page id so returning to a note restores *that* note's place rather
// than wherever the last note happened to be.

export interface ScrollEntry {
  id: string
  // The first line in view, as a document offset. A pixel offset would not
  // survive the sidebar being resized while it was hidden — with line wrapping
  // on, the same scrollTop is a different line at a different width — but a
  // line is still the same line.
  pos: number
  // Reader mode scrolls rendered HTML, which has no document offsets, so its
  // place is kept in pixels.
  readerTop: number
}

// The whole list is serialised on every save, and the place you left a note
// fifty notes ago is not the one you came back for.
export const MAX_ENTRIES = 50

const asOffset = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

// Persisted state outlives the code that wrote it — an older ScribeAside, or a
// hand-edited workspace file — so nothing read back here is trusted.
export const readEntries = (raw: unknown): ScrollEntry[] => {
  if (!Array.isArray(raw)) return []
  const entries: ScrollEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' || !id) continue
    entries.push({
      id,
      pos: asOffset((item as { pos?: unknown }).pos),
      readerTop: asOffset((item as { readerTop?: unknown }).readerTop),
    })
    if (entries.length === MAX_ENTRIES) break
  }
  return entries
}

export const recallScroll = (
  entries: ScrollEntry[],
  id: string,
): ScrollEntry | undefined =>
  id ? entries.find(entry => entry.id === id) : undefined

// Merged, never replaced: the editor and the reader each report only their own
// half of an entry, and a save from one must not forget where the other was.
export const rememberScroll = (
  entries: ScrollEntry[],
  id: string,
  place: Partial<Omit<ScrollEntry, 'id'>>,
): ScrollEntry[] => {
  if (!id) return entries
  const previous = recallScroll(entries, id)
  const updated: ScrollEntry = {
    id,
    pos: asOffset(place.pos ?? previous?.pos),
    readerTop: asOffset(place.readerTop ?? previous?.readerTop),
  }
  // Most recent first, so the cap drops the notes least likely to be reopened.
  return [updated, ...entries.filter(entry => entry.id !== id)].slice(
    0,
    MAX_ENTRIES,
  )
}
