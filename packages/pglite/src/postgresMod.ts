import { pglUtils } from '@electric-sql/pglite-utils'

type RuntimeModule = {
  [key: string]: any
  preInit?: Array<(mod: PostgresMod) => void>
  preRun?: Array<(mod: PostgresMod) => void>
  postRun?: Array<(mod: PostgresMod) => void>
  arguments?: string[]
  thisProgram?: string
  ENV?: Record<string, string>
  PGLITE_ENV?: Record<string, string>
  print?: (text: string) => void
  printErr?: (text: string) => void
  onRuntimeInitialized?: () => void
  pg_extensions?: Record<string, Promise<Blob | null>>
  initialMemory?: number
  __wasiDataRoot?: string
}

type AnalyzePath = {
  exists: boolean
  object?: unknown
}

export type FS = {
  filesystems: {
    MEMFS: unknown
    NODEFS: unknown
  }
  ErrnoError: new (errno: number) => Error
  analyzePath(path: string): AnalyzePath
  chmod(path: string, mode: number): void
  createPreloadedFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    onload?: () => void,
    onerror?: (err: unknown) => void,
    dontCreateFile?: boolean,
  ): void
  isDir(mode: number): boolean
  isFile(mode: number): boolean
  makedev(major: number, minor: number): number
  mkdir(path: string): void
  mkdirTree(path: string): void
  mkdev(path: string, dev: number): void
  mount(type: unknown, opts: Record<string, unknown>, mountpoint: string): void
  quit(): void
  readFile(path: string, opts?: { encoding?: 'binary' | 'utf8' }): any
  readdir(path: string): string[]
  registerDevice(dev: number, ops: unknown): void
  rmdir(path: string): void
  stat(path: string): { mode: number; size: number; mtime: Date }
  unlink(path: string): void
  writeFile(path: string, data: Uint8Array | string): void
  utime(path: string, atime: number | Date, mtime: number | Date): void
  __root?: string
  __resolvePath?: (path: string) => string
}

export interface PostgresMod extends RuntimeModule {
  FS: FS
  ENV: Record<string, string>
  HEAP8: Int8Array
  HEAPU8: Uint8Array
  PGLITE_ENV: Record<string, string>
  PROXYFS: unknown
  WASM_PREFIX: string
  pg_extensions: Record<string, Promise<Blob | null>>
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  _pgl_set_system_fn: (system_fn: number) => void
  _pgl_set_popen_fn: (popen_fn: number) => void
  _pgl_set_pclose_fn: (pclose_fn: number) => void
  _pgl_set_blob_cbs: (
    read_cb: number,
    write_cb: number,
    llseek_cb: number,
  ) => void
  _pgl_set_rw_cbs: (read_cb: number, write_cb: number) => void
  _pgl_set_pipe_fn: (pipe_fn: number) => number
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
  _pgl_chdir?: (path: number) => number
  _pgl_pq_flush: () => void
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  _fflush: (stream: number) => void
  _pgl_proc_exit: (code: number) => number
  addFunction: (cb: CallableFunction, signature: string) => number
  removeFunction: (f: number) => void
  callMain: (args?: string[]) => number
  _PostgresMainLoopOnce: () => void
  _PostgresMainLongJmp: () => void
  _PostgresSendReadyForQueryIfNecessary: () => void
  _ProcessStartupPacket: (
    Port: number,
    ssl_done: boolean,
    gss_done: boolean,
  ) => number
  _IsTransactionBlock: () => number
  _pgl_setPGliteActive: (newValue: number) => number
  _pgl_startPGlite: () => void
  _pgl_getMyProcPort: () => number
  _pgl_sendConnData: () => void
  _emscripten_force_exit: (status: number) => void
  _pgl_run_atexit_funcs: () => void
  _pq_buffer_remaining_data: () => number
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

class ErrnoError extends Error {
  constructor(readonly errno: number) {
    super(`FS error ${errno}`)
  }
}

class ExitStatus extends Error {
  readonly name = 'ExitStatus'

  constructor(readonly status: number) {
    super(`Program terminated with exit(${status})`)
  }
}

function isExitStatus(err: unknown): err is { status: number } {
  return (
    err instanceof ExitStatus ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'ExitStatus' &&
      typeof (err as { status?: unknown }).status === 'number')
  )
}

function getWasiExitCode(wasi: unknown, err: unknown): number | undefined {
  if (typeof err !== 'symbol' || String(err) !== 'Symbol(kExitCode)') {
    return undefined
  }
  if (typeof wasi !== 'object' || wasi === null) {
    return undefined
  }
  const exitCodeSymbol = Object.getOwnPropertySymbols(wasi).find(
    (symbol) => String(symbol) === 'Symbol(kExitCode)',
  )
  if (!exitCodeSymbol) {
    return undefined
  }
  const exitCode = (wasi as Record<symbol, unknown>)[exitCodeSymbol]
  return typeof exitCode === 'number' ? exitCode : undefined
}

