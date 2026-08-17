import './styles.css'
import {
  createEditor,
  type EditorHandle,
  toggleHeading,
  wrapSelection,
} from './editor'
import { renderMarkdown } from './renderer'
import {
  readEntries,
  recallScroll,
  rememberScroll,
  type ScrollEntry,
} from './scrollMemory'
import type { ExtensionMessage } from './types'
import { applyTypography } from './typography'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

const SAVE_DEBOUNCE_MS = 500
// Continuous typing restarts the trailing debounce on every keystroke, so
// without a ceiling a fast typist can hold a whole paragraph in the webview
// and never hand it to the extension host.
const SAVE_MAX_WAIT_MS = 2000

let editor: EditorHandle | undefined
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let firstUnsentChangeAt: number | undefined

// The last content the host and the webview agreed on: set when the host sends
// content, and again when a local edit is posted back.
let syncedContent = ''

// Which note is on screen, and where the user had scrolled to in the notes
// they have visited. `getState()` is read once here because it is the only
// thing that survives the view being collapsed and rebuilt.
let currentPageId = ''
let scrollEntries: ScrollEntry[] = readEntries(
  (vscode.getState() as { scroll?: unknown } | undefined)?.scroll,
)

const postContent = (content: string): void => {
  syncedContent = content
  firstUnsentChangeAt = undefined
  vscode.postMessage({ type: 'updateContent', content })
}

const handleContentChange = (content: string): void => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const now = Date.now()
  if (firstUnsentChangeAt === undefined) firstUnsentChangeAt = now
  const remaining = Math.max(
    0,
    Math.min(SAVE_DEBOUNCE_MS, firstUnsentChangeAt + SAVE_MAX_WAIT_MS - now),
  )
  debounceTimer = setTimeout(() => postContent(content), remaining)
}

const handleOpenLink = (url: string): void => {
  vscode.postMessage({ type: 'openLink', url })
}

let readerActive = false
let readerEl: HTMLElement | undefined

const ensureReader = (): HTMLElement => {
  if (readerEl) return readerEl
  readerEl = document.createElement('div')
  readerEl.id = 'reader'
  document.body.appendChild(readerEl)
  readerEl.addEventListener('click', event => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    event.preventDefault()
    // The second click of a double-click fires this handler again; opening
    // the link twice is never what the user meant.
    if (event.detail > 1) return
    const href = anchor.getAttribute('href')
    if (href) handleOpenLink(href)
  })
  readerEl.addEventListener('scroll', scheduleScrollSave, { passive: true })
  readerEl.addEventListener('dblclick', event => {
    // Double-clicking a link means "open it", not "leave reader mode".
    if ((event.target as HTMLElement).closest('a')) return
    vscode.postMessage({ type: 'exitReaderMode' })
  })
  return readerEl
}

const SCROLL_SAVE_DEBOUNCE_MS = 200

let scrollTimer: ReturnType<typeof setTimeout> | undefined

// Only the surface the user can actually see reports a position. The hidden
// one measures as a zero-height box, and letting it answer would overwrite a
// good position with the top of the note.
const persistScroll = (): void => {
  if (!currentPageId || !editor) return
  scrollEntries = rememberScroll(
    scrollEntries,
    currentPageId,
    readerActive
      ? { readerTop: readerEl?.scrollTop ?? 0 }
      : { pos: editor.getScrollAnchor() },
  )
  vscode.setState({ scroll: scrollEntries })
}

const scheduleScrollSave = (): void => {
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(persistScroll, SCROLL_SAVE_DEBOUNCE_MS)
}

// The debounce is a throttle on a stream of scroll events, not a grace period
// we can afford to lose: a collapsing sidebar takes the whole document with it.
// Every event that means "this webview is about to stop being looked at" ends
// with the pending save already written.
const flushScrollSave = (): void => {
  if (scrollTimer) {
    clearTimeout(scrollTimer)
    scrollTimer = undefined
  }
  persistScroll()
}

const restoreScroll = (): void => {
  const place = recallScroll(scrollEntries, currentPageId)
  if (readerActive) {
    ensureReader().scrollTop = place?.readerTop ?? 0
  } else {
    editor?.scrollToAnchor(place?.pos ?? 0)
  }
}

// `scrollTop` undefined means "stay where you are": innerHTML wipes the offset,
// and a re-render caused by someone else editing the file must not yank the
// reader back to the top of a note the user is halfway down.
const renderReader = (scrollTop?: number): void => {
  if (!editor) return
  const el = ensureReader()
  const top = scrollTop ?? el.scrollTop
  el.innerHTML = renderMarkdown(editor.view.state.doc.toString())
  el.scrollTop = top
}

