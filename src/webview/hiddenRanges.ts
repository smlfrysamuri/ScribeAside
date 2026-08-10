import type { EditorState, Range } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import type { SyntaxMode } from './types'

// ---------------------------------------------------------------------------
// Entry model
// ---------------------------------------------------------------------------

export const MARKER_CONSTRUCTS = [
  'heading',
  'emphasis',
  'link',
  'highlight',
  'task',
  'blockquote',
  'ol',
  'hr',
  'fence',
  'table',
  'frontmatter',
  'code',
] as const

export type MarkerConstruct = (typeof MARKER_CONSTRUCTS)[number]

// Constructs whose markers collapse in hidden mode. Fences, table pipes,
// frontmatter, horizontal rules and ordered-list numbers stay muted: hiding
// them either leaves a blank line where a delimiter was, destroys visible
// alignment, or removes content meaning. `code` is whatever the regex passes
// matched inside a code block, where nothing may be collapsed at all.
export const HIDEABLE_CONSTRUCTS: ReadonlySet<MarkerConstruct> =
  new Set<MarkerConstruct>([
    'heading',
    'emphasis',
    'link',
    'highlight',
    'task',
    'blockquote',
  ])

export interface CharRange {
  from: number
  to: number
}

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
  // The span to collapse in hidden mode, when it differs from the muted span.
  // A task marker mutes its whole `  - ` prefix but must only collapse the
  // bullet, or nesting depth disappears; a nested blockquote mutes one `> `
  // but must collapse every `>` on the line, or one is left stranded.
  hideFrom?: number
  hideTo?: number
}

export type DecorationEntry = StyleEntry | MarkerEntry

// Exported so tests can assert a span was collapsed rather than muted.
export const hiddenMark = Decoration.replace({})

export const NO_ACTIVE_RANGES: readonly CharRange[] = []

// ---------------------------------------------------------------------------
// Range arithmetic
// ---------------------------------------------------------------------------

export const mergeRanges = (ranges: readonly CharRange[]): CharRange[] => {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: CharRange[] = [{ from: sorted[0].from, to: sorted[0].to }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const next = sorted[i]
    if (next.from <= last.to) {
      if (next.to > last.to) last.to = next.to
    } else {
      merged.push({ from: next.from, to: next.to })
    }
  }
  return merged
}

export const computeActiveLines = (state: EditorState): CharRange[] => {
  const doc = state.doc
  const lines: CharRange[] = []
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from)
    const to = range.to <= first.to ? first.to : doc.lineAt(range.to).to
    lines.push({ from: first.from, to })
  }
  return mergeRanges(lines)
}

// Both ends inclusive: a marker ending on the active line's last position is
// revealed, while one starting at the first position of the next line is not.
export const isRevealed = (
  from: number,
  to: number,
  active: readonly CharRange[],
): boolean => {
  for (const range of active) {
    if (to >= range.from && from <= range.to) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Materialize
// ---------------------------------------------------------------------------

export const materialize = (
  entries: readonly DecorationEntry[],
  mode: SyntaxMode,
  active: readonly CharRange[],
): Range<Decoration>[] => {
  // Muted mode walks the entries in emission order and converts one-for-one.
  // Any regrouping here would change decoration ordering, and therefore DOM
  // nesting, relative to the pre-hidden-mode builder.
  if (mode === 'muted') {
    return entries.map(entry =>
      entry.kind === 'style'
        ? entry.range
        : entry.deco.range(entry.from, entry.to),
    )
  }

  const ranges: Range<Decoration>[] = []
  const hidden: CharRange[] = []

  for (const entry of entries) {
    if (entry.kind === 'style') {
      ranges.push(entry.range)
      continue
    }
    if (
      HIDEABLE_CONSTRUCTS.has(entry.construct) &&
      !isRevealed(entry.from, entry.to, active)
    ) {
      hidden.push({
        from: entry.hideFrom ?? entry.from,
        to: entry.hideTo ?? entry.to,
      })
      continue
    }
    ranges.push(entry.deco.range(entry.from, entry.to))
  }

  // Merging first makes partial overlap between two replace decorations
  // impossible by construction.
  for (const range of mergeRanges(hidden)) {
    if (range.to > range.from) {
      ranges.push(hiddenMark.range(range.from, range.to))
    }
  }

  return ranges
}
