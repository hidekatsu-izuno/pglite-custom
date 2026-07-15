import {
  createEmscriptenRuntime,
  type EmscriptenRuntimeOptions,
} from './emscriptenRuntime.js'

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
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  _pgl_set_system_fn: (fn: number) => void
  _pgl_set_popen_fn: (fn: number) => void
  _pgl_set_pclose_fn: (fn: number) => void
  _pclose: (stream: number) => number
  _fopen: (path: number, mode: number) => number
  addFunction: (fn: CallableFunction, signature: string) => number
  callMain: (args?: string[]) => number
  onRuntimeInitialized?: () => void
  print?: (text: string) => void
  printErr?: (text: string) => void
}

const initdbRuntimeOptions: EmscriptenRuntimeOptions = {
  wasmBinaryFile: new URL('../release/initdb.wasm', import.meta.url),
  wasmInput: 'module-or-binary',
  initialMemory: 67108864,
  heapBase: 205888,
  tableSize: 144,
  filesystem: {
    initializeNodeFs: false,
    mountPipeFs: false,
    preloadPostgresPackage: false,
    registerWasmPlugin: false,
  },
  publicApi: 'initdb',
}

export const InitdbModFactory = async (
  emscriptenOpts: Partial<InitdbMod> = {},
) =>
  (await createEmscriptenRuntime(
    emscriptenOpts,
    initdbRuntimeOptions,
  )) as InitdbMod
