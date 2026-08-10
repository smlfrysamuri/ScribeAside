import * as vscode from 'vscode'
import { deriveTitle } from './deriveTitle'
import { type ExternalChange, FileNotesStorage } from './FileNotesStorage'
import { NotesStorage } from './NotesStorage'
import { PanelProvider } from './PanelProvider'
import { SidebarProvider } from './SidebarProvider'
import { searchLines } from './searchLines'
import { slugify } from './slug'
import type { INotesStorage } from './storageTypes'
import type {
  ExtensionMessage,
  MdpadCommand,
  MdpadSettings,
  SyntaxMode,
} from './webview/types'

type Scope = 'workspace' | 'global' | 'team'

interface ScopeEntry {
  label: string
  icon: string
  // Getters, not values: the team entry's storage object is replaced whenever
  // mdpad.teamNotesFolder changes, and a captured reference would keep writing
  // to the old folder.
  storage: () => INotesStorage
  available: () => boolean
}

// Cycle order for the title-bar scope button.
const SCOPE_ORDER: Scope[] = ['workspace', 'global', 'team']

const SCOPE_KEY = 'mdpad.scope'
const TEAM_ACTIVE_KEY = 'mdpad.teamActiveId'
const READER_KEY = 'mdpad.readerMode'
const DEFAULT_TEAM_FOLDER = '.mdpad'

// Module scope so deactivate() can flush pending writes at shutdown.
let teamStorage: FileNotesStorage | undefined

const configuredTeamFolder = (): string =>
  vscode.workspace
    .getConfiguration('mdpad')
    .get<string>('teamNotesFolder', DEFAULT_TEAM_FOLDER) || DEFAULT_TEAM_FOLDER

const teamFolderUri = (): vscode.Uri | undefined => {
  const root = vscode.workspace.workspaceFolders?.[0]
  if (!root) return undefined
  // `.` and `..` are dropped rather than resolved: the setting names a folder
  // inside the workspace, and a stray `../` in someone's settings.json should
  // not put note files outside the repo they are meant to be committed to.
  const segments = configuredTeamFolder()
    .split(/[/\\]/)
    .filter(segment => segment && segment !== '.' && segment !== '..')
  if (segments.length === 0) return undefined
  return vscode.Uri.joinPath(root.uri, ...segments)
}

