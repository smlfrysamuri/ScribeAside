import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range, Text } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { findFrontmatterEndLine } from './frontmatter'
import {
  computeActiveLines,
  type DecorationEntry,
  type MarkerConstruct,
  materialize,
  NO_ACTIVE_RANGES,
} from './hiddenRanges'
import { olPattern, ulPattern } from './listPatterns'
import type { SyntaxMode } from './types'

// ---------------------------------------------------------------------------
// Decoration constants
// ---------------------------------------------------------------------------

const muted = Decoration.mark({ class: 'mdpad-muted' })

const boldMark = Decoration.mark({ class: 'mdpad-bold' })
const italicMark = Decoration.mark({ class: 'mdpad-italic' })
const strikeMark = Decoration.mark({ class: 'mdpad-strike' })
const highlightMark = Decoration.mark({ class: 'mdpad-highlight' })
const inlineCodeMark = Decoration.mark({ class: 'mdpad-inline-code' })
const linkTextMark = Decoration.mark({ class: 'mdpad-link-text' })
const headingMarks: Record<number, Decoration> = {
  1: Decoration.mark({ class: 'mdpad-heading mdpad-heading-1' }),
  2: Decoration.mark({ class: 'mdpad-heading mdpad-heading-2' }),
  3: Decoration.mark({ class: 'mdpad-heading mdpad-heading-3' }),
  4: Decoration.mark({ class: 'mdpad-heading mdpad-heading-4' }),
  5: Decoration.mark({ class: 'mdpad-heading mdpad-heading-5' }),
  6: Decoration.mark({ class: 'mdpad-heading mdpad-heading-6' }),
}
const headingPrefixMark = Decoration.mark({
  class: 'mdpad-muted mdpad-heading',
})

const headingConfig: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
}

// ---------------------------------------------------------------------------
// Entry emission
// ---------------------------------------------------------------------------

const pushStyle = (
  entries: DecorationEntry[],
  deco: Decoration,
  from: number,
  to: number,
): void => {
  entries.push({ kind: 'style', range: deco.range(from, to) })
}

const pushLine = (
  entries: DecorationEntry[],
  deco: Decoration,
  at: number,
): void => {
  entries.push({ kind: 'style', range: deco.range(at) })
}

const pushMarker = (
  entries: DecorationEntry[],
  from: number,
  to: number,
  construct: MarkerConstruct,
  options: {
    deco?: Decoration
    hideFrom?: number
    hideTo?: number
  } = {},
): void => {
  entries.push({
    kind: 'marker',
    from,
    to,
    construct,
    deco: options.deco ?? muted,
    hideFrom: options.hideFrom,
    hideTo: options.hideTo,
  })
}

// ---------------------------------------------------------------------------
// Per-node-type decoration helpers
// ---------------------------------------------------------------------------

const linkPattern = /^\[(.+?)\]\((.+?)\)$/
const taskListPattern = /^(\s*[-*+]\s+)\[([ xX])\]\s/
const blockquotePrefixPattern = /^>\s?/
// Every `>` on the line, so hidden mode does not strand the inner marker of a
// nested quote. Muted mode still dims only the first, as it always has.
const blockquoteFullPrefixPattern = /^(?:>\s?)+/
const tableSeparatorPattern = /^\|?[\s-:|]+\|?$/
const headingPattern = /^(#{1,6})\s/
const highlightPattern = /==(.*?)==/g
const checkedBoxPattern = /\[(x|X)\]/
const uncheckedBoxPattern = /\[ \]/
const inlineLinkPattern = /\[.+?\]\((.+?)\)/

const decorateHeading = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
  name: string,
): void => {
  const text = doc.sliceString(from, to)
  const hashMatch = text.match(headingPattern)
  if (hashMatch) {
    const prefixEnd = from + hashMatch[0].length
    const level = headingConfig[name]
    pushMarker(entries, from, prefixEnd, 'heading', {
      deco: headingPrefixMark,
    })
    if (prefixEnd < to) {
      pushStyle(entries, headingMarks[level], prefixEnd, to)
    }
  }
}

