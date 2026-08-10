import * as vscode from 'vscode'
import type { INotesStorage } from './storageTypes'
import type { WebviewMessage } from './webview/types'

export const handleWebviewMessage = (
  message: WebviewMessage,
  storage: INotesStorage,
  sendInit: () => void,
  onFocusChange?: (focused: boolean) => void,
): void => {
  switch (message.type) {
    case 'ready':
      sendInit()
      break
    case 'updateContent': {
      const { activeId } = storage.getState()
      storage.updateContent(activeId, message.content)
      break
    }
    case 'focusChange':
      onFocusChange?.(message.focused)
      break
    case 'openLink': {
      const url = message.url
      if (/^https?:\/\//.test(url)) {
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
