import { readFileSync } from 'node:fs'

export async function instantiateNodeWasm(
  wasmBinary: WebAssembly.Module | BufferSource | undefined,
  wasmBinaryFile: URL,
  imports: WebAssembly.Imports,
  onError: (reason: unknown) => never,
) {
  try {
    const binary = wasmBinary ?? new Uint8Array(readFileSync(wasmBinaryFile))
    const result = await WebAssembly.instantiate(binary, imports)
    return result instanceof WebAssembly.Instance
      ? { instance: result, module: binary as WebAssembly.Module }
      : result
  } catch (reason) {
    return onError(reason)
  }
}

export class ExitStatus {
  name = 'ExitStatus'

  constructor(status: number) {
    this.message = `Program terminated with exit(${status})`
    this.status = status
  }

  message: string
  status: number
}

const I53_LIMIT = 1n << 53n

export const bigintToI53Checked = (num: bigint) =>
  num < -I53_LIMIT || num > I53_LIMIT ? NaN : Number(num)

export const FS_modeStringToFlags = (str: string) => {
  const flagModes: Record<string, number> = {
    r: 0,
    'r+': 2,
    w: 512 | 64 | 1,
    'w+': 512 | 64 | 2,
    a: 1024 | 64 | 1,
    'a+': 1024 | 64 | 2,
  }
  const flags = flagModes[str]
  if (typeof flags === 'undefined') {
    throw new Error(`Unknown file open mode: ${str}`)
  }
  return flags
}

export const FS_getMode = (canRead: boolean, canWrite: boolean) => {
  let mode = 0
  if (canRead) mode |= 292 | 73
  if (canWrite) mode |= 146
  return mode
}

export const HEAP_MAX = 2147483648

export const stringToAscii = (str: string, buffer: number, heap: Int8Array) => {
  for (let i = 0; i < str.length; ++i) {
    heap[buffer++] = str.charCodeAt(i)
  }
  heap[buffer] = 0
}

export const createMemoryViews = (wasmMemory: WebAssembly.Memory) => {
  const buffer = wasmMemory.buffer
  return {
    HEAP8: new Int8Array(buffer),
    HEAPU8: new Uint8Array(buffer),
    HEAP16: new Int16Array(buffer),
    HEAPU16: new Uint16Array(buffer),
    HEAP32: new Int32Array(buffer),
    HEAPU32: new Uint32Array(buffer),
    HEAP64: new BigInt64Array(buffer),
    HEAPU64: new BigUint64Array(buffer),
    HEAPF32: new Float32Array(buffer),
    HEAPF64: new Float64Array(buffer),
  }
}

export const callRuntimeCallbacks = (
  callbacks: Array<(module: unknown) => void>,
  module: unknown,
) => {
  while (callbacks.length > 0) {
    callbacks.shift()!(module)
  }
}

export const createRunDependencyManager = (module: {
  monitorRunDependencies?: (count: number) => void
}) => {
  let count = 0
  let dependenciesFulfilled: (() => void) | null = null

  const addRunDependency = (_id: string) => {
    count++
    module.monitorRunDependencies?.(count)
  }

  const removeRunDependency = (_id: string) => {
    count--
    module.monitorRunDependencies?.(count)
    if (count === 0 && dependenciesFulfilled) {
      const callback = dependenciesFulfilled
      dependenciesFulfilled = null
      callback()
    }
  }

  return {
    addRunDependency,
    removeRunDependency,
    getUniqueRunDependency: (id: string) => id,
    getRunDependencies: () => count,
    setDependenciesFulfilled: (callback: (() => void) | null) => {
      dependenciesFulfilled = callback
    },
  }
}

export const createRun = ({
  module,
  getRunDependencies,
  preRun,
  initRuntime,
  preMain,
  postRun,
  isAborted,
  isCalled,
  markCalled,
}: {
  module: Record<string, any>
  getRunDependencies: () => number
  preRun: () => void
  initRuntime: () => void
  preMain: () => void
  postRun: () => void
  isAborted: () => boolean
  isCalled: () => boolean
  markCalled: () => void
}) => {
  const doRun = () => {
    if (isCalled()) return
    markCalled()
    if (isAborted()) return
    initRuntime()
    preMain()
    module['onRuntimeInitialized']?.()
    postRun()
  }

  return () => {
    if (getRunDependencies() > 0) return
    preRun()
    if (getRunDependencies() > 0) return
    if (module['setStatus']) {
      module['setStatus']('Running...')
      setTimeout(() => {
        setTimeout(() => module['setStatus'](''), 1)
        doRun()
      }, 1)
    } else {
      doRun()
    }
  }
}

