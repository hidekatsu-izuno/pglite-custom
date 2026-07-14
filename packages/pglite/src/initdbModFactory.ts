/* eslint-disable */
// @ts-nocheck

import * as fs from 'node:fs'
import {
  addOnCallback,
  alignMemory,
  bigintToI53Checked,
  callRuntimeCallbacks,
  createCallMain,
  createPathFS,
  convertJsFunctionToWasm,
  createInvoke,
  createRunDependencyManager,
  createRun,
  createWasmTableHelpers,
  ExitStatus,
  FS_getMode,
  FS_modeStringToFlags,
  getHeapMax,
  getWasmImports,
  isInternalSym,
  PATH,
  stringToUTF8 as stringToUTF8Common,
  stringToUTF8OnStack as stringToUTF8OnStackCommon,
  stringToNewUTF8 as stringToNewUTF8Common,
  trimArray,
  updateMemoryViews as updateMemoryViewsCommon,
  ydayFromDate as ydayFromDateCommon,
  zeroMemory as zeroMemoryCommon,
  UTF8ArrayToString,
  instantiateNodeWasm,
  intArrayFromString,
  lengthBytesUTF8,
  randomFill,
  readAsync,
  readBinary,
  stringToAscii,
  stringToUTF8Array,
} from './emscriptenCommon.js'

export interface InitdbMod {
  [key: string]: any
  preInit: Array<(mod: InitdbMod) => void>
  preRun: Array<(mod: InitdbMod) => void>
  postRun: Array<(mod: InitdbMod) => void>
  arguments: string[]
  thisProgram: string
  noExitRuntime: boolean
  noInitialRun?: boolean
  wasmModule?: WebAssembly.Module
  stdin: (() => number | null) | null
  ENV: Record<string, string>
  FS: any
  PROXYFS: any
  HEAPU8: Uint8Array
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  _pgl_set_system_fn: (fn: number) => void
  _pgl_set_popen_fn: (fn: number) => void
  _pgl_set_pclose_fn: (fn: number) => void
  _pclose: (stream: number) => number
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  _fflush: (stream: number) => number
  addFunction: (fn: CallableFunction, signature: string) => number
  callMain: (args?: string[]) => number
  onRuntimeInitialized?: () => void
  print?: (text: string) => void
  printErr?: (text: string) => void
}

