import assert from 'node:assert'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { describe, it } from 'mocha'
import {
  type CharRange,
  computeActiveLines,
  type DecorationEntry,
  HIDEABLE_CONSTRUCTS,
  hiddenMark,
  isRevealed,
  MARKER_CONSTRUCTS,
  type MarkerConstruct,
  materialize,
  mergeRanges,
} from '../../webview/hiddenRanges'

const marker = Decoration.mark({ class: 'mdpad-muted' })
const style = Decoration.mark({ class: 'mdpad-bold' })

const markerEntry = (
  from: number,
  to: number,
  construct: MarkerConstruct,
): DecorationEntry => ({ kind: 'marker', from, to, construct, deco: marker })

const styleEntry = (from: number, to: number): DecorationEntry => ({
  kind: 'style',
  range: style.range(from, to),
})

const asPairs = (ranges: CharRange[]): [number, number][] =>
  ranges.map(r => [r.from, r.to])

describe('hiddenRanges', () => {
  describe('mergeRanges', () => {
    it('returns an empty array for no input', () => {
      assert.deepStrictEqual(mergeRanges([]), [])
    })

    it('passes a single range through', () => {
      assert.deepStrictEqual(asPairs(mergeRanges([{ from: 2, to: 5 }])), [
        [2, 5],
      ])
    })

    it('keeps disjoint ranges separate', () => {
      const merged = mergeRanges([
        { from: 0, to: 2 },
        { from: 5, to: 7 },
      ])
      assert.deepStrictEqual(asPairs(merged), [
        [0, 2],
        [5, 7],
      ])
    })

    it('merges overlapping ranges', () => {
      const merged = mergeRanges([
        { from: 0, to: 5 },
        { from: 3, to: 9 },
      ])
      assert.deepStrictEqual(asPairs(merged), [[0, 9]])
    })

    it('merges touching ranges', () => {
      const merged = mergeRanges([
        { from: 0, to: 3 },
        { from: 3, to: 6 },
      ])
      assert.deepStrictEqual(asPairs(merged), [[0, 6]])
    })

    it('absorbs a nested range', () => {
      const merged = mergeRanges([
        { from: 0, to: 10 },
        { from: 3, to: 6 },
      ])
      assert.deepStrictEqual(asPairs(merged), [[0, 10]])
    })

    it('collapses duplicates', () => {
      const merged = mergeRanges([
        { from: 4, to: 8 },
        { from: 4, to: 8 },
      ])
      assert.deepStrictEqual(asPairs(merged), [[4, 8]])
    })

    it('sorts unsorted input', () => {
      const merged = mergeRanges([
        { from: 9, to: 12 },
        { from: 0, to: 2 },
        { from: 4, to: 5 },
      ])
      assert.deepStrictEqual(asPairs(merged), [
        [0, 2],
        [4, 5],
        [9, 12],
      ])
    })

    it('does not mutate its input', () => {
      const input: CharRange[] = [
        { from: 0, to: 5 },
        { from: 3, to: 9 },
      ]
      mergeRanges(input)
      assert.deepStrictEqual(asPairs(input), [
        [0, 5],
        [3, 9],
      ])
    })
  })

  describe('computeActiveLines', () => {
    // "one\ntwo\nthree\nfour" — line starts at 0, 4, 8, 14
    const doc = 'one\ntwo\nthree\nfour'

    it('returns the cursor line for a collapsed selection', () => {
      const state = EditorState.create({ doc, selection: { anchor: 5 } })
      assert.deepStrictEqual(asPairs(computeActiveLines(state)), [[4, 7]])
    })

    it('returns every line a multi-line selection touches', () => {
      const state = EditorState.create({
        doc,
        selection: { anchor: 5, head: 15 },
      })
      assert.deepStrictEqual(asPairs(computeActiveLines(state)), [[4, 18]])
    })

    it('returns one range per disjoint cursor', () => {
      const multi = EditorState.create({
        doc,
        selection: EditorSelection.create(
          [EditorSelection.cursor(1), EditorSelection.cursor(15)],
          0,
        ),
        // EditorState.create collapses to a single range unless this is on.
        extensions: [EditorState.allowMultipleSelections.of(true)],
      })
      assert.deepStrictEqual(asPairs(computeActiveLines(multi)), [
        [0, 3],
        [14, 18],
      ])
    })

    it('reveals the following line when the selection ends at its start', () => {
      // head sits at position 8, the first position of "three"
      const state = EditorState.create({
        doc,
        selection: { anchor: 5, head: 8 },
      })
      assert.deepStrictEqual(asPairs(computeActiveLines(state)), [[4, 13]])
    })

    it('handles an empty document', () => {
      const state = EditorState.create({ doc: '', selection: { anchor: 0 } })
      assert.deepStrictEqual(asPairs(computeActiveLines(state)), [[0, 0]])
    })
  })

  describe('isRevealed', () => {
    const active: CharRange[] = [{ from: 10, to: 20 }]

    it('reveals a marker inside the active line', () => {
      assert.strictEqual(isRevealed(12, 14, active), true)
    })

    it('reveals a marker ending on the active line last position', () => {
      assert.strictEqual(isRevealed(18, 20, active), true)
    })

    it('hides a marker starting after the active line', () => {
      assert.strictEqual(isRevealed(21, 23, active), false)
    })

    it('hides a marker ending before the active line', () => {
      assert.strictEqual(isRevealed(7, 9, active), false)
    })

    it('checks every active range', () => {
      const multi: CharRange[] = [
        { from: 0, to: 3 },
        { from: 10, to: 20 },
      ]
      assert.strictEqual(isRevealed(1, 2, multi), true)
      assert.strictEqual(isRevealed(5, 6, multi), false)
    })

    it('hides everything when nothing is active', () => {
      assert.strictEqual(isRevealed(1, 2, []), false)
    })
  })

  describe('materialize — muted mode', () => {
    it('emits one range per entry, in entry order', () => {
      const entries: DecorationEntry[] = [
        markerEntry(0, 2, 'emphasis'),
        styleEntry(2, 6),
        markerEntry(6, 8, 'emphasis'),
      ]
      const ranges = materialize(entries, 'muted', [])
      assert.strictEqual(ranges.length, 3)
      assert.deepStrictEqual(
        ranges.map(r => [r.from, r.to]),
        [
          [0, 2],
          [2, 6],
          [6, 8],
        ],
      )
    })

    it('never emits a replace decoration', () => {
      const entries: DecorationEntry[] = [markerEntry(0, 2, 'heading')]
      const ranges = materialize(entries, 'muted', [])
      assert.strictEqual(ranges[0].value, marker)
    })

    it('ignores the active-range argument', () => {
      const entries: DecorationEntry[] = [markerEntry(0, 2, 'heading')]
      const withActive = materialize(entries, 'muted', [{ from: 0, to: 5 }])
      const withoutActive = materialize(entries, 'muted', [])
      assert.deepStrictEqual(
        withActive.map(r => [r.from, r.to, r.value]),
        withoutActive.map(r => [r.from, r.to, r.value]),
      )
    })
  })

  describe('materialize — hidden mode', () => {
    it('keeps style entries untouched', () => {
      const entries: DecorationEntry[] = [styleEntry(2, 6)]
      const ranges = materialize(entries, 'hidden', [])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].value, style)
    })

    it('collapses a hideable marker on an inactive line', () => {
      const entries: DecorationEntry[] = [markerEntry(0, 2, 'heading')]
      const ranges = materialize(entries, 'hidden', [{ from: 20, to: 30 }])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].value, hiddenMark)
    })

    it('mutes a hideable marker on the active line', () => {
      const entries: DecorationEntry[] = [markerEntry(0, 2, 'heading')]
      const ranges = materialize(entries, 'hidden', [{ from: 0, to: 10 }])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].value, marker)
    })

    it('mutes non-hideable constructs even on inactive lines', () => {
      // Derived, not hardcoded: a construct added to MARKER_CONSTRUCTS without
      // a decision about hiding shows up here instead of escaping coverage.
      const nonHideable = MARKER_CONSTRUCTS.filter(
        c => !HIDEABLE_CONSTRUCTS.has(c),
      )
      assert.ok(nonHideable.length > 0)
      for (const construct of nonHideable) {
        const ranges = materialize([markerEntry(0, 2, construct)], 'hidden', [])
        assert.strictEqual(
          ranges[0].value,
          marker,
          `${construct} should stay muted`,
        )
      }
    })

    it('merges adjacent hidden markers into one replace', () => {
      const entries: DecorationEntry[] = [
        markerEntry(4, 6, 'link'),
        markerEntry(6, 18, 'link'),
        markerEntry(18, 19, 'link'),
      ]
      const ranges = materialize(entries, 'hidden', [])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].value, hiddenMark)
      assert.strictEqual(ranges[0].from, 4)
      assert.strictEqual(ranges[0].to, 19)
    })

    it('merges duplicate hidden markers from overlapping passes', () => {
      const entries: DecorationEntry[] = [
        markerEntry(0, 2, 'highlight'),
        markerEntry(0, 2, 'highlight'),
      ]
      const ranges = materialize(entries, 'hidden', [])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].from, 0)
      assert.strictEqual(ranges[0].to, 2)
    })

    it('collapses only hideFrom..to when the marker narrows its hidden span', () => {
      const entry: DecorationEntry = {
        kind: 'marker',
        from: 0,
        to: 4,
        construct: 'task',
        deco: marker,
        hideFrom: 2,
      }
      const ranges = materialize([entry], 'hidden', [])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].from, 2)
      assert.strictEqual(ranges[0].to, 4)
    })

    it('collapses out to hideTo when the marker widens its hidden span', () => {
      const entry: DecorationEntry = {
        kind: 'marker',
        from: 0,
        to: 2,
        construct: 'blockquote',
        deco: marker,
        hideTo: 4,
      }
      const ranges = materialize([entry], 'hidden', [])
      assert.strictEqual(ranges.length, 1)
      assert.strictEqual(ranges[0].from, 0)
      assert.strictEqual(ranges[0].to, 4)
    })

    it('muted mode ignores hideFrom and hideTo', () => {
      const entry: DecorationEntry = {
        kind: 'marker',
        from: 0,
        to: 4,
        construct: 'task',
        deco: marker,
        hideFrom: 2,
        hideTo: 9,
      }
      const ranges = materialize([entry], 'muted', [])
      assert.strictEqual(ranges[0].from, 0)
      assert.strictEqual(ranges[0].to, 4)
    })

    it('drops a zero-width hidden span', () => {
      const entries: DecorationEntry[] = [markerEntry(5, 5, 'emphasis')]
      const ranges = materialize(entries, 'hidden', [])
      assert.strictEqual(ranges.length, 0)
    })

    it('emits style ranges before the collapsed spans', () => {
      const entries: DecorationEntry[] = [
        markerEntry(0, 2, 'emphasis'),
        styleEntry(2, 6),
        markerEntry(6, 8, 'emphasis'),
      ]
      const ranges = materialize(entries, 'hidden', [])
      assert.strictEqual(ranges[0].value, style)
      assert.strictEqual(ranges[1].value, hiddenMark)
      assert.strictEqual(ranges[2].value, hiddenMark)
    })
  })
})
