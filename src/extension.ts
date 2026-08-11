import * as vscode from 'vscode'
import { deriveTitle } from './deriveTitle'
import { type ExternalChange, FileNotesStorage } from './FileNotesStorage'
import { NotesStorage } from './NotesStorage'
import { childFolders, dirOf, nearestExistingDir } from './notePaths'
import { PanelProvider } from './PanelProvider'
import { SidebarProvider } from './SidebarProvider'
import { searchLines } from './searchLines'
import { slugify } from './slug'
import type { INotesStorage } from './storageTypes'
import type {
  ExtensionMessage,
  ScribeAsideCommand,
  ScribeAsideSettings,
  SyntaxMode,
} from './webview/types'

type Scope = 'workspace' | 'global' | 'team'

interface ScopeEntry {
  label: string
  icon: string
  // Getters, not values: the team entry's storage object is replaced whenever
  // scribeaside.teamNotesFolder changes, and a captured reference would keep writing
  // to the old folder.
  storage: () => INotesStorage
  available: () => boolean
}

// Cycle order for the title-bar scope button.
const SCOPE_ORDER: Scope[] = ['workspace', 'global', 'team']

const SCOPE_KEY = 'scribeaside.scope'
const TEAM_ACTIVE_KEY = 'scribeaside.teamActiveId'
const READER_KEY = 'scribeaside.readerMode'
const DEFAULT_TEAM_FOLDER = '.scribeaside'

// Module scope so deactivate() can flush pending writes at shutdown.
let teamStorage: FileNotesStorage | undefined