export const createInvoke = (
  returnType: string,
  getWasmTableEntry: (index: number) => (...args: any[]) => any,
  stackSave: () => number,
  stackRestore: (stack: number) => void,
  getSetThrew: () => (value: number, flag: number) => void,
) => {
  const returnsValue = returnType !== 'v'
  const returnsBigInt = returnType === 'j'

  return (index: number, ...args: any[]) => {
    const stack = stackSave()
    try {
      const result = getWasmTableEntry(index)(...args)
      return returnsValue ? result : undefined
    } catch (error) {
      stackRestore(stack)
      if (error !== (error as any) + 0) throw error
      getSetThrew()(1, 0)
      if (returnsBigInt) return 0n
    }
  }
}

export const createCallMain = ({
  getEntryFunction,
  getThisProgram,
  stackAlloc,
  getHeapU32,
  stringToUTF8OnStack,
  exitJS,
  handleException,
}: {
  getEntryFunction: () => ((argc: number, argv: number) => unknown) | undefined
  getThisProgram: () => string
  stackAlloc: (size: number) => number
  getHeapU32: () => Uint32Array
  stringToUTF8OnStack: (value: string) => number
  exitJS: (status: unknown, implicit: boolean) => unknown
  handleException: (error: unknown) => unknown
}) => {
  return (args: string[] = []) => {
    const entryFunction = getEntryFunction()
    if (!entryFunction) return
    args.unshift(getThisProgram())
    const argc = args.length
    const argv = stackAlloc((argc + 1) * 4)
    let argvPtr = argv
    args.forEach((arg) => {
      getHeapU32()[argvPtr >> 2] = stringToUTF8OnStack(arg)
      argvPtr += 4
    })
    getHeapU32()[argvPtr >> 2] = 0
    try {
      const result = entryFunction(argc, argv)
      exitJS(result, true)
      return result
    } catch (error) {
      return handleException(error)
    }
  }
}

export const getWasmImports = (
  wasmImports: object,
  GOTHandler: ProxyHandler<object>,
) => ({
  env: wasmImports,
  wasi_snapshot_preview1: wasmImports,
  'GOT.mem': new Proxy(wasmImports, GOTHandler),
  'GOT.func': new Proxy(wasmImports, GOTHandler),
})

export const isInternalSym = (symName: string) =>
  [
    '__cpp_exception',
    '__c_longjmp',
    '__wasm_apply_data_relocs',
    '__dso_handle',
    '__tls_size',
    '__tls_align',
    '__set_stack_limits',
    '_emscripten_tls_init',
    '__wasm_init_tls',
    '__wasm_call_ctors',
    '__start_em_asm',
    '__stop_em_asm',
    '__start_em_js',
    '__stop_em_js',
  ].includes(symName) || symName.startsWith('__em_js__')

export const createWasmTableHelpers = (
  wasmTable: WebAssembly.Table,
  wasmTableMirror: Array<CallableFunction | null | undefined>,
) => ({
  getWasmTableEntry(funcPtr: number) {
    let func = wasmTableMirror[funcPtr]
    if (!func) {
      if (funcPtr >= wasmTableMirror.length) {
        wasmTableMirror.length = funcPtr + 1
      }
      wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr)
    }
    return func
  },
  setWasmTableEntry(idx: number, func: CallableFunction | null) {
    wasmTable.set(idx, func)
    wasmTableMirror[idx] = wasmTable.get(idx)
  },
})

export const uleb128Encode = (n: number, target: number[]) => {
  if (n < 128) {
    target.push(n)
  } else {
    target.push(n % 128 | 128, n >> 7)
  }
}

export const sigToWasmTypes = (sig: string) => {
  const typeNames: Record<string, string> = {
    i: 'i32',
    j: 'i64',
    f: 'f32',
    d: 'f64',
    e: 'externref',
    p: 'i32',
  }
  const type = {
    parameters: [] as string[],
    results: sig[0] === 'v' ? [] : [typeNames[sig[0]]],
  }
  for (let i = 1; i < sig.length; ++i) {
    type.parameters.push(typeNames[sig[i]])
  }
  return type
}

export const generateFuncType = (sig: string, target: number[]) => {
  const sigRet = sig.slice(0, 1)
  const sigParam = sig.slice(1)
  const typeCodes: Record<string, number> = {
    i: 127,
    p: 127,
    j: 126,
    f: 125,
    d: 124,
    e: 111,
  }
  target.push(96)
  uleb128Encode(sigParam.length, target)
  for (let i = 0; i < sigParam.length; ++i) {
    target.push(typeCodes[sigParam[i]])
  }
  if (sigRet === 'v') {
    target.push(0)
  } else {
    target.push(1, typeCodes[sigRet])
  }
}