const decorateStrongEmphasis = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const text = doc.sliceString(from, to)
  const marker = text.startsWith('**') ? '**' : '__'
  const mLen = marker.length
  if (to - from > mLen * 2) {
    pushMarker(entries, from, from + mLen, 'emphasis')
    pushStyle(entries, boldMark, from + mLen, to - mLen)
    pushMarker(entries, to - mLen, to, 'emphasis')
  }
}

const decorateEmphasis = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const text = doc.sliceString(from, to)
  const marker = text.startsWith('*') ? '*' : '_'
  const mLen = marker.length
  if (to - from > mLen * 2) {
    pushMarker(entries, from, from + mLen, 'emphasis')
    pushStyle(entries, italicMark, from + mLen, to - mLen)
    pushMarker(entries, to - mLen, to, 'emphasis')
  }
}

const decorateStrikethrough = (
  entries: DecorationEntry[],
  from: number,
  to: number,
): void => {
  if (to - from > 4) {
    pushMarker(entries, from, from + 2, 'emphasis')
    pushStyle(entries, strikeMark, from + 2, to - 2)
    pushMarker(entries, to - 2, to, 'emphasis')
  }
}

const decorateInlineCode = (
  entries: DecorationEntry[],
  from: number,
  to: number,
): void => {
  if (to - from > 2) {
    pushMarker(entries, from, from + 1, 'emphasis')
    pushStyle(entries, inlineCodeMark, from + 1, to - 1)
    pushMarker(entries, to - 1, to, 'emphasis')
  }
}

const decorateLink = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const text = doc.sliceString(from, to)
  const match = text.match(linkPattern)
  if (match) {
    const textEnd = from + 1 + match[1].length
    pushMarker(entries, from, from + 1, 'link')
    pushStyle(entries, linkTextMark, from + 1, textEnd)
    pushMarker(entries, textEnd, textEnd + 2, 'link')
    pushMarker(entries, textEnd + 2, to - 1, 'link')
    pushMarker(entries, to - 1, to, 'link')
  }
}

const decorateBlockquote = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const startLine = doc.lineAt(from)
  const endLine = doc.lineAt(to)
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i)
    pushLine(entries, Decoration.line({ class: 'mdpad-blockquote' }), line.from)
    const bqMatch = line.text.match(blockquotePrefixPattern)
    if (bqMatch) {
      const fullMatch = line.text.match(blockquoteFullPrefixPattern)
      pushMarker(
        entries,
        line.from,
        line.from + bqMatch[0].length,
        'blockquote',
        { hideTo: line.from + (fullMatch?.[0].length ?? bqMatch[0].length) },
      )
    }
  }
}

const listBulletMark = Decoration.mark({ class: 'mdpad-list-bullet' })

const decorateListItem = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  insideCode = false,
): void => {
  const line = doc.lineAt(from)
  const taskMatch = line.text.match(taskListPattern)
  if (taskMatch) {
    const dashEnd = line.from + taskMatch[1].length
    const bracketStart = dashEnd
    const bracketEnd = dashEnd + 3
    const contentStart = bracketEnd + 1
    const isChecked = taskMatch[2] !== ' '
    // taskListPattern's first group swallows the leading indentation, and
    // collapsing that would flatten every nested task to the left margin.
    const indentLength = taskMatch[1].length - taskMatch[1].trimStart().length

    pushMarker(entries, line.from, dashEnd, insideCode ? 'code' : 'task', {
      hideFrom: line.from + indentLength,
    })
    pushStyle(
      entries,
      Decoration.mark({ class: 'mdpad-task-bracket' }),
      bracketStart,
      bracketEnd,
    )

    if (isChecked && contentStart < line.to) {
      pushStyle(
        entries,
        Decoration.mark({ class: 'mdpad-task-checked' }),
        contentStart,
        line.to,
      )
    }
    return
  }

  const ulMatch = line.text.match(ulPattern)
  if (ulMatch) {
    const markerStart = line.from + ulMatch[1].length
    const markerEnd = markerStart + ulMatch[2].length
    pushStyle(entries, listBulletMark, markerStart, markerEnd)
    return
  }

  const olMatch = line.text.match(olPattern)
  if (olMatch) {
    const markerStart = line.from + olMatch[1].length
    const markerEnd = markerStart + olMatch[2].length + olMatch[3].length
    pushMarker(entries, markerStart, markerEnd, insideCode ? 'code' : 'ol')
    return
  }
}

