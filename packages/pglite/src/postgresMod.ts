/* eslint-disable */
// @ts-nocheck

import * as fs from 'node:fs'
import { getDylinkMetadata } from './postgresDylink.js'
import { preparePostgresPackage } from './postgresPackage.js'
import {
  bigintToI53Checked,
  callRuntimeCallbacks,
  createCallMain,
  createMemoryViews,
  createPathFS,
  convertJsFunctionToWasm,
  createInvoke,
  createRunDependencyManager,
  createRun,
  createWasmTableHelpers,
  ExitStatus,
  FS_getMode,
  FS_modeStringToFlags,
  HEAP_MAX,
  getWasmImports,
  isInternalSym,
  PATH,
  stringToUTF8OnStack as stringToUTF8OnStackCommon,
  trimArray,
  ydayFromDate as ydayFromDateCommon,
  UTF8ArrayToString,
  instantiateNodeWasm,
  intArrayFromString,
  lengthBytesUTF8,
  stringToAscii,
  stringToUTF8Array,
} from './emscriptenCommon.js'

export type FS = typeof FS & {
  filesystems: {
    MEMFS: Emscripten.FileSystemType
    NODEFS: Emscripten.FileSystemType
  }
  quit: () => void
}

export interface PostgresMod
  extends Omit<EmscriptenModule, 'preInit' | 'preRun' | 'postRun'> {
  preInit: Array<{ (mod: PostgresMod): void }>
  preRun: Array<{ (mod: PostgresMod): void }>
  postRun: Array<{ (mod: PostgresMod): void }>
  thisProgram: string
  stdin: (() => number | null) | null
  FS: FS
  wasmMemory: WebAssembly.Memory
  wasmModule?: WebAssembly.Module
  WASM_PREFIX: string
  pg_extensions: Record<string, Promise<Blob | null>>
  getPreloadedPackage: (
    remotePackageName: string,
    remotePackageSize: number,
  ) => ArrayBuffer
  HEAP8: Int8Array
  HEAPU8: Uint8Array
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  _pgl_set_system_fn: (system_fn: number) => void
  _pgl_set_popen_fn: (popen_fn: number) => void
  _pgl_set_pclose_fn: (pclose_fn: number) => void
  _pgl_set_rw_cbs: (read_cb: number, write_cb: number) => void
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
  _pgl_pq_flush: () => void
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  addFunction: (
    cb: (ptr: any, length: number) => void,
    signature: string,
  ) => number
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
  ENV: Record<string, string>
  PGLITE_ENV: Record<string, string>
  _emscripten_force_exit: (status: number) => void
  _pgl_run_atexit_funcs: () => void
  _pq_buffer_remaining_data: () => number
}

