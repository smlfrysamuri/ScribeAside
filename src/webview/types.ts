export interface Page {
  id: string
  content: string
}

export interface NotesState {
  pages: Page[]
  activeId: string
}

// Webview -> Extension messages
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'updateContent'; content: string }
  | { type: 'openLink'; url: string }
  | { type: 'focusChange'; focused: boolean }
  | { type: 'exitReaderMode' }

export type MdpadCommand =
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleStrikethrough'
  | 'toggleCode'
  | 'toggleHighlight'
  | 'toggleHeading'

export type SyntaxMode = 'muted' | 'hidden'

export interface MdpadSettings {
  fontFamily: string
  lineHeight: number
  listIndentSize: number
  lineNumbers: boolean
  lineWrapping: boolean
  folding: boolean
  syntaxMode: SyntaxMode
}

// Extension -> Webview messages
export type ExtensionMessage =
  | { type: 'init'; content: string }
  | { type: 'replaceContent'; content: string }
  | { type: 'command'; command: MdpadCommand }
  | ({ type: 'settings' } & MdpadSettings)
  | { type: 'setCursor'; pos: number }
  | { type: 'setReaderMode'; enabled: boolean }