const decorateHorizontalRule = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const line = doc.lineAt(from)
  pushMarker(entries, from, to, 'hr')
  pushLine(entries, Decoration.line({ class: 'mdpad-hr' }), line.from)
}

const decorateFencedCode = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const startLine = doc.lineAt(from)
  const endLine = doc.lineAt(to)

  if (startLine.number === endLine.number) return

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i)
    if (
      (i === startLine.number || i === endLine.number) &&
      line.from < line.to
    ) {
      pushMarker(entries, line.from, line.to, 'fence')
    }
    pushLine(entries, Decoration.line({ class: 'mdpad-code-line' }), line.from)
  }
}

const decorateTable = (
  entries: DecorationEntry[],
  doc: Text,
  from: number,
  to: number,
): void => {
  const startLine = doc.lineAt(from)
  const endLine = doc.lineAt(to)

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i)
    const lineText = line.text

    const isSeparator = tableSeparatorPattern.test(lineText)

    if (isSeparator) {
      pushMarker(entries, line.from, line.to, 'table')
    } else {
      for (let j = 0; j < lineText.length; j++) {
        if (lineText[j] === '|') {
          pushMarker(entries, line.from + j, line.from + j + 1, 'table')
        }
      }
      if (i === startLine.number) {
        pushLine(
          entries,
          Decoration.line({ class: 'mdpad-table-header' }),
          line.from,
        )
      }
    }
    pushLine(entries, Decoration.line({ class: 'mdpad-table-line' }), line.from)
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const scanDecorations = (view: EditorView): DecorationEntry[] => {
  const entries: DecorationEntry[] = []
  const tree = syntaxTree(view.state)
  const doc = view.state.doc

  // Determine frontmatter boundary to skip tree decorations inside it
  const frontmatterEndLine = findFrontmatterEndLine(doc)
  const frontmatterEnd =
    frontmatterEndLine > 0 ? doc.line(frontmatterEndLine).to : -1

  const listItemLines = new Set<number>()
  // Lines belonging to a code block. The two regex passes below run over raw
  // line text and cannot tell code from prose; in muted mode a stray dimmed
  // marker inside a fence was cosmetic, but hidden mode would collapse it and
  // silently change what the code block appears to contain.
  const codeLines = new Set<number>()

  const recordCodeLines = (from: number, to: number): void => {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    for (let i = first; i <= last; i++) codeLines.add(i)
  }

  tree.iterate({
    enter(node) {
      const { from, to, name } = node
      if (frontmatterEnd >= 0 && from < frontmatterEnd) return

      if (headingConfig[name]) {
        decorateHeading(entries, doc, from, to, name)
        return
      }
      if (name === 'StrongEmphasis') {
        decorateStrongEmphasis(entries, doc, from, to)
        return
      }
      if (name === 'Emphasis') {
        decorateEmphasis(entries, doc, from, to)
        return
      }
      if (name === 'Strikethrough') {
        decorateStrikethrough(entries, from, to)
        return
      }
      if (name === 'InlineCode') {
        decorateInlineCode(entries, from, to)
        return
      }
      if (name === 'Link') {
        decorateLink(entries, doc, from, to)
        return
      }
      if (name === 'Blockquote') {
        decorateBlockquote(entries, doc, from, to)
        return
      }
      if (name === 'ListItem') {
        decorateListItem(entries, doc, from)
        listItemLines.add(doc.lineAt(from).number)
        return
      }
      if (name === 'HorizontalRule') {
        decorateHorizontalRule(entries, doc, from, to)
        return
      }
      if (name === 'FencedCode') {
        decorateFencedCode(entries, doc, from, to)
        recordCodeLines(from, to)
        return
      }
      if (name === 'CodeBlock') {
        recordCodeLines(from, to)
        return
      }
      if (name === 'Table') {
        decorateTable(entries, doc, from, to)
        return
      }
    },
  })

  // Fallback: decorate list markers on lines the parser missed (deeply nested)
  for (let i = 1; i <= doc.lines; i++) {
    if (listItemLines.has(i)) continue
    const line = doc.line(i)
    if (frontmatterEnd >= 0 && line.from < frontmatterEnd) continue
    decorateListItem(entries, doc, line.from, codeLines.has(i))
  }

  // Frontmatter --- block at top of document
  if (frontmatterEndLine > 0) {
    const firstLine = doc.line(1)
    pushMarker(entries, firstLine.from, firstLine.to, 'frontmatter')
    for (let i = 2; i <= frontmatterEndLine; i++) {
      const line = doc.line(i)
      if (i === frontmatterEndLine) {
        pushMarker(entries, line.from, line.to, 'frontmatter')
        break
      }
      const colonIdx = line.text.indexOf(':')
      if (colonIdx !== -1 && line.from < line.to) {
        pushMarker(entries, line.from, line.from + colonIdx + 1, 'frontmatter')
      }
    }
  }

  // Highlight ==text== (not a GFM node, requires regex pass)
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    highlightPattern.lastIndex = 0
    for (
      let match = highlightPattern.exec(line.text);
      match !== null;
      match = highlightPattern.exec(line.text)
    ) {
      // Skip empty matches (`====`) — a zero-width mark range is invalid and
      // CodeMirror will throw. This happens while typing, e.g. after Cmd+E on
      // an empty selection inserts `====` with the cursor in the middle.
      if (match[1].length === 0) continue
      const start = line.from + match.index
      const end = start + match[0].length
      const construct = codeLines.has(i) ? 'code' : 'highlight'
      pushMarker(entries, start, start + 2, construct)
      pushStyle(entries, highlightMark, start + 2, end - 2)
      pushMarker(entries, end - 2, end, construct)
    }
  }

  return entries
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const buildSet = (
  entries: readonly DecorationEntry[],
  state: EditorState,
  mode: SyntaxMode,
): DecorationSet => {
  const active =
    mode === 'hidden' ? computeActiveLines(state) : NO_ACTIVE_RANGES
  const ranges: Range<Decoration>[] = materialize(entries, mode, active)
  ranges.sort((a, b) => a.from - b.from)
  return Decoration.set(ranges, true)
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

export const markdownDecorations = (mode: SyntaxMode) =>
  ViewPlugin.fromClass(
    class {
      entries: DecorationEntry[]
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.entries = scanDecorations(view)
        this.decorations = buildSet(this.entries, view.state, mode)
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.entries = scanDecorations(update.view)
          this.decorations = buildSet(this.entries, update.state, mode)
          return
        }
        // Hidden mode is the only mode whose output depends on the selection,
        // so muted mode keeps the pre-hidden-mode rebuild predicate exactly.
        if (mode === 'hidden' && update.selectionSet) {
          this.decorations = buildSet(this.entries, update.state, mode)
        }
      }
    },
    {
      decorations: v => v.decorations,
    },
  )