const setReaderMode = (enabled: boolean): void => {
  // Bank the surface being left before the other one takes over — its pending
  // save is measured against a box that is about to be display:none.
  flushScrollSave()
  readerActive = enabled
  document.body.classList.toggle('scribeaside-reader-active', enabled)
  if (enabled) {
    renderReader(recallScroll(scrollEntries, currentPageId)?.readerTop ?? 0)
  } else {
    // The editor sat under display:none; CodeMirror must re-measure before
    // pixel-based cursor navigation is trustworthy again.
    editor?.view.requestMeasure()
    editor?.view.focus()
    restoreScroll()
  }
}

const init = (): void => {
  const editorContainer = document.getElementById('editor')
  if (!editorContainer) return

  editor = createEditor(
    editorContainer,
    '',
    handleContentChange,
    handleOpenLink,
  )

  // Expose editor view for e2e tests
  ;(window as unknown as { __scribeasideView?: unknown }).__scribeasideView =
    editor.view

  window.addEventListener(
    'message',
    (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data
      switch (message.type) {
        case 'init': {
          // Same message for "the view came back" and "we moved to another
          // note", so the outgoing note's place is banked before the id
          // changes; on a rebuilt webview there is no outgoing note and this
          // does nothing.
          flushScrollSave()
          currentPageId = message.pageId
          syncedContent = message.content
          editor?.setContent(message.content)
          if (readerActive) {
            renderReader()
          } else {
            editor?.view.focus()
          }
          // After focus(), which scrolls the caret into view on its own, and
          // after the re-render, which resets the reader to the top.
          restoreScroll()
          break
        }
        // Deliberately no focus(): this arrives when someone else edited the
        // file, which must not pull the caret out of whatever the user is
        // typing in. setContent's whole-document dispatch clamps the cursor.
        case 'replaceContent': {
          if (!editor) break
          // Local edits the host has not seen yet outrank a remote update.
          // Applying it here would destroy unsaved keystrokes, which nothing
          // can recover; skipping it loses a remote change that is still in
          // the file and in git, and the local edit wins by the documented
          // last-writer-wins rule a moment later.
          if (editor.view.state.doc.toString() !== syncedContent) break
          syncedContent = message.content
          editor.setContent(message.content)
          if (readerActive) renderReader()
          break
        }
        case 'command': {
          // Formatting keybindings still fire while the editor is hidden
          // behind the reader; applying them would silently edit the note.
          if (!editor || readerActive) break
          switch (message.command) {
            case 'toggleBold':
              wrapSelection(editor.view, '**')
              break
            case 'toggleItalic':
              wrapSelection(editor.view, '*')
              break
            case 'toggleStrikethrough':
              wrapSelection(editor.view, '~~')
              break
            case 'toggleCode':
              wrapSelection(editor.view, '`')
              break
            case 'toggleHighlight':
              wrapSelection(editor.view, '==')
              break
            case 'toggleHeading':
              toggleHeading(editor.view)
              break
          }
          break
        }
        case 'settings': {
          // Custom properties first: the reader reads them straight from CSS,
          // and the editor's dispatch below is what schedules CodeMirror's
          // re-measure for the new metrics.
          applyTypography(document.documentElement, message)
          editor?.applySettings(message)
          break
        }
        case 'setCursor': {
          if (!editor || readerActive) break
          const pos = Math.min(message.pos, editor.view.state.doc.length)
          editor.view.dispatch({
            selection: { anchor: pos },
            scrollIntoView: true,
          })
          editor.view.focus()
          break
        }
        case 'setReaderMode': {
          setReaderMode(message.enabled)
          break
        }
      }
    },
  )

  window.addEventListener('focus', () => {
    if (!readerActive) editor?.view.focus()
    vscode.postMessage({ type: 'focusChange', focused: true })
  })

  window.addEventListener('blur', () => {
    flushScrollSave()
    vscode.postMessage({ type: 'focusChange', focused: false })
  })

  editor.view.scrollDOM.addEventListener('scroll', scheduleScrollSave, {
    passive: true,
  })

  // Collapsing the sidebar destroys this document. Which of these fires (and
  // whether any does) is not guaranteed, so all three are wired: the cost of a
  // redundant save is one no-op write.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushScrollSave()
  })
  window.addEventListener('pagehide', flushScrollSave)

  vscode.postMessage({ type: 'ready' })
}

init()
