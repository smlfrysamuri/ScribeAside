// Minimal `vscode` runtime stub for mocha unit tests. Only covers the surface
// currently exercised by code under test — extend as new call sites appear.

type Call = { method: string; args: unknown[] }

export const calls: Call[] = []

export const resetCalls = (): void => {
  calls.length = 0
}

const record = (method: string, args: unknown[]): void => {
  calls.push({ method, args })
}

type FakeUri = {
  scheme: string
  fsPath: string
  path: string
  toString(): string
}

const makeUri = (raw: string): FakeUri => ({
  scheme: raw.match(/^([a-z]+):/)?.[1] ?? 'file',
  fsPath: raw.replace(/^file:\/\//, ''),
  path: raw,
  toString: () => raw,
})

export const Uri = {
  parse: (raw: string): FakeUri => {
    record('Uri.parse', [raw])
    return makeUri(raw)
  },
  joinPath: (base: FakeUri, ...segments: string[]): FakeUri => {
    const joined = [base.path.replace(/\/$/, ''), ...segments].join('/')
    return makeUri(joined)
  },
  file: (path: string): FakeUri => makeUri(`file://${path}`),
}

export let openTextDocumentShouldFail: Error | null = null

export const setOpenTextDocumentFailure = (err: Error | null): void => {
  openTextDocumentShouldFail = err
}

// ---------------------------------------------------------------------------
// In-memory filesystem
// ---------------------------------------------------------------------------

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const

type Entry = { type: number; content: string }

const files = new Map<string, Entry>()

const normalize = (uri: FakeUri | string): string =>
  (typeof uri === 'string' ? uri : uri.toString()).replace(/\/+$/, '')

// Lets a test hold a write in flight long enough to interleave a delete, a
// second write, or a flush against it.
let writeDelayMs = 0

export const fsSetWriteDelay = (ms: number): void => {
  writeDelayMs = ms
}

export const fsDelete = (path: string): void => {
  files.delete(normalize(path))
}

export const fsReset = (): void => {
  files.clear()
  writeDelayMs = 0
}

export const fsMkdir = (path: string): void => {
  files.set(normalize(path), { type: FileType.Directory, content: '' })
}

export const fsWriteFile = (path: string, content: string): void => {
  files.set(normalize(path), { type: FileType.File, content })
}

export const fsRead = (path: string): string | undefined =>
  files.get(normalize(path))?.content

export const fsList = (): string[] => [...files.keys()].sort()

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

const fs = {
  stat: (uri: FakeUri): Promise<{ type: number }> => {
    const entry = files.get(normalize(uri))
    if (!entry) return Promise.reject(new Error(`ENOENT: ${uri.toString()}`))
    return Promise.resolve({ type: entry.type })
  },
  readDirectory: (uri: FakeUri): Promise<[string, number][]> => {
    const base = normalize(uri)
    const entry = files.get(base)
    if (!entry || entry.type !== FileType.Directory) {
      return Promise.reject(new Error(`ENOTDIR: ${uri.toString()}`))
    }
    const out: [string, number][] = []
    for (const [path, value] of files) {
      if (path !== base && parentOf(path) === base) {
        out.push([path.slice(base.length + 1), value.type])
      }
    }
    return Promise.resolve(out)
  },
  readFile: (uri: FakeUri): Promise<Uint8Array> => {
    const entry = files.get(normalize(uri))
    if (!entry || entry.type !== FileType.File) {
      return Promise.reject(new Error(`ENOENT: ${uri.toString()}`))
    }
    return Promise.resolve(new TextEncoder().encode(entry.content))
  },
  // Mirrors the real workspace.fs.writeFile, which creates missing parent
  // directories. A stricter stub would hide the case where mdpad writes into
  // a folder the user deleted and silently brings it back.
  writeFile: async (uri: FakeUri, bytes: Uint8Array): Promise<void> => {
    record('workspace.fs.writeFile', [uri.toString()])
    if (writeDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, writeDelayMs))
    }
    const path = normalize(uri)
    files.set(parentOf(path), { type: FileType.Directory, content: '' })
    files.set(path, {
      type: FileType.File,
      content: new TextDecoder().decode(bytes),
    })
  },
  delete: (uri: FakeUri): Promise<void> => {
    record('workspace.fs.delete', [uri.toString()])
    const path = normalize(uri)
    if (!files.delete(path)) {
      return Promise.reject(new Error(`ENOENT: ${uri.toString()}`))
    }
    return Promise.resolve()
  },
  createDirectory: (uri: FakeUri): Promise<void> => {
    record('workspace.fs.createDirectory', [uri.toString()])
    files.set(normalize(uri), { type: FileType.Directory, content: '' })
    return Promise.resolve()
  },
}

