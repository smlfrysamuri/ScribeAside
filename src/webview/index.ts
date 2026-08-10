import './styles.css'
import {
  createEditor,
  type EditorHandle,
  toggleHeading,
  wrapSelection,
} from './editor'
import { renderMarkdown } from './renderer'
import type { ExtensionMessage } from './types'

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
  readerEl.addEventListener('dblclick', event => {
    // Double-clicking a link means "open it", not "leave reader mode".
    if ((event.target as HTMLElement).closest('a')) return
    vscode.postMessage({ type: 'exitReaderMode' })
  })
  return readerEl
}

const renderReader = (): void => {
  if (!editor) return
  ensureReader().innerHTML = renderMarkdown(editor.view.state.doc.toString())
}

const setReaderMode = (enabled: boolean): void => {
  readerActive = enabled
  document.body.classList.toggle('mdpad-reader-active', enabled)
  if (enabled) {
    renderReader()
  } else {
    // The editor sat under display:none; CodeMirror must re-measure before
    // pixel-based cursor navigation is trustworthy again.
    editor?.view.requestMeasure()
    editor?.view.focus()
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
  ;(window as unknown as { __mdpadView?: unknown }).__mdpadView = editor.view

  window.addEventListener(
    'message',
    (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data
      switch (message.type) {
        case 'init': {
          syncedContent = message.content
          editor?.setContent(message.content)
          if (readerActive) {
            renderReader()
          } else {
            editor?.view.focus()
          }
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
    vscode.postMessage({ type: 'focusChange', focused: false })
  })

  vscode.postMessage({ type: 'ready' })
}

init()
