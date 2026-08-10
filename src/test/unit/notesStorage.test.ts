import assert from 'node:assert'
import { beforeEach, describe, it } from 'mocha'
import { NotesStorage } from '../../NotesStorage'

// Minimal Memento mock
class MockMemento {
  private store = new Map<string, unknown>()
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined
  }
  update(key: string, value: unknown): Thenable<void> {
    this.store.set(key, value)
    return Promise.resolve()
  }
}

describe('NotesStorage', () => {
  let storage: NotesStorage

  beforeEach(() => {
    storage = new NotesStorage(new MockMemento() as never)
  })

  describe('getState', () => {
    it('returns initial state with one welcome page', () => {
      const state = storage.getState()
      assert.strictEqual(state.pages.length, 1)
      assert.strictEqual(state.activeId, state.pages[0].id)
      assert.ok(state.pages[0].content.includes('Welcome to ScribeAside'))
    })

    it('returns cached state on subsequent calls', () => {
      const first = storage.getState()
      const second = storage.getState()
      assert.strictEqual(first, second)
    })
  })

  describe('updateContent', () => {
    it('updates matching page content', () => {
      const state = storage.getState()
      const id = state.pages[0].id
      storage.updateContent(id, 'new content')
      assert.strictEqual(storage.getState().pages[0].content, 'new content')
    })

    it('does nothing for unknown id', () => {
      const state = storage.getState()
      const originalContent = state.pages[0].content
      storage.updateContent('unknown-id', 'new content')
      assert.strictEqual(storage.getState().pages[0].content, originalContent)
    })
  })

  describe('newPage', () => {
    it('creates an empty page and sets it as active', () => {
      const initialActiveId = storage.getState().activeId
      const result = storage.newPage()
      assert.strictEqual(result.pages.length, 2)
      assert.notStrictEqual(result.activeId, initialActiveId)
      assert.strictEqual(result.pages[1].content, '')
    })

    it('appends the new page', () => {
      storage.getState()
      const result = storage.newPage()
      assert.strictEqual(
        result.activeId,
        result.pages[result.pages.length - 1].id,
      )
    })
  })

  describe('deletePage', () => {
    it('removes the page', () => {
      storage.getState()
      storage.newPage()
      const state = storage.getState()
      assert.strictEqual(state.pages.length, 2)
      const idToDelete = state.pages[0].id
      const result = storage.deletePage(idToDelete)
      assert.strictEqual(result.pages.length, 1)
      assert.ok(!result.pages.some(p => p.id === idToDelete))
    })

    it('adjusts activeId when active page is deleted', () => {
      storage.getState()
      storage.newPage()
      const state = storage.getState()
      const activeId = state.activeId
      const result = storage.deletePage(activeId)
      assert.notStrictEqual(result.activeId, activeId)
      assert.ok(result.pages.some(p => p.id === result.activeId))
    })

    it('creates a new empty page when last page is deleted', () => {
      const state = storage.getState()
      const result = storage.deletePage(state.pages[0].id)
      assert.strictEqual(result.pages.length, 1)
      assert.strictEqual(result.pages[0].content, '')
    })

    it('does nothing for unknown id', () => {
      storage.getState()
      const before = storage.getState().pages.length
      storage.deletePage('unknown-id')
      assert.strictEqual(storage.getState().pages.length, before)
    })
  })

  describe('switchPage', () => {
    it('sets activeId', () => {
      storage.getState()
      const { pages } = storage.newPage()
      const firstId = pages[0].id
      storage.switchPage(firstId)
      assert.strictEqual(storage.getState().activeId, firstId)
    })

    it('does nothing for unknown id', () => {
      const state = storage.getState()
      const originalActive = state.activeId
      storage.switchPage('unknown-id')
      assert.strictEqual(storage.getState().activeId, originalActive)
    })
  })

  describe('previousPage', () => {
    it('switches to previous page', () => {
      storage.getState()
      storage.newPage()
      const state = storage.getState()
      const secondId = state.activeId
      storage.previousPage()
      assert.notStrictEqual(storage.getState().activeId, secondId)
    })

    it('does nothing on first page', () => {
      const state = storage.getState()
      storage.previousPage()
      assert.strictEqual(storage.getState().activeId, state.activeId)
    })
  })

  describe('nextPage', () => {
    it('switches to next page', () => {
      storage.getState()
      storage.newPage()
      const firstId = storage.getState().pages[0].id
      storage.switchPage(firstId)
      storage.nextPage()
      assert.notStrictEqual(storage.getState().activeId, firstId)
    })

    it('does nothing on last page', () => {
      const state = storage.getState()
      const activeId = state.activeId
      storage.nextPage()
      assert.strictEqual(storage.getState().activeId, activeId)
    })
  })

  describe('dual instances (global notes pattern)', () => {
    it('two instances on separate mementos are fully independent', () => {
      const workspaceMemento = new MockMemento() as never
      const globalMemento = new MockMemento() as never
      const workspaceStorage = new NotesStorage(workspaceMemento)
      const globalStorage = new NotesStorage(globalMemento)

      // Both start with one welcome page
      assert.strictEqual(workspaceStorage.getState().pages.length, 1)
      assert.strictEqual(globalStorage.getState().pages.length, 1)

      // Adding pages to one doesn't affect the other
      workspaceStorage.newPage()
      workspaceStorage.newPage()
      assert.strictEqual(workspaceStorage.getState().pages.length, 3)
      assert.strictEqual(globalStorage.getState().pages.length, 1)

      // Updating content in one doesn't affect the other
      const wsPageId = workspaceStorage.getState().pages[0].id
      workspaceStorage.updateContent(wsPageId, 'workspace note')
      assert.strictEqual(
        workspaceStorage.getState().pages[0].content,
        'workspace note',
      )
      assert.ok(globalStorage.getState().pages[0].content.includes('Welcome'))
    })

    it('each instance remembers its own active page', () => {
      const workspaceMemento = new MockMemento() as never
      const globalMemento = new MockMemento() as never
      const workspaceStorage = new NotesStorage(workspaceMemento)
      const globalStorage = new NotesStorage(globalMemento)

      workspaceStorage.newPage()
      const wsActiveId = workspaceStorage.getState().activeId

      globalStorage.newPage()
      const globalActiveId = globalStorage.getState().activeId

      // Each has its own active page
      assert.strictEqual(workspaceStorage.getState().activeId, wsActiveId)
      assert.strictEqual(globalStorage.getState().activeId, globalActiveId)
      assert.notStrictEqual(wsActiveId, globalActiveId)
    })
  })
})
