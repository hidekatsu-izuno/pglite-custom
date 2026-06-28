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
  _pgl_set_rw_cbs: (read_cb: number, write_cb: number) => void
  _pgl_set_pipe_fn: (pipe_fn: number) => number
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
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

function makeEnvImports(getTable: () => WebAssembly.Table) {
  const invoke = (index: number, ...args: unknown[]) =>
    (getTable().get(index) as CallableFunction)(...args)
  const invokeVoid = (index: number, ...args: unknown[]) => {
    invoke(index, ...args)
  }
  const stub = () => 0

  return new Proxy(
    {
      __wasm_setjmp: stub,
      __wasm_setjmp_test: stub,
      __wasm_longjmp: (_env: number, value: number) => {
        throw { name: 'ExitStatus', status: value }
      },
      emscripten_longjmp: (_env: number, value: number) => {
        throw { name: 'ExitStatus', status: value }
      },
      getTempRet0: stub,
      setTempRet0: stub,
    } as Record<string, CallableFunction>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        if (prop.startsWith('invoke_v')) return invokeVoid
        if (prop.startsWith('invoke_')) return invoke
        return stub
      },
    },
  )
}

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
  const { WASI } = (await import('node:wasi')) as any
  const root =
    typeof (moduleOverrides as any).__wasiRoot === 'string'
      ? (moduleOverrides as any).__wasiRoot
      : fs.mkdtempSync(path.join(os.tmpdir(), 'pglite-wasi-'))
  const pgRoot = path.join(root, 'pglite')
  const homeRoot = path.join(root, 'home')
  const dataRoot = path.join(root, 'data')
  fs.mkdirSync(pgRoot, { recursive: true })
  fs.mkdirSync(homeRoot, { recursive: true })
  fs.mkdirSync(dataRoot, { recursive: true })

  const installShare = path.join(pgRoot, 'share')
  if (!fs.existsSync(installShare)) {
    const candidates: string[] = []
    if (moduleUrl.protocol === 'file:') {
      const { fileURLToPath } = await import('url')
      candidates.push(
        path.join(path.dirname(fileURLToPath(moduleUrl)), 'share'),
      )
    }
    candidates.push(
      path.resolve('postgres-pglite/pglite/out/wasi-install/pglite/share'),
    )
    const sourceShare = candidates.find((candidate) => fs.existsSync(candidate))
    if (sourceShare) {
      fs.cpSync(sourceShare, installShare, { recursive: true })
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
  const envImports = makeEnvImports(getTable)

  const imports: WebAssembly.Imports = {
    env: envImports,
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
    },
  }

  const wasmModule = await readWasm(
    moduleUrl,
    moduleOverrides.wasmModule as any,
  )
  const instance = await WebAssembly.instantiate(wasmModule, imports)
  const exports = instance.exports as Record<string, any>
  const initializeExports = { ...exports }
  delete initializeExports._start
  wasi.initialize({
    exports: initializeExports,
  })
  const memory = exports.memory as WebAssembly.Memory
  runtimeRefs.memory = memory
  runtimeRefs.table = exports.__indirect_function_table as WebAssembly.Table
  const { UTF8ToString, writeString } = makeStringReaders(memory)

  const malloc = exports.malloc as (size: number) => number
  const free = exports.free as (ptr: number) => void
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
    try {
      return exports.__main_argc_argv(argvPtrs.length, argv)
    } catch (err) {
      if (err instanceof ExitStatus) {
        return err.status
      }
      throw err
    } finally {
      for (const ptr of argvPtrs) free(ptr)
      free(argv)
      resetAfterProcExit?.()
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
