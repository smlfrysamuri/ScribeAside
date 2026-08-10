import assert from 'node:assert'
import { beforeEach, describe, it } from 'mocha'
import type * as vscode from 'vscode'
import { type ExternalChange, FileNotesStorage } from '../../FileNotesStorage'
import {
  calls,
  fireWatcher,
  fsDelete,
  fsList,
  fsMkdir,
  fsRead,
  fsReset,
  fsSetWriteDelay,
  fsWriteFile,
  resetCalls,
  resetWatchers,
  Uri,
} from './vscodeStub'

const FOLDER = 'file:///workspace/.mdpad'
const folderUri = Uri.file('/workspace/.mdpad') as unknown as vscode.Uri
const at = (name: string): string => `${FOLDER}/${name}`

const tick = (ms = 0): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

const FIXED_NOW = new Date(2026, 0, 2, 3, 4, 5)

describe('FileNotesStorage', () => {
  let activeId: string | undefined
  let changes: ExternalChange[]
  let unavailableCalls: number

  beforeEach(() => {
    fsReset()
    resetWatchers()
    resetCalls()
    activeId = undefined
    changes = []
    unavailableCalls = 0
  })

  const create = (
    overrides: Partial<ConstructorParameters<typeof FileNotesStorage>[0]> = {},
  ): FileNotesStorage =>
    new FileNotesStorage({
      folderUri,
      getActiveId: () => activeId,
      setActiveId: id => {
        activeId = id
      },
      onExternalChange: change => {
        changes.push(change)
      },
      onUnavailable: () => {
        unavailableCalls++
      },
      debounceMs: 0,
      now: () => FIXED_NOW,
      ...overrides,
    })

  const writeCount = (): number =>
    calls.filter(c => c.method === 'workspace.fs.writeFile').length

  describe('initialize', () => {
    it('loads .md files ordered by filename', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('b.md'), 'bee')
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('notes.txt'), 'ignored')

      const storage = create()
      await storage.initialize()

      assert.strictEqual(storage.isAvailable, true)
      const state = storage.getState()
      assert.deepStrictEqual(
        state.pages.map(p => p.id),
        ['a.md', 'b.md'],
      )
      assert.strictEqual(state.pages[0].content, 'ay')
      assert.strictEqual(state.activeId, 'a.md')
    })

    it('reports unavailable when the folder is missing', async () => {
      const storage = create()
      await storage.initialize()
      assert.strictEqual(storage.isAvailable, false)
    })

    it('reports unavailable when the path is a file', async () => {
      fsWriteFile(FOLDER, 'not a folder')
      const storage = create()
      await storage.initialize()
      assert.strictEqual(storage.isAvailable, false)
    })

    it('restores the saved active page when it still exists', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      activeId = 'b.md'

      const storage = create()
      await storage.initialize()
      assert.strictEqual(storage.getState().activeId, 'b.md')
    })

    it('falls back to the first page when the saved active page is gone', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      activeId = 'deleted.md'

      const storage = create()
      await storage.initialize()
      assert.strictEqual(storage.getState().activeId, 'a.md')
    })
  })

  describe('getState never writes', () => {
    it('returns a renderable state without creating anything when unavailable', async () => {
      const storage = create()
      await storage.initialize()

      const state = storage.getState()
      assert.strictEqual(state.pages.length, 1)
      assert.strictEqual(state.pages[0].content, '')
      assert.strictEqual(state.activeId, state.pages[0].id)

      await tick()
      assert.deepStrictEqual(fsList(), [])
      assert.strictEqual(writeCount(), 0)
    })

    it('returns one draft page for an existing empty folder without writing', async () => {
      fsMkdir(FOLDER)
      const storage = create()
      await storage.initialize()

      assert.strictEqual(storage.getState().pages.length, 1)
      await tick()
      assert.deepStrictEqual(fsList(), [FOLDER])
      assert.strictEqual(writeCount(), 0)
    })
  })

  describe('lazy first write', () => {
    it('does not create a file while the draft is empty', async () => {
      fsMkdir(FOLDER)
      const storage = create()
      await storage.initialize()

      storage.updateContent(storage.getState().activeId, '')
      await tick()
      assert.strictEqual(writeCount(), 0)
    })

    it('creates the file on the first non-empty edit', async () => {
      fsMkdir(FOLDER)
      const storage = create()
      await storage.initialize()
      const id = storage.getState().activeId

      storage.updateContent(id, '# hello')
      await tick()
      await storage.flush()

      assert.strictEqual(fsRead(at(id)), '# hello')
    })
  })

  describe('debounced writes', () => {
    it('coalesces rapid edits into a single write', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'start')
      const storage = create({ debounceMs: 20 })
      await storage.initialize()

      storage.updateContent('a.md', 'one')
      storage.updateContent('a.md', 'two')
      storage.updateContent('a.md', 'three')
      await storage.flush()

      assert.strictEqual(writeCount(), 1)
      assert.strictEqual(fsRead(at('a.md')), 'three')
    })

    it('flush resolves after the pending write has landed', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'start')
      const storage = create({ debounceMs: 10_000 })
      await storage.initialize()

      storage.updateContent('a.md', 'flushed')
      await storage.flush()
      assert.strictEqual(fsRead(at('a.md')), 'flushed')
    })

    // Two overlapping writes to one page can land out of order, leaving stale
    // text on disk while the cache holds the new text — and the watcher then
    // suppresses its own echo, so nothing reports the divergence.
    it('never runs two writes for one page concurrently', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'start')
      const storage = create({ debounceMs: 5 })
      await storage.initialize()

      fsSetWriteDelay(30)
      storage.updateContent('a.md', 'v1')
      await tick(15)
      storage.updateContent('a.md', 'v2')
      await storage.flush()
      await tick(80)

      assert.strictEqual(fsRead(at('a.md')), 'v2')
      assert.strictEqual(storage.getState().pages[0].content, 'v2')
    })

    it('flush awaits a write that was already in flight', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'start')
      const storage = create({ debounceMs: 5 })
      await storage.initialize()

      fsSetWriteDelay(30)
      storage.updateContent('a.md', 'v1')
      await tick(15)
      storage.updateContent('a.md', 'v2')
      await storage.flush()

      // Both the cache and the disk agree the moment flush() resolves.
      assert.strictEqual(fsRead(at('a.md')), 'v2')
    })

    it('flush awaits an outstanding delete', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      const storage = create()
      await storage.initialize()

      storage.deletePage('a.md')
      await storage.flush()

      assert.strictEqual(fsRead(at('a.md')), undefined)
    })

    it('ignores an update for an unknown page', async () => {
      fsMkdir(FOLDER)
      const storage = create()
      await storage.initialize()
      storage.updateContent('nope.md', 'x')
      await storage.flush()
      assert.strictEqual(writeCount(), 0)
    })
  })

  describe('newPage', () => {
    it('names files from the clock', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('zz.md'), 'existing')
      const storage = create()
      await storage.initialize()

      const state = storage.newPage()
      assert.strictEqual(state.activeId, 'note-20260102-030405.md')
    })

    // The empty-folder draft already occupies the clock-derived name, so the
    // first real page in a fresh folder is the `-2` case too.
    it('suffixes a same-second collision', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('note-20260102-030405.md'), 'taken')
      const storage = create()
      await storage.initialize()

      const state = storage.newPage()
      assert.strictEqual(state.activeId, 'note-20260102-030405-2.md')
    })

    it('inserts in filename order rather than appending', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('zz.md'), 'last alphabetically')
      const storage = create()
      await storage.initialize()

      storage.newPage()
      assert.deepStrictEqual(
        storage.getState().pages.map(p => p.id),
        ['note-20260102-030405.md', 'zz.md'],
      )
    })

    it('records the new active page through the injected setter', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('zz.md'), 'existing')
      const storage = create()
      await storage.initialize()
      storage.newPage()
      assert.strictEqual(activeId, 'note-20260102-030405.md')
    })
  })

  describe('deletePage', () => {
    it('removes the file', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      const storage = create()
      await storage.initialize()

      storage.deletePage('a.md')
      await tick()

      assert.strictEqual(fsRead(at('a.md')), undefined)
      assert.deepStrictEqual(
        storage.getState().pages.map(p => p.id),
        ['b.md'],
      )
    })

    it('does not resurrect the file from a pending write', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create({ debounceMs: 10 })
      await storage.initialize()

      storage.updateContent('a.md', 'edited after delete was queued')
      storage.deletePage('a.md')
      await tick(30)
      await storage.flush()

      assert.strictEqual(fsRead(at('a.md')), undefined)
    })

    // The pending-timer case above never issues a write at all. These two do:
    // the delete has to wait for a write that is genuinely in flight, and the
    // second covers a page whose *first* write is still running, so it is not
    // in `onDisk` at the moment it is deleted.
    it('waits for an in-flight write, then removes the file', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create()
      await storage.initialize()

      fsSetWriteDelay(20)
      storage.updateContent('a.md', 'slow write')
      await tick(5)
      storage.deletePage('a.md')
      await storage.flush()
      await tick(40)

      assert.strictEqual(fsRead(at('a.md')), undefined)
    })

    it('does not resurrect a page deleted during its very first write', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('keep.md'), 'keep me')
      const storage = create()
      await storage.initialize()

      const created = storage.newPage().activeId
      fsSetWriteDelay(20)
      storage.updateContent(created, 'important text')
      await tick(5)
      storage.deletePage(created)
      await storage.flush()
      await tick(40)

      assert.strictEqual(fsRead(at(created)), undefined)
      assert.strictEqual(fsRead(at('keep.md')), 'keep me')
    })

    it('leaves one empty draft when the last page goes', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create()
      await storage.initialize()

      const state = storage.deletePage('a.md')
      assert.strictEqual(state.pages.length, 1)
      assert.strictEqual(state.pages[0].content, '')
      assert.strictEqual(state.activeId, state.pages[0].id)
      // The per-user pointer follows, so a reload does not resolve a dead id.
      assert.strictEqual(activeId, state.pages[0].id)
    })

    it('advances the active pointer to the previous neighbour', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      const storage = create()
      await storage.initialize()
      storage.switchPage('b.md')

      storage.deletePage('b.md')
      assert.strictEqual(storage.getState().activeId, 'a.md')
    })

    it('ignores an unknown id', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create()
      await storage.initialize()

      storage.deletePage('nope.md')
      assert.strictEqual(storage.getState().pages.length, 1)
    })
  })

  describe('navigation', () => {
    const threePages = async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      fsWriteFile(at('c.md'), 'see')
      const storage = create()
      await storage.initialize()
      return storage
    }

    it('nextPage and previousPage walk the sorted list', async () => {
      const storage = await threePages()
      assert.strictEqual(storage.nextPage().activeId, 'b.md')
      assert.strictEqual(storage.nextPage().activeId, 'c.md')
      assert.strictEqual(storage.nextPage().activeId, 'c.md')
      assert.strictEqual(storage.previousPage().activeId, 'b.md')
    })

    it('persists every pointer move through the injected setter', async () => {
      const storage = await threePages()
      storage.nextPage()
      assert.strictEqual(activeId, 'b.md')
      storage.switchPage('c.md')
      assert.strictEqual(activeId, 'c.md')
    })

    it('never writes the active pointer into the folder', async () => {
      const storage = await threePages()
      storage.nextPage()
      await storage.flush()
      assert.deepStrictEqual(fsList(), [
        FOLDER,
        at('a.md'),
        at('b.md'),
        at('c.md'),
      ])
    })
  })

  describe('external changes', () => {
    const seeded = async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      const storage = create()
      await storage.initialize()
      return storage
    }

    it('ignores an event whose content matches the cache', async () => {
      const storage = await seeded()
      fireWatcher('change', at('a.md'))
      await tick()
      assert.deepStrictEqual(changes, [])
      assert.strictEqual(storage.getState().pages[0].content, 'ay')
    })

    it('applies a genuine external edit to the active page', async () => {
      const storage = await seeded()
      fsWriteFile(at('a.md'), 'edited elsewhere')
      fireWatcher('change', at('a.md'))
      await tick()

      assert.deepStrictEqual(changes, [{ activeContentChanged: true }])
      assert.strictEqual(
        storage.getState().pages[0].content,
        'edited elsewhere',
      )
    })

    it('applies an external edit to a non-active page without flagging content', async () => {
      const storage = await seeded()
      fsWriteFile(at('b.md'), 'edited elsewhere')
      fireWatcher('change', at('b.md'))
      await tick()

      assert.deepStrictEqual(changes, [{ activeContentChanged: false }])
      assert.strictEqual(
        storage.getState().pages[1].content,
        'edited elsewhere',
      )
    })

    it('suppresses the echo of our own write', async () => {
      const storage = await seeded()
      storage.updateContent('a.md', 'mine')
      await storage.flush()

      fireWatcher('change', at('a.md'))
      await tick()
      assert.deepStrictEqual(changes, [])
    })

    it('ignores an event while an edit is still debouncing', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create({ debounceMs: 10_000 })
      await storage.initialize()

      storage.updateContent('a.md', 'local edit in progress')
      fsWriteFile(at('a.md'), 'remote edit')
      fireWatcher('change', at('a.md'))
      await tick()

      assert.deepStrictEqual(changes, [])
      assert.strictEqual(
        storage.getState().pages[0].content,
        'local edit in progress',
      )
    })

    // The mid-edit guard is checked before the file read; without a re-check
    // after it, a keystroke landing inside the read's latency is overwritten
    // by the file's text and then written back over.
    it('does not overwrite a keystroke that lands during the read', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create({ debounceMs: 10_000 })
      await storage.initialize()

      fsWriteFile(at('a.md'), 'teammate text')
      fireWatcher('change', at('a.md'))
      // Same turn the read is awaiting in.
      storage.updateContent('a.md', 'user is typing this')
      await tick()

      assert.strictEqual(
        storage.getState().pages[0].content,
        'user is typing this',
      )
      assert.deepStrictEqual(changes, [])
    })

    it('inserts a teammate new file in sorted position', async () => {
      const storage = await seeded()
      fsWriteFile(at('aa.md'), 'from a teammate')
      fireWatcher('create', at('aa.md'))
      await tick()

      assert.deepStrictEqual(
        storage.getState().pages.map(p => p.id),
        ['a.md', 'aa.md', 'b.md'],
      )
      assert.deepStrictEqual(changes, [{ activeContentChanged: false }])
    })

    it('advances the active pointer when the active file is deleted', async () => {
      const storage = await seeded()
      storage.switchPage('b.md')
      fireWatcher('delete', at('b.md'))
      await tick()

      assert.strictEqual(storage.getState().activeId, 'a.md')
      assert.deepStrictEqual(changes, [{ activeContentChanged: true }])
    })

    it('flags the content change when the last remaining page is deleted', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('only.md'), 'the only page')
      const storage = create()
      await storage.initialize()

      fireWatcher('delete', at('only.md'))
      await tick()

      const state = storage.getState()
      assert.strictEqual(state.pages.length, 1)
      assert.strictEqual(state.pages[0].content, '')
      assert.strictEqual(state.activeId, state.pages[0].id)
      // The webview is still showing 'the only page' until this fires.
      assert.deepStrictEqual(changes, [{ activeContentChanged: true }])
    })

    it('ignores a delete for a page already gone from the cache', async () => {
      const storage = await seeded()
      storage.deletePage('a.md')
      await tick()
      changes = []

      fireWatcher('delete', at('a.md'))
      await tick()
      assert.deepStrictEqual(changes, [])
    })

    it('stops listening after dispose', async () => {
      const storage = await seeded()
      storage.dispose()
      fsWriteFile(at('a.md'), 'edited elsewhere')
      fireWatcher('change', at('a.md'))
      await tick()
      assert.deepStrictEqual(changes, [])
    })
  })

  describe('unavailable folder', () => {
    it('accepts edits without writing or throwing', async () => {
      const storage = create()
      await storage.initialize()

      storage.updateContent(storage.getState().activeId, 'typed anyway')
      storage.newPage()
      await storage.flush()

      assert.strictEqual(writeCount(), 0)
      assert.deepStrictEqual(fsList(), [])
    })

    // workspace.fs.writeFile creates missing parents, so without the pre-write
    // folder probe a deleted folder silently reappears on the next keystroke.
    it('does not recreate a folder the user deleted', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      const storage = create()
      await storage.initialize()
      assert.strictEqual(storage.isAvailable, true)

      fsDelete(at('a.md'))
      fsDelete(FOLDER)

      storage.updateContent('a.md', 'typed after the folder went away')
      await storage.flush()

      assert.deepStrictEqual(fsList(), [])
      assert.strictEqual(storage.isAvailable, false)
      assert.strictEqual(unavailableCalls, 1)
    })

    it('reports unavailability only once', async () => {
      fsMkdir(FOLDER)
      fsWriteFile(at('a.md'), 'ay')
      fsWriteFile(at('b.md'), 'bee')
      const storage = create()
      await storage.initialize()
      fsDelete(FOLDER)

      storage.updateContent('a.md', 'one')
      storage.updateContent('b.md', 'two')
      await storage.flush()

      assert.strictEqual(unavailableCalls, 1)
    })
  })
})
