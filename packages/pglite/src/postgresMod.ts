import {
  createEmscriptenRuntime,
  type EmscriptenRuntimeOptions,
} from './emscriptenRuntime.js'

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

const postgresRuntimeOptions: EmscriptenRuntimeOptions = {
  wasmBinaryFile: new URL('../release/pglite.wasm', import.meta.url),
  wasmInput: 'binary',
  initialMemory: 134217728,
  heapBase: 11373728,
  tableSize: 7367,
  filesystem: {
    initializeNodeFs: true,
    mountPipeFs: true,
    preloadPostgresPackage: true,
    registerWasmPlugin: true,
  },
  publicApi: 'postgres',
}

export const PostgresModFactory = async (
  emscriptenOpts: Partial<PostgresMod> = {},
) =>
  (await createEmscriptenRuntime(
    emscriptenOpts,
    postgresRuntimeOptions,
  )) as PostgresMod