const PGLITE_EXIT_ALIVE = 99
const POSTGRES_MAIN_LONGJMP = 100

async function createNodeFs(root: string): Promise<FS> {
  const fs = await import('fs')
  const path = await import('path')
  const mappings = new Map<string, string>([['/', root]])
  const devices = new Map<number, unknown>()

  const modeFor = (stat: import('fs').Stats) =>
    (stat.isDirectory() ? 0o040000 : 0o100000) | (stat.mode & 0o777)

  const resolvePath = (filePath: string): string => {
    const normalized = path.posix.resolve('/', filePath)
    let bestMount = '/'
    for (const mountpoint of mappings.keys()) {
      if (
        mountpoint.length > bestMount.length &&
        (normalized === mountpoint || normalized.startsWith(`${mountpoint}/`))
      ) {
        bestMount = mountpoint
      }
    }
    const rel = path.posix.relative(bestMount, normalized)
    return path.join(mappings.get(bestMount)!, rel)
  }

  const api: FS = {
    filesystems: {
      MEMFS: {},
      NODEFS: {},
    },
    ErrnoError,
    analyzePath(filePath) {
      return { exists: fs.existsSync(resolvePath(filePath)) }
    },
    chmod(filePath, mode) {
      const real = resolvePath(filePath)
      fs.mkdirSync(path.dirname(real), { recursive: true })
      if (!fs.existsSync(real)) {
        fs.closeSync(fs.openSync(real, 'a'))
      }
      fs.chmodSync(real, mode)
    },
    createPreloadedFile(
      parent,
      name,
      data,
      _canRead,
      _canWrite,
      onload,
      onerror,
    ) {
      try {
        api.writeFile(path.posix.join(parent, name), data)
        onload?.()
      } catch (err) {
        onerror?.(err)
      }
    },
    isDir(mode) {
      return (mode & 0o170000) === 0o040000
    },
    isFile(mode) {
      return (mode & 0o170000) === 0o100000
    },
    makedev(major, minor) {
      return (major << 8) | minor
    },
    mkdir(filePath) {
      fs.mkdirSync(resolvePath(filePath), { recursive: true })
    },
    mkdirTree(filePath) {
      fs.mkdirSync(resolvePath(filePath), { recursive: true })
    },
    mkdev(filePath, _dev) {
      const real = resolvePath(filePath)
      fs.mkdirSync(path.dirname(real), { recursive: true })
      fs.closeSync(fs.openSync(real, 'a'))
    },
    mount(type, opts, mountpoint) {
      if (type === api.filesystems.NODEFS && typeof opts.root === 'string') {
        mappings.set(path.posix.resolve('/', mountpoint), opts.root)
        return
      }
      if (opts.fs && typeof opts.root === 'string') {
        const otherFs = opts.fs as FS
        if (otherFs.__resolvePath) {
          mappings.set(
            path.posix.resolve('/', mountpoint),
            otherFs.__resolvePath(opts.root),
          )
        }
        return
      }
      api.mkdirTree(mountpoint)
    },
    quit() {},
    readFile(filePath, opts) {
      const data = fs.readFileSync(resolvePath(filePath))
      return opts?.encoding === 'utf8' ? data.toString('utf8') : data
    },
    readdir(filePath) {
      return ['.', '..', ...fs.readdirSync(resolvePath(filePath))]
    },
    registerDevice(dev, ops) {
      devices.set(dev, ops)
    },
    rmdir(filePath) {
      fs.rmdirSync(resolvePath(filePath))
    },
    stat(filePath) {
      const stat = fs.statSync(resolvePath(filePath))
      return {
        mode: modeFor(stat),
        size: stat.size,
        mtime: stat.mtime,
      }
    },
    unlink(filePath) {
      fs.unlinkSync(resolvePath(filePath))
    },
    writeFile(filePath, data) {
      const real = resolvePath(filePath)
      fs.mkdirSync(path.dirname(real), { recursive: true })
      fs.writeFileSync(real, data)
    },
    utime(filePath, atime, mtime) {
      fs.utimesSync(resolvePath(filePath), atime, mtime)
    },
    __root: root,
    __resolvePath: resolvePath,
  }
  return api
}

async function readWasm(moduleUrl: URL, module?: WebAssembly.Module) {
  if (module) return module
  if (pglUtils.IN_NODE) {
    const fs = await import('fs/promises')
    return WebAssembly.compile(await fs.readFile(moduleUrl))
  }
  const response = await fetch(moduleUrl)
  return WebAssembly.compileStreaming(response)
}

