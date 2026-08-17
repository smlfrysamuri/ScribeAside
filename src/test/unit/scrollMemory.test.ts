import assert from 'node:assert'
import { describe, it } from 'mocha'
import {
  MAX_ENTRIES,
  readEntries,
  recallScroll,
  rememberScroll,
  type ScrollEntry,
} from '../../webview/scrollMemory'

const entry = (id: string, pos = 0, readerTop = 0): ScrollEntry => ({
  id,
  pos,
  readerTop,
})

describe('readEntries', () => {
  it('returns nothing for state that was never written', () => {
    assert.deepStrictEqual(readEntries(undefined), [])
    assert.deepStrictEqual(readEntries(null), [])
  })

  // Persisted state outlives the code that wrote it, so anything shaped wrong
  // is dropped rather than trusted into the editor's scroll position.
  it('drops entries that are not usable', () => {
    assert.deepStrictEqual(
      readEntries([
        null,
        'note.md',
        { pos: 10 },
        { id: '', pos: 10 },
        { id: 'note.md', pos: 10, readerTop: 20 },
      ]),
      [entry('note.md', 10, 20)],
    )
  })

  it('replaces unusable numbers with the top of the note', () => {
    assert.deepStrictEqual(
      readEntries([
        { id: 'a', pos: -5, readerTop: Number.NaN },
        { id: 'b', pos: '40', readerTop: Number.POSITIVE_INFINITY },
      ]),
      [entry('a'), entry('b')],
    )
  })

  it('caps a state file that grew beyond the limit', () => {
    const raw = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => ({
      id: `note-${i}`,
      pos: i,
      readerTop: 0,
    }))
    assert.strictEqual(readEntries(raw).length, MAX_ENTRIES)
  })
})

describe('rememberScroll', () => {
  it('records a note that has never been scrolled before', () => {
    assert.deepStrictEqual(rememberScroll([], 'a', { pos: 42 }), [
      entry('a', 42),
    ])
  })

  // The editor and the reader each report only their own half of an entry.
  it('keeps the half the caller did not report', () => {
    const entries = rememberScroll([entry('a', 42, 300)], 'a', { pos: 99 })
    assert.deepStrictEqual(entries, [entry('a', 99, 300)])

    assert.deepStrictEqual(rememberScroll(entries, 'a', { readerTop: 10 }), [
      entry('a', 99, 10),
    ])
  })

  it('moves the note it touched to the front without duplicating it', () => {
    const entries = rememberScroll(
      [entry('a', 1), entry('b', 2), entry('c', 3)],
      'b',
      { pos: 20 },
    )
    assert.deepStrictEqual(
      entries.map(e => e.id),
      ['b', 'a', 'c'],
    )
    assert.strictEqual(entries[0].pos, 20)
  })

  it('drops the least recently visited note once the cap is reached', () => {
    let entries: ScrollEntry[] = []
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      entries = rememberScroll(entries, `note-${i}`, { pos: i + 1 })
    }
    assert.strictEqual(entries.length, MAX_ENTRIES)
    assert.strictEqual(entries[0].id, `note-${MAX_ENTRIES + 4}`)
    assert.strictEqual(recallScroll(entries, 'note-0'), undefined)
  })

  // A webview that has not been told which note it is showing has nothing to
  // key on; writing an entry under '' would restore that position into
  // whichever note happened to arrive first.
  it('ignores a save with no page id', () => {
    const entries = [entry('a', 1)]
    assert.strictEqual(rememberScroll(entries, '', { pos: 50 }), entries)
  })
})

describe('recallScroll', () => {
  it('finds the entry for a note', () => {
    assert.deepStrictEqual(
      recallScroll([entry('a', 1), entry('b', 2)], 'b'),
      entry('b', 2),
    )
  })

  it('answers nothing for an unknown or empty id', () => {
    assert.strictEqual(recallScroll([entry('a', 1)], 'zzz'), undefined)
    assert.strictEqual(recallScroll([entry('a', 1)], ''), undefined)
  })
})
