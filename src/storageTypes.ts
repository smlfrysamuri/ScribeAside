import type { NotesState } from './webview/types'

// The surface both NotesStorage (memento-backed) and FileNotesStorage
// (folder-backed) present to the providers and to handleWebviewMessage.
export interface INotesStorage {
  getState(): NotesState
  updateContent(id: string, content: string): void
  newPage(): NotesState
  deletePage(id: string): NotesState
  switchPage(id: string): NotesState
  previousPage(): NotesState
  nextPage(): NotesState
}