export const convertJsFunctionToWasm = (
  func: CallableFunction,
  sig: string,
) => {
  const WebAssemblyFunction = (
    WebAssembly as typeof WebAssembly & {
      Function?: new (
        type: ReturnType<typeof sigToWasmTypes>,
        func: CallableFunction,
      ) => CallableFunction
    }
  ).Function
  if (typeof WebAssemblyFunction === 'function') {
    return new WebAssemblyFunction(sigToWasmTypes(sig), func)
  }
  const typeSectionBody = [1]
  generateFuncType(sig, typeSectionBody)
  const bytes = [0, 97, 115, 109, 1, 0, 0, 0, 1]
  uleb128Encode(typeSectionBody.length, bytes)
  bytes.push(...typeSectionBody)
  bytes.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0)
  const module = new WebAssembly.Module(new Uint8Array(bytes))
  const instance = new WebAssembly.Instance(module, { e: { f: func } })
  return instance.exports['f'] as CallableFunction
}

export const stringToUTF8OnStack = (
  str: string,
  stackAlloc: (size: number) => number,
  heap: Uint8Array,
) => {
  const size = lengthBytesUTF8(str) + 1
  const ret = stackAlloc(size)
  stringToUTF8Array(str, heap, ret, size)
  return ret
}

export const stringToNewUTF8 = (
  str: string,
  malloc: (size: number) => number,
  heap: Uint8Array,
) => {
  const size = lengthBytesUTF8(str) + 1
  const ret = malloc(size)
  if (ret) stringToUTF8Array(str, heap, ret, size)
  return ret
}

export const trimArray = (arr: string[]) => {
  let start = 0
  for (; start < arr.length; start++) {
    if (arr[start] !== '') break
  }
  let end = arr.length - 1
  for (; end >= 0; end--) {
    if (arr[end] !== '') break
  }
  if (start > end) return []
  return arr.slice(start, end - start + 1)
}

export const isLeapYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

export const ydayFromDate = (
  date: Date,
  leapDays: number[],
  regularDays: number[],
) => {
  const monthDaysCumulative = isLeapYear(date.getFullYear())
    ? leapDays
    : regularDays
  return monthDaysCumulative[date.getMonth()] + date.getDate() - 1
}

export const PATH = {
  isAbs: (path: string) => path.charAt(0) === '/',
  splitPath: (filename: string) => {
    const splitPathRe = new RegExp(
      '^(\\/?|)([\\s\\S]*?)((?:\\.{1,2}|[^\\/]+?|)(\\.[^.\\/]*|))(?:[\\/]*)$',
    )
    return splitPathRe.exec(filename)!.slice(1)
  },
  normalizeArray: (parts: string[], allowAboveRoot: boolean) => {
    let up = 0
    for (let i = parts.length - 1; i >= 0; i--) {
      const last = parts[i]
      if (last === '.') {
        parts.splice(i, 1)
      } else if (last === '..') {
        parts.splice(i, 1)
        up++
      } else if (up) {
        parts.splice(i, 1)
        up--
      }
    }
    if (allowAboveRoot) {
      for (; up; up--) {
        parts.unshift('..')
      }
    }
    return parts
  },
  normalize: (path: string) => {
    const isAbsolute = PATH.isAbs(path)
    const trailingSlash = path.substr(-1) === '/'
    path = PATH.normalizeArray(
      path.split('/').filter((p) => !!p),
      !isAbsolute,
    ).join('/')
    if (!path && !isAbsolute) {
      path = '.'
    }
    if (path && trailingSlash) {
      path += '/'
    }
    return (isAbsolute ? '/' : '') + path
  },
  dirname: (path: string) => {
    const result = PATH.splitPath(path)
    const root = result[0]
    let dir = result[1]
    if (!root && !dir) {
      return '.'
    }
    if (dir) {
      dir = dir.substring(0, dir.length - 1)
    }
    return root + dir
  },
  basename: (path: string) => {
    if (path === '/') return '/'
    path = PATH.normalize(path)
    path = path.replace(/\/$/, '')
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash === -1) return path
    return path.substring(lastSlash + 1)
  },
  join: (...paths: string[]) => PATH.normalize(paths.join('/')),
  join2: (left: string, right: string) => PATH.normalize(left + '/' + right),
}