export const createInitdbModule = async (
  emscriptenOpts: Partial<InitdbMod> = {},
) => {
  const Module = emscriptenOpts
  let moduleOverrides = Object.assign({}, Module)
  let thisProgram = './this.program'
  const quit_ = (status, toThrow) => {
    throw toThrow
  }
  Object.assign(Module, moduleOverrides)
  moduleOverrides = null
  if (Module['thisProgram']) thisProgram = Module['thisProgram']
  if (!Module['thisProgram'] && process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, '/')
  }
  const out = Module['print'] || console.log.bind(console)
  const err = Module['printErr'] || console.error.bind(console)
  const wasmBinary = Module['wasmModule'] || Module['wasmBinary']
  let wasmMemory
  let ABORT = false
  let EXITSTATUS
  let HEAP8,
    HEAPU8,
    HEAP16,
    HEAPU16,
    HEAP32,
    HEAPU32,
    HEAPF32,
    HEAP64,
    HEAPU64,
    HEAPF64
  function updateMemoryViews() {
    const views = updateMemoryViewsCommon(wasmMemory, Module)
    HEAP8 = views.HEAP8
    HEAP16 = views.HEAP16
    HEAPU8 = views.HEAPU8
    HEAPU16 = views.HEAPU16
    HEAP32 = views.HEAP32
    HEAPU32 = views.HEAPU32
    HEAPF32 = views.HEAPF32
    HEAPF64 = views.HEAPF64
    HEAP64 = views.HEAP64
    HEAPU64 = views.HEAPU64
  }
  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory']
  } else {
    const INITIAL_MEMORY = Module['INITIAL_MEMORY'] || 67108864
    wasmMemory = new WebAssembly.Memory({
      initial: INITIAL_MEMORY / 65536,
      maximum: 32768,
    })
  }
  updateMemoryViews()
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
        addOnCallback(__ATPRERUN__, Module['preRun'].shift())
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
        addOnCallback(__ATPOSTRUN__, Module['postRun'].shift())
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
  const wasmBinaryFile = new URL('../release/initdb.wasm', import.meta.url)
  async function createWasm() {
    function receiveInstance(instance, module) {
      wasmExports = instance.exports
      wasmExports = relocateExports(wasmExports, 1024)
      mergeLibSymbols(wasmExports, 'main')
      reportUndefinedSymbols()
      addOnCallback(__ATINIT__, wasmExports['__wasm_call_ctors'])
      __RELOC_FUNCS__.push(wasmExports['__wasm_apply_data_relocs'])
      removeRunDependency('wasm-instantiate')
      return wasmExports
    }
    addRunDependency('wasm-instantiate')
    function receiveInstantiationResult(result) {
      receiveInstance(result['instance'], result['module'])
    }
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
    receiveInstantiationResult(result)
    return result
  }
  const GOT = {}
  let currentModuleWeakSymbols = new Set([])
  let GOTHandler = {
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
  currentModuleWeakSymbols = new Set()
  let ___heap_base = 205888
  const wasmTableMirror = []
  const wasmTable = new WebAssembly.Table({
    initial: 144,
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
  let relocateExports = (exports, memoryBase, replace) => {
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
  let mergeLibSymbols = (exports, libName) => {
    for (let [sym, exp] of Object.entries(exports)) {
      const setImport = (target) => {
        if (!isSymbolDefined(target)) {
          wasmImports[target] = exp
        }
      }
      setImport(sym)
      const main_alias = '__main_argc_argv'
      if (sym == 'main') {
        setImport(main_alias)
      }
      if (sym == main_alias) {
        setImport('main')
      }
    }
  }
  const asyncLoad = async (url) => new Uint8Array(await readAsync(url))
  let reportUndefinedSymbols = () => {
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
  let noExitRuntime = Module['noExitRuntime'] || false
  const ___call_sighandler = (fp, sig) => getWasmTableEntry(fp)(sig)
  ___call_sighandler.sig = 'vpi'
  const ___memory_base = new WebAssembly.Global(
    { value: 'i32', mutable: false },
    1024,
  )
  const ___stack_pointer = new WebAssembly.Global(
    { value: 'i32', mutable: true },
    205888,
  )
  const PATH_FS = createPathFS(() => FS.cwd())
  const ___table_base = new WebAssembly.Global(
    { value: 'i32', mutable: false },
    1,
  )
  const __abort_js = () => abort('')
  __abort_js.sig = 'v'
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
  const __mktime_js = function (tmPtr) {
    const ret = (() => {
      const date = new Date(
        HEAP32[(tmPtr + 20) >> 2] + 1900,
        HEAP32[(tmPtr + 16) >> 2],
        HEAP32[(tmPtr + 12) >> 2],
        HEAP32[(tmPtr + 8) >> 2],
        HEAP32[(tmPtr + 4) >> 2],
        HEAP32[tmPtr >> 2],
        0,
      )
      const dst = HEAP32[(tmPtr + 32) >> 2]
      const guessedOffset = date.getTimezoneOffset()
      const start = new Date(date.getFullYear(), 0, 1)
      const summerOffset = new Date(
        date.getFullYear(),
        6,
        1,
      ).getTimezoneOffset()
      const winterOffset = start.getTimezoneOffset()
      const dstOffset = Math.min(winterOffset, summerOffset)
      if (dst < 0) {
        HEAP32[(tmPtr + 32) >> 2] = Number(
          summerOffset != winterOffset && dstOffset == guessedOffset,
        )
      } else if (dst > 0 != (dstOffset == guessedOffset)) {
        const nonDstOffset = Math.max(winterOffset, summerOffset)
        const trueOffset = dst > 0 ? dstOffset : nonDstOffset
        date.setTime(date.getTime() + (trueOffset - guessedOffset) * 6e4)
      }
      HEAP32[(tmPtr + 24) >> 2] = date.getDay()
      const yday =
        ydayFromDateCommon(
          date,
          MONTH_DAYS_LEAP_CUMULATIVE,
          MONTH_DAYS_REGULAR_CUMULATIVE,
        ) | 0
      HEAP32[(tmPtr + 28) >> 2] = yday
      HEAP32[tmPtr >> 2] = date.getSeconds()
      HEAP32[(tmPtr + 4) >> 2] = date.getMinutes()
      HEAP32[(tmPtr + 8) >> 2] = date.getHours()
      HEAP32[(tmPtr + 12) >> 2] = date.getDate()
      HEAP32[(tmPtr + 16) >> 2] = date.getMonth()
      HEAP32[(tmPtr + 20) >> 2] = date.getYear()
      const timeMs = date.getTime()
      if (isNaN(timeMs)) {
        return -1
      }
      return timeMs / 1e3
    })()
    return BigInt(ret)
  }
  __mktime_js.sig = 'jp'
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
    quit_(1, e)
  }
  const keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0
  const _proc_exit = (code) => {
    EXITSTATUS = code
    if (!keepRuntimeAlive()) {
      Module['onExit']?.(code)
      ABORT = true
    }
    quit_(code, new ExitStatus(code))
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
      stringToUTF8Common(winterName, HEAPU8, std_name, 17)
      stringToUTF8Common(summerName, HEAPU8, dst_name, 17)
    } else {
      stringToUTF8Common(winterName, HEAPU8, dst_name, 17)
      stringToUTF8Common(summerName, HEAPU8, std_name, 17)
    }
  }
  __tzset_js.sig = 'vpppp'
  const _emscripten_date_now = () => Date.now()
  _emscripten_date_now.sig = 'd'
  const growMemory = (size) => {
    const b = wasmMemory.buffer
    const pages = ((size - b.byteLength + 65535) / 65536) | 0
    try {
      wasmMemory.grow(pages)
      updateMemoryViews()
      return 1
    } catch (e) {}
  }
  const _emscripten_resize_heap = (requestedSize) => {
    const oldSize = HEAPU8.length
    requestedSize >>>= 0
    const maxHeapSize = getHeapMax()
    if (requestedSize > maxHeapSize) {
      return false
    }
    for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
      let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown)
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296)
      const newSize = Math.min(
        maxHeapSize,
        alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536),
      )
      const replacement = growMemory(newSize)
      if (replacement) {
        return true
      }
    }
    return false
  }
  _emscripten_resize_heap.sig = 'ip'
  const ENV = {}
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
  const _getaddrinfo = () => -2
  _getaddrinfo.sig = 'ipppp'
  const stackAlloc = (sz) => __emscripten_stack_alloc(sz)
  const stringToUTF8OnStack = (str) => {
    return stringToUTF8OnStackCommon(str, stackAlloc, HEAPU8)
  }
  const removeFunction = (index) => {
    functionsInTableMap.delete(getWasmTableEntry(index))
    setWasmTableEntry(index, null)
    freeTableIndexes.push(index)
  }
  const stringToNewUTF8 = (str) => {
    return stringToNewUTF8Common(str, _malloc, HEAPU8)
  }
  const FS_createPath = (...args) => FS.createPath(...args)

  const FS_unlink = (path) => FS.unlink(path)
  const FS_createLazyFile = (...args) => FS.createLazyFile(...args)
  const FS_createDevice = (...args) => FS.createDevice(...args)
  const preloadPlugins = []
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
    size = alignMemory(size, 65536)
    const ptr = _emscripten_builtin_memalign(65536, size)
    if (ptr) zeroMemoryCommon(HEAPU8, ptr, size)
    return ptr
  }
  let MEMFS = {
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
  let NODEFS = {
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
  let PROXYFS = {
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
  let FS = {
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
          randomLeft = randomFill(randomBuffer).byteLength
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
      FS.filesystems = false ? { MEMFS, NODEFS, PROXYFS } : { MEMFS, PROXYFS }
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
        obj.contents = readBinary(obj.url)
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
  let SYSCALLS = {
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
      stringToUTF8Common(cwd, HEAPU8, buf, size)
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
        stringToUTF8Common(name, HEAPU8, dirp + pos + 19, 256)
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

  function ___syscall_readlinkat(dirfd, path, buf, bufsize) {
    try {
      path = SYSCALLS.getStr(path)
      path = SYSCALLS.calculateAt(dirfd, path)
      if (bufsize <= 0) return -28
      const ret = FS.readlink(path)
      const len = Math.min(bufsize, lengthBytesUTF8(ret))
      const endChar = HEAP8[buf + len]
      stringToUTF8Common(ret, HEAPU8, buf, bufsize + 1)
      HEAP8[buf + len] = endChar
      return len
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return -e.errno
    }
  }
  ___syscall_readlinkat.sig = 'iippp'

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
  FS.createPreloadedFile = FS_createPreloadedFile
  FS.staticInit()
  Module['FS_createPath'] = FS.createPath
  Module['FS_createDataFile'] = FS.createDataFile
  Module['FS_createPreloadedFile'] = FS.createPreloadedFile
  Module['FS_unlink'] = FS.unlink
  Module['FS_createLazyFile'] = FS.createLazyFile
  Module['FS_createDevice'] = FS.createDevice
  MEMFS.doesNotExistError = new FS.ErrnoError(44)
  MEMFS.doesNotExistError.stack = '<generic error, no stack>'
  const invoke_iiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_ii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  let wasmImports = {
    __call_sighandler: ___call_sighandler,
    __heap_base: ___heap_base,
    __indirect_function_table: wasmTable,
    __memory_base: ___memory_base,
    __stack_pointer: ___stack_pointer,
    __syscall_chmod: ___syscall_chmod,
    __syscall_dup3: ___syscall_dup3,
    __syscall_faccessat: ___syscall_faccessat,
    __syscall_fadvise64: ___syscall_fadvise64,
    __syscall_fcntl64: ___syscall_fcntl64,
    __syscall_fstat64: ___syscall_fstat64,
    __syscall_getcwd: ___syscall_getcwd,
    __syscall_getdents64: ___syscall_getdents64,
    __syscall_ioctl: ___syscall_ioctl,
    __syscall_lstat64: ___syscall_lstat64,
    __syscall_mkdirat: ___syscall_mkdirat,
    __syscall_newfstatat: ___syscall_newfstatat,
    __syscall_openat: ___syscall_openat,
    __syscall_readlinkat: ___syscall_readlinkat,
    __syscall_rmdir: ___syscall_rmdir,
    __syscall_stat64: ___syscall_stat64,
    __syscall_symlinkat: ___syscall_symlinkat,
    __syscall_unlinkat: ___syscall_unlinkat,
    __table_base: ___table_base,
    _abort_js: __abort_js,
    _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear,
    _emscripten_throw_longjmp: __emscripten_throw_longjmp,
    _localtime_js: __localtime_js,
    _mktime_js: __mktime_js,
    _mmap_js: __mmap_js,
    _munmap_js: __munmap_js,
    _setitimer_js: __setitimer_js,
    _tzset_js: __tzset_js,
    emscripten_date_now: _emscripten_date_now,
    emscripten_get_now: _emscripten_get_now,
    emscripten_resize_heap: _emscripten_resize_heap,
    environ_get: _environ_get,
    environ_sizes_get: _environ_sizes_get,
    exit: _exit,
    fd_close: _fd_close,
    fd_fdstat_get: _fd_fdstat_get,
    fd_read: _fd_read,
    fd_seek: _fd_seek,
    fd_sync: _fd_sync,
    fd_write: _fd_write,
    getaddrinfo: _getaddrinfo,
    invoke_ii,
    invoke_iiii,
    invoke_vii,
    memory: wasmMemory,
    proc_exit: _proc_exit,
  }
  let wasmExports
  const wasmInitialization = createWasm()
  let ___wasm_call_ctors = () =>
    (___wasm_call_ctors = wasmExports['__wasm_call_ctors'])()
  let _pgl_exit = (Module['_pgl_exit'] = (a0) =>
    (_pgl_exit = Module['_pgl_exit'] = wasmExports['pgl_exit'])(a0))
  let ___errno_location = (Module['___errno_location'] = () =>
    (___errno_location = Module['___errno_location'] =
      wasmExports['__errno_location'])())
  let _fflush = (Module['_fflush'] = (a0) =>
    (_fflush = Module['_fflush'] = wasmExports['fflush'])(a0))
  let _fopen = (Module['_fopen'] = (a0, a1) =>
    (_fopen = Module['_fopen'] = wasmExports['fopen'])(a0, a1))
  let _fclose = (Module['_fclose'] = (a0) =>
    (_fclose = Module['_fclose'] = wasmExports['fclose'])(a0))
  let _pgl_popen = (Module['_pgl_popen'] = (a0, a1) =>
    (_pgl_popen = Module['_pgl_popen'] = wasmExports['pgl_popen'])(a0, a1))
  let _fputs = (Module['_fputs'] = (a0, a1) =>
    (_fputs = Module['_fputs'] = wasmExports['fputs'])(a0, a1))
  let _main = (Module['_main'] = (a0, a1) =>
    (_main = Module['_main'] = wasmExports['__main_argc_argv'])(a0, a1))
  let _pgl_atexit = (Module['_pgl_atexit'] = (a0) =>
    (_pgl_atexit = Module['_pgl_atexit'] = wasmExports['pgl_atexit'])(a0))
  let _pgl_geteuid = (Module['_pgl_geteuid'] = () =>
    (_pgl_geteuid = Module['_pgl_geteuid'] = wasmExports['pgl_geteuid'])())
  let _pgl_system = (Module['_pgl_system'] = (a0) =>
    (_pgl_system = Module['_pgl_system'] = wasmExports['pgl_system'])(a0))
  let _malloc = (a0) => (_malloc = wasmExports['malloc'])(a0)
  let _calloc = (a0, a1) => (_calloc = wasmExports['calloc'])(a0, a1)
  let _pgl_setsockopt = (Module['_pgl_setsockopt'] = (a0, a1, a2, a3, a4) =>
    (_pgl_setsockopt = Module['_pgl_setsockopt'] =
      wasmExports['pgl_setsockopt'])(a0, a1, a2, a3, a4))
  let _pgl_connect = (Module['_pgl_connect'] = (a0, a1, a2) =>
    (_pgl_connect = Module['_pgl_connect'] = wasmExports['pgl_connect'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_send = (Module['_pgl_send'] = (a0, a1, a2, a3) =>
    (_pgl_send = Module['_pgl_send'] = wasmExports['pgl_send'])(a0, a1, a2, a3))
  let _pgl_recv = (Module['_pgl_recv'] = (a0, a1, a2, a3) =>
    (_pgl_recv = Module['_pgl_recv'] = wasmExports['pgl_recv'])(a0, a1, a2, a3))
  let _fgets = (Module['_fgets'] = (a0, a1, a2) =>
    (_fgets = Module['_fgets'] = wasmExports['fgets'])(a0, a1, a2))
  let _pgl_getsockopt = (Module['_pgl_getsockopt'] = (a0, a1, a2, a3, a4) =>
    (_pgl_getsockopt = Module['_pgl_getsockopt'] =
      wasmExports['pgl_getsockopt'])(a0, a1, a2, a3, a4))
  let _pgl_getsockname = (Module['_pgl_getsockname'] = (a0, a1, a2) =>
    (_pgl_getsockname = Module['_pgl_getsockname'] =
      wasmExports['pgl_getsockname'])(a0, a1, a2))
  let _pgl_poll = (Module['_pgl_poll'] = (a0, a1, a2) =>
    (_pgl_poll = Module['_pgl_poll'] = wasmExports['pgl_poll'])(a0, a1, a2))
  let _clear_setitimer = (Module['_clear_setitimer'] = () =>
    (_clear_setitimer = Module['_clear_setitimer'] =
      wasmExports['clear_setitimer'])())
  let _pgl_longjmp = (Module['_pgl_longjmp'] = (a0, a1) =>
    (_pgl_longjmp = Module['_pgl_longjmp'] = wasmExports['pgl_longjmp'])(
      a0,
      a1,
    ))
  let _pgl_siglongjmp = (Module['_pgl_siglongjmp'] = (a0, a1) =>
    (_pgl_siglongjmp = Module['_pgl_siglongjmp'] =
      wasmExports['pgl_siglongjmp'])(a0, a1))
  let _pgl_set_system_fn = (Module['_pgl_set_system_fn'] = (a0) =>
    (_pgl_set_system_fn = Module['_pgl_set_system_fn'] =
      wasmExports['pgl_set_system_fn'])(a0))
  let _pgl_set_popen_fn = (Module['_pgl_set_popen_fn'] = (a0) =>
    (_pgl_set_popen_fn = Module['_pgl_set_popen_fn'] =
      wasmExports['pgl_set_popen_fn'])(a0))
  let _pgl_set_pclose_fn = (Module['_pgl_set_pclose_fn'] = (a0) =>
    (_pgl_set_pclose_fn = Module['_pgl_set_pclose_fn'] =
      wasmExports['pgl_set_pclose_fn'])(a0))
  let _pgl_pclose = (Module['_pgl_pclose'] = (a0) =>
    (_pgl_pclose = Module['_pgl_pclose'] = wasmExports['pgl_pclose'])(a0))
  let _pclose = (Module['_pclose'] = (a0) =>
    (_pclose = Module['_pclose'] = wasmExports['pclose'])(a0))
  let _pgl_getuid = (Module['_pgl_getuid'] = () =>
    (_pgl_getuid = Module['_pgl_getuid'] = wasmExports['pgl_getuid'])())
  let _pgl_getpwuid = (Module['_pgl_getpwuid'] = (a0) =>
    (_pgl_getpwuid = Module['_pgl_getpwuid'] = wasmExports['pgl_getpwuid'])(a0))
  let _pgl_run_atexit_funcs = (Module['_pgl_run_atexit_funcs'] = () =>
    (_pgl_run_atexit_funcs = Module['_pgl_run_atexit_funcs'] =
      wasmExports['pgl_run_atexit_funcs'])())
  let _pgl_freopen = (Module['_pgl_freopen'] = (a0, a1, a2) =>
    (_pgl_freopen = Module['_pgl_freopen'] = wasmExports['pgl_freopen'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_shmget = (Module['_pgl_shmget'] = (a0, a1, a2) =>
    (_pgl_shmget = Module['_pgl_shmget'] = wasmExports['pgl_shmget'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_shmat = (Module['_pgl_shmat'] = (a0, a1, a2) =>
    (_pgl_shmat = Module['_pgl_shmat'] = wasmExports['pgl_shmat'])(a0, a1, a2))
  let _pgl_shmdt = (Module['_pgl_shmdt'] = (a0) =>
    (_pgl_shmdt = Module['_pgl_shmdt'] = wasmExports['pgl_shmdt'])(a0))
  let _pgl_shmctl = (Module['_pgl_shmctl'] = (a0, a1, a2) =>
    (_pgl_shmctl = Module['_pgl_shmctl'] = wasmExports['pgl_shmctl'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_munmap = (Module['_pgl_munmap'] = (a0, a1) =>
    (_pgl_munmap = Module['_pgl_munmap'] = wasmExports['pgl_munmap'])(a0, a1))
  let _pgl_set_rw_cbs = (Module['_pgl_set_rw_cbs'] = (a0, a1) =>
    (_pgl_set_rw_cbs = Module['_pgl_set_rw_cbs'] =
      wasmExports['pgl_set_rw_cbs'])(a0, a1))
  let _pgl_fcntl = (Module['_pgl_fcntl'] = (a0, a1, a2) =>
    (_pgl_fcntl = Module['_pgl_fcntl'] = wasmExports['pgl_fcntl'])(a0, a1, a2))
  let _strerror = (Module['_strerror'] = (a0) =>
    (_strerror = Module['_strerror'] = wasmExports['strerror'])(a0))
  let ___funcs_on_exit = () =>
    (___funcs_on_exit = wasmExports['__funcs_on_exit'])()
  let ___dl_seterr = (a0, a1) =>
    (___dl_seterr = wasmExports['__dl_seterr'])(a0, a1)
  let _htonl = (a0) => (_htonl = wasmExports['htonl'])(a0)
  let _htons = (a0) => (_htons = wasmExports['htons'])(a0)
  let _emscripten_builtin_memalign = (a0, a1) =>
    (_emscripten_builtin_memalign = wasmExports['emscripten_builtin_memalign'])(
      a0,
      a1,
    )
  let _ntohs = (a0) => (_ntohs = wasmExports['ntohs'])(a0)
  let __emscripten_timeout = (a0, a1) =>
    (__emscripten_timeout = wasmExports['_emscripten_timeout'])(a0, a1)
  let _setThrew = (a0, a1) => (_setThrew = wasmExports['setThrew'])(a0, a1)
  let __emscripten_stack_restore = (a0) =>
    (__emscripten_stack_restore = wasmExports['_emscripten_stack_restore'])(a0)
  let __emscripten_stack_alloc = (a0) =>
    (__emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'])(a0)
  let _emscripten_stack_get_current = () =>
    (_emscripten_stack_get_current =
      wasmExports['emscripten_stack_get_current'])()
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
  Module['addRunDependency'] = addRunDependency
  Module['removeRunDependency'] = removeRunDependency
  Module['callMain'] = callMain
  Module['ENV'] = ENV
  Module['addFunction'] = addFunction
  Module['removeFunction'] = removeFunction
  Module['UTF8ToString'] = UTF8ToString
  Module['stringToNewUTF8'] = stringToNewUTF8
  Module['stringToUTF8OnStack'] = stringToUTF8OnStack
  Module['FS_createPreloadedFile'] = FS_createPreloadedFile
  Module['FS_unlink'] = FS_unlink
  Module['FS_createPath'] = FS_createPath
  Module['FS_createDevice'] = FS_createDevice
  Module['FS'] = FS
  Module['FS_createDataFile'] = FS_createDataFile
  Module['FS_createLazyFile'] = FS_createLazyFile
  Module['MEMFS'] = MEMFS
  Module['PROXYFS'] = PROXYFS
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
    if (typeof Module['preInit'] == 'function')
      Module['preInit'] = [Module['preInit']]
    while (Module['preInit'].length > 0) {
      Module['preInit'].pop()()
    }
  }
  await wasmInitialization
  run()
  return Module as InitdbMod
}

const InitdbModFactory = createInitdbModule

export default InitdbModFactory
