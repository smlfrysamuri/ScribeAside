import * as vscode from 'vscode'
import { timestampFileName, uniqueFileName } from './slug'
import type { INotesStorage } from './storageTypes'
import type { NotesState, Page } from './webview/types'

const MARKDOWN_FILE = /\.md$/i
const DEFAULT_DEBOUNCE_MS = 300
const FLUSH_ROUNDS = 5

export interface ExternalChange {
  activeContentChanged: boolean
}

export interface FileNotesStorageOptions {
  folderUri: vscode.Uri
  getActiveId: () => string | undefined
  setActiveId: (id: string) => void
  onExternalChange: (change: ExternalChange) => void
  onUnavailable: () => void
  debounceMs?: number
  now?: () => Date
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

const fileNameOf = (uri: vscode.Uri): string =>
  uri.path.slice(uri.path.lastIndexOf('/') + 1)

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

export class FileNotesStorage implements INotesStorage {
  private cache: NotesState = { pages: [], activeId: '' }
  private available = false
  private readonly onDisk = new Set<string>()
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly writing = new Map<string, Promise<void>>()
  private readonly deleting = new Map<string, Promise<void>>()
  private readonly lastWritten = new Map<string, string>()
  private readonly disposables: vscode.Disposable[] = []
  private readonly debounceMs: number
  private readonly now: () => Date

  constructor(private readonly options: FileNotesStorageOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.now = options.now ?? (() => new Date())
    this.seedDraft()
  }

  get isAvailable(): boolean {
    return this.available
  }

  get folderUri(): vscode.Uri {
    return this.options.folderUri
  }

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  // Never rejects. activate() awaits this before registering the sidebar
  // provider and every command, so a rejection here would take the whole
  // extension down over a missing notes folder.
  async initialize(): Promise<void> {
    try {
      await this.load()
    } catch (err) {
      this.available = false
      console.error('[mdpad] team notes failed to load:', errorText(err))
    }
  }

  private async load(): Promise<void> {
    let isDirectory = false
    try {
      const stat = await vscode.workspace.fs.stat(this.options.folderUri)
      isDirectory = (stat.type & vscode.FileType.Directory) !== 0
    } catch {
      isDirectory = false
    }
    if (!isDirectory) {
      this.available = false
      return
    }

    let names: string[] = []
    try {
      const entries = await vscode.workspace.fs.readDirectory(
        this.options.folderUri,
      )
      names = entries
        .filter(
          ([name, type]) =>
            (type & vscode.FileType.File) !== 0 && MARKDOWN_FILE.test(name),
        )
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b))
    } catch (err) {
      this.available = false
      vscode.window.showErrorMessage(
        `mdpad: could not read team notes folder — ${errorText(err)}`,
      )
      return
    }

    const pages: Page[] = []
    this.onDisk.clear()
    this.lastWritten.clear()
    for (const name of names) {
      try {
        const bytes = await vscode.workspace.fs.readFile(this.uriFor(name))
        pages.push({ id: name, content: decoder.decode(bytes) })
        this.onDisk.add(name)
      } catch {
        // One unreadable note must not take the whole scope offline.
      }
    }

    this.cache = { pages, activeId: '' }
    if (pages.length === 0) this.seedDraft()

    const saved = this.options.getActiveId()
    this.cache.activeId =
      saved && this.cache.pages.some(page => page.id === saved)
        ? saved
        : this.cache.pages[0].id