export const PostgresModFactory = async (
  emscriptenOpts: Partial<PostgresMod> = {},
) => {
  const Module = emscriptenOpts
  const loadPostgresPackage = preparePostgresPackage(
    Module['getPreloadedPackage']?.bind(Module),
  )
  const thisProgram =
    Module['thisProgram'] ||
    (process.argv.length > 1
      ? process.argv[1].replace(/\\/g, '/')
      : './this.program')
  const out = Module['print'] || console.log.bind(console)
  const err = Module['printErr'] || console.error.bind(console)
  let dynamicLibraries = Module['dynamicLibraries'] || []
  const wasmBinary = Module['wasmBinary']
  const wasmMemory =
    Module['wasmMemory'] ||
    new WebAssembly.Memory({
      initial: (Module['INITIAL_MEMORY'] || 134217728) / 65536,
      maximum: 32768,
    })
  let ABORT = false
  let EXITSTATUS
  let {
    HEAP8,
    HEAPU8,
    HEAP16,
    HEAPU16,
    HEAP32,
    HEAPU32,
    HEAP64,
    HEAPU64,
    HEAPF32,
    HEAPF64,
  } = createMemoryViews(wasmMemory)
  Object.assign(Module, { HEAP8, HEAPU8 })
  const refreshMemoryViews = () => {
    const views = createMemoryViews(wasmMemory)
    HEAP8 = views.HEAP8
    HEAPU8 = views.HEAPU8
    HEAP16 = views.HEAP16
    HEAPU16 = views.HEAPU16
    HEAP32 = views.HEAP32
    HEAPU32 = views.HEAPU32
    HEAP64 = views.HEAP64
    HEAPU64 = views.HEAPU64
    HEAPF32 = views.HEAPF32
    HEAPF64 = views.HEAPF64
    Object.assign(Module, { HEAP8, HEAPU8 })
  }
  const __ATPRERUN__ = []
  const __ATINIT__ = []
  const __ATMAIN__ = []
  const __ATEXIT__ = []
  const __ATPOSTRUN__ = []
  const __RELOC_FUNCS__ = []
  let runtimeInitialized = false
  let runtimeExited = false
  function preRun() {
    if (Module['preRun']) {
      if (typeof Module['preRun'] == 'function')
        Module['preRun'] = [Module['preRun']]
      while (Module['preRun'].length) {
        __ATPRERUN__.unshift(Module['preRun'].shift())
      }
    }
    callRuntimeCallbacks(__ATPRERUN__, Module)
  }
  function initRuntime() {
    runtimeInitialized = true
    callRuntimeCallbacks(__RELOC_FUNCS__, Module)
    if (!Module['noFSInit'] && !FS.initialized) FS.init()
    FS.ignorePermissions = false
    TTY.init()
    PIPEFS.root = FS.mount(PIPEFS, {}, null)
    callRuntimeCallbacks(__ATINIT__, Module)
  }
  function preMain() {
    callRuntimeCallbacks(__ATMAIN__, Module)
  }
  function exitRuntime() {
    ___funcs_on_exit()
    callRuntimeCallbacks(__ATEXIT__, Module)
    FS.quit()
    TTY.shutdown()
    runtimeExited = true
  }
  function postRun() {
    if (Module['postRun']) {
      if (typeof Module['postRun'] == 'function')
        Module['postRun'] = [Module['postRun']]
      while (Module['postRun'].length) {
        __ATPOSTRUN__.unshift(Module['postRun'].shift())
      }
    }
    callRuntimeCallbacks(__ATPOSTRUN__, Module)
  }
  const {
    addRunDependency,
    removeRunDependency,
    getUniqueRunDependency,
    getRunDependencies,
    setDependenciesFulfilled,
  } = createRunDependencyManager(Module)
  function abort(what) {
    Module['onAbort']?.(what)
    what = 'Aborted(' + what + ')'
    err(what)
    ABORT = true
    what += '. Build with -sASSERTIONS for more info.'
    throw new WebAssembly.RuntimeError(what)
  }
  const wasmBinaryFile = new URL('../release/pglite.wasm', import.meta.url)
  async function createWasm() {
    addRunDependency('wasm-instantiate')
    const info = getWasmImports(wasmImports, GOTHandler)
    const result = await instantiateNodeWasm(
      wasmBinary,
      wasmBinaryFile,
      info,
      (reason) => {
        err(`failed to prepare wasm: ${reason}`)
        return abort(reason)
      },
    )

    wasmExports = relocateExports(result.instance.exports, 1024)
    const metadata = getDylinkMetadata(result.module)
    dynamicLibraries = metadata.neededDynlibs.concat(dynamicLibraries)
    mergeLibSymbols(wasmExports)
    LDSO.init()
    await loadDylibs()
    __ATINIT__.unshift(wasmExports['__wasm_call_ctors'])
    __RELOC_FUNCS__.push(wasmExports['__wasm_apply_data_relocs'])
    removeRunDependency('wasm-instantiate')

    return result
  }
  const ASM_CONSTS = {}
  const GOT = {}
  let currentModuleWeakSymbols = new Set([])
  const GOTHandler = {
    get(obj, symName) {
      let rtn = GOT[symName]
      if (!rtn) {
        rtn = GOT[symName] = new WebAssembly.Global({
          value: 'i32',
          mutable: true,
        })
      }
      if (!currentModuleWeakSymbols.has(symName)) {
        rtn.required = true
      }
      return rtn
    },
  }
  const newDSO = (name, handle, syms) => {
    const dso = { refcount: Infinity, name, exports: syms, global: true }
    LDSO.loadedLibsByName[name] = dso
    if (handle != undefined) {
      LDSO.loadedLibsByHandle[handle] = dso
    }
    return dso
  }
  const LDSO = {
    loadedLibsByName: {},
    loadedLibsByHandle: {},
    init() {
      newDSO('__main__', 0, wasmImports)
    },
  }
  let ___heap_base = 11373728
  const getMemory = (size) => {
    if (runtimeInitialized) {
      return _calloc(size, 1)
    }
    const ret = ___heap_base
    const end = ret + Math.ceil(size / 16) * 16
    ___heap_base = end
    GOT['__heap_base'].value = end
    return ret
  }
  const wasmTableMirror = []
  const wasmTable = new WebAssembly.Table({
    initial: 7367,
    element: 'anyfunc',
  })
  const { getWasmTableEntry, setWasmTableEntry } = createWasmTableHelpers(
    wasmTable,
    wasmTableMirror,
  )
  const updateTableMap = (offset, count) => {
    if (functionsInTableMap) {
      for (let i = offset; i < offset + count; i++) {
        const item = getWasmTableEntry(i)
        if (item) {
          functionsInTableMap.set(item, i)
        }
      }
    }
  }
  let functionsInTableMap
  const getFunctionAddress = (func) => {
    if (!functionsInTableMap) {
      functionsInTableMap = new WeakMap()
      updateTableMap(0, wasmTable.length)
    }
    return functionsInTableMap.get(func) || 0
  }
  const freeTableIndexes = []
  const getEmptyTableSlot = () => {
    if (freeTableIndexes.length) {
      return freeTableIndexes.pop()
    }
    try {
      wasmTable.grow(1)
    } catch (err) {
      if (!(err instanceof RangeError)) {
        throw err
      }
      throw 'Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.'
    }
    return wasmTable.length - 1
  }
  const addFunction = (func, sig) => {
    const rtn = getFunctionAddress(func)
    if (rtn) {
      return rtn
    }
    const ret = getEmptyTableSlot()
    try {
      setWasmTableEntry(ret, func)
    } catch (err) {
      if (!(err instanceof TypeError)) {
        throw err
      }
      const wrapped = convertJsFunctionToWasm(func, sig)
      setWasmTableEntry(ret, wrapped)
    }
    functionsInTableMap.set(func, ret)
    return ret
  }
  const updateGOT = (exports, replace) => {
    for (const symName in exports) {
      if (isInternalSym(symName)) {
        continue
      }
      const value = exports[symName]
      GOT[symName] ||= new WebAssembly.Global({ value: 'i32', mutable: true })
      if (replace || GOT[symName].value == 0) {
        if (typeof value == 'function') {
          GOT[symName].value = addFunction(value)
        } else if (typeof value == 'number') {
          GOT[symName].value = value
        } else {
          err(`unhandled export type for '${symName}': ${typeof value}`)
        }
      }
    }
  }
  const relocateExports = (exports, memoryBase, replace) => {
    const relocated = {}
    for (const e in exports) {
      let value = exports[e]
      if (typeof value == 'object') {
        value = value.value
      }
      if (typeof value == 'number') {
        value += memoryBase
      }
      relocated[e] = value
    }
    updateGOT(relocated, replace)
    return relocated
  }
  const isSymbolDefined = (symName) => {
    const existing = wasmImports[symName]
    if (!existing || existing.stub) {
      return false
    }
    return true
  }
  const dynCall = (sig, ptr, args = []) => {
    const rtn = getWasmTableEntry(ptr)(...args)
    return rtn
  }
  const stackSave = () => _emscripten_stack_get_current()
  const stackRestore = (val) => __emscripten_stack_restore(val)
  const createInvokeFunction =
    (sig) =>
    (ptr, ...args) => {
      const sp = stackSave()
      try {
        return dynCall(sig, ptr, args)
      } catch (e) {
        stackRestore(sp)
        if (e !== e + 0) throw e
        _setThrew(1, 0)
        if (sig[0] == 'j') return 0n
      }
    }
  const resolveGlobalSymbol = (symName, direct = false) => {
    let sym
    if (isSymbolDefined(symName)) {
      sym = wasmImports[symName]
    } else if (symName.startsWith('invoke_')) {
      sym = wasmImports[symName] = createInvokeFunction(symName.split('_')[1])
    }
    return { sym, name: symName }
  }
  const UTF8ToString = (ptr, maxBytesToRead) =>
    ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : ''
  const loadWebAssemblyModule = (
    binary,
    flags,
    libName,
    localScope,
    handle,
  ) => {
    const metadata = getDylinkMetadata(binary)
    currentModuleWeakSymbols = metadata.weakImports
    function loadModule() {
      const firstLoad = !handle || !HEAP8[handle + 8]
      let memoryBase
      let tableBase
      if (firstLoad) {
        const memAlign = Math.pow(2, metadata.memoryAlign)
        memoryBase = metadata.memorySize
          ? Math.ceil(getMemory(metadata.memorySize + memAlign) / memAlign) *
            memAlign
          : 0
        tableBase = metadata.tableSize ? wasmTable.length : 0
        if (handle) {
          HEAP8[handle + 8] = 1
          HEAPU32[(handle + 12) >> 2] = memoryBase
          HEAP32[(handle + 16) >> 2] = metadata.memorySize
          HEAPU32[(handle + 20) >> 2] = tableBase
          HEAP32[(handle + 24) >> 2] = metadata.tableSize
        }
      } else {
        memoryBase = HEAPU32[(handle + 12) >> 2]
        tableBase = HEAPU32[(handle + 20) >> 2]
      }
      const tableGrowthNeeded =
        tableBase + metadata.tableSize - wasmTable.length
      if (tableGrowthNeeded > 0) {
        wasmTable.grow(tableGrowthNeeded)
      }
      let moduleExports
      function resolveSymbol(sym) {
        let resolved = resolveGlobalSymbol(sym).sym
        if (!resolved && localScope) {
          resolved = localScope[sym]
        }
        if (!resolved) {
          resolved = moduleExports[sym]
        }
        return resolved
      }
      const proxyHandler = {
        get(stubs, prop) {
          switch (prop) {
            case '__memory_base':
              return memoryBase
            case '__table_base':
              return tableBase
          }
          if (prop in wasmImports && !wasmImports[prop].stub) {
            return wasmImports[prop]
          }
          if (!(prop in stubs)) {
            let resolved
            stubs[prop] = (...args) => {
              resolved ||= resolveSymbol(prop)
              return resolved(...args)
            }
          }
          return stubs[prop]
        },
      }
      const proxy = new Proxy({}, proxyHandler)
      const info = {
        'GOT.mem': new Proxy({}, GOTHandler),
        'GOT.func': new Proxy({}, GOTHandler),
        env: proxy,
        wasi_snapshot_preview1: proxy,
      }
      function postInstantiation(module, instance) {
        updateTableMap(tableBase, metadata.tableSize)
        moduleExports = relocateExports(instance.exports, memoryBase)
        if (!flags.allowUndefined) {
          reportUndefinedSymbols()
        }
        function addEmAsm(addr, body) {
          let args = []
          let arity = 0
          for (; arity < 16; arity++) {
            if (body.indexOf('$' + arity) != -1) {
              args.push('$' + arity)
            } else {
              break
            }
          }
          args = args.join(',')
          const func = `(${args}) => { ${body} };`
          ASM_CONSTS[start] = eval(func)
        }
        if ('__start_em_asm' in moduleExports) {
          let start = moduleExports['__start_em_asm']
          const stop = moduleExports['__stop_em_asm']
          while (start < stop) {
            let jsString = UTF8ToString(start)
            addEmAsm(start, jsString)
            start = HEAPU8.indexOf(0, start) + 1
          }
        }
        function addEmJs(name, cSig, body) {
          const jsArgs = []
          cSig = cSig.slice(1, -1)
          if (cSig != 'void') {
            cSig = cSig.split(',')
            for (const i in cSig) {
              const jsArg = cSig[i].split(' ').pop()
              jsArgs.push(jsArg.replace('*', ''))
            }
          }
          const func = `(${jsArgs}) => ${body};`
          moduleExports[name] = eval(func)
        }
        for (const name in moduleExports) {
          if (name.startsWith('__em_js__')) {
            let start = moduleExports[name]
            let jsString = UTF8ToString(start)
            const parts = jsString.split('<::>')
            addEmJs(name.replace('__em_js__', ''), parts[0], parts[1])
            delete moduleExports[name]
          }
        }
        const applyRelocs = moduleExports['__wasm_apply_data_relocs']
        if (applyRelocs) {
          if (runtimeInitialized) {
            applyRelocs()
          } else {
            __RELOC_FUNCS__.push(applyRelocs)
          }
        }
        const init = moduleExports['__wasm_call_ctors']
        if (init) {
          if (runtimeInitialized) {
            init()
          } else {
            __ATINIT__.push(init)
          }
        }
        return moduleExports
      }
      if (flags.loadAsync) {
        if (binary instanceof WebAssembly.Module) {
          let instance = new WebAssembly.Instance(binary, info)
          return Promise.resolve(postInstantiation(binary, instance))
        }
        return WebAssembly.instantiate(binary, info).then((result) =>
          postInstantiation(result.module, result.instance),
        )
      }
      const module =
        binary instanceof WebAssembly.Module
          ? binary
          : new WebAssembly.Module(binary)
      let instance = new WebAssembly.Instance(module, info)
      return postInstantiation(module, instance)
    }
    if (flags.loadAsync) {
      return metadata.neededDynlibs
        .reduce(
          (chain, dynNeeded) =>
            chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)),
          Promise.resolve(),
        )
        .then(loadModule)
    }
    metadata.neededDynlibs.forEach((needed) =>
      loadDynamicLibrary(needed, flags, localScope),
    )
    return loadModule()
  }
  const mergeLibSymbols = (exports) => {
    for (const [symbol, wasmExport] of Object.entries(exports)) {
      const setImport = (target) => {
        if (!isSymbolDefined(target)) {
          wasmImports[target] = wasmExport
        }
      }
      setImport(symbol)
      const mainAlias = '__main_argc_argv'
      if (symbol === 'main') {
        setImport(mainAlias)
      }
      if (symbol === mainAlias) {
        setImport('main')
      }
    }
  }
  const asyncLoad = async (url) =>
    new Uint8Array(
      fs.readFileSync(url instanceof URL ? url : new URL(url, import.meta.url)),
    )
  const preloadPlugins = Module['preloadPlugins'] || []
  const registerWasmPlugin = () => {
    const wasmPlugin = {
      promiseChainEnd: Promise.resolve(),
      canHandle: (name) => !Module['noWasmDecoding'] && name.endsWith('.so'),
      handle: (byteArray, name, onload, onerror) => {
        wasmPlugin['promiseChainEnd'] = wasmPlugin['promiseChainEnd']
          .then(() =>
            loadWebAssemblyModule(
              byteArray,
              { loadAsync: true, nodelete: true },
              name,
              {},
            ),
          )
          .then(
            (exports) => {
              preloadedWasm[name] = exports
              onload(byteArray)
            },
            (error) => {
              err(`failed to instantiate wasm: ${name}: ${error}`)
              onerror()
            },
          )
      },
    }
    preloadPlugins.push(wasmPlugin)
  }
  const preloadedWasm = {}
  function loadDynamicLibrary(
    libName,
    flags = { global: true, nodelete: true },
    localScope,
    handle,
  ) {
    let dso = LDSO.loadedLibsByName[libName]
    if (dso) {
      if (!flags.global) {
        if (localScope) {
          Object.assign(localScope, dso.exports)
        }
      } else if (!dso.global) {
        dso.global = true
        mergeLibSymbols(dso.exports)
      }
      if (flags.nodelete && dso.refcount !== Infinity) {
        dso.refcount = Infinity
      }
      dso.refcount++
      if (handle) {
        LDSO.loadedLibsByHandle[handle] = dso
      }
      return flags.loadAsync ? Promise.resolve(true) : true
    }
    dso = newDSO(libName, handle, 'loading')
    dso.refcount = flags.nodelete ? Infinity : 1
    dso.global = flags.global
    function loadLibData() {
      if (handle) {
        const data = HEAPU32[(handle + 28) >> 2]
        const dataSize = HEAPU32[(handle + 32) >> 2]
        if (data && dataSize) {
          const libData = HEAP8.slice(data, data + dataSize)
          return flags.loadAsync ? Promise.resolve(libData) : libData
        }
      }
      const libFile = locateFile(libName)
      if (flags.loadAsync) {
        return asyncLoad(libFile)
      }
      return new Uint8Array(
        fs.readFileSync(
          libFile instanceof URL ? libFile : new URL(libFile, import.meta.url),
        ),
      )
    }
    function getExports() {
      const preloaded = preloadedWasm[libName]
      if (preloaded) {
        return flags.loadAsync ? Promise.resolve(preloaded) : preloaded
      }
      if (flags.loadAsync) {
        return loadLibData().then((libData) =>
          loadWebAssemblyModule(libData, flags, libName, localScope, handle),
        )
      }
      return loadWebAssemblyModule(
        loadLibData(),
        flags,
        libName,
        localScope,
        handle,
      )
    }
    function moduleLoaded(exports) {
      if (dso.global) {
        mergeLibSymbols(exports)
      } else if (localScope) {
        Object.assign(localScope, exports)
      }
      dso.exports = exports
    }
    if (flags.loadAsync) {
      return getExports().then((exports) => {
        moduleLoaded(exports)
        return true
      })
    }
    moduleLoaded(getExports())
    return true
  }
  const reportUndefinedSymbols = () => {
    for (const [symName, entry] of Object.entries(GOT)) {
      if (entry.value == 0) {
        const value = resolveGlobalSymbol(symName, true).sym
        if (!value && !entry.required) {
          continue
        }
        if (typeof value == 'function') {
          entry.value = addFunction(value, value.sig)
        } else if (typeof value == 'number') {
          entry.value = value
        } else {
          throw new Error(`bad export type for '${symName}': ${typeof value}`)
        }
      }
    }
  }
  const loadDylibs = async () => {
    if (!dynamicLibraries.length) {
      reportUndefinedSymbols()
      return
    }
    addRunDependency('loadDylibs')
    for (const lib of dynamicLibraries) {
      await loadDynamicLibrary(lib, {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: true,
      })
    }
    reportUndefinedSymbols()
    removeRunDependency('loadDylibs')
  }
  let noExitRuntime = Module['noExitRuntime'] || false
  const ___assert_fail = (condition, filename, line, func) =>
    abort(
      `Assertion failed: ${UTF8ToString(condition)}, at: ` +
        [
          filename ? UTF8ToString(filename) : 'unknown filename',
          line,
          func ? UTF8ToString(func) : 'unknown function',
        ],
    )
  ___assert_fail.sig = 'vppip'
  const ___call_sighandler = (fp, sig) => getWasmTableEntry(fp)(sig)
  ___call_sighandler.sig = 'vpi'
  const ___memory_base = new WebAssembly.Global(
    { value: 'i32', mutable: false },
    1024,
  )
  const ___stack_pointer = new WebAssembly.Global(
    { value: 'i32', mutable: true },
    11373728,
  )
  const PATH_FS = createPathFS(() => FS.cwd())
  const PIPEFS = {
    BUCKET_BUFFER_SIZE: 8192,
    mount(mount) {
      return FS.createNode(null, '/', 16384 | 511, 0)
    },
    createPipe() {
      const pipe = { buckets: [], refcnt: 2 }
      pipe.buckets.push({
        buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
        offset: 0,
        roffset: 0,
      })
      const rName = PIPEFS.nextname()
      const wName = PIPEFS.nextname()
      const rNode = FS.createNode(PIPEFS.root, rName, 4096, 0)
      const wNode = FS.createNode(PIPEFS.root, wName, 4096, 0)
      rNode.pipe = pipe
      wNode.pipe = pipe
      const readableStream = FS.createStream({
        path: rName,
        node: rNode,
        flags: 0,
        seekable: false,
        stream_ops: PIPEFS.stream_ops,
      })
      rNode.stream = readableStream
      const writableStream = FS.createStream({
        path: wName,
        node: wNode,
        flags: 1,
        seekable: false,
        stream_ops: PIPEFS.stream_ops,
      })
      wNode.stream = writableStream
      return {
        readable_fd: readableStream.fd,
        writable_fd: writableStream.fd,
      }
    },
    stream_ops: {
      poll(stream) {
        const pipe = stream.node.pipe
        if ((stream.flags & 2097155) === 1) {
          return 256 | 4
        }
        if (pipe.buckets.length > 0) {
          for (let i = 0; i < pipe.buckets.length; i++) {
            const bucket = pipe.buckets[i]
            if (bucket.offset - bucket.roffset > 0) {
              return 64 | 1
            }
          }
        }
        return 0
      },
      ioctl(stream, request, varargs) {
        return 28
      },
      fsync(stream) {
        return 28
      },
      read(stream, buffer, offset, length, position) {
        const pipe = stream.node.pipe
        let currentLength = 0
        for (let i = 0; i < pipe.buckets.length; i++) {
          const bucket = pipe.buckets[i]
          currentLength += bucket.offset - bucket.roffset
        }
        let data = buffer.subarray(offset, offset + length)
        if (length <= 0) {
          return 0
        }
        if (currentLength == 0) {
          throw new FS.ErrnoError(6)
        }
        let toRead = Math.min(currentLength, length)
        const totalRead = toRead
        let toRemove = 0
        for (let i = 0; i < pipe.buckets.length; i++) {
          const currBucket = pipe.buckets[i]
          const bucketSize = currBucket.offset - currBucket.roffset
          if (toRead <= bucketSize) {
            let tmpSlice = currBucket.buffer.subarray(
              currBucket.roffset,
              currBucket.offset,
            )
            if (toRead < bucketSize) {
              tmpSlice = tmpSlice.subarray(0, toRead)
              currBucket.roffset += toRead
            } else {
              toRemove++
            }
            data.set(tmpSlice)
            break
          } else {
            let tmpSlice = currBucket.buffer.subarray(
              currBucket.roffset,
              currBucket.offset,
            )
            data.set(tmpSlice)
            data = data.subarray(tmpSlice.byteLength)
            toRead -= tmpSlice.byteLength
            toRemove++
          }
        }
        if (toRemove && toRemove == pipe.buckets.length) {
          toRemove--
          pipe.buckets[toRemove].offset = 0
          pipe.buckets[toRemove].roffset = 0
        }
        pipe.buckets.splice(0, toRemove)
        return totalRead
      },
      write(stream, buffer, offset, length, position) {
        const pipe = stream.node.pipe
        let data = buffer.subarray(offset, offset + length)
        const dataLen = data.byteLength
        if (dataLen <= 0) {
          return 0
        }
        let currBucket = null
        if (pipe.buckets.length == 0) {
          currBucket = {
            buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
            offset: 0,
            roffset: 0,
          }
          pipe.buckets.push(currBucket)
        } else {
          currBucket = pipe.buckets[pipe.buckets.length - 1]
        }
        if (currBucket.offset <= PIPEFS.BUCKET_BUFFER_SIZE) {
          abort()
        }
        const freeBytesInCurrBuffer =
          PIPEFS.BUCKET_BUFFER_SIZE - currBucket.offset
        if (freeBytesInCurrBuffer >= dataLen) {
          currBucket.buffer.set(data, currBucket.offset)
          currBucket.offset += dataLen
          return dataLen
        } else if (freeBytesInCurrBuffer > 0) {
          currBucket.buffer.set(
            data.subarray(0, freeBytesInCurrBuffer),
            currBucket.offset,
          )
          currBucket.offset += freeBytesInCurrBuffer
          data = data.subarray(freeBytesInCurrBuffer, data.byteLength)
        }
        const numBuckets = (data.byteLength / PIPEFS.BUCKET_BUFFER_SIZE) | 0
        const remElements = data.byteLength % PIPEFS.BUCKET_BUFFER_SIZE
        for (let i = 0; i < numBuckets; i++) {
          let newBucket = {
            buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
            offset: PIPEFS.BUCKET_BUFFER_SIZE,
            roffset: 0,
          }
          pipe.buckets.push(newBucket)
          newBucket.buffer.set(data.subarray(0, PIPEFS.BUCKET_BUFFER_SIZE))
          data = data.subarray(PIPEFS.BUCKET_BUFFER_SIZE, data.byteLength)
        }
        if (remElements > 0) {
          let newBucket = {
            buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
            offset: data.byteLength,
            roffset: 0,
          }
          pipe.buckets.push(newBucket)
          newBucket.buffer.set(data)
        }
        return dataLen
      },
      close(stream) {
        const pipe = stream.node.pipe
        pipe.refcnt--
        if (pipe.refcnt === 0) {
          pipe.buckets = null
        }
      },
    },
    nextname() {
      if (!PIPEFS.nextname.current) {
        PIPEFS.nextname.current = 0
      }
      return 'pipe[' + PIPEFS.nextname.current++ + ']'
    },
  }
  function ___syscall_pipe(fdPtr) {
    try {
      if (fdPtr == 0) {
        throw new FS.ErrnoError(21)
      }
      const res = PIPEFS.createPipe()
      HEAP32[fdPtr >> 2] = res.readable_fd
      HEAP32[(fdPtr + 4) >> 2] = res.writable_fd
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_pipe.sig = 'ip'
  function ___syscall_readlinkat(dirfd, path, buf, bufsize) {
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      if (bufsize <= 0) return -28
      const ret = FS.readlink(path)
      const len = Math.min(bufsize, lengthBytesUTF8(ret))
      const endChar = HEAP8[buf + len]
      stringToUTF8Array(ret, HEAPU8, buf, bufsize + 1)
      HEAP8[buf + len] = endChar
      return len
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_readlinkat.sig = 'iippp'
  function ___syscall_recvfrom(fd, buf, len, flags, addr, addrlen) {
    return -138
  }
  ___syscall_recvfrom.sig = 'iippipp'
  function ___syscall_renameat(olddirfd, oldpath, newdirfd, newpath) {
    try {
      oldpath = SYSCALLS.getStr(oldpath)
      newpath = SYSCALLS.getStr(newpath)
      oldpath = SYSCALLS.calculateAt(olddirfd, oldpath)
      newpath = SYSCALLS.calculateAt(newdirfd, newpath)
      FS.rename(oldpath, newpath)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_renameat.sig = 'iipip'
  function ___syscall_rmdir(path) {
    try {
      path = SYSCALLS.getStr(path)
      FS.rmdir(path)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_rmdir.sig = 'ip'
  function ___syscall_sendto(fd, message, length, flags, addr, addr_len) {
    return -138
  }
  ___syscall_sendto.sig = 'iippipp'
  function ___syscall_socket(domain, type, protocol) {
    return -138
  }
  ___syscall_socket.sig = 'iiiiiii'
  function ___syscall_stat64(path, buf) {
    try {
      path = SYSCALLS.getStr(path)
      return SYSCALLS.doStat(FS.stat, path, buf)
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_stat64.sig = 'ipp'
  function ___syscall_statfs64(path, size, buf) {
    try {
      const stats = FS.statfs(SYSCALLS.getStr(path))
      HEAP32[(buf + 4) >> 2] = stats.bsize
      HEAP32[(buf + 40) >> 2] = stats.bsize
      HEAP32[(buf + 8) >> 2] = stats.blocks
      HEAP32[(buf + 12) >> 2] = stats.bfree
      HEAP32[(buf + 16) >> 2] = stats.bavail
      HEAP32[(buf + 20) >> 2] = stats.files
      HEAP32[(buf + 24) >> 2] = stats.ffree
      HEAP32[(buf + 28) >> 2] = stats.fsid
      HEAP32[(buf + 44) >> 2] = stats.flags
      HEAP32[(buf + 36) >> 2] = stats.namelen
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_statfs64.sig = 'ippp'
  function ___syscall_symlinkat(target, dirfd, linkpath) {
    try {
      target = SYSCALLS.getStr(target)
      linkpath = SYSCALLS.getStr(linkpath)
      linkpath = SYSCALLS.calculateAt(dirfd, linkpath)
      FS.symlink(target, linkpath)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_symlinkat.sig = 'ipip'
  function ___syscall_truncate64(path, length) {
    length = bigintToI53Checked(length)
    try {
      if (isNaN(length)) return 61
      path = SYSCALLS.getStr(path)
      FS.truncate(path, length)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_truncate64.sig = 'ipj'
  function ___syscall_unlinkat(dirfd, path, flags) {
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      if (flags === 0) {
        FS.unlink(path)
      } else if (flags === 512) {
        FS.rmdir(path)
      } else {
        abort('Invalid flags passed to unlinkat')
      }
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_unlinkat.sig = 'iipi'
  const readI53FromI64 = (ptr) =>
    HEAPU32[ptr >> 2] + HEAP32[(ptr + 4) >> 2] * 4294967296
  function ___syscall_utimensat(dirfd, path, times, flags) {
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path, true)
      let now = Date.now(),
        atime,
        mtime
      if (!times) {
        atime = now
        mtime = now
      } else {
        let seconds = readI53FromI64(times)
        let nanoseconds = HEAP32[(times + 8) >> 2]
        if (nanoseconds == 1073741823) {
          atime = now
        } else if (nanoseconds == 1073741822) {
          atime = null
        } else {
          atime = seconds * 1e3 + nanoseconds / (1e3 * 1e3)
        }
        times += 16
        seconds = readI53FromI64(times)
        nanoseconds = HEAP32[(times + 8) >> 2]
        if (nanoseconds == 1073741823) {
          mtime = now
        } else if (nanoseconds == 1073741822) {
          mtime = null
        } else {
          mtime = seconds * 1e3 + nanoseconds / (1e3 * 1e3)
        }
      }
      if ((mtime ?? atime) !== null) {
        FS.utime(path, atime, mtime)
      }
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_utimensat.sig = 'iippi'
  const ___table_base = new WebAssembly.Global(
    { value: 'i32', mutable: false },
    1,
  )
  const __abort_js = () => abort('')
  __abort_js.sig = 'v'
  const ENV = {}
  const stackAlloc = (sz) => __emscripten_stack_alloc(sz)
  const stringToUTF8OnStack = (str) => {
    return stringToUTF8OnStackCommon(str, stackAlloc, HEAPU8)
  }
  const dlSetError = (msg) => {
    const sp = stackSave()
    const cmsg = stringToUTF8OnStack(msg)
    ___dl_seterr(cmsg, 0)
    stackRestore(sp)
  }
  const dlopenInternal = (handle, jsflags) => {
    let filename = UTF8ToString(handle + 36)
    const flags = HEAP32[(handle + 4) >> 2]
    filename = PATH.normalize(filename)
    const global = Boolean(flags & 256)
    const localScope = global ? null : {}
    const combinedFlags = {
      global,
      nodelete: Boolean(flags & 4096),
      loadAsync: jsflags.loadAsync,
    }
    if (jsflags.loadAsync) {
      return loadDynamicLibrary(filename, combinedFlags, localScope, handle)
    }
    try {
      return loadDynamicLibrary(filename, combinedFlags, localScope, handle)
    } catch (e) {
      dlSetError(`Could not load dynamic lib: ${filename}\n${e}`)
      return 0
    }
  }
  const __dlopen_js = (handle) => dlopenInternal(handle, { loadAsync: false })
  __dlopen_js.sig = 'pp'
  const __dlsym_js = (handle, symbol, symbolIndex) => {
    symbol = UTF8ToString(symbol)
    let result
    let newSymIndex
    const lib = LDSO.loadedLibsByHandle[handle]
    if (!lib.exports.hasOwnProperty(symbol) || lib.exports[symbol].stub) {
      dlSetError(
        `Tried to lookup unknown symbol "${symbol}" in dynamic lib: ${lib.name}`,
      )
      return 0
    }
    newSymIndex = Object.keys(lib.exports).indexOf(symbol)
    result = lib.exports[symbol]
    if (typeof result == 'function') {
      const addr = getFunctionAddress(result)
      if (addr) {
        result = addr
      } else {
        result = addFunction(result, result.sig)
        HEAPU32[symbolIndex >> 2] = newSymIndex
      }
    }
    return result
  }
  __dlsym_js.sig = 'pppp'
  let runtimeKeepaliveCounter = 0
  const __emscripten_runtime_keepalive_clear = () => {
    noExitRuntime = false
    runtimeKeepaliveCounter = 0
  }
  __emscripten_runtime_keepalive_clear.sig = 'v'
  const __emscripten_throw_longjmp = () => {
    throw Infinity
  }
  __emscripten_throw_longjmp.sig = 'v'
  function __gmtime_js(time, tmPtr) {
    time = bigintToI53Checked(time)
    const date = new Date(time * 1e3)
    HEAP32[tmPtr >> 2] = date.getUTCSeconds()
    HEAP32[(tmPtr + 4) >> 2] = date.getUTCMinutes()
    HEAP32[(tmPtr + 8) >> 2] = date.getUTCHours()
    HEAP32[(tmPtr + 12) >> 2] = date.getUTCDate()
    HEAP32[(tmPtr + 16) >> 2] = date.getUTCMonth()
    HEAP32[(tmPtr + 20) >> 2] = date.getUTCFullYear() - 1900
    HEAP32[(tmPtr + 24) >> 2] = date.getUTCDay()
    const start = Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0)
    const yday = ((date.getTime() - start) / (1e3 * 60 * 60 * 24)) | 0
    HEAP32[(tmPtr + 28) >> 2] = yday
  }
  __gmtime_js.sig = 'vjp'
  const MONTH_DAYS_LEAP_CUMULATIVE = [
    0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335,
  ]
  const MONTH_DAYS_REGULAR_CUMULATIVE = [
    0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
  ]
  function __localtime_js(time, tmPtr) {
    time = bigintToI53Checked(time)
    const date = new Date(time * 1e3)
    HEAP32[tmPtr >> 2] = date.getSeconds()
    HEAP32[(tmPtr + 4) >> 2] = date.getMinutes()
    HEAP32[(tmPtr + 8) >> 2] = date.getHours()
    HEAP32[(tmPtr + 12) >> 2] = date.getDate()
    HEAP32[(tmPtr + 16) >> 2] = date.getMonth()
    HEAP32[(tmPtr + 20) >> 2] = date.getFullYear() - 1900
    HEAP32[(tmPtr + 24) >> 2] = date.getDay()
    const yday =
      ydayFromDateCommon(
        date,
        MONTH_DAYS_LEAP_CUMULATIVE,
        MONTH_DAYS_REGULAR_CUMULATIVE,
      ) | 0
    HEAP32[(tmPtr + 28) >> 2] = yday
    HEAP32[(tmPtr + 36) >> 2] = -(date.getTimezoneOffset() * 60)
    const start = new Date(date.getFullYear(), 0, 1)
    const summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset()
    const winterOffset = start.getTimezoneOffset()
    const dst =
      (summerOffset != winterOffset &&
        date.getTimezoneOffset() == Math.min(winterOffset, summerOffset)) | 0
    HEAP32[(tmPtr + 32) >> 2] = dst
  }
  __localtime_js.sig = 'vjp'
  function __mmap_js(len, prot, flags, fd, offset, allocated, addr) {
    offset = bigintToI53Checked(offset)
    try {
      if (isNaN(offset)) return 61
      const stream = SYSCALLS.getStreamFromFD(fd)
      const res = FS.mmap(stream, len, offset, prot, flags)
      const ptr = res.ptr
      HEAP32[allocated >> 2] = res.allocated
      HEAPU32[addr >> 2] = ptr
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  __mmap_js.sig = 'ipiiijpp'
  function __munmap_js(addr, len, prot, flags, fd, offset) {
    offset = bigintToI53Checked(offset)
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      if (prot & 2) {
        SYSCALLS.doMsync(addr, stream, len, flags, offset)
      }
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  __munmap_js.sig = 'ippiiij'
  const timers = {}
  const handleException = (e) => {
    if (e instanceof ExitStatus || e == 'unwind') {
      return EXITSTATUS
    }
    throw e
  }
  const keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0
  const _proc_exit = (code) => {
    EXITSTATUS = code
    if (!keepRuntimeAlive()) {
      Module['onExit']?.(code)
      ABORT = true
    }
    throw new ExitStatus(code)
  }
  _proc_exit.sig = 'vi'
  const exitJS = (status, implicit) => {
    EXITSTATUS = status
    if (!keepRuntimeAlive()) {
      exitRuntime()
    }
    _proc_exit(status)
  }
  const _exit = exitJS
  _exit.sig = 'vi'
  const maybeExit = () => {
    if (runtimeExited) {
      return
    }
    if (!keepRuntimeAlive()) {
      try {
        _exit(EXITSTATUS)
      } catch (e) {
        handleException(e)
      }
    }
  }
  const callUserCallback = (func) => {
    if (runtimeExited || ABORT) {
      return
    }
    try {
      func()
      maybeExit()
    } catch (e) {
      handleException(e)
    }
  }
  const _emscripten_get_now = () => performance.now()
  _emscripten_get_now.sig = 'd'
  const __setitimer_js = (which, timeout_ms) => {
    if (timers[which]) {
      clearTimeout(timers[which].id)
      delete timers[which]
    }
    if (!timeout_ms) return 0
    const id = setTimeout(() => {
      delete timers[which]
      callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()))
    }, timeout_ms)
    timers[which] = { id, timeout_ms }
    return 0
  }
  __setitimer_js.sig = 'iid'
  const __tzset_js = (timezone, daylight, std_name, dst_name) => {
    const currentYear = new Date().getFullYear()
    const winter = new Date(currentYear, 0, 1)
    const summer = new Date(currentYear, 6, 1)
    const winterOffset = winter.getTimezoneOffset()
    const summerOffset = summer.getTimezoneOffset()
    const stdTimezoneOffset = Math.max(winterOffset, summerOffset)
    HEAPU32[timezone >> 2] = stdTimezoneOffset * 60
    HEAP32[daylight >> 2] = Number(winterOffset != summerOffset)
    const extractZone = (timezoneOffset) => {
      const sign = timezoneOffset >= 0 ? '-' : '+'
      const absOffset = Math.abs(timezoneOffset)
      const hours = String(Math.floor(absOffset / 60)).padStart(2, '0')
      const minutes = String(absOffset % 60).padStart(2, '0')
      return `UTC${sign}${hours}${minutes}`
    }
    const winterName = extractZone(winterOffset)
    const summerName = extractZone(summerOffset)
    if (summerOffset < winterOffset) {
      stringToUTF8Array(winterName, HEAPU8, std_name, 17)
      stringToUTF8Array(summerName, HEAPU8, dst_name, 17)
    } else {
      stringToUTF8Array(winterName, HEAPU8, dst_name, 17)
      stringToUTF8Array(summerName, HEAPU8, std_name, 17)
    }
  }
  __tzset_js.sig = 'vpppp'
  const _emscripten_date_now = () => Date.now()
  _emscripten_date_now.sig = 'd'
  const nowIsMonotonic = 1
  const checkWasiClock = (clock_id) => clock_id >= 0 && clock_id <= 3
  function _clock_time_get(clk_id, ignored_precision, ptime) {
    ignored_precision = bigintToI53Checked(ignored_precision)
    if (!checkWasiClock(clk_id)) {
      return 28
    }
    let now
    if (clk_id === 0) {
      now = _emscripten_date_now()
    } else if (nowIsMonotonic) {
      now = _emscripten_get_now()
    } else {
      return 52
    }
    const nsec = Math.round(now * 1e3 * 1e3)
    HEAP64[ptime >> 3] = BigInt(nsec)
    return 0
  }
  _clock_time_get.sig = 'iijp'
  const _emscripten_get_heap_max = () => HEAP_MAX
  _emscripten_get_heap_max.sig = 'p'
  const growMemory = (size) => {
    const b = wasmMemory.buffer
    const pages = ((size - b.byteLength + 65535) / 65536) | 0
    try {
      wasmMemory.grow(pages)
      refreshMemoryViews()
      return 1
    } catch (e) {}
  }
  const _emscripten_resize_heap = (requestedSize) => {
    const oldSize = HEAPU8.length
    requestedSize >>>= 0
    if (requestedSize > HEAP_MAX) {
      return false
    }
    for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
      let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown)
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296)
      const newSize = Math.min(
        HEAP_MAX,
        Math.ceil(Math.max(requestedSize, overGrownHeapSize) / 65536) * 65536,
      )
      const replacement = growMemory(newSize)
      if (replacement) {
        return true
      }
    }
    return false
  }
  _emscripten_resize_heap.sig = 'ip'
  const getExecutableName = () => thisProgram || './this.program'
  const getEnvStrings = () => {
    if (!getEnvStrings.strings) {
      const lang = 'C'.replace('-', '_') + '.UTF-8'
      const env = {
        USER: 'web_user',
        LOGNAME: 'web_user',
        PATH: '/',
        PWD: '/',
        HOME: '/home/web_user',
        LANG: lang,
        _: getExecutableName(),
      }
      for (let x in ENV) {
        if (ENV[x] === undefined) delete env[x]
        else env[x] = ENV[x]
      }
      const strings = []
      for (let x in env) {
        strings.push(`${x}=${env[x]}`)
      }
      getEnvStrings.strings = strings
    }
    return getEnvStrings.strings
  }
  const _environ_get = (__environ, environ_buf) => {
    let bufSize = 0
    getEnvStrings().forEach((string, i) => {
      const ptr = environ_buf + bufSize
      HEAPU32[(__environ + i * 4) >> 2] = ptr
      stringToAscii(string, ptr, HEAP8)
      bufSize += string.length + 1
    })
    return 0
  }
  _environ_get.sig = 'ipp'
  const _environ_sizes_get = (penviron_count, penviron_buf_size) => {
    const strings = getEnvStrings()
    HEAPU32[penviron_count >> 2] = strings.length
    let bufSize = 0
    strings.forEach((string) => (bufSize += string.length + 1))
    HEAPU32[penviron_buf_size >> 2] = bufSize
    return 0
  }
  _environ_sizes_get.sig = 'ipp'
  function _fd_close(fd) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      FS.close(stream)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_close.sig = 'ii'
  function _fd_fdstat_get(fd, pbuf) {
    try {
      const rightsBase = 0
      const rightsInheriting = 0
      const flags = 0
      const stream = SYSCALLS.getStreamFromFD(fd)
      const type = stream.tty
        ? 2
        : FS.isDir(stream.mode)
          ? 3
          : FS.isLink(stream.mode)
            ? 7
            : 4
      HEAP8[pbuf] = type
      HEAP16[(pbuf + 2) >> 1] = flags
      HEAP64[(pbuf + 8) >> 3] = BigInt(rightsBase)
      HEAP64[(pbuf + 16) >> 3] = BigInt(rightsInheriting)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_fdstat_get.sig = 'iip'
  const doReadv = (stream, iov, iovcnt, offset) => {
    let ret = 0
    for (let i = 0; i < iovcnt; i++) {
      const ptr = HEAPU32[iov >> 2]
      const len = HEAPU32[(iov + 4) >> 2]
      iov += 8
      const curr = FS.read(stream, HEAP8, ptr, len, offset)
      if (curr < 0) return -1
      ret += curr
      if (curr < len) break
      if (typeof offset != 'undefined') {
        offset += curr
      }
    }
    return ret
  }
  function _fd_pread(fd, iov, iovcnt, offset, pnum) {
    offset = bigintToI53Checked(offset)
    try {
      if (isNaN(offset)) return 61
      const stream = SYSCALLS.getStreamFromFD(fd)
      const num = doReadv(stream, iov, iovcnt, offset)
      HEAPU32[pnum >> 2] = num
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_pread.sig = 'iippjp'
  const doWritev = (stream, iov, iovcnt, offset) => {
    let ret = 0
    for (let i = 0; i < iovcnt; i++) {
      const ptr = HEAPU32[iov >> 2]
      const len = HEAPU32[(iov + 4) >> 2]
      iov += 8
      const curr = FS.write(stream, HEAP8, ptr, len, offset)
      if (curr < 0) return -1
      ret += curr
      if (curr < len) {
        break
      }
      if (typeof offset != 'undefined') {
        offset += curr
      }
    }
    return ret
  }
  function _fd_pwrite(fd, iov, iovcnt, offset, pnum) {
    offset = bigintToI53Checked(offset)
    try {
      if (isNaN(offset)) return 61
      const stream = SYSCALLS.getStreamFromFD(fd)
      const num = doWritev(stream, iov, iovcnt, offset)
      HEAPU32[pnum >> 2] = num
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_pwrite.sig = 'iippjp'
  function _fd_read(fd, iov, iovcnt, pnum) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      const num = doReadv(stream, iov, iovcnt)
      HEAPU32[pnum >> 2] = num
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_read.sig = 'iippp'
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset)
    try {
      if (isNaN(offset)) return 61
      const stream = SYSCALLS.getStreamFromFD(fd)
      FS.llseek(stream, offset, whence)
      HEAP64[newOffset >> 3] = BigInt(stream.position)
      if (stream.getdents && offset === 0 && whence === 0)
        stream.getdents = null
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_seek.sig = 'iijip'
  function _fd_sync(fd) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      if (stream.stream_ops?.fsync) {
        return stream.stream_ops.fsync(stream)
      }
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_sync.sig = 'ii'
  function _fd_write(fd, iov, iovcnt, pnum) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      const num = doWritev(stream, iov, iovcnt)
      HEAPU32[pnum >> 2] = num
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _fd_write.sig = 'iippp'
  const _getaddrinfo = (node, service, hint, out) => {
    let family = hint ? HEAP32[(hint + 4) >> 2] : 0
    let type = hint ? HEAP32[(hint + 8) >> 2] : 0
    let proto = hint ? HEAP32[(hint + 12) >> 2] : 0

    if (family === 0) family = 2
    if (family !== 2) return -6
    if (!type) type = 1
    if (!proto) proto = 6

    let port = 0
    if (service) {
      port = Number.parseInt(UTF8ToString(service), 10)
      if (!Number.isFinite(port)) return -8
    }

    let address = 0
    if (node) {
      let hostname = UTF8ToString(node)
      if (hostname === 'localhost') {
        hostname = '127.0.0.1'
      }
      const parts = hostname.split('.')
      if (parts.length !== 4) return -2
      const octets = parts.map((part) => Number.parseInt(part, 10))
      if (
        octets.some(
          (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
        )
      ) {
        return -2
      }
      address =
        octets[0] | (octets[1] << 8) | (octets[2] << 16) | (octets[3] << 24)
    }

    const sockaddr = _malloc(16)
    HEAP16[sockaddr >> 1] = 2
    HEAPU16[(sockaddr + 2) >> 1] = ((port & 255) << 8) | (port >> 8)
    HEAP32[(sockaddr + 4) >> 2] = address
    HEAP32[(sockaddr + 8) >> 2] = 0
    HEAP32[(sockaddr + 12) >> 2] = 0

    const addrinfo = _malloc(32)
    HEAP32[(addrinfo + 4) >> 2] = family
    HEAP32[(addrinfo + 8) >> 2] = type
    HEAP32[(addrinfo + 12) >> 2] = proto
    HEAP32[(addrinfo + 16) >> 2] = 16
    HEAPU32[(addrinfo + 20) >> 2] = sockaddr
    HEAPU32[(addrinfo + 24) >> 2] = 0
    HEAPU32[(addrinfo + 28) >> 2] = 0
    HEAPU32[out >> 2] = addrinfo
    return 0
  }
  _getaddrinfo.sig = 'ipppp'
  const _getnameinfo = () => -6
  _getnameinfo.sig = 'ipipipii'
  function _random_get(buffer, size) {
    try {
      crypto.getRandomValues(HEAPU8.subarray(buffer, buffer + size))
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _random_get.sig = 'ipp'
  const setTempRet0 = (val) => __emscripten_tempret_set(val)
  const _setTempRet0 = setTempRet0
  const getTempRet0 = (val) => __emscripten_tempret_get()
  const _getTempRet0 = getTempRet0
  const _emscripten_force_exit = (status) => {
    __emscripten_runtime_keepalive_clear()
    _exit(status)
  }
  _emscripten_force_exit.sig = 'vi'
  const _sched_yield = () => 0
  _sched_yield.sig = 'i'
  let exceptionLast = 0
  class ExceptionInfo {
    constructor(excPtr) {
      this.excPtr = excPtr
      this.ptr = excPtr - 24
    }
    set_type(type) {
      HEAPU32[(this.ptr + 4) >> 2] = type
    }
    get_type() {
      return HEAPU32[(this.ptr + 4) >> 2]
    }
    set_destructor(destructor) {
      HEAPU32[(this.ptr + 8) >> 2] = destructor
    }
    get_destructor() {
      return HEAPU32[(this.ptr + 8) >> 2]
    }
    set_caught(caught) {
      caught = caught ? 1 : 0
      HEAP8[this.ptr + 12] = caught
    }
    get_caught() {
      return HEAP8[this.ptr + 12] != 0
    }
    set_rethrown(rethrown) {
      rethrown = rethrown ? 1 : 0
      HEAP8[this.ptr + 13] = rethrown
    }
    get_rethrown() {
      return HEAP8[this.ptr + 13] != 0
    }
    init(type, destructor) {
      this.set_adjusted_ptr(0)
      this.set_type(type)
      this.set_destructor(destructor)
    }
    set_adjusted_ptr(adjustedPtr) {
      HEAPU32[(this.ptr + 16) >> 2] = adjustedPtr
    }
    get_adjusted_ptr() {
      return HEAPU32[(this.ptr + 16) >> 2]
    }
  }
  const ___resumeException = (ptr) => {
    if (!exceptionLast) {
      exceptionLast = ptr
    }
    throw exceptionLast
  }
  ___resumeException.sig = 'vp'
  const findMatchingCatch = (args) => {
    const thrown = exceptionLast
    if (!thrown) {
      setTempRet0(0)
      return 0
    }
    const info = new ExceptionInfo(thrown)
    info.set_adjusted_ptr(thrown)
    const thrownType = info.get_type()
    if (!thrownType) {
      setTempRet0(0)
      return thrown
    }
    for (const caughtType of args) {
      if (caughtType === 0 || caughtType === thrownType) {
        break
      }
      const adjusted_ptr_addr = info.ptr + 16
      if (___cxa_can_catch(caughtType, thrownType, adjusted_ptr_addr)) {
        setTempRet0(caughtType)
        return thrown
      }
    }
    setTempRet0(thrownType)
    return thrown
  }
  const ___cxa_find_matching_catch_2 = () => findMatchingCatch([])
  ___cxa_find_matching_catch_2.sig = 'p'
  const ___cxa_find_matching_catch_3 = (arg0) => findMatchingCatch([arg0])
  ___cxa_find_matching_catch_3.sig = 'pp'
  let uncaughtExceptionCount = 0
  const ___cxa_throw = (ptr, type, destructor) => {
    const info = new ExceptionInfo(ptr)
    info.init(type, destructor)
    exceptionLast = ptr
    uncaughtExceptionCount++
    throw exceptionLast
  }
  ___cxa_throw.sig = 'vppp'
  const exceptionCaught = []
  const ___cxa_rethrow = () => {
    const info = exceptionCaught.pop()
    if (!info) {
      abort('no exception to throw')
    }
    const ptr = info.excPtr
    if (!info.get_rethrown()) {
      exceptionCaught.push(info)
      info.set_rethrown(true)
      info.set_caught(false)
      uncaughtExceptionCount++
    }
    exceptionLast = ptr
    throw exceptionLast
  }
  ___cxa_rethrow.sig = 'v'
  const ___cxa_begin_catch = (ptr) => {
    const info = new ExceptionInfo(ptr)
    if (!info.get_caught()) {
      info.set_caught(true)
      uncaughtExceptionCount--
    }
    info.set_rethrown(false)
    exceptionCaught.push(info)
    ___cxa_increment_exception_refcount(ptr)
    return ___cxa_get_exception_ptr(ptr)
  }
  ___cxa_begin_catch.sig = 'pp'
  const ___cxa_end_catch = () => {
    _setThrew(0, 0)
    const info = exceptionCaught.pop()
    ___cxa_decrement_exception_refcount(info.excPtr)
    exceptionLast = 0
  }
  ___cxa_end_catch.sig = 'v'
  const ___cxa_uncaught_exceptions = () => uncaughtExceptionCount
  ___cxa_uncaught_exceptions.sig = 'i'
  const ___cxa_current_primary_exception = () => {
    if (!exceptionCaught.length) {
      return 0
    }
    const info = exceptionCaught[exceptionCaught.length - 1]
    ___cxa_increment_exception_refcount(info.excPtr)
    return info.excPtr
  }
  ___cxa_current_primary_exception.sig = 'p'
  const ___cxa_rethrow_primary_exception = (ptr) => {
    if (!ptr) return
    const info = new ExceptionInfo(ptr)
    exceptionCaught.push(info)
    info.set_rethrown(true)
    ___cxa_rethrow()
  }
  ___cxa_rethrow_primary_exception.sig = 'vp'
  let FS_stdin_getChar_buffer = []
  const FS_stdin_getChar = () => {
    if (!FS_stdin_getChar_buffer.length) {
      let result = null
      const BUFSIZE = 256
      const buf = Buffer.alloc(BUFSIZE)
      let bytesRead = 0
      const fd = process.stdin.fd
      try {
        bytesRead = fs.readSync(fd, buf, 0, BUFSIZE)
      } catch (e) {
        if (e.toString().includes('EOF')) bytesRead = 0
        else throw e
      }
      if (bytesRead > 0) {
        result = buf.slice(0, bytesRead).toString('utf-8')
      }
      if (!result) {
        return null
      }
      FS_stdin_getChar_buffer = intArrayFromString(result, true)
    }
    return FS_stdin_getChar_buffer.shift()
  }
  let TTY = {
    ttys: [],
    init() {},
    shutdown() {},
    register(dev, ops) {
      TTY.ttys[dev] = { input: [], output: [], ops }
      FS.registerDevice(dev, TTY.stream_ops)
    },
    stream_ops: {
      open(stream) {
        const tty = TTY.ttys[stream.node.rdev]
        if (!tty) {
          throw new FS.ErrnoError(43)
        }
        stream.tty = tty
        stream.seekable = false
      },
      close(stream) {
        stream.tty.ops.fsync(stream.tty)
      },
      fsync(stream) {
        stream.tty.ops.fsync(stream.tty)
      },
      read(stream, buffer, offset, length, pos) {
        if (!stream.tty || !stream.tty.ops.get_char) {
          throw new FS.ErrnoError(60)
        }
        let bytesRead = 0
        for (let i = 0; i < length; i++) {
          let result
          try {
            result = stream.tty.ops.get_char(stream.tty)
          } catch (e) {
            throw new FS.ErrnoError(29)
          }
          if (result === undefined && bytesRead === 0) {
            throw new FS.ErrnoError(6)
          }
          if (result === null || result === undefined) break
          bytesRead++
          buffer[offset + i] = result
        }
        if (bytesRead) {
          stream.node.atime = Date.now()
        }
        return bytesRead
      },
      write(stream, buffer, offset, length, pos) {
        if (!stream.tty || !stream.tty.ops.put_char) {
          throw new FS.ErrnoError(60)
        }
        let i = 0
        try {
          for (; i < length; i++) {
            stream.tty.ops.put_char(stream.tty, buffer[offset + i])
          }
        } catch (e) {
          throw new FS.ErrnoError(29)
        }
        if (length) {
          stream.node.mtime = stream.node.ctime = Date.now()
        }
        return i
      },
    },
    default_tty_ops: {
      get_char(tty) {
        return FS_stdin_getChar()
      },
      put_char(tty, val) {
        if (val === null || val === 10) {
          out(UTF8ArrayToString(tty.output))
          tty.output = []
        } else {
          if (val != 0) tty.output.push(val)
        }
      },
      fsync(tty) {
        if (tty.output && tty.output.length > 0) {
          out(UTF8ArrayToString(tty.output))
          tty.output = []
        }
      },
      ioctl_tcgets(tty) {
        return {
          c_iflag: 25856,
          c_oflag: 5,
          c_cflag: 191,
          c_lflag: 35387,
          c_cc: [
            3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          ],
        }
      },
      ioctl_tcsets(tty, optional_actions, data) {
        return 0
      },
      ioctl_tiocgwinsz(tty) {
        return [24, 80]
      },
    },
    default_tty1_ops: {
      put_char(tty, val) {
        if (val === null || val === 10) {
          err(UTF8ArrayToString(tty.output))
          tty.output = []
        } else {
          if (val != 0) tty.output.push(val)
        }
      },
      fsync(tty) {
        if (tty.output && tty.output.length > 0) {
          err(UTF8ArrayToString(tty.output))
          tty.output = []
        }
      },
    },
  }
  const mmapAlloc = (size) => {
    size = Math.ceil(size / 65536) * 65536
    const ptr = _emscripten_builtin_memalign(65536, size)
    if (ptr) HEAPU8.fill(0, ptr, ptr + size)
    return ptr
  }
  const MEMFS = {
    ops_table: null,
    mount(mount) {
      return MEMFS.createNode(null, '/', 16895, 0)
    },
    createNode(parent, name, mode, dev) {
      if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
        throw new FS.ErrnoError(63)
      }
      MEMFS.ops_table ||= {
        dir: {
          node: {
            getattr: MEMFS.node_ops.getattr,
            setattr: MEMFS.node_ops.setattr,
            lookup: MEMFS.node_ops.lookup,
            mknod: MEMFS.node_ops.mknod,
            rename: MEMFS.node_ops.rename,
            unlink: MEMFS.node_ops.unlink,
            rmdir: MEMFS.node_ops.rmdir,
            readdir: MEMFS.node_ops.readdir,
            symlink: MEMFS.node_ops.symlink,
          },
          stream: { llseek: MEMFS.stream_ops.llseek },
        },
        file: {
          node: {
            getattr: MEMFS.node_ops.getattr,
            setattr: MEMFS.node_ops.setattr,
          },
          stream: {
            llseek: MEMFS.stream_ops.llseek,
            read: MEMFS.stream_ops.read,
            write: MEMFS.stream_ops.write,
            allocate: MEMFS.stream_ops.allocate,
            mmap: MEMFS.stream_ops.mmap,
            msync: MEMFS.stream_ops.msync,
          },
        },
        link: {
          node: {
            getattr: MEMFS.node_ops.getattr,
            setattr: MEMFS.node_ops.setattr,
            readlink: MEMFS.node_ops.readlink,
          },
          stream: {},
        },
        chrdev: {
          node: {
            getattr: MEMFS.node_ops.getattr,
            setattr: MEMFS.node_ops.setattr,
          },
          stream: FS.chrdev_stream_ops,
        },
      }
      const node = FS.createNode(parent, name, mode, dev)
      if (FS.isDir(node.mode)) {
        node.node_ops = MEMFS.ops_table.dir.node
        node.stream_ops = MEMFS.ops_table.dir.stream
        node.contents = {}
      } else if (FS.isFile(node.mode)) {
        node.node_ops = MEMFS.ops_table.file.node
        node.stream_ops = MEMFS.ops_table.file.stream
        node.usedBytes = 0
        node.contents = null
      } else if (FS.isLink(node.mode)) {
        node.node_ops = MEMFS.ops_table.link.node
        node.stream_ops = MEMFS.ops_table.link.stream
      } else if (FS.isChrdev(node.mode)) {
        node.node_ops = MEMFS.ops_table.chrdev.node
        node.stream_ops = MEMFS.ops_table.chrdev.stream
      }
      node.atime = node.mtime = node.ctime = Date.now()
      if (parent) {
        parent.contents[name] = node
        parent.atime = parent.mtime = parent.ctime = node.atime
      }
      return node
    },
    getFileDataAsTypedArray(node) {
      if (!node.contents) return new Uint8Array(0)
      if (node.contents.subarray)
        return node.contents.subarray(0, node.usedBytes)
      return new Uint8Array(node.contents)
    },
    expandFileStorage(node, newCapacity) {
      const prevCapacity = node.contents ? node.contents.length : 0
      if (prevCapacity >= newCapacity) return
      const CAPACITY_DOUBLING_MAX = 1024 * 1024
      newCapacity = Math.max(
        newCapacity,
        (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125)) >>>
          0,
      )
      if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256)
      const oldContents = node.contents
      node.contents = new Uint8Array(newCapacity)
      if (node.usedBytes > 0)
        node.contents.set(oldContents.subarray(0, node.usedBytes), 0)
    },
    resizeFileStorage(node, newSize) {
      if (node.usedBytes == newSize) return
      if (newSize == 0) {
        node.contents = null
        node.usedBytes = 0
      } else {
        const oldContents = node.contents
        node.contents = new Uint8Array(newSize)
        if (oldContents) {
          node.contents.set(
            oldContents.subarray(0, Math.min(newSize, node.usedBytes)),
          )
        }
        node.usedBytes = newSize
      }
    },
    node_ops: {
      getattr(node) {
        const attr = {}
        attr.dev = FS.isChrdev(node.mode) ? node.id : 1
        attr.ino = node.id
        attr.mode = node.mode
        attr.nlink = 1
        attr.uid = 0
        attr.gid = 0
        attr.rdev = node.rdev
        if (FS.isDir(node.mode)) {
          attr.size = 4096
        } else if (FS.isFile(node.mode)) {
          attr.size = node.usedBytes
        } else if (FS.isLink(node.mode)) {
          attr.size = node.link.length
        } else {
          attr.size = 0
        }
        attr.atime = new Date(node.atime)
        attr.mtime = new Date(node.mtime)
        attr.ctime = new Date(node.ctime)
        attr.blksize = 4096
        attr.blocks = Math.ceil(attr.size / attr.blksize)
        return attr
      },
      setattr(node, attr) {
        for (const key of ['mode', 'atime', 'mtime', 'ctime']) {
          if (attr[key]) {
            node[key] = attr[key]
          }
        }
        if (attr.size !== undefined) {
          MEMFS.resizeFileStorage(node, attr.size)
        }
      },
      lookup(parent, name) {
        throw MEMFS.doesNotExistError
      },
      mknod(parent, name, mode, dev) {
        return MEMFS.createNode(parent, name, mode, dev)
      },
      rename(old_node, new_dir, new_name) {
        let new_node
        try {
          new_node = FS.lookupNode(new_dir, new_name)
        } catch (e) {}
        if (new_node) {
          if (FS.isDir(old_node.mode)) {
            for (const i in new_node.contents) {
              throw new FS.ErrnoError(55)
            }
          }
          FS.hashRemoveNode(new_node)
        }
        delete old_node.parent.contents[old_node.name]
        new_dir.contents[new_name] = old_node
        old_node.name = new_name
        new_dir.ctime =
          new_dir.mtime =
          old_node.parent.ctime =
          old_node.parent.mtime =
            Date.now()
      },
      unlink(parent, name) {
        delete parent.contents[name]
        parent.ctime = parent.mtime = Date.now()
      },
      rmdir(parent, name) {
        const node = FS.lookupNode(parent, name)
        for (const i in node.contents) {
          throw new FS.ErrnoError(55)
        }
        delete parent.contents[name]
        parent.ctime = parent.mtime = Date.now()
      },
      readdir(node) {
        return ['.', '..', ...Object.keys(node.contents)]
      },
      symlink(parent, newname, oldpath) {
        const node = MEMFS.createNode(parent, newname, 511 | 40960, 0)
        node.link = oldpath
        return node
      },
      readlink(node) {
        if (!FS.isLink(node.mode)) {
          throw new FS.ErrnoError(28)
        }
        return node.link
      },
    },
    stream_ops: {
      read(stream, buffer, offset, length, position) {
        const contents = stream.node.contents
        if (position >= stream.node.usedBytes) return 0
        const size = Math.min(stream.node.usedBytes - position, length)
        if (size > 8 && contents.subarray) {
          buffer.set(contents.subarray(position, position + size), offset)
        } else {
          for (let i = 0; i < size; i++)
            buffer[offset + i] = contents[position + i]
        }
        return size
      },
      write(stream, buffer, offset, length, position, canOwn) {
        if (buffer.buffer === HEAP8.buffer) {
          canOwn = false
        }
        if (!length) return 0
        const node = stream.node
        node.mtime = node.ctime = Date.now()
        if (buffer.subarray && (!node.contents || node.contents.subarray)) {
          if (canOwn) {
            node.contents = buffer.subarray(offset, offset + length)
            node.usedBytes = length
            return length
          } else if (node.usedBytes === 0 && position === 0) {
            node.contents = buffer.slice(offset, offset + length)
            node.usedBytes = length
            return length
          } else if (position + length <= node.usedBytes) {
            node.contents.set(
              buffer.subarray(offset, offset + length),
              position,
            )
            return length
          }
        }
        MEMFS.expandFileStorage(node, position + length)
        if (node.contents.subarray && buffer.subarray) {
          node.contents.set(buffer.subarray(offset, offset + length), position)
        } else {
          for (let i = 0; i < length; i++) {
            node.contents[position + i] = buffer[offset + i]
          }
        }
        node.usedBytes = Math.max(node.usedBytes, position + length)
        return length
      },
      llseek(stream, offset, whence) {
        let position = offset
        if (whence === 1) {
          position += stream.position
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            position += stream.node.usedBytes
          }
        }
        if (position < 0) {
          throw new FS.ErrnoError(28)
        }
        return position
      },
      allocate(stream, offset, length) {
        MEMFS.expandFileStorage(stream.node, offset + length)
        stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length)
      },
      mmap(stream, length, position, prot, flags) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(43)
        }
        let ptr
        let allocated
        let contents = stream.node.contents
        if (!(flags & 2) && contents && contents.buffer === HEAP8.buffer) {
          allocated = false
          ptr = contents.byteOffset
        } else {
          allocated = true
          ptr = mmapAlloc(length)
          if (!ptr) {
            throw new FS.ErrnoError(48)
          }
          if (contents) {
            if (position > 0 || position + length < contents.length) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length)
              } else {
                contents = Array.prototype.slice.call(
                  contents,
                  position,
                  position + length,
                )
              }
            }
            HEAP8.set(contents, ptr)
          }
        }
        return { ptr, allocated }
      },
      msync(stream, buffer, offset, length, mmapFlags) {
        MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false)
        return 0
      },
    },
  }
  const FS_createDataFile = (
    parent,
    name,
    fileData,
    canRead,
    canWrite,
    canOwn,
  ) => {
    FS.createDataFile(parent, name, fileData, canRead, canWrite, canOwn)
  }
  const FS_handledByPreloadPlugin = (byteArray, fullname, finish, onerror) => {
    if (typeof Browser != 'undefined') Browser.init()
    let handled = false
    preloadPlugins.forEach((plugin) => {
      if (handled) return
      if (plugin['canHandle'](fullname)) {
        plugin['handle'](byteArray, fullname, finish, onerror)
        handled = true
      }
    })
    return handled
  }
  const FS_createPreloadedFile = (
    parent,
    name,
    url,
    canRead,
    canWrite,
    onload,
    onerror,
    dontCreateFile,
    canOwn,
    preFinish,
  ) => {
    const fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent
    const dep = getUniqueRunDependency(`cp ${fullname}`)
    function processData(byteArray) {
      function finish(byteArray) {
        preFinish?.()
        if (!dontCreateFile) {
          FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn)
        }
        onload?.()
        removeRunDependency(dep)
      }
      if (
        FS_handledByPreloadPlugin(byteArray, fullname, finish, () => {
          onerror?.()
          removeRunDependency(dep)
        })
      ) {
        return
      }
      finish(byteArray)
    }
    addRunDependency(dep)
    if (typeof url == 'string') {
      asyncLoad(url).then(processData, onerror)
    } else {
      processData(url)
    }
  }
  const ERRNO_CODES = {
    EPERM: 63,
    ENOENT: 44,
    ESRCH: 71,
    EINTR: 27,
    EIO: 29,
    ENXIO: 60,
    E2BIG: 1,
    ENOEXEC: 45,
    EBADF: 8,
    ECHILD: 12,
    EAGAIN: 6,
    EWOULDBLOCK: 6,
    ENOMEM: 48,
    EACCES: 2,
    EFAULT: 21,
    ENOTBLK: 105,
    EBUSY: 10,
    EEXIST: 20,
    EXDEV: 75,
    ENODEV: 43,
    ENOTDIR: 54,
    EISDIR: 31,
    EINVAL: 28,
    ENFILE: 41,
    EMFILE: 33,
    ENOTTY: 59,
    ETXTBSY: 74,
    EFBIG: 22,
    ENOSPC: 51,
    ESPIPE: 70,
    EROFS: 69,
    EMLINK: 34,
    EPIPE: 64,
    EDOM: 18,
    ERANGE: 68,
    ENOMSG: 49,
    EIDRM: 24,
    ECHRNG: 106,
    EL2NSYNC: 156,
    EL3HLT: 107,
    EL3RST: 108,
    ELNRNG: 109,
    EUNATCH: 110,
    ENOCSI: 111,
    EL2HLT: 112,
    EDEADLK: 16,
    ENOLCK: 46,
    EBADE: 113,
    EBADR: 114,
    EXFULL: 115,
    ENOANO: 104,
    EBADRQC: 103,
    EBADSLT: 102,
    EDEADLOCK: 16,
    EBFONT: 101,
    ENOSTR: 100,
    ENODATA: 116,
    ETIME: 117,
    ENOSR: 118,
    ENONET: 119,
    ENOPKG: 120,
    EREMOTE: 121,
    ENOLINK: 47,
    EADV: 122,
    ESRMNT: 123,
    ECOMM: 124,
    EPROTO: 65,
    EMULTIHOP: 36,
    EDOTDOT: 125,
    EBADMSG: 9,
    ENOTUNIQ: 126,
    EBADFD: 127,
    EREMCHG: 128,
    ELIBACC: 129,
    ELIBBAD: 130,
    ELIBSCN: 131,
    ELIBMAX: 132,
    ELIBEXEC: 133,
    ENOSYS: 52,
    ENOTEMPTY: 55,
    ENAMETOOLONG: 37,
    ELOOP: 32,
    EOPNOTSUPP: 138,
    EPFNOSUPPORT: 139,
    ECONNRESET: 15,
    ENOBUFS: 42,
    EAFNOSUPPORT: 5,
    EPROTOTYPE: 67,
    ENOTSOCK: 57,
    ENOPROTOOPT: 50,
    ESHUTDOWN: 140,
    ECONNREFUSED: 14,
    EADDRINUSE: 3,
    ECONNABORTED: 13,
    ENETUNREACH: 40,
    ENETDOWN: 38,
    ETIMEDOUT: 73,
    EHOSTDOWN: 142,
    EHOSTUNREACH: 23,
    EINPROGRESS: 26,
    EALREADY: 7,
    EDESTADDRREQ: 17,
    EMSGSIZE: 35,
    EPROTONOSUPPORT: 66,
    ESOCKTNOSUPPORT: 137,
    EADDRNOTAVAIL: 4,
    ENETRESET: 39,
    EISCONN: 30,
    ENOTCONN: 53,
    ETOOMANYREFS: 141,
    EUSERS: 136,
    EDQUOT: 19,
    ESTALE: 72,
    ENOTSUP: 138,
    ENOMEDIUM: 148,
    EILSEQ: 25,
    EOVERFLOW: 61,
    ECANCELED: 11,
    ENOTRECOVERABLE: 56,
    EOWNERDEAD: 62,
    ESTRPIPE: 135,
  }
  const NODEFS = {
    isWindows: false,
    staticInit() {
      NODEFS.isWindows = !!process.platform.match(/^win/)
      let flags = process.binding('constants')
      if (flags['fs']) {
        flags = flags['fs']
      }
      NODEFS.flagsForNodeMap = {
        1024: flags['O_APPEND'],
        64: flags['O_CREAT'],
        128: flags['O_EXCL'],
        256: flags['O_NOCTTY'],
        0: flags['O_RDONLY'],
        2: flags['O_RDWR'],
        4096: flags['O_SYNC'],
        512: flags['O_TRUNC'],
        1: flags['O_WRONLY'],
        131072: flags['O_NOFOLLOW'],
      }
    },
    convertNodeCode(e) {
      const code = e.code
      return ERRNO_CODES[code]
    },
    tryFSOperation(f) {
      try {
        return f()
      } catch (e) {
        if (!e.code) throw e
        if (e.code === 'UNKNOWN') throw new FS.ErrnoError(28)
        throw new FS.ErrnoError(NODEFS.convertNodeCode(e))
      }
    },
    mount(mount) {
      return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0)
    },
    createNode(parent, name, mode, dev) {
      if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
        throw new FS.ErrnoError(28)
      }
      const node = FS.createNode(parent, name, mode)
      node.node_ops = NODEFS.node_ops
      node.stream_ops = NODEFS.stream_ops
      return node
    },
    getMode(path) {
      return NODEFS.tryFSOperation(() => {
        let mode = fs.lstatSync(path).mode
        if (NODEFS.isWindows) {
          mode |= (mode & 292) >> 2
        }
        return mode
      })
    },
    realPath(node) {
      const parts = []
      while (node.parent !== node) {
        parts.push(node.name)
        node = node.parent
      }
      parts.push(node.mount.opts.root)
      parts.reverse()
      return PATH.join(...parts)
    },
    flagsForNode(flags) {
      flags &= ~2097152
      flags &= ~2048
      flags &= ~32768
      flags &= ~524288
      flags &= ~65536
      let newFlags = 0
      for (const k in NODEFS.flagsForNodeMap) {
        if (flags & k) {
          newFlags |= NODEFS.flagsForNodeMap[k]
          flags ^= k
        }
      }
      if (flags) {
        throw new FS.ErrnoError(28)
      }
      return newFlags
    },
    node_ops: {
      getattr(node) {
        const path = NODEFS.realPath(node)
        let stat
        NODEFS.tryFSOperation(() => (stat = fs.lstatSync(path)))
        if (NODEFS.isWindows) {
          if (!stat.blksize) {
            stat.blksize = 4096
          }
          if (!stat.blocks) {
            stat.blocks = ((stat.size + stat.blksize - 1) / stat.blksize) | 0
          }
          stat.mode |= (stat.mode & 292) >> 2
        }
        return {
          dev: stat.dev,
          ino: stat.ino,
          mode: stat.mode,
          nlink: stat.nlink,
          uid: stat.uid,
          gid: stat.gid,
          rdev: stat.rdev,
          size: stat.size,
          atime: stat.atime,
          mtime: stat.mtime,
          ctime: stat.ctime,
          blksize: stat.blksize,
          blocks: stat.blocks,
        }
      },
      setattr(node, attr) {
        const path = NODEFS.realPath(node)
        NODEFS.tryFSOperation(() => {
          if (attr.mode !== undefined) {
            let mode = attr.mode
            if (NODEFS.isWindows) {
              mode &= 384
            }
            fs.chmodSync(path, mode)
            node.mode = attr.mode
          }
          if (attr.atime || attr.mtime) {
            const atime = attr.atime && new Date(attr.atime)
            const mtime = attr.mtime && new Date(attr.mtime)
            fs.utimesSync(path, atime, mtime)
          }
          if (attr.size !== undefined) {
            fs.truncateSync(path, attr.size)
          }
        })
      },
      lookup(parent, name) {
        const path = PATH.join2(NODEFS.realPath(parent), name)
        const mode = NODEFS.getMode(path)
        return NODEFS.createNode(parent, name, mode)
      },
      mknod(parent, name, mode, dev) {
        const node = NODEFS.createNode(parent, name, mode, dev)
        const path = NODEFS.realPath(node)
        NODEFS.tryFSOperation(() => {
          if (FS.isDir(node.mode)) {
            fs.mkdirSync(path, node.mode)
          } else {
            fs.writeFileSync(path, '', { mode: node.mode })
          }
        })
        return node
      },
      rename(oldNode, newDir, newName) {
        const oldPath = NODEFS.realPath(oldNode)
        const newPath = PATH.join2(NODEFS.realPath(newDir), newName)
        try {
          FS.unlink(newPath)
        } catch (e) {}
        NODEFS.tryFSOperation(() => fs.renameSync(oldPath, newPath))
        oldNode.name = newName
      },
      unlink(parent, name) {
        const path = PATH.join2(NODEFS.realPath(parent), name)
        NODEFS.tryFSOperation(() => fs.unlinkSync(path))
      },
      rmdir(parent, name) {
        const path = PATH.join2(NODEFS.realPath(parent), name)
        NODEFS.tryFSOperation(() => fs.rmdirSync(path))
      },
      readdir(node) {
        const path = NODEFS.realPath(node)
        return NODEFS.tryFSOperation(() => fs.readdirSync(path))
      },
      symlink(parent, newName, oldPath) {
        const newPath = PATH.join2(NODEFS.realPath(parent), newName)
        NODEFS.tryFSOperation(() => fs.symlinkSync(oldPath, newPath))
      },
      readlink(node) {
        const path = NODEFS.realPath(node)
        return NODEFS.tryFSOperation(() => fs.readlinkSync(path))
      },
      statfs(path) {
        const stats = NODEFS.tryFSOperation(() => fs.statfsSync(path))
        stats.frsize = stats.bsize
        return stats
      },
    },
    stream_ops: {
      open(stream) {
        const path = NODEFS.realPath(stream.node)
        NODEFS.tryFSOperation(() => {
          if (FS.isFile(stream.node.mode)) {
            stream.shared.refcount = 1
            stream.nfd = fs.openSync(path, NODEFS.flagsForNode(stream.flags))
          }
        })
      },
      close(stream) {
        NODEFS.tryFSOperation(() => {
          if (
            FS.isFile(stream.node.mode) &&
            stream.nfd &&
            --stream.shared.refcount === 0
          ) {
            fs.closeSync(stream.nfd)
          }
        })
      },
      dup(stream) {
        stream.shared.refcount++
      },
      read(stream, buffer, offset, length, position) {
        if (length === 0) return 0
        return NODEFS.tryFSOperation(() =>
          fs.readSync(
            stream.nfd,
            new Int8Array(buffer.buffer, offset, length),
            0,
            length,
            position,
          ),
        )
      },
      write(stream, buffer, offset, length, position) {
        return NODEFS.tryFSOperation(() =>
          fs.writeSync(
            stream.nfd,
            new Int8Array(buffer.buffer, offset, length),
            0,
            length,
            position,
          ),
        )
      },
      llseek(stream, offset, whence) {
        let position = offset
        if (whence === 1) {
          position += stream.position
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            NODEFS.tryFSOperation(() => {
              const stat = fs.fstatSync(stream.nfd)
              position += stat.size
            })
          }
        }
        if (position < 0) {
          throw new FS.ErrnoError(28)
        }
        return position
      },
      mmap(stream, length, position, prot, flags) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(43)
        }
        const ptr = mmapAlloc(length)
        NODEFS.stream_ops.read(stream, HEAP8, ptr, length, position)
        return { ptr, allocated: true }
      },
      msync(stream, buffer, offset, length, mmapFlags) {
        NODEFS.stream_ops.write(stream, buffer, 0, length, offset, false)
        return 0
      },
    },
  }
  const PROXYFS = {
    mount(mount) {
      return PROXYFS.createNode(
        null,
        '/',
        mount.opts.fs.lstat(mount.opts.root).mode,
        0,
      )
    },
    createNode(parent, name, mode, dev) {
      if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL)
      }
      const node = FS.createNode(parent, name, mode)
      node.node_ops = PROXYFS.node_ops
      node.stream_ops = PROXYFS.stream_ops
      return node
    },
    realPath(node) {
      const parts = []
      while (node.parent !== node) {
        parts.push(node.name)
        node = node.parent
      }
      parts.push(node.mount.opts.root)
      parts.reverse()
      return PATH.join(...parts)
    },
    node_ops: {
      getattr(node) {
        const path = PROXYFS.realPath(node)
        let stat
        try {
          stat = node.mount.opts.fs.lstat(path)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
        return {
          dev: stat.dev,
          ino: stat.ino,
          mode: stat.mode,
          nlink: stat.nlink,
          uid: stat.uid,
          gid: stat.gid,
          rdev: stat.rdev,
          size: stat.size,
          atime: stat.atime,
          mtime: stat.mtime,
          ctime: stat.ctime,
          blksize: stat.blksize,
          blocks: stat.blocks,
        }
      },
      setattr(node, attr) {
        const path = PROXYFS.realPath(node)
        try {
          if (attr.mode !== undefined) {
            node.mount.opts.fs.chmod(path, attr.mode)
            node.mode = attr.mode
          }
          if (attr.atime || attr.mtime) {
            const atime = new Date(attr.atime || attr.mtime)
            const mtime = new Date(attr.mtime || attr.atime)
            node.mount.opts.fs.utime(path, atime, mtime)
          }
          if (attr.size !== undefined) {
            node.mount.opts.fs.truncate(path, attr.size)
          }
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      lookup(parent, name) {
        try {
          const path = PATH.join2(PROXYFS.realPath(parent), name)
          const mode = parent.mount.opts.fs.lstat(path).mode
          const node = PROXYFS.createNode(parent, name, mode)
          return node
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      mknod(parent, name, mode, dev) {
        const node = PROXYFS.createNode(parent, name, mode, dev)
        const path = PROXYFS.realPath(node)
        try {
          if (FS.isDir(node.mode)) {
            node.mount.opts.fs.mkdir(path, node.mode)
          } else {
            node.mount.opts.fs.writeFile(path, '', { mode: node.mode })
          }
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
        return node
      },
      rename(oldNode, newDir, newName) {
        const oldPath = PROXYFS.realPath(oldNode)
        const newPath = PATH.join2(PROXYFS.realPath(newDir), newName)
        try {
          oldNode.mount.opts.fs.rename(oldPath, newPath)
          oldNode.name = newName
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      unlink(parent, name) {
        const path = PATH.join2(PROXYFS.realPath(parent), name)
        try {
          parent.mount.opts.fs.unlink(path)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      rmdir(parent, name) {
        const path = PATH.join2(PROXYFS.realPath(parent), name)
        try {
          parent.mount.opts.fs.rmdir(path)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      readdir(node) {
        const path = PROXYFS.realPath(node)
        try {
          return node.mount.opts.fs.readdir(path)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      symlink(parent, newName, oldPath) {
        const newPath = PATH.join2(PROXYFS.realPath(parent), newName)
        try {
          parent.mount.opts.fs.symlink(oldPath, newPath)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      readlink(node) {
        const path = PROXYFS.realPath(node)
        try {
          return node.mount.opts.fs.readlink(path)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
    },
    stream_ops: {
      open(stream) {
        const path = PROXYFS.realPath(stream.node)
        try {
          stream.nfd = stream.node.mount.opts.fs.open(path, stream.flags)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      close(stream) {
        try {
          stream.node.mount.opts.fs.close(stream.nfd)
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      read(stream, buffer, offset, length, position) {
        try {
          return stream.node.mount.opts.fs.read(
            stream.nfd,
            buffer,
            offset,
            length,
            position,
          )
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      write(stream, buffer, offset, length, position) {
        try {
          return stream.node.mount.opts.fs.write(
            stream.nfd,
            buffer,
            offset,
            length,
            position,
          )
        } catch (e) {
          if (!e.code) throw e
          throw new FS.ErrnoError(ERRNO_CODES[e.code])
        }
      },
      llseek(stream, offset, whence) {
        let position = offset
        if (whence === 1) {
          position += stream.position
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            try {
              const stat = stream.node.node_ops.getattr(stream.node)
              position += stat.size
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES[e.code])
            }
          }
        }
        if (position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL)
        }
        return position
      },
    },
  }
  const FS = {
    root: null,
    mounts: [],
    devices: {},
    streams: [],
    nextInode: 1,
    nameTable: null,
    currentPath: '/',
    initialized: false,
    ignorePermissions: true,
    ErrnoError: class {
      name = 'ErrnoError'
      constructor(errno) {
        this.errno = errno
      }
    },
    filesystems: null,
    syncFSRequests: 0,
    readFiles: {},
    FSStream: class {
      shared = {}
      get object() {
        return this.node
      }
      set object(val) {
        this.node = val
      }
      get isRead() {
        return (this.flags & 2097155) !== 1
      }
      get isWrite() {
        return (this.flags & 2097155) !== 0
      }
      get isAppend() {
        return this.flags & 1024
      }
      get flags() {
        return this.shared.flags
      }
      set flags(val) {
        this.shared.flags = val
      }
      get position() {
        return this.shared.position
      }
      set position(val) {
        this.shared.position = val
      }
    },
    FSNode: class {
      node_ops = {}
      stream_ops = {}
      readMode = 292 | 73
      writeMode = 146
      mounted = null
      constructor(parent, name, mode, rdev) {
        if (!parent) {
          parent = this
        }
        this.parent = parent
        this.mount = parent.mount
        this.id = FS.nextInode++
        this.name = name
        this.mode = mode
        this.rdev = rdev
        this.atime = this.mtime = this.ctime = Date.now()
      }
      get read() {
        return (this.mode & this.readMode) === this.readMode
      }
      set read(val) {
        val ? (this.mode |= this.readMode) : (this.mode &= ~this.readMode)
      }
      get write() {
        return (this.mode & this.writeMode) === this.writeMode
      }
      set write(val) {
        val ? (this.mode |= this.writeMode) : (this.mode &= ~this.writeMode)
      }
      get isFolder() {
        return FS.isDir(this.mode)
      }
      get isDevice() {
        return FS.isChrdev(this.mode)
      }
    },
    lookupPath(path, opts = {}) {
      if (!path) return { path: '', node: null }
      opts.follow_mount ??= true
      if (!PATH.isAbs(path)) {
        path = FS.cwd() + '/' + path
      }
      linkloop: for (let nlinks = 0; nlinks < 40; nlinks++) {
        const parts = path.split('/').filter((p) => !!p && p !== '.')
        let current = FS.root
        let current_path = '/'
        for (let i = 0; i < parts.length; i++) {
          const islast = i === parts.length - 1
          if (islast && opts.parent) {
            break
          }
          if (parts[i] === '..') {
            current_path = PATH.dirname(current_path)
            current = current.parent
            continue
          }
          current_path = PATH.join2(current_path, parts[i])
          try {
            current = FS.lookupNode(current, parts[i])
          } catch (e) {
            if (e?.errno === 44 && islast && opts.noent_okay) {
              return { path: current_path }
            }
            throw e
          }
          if (FS.isMountpoint(current) && (!islast || opts.follow_mount)) {
            current = current.mounted.root
          }
          if (FS.isLink(current.mode) && (!islast || opts.follow)) {
            if (!current.node_ops.readlink) {
              throw new FS.ErrnoError(52)
            }
            let link = current.node_ops.readlink(current)
            if (!PATH.isAbs(link)) {
              link = PATH.dirname(current_path) + '/' + link
            }
            path = link + '/' + parts.slice(i + 1).join('/')
            continue linkloop
          }
        }
        return { path: current_path, node: current }
      }
      throw new FS.ErrnoError(32)
    },
    getPath(node) {
      let path
      while (true) {
        if (FS.isRoot(node)) {
          const mount = node.mount.mountpoint
          if (!path) return mount
          return mount[mount.length - 1] !== '/'
            ? `${mount}/${path}`
            : mount + path
        }
        path = path ? `${node.name}/${path}` : node.name
        node = node.parent
      }
    },
    hashName(parentid, name) {
      let hash = 0
      for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
      }
      return ((parentid + hash) >>> 0) % FS.nameTable.length
    },
    hashAddNode(node) {
      const hash = FS.hashName(node.parent.id, node.name)
      node.name_next = FS.nameTable[hash]
      FS.nameTable[hash] = node
    },
    hashRemoveNode(node) {
      const hash = FS.hashName(node.parent.id, node.name)
      if (FS.nameTable[hash] === node) {
        FS.nameTable[hash] = node.name_next
      } else {
        let current = FS.nameTable[hash]
        while (current) {
          if (current.name_next === node) {
            current.name_next = node.name_next
            break
          }
          current = current.name_next
        }
      }
    },
    lookupNode(parent, name) {
      const errCode = FS.mayLookup(parent)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      const hash = FS.hashName(parent.id, name)
      for (let node = FS.nameTable[hash]; node; node = node.name_next) {
        const nodeName = node.name
        if (node.parent.id === parent.id && nodeName === name) {
          return node
        }
      }
      return FS.lookup(parent, name)
    },
    createNode(parent, name, mode, rdev) {
      const node = new FS.FSNode(parent, name, mode, rdev)
      FS.hashAddNode(node)
      return node
    },
    destroyNode(node) {
      FS.hashRemoveNode(node)
    },
    isRoot(node) {
      return node === node.parent
    },
    isMountpoint(node) {
      return !!node.mounted
    },
    isFile(mode) {
      return (mode & 61440) === 32768
    },
    isDir(mode) {
      return (mode & 61440) === 16384
    },
    isLink(mode) {
      return (mode & 61440) === 40960
    },
    isChrdev(mode) {
      return (mode & 61440) === 8192
    },
    isBlkdev(mode) {
      return (mode & 61440) === 24576
    },
    isFIFO(mode) {
      return (mode & 61440) === 4096
    },
    isSocket(mode) {
      return (mode & 49152) === 49152
    },
    flagsToPermissionString(flag) {
      let perms = ['r', 'w', 'rw'][flag & 3]
      if (flag & 512) {
        perms += 'w'
      }
      return perms
    },
    nodePermissions(node, perms) {
      if (FS.ignorePermissions) {
        return 0
      }
      if (perms.includes('r') && !(node.mode & 292)) {
        return 2
      } else if (perms.includes('w') && !(node.mode & 146)) {
        return 2
      } else if (perms.includes('x') && !(node.mode & 73)) {
        return 2
      }
      return 0
    },
    mayLookup(dir) {
      if (!FS.isDir(dir.mode)) return 54
      const errCode = FS.nodePermissions(dir, 'x')
      if (errCode) return errCode
      if (!dir.node_ops.lookup) return 2
      return 0
    },
    mayCreate(dir, name) {
      if (!FS.isDir(dir.mode)) {
        return 54
      }
      try {
        const node = FS.lookupNode(dir, name)
        return 20
      } catch (e) {}
      return FS.nodePermissions(dir, 'wx')
    },
    mayDelete(dir, name, isdir) {
      let node
      try {
        node = FS.lookupNode(dir, name)
      } catch (e) {
        return e.errno
      }
      const errCode = FS.nodePermissions(dir, 'wx')
      if (errCode) {
        return errCode
      }
      if (isdir) {
        if (!FS.isDir(node.mode)) {
          return 54
        }
        if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
          return 10
        }
      } else {
        if (FS.isDir(node.mode)) {
          return 31
        }
      }
      return 0
    },
    mayOpen(node, flags) {
      if (!node) {
        return 44
      }
      if (FS.isLink(node.mode)) {
        return 32
      } else if (FS.isDir(node.mode)) {
        if (FS.flagsToPermissionString(flags) !== 'r' || flags & 512) {
          return 31
        }
      }
      return FS.nodePermissions(node, FS.flagsToPermissionString(flags))
    },
    MAX_OPEN_FDS: 4096,
    nextfd() {
      for (let fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
        if (!FS.streams[fd]) {
          return fd
        }
      }
      throw new FS.ErrnoError(33)
    },
    getStreamChecked(fd) {
      const stream = FS.getStream(fd)
      if (!stream) {
        throw new FS.ErrnoError(8)
      }
      return stream
    },
    getStream: (fd) => FS.streams[fd],
    createStream(stream, fd = -1) {
      stream = Object.assign(new FS.FSStream(), stream)
      if (fd == -1) {
        fd = FS.nextfd()
      }
      stream.fd = fd
      FS.streams[fd] = stream
      return stream
    },
    closeStream(fd) {
      FS.streams[fd] = null
    },
    dupStream(origStream, fd = -1) {
      const stream = FS.createStream(origStream, fd)
      stream.stream_ops?.dup?.(stream)
      return stream
    },
    chrdev_stream_ops: {
      open(stream) {
        const device = FS.getDevice(stream.node.rdev)
        stream.stream_ops = device.stream_ops
        stream.stream_ops.open?.(stream)
      },
      llseek() {
        throw new FS.ErrnoError(70)
      },
    },
    major: (dev) => dev >> 8,
    minor: (dev) => dev & 255,
    makedev: (ma, mi) => (ma << 8) | mi,
    registerDevice(dev, ops) {
      FS.devices[dev] = { stream_ops: ops }
    },
    getDevice: (dev) => FS.devices[dev],
    getMounts(mount) {
      const mounts = []
      const check = [mount]
      while (check.length) {
        const m = check.pop()
        mounts.push(m)
        check.push(...m.mounts)
      }
      return mounts
    },
    syncfs(populate, callback) {
      if (typeof populate == 'function') {
        callback = populate
        populate = false
      }
      FS.syncFSRequests++
      if (FS.syncFSRequests > 1) {
        err(
          `warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`,
        )
      }
      const mounts = FS.getMounts(FS.root.mount)
      let completed = 0
      function doCallback(errCode) {
        FS.syncFSRequests--
        return callback(errCode)
      }
      function done(errCode) {
        if (errCode) {
          if (!done.errored) {
            done.errored = true
            return doCallback(errCode)
          }
          return
        }
        if (++completed >= mounts.length) {
          doCallback(null)
        }
      }
      mounts.forEach((mount) => {
        if (!mount.type.syncfs) {
          return done(null)
        }
        mount.type.syncfs(mount, populate, done)
      })
    },
    mount(type, opts, mountpoint) {
      const root = mountpoint === '/'
      const pseudo = !mountpoint
      let node
      if (root && FS.root) {
        throw new FS.ErrnoError(10)
      } else if (!root && !pseudo) {
        const lookup = FS.lookupPath(mountpoint, { follow_mount: false })
        mountpoint = lookup.path
        node = lookup.node
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10)
        }
        if (!FS.isDir(node.mode)) {
          throw new FS.ErrnoError(54)
        }
      }
      const mount = { type, opts, mountpoint, mounts: [] }
      const mountRoot = type.mount(mount)
      mountRoot.mount = mount
      mount.root = mountRoot
      if (root) {
        FS.root = mountRoot
      } else if (node) {
        node.mounted = mount
        if (node.mount) {
          node.mount.mounts.push(mount)
        }
      }
      return mountRoot
    },
    unmount(mountpoint) {
      const lookup = FS.lookupPath(mountpoint, { follow_mount: false })
      if (!FS.isMountpoint(lookup.node)) {
        throw new FS.ErrnoError(28)
      }
      const node = lookup.node
      const mount = node.mounted
      const mounts = FS.getMounts(mount)
      Object.keys(FS.nameTable).forEach((hash) => {
        let current = FS.nameTable[hash]
        while (current) {
          const next = current.name_next
          if (mounts.includes(current.mount)) {
            FS.destroyNode(current)
          }
          current = next
        }
      })
      node.mounted = null
      const idx = node.mount.mounts.indexOf(mount)
      node.mount.mounts.splice(idx, 1)
    },
    lookup(parent, name) {
      return parent.node_ops.lookup(parent, name)
    },
    mknod(path, mode, dev) {
      const lookup = FS.lookupPath(path, { parent: true })
      const parent = lookup.node
      const name = PATH.basename(path)
      if (!name || name === '.' || name === '..') {
        throw new FS.ErrnoError(28)
      }
      const errCode = FS.mayCreate(parent, name)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      if (!parent.node_ops.mknod) {
        throw new FS.ErrnoError(63)
      }
      return parent.node_ops.mknod(parent, name, mode, dev)
    },
    statfs(path) {
      const rtn = {
        bsize: 4096,
        frsize: 4096,
        blocks: 1e6,
        bfree: 5e5,
        bavail: 5e5,
        files: FS.nextInode,
        ffree: FS.nextInode - 1,
        fsid: 42,
        flags: 2,
        namelen: 255,
      }
      const parent = FS.lookupPath(path, { follow: true }).node
      if (parent?.node_ops.statfs) {
        Object.assign(rtn, parent.node_ops.statfs(parent.mount.opts.root))
      }
      return rtn
    },
    create(path, mode = 438) {
      mode &= 4095
      mode |= 32768
      return FS.mknod(path, mode, 0)
    },
    mkdir(path, mode = 511) {
      mode &= 511 | 512
      mode |= 16384
      return FS.mknod(path, mode, 0)
    },
    mkdirTree(path, mode) {
      const dirs = path.split('/')
      let d = ''
      for (let i = 0; i < dirs.length; ++i) {
        if (!dirs[i]) continue
        d += '/' + dirs[i]
        try {
          FS.mkdir(d, mode)
        } catch (e) {
          if (e.errno != 20) throw e
        }
      }
    },
    mkdev(path, mode, dev) {
      if (typeof dev == 'undefined') {
        dev = mode
        mode = 438
      }
      mode |= 8192
      return FS.mknod(path, mode, dev)
    },
    symlink(oldpath, newpath) {
      if (!PATH_FS.resolve(oldpath)) {
        throw new FS.ErrnoError(44)
      }
      const lookup = FS.lookupPath(newpath, { parent: true })
      const parent = lookup.node
      if (!parent) {
        throw new FS.ErrnoError(44)
      }
      const newname = PATH.basename(newpath)
      const errCode = FS.mayCreate(parent, newname)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      if (!parent.node_ops.symlink) {
        throw new FS.ErrnoError(63)
      }
      return parent.node_ops.symlink(parent, newname, oldpath)
    },
    rename(old_path, new_path) {
      const old_dirname = PATH.dirname(old_path)
      const new_dirname = PATH.dirname(new_path)
      const old_name = PATH.basename(old_path)
      const new_name = PATH.basename(new_path)
      let lookup, old_dir, new_dir
      lookup = FS.lookupPath(old_path, { parent: true })
      old_dir = lookup.node
      lookup = FS.lookupPath(new_path, { parent: true })
      new_dir = lookup.node
      if (!old_dir || !new_dir) throw new FS.ErrnoError(44)
      if (old_dir.mount !== new_dir.mount) {
        throw new FS.ErrnoError(75)
      }
      const old_node = FS.lookupNode(old_dir, old_name)
      let relative = PATH_FS.relative(old_path, new_dirname)
      if (relative.charAt(0) !== '.') {
        throw new FS.ErrnoError(28)
      }
      relative = PATH_FS.relative(new_path, old_dirname)
      if (relative.charAt(0) !== '.') {
        throw new FS.ErrnoError(55)
      }
      let new_node
      try {
        new_node = FS.lookupNode(new_dir, new_name)
      } catch (e) {}
      if (old_node === new_node) {
        return
      }
      const isdir = FS.isDir(old_node.mode)
      let errCode = FS.mayDelete(old_dir, old_name, isdir)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      errCode = new_node
        ? FS.mayDelete(new_dir, new_name, isdir)
        : FS.mayCreate(new_dir, new_name)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      if (!old_dir.node_ops.rename) {
        throw new FS.ErrnoError(63)
      }
      if (
        FS.isMountpoint(old_node) ||
        (new_node && FS.isMountpoint(new_node))
      ) {
        throw new FS.ErrnoError(10)
      }
      if (new_dir !== old_dir) {
        errCode = FS.nodePermissions(old_dir, 'w')
        if (errCode) {
          throw new FS.ErrnoError(errCode)
        }
      }
      FS.hashRemoveNode(old_node)
      try {
        old_dir.node_ops.rename(old_node, new_dir, new_name)
        old_node.parent = new_dir
      } catch (e) {
        throw e
      } finally {
        FS.hashAddNode(old_node)
      }
    },
    rmdir(path) {
      const lookup = FS.lookupPath(path, { parent: true })
      const parent = lookup.node
      const name = PATH.basename(path)
      const node = FS.lookupNode(parent, name)
      const errCode = FS.mayDelete(parent, name, true)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      if (!parent.node_ops.rmdir) {
        throw new FS.ErrnoError(63)
      }
      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(10)
      }
      parent.node_ops.rmdir(parent, name)
      FS.destroyNode(node)
    },
    readdir(path) {
      const lookup = FS.lookupPath(path, { follow: true })
      const node = lookup.node
      if (!node.node_ops.readdir) {
        throw new FS.ErrnoError(54)
      }
      return node.node_ops.readdir(node)
    },
    unlink(path) {
      const lookup = FS.lookupPath(path, { parent: true })
      const parent = lookup.node
      if (!parent) {
        throw new FS.ErrnoError(44)
      }
      const name = PATH.basename(path)
      const node = FS.lookupNode(parent, name)
      const errCode = FS.mayDelete(parent, name, false)
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      if (!parent.node_ops.unlink) {
        throw new FS.ErrnoError(63)
      }
      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(10)
      }
      parent.node_ops.unlink(parent, name)
      FS.destroyNode(node)
    },
    readlink(path) {
      const lookup = FS.lookupPath(path)
      const link = lookup.node
      if (!link) {
        throw new FS.ErrnoError(44)
      }
      if (!link.node_ops.readlink) {
        throw new FS.ErrnoError(28)
      }
      return link.node_ops.readlink(link)
    },
    stat(path, dontFollow) {
      const lookup = FS.lookupPath(path, { follow: !dontFollow })
      const node = lookup.node
      if (!node) {
        throw new FS.ErrnoError(44)
      }
      if (!node.node_ops.getattr) {
        throw new FS.ErrnoError(63)
      }
      return node.node_ops.getattr(node)
    },
    lstat(path) {
      return FS.stat(path, true)
    },
    chmod(path, mode, dontFollow) {
      let node
      if (typeof path == 'string') {
        const lookup = FS.lookupPath(path, { follow: !dontFollow })
        node = lookup.node
      } else {
        node = path
      }
      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(63)
      }
      node.node_ops.setattr(node, {
        mode: (mode & 4095) | (node.mode & ~4095),
        ctime: Date.now(),
      })
    },
    lchmod(path, mode) {
      FS.chmod(path, mode, true)
    },
    fchmod(fd, mode) {
      const stream = FS.getStreamChecked(fd)
      FS.chmod(stream.node, mode)
    },
    chown(path, uid, gid, dontFollow) {
      let node
      if (typeof path == 'string') {
        const lookup = FS.lookupPath(path, { follow: !dontFollow })
        node = lookup.node
      } else {
        node = path
      }
      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(63)
      }
      node.node_ops.setattr(node, { timestamp: Date.now() })
    },
    lchown(path, uid, gid) {
      FS.chown(path, uid, gid, true)
    },
    fchown(fd, uid, gid) {
      const stream = FS.getStreamChecked(fd)
      FS.chown(stream.node, uid, gid)
    },
    truncate(path, len) {
      if (len < 0) {
        throw new FS.ErrnoError(28)
      }
      let node
      if (typeof path == 'string') {
        const lookup = FS.lookupPath(path, { follow: true })
        node = lookup.node
      } else {
        node = path
      }
      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(63)
      }
      if (FS.isDir(node.mode)) {
        throw new FS.ErrnoError(31)
      }
      if (!FS.isFile(node.mode)) {
        throw new FS.ErrnoError(28)
      }
      const errCode = FS.nodePermissions(node, 'w')
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      node.node_ops.setattr(node, { size: len, timestamp: Date.now() })
    },
    ftruncate(fd, len) {
      const stream = FS.getStreamChecked(fd)
      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(28)
      }
      FS.truncate(stream.node, len)
    },
    utime(path, atime, mtime) {
      const lookup = FS.lookupPath(path, { follow: true })
      const node = lookup.node
      node.node_ops.setattr(node, { atime, mtime })
    },
    open(path, flags, mode = 438) {
      if (path === '') {
        throw new FS.ErrnoError(44)
      }
      flags = typeof flags == 'string' ? FS_modeStringToFlags(flags) : flags
      if (flags & 64) {
        mode = (mode & 4095) | 32768
      } else {
        mode = 0
      }
      let node
      if (typeof path == 'object') {
        node = path
      } else {
        const lookup = FS.lookupPath(path, {
          follow: !(flags & 131072),
          noent_okay: true,
        })
        node = lookup.node
        path = lookup.path
      }
      let created = false
      if (flags & 64) {
        if (node) {
          if (flags & 128) {
            throw new FS.ErrnoError(20)
          }
        } else {
          node = FS.mknod(path, mode, 0)
          created = true
        }
      }
      if (!node) {
        throw new FS.ErrnoError(44)
      }
      if (FS.isChrdev(node.mode)) {
        flags &= ~512
      }
      if (flags & 65536 && !FS.isDir(node.mode)) {
        throw new FS.ErrnoError(54)
      }
      if (!created) {
        const errCode = FS.mayOpen(node, flags)
        if (errCode) {
          throw new FS.ErrnoError(errCode)
        }
      }
      if (flags & 512 && !created) {
        FS.truncate(node, 0)
      }
      flags &= ~(128 | 512 | 131072)
      const stream = FS.createStream({
        node,
        path: FS.getPath(node),
        flags,
        seekable: true,
        position: 0,
        stream_ops: node.stream_ops,
        ungotten: [],
        error: false,
      })
      if (stream.stream_ops.open) {
        stream.stream_ops.open(stream)
      }
      if (Module['logReadFiles'] && !(flags & 1)) {
        if (!(path in FS.readFiles)) {
          FS.readFiles[path] = 1
        }
      }
      return stream
    },
    close(stream) {
      if (FS.isClosed(stream)) {
        throw new FS.ErrnoError(8)
      }
      if (stream.getdents) stream.getdents = null
      try {
        if (stream.stream_ops.close) {
          stream.stream_ops.close(stream)
        }
      } catch (e) {
        throw e
      } finally {
        FS.closeStream(stream.fd)
      }
      stream.fd = null
    },
    isClosed(stream) {
      return stream.fd === null
    },
    llseek(stream, offset, whence) {
      if (FS.isClosed(stream)) {
        throw new FS.ErrnoError(8)
      }
      if (!stream.seekable || !stream.stream_ops.llseek) {
        throw new FS.ErrnoError(70)
      }
      if (whence != 0 && whence != 1 && whence != 2) {
        throw new FS.ErrnoError(28)
      }
      stream.position = stream.stream_ops.llseek(stream, offset, whence)
      stream.ungotten = []
      return stream.position
    },
    read(stream, buffer, offset, length, position) {
      if (length < 0 || position < 0) {
        throw new FS.ErrnoError(28)
      }
      if (FS.isClosed(stream)) {
        throw new FS.ErrnoError(8)
      }
      if ((stream.flags & 2097155) === 1) {
        throw new FS.ErrnoError(8)
      }
      if (FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(31)
      }
      if (!stream.stream_ops.read) {
        throw new FS.ErrnoError(28)
      }
      const seeking = typeof position != 'undefined'
      if (!seeking) {
        position = stream.position
      } else if (!stream.seekable) {
        throw new FS.ErrnoError(70)
      }
      const bytesRead = stream.stream_ops.read(
        stream,
        buffer,
        offset,
        length,
        position,
      )
      if (!seeking) stream.position += bytesRead
      return bytesRead
    },
    write(stream, buffer, offset, length, position, canOwn) {
      if (length < 0 || position < 0) {
        throw new FS.ErrnoError(28)
      }
      if (FS.isClosed(stream)) {
        throw new FS.ErrnoError(8)
      }
      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(8)
      }
      if (FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(31)
      }
      if (!stream.stream_ops.write) {
        throw new FS.ErrnoError(28)
      }
      if (stream.seekable && stream.flags & 1024) {
        FS.llseek(stream, 0, 2)
      }
      const seeking = typeof position != 'undefined'
      if (!seeking) {
        position = stream.position
      } else if (!stream.seekable) {
        throw new FS.ErrnoError(70)
      }
      const bytesWritten = stream.stream_ops.write(
        stream,
        buffer,
        offset,
        length,
        position,
        canOwn,
      )
      if (!seeking) stream.position += bytesWritten
      return bytesWritten
    },
    allocate(stream, offset, length) {
      if (FS.isClosed(stream)) {
        throw new FS.ErrnoError(8)
      }
      if (offset < 0 || length <= 0) {
        throw new FS.ErrnoError(28)
      }
      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(8)
      }
      if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(43)
      }
      if (!stream.stream_ops.allocate) {
        throw new FS.ErrnoError(138)
      }
      stream.stream_ops.allocate(stream, offset, length)
    },
    mmap(stream, length, position, prot, flags) {
      if (
        (prot & 2) !== 0 &&
        (flags & 2) === 0 &&
        (stream.flags & 2097155) !== 2
      ) {
        throw new FS.ErrnoError(2)
      }
      if ((stream.flags & 2097155) === 1) {
        throw new FS.ErrnoError(2)
      }
      if (!stream.stream_ops.mmap) {
        throw new FS.ErrnoError(43)
      }
      if (!length) {
        throw new FS.ErrnoError(28)
      }
      return stream.stream_ops.mmap(stream, length, position, prot, flags)
    },
    msync(stream, buffer, offset, length, mmapFlags) {
      if (!stream.stream_ops.msync) {
        return 0
      }
      return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags)
    },
    ioctl(stream, cmd, arg) {
      if (!stream.stream_ops.ioctl) {
        throw new FS.ErrnoError(59)
      }
      return stream.stream_ops.ioctl(stream, cmd, arg)
    },
    readFile(path, opts = {}) {
      opts.flags = opts.flags || 0
      opts.encoding = opts.encoding || 'binary'
      if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
        throw new Error(`Invalid encoding type "${opts.encoding}"`)
      }
      let ret
      const stream = FS.open(path, opts.flags)
      const stat = FS.stat(path)
      const length = stat.size
      const buf = new Uint8Array(length)
      FS.read(stream, buf, 0, length, 0)
      if (opts.encoding === 'utf8') {
        ret = UTF8ArrayToString(buf)
      } else if (opts.encoding === 'binary') {
        ret = buf
      }
      FS.close(stream)
      return ret
    },
    writeFile(path, data, opts = {}) {
      opts.flags = opts.flags || 577
      const stream = FS.open(path, opts.flags, opts.mode)
      if (typeof data == 'string') {
        const buf = new Uint8Array(lengthBytesUTF8(data) + 1)
        const actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length)
        FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn)
      } else if (ArrayBuffer.isView(data)) {
        FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn)
      } else {
        throw new Error('Unsupported data type')
      }
      FS.close(stream)
    },
    cwd: () => FS.currentPath,
    chdir(path) {
      const lookup = FS.lookupPath(path, { follow: true })
      if (lookup.node === null) {
        throw new FS.ErrnoError(44)
      }
      if (!FS.isDir(lookup.node.mode)) {
        throw new FS.ErrnoError(54)
      }
      const errCode = FS.nodePermissions(lookup.node, 'x')
      if (errCode) {
        throw new FS.ErrnoError(errCode)
      }
      FS.currentPath = lookup.path
    },
    createDefaultDirectories() {
      FS.mkdir('/tmp')
      FS.mkdir('/home')
      FS.mkdir('/home/web_user')
    },
    createDefaultDevices() {
      FS.mkdir('/dev')
      FS.registerDevice(FS.makedev(1, 3), {
        read: () => 0,
        write: (stream, buffer, offset, length, pos) => length,
        llseek: () => 0,
      })
      FS.mkdev('/dev/null', FS.makedev(1, 3))
      TTY.register(FS.makedev(5, 0), TTY.default_tty_ops)
      TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops)
      FS.mkdev('/dev/tty', FS.makedev(5, 0))
      FS.mkdev('/dev/tty1', FS.makedev(6, 0))
      let randomBuffer = new Uint8Array(1024),
        randomLeft = 0
      const randomByte = () => {
        if (randomLeft === 0) {
          randomLeft = crypto.getRandomValues(randomBuffer).byteLength
        }
        return randomBuffer[--randomLeft]
      }
      FS.createDevice('/dev', 'random', randomByte)
      FS.createDevice('/dev', 'urandom', randomByte)
      FS.mkdir('/dev/shm')
      FS.mkdir('/dev/shm/tmp')
    },
    createSpecialDirectories() {
      FS.mkdir('/proc')
      const proc_self = FS.mkdir('/proc/self')
      FS.mkdir('/proc/self/fd')
      FS.mount(
        {
          mount() {
            const node = FS.createNode(proc_self, 'fd', 16895, 73)
            node.stream_ops = { llseek: MEMFS.stream_ops.llseek }
            node.node_ops = {
              lookup(parent, name) {
                const fd = +name
                const stream = FS.getStreamChecked(fd)
                const ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: () => stream.path },
                  id: fd + 1,
                }
                ret.parent = ret
                return ret
              },
              readdir() {
                return Array.from(FS.streams.entries())
                  .filter(([k, v]) => v)
                  .map(([k, v]) => k.toString())
              },
            }
            return node
          },
        },
        {},
        '/proc/self/fd',
      )
    },
    createStandardStreams(input, output, error) {
      if (input) {
        FS.createDevice('/dev', 'stdin', input)
      } else {
        FS.symlink('/dev/tty', '/dev/stdin')
      }
      if (output) {
        FS.createDevice('/dev', 'stdout', null, output)
      } else {
        FS.symlink('/dev/tty', '/dev/stdout')
      }
      if (error) {
        FS.createDevice('/dev', 'stderr', null, error)
      } else {
        FS.symlink('/dev/tty1', '/dev/stderr')
      }
      FS.open('/dev/stdin', 0)
      FS.open('/dev/stdout', 1)
      FS.open('/dev/stderr', 1)
    },
    staticInit() {
      FS.nameTable = new Array(4096)
      FS.mount(MEMFS, {}, '/')
      FS.createDefaultDirectories()
      FS.createDefaultDevices()
      FS.createSpecialDirectories()
      FS.filesystems = true ? { MEMFS, NODEFS, PROXYFS } : { MEMFS, PROXYFS }
    },
    init(input, output, error) {
      FS.initialized = true
      input ??= Module['stdin']
      output ??= Module['stdout']
      error ??= Module['stderr']
      FS.createStandardStreams(input, output, error)
    },
    quit() {
      FS.initialized = false
      _fflush(0)
      for (let i = 0; i < FS.streams.length; i++) {
        const stream = FS.streams[i]
        if (!stream) {
          continue
        }
        FS.close(stream)
      }
    },
    findObject(path, dontResolveLastLink) {
      const ret = FS.analyzePath(path, dontResolveLastLink)
      if (!ret.exists) {
        return null
      }
      return ret.object
    },
    analyzePath(path, dontResolveLastLink) {
      try {
        let lookup = FS.lookupPath(path, { follow: !dontResolveLastLink })
        path = lookup.path
      } catch (e) {}
      const ret = {
        isRoot: false,
        exists: false,
        error: 0,
        name: null,
        path: null,
        object: null,
        parentExists: false,
        parentPath: null,
        parentObject: null,
      }
      try {
        let lookup = FS.lookupPath(path, { parent: true })
        ret.parentExists = true
        ret.parentPath = lookup.path
        ret.parentObject = lookup.node
        ret.name = PATH.basename(path)
        lookup = FS.lookupPath(path, { follow: !dontResolveLastLink })
        ret.exists = true
        ret.path = lookup.path
        ret.object = lookup.node
        ret.name = lookup.node.name
        ret.isRoot = lookup.path === '/'
      } catch (e) {
        ret.error = e.errno
      }
      return ret
    },
    createPath(parent, path, canRead, canWrite) {
      parent = typeof parent == 'string' ? parent : FS.getPath(parent)
      const parts = path.split('/').reverse()
      let current
      while (parts.length) {
        const part = parts.pop()
        if (!part) continue
        current = PATH.join2(parent, part)
        try {
          FS.mkdir(current)
        } catch (e) {}
        parent = current
      }
      return current
    },
    createFile(parent, name, properties, canRead, canWrite) {
      const path = PATH.join2(
        typeof parent == 'string' ? parent : FS.getPath(parent),
        name,
      )
      const mode = FS_getMode(canRead, canWrite)
      return FS.create(path, mode)
    },
    createDataFile(parent, name, data, canRead, canWrite, canOwn) {
      let path = name
      if (parent) {
        parent = typeof parent == 'string' ? parent : FS.getPath(parent)
        path = name ? PATH.join2(parent, name) : parent
      }
      const mode = FS_getMode(canRead, canWrite)
      const node = FS.create(path, mode)
      if (data) {
        if (typeof data == 'string') {
          const arr = new Array(data.length)
          for (let i = 0, len = data.length; i < len; ++i)
            arr[i] = data.charCodeAt(i)
          data = arr
        }
        FS.chmod(node, mode | 146)
        const stream = FS.open(node, 577)
        FS.write(stream, data, 0, data.length, 0, canOwn)
        FS.close(stream)
        FS.chmod(node, mode)
      }
    },
    createDevice(parent, name, input, output) {
      const path = PATH.join2(
        typeof parent == 'string' ? parent : FS.getPath(parent),
        name,
      )
      const mode = FS_getMode(!!input, !!output)
      FS.createDevice.major ??= 64
      const dev = FS.makedev(FS.createDevice.major++, 0)
      FS.registerDevice(dev, {
        open(stream) {
          stream.seekable = false
        },
        close(stream) {
          if (output?.buffer?.length) {
            output(10)
          }
        },
        read(stream, buffer, offset, length, pos) {
          let bytesRead = 0
          for (let i = 0; i < length; i++) {
            let result
            try {
              result = input()
            } catch (e) {
              throw new FS.ErrnoError(29)
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(6)
            }
            if (result === null || result === undefined) break
            bytesRead++
            buffer[offset + i] = result
          }
          if (bytesRead) {
            stream.node.atime = Date.now()
          }
          return bytesRead
        },
        write(stream, buffer, offset, length, pos) {
          let i = 0
          for (; i < length; i++) {
            try {
              output(buffer[offset + i])
            } catch (e) {
              throw new FS.ErrnoError(29)
            }
          }
          if (length) {
            stream.node.mtime = stream.node.ctime = Date.now()
          }
          return i
        },
      })
      return FS.mkdev(path, mode, dev)
    },
    forceLoadFile(obj) {
      if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true
      try {
        obj.contents = new Uint8Array(
          fs.readFileSync(
            obj.url instanceof URL
              ? obj.url
              : new URL(obj.url, import.meta.url),
          ),
        )
        obj.usedBytes = obj.contents.length
      } catch (e) {
        throw new FS.ErrnoError(29)
      }
    },
    createLazyFile(parent, name, url, canRead, canWrite) {
      const node = FS.createFile(
        parent,
        name,
        { isDevice: false, url },
        canRead,
        canWrite,
      )
      Object.defineProperty(node, 'usedBytes', {
        get() {
          return this.contents.length
        },
      })
      const streamOps = {}
      for (const key of Object.keys(node.stream_ops)) {
        const operation = node.stream_ops[key]
        streamOps[key] = (...args) => {
          FS.forceLoadFile(node)
          return operation(...args)
        }
      }
      node.stream_ops = streamOps
      return node
    },
  }
  const SYSCALLS = {
    DEFAULT_POLLMASK: 5,
    calculateAt(dirfd, path, allowEmpty) {
      if (PATH.isAbs(path)) {
        return path
      }
      let dir
      if (dirfd === -100) {
        dir = FS.cwd()
      } else {
        const dirstream = SYSCALLS.getStreamFromFD(dirfd)
        dir = dirstream.path
      }
      if (path.length == 0) {
        if (!allowEmpty) {
          throw new FS.ErrnoError(44)
        }
        return dir
      }
      return dir + '/' + path
    },
    doStat(func, path, buf) {
      const stat = func(path)
      HEAP32[buf >> 2] = stat.dev
      HEAP32[(buf + 4) >> 2] = stat.mode
      HEAPU32[(buf + 8) >> 2] = stat.nlink
      HEAP32[(buf + 12) >> 2] = stat.uid
      HEAP32[(buf + 16) >> 2] = stat.gid
      HEAP32[(buf + 20) >> 2] = stat.rdev
      HEAP64[(buf + 24) >> 3] = BigInt(stat.size)
      HEAP32[(buf + 32) >> 2] = 4096
      HEAP32[(buf + 36) >> 2] = stat.blocks
      const atime = stat.atime.getTime()
      const mtime = stat.mtime.getTime()
      const ctime = stat.ctime.getTime()
      HEAP64[(buf + 40) >> 3] = BigInt(Math.floor(atime / 1e3))
      HEAPU32[(buf + 48) >> 2] = (atime % 1e3) * 1e3 * 1e3
      HEAP64[(buf + 56) >> 3] = BigInt(Math.floor(mtime / 1e3))
      HEAPU32[(buf + 64) >> 2] = (mtime % 1e3) * 1e3 * 1e3
      HEAP64[(buf + 72) >> 3] = BigInt(Math.floor(ctime / 1e3))
      HEAPU32[(buf + 80) >> 2] = (ctime % 1e3) * 1e3 * 1e3
      HEAP64[(buf + 88) >> 3] = BigInt(stat.ino)
      return 0
    },
    doMsync(addr, stream, len, flags, offset) {
      if (!FS.isFile(stream.node.mode)) {
        throw new FS.ErrnoError(43)
      }
      if (flags & 2) {
        return 0
      }
      const buffer = HEAPU8.slice(addr, addr + len)
      FS.msync(stream, buffer, offset, len, flags)
    },
    getStreamFromFD(fd) {
      const stream = FS.getStreamChecked(fd)
      return stream
    },
    varargs: undefined,
    getStr(ptr) {
      const ret = UTF8ToString(ptr)
      return ret
    },
  }
  const ___syscall__newselect = function (
    nfds,
    readfds,
    writefds,
    exceptfds,
    timeout,
  ) {
    try {
      let total = 0
      const srcReadLow = readfds ? HEAP32[readfds >> 2] : 0,
        srcReadHigh = readfds ? HEAP32[(readfds + 4) >> 2] : 0
      const srcWriteLow = writefds ? HEAP32[writefds >> 2] : 0,
        srcWriteHigh = writefds ? HEAP32[(writefds + 4) >> 2] : 0
      const srcExceptLow = exceptfds ? HEAP32[exceptfds >> 2] : 0,
        srcExceptHigh = exceptfds ? HEAP32[(exceptfds + 4) >> 2] : 0
      let dstReadLow = 0,
        dstReadHigh = 0
      let dstWriteLow = 0,
        dstWriteHigh = 0
      let dstExceptLow = 0,
        dstExceptHigh = 0
      const allLow =
        (readfds ? HEAP32[readfds >> 2] : 0) |
        (writefds ? HEAP32[writefds >> 2] : 0) |
        (exceptfds ? HEAP32[exceptfds >> 2] : 0)
      const allHigh =
        (readfds ? HEAP32[(readfds + 4) >> 2] : 0) |
        (writefds ? HEAP32[(writefds + 4) >> 2] : 0) |
        (exceptfds ? HEAP32[(exceptfds + 4) >> 2] : 0)
      const check = (fd, low, high, val) => (fd < 32 ? low & val : high & val)
      for (let fd = 0; fd < nfds; fd++) {
        const mask = 1 << fd % 32
        if (!check(fd, allLow, allHigh, mask)) {
          continue
        }
        const stream = SYSCALLS.getStreamFromFD(fd)
        let flags = SYSCALLS.DEFAULT_POLLMASK
        if (stream.stream_ops.poll) {
          let timeoutInMillis = -1
          if (timeout) {
            const tv_sec = readfds ? HEAP32[timeout >> 2] : 0,
              tv_usec = readfds ? HEAP32[(timeout + 4) >> 2] : 0
            timeoutInMillis = (tv_sec + tv_usec / 1e6) * 1e3
          }
          flags = stream.stream_ops.poll(stream, timeoutInMillis)
        }
        if (flags & 1 && check(fd, srcReadLow, srcReadHigh, mask)) {
          fd < 32
            ? (dstReadLow = dstReadLow | mask)
            : (dstReadHigh = dstReadHigh | mask)
          total++
        }
        if (flags & 4 && check(fd, srcWriteLow, srcWriteHigh, mask)) {
          fd < 32
            ? (dstWriteLow = dstWriteLow | mask)
            : (dstWriteHigh = dstWriteHigh | mask)
          total++
        }
        if (flags & 2 && check(fd, srcExceptLow, srcExceptHigh, mask)) {
          fd < 32
            ? (dstExceptLow = dstExceptLow | mask)
            : (dstExceptHigh = dstExceptHigh | mask)
          total++
        }
      }
      if (readfds) {
        HEAP32[readfds >> 2] = dstReadLow
        HEAP32[(readfds + 4) >> 2] = dstReadHigh
      }
      if (writefds) {
        HEAP32[writefds >> 2] = dstWriteLow
        HEAP32[(writefds + 4) >> 2] = dstWriteHigh
      }
      if (exceptfds) {
        HEAP32[exceptfds >> 2] = dstExceptLow
        HEAP32[(exceptfds + 4) >> 2] = dstExceptHigh
      }
      return total
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall__newselect.sig = 'iipppp'
  function ___syscall_accept4(fd, addr, addrlen, flags, d1, d2) {
    return -138
  }
  ___syscall_accept4.sig = 'iippiii'
  function ___syscall_bind(fd, addr, addrlen, d1, d2, d3) {
    return -138
  }
  ___syscall_bind.sig = 'iippiii'
  function ___syscall_chdir(path) {
    try {
      path = SYSCALLS.getStr(path)
      FS.chdir(path)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_chdir.sig = 'ip'
  function ___syscall_chmod(path, mode) {
    try {
      path = SYSCALLS.getStr(path)
      FS.chmod(path, mode)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_chmod.sig = 'ipi'
  function ___syscall_connect(fd, addr, addrlen, d1, d2, d3) {
    return -138
  }
  ___syscall_connect.sig = 'iippiii'
  function ___syscall_dup(fd) {
    try {
      const old = SYSCALLS.getStreamFromFD(fd)
      return FS.dupStream(old).fd
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_dup.sig = 'ii'
  function ___syscall_dup3(fd, newfd, flags) {
    try {
      const old = SYSCALLS.getStreamFromFD(fd)
      if (old.fd === newfd) return -28
      if (newfd < 0 || newfd >= FS.MAX_OPEN_FDS) return -8
      const existing = FS.getStream(newfd)
      if (existing) FS.close(existing)
      return FS.dupStream(old, newfd).fd
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_dup3.sig = 'iiii'
  function ___syscall_faccessat(dirfd, path, amode, flags) {
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      if (amode & ~7) {
        return -28
      }
      const lookup = FS.lookupPath(path, { follow: true })
      const node = lookup.node
      if (!node) {
        return -44
      }
      let perms = ''
      if (amode & 4) perms += 'r'
      if (amode & 2) perms += 'w'
      if (amode & 1) perms += 'x'
      if (perms && FS.nodePermissions(node, perms)) {
        return -2
      }
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_faccessat.sig = 'iipii'
  const ___syscall_fadvise64 = (fd, offset, len, advice) => 0
  ___syscall_fadvise64.sig = 'iijji'
  function ___syscall_fallocate(fd, mode, offset, len) {
    offset = bigintToI53Checked(offset)
    len = bigintToI53Checked(len)
    try {
      if (isNaN(offset)) return 61
      const stream = SYSCALLS.getStreamFromFD(fd)
      FS.allocate(stream, offset, len)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fallocate.sig = 'iiijj'
  function ___syscall_fchmod(fd, mode) {
    try {
      FS.fchmod(fd, mode)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fchmod.sig = 'iii'
  function ___syscall_fchmodat2(dirfd, path, mode, flags) {
    try {
      const nofollow = flags & 256
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      FS.chmod(path, mode, nofollow)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fchmodat2.sig = 'iipii'
  function ___syscall_fchown32(fd, owner, group) {
    try {
      FS.fchown(fd, owner, group)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fchown32.sig = 'iiii'
  function ___syscall_fchownat(dirfd, path, owner, group, flags) {
    try {
      path = SYSCALLS.getStr(path)
      const nofollow = flags & 256
      flags = flags & ~256
      path = SYSCALLS.calculateAt(dirfd, path)
      ;(nofollow ? FS.lchown : FS.chown)(path, owner, group)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fchownat.sig = 'iipiii'
  const syscallGetVarargI = () => {
    const ret = HEAP32[+SYSCALLS.varargs >> 2]
    SYSCALLS.varargs += 4
    return ret
  }
  const syscallGetVarargP = syscallGetVarargI
  function ___syscall_fcntl64(fd, cmd, varargs) {
    SYSCALLS.varargs = varargs
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      switch (cmd) {
        case 0: {
          let arg = syscallGetVarargI()
          if (arg < 0) {
            return -28
          }
          while (FS.streams[arg]) {
            arg++
          }
          let newStream
          newStream = FS.dupStream(stream, arg)
          return newStream.fd
        }
        case 1:
        case 2:
          return 0
        case 3:
          return stream.flags
        case 4: {
          let arg = syscallGetVarargI()
          stream.flags |= arg
          return 0
        }
        case 12: {
          let arg = syscallGetVarargP()
          const offset = 0
          HEAP16[(arg + offset) >> 1] = 2
          return 0
        }
        case 13:
        case 14:
          return 0
      }
      return -28
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fcntl64.sig = 'iiip'
  function ___syscall_fdatasync(fd) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fdatasync.sig = 'ii'
  function ___syscall_fstat64(fd, buf) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      return SYSCALLS.doStat(FS.stat, stream.path, buf)
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_fstat64.sig = 'iip'
  function ___syscall_ftruncate64(fd, length) {
    length = bigintToI53Checked(length)
    try {
      if (isNaN(length)) return 61
      FS.ftruncate(fd, length)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_ftruncate64.sig = 'iij'
  function ___syscall_getcwd(buf, size) {
    try {
      if (size === 0) return -28
      const cwd = FS.cwd()
      const cwdLengthInBytes = lengthBytesUTF8(cwd) + 1
      if (size < cwdLengthInBytes) return -68
      stringToUTF8Array(cwd, HEAPU8, buf, size)
      return cwdLengthInBytes
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_getcwd.sig = 'ipp'
  function ___syscall_getdents64(fd, dirp, count) {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      stream.getdents ||= FS.readdir(stream.path)
      const struct_size = 280
      let pos = 0
      const off = FS.llseek(stream, 0, 1)
      const startIdx = Math.floor(off / struct_size)
      const endIdx = Math.min(
        stream.getdents.length,
        startIdx + Math.floor(count / struct_size),
      )
      let idx = startIdx
      for (; idx < endIdx; idx++) {
        let id
        let type
        const name = stream.getdents[idx]
        if (name === '.') {
          id = stream.node.id
          type = 4
        } else if (name === '..') {
          const lookup = FS.lookupPath(stream.path, { parent: true })
          id = lookup.node.id
          type = 4
        } else {
          let child
          try {
            child = FS.lookupNode(stream.node, name)
          } catch (e) {
            if (e?.errno === 28) {
              continue
            }
            throw e
          }
          id = child.id
          type = FS.isChrdev(child.mode)
            ? 2
            : FS.isDir(child.mode)
              ? 4
              : FS.isLink(child.mode)
                ? 10
                : 8
        }
        HEAP64[(dirp + pos) >> 3] = BigInt(id)
        HEAP64[(dirp + pos + 8) >> 3] = BigInt((idx + 1) * struct_size)
        HEAP16[(dirp + pos + 16) >> 1] = 280
        HEAP8[dirp + pos + 18] = type
        stringToUTF8Array(name, HEAPU8, dirp + pos + 19, 256)
        pos += struct_size
      }
      FS.llseek(stream, idx * struct_size, 0)
      return pos
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_getdents64.sig = 'iipp'
  function ___syscall_ioctl(fd, op, varargs) {
    SYSCALLS.varargs = varargs
    try {
      const stream = SYSCALLS.getStreamFromFD(fd)
      switch (op) {
        case 21509: {
          if (!stream.tty) return -59
          return 0
        }
        case 21505: {
          if (!stream.tty) return -59
          if (stream.tty.ops.ioctl_tcgets) {
            const termios = stream.tty.ops.ioctl_tcgets(stream)
            let argp = syscallGetVarargP()
            HEAP32[argp >> 2] = termios.c_iflag || 0
            HEAP32[(argp + 4) >> 2] = termios.c_oflag || 0
            HEAP32[(argp + 8) >> 2] = termios.c_cflag || 0
            HEAP32[(argp + 12) >> 2] = termios.c_lflag || 0
            for (let i = 0; i < 32; i++) {
              HEAP8[argp + i + 17] = termios.c_cc[i] || 0
            }
            return 0
          }
          return 0
        }
        case 21510:
        case 21511:
        case 21512: {
          if (!stream.tty) return -59
          return 0
        }
        case 21506:
        case 21507:
        case 21508: {
          if (!stream.tty) return -59
          if (stream.tty.ops.ioctl_tcsets) {
            let argp = syscallGetVarargP()
            const c_iflag = HEAP32[argp >> 2]
            const c_oflag = HEAP32[(argp + 4) >> 2]
            const c_cflag = HEAP32[(argp + 8) >> 2]
            const c_lflag = HEAP32[(argp + 12) >> 2]
            const c_cc = []
            for (let i = 0; i < 32; i++) {
              c_cc.push(HEAP8[argp + i + 17])
            }
            return stream.tty.ops.ioctl_tcsets(stream.tty, op, {
              c_iflag,
              c_oflag,
              c_cflag,
              c_lflag,
              c_cc,
            })
          }
          return 0
        }
        case 21519: {
          if (!stream.tty) return -59
          let argp = syscallGetVarargP()
          HEAP32[argp >> 2] = 0
          return 0
        }
        case 21520: {
          if (!stream.tty) return -59
          return -28
        }
        case 21531: {
          let argp = syscallGetVarargP()
          return FS.ioctl(stream, op, argp)
        }
        case 21523: {
          if (!stream.tty) return -59
          if (stream.tty.ops.ioctl_tiocgwinsz) {
            const winsize = stream.tty.ops.ioctl_tiocgwinsz(stream.tty)
            let argp = syscallGetVarargP()
            HEAP16[argp >> 1] = winsize[0]
            HEAP16[(argp + 2) >> 1] = winsize[1]
          }
          return 0
        }
        case 21524: {
          if (!stream.tty) return -59
          return 0
        }
        case 21515: {
          if (!stream.tty) return -59
          return 0
        }
        default:
          return -28
      }
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_ioctl.sig = 'iiip'
  function ___syscall_listen(fd, backlog) {
    return -138
  }
  ___syscall_listen.sig = 'iiiiiii'
  function ___syscall_lstat64(path, buf) {
    try {
      path = SYSCALLS.getStr(path)
      return SYSCALLS.doStat(FS.lstat, path, buf)
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_lstat64.sig = 'ipp'
  function ___syscall_mkdirat(dirfd, path, mode) {
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      FS.mkdir(path, mode, 0)
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_mkdirat.sig = 'iipi'
  function ___syscall_newfstatat(dirfd, path, buf, flags) {
    try {
      path = SYSCALLS.getStr(path)
      const nofollow = flags & 256
      const allowEmpty = flags & 4096
      flags = flags & ~6400
      path = SYSCALLS.calculateAt(dirfd, path, allowEmpty)
      return SYSCALLS.doStat(nofollow ? FS.lstat : FS.stat, path, buf)
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_newfstatat.sig = 'iippi'
  function ___syscall_openat(dirfd, path, flags, varargs) {
    SYSCALLS.varargs = varargs
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      const mode = varargs ? syscallGetVarargI() : 0
      return FS.open(path, flags, mode).fd
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_openat.sig = 'iipip'
  registerWasmPlugin()
  FS.createPreloadedFile = FS_createPreloadedFile
  FS.staticInit()
  const loadPackageWithFS = () =>
    loadPostgresPackage(FS, addRunDependency, removeRunDependency)
  if (Module['calledRun']) {
    loadPackageWithFS()
  } else {
    const packagePreRun = (Module['preRun'] ??= [])
    packagePreRun.push(loadPackageWithFS)
  }
  MEMFS.doesNotExistError = new FS.ErrnoError(44)
  MEMFS.doesNotExistError.stack = '<generic error, no stack>'
  NODEFS.staticInit()
  const invokeImports = Object.fromEntries(
    [
      'di',
      'i',
      'id',
      'ii',
      'iii',
      'iiii',
      'iiiii',
      'iiiiii',
      'iiiiiii',
      'iiiiiiii',
      'iiiiiiiii',
      'iiiiiiiiii',
      'iiiiiiiiiii',
      'iiiiiiiiiiiiii',
      'iiiiiiiiiiiiiiiiii',
      'iiiiiji',
      'iiiij',
      'iiij',
      'iiji',
      'iijj',
      'ij',
      'ijiiiii',
      'ijiiiiii',
      'ijji',
      'j',
      'ji',
      'jii',
      'jiii',
      'jiiii',
      'jiiiiii',
      'jiiiiiiiii',
      'jij',
      'v',
      'vi',
      'vid',
      'vii',
      'viii',
      'viiii',
      'viiiii',
      'viiiiii',
      'viiiiiii',
      'viiiiiiii',
      'viiiiiiiii',
      'viiiiiiiiiiii',
      'viiiji',
      'viij',
      'viiji',
      'viijii',
      'viijiiii',
      'vij',
      'viji',
      'vijiji',
      'vijjii',
      'vj',
      'vji',
      'vjii',
    ].map((signature) => [
      'invoke_' + signature,
      createInvoke(
        signature[0],
        getWasmTableEntry,
        stackSave,
        stackRestore,
        () => _setThrew,
      ),
    ]),
  )
  const wasmImports = {
    __assert_fail: ___assert_fail,
    __call_sighandler: ___call_sighandler,
    __cxa_begin_catch: ___cxa_begin_catch,
    __cxa_current_primary_exception: ___cxa_current_primary_exception,
    __cxa_end_catch: ___cxa_end_catch,
    __cxa_find_matching_catch_2: ___cxa_find_matching_catch_2,
    __cxa_find_matching_catch_3: ___cxa_find_matching_catch_3,
    __cxa_rethrow: ___cxa_rethrow,
    __cxa_rethrow_primary_exception: ___cxa_rethrow_primary_exception,
    __cxa_throw: ___cxa_throw,
    __cxa_uncaught_exceptions: ___cxa_uncaught_exceptions,
    __heap_base: ___heap_base,
    __indirect_function_table: wasmTable,
    __memory_base: ___memory_base,
    __resumeException: ___resumeException,
    __stack_pointer: ___stack_pointer,
    __syscall__newselect: ___syscall__newselect,
    __syscall_accept4: ___syscall_accept4,
    __syscall_bind: ___syscall_bind,
    __syscall_chdir: ___syscall_chdir,
    __syscall_chmod: ___syscall_chmod,
    __syscall_connect: ___syscall_connect,
    __syscall_dup: ___syscall_dup,
    __syscall_dup3: ___syscall_dup3,
    __syscall_faccessat: ___syscall_faccessat,
    __syscall_fadvise64: ___syscall_fadvise64,
    __syscall_fallocate: ___syscall_fallocate,
    __syscall_fchmod: ___syscall_fchmod,
    __syscall_fchmodat2: ___syscall_fchmodat2,
    __syscall_fchown32: ___syscall_fchown32,
    __syscall_fchownat: ___syscall_fchownat,
    __syscall_fcntl64: ___syscall_fcntl64,
    __syscall_fdatasync: ___syscall_fdatasync,
    __syscall_fstat64: ___syscall_fstat64,
    __syscall_ftruncate64: ___syscall_ftruncate64,
    __syscall_getcwd: ___syscall_getcwd,
    __syscall_getdents64: ___syscall_getdents64,
    __syscall_ioctl: ___syscall_ioctl,
    __syscall_listen: ___syscall_listen,
    __syscall_lstat64: ___syscall_lstat64,
    __syscall_mkdirat: ___syscall_mkdirat,
    __syscall_newfstatat: ___syscall_newfstatat,
    __syscall_openat: ___syscall_openat,
    __syscall_pipe: ___syscall_pipe,
    __syscall_readlinkat: ___syscall_readlinkat,
    __syscall_recvfrom: ___syscall_recvfrom,
    __syscall_renameat: ___syscall_renameat,
    __syscall_rmdir: ___syscall_rmdir,
    __syscall_sendto: ___syscall_sendto,
    __syscall_socket: ___syscall_socket,
    __syscall_stat64: ___syscall_stat64,
    __syscall_statfs64: ___syscall_statfs64,
    __syscall_symlinkat: ___syscall_symlinkat,
    __syscall_truncate64: ___syscall_truncate64,
    __syscall_unlinkat: ___syscall_unlinkat,
    __syscall_utimensat: ___syscall_utimensat,
    __table_base: ___table_base,
    _abort_js: __abort_js,
    _dlopen_js: __dlopen_js,
    _dlsym_js: __dlsym_js,
    _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear,
    _emscripten_throw_longjmp: __emscripten_throw_longjmp,
    _gmtime_js: __gmtime_js,
    _localtime_js: __localtime_js,
    _mmap_js: __mmap_js,
    _munmap_js: __munmap_js,
    _setitimer_js: __setitimer_js,
    _tzset_js: __tzset_js,
    clock_time_get: _clock_time_get,
    emscripten_date_now: _emscripten_date_now,
    emscripten_force_exit: _emscripten_force_exit,
    emscripten_get_heap_max: _emscripten_get_heap_max,
    emscripten_get_now: _emscripten_get_now,
    emscripten_resize_heap: _emscripten_resize_heap,
    environ_get: _environ_get,
    environ_sizes_get: _environ_sizes_get,
    exit: _exit,
    fd_close: _fd_close,
    fd_fdstat_get: _fd_fdstat_get,
    fd_pread: _fd_pread,
    fd_pwrite: _fd_pwrite,
    fd_read: _fd_read,
    fd_seek: _fd_seek,
    fd_sync: _fd_sync,
    fd_write: _fd_write,
    getTempRet0: _getTempRet0,
    getaddrinfo: _getaddrinfo,
    getnameinfo: _getnameinfo,
    ...invokeImports,
    memory: wasmMemory,
    proc_exit: _proc_exit,
    random_get: _random_get,
    sched_yield: _sched_yield,
    setTempRet0: _setTempRet0,
  }
  let wasmExports
  const wasmInitialization = createWasm()
  const lazyWasmFunction = (wasmName) => {
    let implementation
    return (...args) => {
      implementation ??= wasmExports[wasmName]
      return implementation(...args)
    }
  }
  let ___wasm_call_ctors = () =>
    (___wasm_call_ctors = wasmExports['__wasm_call_ctors'])()

  const _IsTransactionBlock = lazyWasmFunction('IsTransactionBlock')

  const _fflush = lazyWasmFunction('fflush')

  const _pq_buffer_remaining_data = lazyWasmFunction('pq_buffer_remaining_data')

  const _fopen = lazyWasmFunction('fopen')
  const _fclose = lazyWasmFunction('fclose')

  const _malloc = lazyWasmFunction('malloc')

  const _calloc = lazyWasmFunction('calloc')

  const _ProcessStartupPacket = lazyWasmFunction('ProcessStartupPacket')
  let _htons = (a0) => (_htons = wasmExports['htons'])(a0)
  let _htonl = (a0) => (_htonl = wasmExports['htonl'])(a0)
  const _pgl_startPGlite = lazyWasmFunction('pgl_startPGlite')
  const _pgl_pq_flush = lazyWasmFunction('pgl_pq_flush')
  const _pgl_getMyProcPort = lazyWasmFunction('pgl_getMyProcPort')
  const _pgl_sendConnData = lazyWasmFunction('pgl_sendConnData')
  const _PostgresMainLongJmp = lazyWasmFunction('PostgresMainLongJmp')
  const _PostgresMainLoopOnce = lazyWasmFunction('PostgresMainLoopOnce')
  const _PostgresSendReadyForQueryIfNecessary = lazyWasmFunction(
    'PostgresSendReadyForQueryIfNecessary',
  )

  const _pgl_setPGliteActive = lazyWasmFunction('pgl_setPGliteActive')

  const _pgl_set_system_fn = lazyWasmFunction('pgl_set_system_fn')
  const _pgl_set_popen_fn = lazyWasmFunction('pgl_set_popen_fn')
  const _pgl_set_pclose_fn = lazyWasmFunction('pgl_set_pclose_fn')
  const _pgl_run_atexit_funcs = lazyWasmFunction('pgl_run_atexit_funcs')
  const _pgl_freopen = lazyWasmFunction('pgl_freopen')

  const _pgl_set_rw_cbs = lazyWasmFunction('pgl_set_rw_cbs')

  let ___funcs_on_exit = () =>
    (___funcs_on_exit = wasmExports['__funcs_on_exit'])()

  let ___dl_seterr = (a0, a1) =>
    (___dl_seterr = wasmExports['__dl_seterr'])(a0, a1)

  let _emscripten_builtin_memalign = (a0, a1) =>
    (_emscripten_builtin_memalign = wasmExports['emscripten_builtin_memalign'])(
      a0,
      a1,
    )

  let _ntohs = (a0) => (_ntohs = wasmExports['ntohs'])(a0)

  let __emscripten_timeout = (a0, a1) =>
    (__emscripten_timeout = wasmExports['_emscripten_timeout'])(a0, a1)

  let _setThrew = (a0, a1) => (_setThrew = wasmExports['setThrew'])(a0, a1)
  let __emscripten_tempret_set = (a0) =>
    (__emscripten_tempret_set = wasmExports['_emscripten_tempret_set'])(a0)
  let __emscripten_tempret_get = () =>
    (__emscripten_tempret_get = wasmExports['_emscripten_tempret_get'])()
  let __emscripten_stack_restore = (a0) =>
    (__emscripten_stack_restore = wasmExports['_emscripten_stack_restore'])(a0)
  let __emscripten_stack_alloc = (a0) =>
    (__emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'])(a0)
  let _emscripten_stack_get_current = () =>
    (_emscripten_stack_get_current =
      wasmExports['emscripten_stack_get_current'])()

  const ___cxa_decrement_exception_refcount = lazyWasmFunction(
    '__cxa_decrement_exception_refcount',
  )
  const ___cxa_increment_exception_refcount = lazyWasmFunction(
    '__cxa_increment_exception_refcount',
  )

  let ___cxa_can_catch = (a0, a1, a2) =>
    (___cxa_can_catch = wasmExports['__cxa_can_catch'])(a0, a1, a2)
  const ___cxa_get_exception_ptr = lazyWasmFunction('__cxa_get_exception_ptr')

  let ___wasm_apply_data_relocs = () =>
    (___wasm_apply_data_relocs = wasmExports['__wasm_apply_data_relocs'])()
  const callMain = createCallMain({
    getEntryFunction: () => resolveGlobalSymbol('main').sym,
    getThisProgram: () => thisProgram,
    stackAlloc,
    getHeapU32: () => HEAPU32,
    stringToUTF8OnStack,
    exitJS,
    handleException,
  })
  Object.assign(Module, {
    callMain,
    ENV,
    addFunction,
    removeFunction: (index) => {
      functionsInTableMap.delete(getWasmTableEntry(index))
      setWasmTableEntry(index, null)
      freeTableIndexes.push(index)
    },
    UTF8ToString,
    stringToUTF8OnStack,
    FS,
    _emscripten_force_exit,
    _IsTransactionBlock,
    _pq_buffer_remaining_data,
    _fopen,
    _fclose,
    _ProcessStartupPacket,
    _pgl_startPGlite,
    _pgl_pq_flush,
    _pgl_getMyProcPort,
    _pgl_sendConnData,
    _PostgresMainLongJmp,
    _PostgresMainLoopOnce,
    _PostgresSendReadyForQueryIfNecessary,
    _pgl_setPGliteActive,
    _pgl_set_system_fn,
    _pgl_set_popen_fn,
    _pgl_set_pclose_fn,
    _pgl_run_atexit_funcs,
    _pgl_freopen,
    _pgl_set_rw_cbs,
  })
  let calledRun
  const run = createRun({
    module: Module,
    getRunDependencies,
    preRun,
    initRuntime,
    preMain,
    postRun,
    isAborted: () => ABORT,
    isCalled: () => calledRun,
    markCalled: () => {
      calledRun = true
    },
  })
  const runCaller = function runCaller() {
    if (!calledRun) run()
    if (!calledRun) setDependenciesFulfilled(runCaller)
  }
  setDependenciesFulfilled(runCaller)
  if (Module['preInit']) {
    if (typeof Module['preInit'] == 'function') {
      Module['preInit'] = [Module['preInit']]
    }
    while (Module['preInit'].length > 0) {
      Module['preInit'].pop()()
    }
  }
  await wasmInitialization
  run()
  return Module as PostgresMod
}

export default PostgresModFactory
