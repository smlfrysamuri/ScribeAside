import type * as vscode from 'vscode'
import type { INotesStorage } from './storageTypes'
import type { NotesState, Page } from './webview/types'

const STORAGE_KEY = 'scribeaside.notes'

const WELCOME_CONTENT = `# Welcome to ScribeAside

Your markdown notepad inside VS Code.

## Formatting

**Bold**, *italic*, ~~strikethrough~~, \`inline code\`, and ==highlighted==.

## Lists

- Unordered list item
  * Nested with different marker
    + Deeply nested

1. Ordered list
2. With automatic
  1. Renumbering
  2. On indent

## Tasks

- [x] Completed task
- [ ] Uncompleted task
  - [ ] Nested task

## Blockquote

> Markdown syntax stays visible but dimmed.
> Content is styled live as you type.

## Tips

| Shortcut | Action |
| -------- | ------ |
| \`Cmd/Ctrl+B\` | Bold |
| \`Cmd/Ctrl+I\` | Italic |
| \`Cmd/Ctrl+D\` | Strikethrough |
| \`Cmd/Ctrl+K\` | Inline code |
| \`Cmd/Ctrl+E\` | Highlight |
| \`Cmd/Ctrl+H\` | Cycle heading |
| \`Cmd/Ctrl+F\` | Find in note |
| \`Cmd/Ctrl+Shift+F\` | Search all pages |
| \`Tab\` / \`Shift+Tab\` | Indent / outdent list |
| \`Alt+↑\` / \`Alt+↓\` | Move line up / down |

- Title bar icon: switch note scope — Workspace, Global, and Team once a team notes folder exists
- Overflow menu: Export, Copy Page To..., Settings
- Prefer reading over markup? Set \`scribeaside.syntaxMode\` to \`hidden\`.
- Want it fully rendered? Press \`Cmd/Ctrl+Shift+V\` for reader mode — press again (or double-click) to edit.

> Delete this page whenever you're ready to start fresh.
`

const createPage = (content = ''): Page => ({
  id: crypto.randomUUID(),
  content,
})

export class NotesStorage implements INotesStorage {
  private cachedState: NotesState | undefined

  constructor(private readonly state: vscode.Memento) {}

  getState(): NotesState {
    if (this.cachedState) {
      return this.cachedState
    }
    const stored = this.state.get<NotesState>(STORAGE_KEY)
    if (stored && stored.pages.length > 0) {
      this.cachedState = stored
      return stored
    }
    const page = createPage(WELCOME_CONTENT)
    const initial: NotesState = { pages: [page], activeId: page.id }
    this.setState(initial)
    return initial
  }

  updateContent(id: string, content: string): void {
    const state = this.getState()
    const page = state.pages.find(p => p.id === id)
    if (page) {
      page.content = content
      this.setState(state)
    }
  }

  newPage(): NotesState {
    const state = this.getState()
    const page = createPage()
    state.pages.push(page)
    state.activeId = page.id
    this.setState(state)
    return state
  }

  deletePage(id: string): NotesState {
    const state = this.getState()
    const idx = state.pages.findIndex(p => p.id === id)
    if (idx === -1) {
      return state
    }
    state.pages.splice(idx, 1)
    if (state.pages.length === 0) {
      const page = createPage()
      state.pages.push(page)
    }
    if (state.activeId === id) {
      state.activeId = state.pages[Math.min(idx, state.pages.length - 1)].id
    }
    this.setState(state)
    return state
  }

  switchPage(id: string): NotesState {
    const state = this.getState()
    if (state.pages.some(p => p.id === id)) {
      state.activeId = id
      this.setState(state)
    }
    return state
  }

  previousPage(): NotesState {
    const state = this.getState()
    const idx = state.pages.findIndex(p => p.id === state.activeId)
    if (idx > 0) {
      state.activeId = state.pages[idx - 1].id
      this.setState(state)
    }
    return state
  }

  nextPage(): NotesState {
    const state = this.getState()
    const idx = state.pages.findIndex(p => p.id === state.activeId)
    if (idx < state.pages.length - 1) {
      state.activeId = state.pages[idx + 1].id
      this.setState(state)
    }
    return state
  }

  private setState(state: NotesState): void {
    this.cachedState = state
    this.state.update(STORAGE_KEY, state).then(undefined, err => {
      console.error('[ScribeAside] Failed to persist state:', err)
    })
  }
}