    this.available = true
    this.startWatching()
  }

  private startWatching(): void {
    // initialize() runs a second time after switchToTeam creates the folder.
    if (this.disposables.length > 0) return
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.options.folderUri, '*.md'),
    )
    this.disposables.push(
      watcher,
      watcher.onDidCreate(uri => {
        void this.handleExternalWrite(uri).catch(() => {})
      }),
      watcher.onDidChange(uri => {
        void this.handleExternalWrite(uri).catch(() => {})
      }),
      watcher.onDidDelete(uri => {
        this.handleExternalDelete(uri)
      }),
    )
  }

  // Drops pending edits rather than writing them. Callers that care about
  // durability must await flush() first — reloadTeamStorage and deactivate
  // both do.
  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  // -------------------------------------------------------------------------
  // INotesStorage
  // -------------------------------------------------------------------------

  getState(): NotesState {
    return this.cache
  }

  updateContent(id: string, content: string): void {
    if (!this.available) return
    const page = this.cache.pages.find(p => p.id === id)
    if (!page || page.content === content) return
    page.content = content
    this.scheduleWrite(id)
  }

  newPage(): NotesState {
    if (!this.available) return this.cache
    const id = uniqueFileName(
      timestampFileName(this.now()),
      new Set(this.cache.pages.map(page => page.id)),
    )
    this.insertPage({ id, content: '' })
    this.setActive(id)
    return this.cache
  }

  deletePage(id: string): NotesState {
    if (!this.available) return this.cache
    const idx = this.cache.pages.findIndex(page => page.id === id)
    if (idx === -1) return this.cache

    // Captured before the splice: seedDraft() below reassigns activeId when
    // the list empties, which would make a later comparison read false.
    const wasActive = this.cache.activeId === id
    this.cache.pages.splice(idx, 1)

    const timer = this.pending.get(id)
    if (timer) {
      clearTimeout(timer)
      this.pending.delete(id)
    }
    this.lastWritten.delete(id)
    // `writing` matters as much as `onDisk` here: a page created and typed
    // into, then deleted while its very first write is still in flight, is
    // not on disk *yet* but will be a moment later.
    if (this.onDisk.has(id) || this.writing.has(id)) this.scheduleDelete(id)

    if (this.cache.pages.length === 0) this.seedDraft()
    if (wasActive) {
      this.setActive(
        this.cache.pages[Math.min(idx, this.cache.pages.length - 1)].id,
      )
    }
    return this.cache
  }

  switchPage(id: string): NotesState {
    if (!this.available) return this.cache
    if (this.cache.pages.some(page => page.id === id)) this.setActive(id)
    return this.cache
  }

  previousPage(): NotesState {
    if (!this.available) return this.cache
    const idx = this.activeIndex()
    if (idx > 0) this.setActive(this.cache.pages[idx - 1].id)
    return this.cache
  }

  nextPage(): NotesState {
    if (!this.available) return this.cache
    const idx = this.activeIndex()
    if (idx !== -1 && idx < this.cache.pages.length - 1) {
      this.setActive(this.cache.pages[idx + 1].id)
    }
    return this.cache
  }

  // -------------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------------

  private activeIndex(): number {
    return this.cache.pages.findIndex(page => page.id === this.cache.activeId)
  }

  private seedDraft(): void {
    const id = uniqueFileName(
      timestampFileName(this.now()),
      new Set(this.cache.pages.map(page => page.id)),
    )
    this.cache.pages.push({ id, content: '' })
    this.cache.activeId = id
  }

  private setActive(id: string): void {
    this.cache.activeId = id
    this.options.setActiveId(id)
  }

  // Sorted insert keeps the in-memory order equal to what a fresh load()
  // would produce, so the list cannot disagree with itself after a reload.
  private insertPage(page: Page): void {
    let idx = this.cache.pages.length
    for (let i = 0; i < this.cache.pages.length; i++) {
      if (this.cache.pages[i].id.localeCompare(page.id) > 0) {
        idx = i
        break
      }
    }
    this.cache.pages.splice(idx, 0, page)
  }

  private uriFor(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this.options.folderUri, id)
  }

  private markUnavailable(): void {
    if (!this.available) return
    this.available = false
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
    vscode.window.showWarningMessage(
      'mdpad: the team notes folder is gone — switching away from team notes.',
    )
    this.options.onUnavailable()
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  private scheduleWrite(id: string): void {
    const existing = this.pending.get(id)
    if (existing) clearTimeout(existing)
    this.pending.set(
      id,
      setTimeout(() => {
        this.pending.delete(id)
        this.writeNow(id)
      }, this.debounceMs),
    )
  }

  // Writes for one page are chained, never concurrent. Two overlapping writes
  // can land out of order, leaving stale text on disk while the cache holds
  // the new text — and the watcher then suppresses its own echo, so nothing
  // reports the divergence. Chaining also means awaiting the tracked promise
  // awaits every write queued before it, which is what makes flush() honest.
  private writeNow(id: string): void {
    const chain = (this.writing.get(id) ?? Promise.resolve()).then(() =>
      this.doWrite(id),
    )
    const tracked: Promise<void> = chain.then(() => {
      if (this.writing.get(id) === tracked) this.writing.delete(id)
    })
    this.writing.set(id, tracked)
  }

  private async doWrite(id: string): Promise<void> {
    // Re-read the page when the write actually runs: a chained write must
    // persist the latest content, not whatever was current when it queued.
    const page = this.cache.pages.find(p => p.id === id)
    if (!page) return
    // Lazy first write: an empty page that has never existed on disk stays off
    // it, so activation and stray new pages never create files.
    if (!this.onDisk.has(id) && page.content.length === 0) return

    const content = page.content
    if (this.onDisk.has(id) && this.lastWritten.get(id) === content) return
    if (!(await this.folderStillExists())) return

    try {
      await vscode.workspace.fs.writeFile(
        this.uriFor(id),
        encoder.encode(content),
      )
      this.onDisk.add(id)
      this.lastWritten.set(id, content)
    } catch (err) {
      vscode.window.showErrorMessage(
        `mdpad: could not save ${id} — ${errorText(err)}`,
      )
    }
  }

  // workspace.fs.writeFile creates missing parent directories, so without this
  // check deleting the folder in the Explorer would silently bring it back on
  // the next keystroke — the opposite of the opt-in the folder represents.
  private async folderStillExists(): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(this.options.folderUri)
      if ((stat.type & vscode.FileType.Directory) !== 0) return true
    } catch {
      // fall through
    }
    this.markUnavailable()
    return false
  }

  private scheduleDelete(id: string): void {
    const chain = (this.deleting.get(id) ?? Promise.resolve()).then(() =>
      this.deleteFile(id),
    )
    const tracked: Promise<void> = chain.then(() => {
      if (this.deleting.get(id) === tracked) this.deleting.delete(id)
    })
    this.deleting.set(id, tracked)
  }

  private async deleteFile(id: string): Promise<void> {
    // Let any in-flight write land first; a write that completes after the
    // delete recreates the file and the page returns on the next reload.
    await this.writing.get(id)
    if (!this.onDisk.has(id)) return
    this.onDisk.delete(id)
    try {
      await vscode.workspace.fs.delete(this.uriFor(id))
    } catch (err) {
      vscode.window.showErrorMessage(
        `mdpad: could not delete ${id} — ${errorText(err)}`,
      )
    }
  }

  async flush(): Promise<void> {
    for (let round = 0; round < FLUSH_ROUNDS; round++) {
      for (const [id, timer] of [...this.pending]) {
        clearTimeout(timer)
        this.pending.delete(id)
        this.writeNow(id)
      }
      if (this.writing.size === 0 && this.deleting.size === 0) return
      await Promise.all([...this.writing.values(), ...this.deleting.values()])
      if (
        this.pending.size === 0 &&
        this.writing.size === 0 &&
        this.deleting.size === 0
      ) {
        return
      }
    }
  }

  // -------------------------------------------------------------------------
  // Watcher
  // -------------------------------------------------------------------------

  private async handleExternalWrite(uri: vscode.Uri): Promise<void> {
    const id = fileNameOf(uri)
    if (!MARKDOWN_FILE.test(id)) return
    // We are mid-edit on this page; last writer wins and that is us.
    if (this.pending.has(id) || this.writing.has(id)) return

    let content: string
    try {
      content = decoder.decode(await vscode.workspace.fs.readFile(uri))
    } catch {
      return
    }
    // Re-checked after the read: the user can start typing inside the read's
    // latency, and applying the file's text now would discard what they just
    // wrote and then write the discarded-over version back.
    if (this.pending.has(id) || this.writing.has(id)) return
    if (this.lastWritten.get(id) === content) return

    const page = this.cache.pages.find(p => p.id === id)
    if (page) {
      if (page.content === content) return
      page.content = content
      this.onDisk.add(id)
      this.options.onExternalChange({
        activeContentChanged: id === this.cache.activeId,
      })
      return
    }

    this.insertPage({ id, content })
    this.onDisk.add(id)
    this.options.onExternalChange({ activeContentChanged: false })
  }

  private handleExternalDelete(uri: vscode.Uri): void {
    const id = fileNameOf(uri)
    const idx = this.cache.pages.findIndex(page => page.id === id)
    // Already gone from the cache means we deleted it ourselves.
    if (idx === -1) return

    // Captured before the splice, for the same reason as in deletePage: when
    // the last page goes, seedDraft() reassigns activeId, and reading it
    // afterwards would report "the active page did not change" while the
    // webview is still showing a note that no longer exists.
    const wasActive = this.cache.activeId === id
    this.cache.pages.splice(idx, 1)
    this.onDisk.delete(id)
    this.lastWritten.delete(id)
    const timer = this.pending.get(id)
    if (timer) {
      clearTimeout(timer)
      this.pending.delete(id)
    }

    if (this.cache.pages.length === 0) this.seedDraft()

    if (wasActive) {
      this.setActive(
        this.cache.pages[Math.min(idx, this.cache.pages.length - 1)].id,
      )
    }
    this.options.onExternalChange({ activeContentChanged: wasActive })
  }
}
