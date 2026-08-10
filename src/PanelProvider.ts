import * as vscode from 'vscode'
import { getWebviewHtml } from './getWebviewHtml'
import { handleWebviewMessage } from './handleWebviewMessage'
import type { INotesStorage } from './storageTypes'
import type {
  ExtensionMessage,
  ScribeAsideCommand,
  ScribeAsideSettings,
  WebviewMessage,
} from './webview/types'

export class PanelProvider {
  private panel?: vscode.WebviewPanel

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getStorage: () => INotesStorage,
    private readonly onDidDispose: () => void,
    private readonly onFocusChange?: (focused: boolean) => void,
    private readonly onReady?: () => void,
    private readonly onExitReaderMode?: () => void,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal()
      return
    }

    this.panel = vscode.window.createWebviewPanel(
      'scribeaside.panel',
      'ScribeAside',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this.extensionUri],
        retainContextWhenHidden: true,
      },
    )

    this.panel.webview.html = getWebviewHtml(
      this.panel.webview,
      this.extensionUri,
    )

    const messageDisposable = this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        handleWebviewMessage(message, this.getStorage(), {
          sendInit: () => this.sendInit(),
          onReady: this.onReady,
          onExitReaderMode: this.onExitReaderMode,
        })
      },
    )

    const viewStateDisposable = this.panel.onDidChangeViewState(e => {
      vscode.commands.executeCommand(
        'setContext',
        'scribeaside.focused',
        e.webviewPanel.active,
      )
      this.onFocusChange?.(e.webviewPanel.active)
    })

    this.panel.onDidDispose(() => {
      messageDisposable.dispose()
      viewStateDisposable.dispose()
      this.panel = undefined
      vscode.commands.executeCommand('setContext', 'scribeaside.focused', false)
      vscode.commands.executeCommand(
        'setContext',
        'scribeaside.inEditor',
        false,
      )
      this.onFocusChange?.(false)
      this.onDidDispose()
    })

    vscode.commands.executeCommand('setContext', 'scribeaside.focused', true)
    vscode.commands.executeCommand('setContext', 'scribeaside.inEditor', true)
    this.onFocusChange?.(true)
  }

  sendInit(): void {
    if (this.panel) {
      const state = this.getStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      this.panel.webview.postMessage({
        type: 'init',
        content: page?.content ?? '',
      })
    }
  }

  setTitle(title: string): void {
    if (this.panel) {
      this.panel.title = title
    }
  }

  postCommand(command: ScribeAsideCommand): void {
    if (this.panel) {
      this.panel.webview.postMessage({ type: 'command', command })
    }
  }

  sendSettings(settings: ScribeAsideSettings): void {
    if (this.panel) {
      this.panel.webview.postMessage({ type: 'settings', ...settings })
    }
  }

  postMessage(message: ExtensionMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage(message)
    }
  }

  get isActive(): boolean {
    return this.panel !== undefined
  }
}