// ---------------------------------------------------------------------------
// File system watcher
// ---------------------------------------------------------------------------

export class RelativePattern {
  constructor(
    public readonly base: FakeUri,
    public readonly pattern: string,
  ) {}
}

type WatcherKind = 'create' | 'change' | 'delete'
type WatcherHandler = (uri: FakeUri) => void

interface StubWatcher {
  handlers: Record<WatcherKind, WatcherHandler[]>
  disposed: boolean
}

const watchers: StubWatcher[] = []

export const resetWatchers = (): void => {
  watchers.length = 0
}

// Tests drive external events directly. A watcher that observed the in-memory
// map would also fire on the class's own writes, which would make the
// self-write suppression test pass for the wrong reason.
export const fireWatcher = (kind: WatcherKind, path: string): void => {
  const uri = makeUri(path)
  for (const watcher of watchers) {
    if (watcher.disposed) continue
    for (const handler of watcher.handlers[kind]) handler(uri)
  }
}

const configValues = new Map<string, unknown>()

export const setConfigValue = (key: string, value: unknown): void => {
  configValues.set(key, value)
}

export const resetConfigValues = (): void => {
  configValues.clear()
}

export const workspace = {
  workspaceFolders: [{ uri: makeUri('file:///workspace') }] as
    | { uri: FakeUri }[]
    | undefined,
  openTextDocument: (uri: FakeUri): Promise<{ uri: FakeUri }> => {
    record('workspace.openTextDocument', [uri])
    if (openTextDocumentShouldFail) {
      return Promise.reject(openTextDocumentShouldFail)
    }
    return Promise.resolve({ uri })
  },
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      const full = section ? `${section}.${key}` : key
      return configValues.has(full) ? (configValues.get(full) as T) : fallback
    },
  }),
  fs,
  createFileSystemWatcher: (pattern: RelativePattern) => {
    record('workspace.createFileSystemWatcher', [pattern.pattern])
    const watcher: StubWatcher = {
      handlers: { create: [], change: [], delete: [] },
      disposed: false,
    }
    watchers.push(watcher)
    const register = (kind: WatcherKind) => (handler: WatcherHandler) => {
      watcher.handlers[kind].push(handler)
      return {
        dispose: () => {
          watcher.handlers[kind] = watcher.handlers[kind].filter(
            h => h !== handler,
          )
        },
      }
    }
    return {
      onDidCreate: register('create'),
      onDidChange: register('change'),
      onDidDelete: register('delete'),
      dispose: () => {
        watcher.disposed = true
      },
    }
  },
}

export const env = {
  openExternal: (uri: FakeUri): Promise<boolean> => {
    record('env.openExternal', [uri])
    return Promise.resolve(true)
  },
}

export const window = {
  showTextDocument: (doc: unknown): Promise<unknown> => {
    record('window.showTextDocument', [doc])
    return Promise.resolve(doc)
  },
  showErrorMessage: (message: string): Promise<string | undefined> => {
    record('window.showErrorMessage', [message])
    return Promise.resolve(undefined)
  },
  showInformationMessage: (message: string): Promise<string | undefined> => {
    record('window.showInformationMessage', [message])
    return Promise.resolve(undefined)
  },
  showWarningMessage: (message: string): Promise<string | undefined> => {
    record('window.showWarningMessage', [message])
    return Promise.resolve(undefined)
  },
}

export const setWorkspaceFolders = (
  folders: { uri: FakeUri }[] | undefined,
): void => {
  workspace.workspaceFolders = folders
}