export const activate = async (
  context: vscode.ExtensionContext,
): Promise<void> => {
  const workspaceStorage = new NotesStorage(context.workspaceState)
  const globalStorage = new NotesStorage(context.globalState)

  let currentScope: Scope = 'workspace'

  const SCOPES: Record<Scope, ScopeEntry> = {
    workspace: {
      label: 'Workspace',
      icon: '$(root-folder)',
      storage: () => workspaceStorage,
      available: () => true,
    },
    global: {
      label: 'Global',
      icon: '$(globe)',
      storage: () => globalStorage,
      available: () => true,
    },
    team: {
      label: 'Team',
      icon: '$(organization)',
      storage: () => teamStorage ?? workspaceStorage,
      available: () => teamStorage?.isAvailable ?? false,
    },
  }

  const getActiveStorage = (): INotesStorage => SCOPES[currentScope].storage()

  let mdpadFocused = false

  const handleFocusChange = (focused: boolean) => {
    mdpadFocused = focused
  }

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    getActiveStorage,
    handleFocusChange,
    () => onWebviewReady(sidebarProvider),
    () => applyReaderMode(false),
  )

  const panelProvider = new PanelProvider(
    context.extensionUri,
    getActiveStorage,
    () => {},
    handleFocusChange,
    () => onWebviewReady(panelProvider),
    () => applyReaderMode(false),
  )

  const syncEnabled = vscode.workspace
    .getConfiguration('mdpad')
    .get<boolean>('syncGlobalNotes', false)
  context.globalState.setKeysForSync(syncEnabled ? ['mdpad.notes'] : [])

  const statusBar = vscode.window.createStatusBarItem(
    'mdpad-status',
    vscode.StatusBarAlignment.Right,
    100,
  )
  context.subscriptions.push(statusBar)

  const scopeLabel = (): string => SCOPES[currentScope].label

  const getSettings = (): MdpadSettings => {
    const config = vscode.workspace.getConfiguration('mdpad')
    return {
      fontFamily: config.get<string>('fontFamily', 'inherit'),
      lineHeight: config.get<number>('lineHeight', 1.6),
      listIndentSize: config.get<number>('listIndentSize', 2),
      lineNumbers: config.get<boolean>('lineNumbers', false),
      lineWrapping: config.get<boolean>('lineWrapping', true),
      folding: config.get<boolean>('folding', false),
      syntaxMode: config.get<SyntaxMode>('syntaxMode', 'muted'),
    }
  }

  const sendSettingsToActive = () => {
    const settings = getSettings()
    if (panelProvider.isActive) {
      panelProvider.sendSettings(settings)
    } else {
      sidebarProvider.sendSettings(settings)
    }
  }

  const sendInitToActive = () => {
    const settings = getSettings()
    if (panelProvider.isActive) {
      panelProvider.sendInit()
      panelProvider.sendSettings(settings)
    } else {
      sidebarProvider.sendInit()
      sidebarProvider.sendSettings(settings)
    }
  }

  const updateStatusBar = () => {
    const state = getActiveStorage().getState()
    const idx = state.pages.findIndex(p => p.id === state.activeId)
    const page = state.pages[idx]
    const title = page ? deriveTitle(page.content) : 'Empty note'
    const scopeIcon = SCOPES[currentScope].icon
    statusBar.text = `$(notebook) ${title} (${idx + 1}/${state.pages.length}) · ${scopeIcon}`
    statusBar.tooltip = `mdpad — ${scopeLabel()}`
    statusBar.show()
  }

  const switchAndUpdate = () => {
    sidebarProvider.setTitle(scopeLabel())
    panelProvider.setTitle(`mdpad (${scopeLabel()})`)
    sendInitToActive()
    updateStatusBar()
  }

  // The team flush lives here rather than in setScope because selectPage and
  // searchPages switch scope through applyScope directly.
  const applyScope = (scope: Scope): void => {
    if (currentScope === 'team' && scope !== 'team') {
      void teamStorage?.flush()
    }
    currentScope = scope
    context.workspaceState.update(SCOPE_KEY, scope)
    vscode.commands.executeCommand('setContext', SCOPE_KEY, scope)
  }

  const setScope = (scope: Scope): void => {
    applyScope(SCOPES[scope].available() ? scope : 'workspace')
    switchAndUpdate()
  }

  const publishTeamAvailability = (): void => {
    vscode.commands.executeCommand(
      'setContext',
      'mdpad.teamAvailable',
      teamStorage?.isAvailable ?? false,
    )
  }

  const postToActive = (message: ExtensionMessage): void => {
    if (panelProvider.isActive) {
      panelProvider.postMessage(message)
    } else {
      sidebarProvider.postMessage(message)
    }
  }

  let readerMode = context.globalState.get<boolean>(READER_KEY, false)

  const applyReaderMode = (enabled: boolean): void => {
    readerMode = enabled
    context.globalState.update(READER_KEY, enabled)
    vscode.commands.executeCommand('setContext', READER_KEY, enabled)
    postToActive({ type: 'setReaderMode', enabled })
  }

  // The webview is rebuilt from scratch every time a collapsed sidebar is
  // expanded, so settings and reader state must ride along on every `ready`,
  // not just on scope switches and configuration changes. Sent to the surface
  // that fired `ready`, not the "active" one: a sidebar can re-resolve while
  // a background panel still exists, and routing by activity would hand the
  // fresh sidebar's settings to the panel.
  const onWebviewReady = (target: SidebarProvider | PanelProvider): void => {
    target.sendSettings(getSettings())
    target.postMessage({ type: 'setReaderMode', enabled: readerMode })
  }

  vscode.commands.executeCommand('setContext', READER_KEY, readerMode)

  // Declared before buildTeamStorage so the closure handed to the storage is
  // never constructed against an uninitialised binding.
  const handleTeamExternalChange = (change: ExternalChange): void => {
    if (currentScope !== 'team') return
    if (change.activeContentChanged) {
      const state = teamStorage?.getState()
      const page = state?.pages.find(p => p.id === state.activeId)
      postToActive({ type: 'replaceContent', content: page?.content ?? '' })
    }
    updateStatusBar()
  }

  const buildTeamStorage = (): FileNotesStorage | undefined => {
    const folderUri = teamFolderUri()
    if (!folderUri) return undefined
    return new FileNotesStorage({
      folderUri,
      getActiveId: () => context.workspaceState.get<string>(TEAM_ACTIVE_KEY),
      setActiveId: id => {
        context.workspaceState.update(TEAM_ACTIVE_KEY, id)
      },
      onExternalChange: handleTeamExternalChange,
      onUnavailable: () => {
        publishTeamAvailability()
        if (currentScope === 'team') setScope('workspace')
      },
    })
  }

  const reloadTeamStorage = async (): Promise<void> => {
    if (teamStorage) {
      await teamStorage.flush()
      teamStorage.dispose()
    }
    teamStorage = buildTeamStorage()
    await teamStorage?.initialize()
    publishTeamAvailability()
    if (currentScope !== 'team') return
    if (teamStorage?.isAvailable) {
      switchAndUpdate()
    } else {
      setScope('workspace')
    }
  }

  teamStorage = buildTeamStorage()
  await teamStorage?.initialize()
  publishTeamAvailability()
  context.subscriptions.push({
    dispose: () => {
      teamStorage?.dispose()
    },
  })

  const savedScope = context.workspaceState.get<string>(SCOPE_KEY)
  const restored = SCOPE_ORDER.find(scope => scope === savedScope)
  applyScope(restored && SCOPES[restored].available() ? restored : 'workspace')

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider,
    ),
  )

  sidebarProvider.setTitle(scopeLabel())

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.openInEditor', () => {
      sidebarProvider.detach()
      panelProvider.open()
      panelProvider.setTitle(`mdpad (${scopeLabel()})`)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.focusNotes', async () => {
      if (mdpadFocused) {
        await vscode.commands.executeCommand(
          'workbench.action.focusActiveEditorGroup',
        )
      } else if (panelProvider.isActive) {
        panelProvider.open()
      } else {
        await vscode.commands.executeCommand('mdpad.notesView.focus')
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.newPage', () => {
      getActiveStorage().newPage()
      switchAndUpdate()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.deletePage', async () => {
      const state = getActiveStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      const title = page ? deriveTitle(page.content) : 'Empty note'
      const confirmed = await vscode.window.showWarningMessage(
        `Delete "${title}"?`,
        {
          modal: true,
          detail:
            'This page and its contents will be permanently removed. This action cannot be undone.',
        },
        'Delete',
      )
      if (confirmed !== 'Delete') return
      getActiveStorage().deletePage(state.activeId)
      switchAndUpdate()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.previousPage', () => {
      getActiveStorage().previousPage()
      switchAndUpdate()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.nextPage', () => {
      getActiveStorage().nextPage()
      switchAndUpdate()
    }),
  )

  const pageItems = (scope: Scope, isActiveScope: boolean) => {
    const entry = SCOPES[scope]
    const state = entry.storage().getState()
    return state.pages.map((page, i) => ({
      label: `${isActiveScope && page.id === state.activeId ? '$(check) ' : ''}${entry.icon} ${deriveTitle(page.content)}`,
      description: `Page ${i + 1} · ${entry.label}`,
      pageId: page.id,
      scope,
    }))
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.selectPage', async () => {
      const separator = {
        label: '',
        kind: vscode.QuickPickItemKind.Separator,
      }

      const allItems: (
        | ReturnType<typeof pageItems>[number]
        | typeof separator
      )[] = [...pageItems(currentScope, true)]

      for (const scope of SCOPE_ORDER) {
        if (scope === currentScope || !SCOPES[scope].available()) continue
        const items = pageItems(scope, false)
        if (items.length === 0) continue
        allItems.push(separator, ...items)
      }

      const picked = await vscode.window.showQuickPick(allItems, {
        placeHolder: `Select a page (${scopeLabel()})`,
      })

      if (picked && 'pageId' in picked) {
        if (picked.scope !== currentScope) applyScope(picked.scope)
        getActiveStorage().switchPage(picked.pageId)
        switchAndUpdate()
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.switchToGlobal', () => {
      setScope('global')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.switchToWorkspace', () => {
      setScope('workspace')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.switchToTeam', async () => {
      if (!vscode.workspace.workspaceFolders?.[0]) {
        vscode.window.showErrorMessage(
          'mdpad: team notes need an open workspace folder.',
        )
        return
      }

      if (!teamStorage) {
        teamStorage = buildTeamStorage()
        // Probe before prompting, or the modal offers to create a folder that
        // is already sitting there.
        await teamStorage?.initialize()
        publishTeamAvailability()
      }
      if (!teamStorage) {
        vscode.window.showErrorMessage(
          `mdpad: "${configuredTeamFolder()}" is not a usable team notes folder name — set mdpad.teamNotesFolder to a folder inside the workspace.`,
        )
        return
      }

      if (!teamStorage.isAvailable) {
        const folderName = configuredTeamFolder()
        const choice = await vscode.window.showInformationMessage(
          `Create "${folderName}" for team notes?`,
          {
            modal: true,
            detail:
              'mdpad will store one markdown file per page in this folder, so the notes can be committed and shared with your team.',
          },
          'Create Folder',
        )
        if (choice !== 'Create Folder') return
        try {
          await vscode.workspace.fs.createDirectory(teamStorage.folderUri)
        } catch (err) {
          vscode.window.showErrorMessage(
            `mdpad: could not create ${folderName} — ${err instanceof Error ? err.message : String(err)}`,
          )
          return
        }
        await teamStorage.initialize()
        publishTeamAvailability()
      }

      if (!teamStorage.isAvailable) return
      setScope('team')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.copyPageTo', async () => {
      const state = getActiveStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      if (!page) return

      const targets = SCOPE_ORDER.filter(
        scope => scope !== currentScope && SCOPES[scope].available(),
      )
      if (targets.length === 0) {
        vscode.window.showInformationMessage(
          'mdpad: no other note scope is available to copy into.',
        )
        return
      }

      const picked = await vscode.window.showQuickPick(
        targets.map(scope => ({
          label: `${SCOPES[scope].icon} ${SCOPES[scope].label}`,
          scope,
        })),
        { placeHolder: `Copy "${deriveTitle(page.content)}" to…` },
      )
      if (!picked) return

      const target = SCOPES[picked.scope].storage()
      const created = target.newPage()
      target.updateContent(created.activeId, page.content)
      vscode.window.showInformationMessage(
        `mdpad: copied to ${SCOPES[picked.scope].label} notes.`,
      )
      updateStatusBar()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.exportPage', async () => {
      const state = getActiveStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      if (!page) return
      const title = deriveTitle(page.content)
      const fileName = slugify(title)
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${fileName}.md`),
        filters: { Markdown: ['md'] },
      })
      if (uri) {
        try {
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(page.content, 'utf-8'),
          )
          vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`)
        } catch (err) {
          vscode.window.showErrorMessage(
            `mdpad: export failed — ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.enterReaderMode', () => {
      applyReaderMode(true)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.exitReaderMode', () => {
      applyReaderMode(false)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.openSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:tbekaert.mdpad',
      )
    }),
  )

  const debounceSearch = (fn: (query: string) => void, ms = 150) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    return (query: string) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => fn(query), ms)
    }
  }

  const sendCursorToActive = (pos: number) => {
    const msg = { type: 'setCursor' as const, pos }
    setTimeout(() => {
      if (panelProvider.isActive) {
        panelProvider.postMessage(msg)
      } else {
        sidebarProvider.postMessage(msg)
      }
    }, 50)
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.searchPages', () => {
      type SearchResult = vscode.QuickPickItem & {
        pageId: string
        scope: Scope
        cursorPos: number
      }

      const qp = vscode.window.createQuickPick<SearchResult>()
      qp.placeholder = 'Search across all pages...'

      qp.onDidChangeValue(
        debounceSearch(query => {
          if (!query) {
            qp.items = []
            return
          }
          const results: SearchResult[] = []

          for (const scope of SCOPE_ORDER) {
            const entry = SCOPES[scope]
            if (!entry.available()) continue
            for (const page of entry.storage().getState().pages) {
              for (const match of searchLines(page.content, query)) {
                results.push({
                  label: `${entry.icon} ${deriveTitle(page.content)}`,
                  description: `${entry.label} · line ${match.lineNum}`,
                  detail: match.line,
                  pageId: page.id,
                  scope,
                  cursorPos: match.cursorPos,
                  alwaysShow: true,
                })
              }
            }
          }
          qp.items = results
        }),
      )

      qp.onDidAccept(() => {
        const picked = qp.selectedItems[0]
        if (picked) {
          if (picked.scope !== currentScope) applyScope(picked.scope)
          getActiveStorage().switchPage(picked.pageId)
          switchAndUpdate()
          // The cursor jump needs the editor; a reader-mode webview drops
          // setCursor, which would turn accepting a result into a no-op.
          if (readerMode) applyReaderMode(false)
          sendCursorToActive(picked.cursorPos)
        }
        qp.dispose()
      })
      qp.onDidHide(() => qp.dispose())
      qp.show()
    }),
  )

  const postCommandToActive = (command: MdpadCommand) => {
    if (panelProvider.isActive) {
      panelProvider.postCommand(command)
    } else {
      sidebarProvider.postCommand(command)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.toggleBold', () =>
      postCommandToActive('toggleBold'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.toggleItalic', () =>
      postCommandToActive('toggleItalic'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.toggleStrikethrough', () =>
      postCommandToActive('toggleStrikethrough'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.toggleCode', () =>
      postCommandToActive('toggleCode'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.toggleHighlight', () =>
      postCommandToActive('toggleHighlight'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.toggleHeading', () =>
      postCommandToActive('toggleHeading'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mdpad.find', () => {
      const state = getActiveStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      if (!page) return

      type FindResult = vscode.QuickPickItem & { cursorPos: number }

      const qp = vscode.window.createQuickPick<FindResult>()
      qp.placeholder = 'Find in note...'

      qp.onDidChangeValue(
        debounceSearch(query => {
          if (!query) {
            qp.items = []
            return
          }
          qp.items = searchLines(page.content, query).map(match => ({
            label: match.line,
            description: `line ${match.lineNum}`,
            cursorPos: match.cursorPos,
            alwaysShow: true,
          }))
        }),
      )

      qp.onDidAccept(() => {
        const picked = qp.selectedItems[0]
        if (picked) {
          if (readerMode) applyReaderMode(false)
          sendCursorToActive(picked.cursorPos)
        }
        qp.dispose()
      })
      qp.onDidHide(() => qp.dispose())
      qp.show()
    }),
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mdpad')) {
        sendSettingsToActive()
      }
      if (e.affectsConfiguration('mdpad.syncGlobalNotes')) {
        const sync = vscode.workspace
          .getConfiguration('mdpad')
          .get<boolean>('syncGlobalNotes', false)
        context.globalState.setKeysForSync(sync ? ['mdpad.notes'] : [])
      }
      // Additive, not `else if`: the first branch above matches every mdpad
      // key, so chaining would swallow a folder change made in the same event
      // as any other setting.
      if (e.affectsConfiguration('mdpad.teamNotesFolder')) {
        void reloadTeamStorage()
      }
    }),
  )

  updateStatusBar()
}

export const deactivate = async (): Promise<void> => {
  await teamStorage?.flush()
}