function makeStringReaders(memory: WebAssembly.Memory) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const heapU8 = () => new Uint8Array(memory.buffer)

  const UTF8ToString = (ptr: number, maxBytesToRead?: number) => {
    const heap = heapU8()
    let end = ptr
    const max = maxBytesToRead ? ptr + maxBytesToRead : heap.length
    while (end < max && heap[end] !== 0) end++
    return decoder.decode(heap.subarray(ptr, end))
  }

  const writeString = (s: string, malloc: (size: number) => number): number => {
    const bytes = encoder.encode(`${s}\0`)
    const ptr = malloc(bytes.length)
    heapU8().set(bytes, ptr)
    return ptr
  }

  return { UTF8ToString, writeString }
}

function makeLongjmpTag() {
  const WasmTag = (WebAssembly as any).Tag
  return typeof WasmTag === 'function'
    ? new WasmTag({ parameters: ['i32'], results: [] })
    : undefined
}

function makeEnvImports(getTable: () => WebAssembly.Table) {
  const invoke = (index: number, ...args: unknown[]) =>
    (getTable().get(index) as CallableFunction)(...args)
  const invokeVoid = (index: number, ...args: unknown[]) => {
    invoke(index, ...args)
  }
  const stub = () => 0

  const imports: Record<string, CallableFunction | object> = {
    __wasm_setjmp: stub,
    __wasm_setjmp_test: stub,
    __wasm_longjmp: (_env: number, _value: number) => {
      throw { name: 'ExitStatus', status: POSTGRES_MAIN_LONGJMP }
    },
    emscripten_longjmp: (_env: number, _value: number) => {
      throw { name: 'ExitStatus', status: POSTGRES_MAIN_LONGJMP }
    },
    getTempRet0: stub,
    setTempRet0: stub,
  }
  const cLongjmpTag = makeLongjmpTag()
  if (cLongjmpTag) {
    imports.__c_longjmp = cLongjmpTag
  }

  return new Proxy(imports, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (prop.startsWith('invoke_v')) return invokeVoid
      if (prop.startsWith('invoke_')) return invoke
      return stub
    },
  })
}

function isRuntimeProvidedImport(name: string) {
  return (
    name === '__dynamic_cast' ||
    name === '__resumeException' ||
    name.startsWith('__cxa_') ||
    name.startsWith('_Z')
  )
}

function createWasmMemory(initialMemory?: number) {
  const pageSize = 64 * 1024
  const initial = initialMemory ? Math.ceil(initialMemory / pageSize) : 2048
  return new WebAssembly.Memory({
    initial,
    maximum: 32768,
  })
}

type DylinkMetadata = {
  memorySize: number
  memoryAlign: number
  tableSize: number
  tableAlign: number
  neededDynlibs: string[]
  weakImports: Set<string>
}

function getDylinkMetadata(module: WebAssembly.Module): DylinkMetadata {
  let section = WebAssembly.Module.customSections(module, 'dylink.0')[0]
  let legacy = false
  if (!section) {
    section = WebAssembly.Module.customSections(module, 'dylink')[0]
    legacy = true
  }
  if (!section) {
    throw new Error('dynamic library has no dylink section')
  }

  const data = new Uint8Array(section)
  let offset = 0
  const getU8 = () => data[offset++]
  const getLEB = () => {
    let ret = 0
    let mul = 1
    for (;;) {
      const byte = data[offset++]
      ret += (byte & 0x7f) * mul
      mul *= 0x80
      if ((byte & 0x80) === 0) return ret
    }
  }
  const decoder = new TextDecoder()
  const getString = () => {
    const length = getLEB()
    const value = decoder.decode(data.subarray(offset, offset + length))
    offset += length
    return value
  }

  const metadata: DylinkMetadata = {
    memorySize: 0,
    memoryAlign: 0,
    tableSize: 0,
    tableAlign: 0,
    neededDynlibs: [],
    weakImports: new Set(),
  }

  if (legacy) {
    metadata.memorySize = getLEB()
    metadata.memoryAlign = getLEB()
    metadata.tableSize = getLEB()
    metadata.tableAlign = getLEB()
    const neededCount = getLEB()
    for (let i = 0; i < neededCount; i++) {
      metadata.neededDynlibs.push(getString())
    }
    return metadata
  }

  const WASM_DYLINK_MEM_INFO = 1
  const WASM_DYLINK_NEEDED = 2
  const WASM_DYLINK_IMPORT_INFO = 4
  const WASM_SYMBOL_BINDING_MASK = 3
  const WASM_SYMBOL_BINDING_WEAK = 1

  while (offset < data.length) {
    const subsectionType = getU8()
    const subsectionSize = getLEB()
    const subsectionEnd = offset + subsectionSize
    if (subsectionType === WASM_DYLINK_MEM_INFO) {
      metadata.memorySize = getLEB()
      metadata.memoryAlign = getLEB()
      metadata.tableSize = getLEB()
      metadata.tableAlign = getLEB()
    } else if (subsectionType === WASM_DYLINK_NEEDED) {
      const neededCount = getLEB()
      for (let i = 0; i < neededCount; i++) {
        metadata.neededDynlibs.push(getString())
      }
    } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
      const importCount = getLEB()
      for (let i = 0; i < importCount; i++) {
        getString()
        const symbol = getString()
        const flags = getLEB()
        if ((flags & WASM_SYMBOL_BINDING_MASK) === WASM_SYMBOL_BINDING_WEAK) {
          metadata.weakImports.add(symbol)
        }
      }
    }
    offset = subsectionEnd
  }

  return metadata
}

