import * as vscode from 'vscode'
import type { INotesStorage } from './storageTypes'
import type { WebviewMessage } from './webview/types'

export interface WebviewMessageHandlers {
  sendInit: () => void
  onFocusChange?: (focused: boolean) => void
  // Fires before sendInit on every webview `ready`. Sidebar webviews are torn
  // down on collapse and rebuilt on expand, so anything the webview needs
  // beyond the note content — settings, reader state — must be re-sent here,
  // and it must land first: settings should be in place before content is
  // decorated, and a restored reader mode must hide the editor before `init`
  // would focus it.
  onReady?: () => void
  onExitReaderMode?: () => void
}

export const handleWebviewMessage = (
  message: WebviewMessage,
  storage: INotesStorage,
  handlers: WebviewMessageHandlers,
): void => {
  switch (message.type) {
    case 'ready':
      handlers.onReady?.()
      handlers.sendInit()
      break
    case 'updateContent': {
      const { activeId } = storage.getState()
      storage.updateContent(activeId, message.content)
      break
    }
    case 'focusChange':
      handlers.onFocusChange?.(message.focused)
      break
    case 'exitReaderMode':
      handlers.onExitReaderMode?.()
      break
    case 'openLink': {
      const url = message.url
      if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) {
        vscode.env.openExternal(vscode.Uri.parse(url))
      } else {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        if (!workspaceFolder) break
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, url)
        vscode.workspace.openTextDocument(fileUri).then(
          doc => vscode.window.showTextDocument(doc),
          err => {
            vscode.window.showErrorMessage(
              `mdpad: could not open ${url} — ${err instanceof Error ? err.message : String(err)}`,
            )
          },
        )
      }
      break
    }
  }
}