export const createPathFS = (getCwd: () => string) => {
  const pathFS = {
    resolve: (...args: string[]) => {
      let resolvedPath = ''
      let resolvedAbsolute = false
      for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        const path = i >= 0 ? args[i] : getCwd()
        if (typeof path !== 'string') {
          throw new TypeError('Arguments to path.resolve must be strings')
        }
        if (!path) return ''
        resolvedPath = path + '/' + resolvedPath
        resolvedAbsolute = PATH.isAbs(path)
      }
      resolvedPath = PATH.normalizeArray(
        resolvedPath.split('/').filter((part) => !!part),
        !resolvedAbsolute,
      ).join('/')
      return (resolvedAbsolute ? '/' : '') + resolvedPath || '.'
    },
    relative: (from: string, to: string) => {
      from = pathFS.resolve(from).substring(1)
      to = pathFS.resolve(to).substring(1)
      const fromParts = trimArray(from.split('/'))
      const toParts = trimArray(to.split('/'))
      const length = Math.min(fromParts.length, toParts.length)
      let samePartsLength = length
      for (let i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i
          break
        }
      }
      let outputParts: string[] = []
      for (let i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..')
      }
      outputParts = outputParts.concat(toParts.slice(samePartsLength))
      return outputParts.join('/')
    },
  }
  return pathFS
}

export const UTF8ArrayToString = (
  heapOrArray: Uint8Array,
  idx = 0,
  maxBytesToRead = Number.NaN,
) => {
  const endIdx = idx + maxBytesToRead
  let endPtr = idx
  while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr
  if (
    endPtr - idx > 16 &&
    heapOrArray.buffer &&
    typeof TextDecoder !== 'undefined'
  ) {
    return new TextDecoder().decode(heapOrArray.subarray(idx, endPtr))
  }
  let str = ''
  while (idx < endPtr) {
    let u0 = heapOrArray[idx++]
    if (!(u0 & 128)) {
      str += String.fromCharCode(u0)
      continue
    }
    const u1 = heapOrArray[idx++] & 63
    if ((u0 & 224) === 192) {
      str += String.fromCharCode(((u0 & 31) << 6) | u1)
      continue
    }
    const u2 = heapOrArray[idx++] & 63
    if ((u0 & 240) === 224) {
      u0 = ((u0 & 15) << 12) | (u1 << 6) | u2
    } else {
      u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63)
    }
    if (u0 < 65536) {
      str += String.fromCharCode(u0)
    } else {
      const ch = u0 - 65536
      str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023))
    }
  }
  return str
}

export const lengthBytesUTF8 = (str: string) => {
  let len = 0
  for (let i = 0; i < str.length; ++i) {
    const c = str.charCodeAt(i)
    if (c <= 127) {
      len++
    } else if (c <= 2047) {
      len += 2
    } else if (c >= 55296 && c <= 57343) {
      len += 4
      ++i
    } else {
      len += 3
    }
  }
  return len
}

export const stringToUTF8Array = (
  str: string,
  heap: Uint8Array | number[],
  outIdx: number,
  maxBytesToWrite: number,
) => {
  if (!(maxBytesToWrite > 0)) return 0
  const startIdx = outIdx
  const endIdx = outIdx + maxBytesToWrite - 1
  for (let i = 0; i < str.length; ++i) {
    let u = str.charCodeAt(i)
    if (u >= 55296 && u <= 57343) {
      const u1 = str.charCodeAt(++i)
      u = (65536 + ((u & 1023) << 10)) | (u1 & 1023)
    }
    if (u <= 127) {
      if (outIdx >= endIdx) break
      heap[outIdx++] = u
    } else if (u <= 2047) {
      if (outIdx + 1 >= endIdx) break
      heap[outIdx++] = 192 | (u >> 6)
      heap[outIdx++] = 128 | (u & 63)
    } else if (u <= 65535) {
      if (outIdx + 2 >= endIdx) break
      heap[outIdx++] = 224 | (u >> 12)
      heap[outIdx++] = 128 | ((u >> 6) & 63)
      heap[outIdx++] = 128 | (u & 63)
    } else {
      if (outIdx + 3 >= endIdx) break
      heap[outIdx++] = 240 | (u >> 18)
      heap[outIdx++] = 128 | ((u >> 12) & 63)
      heap[outIdx++] = 128 | ((u >> 6) & 63)
      heap[outIdx++] = 128 | (u & 63)
    }
  }
  heap[outIdx] = 0
  return outIdx - startIdx
}

export function intArrayFromString(
  stringy: string,
  dontAddNull?: boolean,
  length = 0,
) {
  const len = length > 0 ? length : lengthBytesUTF8(stringy) + 1
  const u8array = new Array<number>(len)
  const numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length)
  if (dontAddNull) u8array.length = numBytesWritten
  return u8array
}