// ---------------------------------------------------------------------------
// Click handlers
// ---------------------------------------------------------------------------

export const attachClickHandlers = (
  view: EditorView,
  onOpenLink: (url: string) => void,
): void => {
  view.dom.addEventListener('mousedown', e => {
    const target = e.target as HTMLElement

    // --- Checkbox toggle ---
    if (target.closest('.mdpad-task-bracket')) {
      e.preventDefault()
      e.stopPropagation()

      let pos: number
      try {
        pos = view.posAtDOM(target)
      } catch {
        return
      }

      const line = view.state.doc.lineAt(pos)
      const lineText = line.text

      let newText: string
      if (checkedBoxPattern.test(lineText)) {
        newText = lineText.replace(checkedBoxPattern, '[ ]')
      } else if (uncheckedBoxPattern.test(lineText)) {
        newText = lineText.replace(uncheckedBoxPattern, '[x]')
      } else {
        return
      }

      view.dispatch({
        changes: { from: line.from, to: line.to, insert: newText },
      })
      return
    }

    // --- Cmd/Ctrl + click link ---
    if ((e.metaKey || e.ctrlKey) && target.closest('.mdpad-link-text')) {
      e.preventDefault()
      e.stopPropagation()

      let pos: number
      try {
        pos = view.posAtDOM(target)
      } catch {
        return
      }

      const line = view.state.doc.lineAt(pos)
      const lineText = line.text

      // Find the link URL in the line
      const linkMatch = lineText.match(inlineLinkPattern)
      if (linkMatch) {
        onOpenLink(linkMatch[1])
      }
    }
  })
}
