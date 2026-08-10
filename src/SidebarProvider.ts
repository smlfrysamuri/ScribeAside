import * as vscode from 'vscode'
import { getWebviewHtml } from './getWebviewHtml'
import { handleWebviewMessage } from './handleWebviewMessage'
import type { INotesStorage } from './storageTypes'
import type {
  ExtensionMessage,
  MdpadCommand,
  MdpadSettings,
  WebviewMessage,
} from './webview/types'

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'mdpad.notesView'

  private view?: vscode.WebviewView
  private pendingTitle?: string

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getStorage: () => INotesStorage,
    private readonly onFocusChange?: (focused: boolean) => void,
    private readonly onReady?: () => void,
    private readonly onExitReaderMode?: () => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this.extensionUri,
    )

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      handleWebviewMessage(message, this.getStorage(), {
        sendInit: () => this.sendInit(),
        onFocusChange: focused => {
          vscode.commands.executeCommand('setContext', 'mdpad.focused', focused)
          this.onFocusChange?.(focused)
        },
        onReady: this.onReady,
        onExitReaderMode: this.onExitReaderMode,
      })
    })

    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        vscode.commands.executeCommand('setContext', 'mdpad.focused', false)
        this.onFocusChange?.(false)
      }
    })

    if (this.pendingTitle) {
      webviewView.title = this.pendingTitle
      this.pendingTitle = undefined
    }

    vscode.commands.executeCommand('setContext', 'mdpad.focused', true)
    this.onFocusChange?.(true)
  }

  sendInit(): void {
    if (this.view) {
      const state = this.getStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      this.view.webview.postMessage({
        type: 'init',
        content: page?.content ?? '',
      })
    }
  }

  setTitle(title: string): void {
    if (this.view) {
      this.view.title = title
    } else {
      this.pendingTitle = title
    }
  }

  postCommand(command: MdpadCommand): void {
    if (this.view) {
      this.view.webview.postMessage({ type: 'command', command })
    }
  }

  sendSettings(settings: MdpadSettings): void {
    if (this.view) {
      this.view.webview.postMessage({ type: 'settings', ...settings })
    }
  }

  postMessage(message: ExtensionMessage): void {
    if (this.view) {
      this.view.webview.postMessage(message)
    }
  }

  detach(): void {
    this.view = undefined
  }
}