function alignMemory(size: number, alignment: number) {
  return Math.ceil(size / alignment) * alignment
}

function alignDynamicMemoryBase(ptr: number, alignment: number) {
  return alignMemory(Math.max(ptr, 1), alignment)
}

function ensureWasmMemorySize(memory: WebAssembly.Memory, size: number) {
  const pageSize = 64 * 1024
  const missing = size - memory.buffer.byteLength
  if (missing > 0) {
    memory.grow(Math.ceil(missing / pageSize))
  }
}

const DYNAMIC_LIBRARY_STACK_SIZE = 64 * 1024

async function createWasiModule<T extends PostgresMod>(
  moduleOverrides: Partial<T> = {},
  moduleUrl: URL,
): Promise<T> {
  if (!pglUtils.IN_NODE) {
    throw new Error('The WASI PGlite runtime currently requires Node.js WASI')
  }

  const os = await import('os')
  const fs = await import('fs')
  const path = await import('path')
  const nodeCrypto = await import('node:crypto')
  const { fileURLToPath } = await import('url')
  const { WASI } = (await import('node:wasi')) as any
  const root =
    typeof (moduleOverrides as any).__wasiRoot === 'string'
      ? (moduleOverrides as any).__wasiRoot
      : fs.mkdtempSync(path.join(os.tmpdir(), 'pglite-wasi-'))
  const pgRoot = path.join(root, 'pglite')
  const homeRoot = path.join(root, 'home')
  const dataRoot =
    typeof (moduleOverrides as any).__wasiDataRoot === 'string'
      ? (moduleOverrides as any).__wasiDataRoot
      : path.join(root, 'data')
  fs.mkdirSync(pgRoot, { recursive: true })
  fs.mkdirSync(homeRoot, { recursive: true })
  fs.mkdirSync(dataRoot, { recursive: true })
  fs.mkdirSync(path.join(pgRoot, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(homeRoot, 'postgres'), { recursive: true })

  const writeStaticFile = (filePath: string, content: string) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content)
    }
  }

  const staticEmpty = 'PGlite is the best!\n'
  writeStaticFile(path.join(pgRoot, 'bin', 'initdb'), staticEmpty)
  writeStaticFile(path.join(pgRoot, 'bin', 'pg_dump'), staticEmpty)
  writeStaticFile(path.join(pgRoot, 'bin', 'postgres'), staticEmpty)
  writeStaticFile(path.join(pgRoot, 'pgstdin'), staticEmpty)
  writeStaticFile(path.join(pgRoot, 'pgstdout'), staticEmpty)
  writeStaticFile(path.join(pgRoot, 'password'), 'password\n')
  writeStaticFile(
    path.join(homeRoot, 'postgres', '.pgpass'),
    [
      '# PGlite pgpass file',
      'localhost:5432:postgres:password:md532e12f215ba27cb750c9e093ce4b5127',
      'localhost:5432:postgres:postgres:md53175bce1d3201d16594cebf9d7eb3f9d',
      'localhost:5432:postgres:login:md5d5745f9425eceb269f9fe01d0bef06ff',
      '',
    ].join('\n'),
  )

  const copyInstallDir = (name: string) => {
    const installPath = path.join(pgRoot, name)
    if (fs.existsSync(installPath)) {
      return
    }
    const candidates: string[] = []
    if (moduleUrl.protocol === 'file:') {
      candidates.push(path.join(path.dirname(fileURLToPath(moduleUrl)), name))
    }
    candidates.push(
      path.resolve('postgres-pglite/pglite/out/wasi-install/pglite', name),
    )
    const sourcePath = candidates.find((candidate) => fs.existsSync(candidate))
    if (sourcePath) {
      fs.cpSync(sourcePath, installPath, { recursive: true })
    }
  }
  copyInstallDir('share')
  copyInstallDir('lib')
  const installIcu = path.join(pgRoot, 'icu')
  if (!fs.existsSync(installIcu)) {
    const candidates: string[] = []
    if (moduleUrl.protocol === 'file:') {
      candidates.push(path.join(path.dirname(fileURLToPath(moduleUrl)), 'icu'))
    }
    candidates.push(path.resolve('.bin/pglite-wasi/libs/share/icu/76.1'))
    const sourceIcu = candidates.find((candidate) => fs.existsSync(candidate))
    if (sourceIcu) {
      fs.cpSync(sourceIcu, installIcu, { recursive: true })
    }
  }

  const FS = await createNodeFs(root)
  const ENV = {
    PGDATA: '/data',
    HOME: '/home/postgres',
    USER: 'postgres',
    LOGNAME: 'postgres',
    ICU_DATA: '/pglite/icu',
    ...(moduleOverrides.ENV ?? {}),
    ...(moduleOverrides.PGLITE_ENV ?? {}),
  } as Record<string, string>
  const args = [
    moduleOverrides.thisProgram ?? '/pglite/bin/postgres',
    ...(moduleOverrides.arguments ?? []),
  ]
  const wasi = new WASI({
    version: 'preview1',
    args,
    env: ENV,
    preopens: {
      '/': root,
      '/pglite': pgRoot,
      '/home': homeRoot,
      '/data': dataRoot,
    },
    returnOnExit: true,
  })

  const callbacks = new Map<number, CallableFunction>()
  let nextCallback = 1
  const runtimeRefs: {
    table?: WebAssembly.Table
    memory?: WebAssembly.Memory
  } = {}
  let socketRead = 0
  let socketWrite = 0
  let systemFn = 0
  let popenFn = 0
  let pcloseFn = 0
  let blobRead = 0
  let blobWrite = 0
  let blobLlseek = 0
  let wasmExports: Record<string, any> = {}
  let malloc: (size: number) => number = () => 0
  let free: (ptr: number) => void = () => {}
  let writeString: (
    s: string,
    malloc: (size: number) => number,
  ) => number = () => 0
  const loadedLibsByName = new Map<string, Record<string, any>>()
  const loadedLibsByHandle = new Map<number, Record<string, any>>()
  const providedDynamicLibraries = new Set([
    'libc++.so',
    'libc++abi.so',
    'libc.so',
    'libdl.so',
    'libwasi-emulated-getpid.so',
    'libwasi-emulated-mman.so',
    'libwasi-emulated-process-clocks.so',
    'libwasi-emulated-signal.so',
  ])
  const GOT = new Map<string, WebAssembly.Global>()
  const functionIndexes = new WeakMap<CallableFunction, number>()
  let nextDynamicHandle = 1
  let dlErrorPtr = 0
  let dlLastError = ''
  const cLongjmpTag = makeLongjmpTag()

  const getTable = () => {
    if (!runtimeRefs.table) {
      throw new Error('WASI table is not initialized')
    }
    return runtimeRefs.table
  }
  const fillRandom = (ptr: number, length: number) => {
    if (!runtimeRefs.memory) {
      return -1
    }
    const heap = new Uint8Array(runtimeRefs.memory.buffer)
    const random = globalThis.crypto?.getRandomValues
    if (random) {
      for (let offset = 0; offset < length; offset += 65536) {
        random.call(
          globalThis.crypto,
          heap.subarray(ptr + offset, ptr + Math.min(length, offset + 65536)),
        )
      }
    } else {
      nodeCrypto.randomFillSync(heap.subarray(ptr, ptr + length))
    }
    return 0
  }
  const setDlError = (message: string) => {
    dlLastError = message
    if (dlErrorPtr) {
      free(dlErrorPtr)
    }
    dlErrorPtr = writeString(message, malloc)
  }
  const clearDlError = () => {
    dlLastError = ''
    if (dlErrorPtr) {
      free(dlErrorPtr)
      dlErrorPtr = 0
    }
  }
  const findFunctionIndex = (fn: CallableFunction, grow = true) => {
    const cached = functionIndexes.get(fn)
    if (cached !== undefined) return cached
    const table = getTable()
    for (let i = 0; i < table.length; i++) {
      if (table.get(i) === fn) {
        functionIndexes.set(fn, i)
        return i
      }
    }
    if (!grow) return 0
    const index = table.length
    table.grow(1)
    try {
      table.set(index, fn)
    } catch (err) {
      if (err instanceof TypeError) {
        return 0
      }
      throw err
    }
    functionIndexes.set(fn, index)
    return index
  }
  const getExportValue = (value: unknown) =>
    value instanceof WebAssembly.Global ? value.value : value
  const getDynamicExport = (exports: Record<string, any>, name: string) => {
    if (name in exports) return exports[name]
    if (name === 'Pg_magic_func' || name === '_PG_init') {
      const renamed = Object.keys(exports).find((key) => key.endsWith(name))
      if (renamed) return exports[renamed]
    }
    return undefined
  }
  const relocateDynamicExports = (
    exports: Record<string, any>,
    memoryBase: number,
  ) => {
    const relocated: Record<string, any> = {}
    for (const [name, value] of Object.entries(exports)) {
      const unwrapped = getExportValue(value)
      relocated[name] =
        typeof unwrapped === 'number' ? unwrapped + memoryBase : unwrapped
    }
    return relocated
  }
  const setGOT = (
    name: string,
    value: unknown,
    replace = false,
    growTable = true,
  ) => {
    if (name.startsWith('__em_js__')) return
    let got = GOT.get(name)
    if (!got) {
      got = new WebAssembly.Global({ value: 'i32', mutable: true }, 0)
      GOT.set(name, got)
    }
    if (!replace && got.value !== 0) return
    const unwrapped = getExportValue(value)
    if (typeof unwrapped === 'function') {
      got.value = findFunctionIndex(unwrapped as CallableFunction, growTable)
    } else if (typeof unwrapped === 'number') {
      got.value = unwrapped
    }
  }
  const mergeSymbols = (
    symbols: Record<string, any>,
    replace = false,
    growTable = true,
  ) => {
    for (const [name, value] of Object.entries(symbols)) {
      setGOT(name, value, replace, growTable)
    }
  }
  const resolveSymbol = (
    name: string,
    localScope?: Record<string, any>,
  ): unknown => {
    if (name in wasmExports) return wasmExports[name]
    if (localScope && name in localScope) return localScope[name]
    for (const loaded of loadedLibsByHandle.values()) {
      if (name in loaded) return loaded[name]
    }
    if (isRuntimeProvidedImport(name)) {
      return (envImports as Record<string, unknown>)[name]
    }
    return undefined
  }
  const instantiateDynamicLibrary = (
    libName: string,
    bytes: Uint8Array,
    localScope?: Record<string, any>,
  ) => {
    const module = new WebAssembly.Module(bytes)
    const metadata = getDylinkMetadata(module)
    const memoryAlignment = Math.pow(2, metadata.memoryAlign)
    const memoryBase = metadata.memorySize
      ? alignDynamicMemoryBase(
          malloc(metadata.memorySize + memoryAlignment + 1),
          memoryAlignment || 1,
        )
      : 0
    if (memoryBase && runtimeRefs.memory) {
      ensureWasmMemorySize(runtimeRefs.memory, memoryBase + metadata.memorySize)
      new Uint8Array(runtimeRefs.memory.buffer).fill(
        0,
        memoryBase,
        memoryBase + metadata.memorySize,
      )
    }
    const tableBase = metadata.tableSize ? getTable().length : 0
    const tableGrowthNeeded = tableBase + metadata.tableSize - getTable().length
    if (tableGrowthNeeded > 0) {
      getTable().grow(tableGrowthNeeded)
    }
    const stackMemoryBase = alignDynamicMemoryBase(
      malloc(DYNAMIC_LIBRARY_STACK_SIZE + 16),
      16,
    )
    if (runtimeRefs.memory) {
      ensureWasmMemorySize(
        runtimeRefs.memory,
        stackMemoryBase + DYNAMIC_LIBRARY_STACK_SIZE,
      )
    }
    const stackPointer = new WebAssembly.Global(
      { value: 'i32', mutable: true },
      stackMemoryBase + DYNAMIC_LIBRARY_STACK_SIZE,
    )
    let moduleExports: Record<string, any> = {}
    const stubs: Record<string, CallableFunction> = {}
    const env = new Proxy({} as Record<string, any>, {
      get(_target, prop: string) {
        if (prop === 'memory') return runtimeRefs.memory
        if (prop === '__indirect_function_table') return getTable()
        if (prop === '__memory_base') return memoryBase
        if (prop === '__table_base') return tableBase
        if (prop === '__stack_pointer') return stackPointer
        if (prop === '__c_longjmp' && cLongjmpTag) return cLongjmpTag
        if (prop in wasmExports) return wasmExports[prop]
        if (prop in moduleExports) return moduleExports[prop]
        if (localScope && prop in localScope) return localScope[prop]
        if (isRuntimeProvidedImport(prop)) {
          return (envImports as Record<string, unknown>)[prop]
        }
        if (!(prop in stubs)) {
          stubs[prop] = (...args: unknown[]) => {
            const resolved = resolveSymbol(prop, localScope)
            if (typeof resolved === 'function') {
              return (resolved as CallableFunction)(...args)
            }
            throw new Error(`unresolved dynamic symbol: ${prop}`)
          }
        }
        return stubs[prop]
      },
    })
    const gotHandler = {
      get(_target: Record<string, WebAssembly.Global>, prop: string) {
        let got = GOT.get(prop)
        if (!got) {
          got = new WebAssembly.Global({ value: 'i32', mutable: true }, 0)
          GOT.set(prop, got)
        }
        return got
      },
    }
    const instance = new WebAssembly.Instance(module, {
      env,
      wasi_snapshot_preview1: env,
      'GOT.mem': new Proxy({}, gotHandler),
      'GOT.func': new Proxy({}, gotHandler),
    })
    moduleExports = relocateDynamicExports(
      instance.exports as Record<string, any>,
      memoryBase,
    )
    mergeSymbols(moduleExports)
    for (const needed of metadata.neededDynlibs) {
      if (
        !loadedLibsByName.has(needed) &&
        !providedDynamicLibraries.has(needed)
      ) {
        throw new Error(
          `${libName} needs unsupported dynamic library ${needed}`,
        )
      }
    }
    for (const [name, got] of GOT) {
      if (got.value !== 0 || metadata.weakImports.has(name)) continue
      const resolved = resolveSymbol(name, localScope)
      if (resolved !== undefined) {
        setGOT(name, resolved, true, true)
      } else {
        throw new Error(`unresolved dynamic symbol: ${name}`)
      }
    }
    moduleExports.__wasm_apply_data_relocs?.()
    moduleExports.__wasm_call_ctors?.()
    return moduleExports
  }
  const dlopen = (filePtr: number, _mode: number) => {
    try {
      const fileName = path.posix.normalize(UTF8ToString(filePtr))
      const loaded = loadedLibsByName.get(fileName)
      if (loaded) {
        const handle = nextDynamicHandle++
        loadedLibsByHandle.set(handle, loaded)
        clearDlError()
        return handle
      }
      const bytes = FS.readFile(fileName, { encoding: 'binary' }) as Uint8Array
      const localScope: Record<string, any> = {}
      const libExports = instantiateDynamicLibrary(fileName, bytes, localScope)
      const handle = nextDynamicHandle++
      loadedLibsByName.set(fileName, libExports)
      loadedLibsByHandle.set(handle, libExports)
      clearDlError()
      return handle
    } catch (err) {
      setDlError(err instanceof Error ? err.message : String(err))
      return 0
    }
  }
  const dlsym = (handle: number, symbolPtr: number) => {
    const symbol = UTF8ToString(symbolPtr)
    const libExports = loadedLibsByHandle.get(handle)
    if (!libExports) {
      setDlError(`unknown dynamic library handle: ${handle}`)
      return 0
    }
    const value = getDynamicExport(libExports, symbol)
    if (value === undefined) {
      setDlError(`dynamic library symbol not found: ${symbol}`)
      return 0
    }
    const unwrapped = getExportValue(value)
    clearDlError()
    if (typeof unwrapped === 'function') {
      return findFunctionIndex(unwrapped as CallableFunction)
    }
    return typeof unwrapped === 'number' ? unwrapped : 0
  }
  const envImports = makeEnvImports(getTable)
  const wasmMemory = createWasmMemory(moduleOverrides.initialMemory)

  const imports: WebAssembly.Imports = {
    env: Object.assign(envImports as WebAssembly.ModuleImports, {
      memory: wasmMemory,
      dlopen,
      dlsym,
      dlclose: (handle: number) => {
        loadedLibsByHandle.delete(handle)
        clearDlError()
        return 0
      },
      dlerror: () => {
        return dlLastError ? dlErrorPtr : 0
      },
    }),
    wasi_snapshot_preview1: {
      ...wasi.wasiImport,
      proc_exit: (code: number) => {
        throw new ExitStatus(code)
      },
    },
    pglite: {
      random: fillRandom,
      socket_read: (ptr: number, maxLength: number) =>
        socketRead ? (callbacks.get(socketRead)?.(ptr, maxLength) ?? 0) : 0,
      socket_write: (ptr: number, length: number) =>
        socketWrite
          ? (callbacks.get(socketWrite)?.(ptr, length) ?? length)
          : length,
      system: (cmdPtr: number) =>
        systemFn ? (callbacks.get(systemFn)?.(cmdPtr) ?? 1) : 1,
      popen: (cmdPtr: number, modePtr: number) =>
        popenFn ? (callbacks.get(popenFn)?.(cmdPtr, modePtr) ?? 0) : 0,
      pclose: (stream: number) =>
        pcloseFn ? (callbacks.get(pcloseFn)?.(stream) ?? 0) : 0,
      blob_read: (ptr: number, maxLength: number, position: number) =>
        blobRead
          ? (callbacks.get(blobRead)?.(ptr, maxLength, position) ?? 0)
          : 0,
      blob_write: (ptr: number, length: number, position: number) =>
        blobWrite
          ? (callbacks.get(blobWrite)?.(ptr, length, position) ?? length)
          : length,
      blob_llseek: (offset: number, whence: number) =>
        blobLlseek ? (callbacks.get(blobLlseek)?.(offset, whence) ?? -1) : -1,
    },
  }

  const wasmModule = await readWasm(
    moduleUrl,
    moduleOverrides.wasmModule as any,
  )
  const instance = await WebAssembly.instantiate(wasmModule, imports)
  const exports = instance.exports as Record<string, any>
  wasmExports = exports
  exports.__wasm_init_memory?.()
  const initializeExports = { ...exports }
  delete initializeExports._start
  delete initializeExports.__wasm_init_memory
  wasi.initialize({
    exports: initializeExports,
  })
  const memory =
    (exports.memory as WebAssembly.Memory | undefined) ?? wasmMemory
  runtimeRefs.memory = memory
  runtimeRefs.table = exports.__indirect_function_table as WebAssembly.Table
  mergeSymbols(wasmExports, false, false)
  const stringReaders = makeStringReaders(memory)
  const UTF8ToString = stringReaders.UTF8ToString
  writeString = stringReaders.writeString

  malloc = exports.malloc as (size: number) => number
  free = exports.free as (ptr: number) => void
  const resetAfterProcExit = exports.pglite_reset_after_proc_exit as
    | (() => void)
    | undefined
  const callMain = (mainArgs: string[] = moduleOverrides.arguments ?? []) => {
    const argvWithProgram = [
      moduleOverrides.thisProgram ?? '/pglite/bin/postgres',
      ...mainArgs,
    ]
    const argvPtrs = argvWithProgram.map((arg) => writeString(arg, malloc))
    const argv = malloc((argvPtrs.length + 1) * 4)
    const view = new DataView(memory.buffer)
    argvPtrs.forEach((ptr, i) => view.setUint32(argv + i * 4, ptr, true))
    view.setUint32(argv + argvPtrs.length * 4, 0, true)
    let exitStatus: number | undefined
    const main = exports.__main_argc_argv
    try {
      return main(argvWithProgram.length, argv)
    } catch (err) {
      if (isExitStatus(err)) {
        exitStatus = err.status
        return err.status
      }
      const wasiExitCode = getWasiExitCode(wasi, err)
      if (wasiExitCode !== undefined) {
        exitStatus = wasiExitCode
        return wasiExitCode
      }
      throw err
    } finally {
      for (const ptr of argvPtrs) free(ptr)
      free(argv)
      if (
        exitStatus !== PGLITE_EXIT_ALIVE &&
        exitStatus !== POSTGRES_MAIN_LONGJMP
      ) {
        resetAfterProcExit?.()
      }
    }
  }

  const wrappedExports: Record<string, any> = { ...exports }
  for (const [name, value] of Object.entries(exports)) {
    if (typeof value === 'function' && !name.startsWith('_')) {
      wrappedExports[`_${name}`] = value
    }
  }

  const mod = Object.assign({}, wrappedExports, moduleOverrides, {
    ENV,
    FS,
    __wasi: true,
    PGLITE_ENV: moduleOverrides.PGLITE_ENV ?? {},
    PROXYFS: {},
    WASM_PREFIX: pglUtils.WASM_PREFIX,
    pg_extensions: moduleOverrides.pg_extensions ?? {},
    UTF8ToString,
    stringToUTF8OnStack: (s: string) => writeString(s, malloc),
    addFunction: (cb: CallableFunction) => {
      const id = nextCallback++
      callbacks.set(id, cb)
      return id
    },
    removeFunction: (id: number) => {
      callbacks.delete(id)
    },
    callMain,
    _pgl_set_rw_cbs: (readCb: number, writeCb: number) => {
      socketRead = readCb
      socketWrite = writeCb
    },
    _pgl_set_system_fn: (fn: number) => {
      systemFn = fn
    },
    _pgl_set_popen_fn: (fn: number) => {
      popenFn = fn
    },
    _pgl_set_pclose_fn: (fn: number) => {
      pcloseFn = fn
    },
    _pgl_set_blob_cbs: (readCb: number, writeCb: number, llseekCb: number) => {
      blobRead = readCb
      blobWrite = writeCb
      blobLlseek = llseekCb
    },
    _pgl_set_pipe_fn: () => 0,
    _pgl_proc_exit: (code: number) => code,
    _emscripten_force_exit: () => {},
  }) as PostgresMod
  Object.defineProperties(mod, {
    HEAP8: {
      get: () => new Int8Array(memory.buffer),
    },
    HEAPU8: {
      get: () => new Uint8Array(memory.buffer),
    },
  })

  moduleOverrides.preInit?.forEach((fn) => fn(mod))
  moduleOverrides.preRun?.forEach((fn) => fn(mod))
  exports.__wasm_call_ctors?.()
  moduleOverrides.onRuntimeInitialized?.()
  mod.onRuntimeInitialized?.()
  moduleOverrides.postRun?.forEach((fn) => fn(mod))

  return mod as T
}

const PostgresModFactory: PostgresFactory<PostgresMod> = (moduleOverrides) =>
  createWasiModule(
    moduleOverrides,
    new URL('../release/pglite.wasm', import.meta.url),
  )

export { createWasiModule }
export default PostgresModFactory