const configuredTeamFolder = (): string =>
  vscode.workspace
    .getConfiguration('scribeaside')
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

  let scribeasideFocused = false

  const handleFocusChange = (focused: boolean) => {
    scribeasideFocused = focused
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
    .getConfiguration('scribeaside')
    .get<boolean>('syncGlobalNotes', false)
  context.globalState.setKeysForSync(syncEnabled ? ['scribeaside.notes'] : [])

  const statusBar = vscode.window.createStatusBarItem(
    'scribeaside-status',
    vscode.StatusBarAlignment.Right,
    100,
  )
  context.subscriptions.push(statusBar)

  const scopeLabel = (): string => SCOPES[currentScope].label

  const getSettings = (): ScribeAsideSettings => {
    const config = vscode.workspace.getConfiguration('scribeaside')
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
    statusBar.tooltip = `ScribeAside — ${scopeLabel()}`
    statusBar.show()
  }

  const switchAndUpdate = () => {
    sidebarProvider.setTitle(scopeLabel())
    panelProvider.setTitle(`ScribeAside (${scopeLabel()})`)
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
      'scribeaside.teamAvailable',
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
    vscode.commands.registerCommand('scribeaside.openInEditor', () => {
      sidebarProvider.detach()
      panelProvider.open()
      panelProvider.setTitle(`ScribeAside (${scopeLabel()})`)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.focusNotes', async () => {
      if (scribeasideFocused) {
        await vscode.commands.executeCommand(
          'workbench.action.focusActiveEditorGroup',
        )
      } else if (panelProvider.isActive) {
        panelProvider.open()
      } else {
        await vscode.commands.executeCommand('scribeaside.notesView.focus')
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.newPage', () => {
      getActiveStorage().newPage()
      switchAndUpdate()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.deletePage', async () => {
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
    vscode.commands.registerCommand('scribeaside.previousPage', () => {
      getActiveStorage().previousPage()
      switchAndUpdate()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.nextPage', () => {
      getActiveStorage().nextPage()
      switchAndUpdate()
    }),
  )

  type PageItem = vscode.QuickPickItem & {
    itemKind: 'page'
    pageId: string
    scope: Scope
  }
  type FolderItem = vscode.QuickPickItem & { itemKind: 'folder'; dir: string }
  type SeparatorItem = vscode.QuickPickItem & { itemKind: 'separator' }
  type PickItem = PageItem | FolderItem | SeparatorItem

  // Folder browsing belongs to the folder-backed scope only — the memento
  // scopes have no paths to walk into — and it is what `flat` turns off.
  const browsingTree = (): boolean =>
    currentScope === 'team' &&
    vscode.workspace
      .getConfiguration('scribeaside')
      .get<'tree' | 'flat'>('teamNotesView', 'tree') === 'tree'

  // A nested page shows the folder it lives in instead of an ordinal: while
  // browsing a subtree the ordinal counts the folder, not the whole scope, so
  // it would read as a different page's number.
  const describePage = (
    entry: ScopeEntry,
    id: string,
    index: number,
  ): string => {
    const dir = dirOf(id)
    return dir
      ? `${dir} · ${entry.label}`
      : `Page ${index + 1} · ${entry.label}`
  }

  // `dir === undefined` lists every page in the scope; a string lists only the
  // pages sitting directly in that folder.
  const pageItems = (
    scope: Scope,
    isActiveScope: boolean,
    dir?: string,
  ): PageItem[] => {
    const entry = SCOPES[scope]
    const state = entry.storage().getState()
    const pages =
      dir === undefined
        ? state.pages
        : state.pages.filter(page => dirOf(page.id) === dir)
    return pages.map((page, i) => ({
      itemKind: 'page',
      label: `${isActiveScope && page.id === state.activeId ? '$(check) ' : ''}${entry.icon} ${deriveTitle(page.content)}`,
      description: describePage(entry, page.id, i),
      pageId: page.id,
      scope,
    }))
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.selectPage', async () => {
      const separator: SeparatorItem = {
        itemKind: 'separator',
        label: '',
        kind: vscode.QuickPickItemKind.Separator,
      }

      const build = (dir: string, tree: boolean, ids: string[]): PickItem[] => {
        const items: PickItem[] = []

        if (tree) {
          if (dir) {
            items.push({
              itemKind: 'folder',
              label: '$(arrow-left) ..',
              description: dirOf(dir) || 'Top level',
              dir: dirOf(dir),
            })
          }
          for (const folder of childFolders(ids, dir)) {
            items.push({
              itemKind: 'folder',
              label: `$(folder) ${folder.name}`,
              description: `${folder.noteCount} note${folder.noteCount === 1 ? '' : 's'}`,
              dir: folder.path,
            })
          }
        }

        items.push(...pageItems(currentScope, true, tree ? dir : undefined))

        // Other scopes are offered at the top level only: they have no folder
        // to be inside of, and repeating them at every depth would bury the
        // folder you just opened under two unrelated note lists.
        if (dir === '') {
          for (const scope of SCOPE_ORDER) {
            if (scope === currentScope || !SCOPES[scope].available()) continue
            const others = pageItems(scope, false)
            if (others.length === 0) continue
            items.push(separator, ...others)
          }
        }
        return items
      }

      let dir = ''
      for (;;) {
        const tree = browsingTree()
        const ids = SCOPES[currentScope]
          .storage()
          .getState()
          .pages.map(page => page.id)
        // The folder can empty out under us — a teammate's delete lands while
        // the picker is open — so fall back to the nearest one that still has
        // notes rather than showing a directory that is no longer there.
        dir = tree ? nearestExistingDir(ids, dir) : ''

        const picked = await vscode.window.showQuickPick(
          build(dir, tree, ids),
          {
            placeHolder: dir
              ? `Select a page (${scopeLabel()} · ${dir})`
              : `Select a page (${scopeLabel()})`,
          },
        )

        if (!picked) return
        if (picked.itemKind === 'folder') {
          dir = picked.dir
          continue
        }
        if (picked.itemKind === 'page') {
          if (picked.scope !== currentScope) applyScope(picked.scope)
          getActiveStorage().switchPage(picked.pageId)
          switchAndUpdate()
        }
        return
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.switchToGlobal', () => {
      setScope('global')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.switchToWorkspace', () => {
      setScope('workspace')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.switchToTeam', async () => {
      if (!vscode.workspace.workspaceFolders?.[0]) {
        vscode.window.showErrorMessage(
          'ScribeAside: team notes need an open workspace folder.',
        )
        return
      }

      if (!teamStorage) {
        teamStorage = buildTeamStorage()
        // Probe before prompting, or the modal offers to create a folder that
        // is already sitting there.
        await teamStorage?.initialize()
        publishTeamAvailability()
      } else if (!teamStorage.isAvailable) {
        // The last probe said "missing", but that answer is as old as the
        // window: a pull or a `mkdir` since then would otherwise still be met
        // with an offer to create a folder that now exists.
        await teamStorage.refresh()
        publishTeamAvailability()
      }
      if (!teamStorage) {
        vscode.window.showErrorMessage(
          `ScribeAside: "${configuredTeamFolder()}" is not a usable team notes folder name — set scribeaside.teamNotesFolder to a folder inside the workspace.`,
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
              'ScribeAside will store one markdown file per page in this folder, so the notes can be committed and shared with your team.',
          },
          'Create Folder',
        )
        if (choice !== 'Create Folder') return
        try {
          await vscode.workspace.fs.createDirectory(teamStorage.folderUri)
        } catch (err) {
          vscode.window.showErrorMessage(
            `ScribeAside: could not create ${folderName} — ${err instanceof Error ? err.message : String(err)}`,
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
    vscode.commands.registerCommand(
      'scribeaside.refreshTeamNotes',
      async () => {
        if (!vscode.workspace.workspaceFolders?.[0]) {
          vscode.window.showErrorMessage(
            'ScribeAside: team notes need an open workspace folder.',
          )
          return
        }
        // A full rebuild rather than teamStorage.refresh(): the folder may not
        // have existed when the window opened, in which case there is no
        // storage object yet, and a watcher that missed events is a plausible
        // reason to be reaching for this command in the first place.
        await reloadTeamStorage()
        if (teamStorage?.isAvailable) {
          const count = teamStorage.getState().pages.length
          vscode.window.setStatusBarMessage(
            `ScribeAside: team notes reloaded — ${count} page${count === 1 ? '' : 's'}.`,
            3000,
          )
        } else {
          vscode.window.showWarningMessage(
            `ScribeAside: "${configuredTeamFolder()}" is not there — run ScribeAside: Switch to Team Notes to create it.`,
          )
        }
      },
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.copyPageTo', async () => {
      const state = getActiveStorage().getState()
      const page = state.pages.find(p => p.id === state.activeId)
      if (!page) return

      const targets = SCOPE_ORDER.filter(
        scope => scope !== currentScope && SCOPES[scope].available(),
      )
      if (targets.length === 0) {
        vscode.window.showInformationMessage(
          'ScribeAside: no other note scope is available to copy into.',
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
        `ScribeAside: copied to ${SCOPES[picked.scope].label} notes.`,
      )
      updateStatusBar()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.exportPage', async () => {
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
            `ScribeAside: export failed — ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.enterReaderMode', () => {
      applyReaderMode(true)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.exitReaderMode', () => {
      applyReaderMode(false)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.openSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:smlfrysamuri.scribeaside',
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
    vscode.commands.registerCommand('scribeaside.searchPages', () => {
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
                  description: `${dirOf(page.id) ? `${dirOf(page.id)} · ` : ''}${entry.label} · line ${match.lineNum}`,
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

  const postCommandToActive = (command: ScribeAsideCommand) => {
    if (panelProvider.isActive) {
      panelProvider.postCommand(command)
    } else {
      sidebarProvider.postCommand(command)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.toggleBold', () =>
      postCommandToActive('toggleBold'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.toggleItalic', () =>
      postCommandToActive('toggleItalic'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.toggleStrikethrough', () =>
      postCommandToActive('toggleStrikethrough'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.toggleCode', () =>
      postCommandToActive('toggleCode'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.toggleHighlight', () =>
      postCommandToActive('toggleHighlight'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.toggleHeading', () =>
      postCommandToActive('toggleHeading'),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('scribeaside.find', () => {
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
      if (e.affectsConfiguration('scribeaside')) {
        sendSettingsToActive()
      }
      if (e.affectsConfiguration('scribeaside.syncGlobalNotes')) {
        const sync = vscode.workspace
          .getConfiguration('scribeaside')
          .get<boolean>('syncGlobalNotes', false)
        context.globalState.setKeysForSync(sync ? ['scribeaside.notes'] : [])
      }
      // Additive, not `else if`: the first branch above matches every scribeaside
      // key, so chaining would swallow a folder change made in the same event
      // as any other setting.
      if (e.affectsConfiguration('scribeaside.teamNotesFolder')) {
        void reloadTeamStorage()
      }
    }),
  )

  updateStatusBar()
}

export const deactivate = async (): Promise<void> => {
  await teamStorage?.flush()
}
