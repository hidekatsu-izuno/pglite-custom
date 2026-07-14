/* eslint-disable */
// @ts-nocheck

import { readFileSync } from 'node:fs'
import * as fs from 'node:fs'
import {
  addOnCallback,
  alignMemory,
  bigintToI53Checked,
  assert,
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
  PROXYFS: Emscripten.FileSystemType
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
  _pgl_set_pipe_fn: (pipe_fn: number) => number
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
  _pgl_pq_flush: () => void
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  _fflush: (stream: number) => void
  _pgl_proc_exit: (code: number) => number
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

const loadLocalPackage = (
  packageName,
  callback: (data: ArrayBuffer) => void,
  errback: (error: unknown) => void,
) => {
  try {
    const data = readFileSync(
      new URL('../release/' + packageName, import.meta.url),
    )
    callback(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    )
  } catch (error) {
    errback(error)
  }
}

const handlePackageError = (error: unknown) => {
  console.error('package error:', error)
}

const assertPackage = (check: unknown, message: string) => {
  if (!check) throw message + new Error().stack
}

class DataRequest {
  constructor(Module, requests, start, end, audio) {
    this.Module = Module
    this.requests = requests
    this.start = start
    this.end = end
    this.audio = audio
  }

  open(mode, name) {
    this.name = name
    this.requests[name] = this
    this.Module['addRunDependency'](`fp ${this.name}`)
  }

  send() {}

  onload(byteArray) {
    this.finish(byteArray.subarray(this.start, this.end))
  }

  finish(byteArray) {
    this.Module['FS_createDataFile'](
      this.name,
      null,
      byteArray,
      true,
      true,
      true,
    )
    this.Module['removeRunDependency'](`fp ${this.name}`)
    this.requests[this.name] = null
  }
}

const loadPackage = (Module, metadata, runWithFS) => {
  const REMOTE_PACKAGE_NAME = 'pglite.data'
  const REMOTE_PACKAGE_SIZE = metadata['remote_package_size']
  let fetched = Module['getPreloadedPackage']
    ? Module['getPreloadedPackage'](REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE)
    : null
  if (!fetched) {
    loadLocalPackage(
      REMOTE_PACKAGE_NAME,
      (data) => {
        fetched = data
      },
      handlePackageError,
    )
  }
  const loadWithFS = (module) => runWithFS(module, metadata, fetched)
  if (Module['calledRun']) {
    loadWithFS(Module)
  } else {
    ;(Module['preRun'] ??= []).push(loadWithFS)
  }
}

const runWithFS = (Module, metadata, fetched) => {
  const PACKAGE_NAME = 'pglite.data'
  Module['FS_createPath']('/', 'home', true, true)
  Module['FS_createPath']('/home', 'postgres', true, true)
  Module['FS_createPath']('/', 'pglite', true, true)
  Module['FS_createPath']('/pglite', 'bin', true, true)
  Module['FS_createPath']('/pglite', 'icu', true, true)
  Module['FS_createPath']('/pglite/icu', 'icudt76l', true, true)
  Module['FS_createPath']('/pglite/icu/icudt76l', 'coll', true, true)
  Module['FS_createPath']('/pglite', 'lib', true, true)
  Module['FS_createPath']('/pglite/lib', 'postgresql', true, true)
  Module['FS_createPath']('/pglite/lib/postgresql', 'pgxs', true, true)
  Module['FS_createPath']('/pglite/lib/postgresql/pgxs', 'config', true, true)
  Module['FS_createPath']('/pglite/lib/postgresql/pgxs', 'src', true, true)
  Module['FS_createPath'](
    '/pglite/lib/postgresql/pgxs/src',
    'makefiles',
    true,
    true,
  )
  Module['FS_createPath']('/pglite/lib/postgresql/pgxs/src', 'test', true, true)
  Module['FS_createPath'](
    '/pglite/lib/postgresql/pgxs/src/test',
    'isolation',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/lib/postgresql/pgxs/src/test',
    'regress',
    true,
    true,
  )
  Module['FS_createPath']('/pglite', 'share', true, true)
  Module['FS_createPath']('/pglite/share', 'postgresql', true, true)
  Module['FS_createPath']('/pglite/share/postgresql', 'extension', true, true)
  Module['FS_createPath']('/pglite/share/postgresql', 'timezone', true, true)
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Africa',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'America',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone/America',
    'Argentina',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone/America',
    'Indiana',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone/America',
    'Kentucky',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone/America',
    'North_Dakota',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Antarctica',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Arctic',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Asia',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Atlantic',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Australia',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Brazil',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Canada',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Chile',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Etc',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Europe',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Indian',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Mexico',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql/timezone',
    'Pacific',
    true,
    true,
  )
  Module['FS_createPath']('/pglite/share/postgresql/timezone', 'US', true, true)
  Module['FS_createPath'](
    '/pglite/share/postgresql',
    'timezonesets',
    true,
    true,
  )
  Module['FS_createPath'](
    '/pglite/share/postgresql',
    'tsearch_data',
    true,
    true,
  )
  const requests = {}
  const files = metadata['files']
  for (let i = 0; i < files.length; ++i) {
    new DataRequest(
      Module,
      requests,
      files[i]['start'],
      files[i]['end'],
      files[i]['audio'] || 0,
    ).open('GET', files[i]['filename'])
  }
  function processPackageData(arrayBuffer) {
    assertPackage(arrayBuffer, 'Loading data file failed.')
    assertPackage(
      arrayBuffer.constructor.name === ArrayBuffer.name,
      'bad input to processPackageData',
    )
    const byteArray = new Uint8Array(arrayBuffer)
    const files = metadata['files']
    for (let i = 0; i < files.length; ++i) {
      requests[files[i].filename].onload(byteArray)
    }
    Module['removeRunDependency']('datafile_pglite.data')
  }
  Module['addRunDependency']('datafile_pglite.data')
  Module['preloadResults'] ??= {}
  Module['preloadResults'][PACKAGE_NAME] = { fromCache: false }
  if (fetched) {
    processPackageData(fetched)
    fetched = null
  } else {
    throw new Error('pglite.data is not available')
  }
}
const getDylinkMetadata = (binary) => {
  let offset = 0
  let end = 0
  function getU8() {
    return binary[offset++]
  }
  function getLEB() {
    let ret = 0
    let mul = 1
    while (1) {
      const byte = binary[offset++]
      ret += (byte & 127) * mul
      mul *= 128
      if (!(byte & 128)) break
    }
    return ret
  }
  function getString() {
    const len = getLEB()
    offset += len
    return UTF8ArrayToString(binary, offset - len, len)
  }
  function failIf(condition, message) {
    if (condition) throw new Error(message)
  }
  let name = 'dylink.0'
  if (binary instanceof WebAssembly.Module) {
    let dylinkSection = WebAssembly.Module.customSections(binary, name)
    if (dylinkSection.length === 0) {
      name = 'dylink'
      dylinkSection = WebAssembly.Module.customSections(binary, name)
    }
    failIf(dylinkSection.length === 0, 'need dylink section')
    binary = new Uint8Array(dylinkSection[0])
    end = binary.length
  } else {
    const int32View = new Uint32Array(
      new Uint8Array(binary.subarray(0, 24)).buffer,
    )
    const magicNumberFound = int32View[0] == 1836278016
    failIf(!magicNumberFound, 'need to see wasm magic number')
    failIf(binary[8] !== 0, 'need the dylink section to be first')
    offset = 9
    const section_size = getLEB()
    end = offset + section_size
    name = getString()
  }
  const customSection = {
    neededDynlibs: [],
    tlsExports: new Set(),
    weakImports: new Set(),
  }
  if (name == 'dylink') {
    customSection.memorySize = getLEB()
    customSection.memoryAlign = getLEB()
    customSection.tableSize = getLEB()
    customSection.tableAlign = getLEB()
    let neededDynlibsCount = getLEB()
    for (let i = 0; i < neededDynlibsCount; ++i) {
      const libname = getString()
      customSection.neededDynlibs.push(libname)
    }
  } else {
    failIf(name !== 'dylink.0')
    const WASM_DYLINK_MEM_INFO = 1
    const WASM_DYLINK_NEEDED = 2
    const WASM_DYLINK_EXPORT_INFO = 3
    const WASM_DYLINK_IMPORT_INFO = 4
    const WASM_SYMBOL_TLS = 256
    const WASM_SYMBOL_BINDING_MASK = 3
    const WASM_SYMBOL_BINDING_WEAK = 1
    while (offset < end) {
      const subsectionType = getU8()
      const subsectionSize = getLEB()
      if (subsectionType === WASM_DYLINK_MEM_INFO) {
        customSection.memorySize = getLEB()
        customSection.memoryAlign = getLEB()
        customSection.tableSize = getLEB()
        customSection.tableAlign = getLEB()
      } else if (subsectionType === WASM_DYLINK_NEEDED) {
        let neededDynlibsCount = getLEB()
        for (let i = 0; i < neededDynlibsCount; ++i) {
          const libname = getString()
          customSection.neededDynlibs.push(libname)
        }
      } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
        let count = getLEB()
        while (count--) {
          let symname = getString()
          let flags = getLEB()
          if (flags & WASM_SYMBOL_TLS) {
            customSection.tlsExports.add(symname)
          }
        }
      } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
        let count = getLEB()
        while (count--) {
          getString()
          let symname = getString()
          let flags = getLEB()
          if ((flags & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
            customSection.weakImports.add(symname)
          }
        }
      } else {
        offset += subsectionSize
      }
    }
  }
  return customSection
}

export const createPostgresModule = async (
  emscriptenOpts: Partial<PostgresMod> = {},
) => {
  const Module = emscriptenOpts
  Module['expectedDataFileDownloads'] ??= 0
  Module['expectedDataFileDownloads']++
  loadPackage(
    Module,
    {
      files: [
        { filename: '/home/postgres/.pgpass', start: 0, end: 204 },
        { filename: '/pglite/bin/initdb', start: 204, end: 223 },
        { filename: '/pglite/bin/pg_dump', start: 223, end: 242 },
        { filename: '/pglite/bin/postgres', start: 242, end: 261 },
        { filename: '/pglite/icu/LICENSE', start: 261, end: 26748 },
        {
          filename: '/pglite/icu/icudt76l/coll/root.res',
          start: 26748,
          end: 365756,
        },
        {
          filename: '/pglite/icu/icudt76l/coll/ucadata.icu',
          start: 365756,
          end: 943260,
        },
        {
          filename: '/pglite/lib/postgresql/cyrillic_and_mic.so',
          start: 943260,
          end: 947838,
        },
        {
          filename: '/pglite/lib/postgresql/dict_snowball.so',
          start: 947838,
          end: 1529830,
        },
        {
          filename: '/pglite/lib/postgresql/euc2004_sjis2004.so',
          start: 1529830,
          end: 1531986,
        },
        {
          filename: '/pglite/lib/postgresql/euc_cn_and_mic.so',
          start: 1531986,
          end: 1533007,
        },
        {
          filename: '/pglite/lib/postgresql/euc_jp_and_sjis.so',
          start: 1533007,
          end: 1540344,
        },
        {
          filename: '/pglite/lib/postgresql/euc_kr_and_mic.so',
          start: 1540344,
          end: 1541375,
        },
        {
          filename: '/pglite/lib/postgresql/euc_tw_and_big5.so',
          start: 1541375,
          end: 1546020,
        },
        {
          filename: '/pglite/lib/postgresql/latin2_and_win1250.so',
          start: 1546020,
          end: 1547507,
        },
        {
          filename: '/pglite/lib/postgresql/latin_and_mic.so',
          start: 1547507,
          end: 1548604,
        },
        {
          filename: '/pglite/lib/postgresql/libpqwalreceiver.so',
          start: 1548604,
          end: 1686859,
        },
        {
          filename: '/pglite/lib/postgresql/pgoutput.so',
          start: 1686859,
          end: 1700882,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/config/install-sh',
          start: 1700882,
          end: 1714879,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/config/missing',
          start: 1714879,
          end: 1716227,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/src/Makefile.global',
          start: 1716227,
          end: 1754124,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/src/Makefile.port',
          start: 1754124,
          end: 1754970,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/src/Makefile.shlib',
          start: 1754970,
          end: 1769798,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/src/makefiles/pgxs.mk',
          start: 1769798,
          end: 1785945,
        },
        {
          filename: '/pglite/lib/postgresql/pgxs/src/nls-global.mk',
          start: 1785945,
          end: 1793009,
        },
        {
          filename:
            '/pglite/lib/postgresql/pgxs/src/test/isolation/isolationtester.js',
          start: 1793009,
          end: 1908542,
        },
        {
          filename:
            '/pglite/lib/postgresql/pgxs/src/test/isolation/pg_isolation_regress.js',
          start: 1908542,
          end: 2026512,
        },
        {
          filename:
            '/pglite/lib/postgresql/pgxs/src/test/regress/pg_regress.js',
          start: 2026512,
          end: 2143968,
        },
        {
          filename: '/pglite/lib/postgresql/plpgsql.so',
          start: 2143968,
          end: 2299438,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_big5.so',
          start: 2299438,
          end: 2414250,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_cyrillic.so',
          start: 2414250,
          end: 2420283,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_euc2004.so',
          start: 2420283,
          end: 2625279,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_euc_cn.so',
          start: 2625279,
          end: 2700523,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_euc_jp.so',
          start: 2700523,
          end: 2851815,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_euc_kr.so',
          start: 2851815,
          end: 2954735,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_euc_tw.so',
          start: 2954735,
          end: 3154355,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_gb18030.so',
          start: 3154355,
          end: 3416796,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_gbk.so',
          start: 3416796,
          end: 3563392,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_iso8859.so',
          start: 3563392,
          end: 3586983,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_iso8859_1.so',
          start: 3586983,
          end: 3588038,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_johab.so',
          start: 3588038,
          end: 3749806,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_sjis.so',
          start: 3749806,
          end: 3831530,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_sjis2004.so',
          start: 3831530,
          end: 3958226,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_uhc.so',
          start: 3958226,
          end: 4125562,
        },
        {
          filename: '/pglite/lib/postgresql/utf8_and_win.so',
          start: 4125562,
          end: 4152080,
        },
        { filename: '/pglite/locale-a', start: 4152080, end: 4152105 },
        { filename: '/pglite/password', start: 4152105, end: 4152113 },
        { filename: '/pglite/pgstdin', start: 4152113, end: 4152132 },
        { filename: '/pglite/pgstdout', start: 4152132, end: 4152151 },
        {
          filename: '/pglite/share/postgresql/errcodes.txt',
          start: 4152151,
          end: 4185890,
        },
        {
          filename: '/pglite/share/postgresql/extension/plpgsql--1.0.sql',
          start: 4185890,
          end: 4186548,
        },
        {
          filename: '/pglite/share/postgresql/extension/plpgsql.control',
          start: 4186548,
          end: 4186741,
        },
        {
          filename: '/pglite/share/postgresql/information_schema.sql',
          start: 4186741,
          end: 4300738,
        },
        {
          filename: '/pglite/share/postgresql/pg_hba.conf.sample',
          start: 4300738,
          end: 4306373,
        },
        {
          filename: '/pglite/share/postgresql/pg_ident.conf.sample',
          start: 4306373,
          end: 4309054,
        },
        {
          filename: '/pglite/share/postgresql/pg_service.conf.sample',
          start: 4309054,
          end: 4309658,
        },
        {
          filename: '/pglite/share/postgresql/postgres.bki',
          start: 4309658,
          end: 5283427,
        },
        {
          filename: '/pglite/share/postgresql/postgresql.conf.sample',
          start: 5283427,
          end: 5315979,
        },
        {
          filename: '/pglite/share/postgresql/psqlrc.sample',
          start: 5315979,
          end: 5316257,
        },
        {
          filename: '/pglite/share/postgresql/snowball_create.sql',
          start: 5316257,
          end: 5361967,
        },
        {
          filename: '/pglite/share/postgresql/sql_features.txt',
          start: 5361967,
          end: 5397728,
        },
        {
          filename: '/pglite/share/postgresql/system_constraints.sql',
          start: 5397728,
          end: 5406623,
        },
        {
          filename: '/pglite/share/postgresql/system_functions.sql',
          start: 5406623,
          end: 5431502,
        },
        {
          filename: '/pglite/share/postgresql/system_views.sql',
          start: 5431502,
          end: 5484866,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Abidjan',
          start: 5484866,
          end: 5485014,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Accra',
          start: 5485014,
          end: 5485162,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Addis_Ababa',
          start: 5485162,
          end: 5485427,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Algiers',
          start: 5485427,
          end: 5486162,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Asmara',
          start: 5486162,
          end: 5486427,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Asmera',
          start: 5486427,
          end: 5486692,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Bamako',
          start: 5486692,
          end: 5486840,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Bangui',
          start: 5486840,
          end: 5487075,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Banjul',
          start: 5487075,
          end: 5487223,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Bissau',
          start: 5487223,
          end: 5487417,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Blantyre',
          start: 5487417,
          end: 5487566,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Brazzaville',
          start: 5487566,
          end: 5487801,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Bujumbura',
          start: 5487801,
          end: 5487950,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Cairo',
          start: 5487950,
          end: 5490349,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Casablanca',
          start: 5490349,
          end: 5492778,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Ceuta',
          start: 5492778,
          end: 5494830,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Conakry',
          start: 5494830,
          end: 5494978,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Dakar',
          start: 5494978,
          end: 5495126,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Dar_es_Salaam',
          start: 5495126,
          end: 5495391,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Djibouti',
          start: 5495391,
          end: 5495656,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Douala',
          start: 5495656,
          end: 5495891,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/El_Aaiun',
          start: 5495891,
          end: 5498186,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Freetown',
          start: 5498186,
          end: 5498334,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Gaborone',
          start: 5498334,
          end: 5498483,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Harare',
          start: 5498483,
          end: 5498632,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Johannesburg',
          start: 5498632,
          end: 5498878,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Juba',
          start: 5498878,
          end: 5499557,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Kampala',
          start: 5499557,
          end: 5499822,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Khartoum',
          start: 5499822,
          end: 5500501,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Kigali',
          start: 5500501,
          end: 5500650,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Kinshasa',
          start: 5500650,
          end: 5500885,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Lagos',
          start: 5500885,
          end: 5501120,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Libreville',
          start: 5501120,
          end: 5501355,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Lome',
          start: 5501355,
          end: 5501503,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Luanda',
          start: 5501503,
          end: 5501738,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Lubumbashi',
          start: 5501738,
          end: 5501887,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Lusaka',
          start: 5501887,
          end: 5502036,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Malabo',
          start: 5502036,
          end: 5502271,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Maputo',
          start: 5502271,
          end: 5502420,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Maseru',
          start: 5502420,
          end: 5502666,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Mbabane',
          start: 5502666,
          end: 5502912,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Mogadishu',
          start: 5502912,
          end: 5503177,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Monrovia',
          start: 5503177,
          end: 5503385,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Nairobi',
          start: 5503385,
          end: 5503650,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Ndjamena',
          start: 5503650,
          end: 5503849,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Niamey',
          start: 5503849,
          end: 5504084,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Nouakchott',
          start: 5504084,
          end: 5504232,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Ouagadougou',
          start: 5504232,
          end: 5504380,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Porto-Novo',
          start: 5504380,
          end: 5504615,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Sao_Tome',
          start: 5504615,
          end: 5504869,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Timbuktu',
          start: 5504869,
          end: 5505017,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Tripoli',
          start: 5505017,
          end: 5505642,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Tunis',
          start: 5505642,
          end: 5506331,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Africa/Windhoek',
          start: 5506331,
          end: 5507286,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Adak',
          start: 5507286,
          end: 5509642,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Anchorage',
          start: 5509642,
          end: 5512013,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Anguilla',
          start: 5512013,
          end: 5512259,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Antigua',
          start: 5512259,
          end: 5512505,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Araguaina',
          start: 5512505,
          end: 5513389,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Buenos_Aires',
          start: 5513389,
          end: 5514465,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Catamarca',
          start: 5514465,
          end: 5515541,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/ComodRivadavia',
          start: 5515541,
          end: 5516617,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Cordoba',
          start: 5516617,
          end: 5517693,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Argentina/Jujuy',
          start: 5517693,
          end: 5518741,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/La_Rioja',
          start: 5518741,
          end: 5519831,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Mendoza',
          start: 5519831,
          end: 5520907,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Rio_Gallegos',
          start: 5520907,
          end: 5521983,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Argentina/Salta',
          start: 5521983,
          end: 5523031,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/San_Juan',
          start: 5523031,
          end: 5524121,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/San_Luis',
          start: 5524121,
          end: 5525223,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Tucuman',
          start: 5525223,
          end: 5526327,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Argentina/Ushuaia',
          start: 5526327,
          end: 5527403,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Aruba',
          start: 5527403,
          end: 5527649,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Asuncion',
          start: 5527649,
          end: 5529307,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Atikokan',
          start: 5529307,
          end: 5529489,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Atka',
          start: 5529489,
          end: 5531845,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Bahia',
          start: 5531845,
          end: 5532869,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Bahia_Banderas',
          start: 5532869,
          end: 5533969,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Barbados',
          start: 5533969,
          end: 5534405,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Belem',
          start: 5534405,
          end: 5534981,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Belize',
          start: 5534981,
          end: 5536595,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Blanc-Sablon',
          start: 5536595,
          end: 5536841,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Boa_Vista',
          start: 5536841,
          end: 5537473,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Bogota',
          start: 5537473,
          end: 5537719,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Boise',
          start: 5537719,
          end: 5540129,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Buenos_Aires',
          start: 5540129,
          end: 5541205,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Cambridge_Bay',
          start: 5541205,
          end: 5543459,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Campo_Grande',
          start: 5543459,
          end: 5544903,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Cancun',
          start: 5544903,
          end: 5545767,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Caracas',
          start: 5545767,
          end: 5546031,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Catamarca',
          start: 5546031,
          end: 5547107,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Cayenne',
          start: 5547107,
          end: 5547305,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Cayman',
          start: 5547305,
          end: 5547487,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Chicago',
          start: 5547487,
          end: 5551079,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Chihuahua',
          start: 5551079,
          end: 5552181,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Ciudad_Juarez',
          start: 5552181,
          end: 5553719,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Coral_Harbour',
          start: 5553719,
          end: 5553901,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Cordoba',
          start: 5553901,
          end: 5554977,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Costa_Rica',
          start: 5554977,
          end: 5555293,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Coyhaique',
          start: 5555293,
          end: 5557433,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Creston',
          start: 5557433,
          end: 5557793,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Cuiaba',
          start: 5557793,
          end: 5559209,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Curacao',
          start: 5559209,
          end: 5559455,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Danmarkshavn',
          start: 5559455,
          end: 5560153,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Dawson',
          start: 5560153,
          end: 5561767,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Dawson_Creek',
          start: 5561767,
          end: 5562817,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Denver',
          start: 5562817,
          end: 5565277,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Detroit',
          start: 5565277,
          end: 5567507,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Dominica',
          start: 5567507,
          end: 5567753,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Edmonton',
          start: 5567753,
          end: 5570085,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Eirunepe',
          start: 5570085,
          end: 5570741,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/El_Salvador',
          start: 5570741,
          end: 5570965,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Ensenada',
          start: 5570965,
          end: 5573871,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Fort_Nelson',
          start: 5573871,
          end: 5576111,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Fort_Wayne',
          start: 5576111,
          end: 5577793,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Fortaleza',
          start: 5577793,
          end: 5578509,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Glace_Bay',
          start: 5578509,
          end: 5580701,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Godthab',
          start: 5580701,
          end: 5582604,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Goose_Bay',
          start: 5582604,
          end: 5585814,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Grand_Turk',
          start: 5585814,
          end: 5587648,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Grenada',
          start: 5587648,
          end: 5587894,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Guadeloupe',
          start: 5587894,
          end: 5588140,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Guatemala',
          start: 5588140,
          end: 5588420,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Guayaquil',
          start: 5588420,
          end: 5588666,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Guyana',
          start: 5588666,
          end: 5588928,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Halifax',
          start: 5588928,
          end: 5592352,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Havana',
          start: 5592352,
          end: 5594768,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Hermosillo',
          start: 5594768,
          end: 5595156,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Indiana/Indianapolis',
          start: 5595156,
          end: 5596838,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Indiana/Knox',
          start: 5596838,
          end: 5599282,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Indiana/Marengo',
          start: 5599282,
          end: 5601020,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Indiana/Petersburg',
          start: 5601020,
          end: 5602940,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Indiana/Tell_City',
          start: 5602940,
          end: 5604640,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Indiana/Vevay',
          start: 5604640,
          end: 5606070,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Indiana/Vincennes',
          start: 5606070,
          end: 5607780,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Indiana/Winamac',
          start: 5607780,
          end: 5609574,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Indianapolis',
          start: 5609574,
          end: 5611256,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Inuvik',
          start: 5611256,
          end: 5613330,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Iqaluit',
          start: 5613330,
          end: 5615532,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Jamaica',
          start: 5615532,
          end: 5616014,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Jujuy',
          start: 5616014,
          end: 5617062,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Juneau',
          start: 5617062,
          end: 5619415,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Kentucky/Louisville',
          start: 5619415,
          end: 5622203,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/Kentucky/Monticello',
          start: 5622203,
          end: 5624571,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Knox_IN',
          start: 5624571,
          end: 5627015,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Kralendijk',
          start: 5627015,
          end: 5627261,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/La_Paz',
          start: 5627261,
          end: 5627493,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Lima',
          start: 5627493,
          end: 5627899,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Los_Angeles',
          start: 5627899,
          end: 5630751,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Louisville',
          start: 5630751,
          end: 5633539,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Lower_Princes',
          start: 5633539,
          end: 5633785,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Maceio',
          start: 5633785,
          end: 5634529,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Managua',
          start: 5634529,
          end: 5634959,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Manaus',
          start: 5634959,
          end: 5635563,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Marigot',
          start: 5635563,
          end: 5635809,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Martinique',
          start: 5635809,
          end: 5636041,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Matamoros',
          start: 5636041,
          end: 5637459,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Mazatlan',
          start: 5637459,
          end: 5638519,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Mendoza',
          start: 5638519,
          end: 5639595,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Menominee',
          start: 5639595,
          end: 5641869,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Merida',
          start: 5641869,
          end: 5642873,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Metlakatla',
          start: 5642873,
          end: 5644296,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Mexico_City',
          start: 5644296,
          end: 5645518,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Miquelon',
          start: 5645518,
          end: 5647184,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Moncton',
          start: 5647184,
          end: 5650338,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Monterrey',
          start: 5650338,
          end: 5651452,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Montevideo',
          start: 5651452,
          end: 5652962,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Montreal',
          start: 5652962,
          end: 5656456,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Montserrat',
          start: 5656456,
          end: 5656702,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Nassau',
          start: 5656702,
          end: 5660196,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/New_York',
          start: 5660196,
          end: 5663748,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Nipigon',
          start: 5663748,
          end: 5667242,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Nome',
          start: 5667242,
          end: 5669609,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Noronha',
          start: 5669609,
          end: 5670325,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/North_Dakota/Beulah',
          start: 5670325,
          end: 5672721,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/North_Dakota/Center',
          start: 5672721,
          end: 5675117,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/America/North_Dakota/New_Salem',
          start: 5675117,
          end: 5677513,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Nuuk',
          start: 5677513,
          end: 5679416,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Ojinaga',
          start: 5679416,
          end: 5680940,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Panama',
          start: 5680940,
          end: 5681122,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Pangnirtung',
          start: 5681122,
          end: 5683324,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Paramaribo',
          start: 5683324,
          end: 5683586,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Phoenix',
          start: 5683586,
          end: 5683946,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Port-au-Prince',
          start: 5683946,
          end: 5685380,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Port_of_Spain',
          start: 5685380,
          end: 5685626,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Porto_Acre',
          start: 5685626,
          end: 5686254,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Porto_Velho',
          start: 5686254,
          end: 5686830,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Puerto_Rico',
          start: 5686830,
          end: 5687076,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Punta_Arenas',
          start: 5687076,
          end: 5688992,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Rainy_River',
          start: 5688992,
          end: 5691860,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Rankin_Inlet',
          start: 5691860,
          end: 5693926,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Recife',
          start: 5693926,
          end: 5694642,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Regina',
          start: 5694642,
          end: 5695622,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Resolute',
          start: 5695622,
          end: 5697688,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Rio_Branco',
          start: 5697688,
          end: 5698316,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Rosario',
          start: 5698316,
          end: 5699392,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Santa_Isabel',
          start: 5699392,
          end: 5702298,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Santarem',
          start: 5702298,
          end: 5702900,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Santiago',
          start: 5702900,
          end: 5705429,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Santo_Domingo',
          start: 5705429,
          end: 5705887,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Sao_Paulo',
          start: 5705887,
          end: 5707331,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Scoresbysund',
          start: 5707331,
          end: 5709280,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Shiprock',
          start: 5709280,
          end: 5711740,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Sitka',
          start: 5711740,
          end: 5714069,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/St_Barthelemy',
          start: 5714069,
          end: 5714315,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/St_Johns',
          start: 5714315,
          end: 5717970,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/St_Kitts',
          start: 5717970,
          end: 5718216,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/St_Lucia',
          start: 5718216,
          end: 5718462,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/St_Thomas',
          start: 5718462,
          end: 5718708,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/St_Vincent',
          start: 5718708,
          end: 5718954,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Swift_Current',
          start: 5718954,
          end: 5719514,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Tegucigalpa',
          start: 5719514,
          end: 5719766,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Thule',
          start: 5719766,
          end: 5721268,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Thunder_Bay',
          start: 5721268,
          end: 5724762,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Tijuana',
          start: 5724762,
          end: 5727668,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Toronto',
          start: 5727668,
          end: 5731162,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Tortola',
          start: 5731162,
          end: 5731408,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Vancouver',
          start: 5731408,
          end: 5734300,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Virgin',
          start: 5734300,
          end: 5734546,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Whitehorse',
          start: 5734546,
          end: 5736160,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Winnipeg',
          start: 5736160,
          end: 5739028,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Yakutat',
          start: 5739028,
          end: 5741333,
        },
        {
          filename: '/pglite/share/postgresql/timezone/America/Yellowknife',
          start: 5741333,
          end: 5743665,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Casey',
          start: 5743665,
          end: 5744102,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Davis',
          start: 5744102,
          end: 5744399,
        },
        {
          filename:
            '/pglite/share/postgresql/timezone/Antarctica/DumontDUrville',
          start: 5744399,
          end: 5744585,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Macquarie',
          start: 5744585,
          end: 5746845,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Mawson',
          start: 5746845,
          end: 5747044,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/McMurdo',
          start: 5747044,
          end: 5749481,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Palmer',
          start: 5749481,
          end: 5750899,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Rothera',
          start: 5750899,
          end: 5751063,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/South_Pole',
          start: 5751063,
          end: 5753500,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Syowa',
          start: 5753500,
          end: 5753665,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Troll',
          start: 5753665,
          end: 5754827,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Antarctica/Vostok',
          start: 5754827,
          end: 5755054,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Arctic/Longyearbyen',
          start: 5755054,
          end: 5757352,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Aden',
          start: 5757352,
          end: 5757517,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Almaty',
          start: 5757517,
          end: 5758514,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Amman',
          start: 5758514,
          end: 5759961,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Anadyr',
          start: 5759961,
          end: 5761149,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Aqtau',
          start: 5761149,
          end: 5762132,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Aqtobe',
          start: 5762132,
          end: 5763143,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ashgabat',
          start: 5763143,
          end: 5763762,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ashkhabad',
          start: 5763762,
          end: 5764381,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Atyrau',
          start: 5764381,
          end: 5765372,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Baghdad',
          start: 5765372,
          end: 5766355,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Bahrain',
          start: 5766355,
          end: 5766554,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Baku',
          start: 5766554,
          end: 5767781,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Bangkok',
          start: 5767781,
          end: 5767980,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Barnaul',
          start: 5767980,
          end: 5769201,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Beirut',
          start: 5769201,
          end: 5771355,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Bishkek',
          start: 5771355,
          end: 5772338,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Brunei',
          start: 5772338,
          end: 5772821,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Calcutta',
          start: 5772821,
          end: 5773106,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Chita',
          start: 5773106,
          end: 5774327,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Choibalsan',
          start: 5774327,
          end: 5775218,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Chongqing',
          start: 5775218,
          end: 5775779,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Chungking',
          start: 5775779,
          end: 5776340,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Colombo',
          start: 5776340,
          end: 5776712,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Dacca',
          start: 5776712,
          end: 5777049,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Damascus',
          start: 5777049,
          end: 5778936,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Dhaka',
          start: 5778936,
          end: 5779273,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Dili',
          start: 5779273,
          end: 5779544,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Dubai',
          start: 5779544,
          end: 5779709,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Dushanbe',
          start: 5779709,
          end: 5780300,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Famagusta',
          start: 5780300,
          end: 5782328,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Gaza',
          start: 5782328,
          end: 5786172,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Harbin',
          start: 5786172,
          end: 5786733,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Hebron',
          start: 5786733,
          end: 5790605,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ho_Chi_Minh',
          start: 5790605,
          end: 5790956,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Hong_Kong',
          start: 5790956,
          end: 5792189,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Hovd',
          start: 5792189,
          end: 5793080,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Irkutsk',
          start: 5793080,
          end: 5794323,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Istanbul',
          start: 5794323,
          end: 5796270,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Jakarta',
          start: 5796270,
          end: 5796653,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Jayapura',
          start: 5796653,
          end: 5796874,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Jerusalem',
          start: 5796874,
          end: 5799262,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kabul',
          start: 5799262,
          end: 5799470,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kamchatka',
          start: 5799470,
          end: 5800636,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Karachi',
          start: 5800636,
          end: 5801015,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kashgar',
          start: 5801015,
          end: 5801180,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kathmandu',
          start: 5801180,
          end: 5801392,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Katmandu',
          start: 5801392,
          end: 5801604,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Khandyga',
          start: 5801604,
          end: 5802875,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kolkata',
          start: 5802875,
          end: 5803160,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Krasnoyarsk',
          start: 5803160,
          end: 5804367,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kuala_Lumpur',
          start: 5804367,
          end: 5804782,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kuching',
          start: 5804782,
          end: 5805265,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Kuwait',
          start: 5805265,
          end: 5805430,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Macao',
          start: 5805430,
          end: 5806657,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Macau',
          start: 5806657,
          end: 5807884,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Magadan',
          start: 5807884,
          end: 5809106,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Makassar',
          start: 5809106,
          end: 5809360,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Manila',
          start: 5809360,
          end: 5809782,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Muscat',
          start: 5809782,
          end: 5809947,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Nicosia',
          start: 5809947,
          end: 5811949,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Novokuznetsk',
          start: 5811949,
          end: 5813114,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Novosibirsk',
          start: 5813114,
          end: 5814335,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Omsk',
          start: 5814335,
          end: 5815542,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Oral',
          start: 5815542,
          end: 5816547,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Phnom_Penh',
          start: 5816547,
          end: 5816746,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Pontianak',
          start: 5816746,
          end: 5817099,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Pyongyang',
          start: 5817099,
          end: 5817336,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Qatar',
          start: 5817336,
          end: 5817535,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Qostanay',
          start: 5817535,
          end: 5818574,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Qyzylorda',
          start: 5818574,
          end: 5819599,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Rangoon',
          start: 5819599,
          end: 5819867,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Riyadh',
          start: 5819867,
          end: 5820032,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Saigon',
          start: 5820032,
          end: 5820383,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Sakhalin',
          start: 5820383,
          end: 5821585,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Samarkand',
          start: 5821585,
          end: 5822162,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Seoul',
          start: 5822162,
          end: 5822779,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Shanghai',
          start: 5822779,
          end: 5823340,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Singapore',
          start: 5823340,
          end: 5823755,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Srednekolymsk',
          start: 5823755,
          end: 5824963,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Taipei',
          start: 5824963,
          end: 5825724,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Tashkent',
          start: 5825724,
          end: 5826315,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Tbilisi',
          start: 5826315,
          end: 5827350,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Tehran',
          start: 5827350,
          end: 5828612,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Tel_Aviv',
          start: 5828612,
          end: 5831e3,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Thimbu',
          start: 5831e3,
          end: 5831203,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Thimphu',
          start: 5831203,
          end: 5831406,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Tokyo',
          start: 5831406,
          end: 5831715,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Tomsk',
          start: 5831715,
          end: 5832936,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ujung_Pandang',
          start: 5832936,
          end: 5833190,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ulaanbaatar',
          start: 5833190,
          end: 5834081,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ulan_Bator',
          start: 5834081,
          end: 5834972,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Urumqi',
          start: 5834972,
          end: 5835137,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Ust-Nera',
          start: 5835137,
          end: 5836389,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Vientiane',
          start: 5836389,
          end: 5836588,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Vladivostok',
          start: 5836588,
          end: 5837796,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Yakutsk',
          start: 5837796,
          end: 5839003,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Yangon',
          start: 5839003,
          end: 5839271,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Yekaterinburg',
          start: 5839271,
          end: 5840514,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Asia/Yerevan',
          start: 5840514,
          end: 5841665,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Azores',
          start: 5841665,
          end: 5845121,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Bermuda',
          start: 5845121,
          end: 5847517,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Canary',
          start: 5847517,
          end: 5849414,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Cape_Verde',
          start: 5849414,
          end: 5849684,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Faeroe',
          start: 5849684,
          end: 5851499,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Faroe',
          start: 5851499,
          end: 5853314,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Jan_Mayen',
          start: 5853314,
          end: 5855612,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Madeira',
          start: 5855612,
          end: 5858989,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Reykjavik',
          start: 5858989,
          end: 5859137,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/South_Georgia',
          start: 5859137,
          end: 5859301,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/St_Helena',
          start: 5859301,
          end: 5859449,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Atlantic/Stanley',
          start: 5859449,
          end: 5860663,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/ACT',
          start: 5860663,
          end: 5862853,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Adelaide',
          start: 5862853,
          end: 5865061,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Brisbane',
          start: 5865061,
          end: 5865480,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Broken_Hill',
          start: 5865480,
          end: 5867709,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Canberra',
          start: 5867709,
          end: 5869899,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Currie',
          start: 5869899,
          end: 5872257,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Darwin',
          start: 5872257,
          end: 5872582,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Eucla',
          start: 5872582,
          end: 5873052,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Hobart',
          start: 5873052,
          end: 5875410,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/LHI',
          start: 5875410,
          end: 5877270,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Lindeman',
          start: 5877270,
          end: 5877745,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Lord_Howe',
          start: 5877745,
          end: 5879605,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Melbourne',
          start: 5879605,
          end: 5881795,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/NSW',
          start: 5881795,
          end: 5883985,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/North',
          start: 5883985,
          end: 5884310,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Perth',
          start: 5884310,
          end: 5884756,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Queensland',
          start: 5884756,
          end: 5885175,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/South',
          start: 5885175,
          end: 5887383,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Sydney',
          start: 5887383,
          end: 5889573,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Tasmania',
          start: 5889573,
          end: 5891931,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Victoria',
          start: 5891931,
          end: 5894121,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/West',
          start: 5894121,
          end: 5894567,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Australia/Yancowinna',
          start: 5894567,
          end: 5896796,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Brazil/Acre',
          start: 5896796,
          end: 5897424,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Brazil/DeNoronha',
          start: 5897424,
          end: 5898140,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Brazil/East',
          start: 5898140,
          end: 5899584,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Brazil/West',
          start: 5899584,
          end: 5900188,
        },
        {
          filename: '/pglite/share/postgresql/timezone/CET',
          start: 5900188,
          end: 5903121,
        },
        {
          filename: '/pglite/share/postgresql/timezone/CST6CDT',
          start: 5903121,
          end: 5906713,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Atlantic',
          start: 5906713,
          end: 5910137,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Central',
          start: 5910137,
          end: 5913005,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Eastern',
          start: 5913005,
          end: 5916499,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Mountain',
          start: 5916499,
          end: 5918831,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Newfoundland',
          start: 5918831,
          end: 5922486,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Pacific',
          start: 5922486,
          end: 5925378,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Saskatchewan',
          start: 5925378,
          end: 5926358,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Canada/Yukon',
          start: 5926358,
          end: 5927972,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Chile/Continental',
          start: 5927972,
          end: 5930501,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Chile/EasterIsland',
          start: 5930501,
          end: 5932734,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Cuba',
          start: 5932734,
          end: 5935150,
        },
        {
          filename: '/pglite/share/postgresql/timezone/EET',
          start: 5935150,
          end: 5937412,
        },
        {
          filename: '/pglite/share/postgresql/timezone/EST',
          start: 5937412,
          end: 5937594,
        },
        {
          filename: '/pglite/share/postgresql/timezone/EST5EDT',
          start: 5937594,
          end: 5941146,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Egypt',
          start: 5941146,
          end: 5943545,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Eire',
          start: 5943545,
          end: 5947037,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT',
          start: 5947037,
          end: 5947151,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+0',
          start: 5947151,
          end: 5947265,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+1',
          start: 5947265,
          end: 5947381,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+10',
          start: 5947381,
          end: 5947498,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+11',
          start: 5947498,
          end: 5947615,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+12',
          start: 5947615,
          end: 5947732,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+2',
          start: 5947732,
          end: 5947848,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+3',
          start: 5947848,
          end: 5947964,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+4',
          start: 5947964,
          end: 5948080,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+5',
          start: 5948080,
          end: 5948196,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+6',
          start: 5948196,
          end: 5948312,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+7',
          start: 5948312,
          end: 5948428,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+8',
          start: 5948428,
          end: 5948544,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT+9',
          start: 5948544,
          end: 5948660,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-0',
          start: 5948660,
          end: 5948774,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-1',
          start: 5948774,
          end: 5948891,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-10',
          start: 5948891,
          end: 5949009,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-11',
          start: 5949009,
          end: 5949127,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-12',
          start: 5949127,
          end: 5949245,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-13',
          start: 5949245,
          end: 5949363,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-14',
          start: 5949363,
          end: 5949481,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-2',
          start: 5949481,
          end: 5949598,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-3',
          start: 5949598,
          end: 5949715,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-4',
          start: 5949715,
          end: 5949832,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-5',
          start: 5949832,
          end: 5949949,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-6',
          start: 5949949,
          end: 5950066,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-7',
          start: 5950066,
          end: 5950183,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-8',
          start: 5950183,
          end: 5950300,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT-9',
          start: 5950300,
          end: 5950417,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/GMT0',
          start: 5950417,
          end: 5950531,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/Greenwich',
          start: 5950531,
          end: 5950645,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/UCT',
          start: 5950645,
          end: 5950759,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/UTC',
          start: 5950759,
          end: 5950873,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/Universal',
          start: 5950873,
          end: 5950987,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Etc/Zulu',
          start: 5950987,
          end: 5951101,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Amsterdam',
          start: 5951101,
          end: 5954034,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Andorra',
          start: 5954034,
          end: 5955776,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Astrakhan',
          start: 5955776,
          end: 5956941,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Athens',
          start: 5956941,
          end: 5959203,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Belfast',
          start: 5959203,
          end: 5962867,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Belgrade',
          start: 5962867,
          end: 5964787,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Berlin',
          start: 5964787,
          end: 5967085,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Bratislava',
          start: 5967085,
          end: 5969386,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Brussels',
          start: 5969386,
          end: 5972319,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Bucharest',
          start: 5972319,
          end: 5974503,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Budapest',
          start: 5974503,
          end: 5976871,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Busingen',
          start: 5976871,
          end: 5978780,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Chisinau',
          start: 5978780,
          end: 5981170,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Copenhagen',
          start: 5981170,
          end: 5983468,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Dublin',
          start: 5983468,
          end: 5986960,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Gibraltar',
          start: 5986960,
          end: 5990028,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Guernsey',
          start: 5990028,
          end: 5993692,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Helsinki',
          start: 5993692,
          end: 5995592,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Isle_of_Man',
          start: 5995592,
          end: 5999256,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Istanbul',
          start: 5999256,
          end: 6001203,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Jersey',
          start: 6001203,
          end: 6004867,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Kaliningrad',
          start: 6004867,
          end: 6006360,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Kiev',
          start: 6006360,
          end: 6008480,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Kirov',
          start: 6008480,
          end: 6009665,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Kyiv',
          start: 6009665,
          end: 6011785,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Lisbon',
          start: 6011785,
          end: 6015312,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Ljubljana',
          start: 6015312,
          end: 6017232,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/London',
          start: 6017232,
          end: 6020896,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Luxembourg',
          start: 6020896,
          end: 6023829,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Madrid',
          start: 6023829,
          end: 6026443,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Malta',
          start: 6026443,
          end: 6029063,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Mariehamn',
          start: 6029063,
          end: 6030963,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Minsk',
          start: 6030963,
          end: 6032284,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Monaco',
          start: 6032284,
          end: 6035246,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Moscow',
          start: 6035246,
          end: 6036781,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Nicosia',
          start: 6036781,
          end: 6038783,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Oslo',
          start: 6038783,
          end: 6041081,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Paris',
          start: 6041081,
          end: 6044043,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Podgorica',
          start: 6044043,
          end: 6045963,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Prague',
          start: 6045963,
          end: 6048264,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Riga',
          start: 6048264,
          end: 6050462,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Rome',
          start: 6050462,
          end: 6053103,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Samara',
          start: 6053103,
          end: 6054318,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/San_Marino',
          start: 6054318,
          end: 6056959,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Sarajevo',
          start: 6056959,
          end: 6058879,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Saratov',
          start: 6058879,
          end: 6060062,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Simferopol',
          start: 6060062,
          end: 6061531,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Skopje',
          start: 6061531,
          end: 6063451,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Sofia',
          start: 6063451,
          end: 6065528,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Stockholm',
          start: 6065528,
          end: 6067826,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Tallinn',
          start: 6067826,
          end: 6069974,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Tirane',
          start: 6069974,
          end: 6072058,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Tiraspol',
          start: 6072058,
          end: 6074448,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Ulyanovsk',
          start: 6074448,
          end: 6075715,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Uzhgorod',
          start: 6075715,
          end: 6077835,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Vaduz',
          start: 6077835,
          end: 6079744,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Vatican',
          start: 6079744,
          end: 6082385,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Vienna',
          start: 6082385,
          end: 6084585,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Vilnius',
          start: 6084585,
          end: 6086747,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Volgograd',
          start: 6086747,
          end: 6087940,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Warsaw',
          start: 6087940,
          end: 6090594,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Zagreb',
          start: 6090594,
          end: 6092514,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Zaporozhye',
          start: 6092514,
          end: 6094634,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Europe/Zurich',
          start: 6094634,
          end: 6096543,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Factory',
          start: 6096543,
          end: 6096659,
        },
        {
          filename: '/pglite/share/postgresql/timezone/GB',
          start: 6096659,
          end: 6100323,
        },
        {
          filename: '/pglite/share/postgresql/timezone/GB-Eire',
          start: 6100323,
          end: 6103987,
        },
        {
          filename: '/pglite/share/postgresql/timezone/GMT',
          start: 6103987,
          end: 6104101,
        },
        {
          filename: '/pglite/share/postgresql/timezone/GMT+0',
          start: 6104101,
          end: 6104215,
        },
        {
          filename: '/pglite/share/postgresql/timezone/GMT-0',
          start: 6104215,
          end: 6104329,
        },
        {
          filename: '/pglite/share/postgresql/timezone/GMT0',
          start: 6104329,
          end: 6104443,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Greenwich',
          start: 6104443,
          end: 6104557,
        },
        {
          filename: '/pglite/share/postgresql/timezone/HST',
          start: 6104557,
          end: 6104886,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Hongkong',
          start: 6104886,
          end: 6106119,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Iceland',
          start: 6106119,
          end: 6106267,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Antananarivo',
          start: 6106267,
          end: 6106532,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Chagos',
          start: 6106532,
          end: 6106731,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Christmas',
          start: 6106731,
          end: 6106930,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Cocos',
          start: 6106930,
          end: 6107198,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Comoro',
          start: 6107198,
          end: 6107463,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Kerguelen',
          start: 6107463,
          end: 6107662,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Mahe',
          start: 6107662,
          end: 6107827,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Maldives',
          start: 6107827,
          end: 6108026,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Mauritius',
          start: 6108026,
          end: 6108267,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Mayotte',
          start: 6108267,
          end: 6108532,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Indian/Reunion',
          start: 6108532,
          end: 6108697,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Iran',
          start: 6108697,
          end: 6109959,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Israel',
          start: 6109959,
          end: 6112347,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Jamaica',
          start: 6112347,
          end: 6112829,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Japan',
          start: 6112829,
          end: 6113138,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Kwajalein',
          start: 6113138,
          end: 6113454,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Libya',
          start: 6113454,
          end: 6114079,
        },
        {
          filename: '/pglite/share/postgresql/timezone/MET',
          start: 6114079,
          end: 6117012,
        },
        {
          filename: '/pglite/share/postgresql/timezone/MST',
          start: 6117012,
          end: 6117372,
        },
        {
          filename: '/pglite/share/postgresql/timezone/MST7MDT',
          start: 6117372,
          end: 6119832,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Mexico/BajaNorte',
          start: 6119832,
          end: 6122738,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Mexico/BajaSur',
          start: 6122738,
          end: 6123798,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Mexico/General',
          start: 6123798,
          end: 6125020,
        },
        {
          filename: '/pglite/share/postgresql/timezone/NZ',
          start: 6125020,
          end: 6127457,
        },
        {
          filename: '/pglite/share/postgresql/timezone/NZ-CHAT',
          start: 6127457,
          end: 6129525,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Navajo',
          start: 6129525,
          end: 6131985,
        },
        {
          filename: '/pglite/share/postgresql/timezone/PRC',
          start: 6131985,
          end: 6132546,
        },
        {
          filename: '/pglite/share/postgresql/timezone/PST8PDT',
          start: 6132546,
          end: 6135398,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Apia',
          start: 6135398,
          end: 6136010,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Auckland',
          start: 6136010,
          end: 6138447,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Bougainville',
          start: 6138447,
          end: 6138715,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Chatham',
          start: 6138715,
          end: 6140783,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Chuuk',
          start: 6140783,
          end: 6140969,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Easter',
          start: 6140969,
          end: 6143202,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Efate',
          start: 6143202,
          end: 6143740,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Enderbury',
          start: 6143740,
          end: 6143974,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Fakaofo',
          start: 6143974,
          end: 6144174,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Fiji',
          start: 6144174,
          end: 6144752,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Funafuti',
          start: 6144752,
          end: 6144918,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Galapagos',
          start: 6144918,
          end: 6145156,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Gambier',
          start: 6145156,
          end: 6145320,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Guadalcanal',
          start: 6145320,
          end: 6145486,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Guam',
          start: 6145486,
          end: 6145980,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Honolulu',
          start: 6145980,
          end: 6146309,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Johnston',
          start: 6146309,
          end: 6146638,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Kanton',
          start: 6146638,
          end: 6146872,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Kiritimati',
          start: 6146872,
          end: 6147110,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Kosrae',
          start: 6147110,
          end: 6147461,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Kwajalein',
          start: 6147461,
          end: 6147777,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Majuro',
          start: 6147777,
          end: 6147943,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Marquesas',
          start: 6147943,
          end: 6148116,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Midway',
          start: 6148116,
          end: 6148291,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Nauru',
          start: 6148291,
          end: 6148543,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Niue',
          start: 6148543,
          end: 6148746,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Norfolk',
          start: 6148746,
          end: 6149626,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Noumea',
          start: 6149626,
          end: 6149930,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Pago_Pago',
          start: 6149930,
          end: 6150105,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Palau',
          start: 6150105,
          end: 6150285,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Pitcairn',
          start: 6150285,
          end: 6150487,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Pohnpei',
          start: 6150487,
          end: 6150653,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Ponape',
          start: 6150653,
          end: 6150819,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Port_Moresby',
          start: 6150819,
          end: 6151005,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Rarotonga',
          start: 6151005,
          end: 6151608,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Saipan',
          start: 6151608,
          end: 6152102,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Samoa',
          start: 6152102,
          end: 6152277,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Tahiti',
          start: 6152277,
          end: 6152442,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Tarawa',
          start: 6152442,
          end: 6152608,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Tongatapu',
          start: 6152608,
          end: 6152980,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Truk',
          start: 6152980,
          end: 6153166,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Wake',
          start: 6153166,
          end: 6153332,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Wallis',
          start: 6153332,
          end: 6153498,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Pacific/Yap',
          start: 6153498,
          end: 6153684,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Poland',
          start: 6153684,
          end: 6156338,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Portugal',
          start: 6156338,
          end: 6159865,
        },
        {
          filename: '/pglite/share/postgresql/timezone/ROC',
          start: 6159865,
          end: 6160626,
        },
        {
          filename: '/pglite/share/postgresql/timezone/ROK',
          start: 6160626,
          end: 6161243,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Singapore',
          start: 6161243,
          end: 6161658,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Turkey',
          start: 6161658,
          end: 6163605,
        },
        {
          filename: '/pglite/share/postgresql/timezone/UCT',
          start: 6163605,
          end: 6163719,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Alaska',
          start: 6163719,
          end: 6166090,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Aleutian',
          start: 6166090,
          end: 6168446,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Arizona',
          start: 6168446,
          end: 6168806,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Central',
          start: 6168806,
          end: 6172398,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/East-Indiana',
          start: 6172398,
          end: 6174080,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Eastern',
          start: 6174080,
          end: 6177632,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Hawaii',
          start: 6177632,
          end: 6177961,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Indiana-Starke',
          start: 6177961,
          end: 6180405,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Michigan',
          start: 6180405,
          end: 6182635,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Mountain',
          start: 6182635,
          end: 6185095,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Pacific',
          start: 6185095,
          end: 6187947,
        },
        {
          filename: '/pglite/share/postgresql/timezone/US/Samoa',
          start: 6187947,
          end: 6188122,
        },
        {
          filename: '/pglite/share/postgresql/timezone/UTC',
          start: 6188122,
          end: 6188236,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Universal',
          start: 6188236,
          end: 6188350,
        },
        {
          filename: '/pglite/share/postgresql/timezone/W-SU',
          start: 6188350,
          end: 6189885,
        },
        {
          filename: '/pglite/share/postgresql/timezone/WET',
          start: 6189885,
          end: 6193412,
        },
        {
          filename: '/pglite/share/postgresql/timezone/Zulu',
          start: 6193412,
          end: 6193526,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Africa.txt',
          start: 6193526,
          end: 6200499,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/America.txt',
          start: 6200499,
          end: 6211506,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Antarctica.txt',
          start: 6211506,
          end: 6212640,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Asia.txt',
          start: 6212640,
          end: 6220951,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Atlantic.txt',
          start: 6220951,
          end: 6224484,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Australia',
          start: 6224484,
          end: 6225619,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Australia.txt',
          start: 6225619,
          end: 6229003,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Default',
          start: 6229003,
          end: 6256217,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Etc.txt',
          start: 6256217,
          end: 6257467,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Europe.txt',
          start: 6257467,
          end: 6266213,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/India',
          start: 6266213,
          end: 6266806,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Indian.txt',
          start: 6266806,
          end: 6268067,
        },
        {
          filename: '/pglite/share/postgresql/timezonesets/Pacific.txt',
          start: 6268067,
          end: 6271835,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/danish.stop',
          start: 6271835,
          end: 6272259,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/dutch.stop',
          start: 6272259,
          end: 6272712,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/english.stop',
          start: 6272712,
          end: 6273334,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/finnish.stop',
          start: 6273334,
          end: 6274913,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/french.stop',
          start: 6274913,
          end: 6275718,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/german.stop',
          start: 6275718,
          end: 6277067,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/hungarian.stop',
          start: 6277067,
          end: 6278294,
        },
        {
          filename:
            '/pglite/share/postgresql/tsearch_data/hunspell_sample.affix',
          start: 6278294,
          end: 6278537,
        },
        {
          filename:
            '/pglite/share/postgresql/tsearch_data/hunspell_sample_long.affix',
          start: 6278537,
          end: 6279170,
        },
        {
          filename:
            '/pglite/share/postgresql/tsearch_data/hunspell_sample_long.dict',
          start: 6279170,
          end: 6279268,
        },
        {
          filename:
            '/pglite/share/postgresql/tsearch_data/hunspell_sample_num.affix',
          start: 6279268,
          end: 6279730,
        },
        {
          filename:
            '/pglite/share/postgresql/tsearch_data/hunspell_sample_num.dict',
          start: 6279730,
          end: 6279859,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/ispell_sample.affix',
          start: 6279859,
          end: 6280324,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/ispell_sample.dict',
          start: 6280324,
          end: 6280405,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/italian.stop',
          start: 6280405,
          end: 6282059,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/nepali.stop',
          start: 6282059,
          end: 6286320,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/norwegian.stop',
          start: 6286320,
          end: 6287171,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/portuguese.stop',
          start: 6287171,
          end: 6288438,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/russian.stop',
          start: 6288438,
          end: 6289673,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/spanish.stop',
          start: 6289673,
          end: 6291851,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/swedish.stop',
          start: 6291851,
          end: 6292410,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/synonym_sample.syn',
          start: 6292410,
          end: 6292483,
        },
        {
          filename:
            '/pglite/share/postgresql/tsearch_data/thesaurus_sample.ths',
          start: 6292483,
          end: 6292956,
        },
        {
          filename: '/pglite/share/postgresql/tsearch_data/turkish.stop',
          start: 6292956,
          end: 6293216,
        },
      ],
      remote_package_size: 6293216,
    },
    runWithFS,
  )
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
  let out = Module['print'] || console.log.bind(console)
  let err = Module['printErr'] || console.error.bind(console)
  let dynamicLibraries = Module['dynamicLibraries'] || []
  let wasmBinary = Module['wasmModule'] || Module['wasmBinary']
  out = Module['print'] || console.log.bind(console)
  err = Module['printErr'] || console.error.bind(console)
  Object.assign(Module, moduleOverrides)
  moduleOverrides = null
  if (Module['thisProgram']) thisProgram = Module['thisProgram']
  dynamicLibraries = Module['dynamicLibraries'] || []
  wasmBinary = Module['wasmBinary']
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
    const INITIAL_MEMORY = Module['INITIAL_MEMORY'] || 134217728
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
  const wasmBinaryFile = new URL('../release/pglite.wasm', import.meta.url)
  async function createWasm() {
    async function receiveInstance(instance, module) {
      wasmExports = instance.exports
      wasmExports = relocateExports(wasmExports, 1024)
      const metadata = getDylinkMetadata(module)
      if (metadata.neededDynlibs) {
        dynamicLibraries = metadata.neededDynlibs.concat(dynamicLibraries)
      }
      mergeLibSymbols(wasmExports, 'main')
      LDSO.init()
      await loadDylibs()
      addOnCallback(__ATINIT__, wasmExports['__wasm_call_ctors'])
      __RELOC_FUNCS__.push(wasmExports['__wasm_apply_data_relocs'])
      removeRunDependency('wasm-instantiate')
      return wasmExports
    }
    addRunDependency('wasm-instantiate')
    async function receiveInstantiationResult(result) {
      await receiveInstance(result['instance'], result['module'])
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
    await receiveInstantiationResult(result)
    return result
  }
  const ASM_CONSTS = {}
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
  function getValue(ptr, type = 'i8') {
    if (type.endsWith('*')) type = '*'
    switch (type) {
      case 'i1':
        return HEAP8[ptr]
      case 'i8':
        return HEAP8[ptr]
      case 'i16':
        return HEAP16[ptr >> 1]
      case 'i32':
        return HEAP32[ptr >> 2]
      case 'i64':
        return HEAP64[ptr >> 3]
      case 'float':
        return HEAPF32[ptr >> 2]
      case 'double':
        return HEAPF64[ptr >> 3]
      case '*':
        return HEAPU32[ptr >> 2]
      default:
        abort(`invalid type for getValue: ${type}`)
    }
  }
  const newDSO = (name, handle, syms) => {
    const dso = { refcount: Infinity, name, exports: syms, global: true }
    LDSO.loadedLibsByName[name] = dso
    if (handle != undefined) {
      LDSO.loadedLibsByHandle[handle] = dso
    }
    return dso
  }
  let LDSO = {
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
    const end = ret + alignMemory(size, 16)
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
          ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign)
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
  const asyncLoad = async (url) => {
    const arrayBuffer = await readAsync(url)
    return new Uint8Array(arrayBuffer)
  }
  const preloadPlugins = Module['preloadPlugins'] || []
  const registerWasmPlugin = () => {
    let wasmPlugin = {
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
  let preloadedWasm = {}
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
        mergeLibSymbols(dso.exports, libName)
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
      if (!readBinary) {
        throw new Error(
          `${libFile}: file not found, and synchronous loading of external files is not available`,
        )
      }
      return readBinary(libFile)
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
        mergeLibSymbols(exports, libName)
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
  let loadDylibs = async () => {
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
  function setValue(ptr, value, type = 'i8') {
    if (type.endsWith('*')) type = '*'
    switch (type) {
      case 'i1':
        HEAP8[ptr] = value
        break
      case 'i8':
        HEAP8[ptr] = value
        break
      case 'i16':
        HEAP16[ptr >> 1] = value
        break
      case 'i32':
        HEAP32[ptr >> 2] = value
        break
      case 'i64':
        HEAP64[ptr >> 3] = BigInt(value)
        break
      case 'float':
        HEAPF32[ptr >> 2] = value
        break
      case 'double':
        HEAPF64[ptr >> 3] = value
        break
      case '*':
        HEAPU32[ptr >> 2] = value
        break
      default:
        abort(`invalid type for setValue: ${type}`)
    }
  }
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
  Module['___memory_base'] = ___memory_base
  const ___stack_pointer = new WebAssembly.Global(
    { value: 'i32', mutable: true },
    11373728,
  )
  Module['___stack_pointer'] = ___stack_pointer
  const PATH_FS = createPathFS(() => FS.cwd())
  let PIPEFS = {
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
        assert(currBucket.offset <= PIPEFS.BUCKET_BUFFER_SIZE, undefined, abort)
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
      stringToUTF8Common(ret, HEAPU8, buf, bufsize + 1)
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
  Module['___table_base'] = ___table_base
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
  Module['_exit'] = _exit
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
  const _emscripten_get_heap_max = () => getHeapMax()
  _emscripten_get_heap_max.sig = 'p'
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
      randomFill(HEAPU8.subarray(buffer, buffer + size))
      return 0
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e
      return e.errno
    }
  }
  _random_get.sig = 'ipp'
  const stringToNewUTF8 = (str) => {
    return stringToNewUTF8Common(str, _malloc, HEAPU8)
  }
  const removeFunction = (index) => {
    functionsInTableMap.delete(getWasmTableEntry(index))
    setWasmTableEntry(index, null)
    freeTableIndexes.push(index)
  }
  const FS_createPath = (...args) => FS.createPath(...args)

  const FS_unlink = (path) => FS.unlink(path)
  const FS_createLazyFile = (...args) => FS.createLazyFile(...args)
  const FS_createDevice = (...args) => FS.createDevice(...args)
  const setTempRet0 = (val) => __emscripten_tempret_set(val)
  const _setTempRet0 = setTempRet0
  Module['_setTempRet0'] = _setTempRet0
  const getTempRet0 = (val) => __emscripten_tempret_get()
  const _getTempRet0 = getTempRet0
  Module['_getTempRet0'] = _getTempRet0
  const _emscripten_force_exit = (status) => {
    __emscripten_runtime_keepalive_clear()
    _exit(status)
  }
  Module['_emscripten_force_exit'] = _emscripten_force_exit
  _emscripten_force_exit.sig = 'vi'
  const _sched_yield = () => 0
  Module['_sched_yield'] = _sched_yield
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
  Module['___resumeException'] = ___resumeException
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
  Module['___cxa_find_matching_catch_2'] = ___cxa_find_matching_catch_2
  ___cxa_find_matching_catch_2.sig = 'p'
  const ___cxa_find_matching_catch_3 = (arg0) => findMatchingCatch([arg0])
  Module['___cxa_find_matching_catch_3'] = ___cxa_find_matching_catch_3
  ___cxa_find_matching_catch_3.sig = 'pp'
  let uncaughtExceptionCount = 0
  const ___cxa_throw = (ptr, type, destructor) => {
    const info = new ExceptionInfo(ptr)
    info.init(type, destructor)
    exceptionLast = ptr
    uncaughtExceptionCount++
    throw exceptionLast
  }
  Module['___cxa_throw'] = ___cxa_throw
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
  Module['___cxa_rethrow'] = ___cxa_rethrow
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
  Module['___cxa_begin_catch'] = ___cxa_begin_catch
  ___cxa_begin_catch.sig = 'pp'
  const ___cxa_end_catch = () => {
    _setThrew(0, 0)
    const info = exceptionCaught.pop()
    ___cxa_decrement_exception_refcount(info.excPtr)
    exceptionLast = 0
  }
  Module['___cxa_end_catch'] = ___cxa_end_catch
  ___cxa_end_catch.sig = 'v'
  const ___cxa_uncaught_exceptions = () => uncaughtExceptionCount
  Module['___cxa_uncaught_exceptions'] = ___cxa_uncaught_exceptions
  ___cxa_uncaught_exceptions.sig = 'i'
  const ___cxa_current_primary_exception = () => {
    if (!exceptionCaught.length) {
      return 0
    }
    const info = exceptionCaught[exceptionCaught.length - 1]
    ___cxa_increment_exception_refcount(info.excPtr)
    return info.excPtr
  }
  Module['___cxa_current_primary_exception'] = ___cxa_current_primary_exception
  ___cxa_current_primary_exception.sig = 'p'
  const ___cxa_rethrow_primary_exception = (ptr) => {
    if (!ptr) return
    const info = new ExceptionInfo(ptr)
    exceptionCaught.push(info)
    info.set_rethrown(true)
    ___cxa_rethrow()
  }
  Module['___cxa_rethrow_primary_exception'] = ___cxa_rethrow_primary_exception
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
  registerWasmPlugin()
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
  NODEFS.staticInit()
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
  const invoke_viiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vi = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_v = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_jii = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_i = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_ji = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_jiiiiiiiii = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_jiiiiii = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiiiiiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vji = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiji = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiij = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vijiji = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viji = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiiiiiiiiiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vj = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viij = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiiiiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiiiiiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vij = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiji = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_ij = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiiiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiiji = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiij = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vid = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_j = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_ijji = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iijj = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_jiii = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_jij = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_ijiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viijii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiji = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viijiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vijjii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_vjii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_jiiii = createInvoke(
    'j',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_viiiiiiiiiiii = createInvoke(
    'v',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_di = createInvoke(
    'd',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_id = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_ijiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  const invoke_iiiiiiiiiii = createInvoke(
    'i',
    getWasmTableEntry,
    stackSave,
    stackRestore,
    () => _setThrew,
  )
  let wasmImports = {
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
    invoke_di,
    invoke_i,
    invoke_id,
    invoke_ii,
    invoke_iii,
    invoke_iiii,
    invoke_iiiii,
    invoke_iiiiii,
    invoke_iiiiiii,
    invoke_iiiiiiii,
    invoke_iiiiiiiii,
    invoke_iiiiiiiiii,
    invoke_iiiiiiiiiii,
    invoke_iiiiiiiiiiiiii,
    invoke_iiiiiiiiiiiiiiiiii,
    invoke_iiiiiji,
    invoke_iiiij,
    invoke_iiij,
    invoke_iiji,
    invoke_iijj,
    invoke_ij,
    invoke_ijiiiii,
    invoke_ijiiiiii,
    invoke_ijji,
    invoke_j,
    invoke_ji,
    invoke_jii,
    invoke_jiii,
    invoke_jiiii,
    invoke_jiiiiii,
    invoke_jiiiiiiiii,
    invoke_jij,
    invoke_v,
    invoke_vi,
    invoke_vid,
    invoke_vii,
    invoke_viii,
    invoke_viiii,
    invoke_viiiii,
    invoke_viiiiii,
    invoke_viiiiiii,
    invoke_viiiiiiii,
    invoke_viiiiiiiii,
    invoke_viiiiiiiiiiii,
    invoke_viiiji,
    invoke_viij,
    invoke_viiji,
    invoke_viijii,
    invoke_viijiiii,
    invoke_vij,
    invoke_viji,
    invoke_vijiji,
    invoke_vijjii,
    invoke_vj,
    invoke_vji,
    invoke_vjii,
    memory: wasmMemory,
    proc_exit: _proc_exit,
    random_get: _random_get,
    sched_yield: _sched_yield,
    setTempRet0: _setTempRet0,
  }
  let wasmExports
  const wasmInitialization = createWasm()
  let ___wasm_call_ctors = () =>
    (___wasm_call_ctors = wasmExports['__wasm_call_ctors'])()
  let _palloc0 = (Module['_palloc0'] = (a0) =>
    (_palloc0 = Module['_palloc0'] = wasmExports['palloc0'])(a0))
  let _RelationGetNumberOfBlocksInFork = (Module[
    '_RelationGetNumberOfBlocksInFork'
  ] = (a0, a1) =>
    (_RelationGetNumberOfBlocksInFork = Module[
      '_RelationGetNumberOfBlocksInFork'
    ] =
      wasmExports['RelationGetNumberOfBlocksInFork'])(a0, a1))
  let _ExtendBufferedRel = (Module['_ExtendBufferedRel'] = (a0, a1, a2, a3) =>
    (_ExtendBufferedRel = Module['_ExtendBufferedRel'] =
      wasmExports['ExtendBufferedRel'])(a0, a1, a2, a3))
  let _MarkBufferDirty = (Module['_MarkBufferDirty'] = (a0) =>
    (_MarkBufferDirty = Module['_MarkBufferDirty'] =
      wasmExports['MarkBufferDirty'])(a0))
  let _XLogBeginInsert = (Module['_XLogBeginInsert'] = () =>
    (_XLogBeginInsert = Module['_XLogBeginInsert'] =
      wasmExports['XLogBeginInsert'])())
  let _XLogRegisterData = (Module['_XLogRegisterData'] = (a0, a1) =>
    (_XLogRegisterData = Module['_XLogRegisterData'] =
      wasmExports['XLogRegisterData'])(a0, a1))
  let _XLogInsert = (Module['_XLogInsert'] = (a0, a1) =>
    (_XLogInsert = Module['_XLogInsert'] = wasmExports['XLogInsert'])(a0, a1))
  let _UnlockReleaseBuffer = (Module['_UnlockReleaseBuffer'] = (a0) =>
    (_UnlockReleaseBuffer = Module['_UnlockReleaseBuffer'] =
      wasmExports['UnlockReleaseBuffer'])(a0))
  let _palloc = (Module['_palloc'] = (a0) =>
    (_palloc = Module['_palloc'] = wasmExports['palloc'])(a0))
  let _brin_build_desc = (Module['_brin_build_desc'] = (a0) =>
    (_brin_build_desc = Module['_brin_build_desc'] =
      wasmExports['brin_build_desc'])(a0))
  let _EnterParallelMode = (Module['_EnterParallelMode'] = () =>
    (_EnterParallelMode = Module['_EnterParallelMode'] =
      wasmExports['EnterParallelMode'])())
  let _CreateParallelContext = (Module['_CreateParallelContext'] = (
    a0,
    a1,
    a2,
  ) =>
    (_CreateParallelContext = Module['_CreateParallelContext'] =
      wasmExports['CreateParallelContext'])(a0, a1, a2))
  let _GetTransactionSnapshot = (Module['_GetTransactionSnapshot'] = () =>
    (_GetTransactionSnapshot = Module['_GetTransactionSnapshot'] =
      wasmExports['GetTransactionSnapshot'])())
  let _RegisterSnapshot = (Module['_RegisterSnapshot'] = (a0) =>
    (_RegisterSnapshot = Module['_RegisterSnapshot'] =
      wasmExports['RegisterSnapshot'])(a0))
  let _table_parallelscan_estimate = (Module['_table_parallelscan_estimate'] = (
    a0,
    a1,
  ) =>
    (_table_parallelscan_estimate = Module['_table_parallelscan_estimate'] =
      wasmExports['table_parallelscan_estimate'])(a0, a1))
  let _add_size = (Module['_add_size'] = (a0, a1) =>
    (_add_size = Module['_add_size'] = wasmExports['add_size'])(a0, a1))
  let _tuplesort_estimate_shared = (Module['_tuplesort_estimate_shared'] = (
    a0,
  ) =>
    (_tuplesort_estimate_shared = Module['_tuplesort_estimate_shared'] =
      wasmExports['tuplesort_estimate_shared'])(a0))
  let _strlen = (Module['_strlen'] = (a0) =>
    (_strlen = Module['_strlen'] = wasmExports['strlen'])(a0))
  let _InitializeParallelDSM = (Module['_InitializeParallelDSM'] = (a0) =>
    (_InitializeParallelDSM = Module['_InitializeParallelDSM'] =
      wasmExports['InitializeParallelDSM'])(a0))
  let _UnregisterSnapshot = (Module['_UnregisterSnapshot'] = (a0) =>
    (_UnregisterSnapshot = Module['_UnregisterSnapshot'] =
      wasmExports['UnregisterSnapshot'])(a0))
  let _DestroyParallelContext = (Module['_DestroyParallelContext'] = (a0) =>
    (_DestroyParallelContext = Module['_DestroyParallelContext'] =
      wasmExports['DestroyParallelContext'])(a0))
  let _ExitParallelMode = (Module['_ExitParallelMode'] = () =>
    (_ExitParallelMode = Module['_ExitParallelMode'] =
      wasmExports['ExitParallelMode'])())
  let _shm_toc_allocate = (Module['_shm_toc_allocate'] = (a0, a1) =>
    (_shm_toc_allocate = Module['_shm_toc_allocate'] =
      wasmExports['shm_toc_allocate'])(a0, a1))
  let _ConditionVariableInit = (Module['_ConditionVariableInit'] = (a0) =>
    (_ConditionVariableInit = Module['_ConditionVariableInit'] =
      wasmExports['ConditionVariableInit'])(a0))
  let _table_parallelscan_initialize = (Module[
    '_table_parallelscan_initialize'
  ] = (a0, a1, a2) =>
    (_table_parallelscan_initialize = Module['_table_parallelscan_initialize'] =
      wasmExports['table_parallelscan_initialize'])(a0, a1, a2))
  let _tuplesort_initialize_shared = (Module['_tuplesort_initialize_shared'] = (
    a0,
    a1,
    a2,
  ) =>
    (_tuplesort_initialize_shared = Module['_tuplesort_initialize_shared'] =
      wasmExports['tuplesort_initialize_shared'])(a0, a1, a2))
  let _shm_toc_insert = (Module['_shm_toc_insert'] = (a0, a1, a2) =>
    (_shm_toc_insert = Module['_shm_toc_insert'] =
      wasmExports['shm_toc_insert'])(a0, a1, a2))
  let _memcpy = (Module['_memcpy'] = (a0, a1, a2) =>
    (_memcpy = Module['_memcpy'] = wasmExports['memcpy'])(a0, a1, a2))
  let _LaunchParallelWorkers = (Module['_LaunchParallelWorkers'] = (a0) =>
    (_LaunchParallelWorkers = Module['_LaunchParallelWorkers'] =
      wasmExports['LaunchParallelWorkers'])(a0))
  let _WaitForParallelWorkersToAttach = (Module[
    '_WaitForParallelWorkersToAttach'
  ] = (a0) =>
    (_WaitForParallelWorkersToAttach = Module[
      '_WaitForParallelWorkersToAttach'
    ] =
      wasmExports['WaitForParallelWorkersToAttach'])(a0))
  let _s_lock = (Module['_s_lock'] = (a0, a1, a2, a3) =>
    (_s_lock = Module['_s_lock'] = wasmExports['s_lock'])(a0, a1, a2, a3))
  let _ConditionVariableSleep = (Module['_ConditionVariableSleep'] = (a0, a1) =>
    (_ConditionVariableSleep = Module['_ConditionVariableSleep'] =
      wasmExports['ConditionVariableSleep'])(a0, a1))
  let _ConditionVariableCancelSleep = (Module['_ConditionVariableCancelSleep'] =
    () =>
      (_ConditionVariableCancelSleep = Module['_ConditionVariableCancelSleep'] =
        wasmExports['ConditionVariableCancelSleep'])())
  let _tuplesort_performsort = (Module['_tuplesort_performsort'] = (a0) =>
    (_tuplesort_performsort = Module['_tuplesort_performsort'] =
      wasmExports['tuplesort_performsort'])(a0))
  let _AllocSetContextCreateInternal = (Module[
    '_AllocSetContextCreateInternal'
  ] = (a0, a1, a2, a3, a4) =>
    (_AllocSetContextCreateInternal = Module['_AllocSetContextCreateInternal'] =
      wasmExports['AllocSetContextCreateInternal'])(a0, a1, a2, a3, a4))
  let _tuplesort_end = (Module['_tuplesort_end'] = (a0) =>
    (_tuplesort_end = Module['_tuplesort_end'] = wasmExports['tuplesort_end'])(
      a0,
    ))
  let _MemoryContextReset = (Module['_MemoryContextReset'] = (a0) =>
    (_MemoryContextReset = Module['_MemoryContextReset'] =
      wasmExports['MemoryContextReset'])(a0))
  let _brin_deform_tuple = (Module['_brin_deform_tuple'] = (a0, a1, a2) =>
    (_brin_deform_tuple = Module['_brin_deform_tuple'] =
      wasmExports['brin_deform_tuple'])(a0, a1, a2))
  let _pfree = (Module['_pfree'] = (a0) =>
    (_pfree = Module['_pfree'] = wasmExports['pfree'])(a0))
  let _MemoryContextDelete = (Module['_MemoryContextDelete'] = (a0) =>
    (_MemoryContextDelete = Module['_MemoryContextDelete'] =
      wasmExports['MemoryContextDelete'])(a0))
  let _errstart_cold = (Module['_errstart_cold'] = (a0, a1) =>
    (_errstart_cold = Module['_errstart_cold'] = wasmExports['errstart_cold'])(
      a0,
      a1,
    ))
  let _errmsg_internal = (Module['_errmsg_internal'] = (a0, a1) =>
    (_errmsg_internal = Module['_errmsg_internal'] =
      wasmExports['errmsg_internal'])(a0, a1))
  let _errfinish = (Module['_errfinish'] = (a0, a1, a2) =>
    (_errfinish = Module['_errfinish'] = wasmExports['errfinish'])(a0, a1, a2))
  let _log_newpage_buffer = (Module['_log_newpage_buffer'] = (a0, a1) =>
    (_log_newpage_buffer = Module['_log_newpage_buffer'] =
      wasmExports['log_newpage_buffer'])(a0, a1))
  let _ProcessInterrupts = (Module['_ProcessInterrupts'] = () =>
    (_ProcessInterrupts = Module['_ProcessInterrupts'] =
      wasmExports['ProcessInterrupts'])())
  let _errstart = (Module['_errstart'] = (a0, a1) =>
    (_errstart = Module['_errstart'] = wasmExports['errstart'])(a0, a1))
  let _errcode = (Module['_errcode'] = (a0) =>
    (_errcode = Module['_errcode'] = wasmExports['errcode'])(a0))
  let _errmsg = (Module['_errmsg'] = (a0, a1) =>
    (_errmsg = Module['_errmsg'] = wasmExports['errmsg'])(a0, a1))
  let _LockBuffer = (Module['_LockBuffer'] = (a0, a1) =>
    (_LockBuffer = Module['_LockBuffer'] = wasmExports['LockBuffer'])(a0, a1))
  let _ReleaseBuffer = (Module['_ReleaseBuffer'] = (a0) =>
    (_ReleaseBuffer = Module['_ReleaseBuffer'] = wasmExports['ReleaseBuffer'])(
      a0,
    ))
  let _IndexGetRelation = (Module['_IndexGetRelation'] = (a0, a1) =>
    (_IndexGetRelation = Module['_IndexGetRelation'] =
      wasmExports['IndexGetRelation'])(a0, a1))
  let _table_open = (Module['_table_open'] = (a0, a1) =>
    (_table_open = Module['_table_open'] = wasmExports['table_open'])(a0, a1))
  let _ReadBufferExtended = (Module['_ReadBufferExtended'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_ReadBufferExtended = Module['_ReadBufferExtended'] =
      wasmExports['ReadBufferExtended'])(a0, a1, a2, a3, a4))
  let _table_close = (Module['_table_close'] = (a0, a1) =>
    (_table_close = Module['_table_close'] = wasmExports['table_close'])(
      a0,
      a1,
    ))
  let _build_reloptions = (Module['_build_reloptions'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_build_reloptions = Module['_build_reloptions'] =
      wasmExports['build_reloptions'])(a0, a1, a2, a3, a4, a5))
  let _RelationGetIndexScan = (Module['_RelationGetIndexScan'] = (a0, a1, a2) =>
    (_RelationGetIndexScan = Module['_RelationGetIndexScan'] =
      wasmExports['RelationGetIndexScan'])(a0, a1, a2))
  let _pgstat_assoc_relation = (Module['_pgstat_assoc_relation'] = (a0) =>
    (_pgstat_assoc_relation = Module['_pgstat_assoc_relation'] =
      wasmExports['pgstat_assoc_relation'])(a0))
  let _memset = (Module['_memset'] = (a0, a1, a2) =>
    (_memset = Module['_memset'] = wasmExports['memset'])(a0, a1, a2))
  let _index_getprocinfo = (Module['_index_getprocinfo'] = (a0, a1, a2) =>
    (_index_getprocinfo = Module['_index_getprocinfo'] =
      wasmExports['index_getprocinfo'])(a0, a1, a2))
  let _fmgr_info_copy = (Module['_fmgr_info_copy'] = (a0, a1, a2) =>
    (_fmgr_info_copy = Module['_fmgr_info_copy'] =
      wasmExports['fmgr_info_copy'])(a0, a1, a2))
  let _FunctionCall4Coll = (Module['_FunctionCall4Coll'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_FunctionCall4Coll = Module['_FunctionCall4Coll'] =
      wasmExports['FunctionCall4Coll'])(a0, a1, a2, a3, a4, a5))
  let _FunctionCall1Coll = (Module['_FunctionCall1Coll'] = (a0, a1, a2) =>
    (_FunctionCall1Coll = Module['_FunctionCall1Coll'] =
      wasmExports['FunctionCall1Coll'])(a0, a1, a2))
  let _brin_free_desc = (Module['_brin_free_desc'] = (a0) =>
    (_brin_free_desc = Module['_brin_free_desc'] =
      wasmExports['brin_free_desc'])(a0))
  let _WaitForParallelWorkersToFinish = (Module[
    '_WaitForParallelWorkersToFinish'
  ] = (a0) =>
    (_WaitForParallelWorkersToFinish = Module[
      '_WaitForParallelWorkersToFinish'
    ] =
      wasmExports['WaitForParallelWorkersToFinish'])(a0))
  let _PageGetFreeSpace = (Module['_PageGetFreeSpace'] = (a0) =>
    (_PageGetFreeSpace = Module['_PageGetFreeSpace'] =
      wasmExports['PageGetFreeSpace'])(a0))
  let _BufferGetBlockNumber = (Module['_BufferGetBlockNumber'] = (a0) =>
    (_BufferGetBlockNumber = Module['_BufferGetBlockNumber'] =
      wasmExports['BufferGetBlockNumber'])(a0))
  let _BuildIndexInfo = (Module['_BuildIndexInfo'] = (a0) =>
    (_BuildIndexInfo = Module['_BuildIndexInfo'] =
      wasmExports['BuildIndexInfo'])(a0))
  let _Int64GetDatum = (Module['_Int64GetDatum'] = (a0) =>
    (_Int64GetDatum = Module['_Int64GetDatum'] = wasmExports['Int64GetDatum'])(
      a0,
    ))
  let _DirectFunctionCall2Coll = (Module['_DirectFunctionCall2Coll'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_DirectFunctionCall2Coll = Module['_DirectFunctionCall2Coll'] =
      wasmExports['DirectFunctionCall2Coll'])(a0, a1, a2, a3))
  let _RecoveryInProgress = (Module['_RecoveryInProgress'] = () =>
    (_RecoveryInProgress = Module['_RecoveryInProgress'] =
      wasmExports['RecoveryInProgress'])())
  let _GetUserIdAndSecContext = (Module['_GetUserIdAndSecContext'] = (a0, a1) =>
    (_GetUserIdAndSecContext = Module['_GetUserIdAndSecContext'] =
      wasmExports['GetUserIdAndSecContext'])(a0, a1))
  let _SetUserIdAndSecContext = (Module['_SetUserIdAndSecContext'] = (a0, a1) =>
    (_SetUserIdAndSecContext = Module['_SetUserIdAndSecContext'] =
      wasmExports['SetUserIdAndSecContext'])(a0, a1))
  let _NewGUCNestLevel = (Module['_NewGUCNestLevel'] = () =>
    (_NewGUCNestLevel = Module['_NewGUCNestLevel'] =
      wasmExports['NewGUCNestLevel'])())
  let _RestrictSearchPath = (Module['_RestrictSearchPath'] = () =>
    (_RestrictSearchPath = Module['_RestrictSearchPath'] =
      wasmExports['RestrictSearchPath'])())
  let _index_open = (Module['_index_open'] = (a0, a1) =>
    (_index_open = Module['_index_open'] = wasmExports['index_open'])(a0, a1))
  let _object_ownercheck = (Module['_object_ownercheck'] = (a0, a1, a2) =>
    (_object_ownercheck = Module['_object_ownercheck'] =
      wasmExports['object_ownercheck'])(a0, a1, a2))
  let _aclcheck_error = (Module['_aclcheck_error'] = (a0, a1, a2) =>
    (_aclcheck_error = Module['_aclcheck_error'] =
      wasmExports['aclcheck_error'])(a0, a1, a2))
  let _AtEOXact_GUC = (Module['_AtEOXact_GUC'] = (a0, a1) =>
    (_AtEOXact_GUC = Module['_AtEOXact_GUC'] = wasmExports['AtEOXact_GUC'])(
      a0,
      a1,
    ))
  let _relation_close = (Module['_relation_close'] = (a0, a1) =>
    (_relation_close = Module['_relation_close'] =
      wasmExports['relation_close'])(a0, a1))
  let _errhint = (Module['_errhint'] = (a0, a1) =>
    (_errhint = Module['_errhint'] = wasmExports['errhint'])(a0, a1))
  let _GetUserId = (Module['_GetUserId'] = () =>
    (_GetUserId = Module['_GetUserId'] = wasmExports['GetUserId'])())
  let _ReadBuffer = (Module['_ReadBuffer'] = (a0, a1) =>
    (_ReadBuffer = Module['_ReadBuffer'] = wasmExports['ReadBuffer'])(a0, a1))
  let _shm_toc_lookup = (Module['_shm_toc_lookup'] = (a0, a1, a2) =>
    (_shm_toc_lookup = Module['_shm_toc_lookup'] =
      wasmExports['shm_toc_lookup'])(a0, a1, a2))
  let _pgstat_report_activity = (Module['_pgstat_report_activity'] = (a0, a1) =>
    (_pgstat_report_activity = Module['_pgstat_report_activity'] =
      wasmExports['pgstat_report_activity'])(a0, a1))
  let _tuplesort_attach_shared = (Module['_tuplesort_attach_shared'] = (
    a0,
    a1,
  ) =>
    (_tuplesort_attach_shared = Module['_tuplesort_attach_shared'] =
      wasmExports['tuplesort_attach_shared'])(a0, a1))
  let _index_close = (Module['_index_close'] = (a0, a1) =>
    (_index_close = Module['_index_close'] = wasmExports['index_close'])(
      a0,
      a1,
    ))
  let _table_beginscan_parallel = (Module['_table_beginscan_parallel'] = (
    a0,
    a1,
  ) =>
    (_table_beginscan_parallel = Module['_table_beginscan_parallel'] =
      wasmExports['table_beginscan_parallel'])(a0, a1))
  let _ConditionVariableSignal = (Module['_ConditionVariableSignal'] = (a0) =>
    (_ConditionVariableSignal = Module['_ConditionVariableSignal'] =
      wasmExports['ConditionVariableSignal'])(a0))
  let _datumCopy = (Module['_datumCopy'] = (a0, a1, a2) =>
    (_datumCopy = Module['_datumCopy'] = wasmExports['datumCopy'])(a0, a1, a2))
  let _lookup_type_cache = (Module['_lookup_type_cache'] = (a0, a1) =>
    (_lookup_type_cache = Module['_lookup_type_cache'] =
      wasmExports['lookup_type_cache'])(a0, a1))
  let _get_fn_opclass_options = (Module['_get_fn_opclass_options'] = (a0) =>
    (_get_fn_opclass_options = Module['_get_fn_opclass_options'] =
      wasmExports['get_fn_opclass_options'])(a0))
  let _log = (Module['_log'] = (a0) =>
    (_log = Module['_log'] = wasmExports['log'])(a0))
  let _pg_detoast_datum = (Module['_pg_detoast_datum'] = (a0) =>
    (_pg_detoast_datum = Module['_pg_detoast_datum'] =
      wasmExports['pg_detoast_datum'])(a0))
  let _index_getprocid = (Module['_index_getprocid'] = (a0, a1, a2) =>
    (_index_getprocid = Module['_index_getprocid'] =
      wasmExports['index_getprocid'])(a0, a1, a2))
  let _errdetail_internal = (Module['_errdetail_internal'] = (a0, a1) =>
    (_errdetail_internal = Module['_errdetail_internal'] =
      wasmExports['errdetail_internal'])(a0, a1))
  let _pg_popcount_optimized = (Module['_pg_popcount_optimized'] = (a0, a1) =>
    (_pg_popcount_optimized = Module['_pg_popcount_optimized'] =
      wasmExports['pg_popcount_optimized'])(a0, a1))
  let _init_local_reloptions = (Module['_init_local_reloptions'] = (a0, a1) =>
    (_init_local_reloptions = Module['_init_local_reloptions'] =
      wasmExports['init_local_reloptions'])(a0, a1))
  let _initStringInfo = (Module['_initStringInfo'] = (a0) =>
    (_initStringInfo = Module['_initStringInfo'] =
      wasmExports['initStringInfo'])(a0))
  let _appendStringInfoChar = (Module['_appendStringInfoChar'] = (a0, a1) =>
    (_appendStringInfoChar = Module['_appendStringInfoChar'] =
      wasmExports['appendStringInfoChar'])(a0, a1))
  let _appendStringInfo = (Module['_appendStringInfo'] = (a0, a1, a2) =>
    (_appendStringInfo = Module['_appendStringInfo'] =
      wasmExports['appendStringInfo'])(a0, a1, a2))
  let _FunctionCall2Coll = (Module['_FunctionCall2Coll'] = (a0, a1, a2, a3) =>
    (_FunctionCall2Coll = Module['_FunctionCall2Coll'] =
      wasmExports['FunctionCall2Coll'])(a0, a1, a2, a3))
  let _SysCacheGetAttrNotNull = (Module['_SysCacheGetAttrNotNull'] = (
    a0,
    a1,
    a2,
  ) =>
    (_SysCacheGetAttrNotNull = Module['_SysCacheGetAttrNotNull'] =
      wasmExports['SysCacheGetAttrNotNull'])(a0, a1, a2))
  let _ReleaseSysCache = (Module['_ReleaseSysCache'] = (a0) =>
    (_ReleaseSysCache = Module['_ReleaseSysCache'] =
      wasmExports['ReleaseSysCache'])(a0))
  let _get_opcode = (Module['_get_opcode'] = (a0) =>
    (_get_opcode = Module['_get_opcode'] = wasmExports['get_opcode'])(a0))
  let _fmgr_info_cxt = (Module['_fmgr_info_cxt'] = (a0, a1, a2) =>
    (_fmgr_info_cxt = Module['_fmgr_info_cxt'] = wasmExports['fmgr_info_cxt'])(
      a0,
      a1,
      a2,
    ))
  let _Float8GetDatum = (Module['_Float8GetDatum'] = (a0) =>
    (_Float8GetDatum = Module['_Float8GetDatum'] =
      wasmExports['Float8GetDatum'])(a0))
  let _numeric_float8 = (Module['_numeric_float8'] = (a0) =>
    (_numeric_float8 = Module['_numeric_float8'] =
      wasmExports['numeric_float8'])(a0))
  let _numeric_sub = (Module['_numeric_sub'] = (a0) =>
    (_numeric_sub = Module['_numeric_sub'] = wasmExports['numeric_sub'])(a0))
  let _DirectFunctionCall1Coll = (Module['_DirectFunctionCall1Coll'] = (
    a0,
    a1,
    a2,
  ) =>
    (_DirectFunctionCall1Coll = Module['_DirectFunctionCall1Coll'] =
      wasmExports['DirectFunctionCall1Coll'])(a0, a1, a2))
  let _pg_detoast_datum_packed = (Module['_pg_detoast_datum_packed'] = (a0) =>
    (_pg_detoast_datum_packed = Module['_pg_detoast_datum_packed'] =
      wasmExports['pg_detoast_datum_packed'])(a0))
  let _pg_qsort = (Module['_pg_qsort'] = (a0, a1, a2, a3) =>
    (_pg_qsort = Module['_pg_qsort'] = wasmExports['pg_qsort'])(a0, a1, a2, a3))
  let _get_typbyval = (Module['_get_typbyval'] = (a0) =>
    (_get_typbyval = Module['_get_typbyval'] = wasmExports['get_typbyval'])(a0))
  let _get_typlen = (Module['_get_typlen'] = (a0) =>
    (_get_typlen = Module['_get_typlen'] = wasmExports['get_typlen'])(a0))
  let _qsort_arg = (Module['_qsort_arg'] = (a0, a1, a2, a3, a4) =>
    (_qsort_arg = Module['_qsort_arg'] = wasmExports['qsort_arg'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _memmove = (Module['_memmove'] = (a0, a1, a2) =>
    (_memmove = Module['_memmove'] = wasmExports['memmove'])(a0, a1, a2))
  let _add_local_int_reloption = (Module['_add_local_int_reloption'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_add_local_int_reloption = Module['_add_local_int_reloption'] =
      wasmExports['add_local_int_reloption'])(a0, a1, a2, a3, a4, a5, a6))
  let _getTypeOutputInfo = (Module['_getTypeOutputInfo'] = (a0, a1, a2) =>
    (_getTypeOutputInfo = Module['_getTypeOutputInfo'] =
      wasmExports['getTypeOutputInfo'])(a0, a1, a2))
  let _fmgr_info = (Module['_fmgr_info'] = (a0, a1) =>
    (_fmgr_info = Module['_fmgr_info'] = wasmExports['fmgr_info'])(a0, a1))
  let _OutputFunctionCall = (Module['_OutputFunctionCall'] = (a0, a1) =>
    (_OutputFunctionCall = Module['_OutputFunctionCall'] =
      wasmExports['OutputFunctionCall'])(a0, a1))
  let _cstring_to_text_with_len = (Module['_cstring_to_text_with_len'] = (
    a0,
    a1,
  ) =>
    (_cstring_to_text_with_len = Module['_cstring_to_text_with_len'] =
      wasmExports['cstring_to_text_with_len'])(a0, a1))
  let _accumArrayResult = (Module['_accumArrayResult'] = (a0, a1, a2, a3, a4) =>
    (_accumArrayResult = Module['_accumArrayResult'] =
      wasmExports['accumArrayResult'])(a0, a1, a2, a3, a4))
  let _makeArrayResult = (Module['_makeArrayResult'] = (a0, a1) =>
    (_makeArrayResult = Module['_makeArrayResult'] =
      wasmExports['makeArrayResult'])(a0, a1))
  let _OidOutputFunctionCall = (Module['_OidOutputFunctionCall'] = (a0, a1) =>
    (_OidOutputFunctionCall = Module['_OidOutputFunctionCall'] =
      wasmExports['OidOutputFunctionCall'])(a0, a1))
  let _cstring_to_text = (Module['_cstring_to_text'] = (a0) =>
    (_cstring_to_text = Module['_cstring_to_text'] =
      wasmExports['cstring_to_text'])(a0))
  let _PageGetExactFreeSpace = (Module['_PageGetExactFreeSpace'] = (a0) =>
    (_PageGetExactFreeSpace = Module['_PageGetExactFreeSpace'] =
      wasmExports['PageGetExactFreeSpace'])(a0))
  let _PageIndexTupleOverwrite = (Module['_PageIndexTupleOverwrite'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_PageIndexTupleOverwrite = Module['_PageIndexTupleOverwrite'] =
      wasmExports['PageIndexTupleOverwrite'])(a0, a1, a2, a3))
  let _PageInit = (Module['_PageInit'] = (a0, a1, a2) =>
    (_PageInit = Module['_PageInit'] = wasmExports['PageInit'])(a0, a1, a2))
  let _PageAddItemExtended = (Module['_PageAddItemExtended'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_PageAddItemExtended = Module['_PageAddItemExtended'] =
      wasmExports['PageAddItemExtended'])(a0, a1, a2, a3, a4))
  let _LockRelationForExtension = (Module['_LockRelationForExtension'] = (
    a0,
    a1,
  ) =>
    (_LockRelationForExtension = Module['_LockRelationForExtension'] =
      wasmExports['LockRelationForExtension'])(a0, a1))
  let _UnlockRelationForExtension = (Module['_UnlockRelationForExtension'] = (
    a0,
    a1,
  ) =>
    (_UnlockRelationForExtension = Module['_UnlockRelationForExtension'] =
      wasmExports['UnlockRelationForExtension'])(a0, a1))
  let _smgropen = (Module['_smgropen'] = (a0, a1) =>
    (_smgropen = Module['_smgropen'] = wasmExports['smgropen'])(a0, a1))
  let _smgrpin = (Module['_smgrpin'] = (a0) =>
    (_smgrpin = Module['_smgrpin'] = wasmExports['smgrpin'])(a0))
  let _ItemPointerEquals = (Module['_ItemPointerEquals'] = (a0, a1) =>
    (_ItemPointerEquals = Module['_ItemPointerEquals'] =
      wasmExports['ItemPointerEquals'])(a0, a1))
  let _detoast_external_attr = (Module['_detoast_external_attr'] = (a0) =>
    (_detoast_external_attr = Module['_detoast_external_attr'] =
      wasmExports['detoast_external_attr'])(a0))
  let _CreateTemplateTupleDesc = (Module['_CreateTemplateTupleDesc'] = (a0) =>
    (_CreateTemplateTupleDesc = Module['_CreateTemplateTupleDesc'] =
      wasmExports['CreateTemplateTupleDesc'])(a0))
  let _TupleDescInitEntry = (Module['_TupleDescInitEntry'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_TupleDescInitEntry = Module['_TupleDescInitEntry'] =
      wasmExports['TupleDescInitEntry'])(a0, a1, a2, a3, a4, a5))
  let _repalloc = (Module['_repalloc'] = (a0, a1) =>
    (_repalloc = Module['_repalloc'] = wasmExports['repalloc'])(a0, a1))
  let _memcmp = (Module['_memcmp'] = (a0, a1, a2) =>
    (_memcmp = Module['_memcmp'] = wasmExports['memcmp'])(a0, a1, a2))
  let _SearchSysCache1 = (Module['_SearchSysCache1'] = (a0, a1) =>
    (_SearchSysCache1 = Module['_SearchSysCache1'] =
      wasmExports['SearchSysCache1'])(a0, a1))
  let _get_opfamily_name = (Module['_get_opfamily_name'] = (a0, a1) =>
    (_get_opfamily_name = Module['_get_opfamily_name'] =
      wasmExports['get_opfamily_name'])(a0, a1))
  let _SearchSysCacheList = (Module['_SearchSysCacheList'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_SearchSysCacheList = Module['_SearchSysCacheList'] =
      wasmExports['SearchSysCacheList'])(a0, a1, a2, a3, a4))
  let _check_amproc_signature = (Module['_check_amproc_signature'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_check_amproc_signature = Module['_check_amproc_signature'] =
      wasmExports['check_amproc_signature'])(a0, a1, a2, a3, a4, a5))
  let _check_amoptsproc_signature = (Module['_check_amoptsproc_signature'] = (
    a0,
  ) =>
    (_check_amoptsproc_signature = Module['_check_amoptsproc_signature'] =
      wasmExports['check_amoptsproc_signature'])(a0))
  let _format_procedure = (Module['_format_procedure'] = (a0) =>
    (_format_procedure = Module['_format_procedure'] =
      wasmExports['format_procedure'])(a0))
  let _format_operator = (Module['_format_operator'] = (a0) =>
    (_format_operator = Module['_format_operator'] =
      wasmExports['format_operator'])(a0))
  let _check_amop_signature = (Module['_check_amop_signature'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_check_amop_signature = Module['_check_amop_signature'] =
      wasmExports['check_amop_signature'])(a0, a1, a2, a3))
  let _identify_opfamily_groups = (Module['_identify_opfamily_groups'] = (
    a0,
    a1,
  ) =>
    (_identify_opfamily_groups = Module['_identify_opfamily_groups'] =
      wasmExports['identify_opfamily_groups'])(a0, a1))
  let _format_type_be = (Module['_format_type_be'] = (a0) =>
    (_format_type_be = Module['_format_type_be'] =
      wasmExports['format_type_be'])(a0))
  let _ReleaseCatCacheList = (Module['_ReleaseCatCacheList'] = (a0) =>
    (_ReleaseCatCacheList = Module['_ReleaseCatCacheList'] =
      wasmExports['ReleaseCatCacheList'])(a0))
  let _format_type_with_typemod = (Module['_format_type_with_typemod'] = (
    a0,
    a1,
  ) =>
    (_format_type_with_typemod = Module['_format_type_with_typemod'] =
      wasmExports['format_type_with_typemod'])(a0, a1))
  let _errdetail = (Module['_errdetail'] = (a0, a1) =>
    (_errdetail = Module['_errdetail'] = wasmExports['errdetail'])(a0, a1))
  let _strcmp = (Module['_strcmp'] = (a0, a1) =>
    (_strcmp = Module['_strcmp'] = wasmExports['strcmp'])(a0, a1))
  let _DatumGetEOHP = (Module['_DatumGetEOHP'] = (a0) =>
    (_DatumGetEOHP = Module['_DatumGetEOHP'] = wasmExports['DatumGetEOHP'])(a0))
  let _EOH_get_flat_size = (Module['_EOH_get_flat_size'] = (a0) =>
    (_EOH_get_flat_size = Module['_EOH_get_flat_size'] =
      wasmExports['EOH_get_flat_size'])(a0))
  let _EOH_flatten_into = (Module['_EOH_flatten_into'] = (a0, a1, a2) =>
    (_EOH_flatten_into = Module['_EOH_flatten_into'] =
      wasmExports['EOH_flatten_into'])(a0, a1, a2))
  let _toast_raw_datum_size = (Module['_toast_raw_datum_size'] = (a0) =>
    (_toast_raw_datum_size = Module['_toast_raw_datum_size'] =
      wasmExports['toast_raw_datum_size'])(a0))
  let _getmissingattr = (Module['_getmissingattr'] = (a0, a1, a2) =>
    (_getmissingattr = Module['_getmissingattr'] =
      wasmExports['getmissingattr'])(a0, a1, a2))
  let _hash_create = (Module['_hash_create'] = (a0, a1, a2, a3) =>
    (_hash_create = Module['_hash_create'] = wasmExports['hash_create'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _hash_search = (Module['_hash_search'] = (a0, a1, a2, a3) =>
    (_hash_search = Module['_hash_search'] = wasmExports['hash_search'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _nocachegetattr = (Module['_nocachegetattr'] = (a0, a1, a2) =>
    (_nocachegetattr = Module['_nocachegetattr'] =
      wasmExports['nocachegetattr'])(a0, a1, a2))
  let _heap_getsysattr = (Module['_heap_getsysattr'] = (a0, a1, a2, a3) =>
    (_heap_getsysattr = Module['_heap_getsysattr'] =
      wasmExports['heap_getsysattr'])(a0, a1, a2, a3))
  let _heap_form_tuple = (Module['_heap_form_tuple'] = (a0, a1, a2) =>
    (_heap_form_tuple = Module['_heap_form_tuple'] =
      wasmExports['heap_form_tuple'])(a0, a1, a2))
  let _heap_modify_tuple = (Module['_heap_modify_tuple'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_heap_modify_tuple = Module['_heap_modify_tuple'] =
      wasmExports['heap_modify_tuple'])(a0, a1, a2, a3, a4))
  let _heap_deform_tuple = (Module['_heap_deform_tuple'] = (a0, a1, a2, a3) =>
    (_heap_deform_tuple = Module['_heap_deform_tuple'] =
      wasmExports['heap_deform_tuple'])(a0, a1, a2, a3))
  let _heap_modify_tuple_by_cols = (Module['_heap_modify_tuple_by_cols'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_heap_modify_tuple_by_cols = Module['_heap_modify_tuple_by_cols'] =
      wasmExports['heap_modify_tuple_by_cols'])(a0, a1, a2, a3, a4, a5))
  let _heap_freetuple = (Module['_heap_freetuple'] = (a0) =>
    (_heap_freetuple = Module['_heap_freetuple'] =
      wasmExports['heap_freetuple'])(a0))
  let _hash_bytes = (Module['_hash_bytes'] = (a0, a1) =>
    (_hash_bytes = Module['_hash_bytes'] = wasmExports['hash_bytes'])(a0, a1))
  let _index_form_tuple = (Module['_index_form_tuple'] = (a0, a1, a2) =>
    (_index_form_tuple = Module['_index_form_tuple'] =
      wasmExports['index_form_tuple'])(a0, a1, a2))
  let _MemoryContextAllocZero = (Module['_MemoryContextAllocZero'] = (a0, a1) =>
    (_MemoryContextAllocZero = Module['_MemoryContextAllocZero'] =
      wasmExports['MemoryContextAllocZero'])(a0, a1))
  let _nocache_index_getattr = (Module['_nocache_index_getattr'] = (
    a0,
    a1,
    a2,
  ) =>
    (_nocache_index_getattr = Module['_nocache_index_getattr'] =
      wasmExports['nocache_index_getattr'])(a0, a1, a2))
  let _index_deform_tuple = (Module['_index_deform_tuple'] = (a0, a1, a2, a3) =>
    (_index_deform_tuple = Module['_index_deform_tuple'] =
      wasmExports['index_deform_tuple'])(a0, a1, a2, a3))
  let _CopyIndexTuple = (Module['_CopyIndexTuple'] = (a0) =>
    (_CopyIndexTuple = Module['_CopyIndexTuple'] =
      wasmExports['CopyIndexTuple'])(a0))
  let _CreateTupleDescTruncatedCopy = (Module['_CreateTupleDescTruncatedCopy'] =
    (a0, a1) =>
      (_CreateTupleDescTruncatedCopy = Module['_CreateTupleDescTruncatedCopy'] =
        wasmExports['CreateTupleDescTruncatedCopy'])(a0, a1))
  let _enlargeStringInfo = (Module['_enlargeStringInfo'] = (a0, a1) =>
    (_enlargeStringInfo = Module['_enlargeStringInfo'] =
      wasmExports['enlargeStringInfo'])(a0, a1))
  let _slot_getsomeattrs_int = (Module['_slot_getsomeattrs_int'] = (a0, a1) =>
    (_slot_getsomeattrs_int = Module['_slot_getsomeattrs_int'] =
      wasmExports['slot_getsomeattrs_int'])(a0, a1))
  let _pg_lltoa = (Module['_pg_lltoa'] = (a0, a1) =>
    (_pg_lltoa = Module['_pg_lltoa'] = wasmExports['pg_lltoa'])(a0, a1))
  let _pg_ltoa = (Module['_pg_ltoa'] = (a0, a1) =>
    (_pg_ltoa = Module['_pg_ltoa'] = wasmExports['pg_ltoa'])(a0, a1))
  let _pq_sendbytes = (Module['_pq_sendbytes'] = (a0, a1, a2) =>
    (_pq_sendbytes = Module['_pq_sendbytes'] = wasmExports['pq_sendbytes'])(
      a0,
      a1,
      a2,
    ))
  let _pg_printf = (Module['_pg_printf'] = (a0, a1) =>
    (_pg_printf = Module['_pg_printf'] = wasmExports['pg_printf'])(a0, a1))
  let _relation_open = (Module['_relation_open'] = (a0, a1) =>
    (_relation_open = Module['_relation_open'] = wasmExports['relation_open'])(
      a0,
      a1,
    ))
  let _LockRelationOid = (Module['_LockRelationOid'] = (a0, a1) =>
    (_LockRelationOid = Module['_LockRelationOid'] =
      wasmExports['LockRelationOid'])(a0, a1))
  let _RelationIdGetRelation = (Module['_RelationIdGetRelation'] = (a0) =>
    (_RelationIdGetRelation = Module['_RelationIdGetRelation'] =
      wasmExports['RelationIdGetRelation'])(a0))
  let _try_relation_open = (Module['_try_relation_open'] = (a0, a1) =>
    (_try_relation_open = Module['_try_relation_open'] =
      wasmExports['try_relation_open'])(a0, a1))
  let _UnlockRelationOid = (Module['_UnlockRelationOid'] = (a0, a1) =>
    (_UnlockRelationOid = Module['_UnlockRelationOid'] =
      wasmExports['UnlockRelationOid'])(a0, a1))
  let _relation_openrv = (Module['_relation_openrv'] = (a0, a1) =>
    (_relation_openrv = Module['_relation_openrv'] =
      wasmExports['relation_openrv'])(a0, a1))
  let _AcceptInvalidationMessages = (Module['_AcceptInvalidationMessages'] =
    () =>
      (_AcceptInvalidationMessages = Module['_AcceptInvalidationMessages'] =
        wasmExports['AcceptInvalidationMessages'])())
  let _RangeVarGetRelidExtended = (Module['_RangeVarGetRelidExtended'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_RangeVarGetRelidExtended = Module['_RangeVarGetRelidExtended'] =
      wasmExports['RangeVarGetRelidExtended'])(a0, a1, a2, a3, a4))
  let _RelationClose = (Module['_RelationClose'] = (a0) =>
    (_RelationClose = Module['_RelationClose'] = wasmExports['RelationClose'])(
      a0,
    ))
  let _add_reloption_kind = (Module['_add_reloption_kind'] = () =>
    (_add_reloption_kind = Module['_add_reloption_kind'] =
      wasmExports['add_reloption_kind'])())
  let _register_reloptions_validator = (Module[
    '_register_reloptions_validator'
  ] = (a0, a1) =>
    (_register_reloptions_validator = Module['_register_reloptions_validator'] =
      wasmExports['register_reloptions_validator'])(a0, a1))
  let _lappend = (Module['_lappend'] = (a0, a1) =>
    (_lappend = Module['_lappend'] = wasmExports['lappend'])(a0, a1))
  let _pstrdup = (Module['_pstrdup'] = (a0) =>
    (_pstrdup = Module['_pstrdup'] = wasmExports['pstrdup'])(a0))
  let _add_int_reloption = (Module['_add_int_reloption'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_add_int_reloption = Module['_add_int_reloption'] =
      wasmExports['add_int_reloption'])(a0, a1, a2, a3, a4, a5, a6))
  let _add_real_reloption = (Module['_add_real_reloption'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_add_real_reloption = Module['_add_real_reloption'] =
      wasmExports['add_real_reloption'])(a0, a1, a2, a3, a4, a5, a6))
  let _add_string_reloption = (Module['_add_string_reloption'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_add_string_reloption = Module['_add_string_reloption'] =
      wasmExports['add_string_reloption'])(a0, a1, a2, a3, a4, a5))
  let _strdup = (Module['_strdup'] = (a0) =>
    (_strdup = Module['_strdup'] = wasmExports['strdup'])(a0))
  let _MemoryContextStrdup = (Module['_MemoryContextStrdup'] = (a0, a1) =>
    (_MemoryContextStrdup = Module['_MemoryContextStrdup'] =
      wasmExports['MemoryContextStrdup'])(a0, a1))
  let _transformRelOptions = (Module['_transformRelOptions'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_transformRelOptions = Module['_transformRelOptions'] =
      wasmExports['transformRelOptions'])(a0, a1, a2, a3, a4, a5))
  let _deconstruct_array_builtin = (Module['_deconstruct_array_builtin'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_deconstruct_array_builtin = Module['_deconstruct_array_builtin'] =
      wasmExports['deconstruct_array_builtin'])(a0, a1, a2, a3, a4))
  let _strncmp = (Module['_strncmp'] = (a0, a1, a2) =>
    (_strncmp = Module['_strncmp'] = wasmExports['strncmp'])(a0, a1, a2))
  let _defGetString = (Module['_defGetString'] = (a0) =>
    (_defGetString = Module['_defGetString'] = wasmExports['defGetString'])(a0))
  let _strchr = (Module['_strchr'] = (a0, a1) =>
    (_strchr = Module['_strchr'] = wasmExports['strchr'])(a0, a1))
  let _defGetBoolean = (Module['_defGetBoolean'] = (a0) =>
    (_defGetBoolean = Module['_defGetBoolean'] = wasmExports['defGetBoolean'])(
      a0,
    ))
  let _pg_sprintf = (Module['_pg_sprintf'] = (a0, a1, a2) =>
    (_pg_sprintf = Module['_pg_sprintf'] = wasmExports['pg_sprintf'])(
      a0,
      a1,
      a2,
    ))
  let _untransformRelOptions = (Module['_untransformRelOptions'] = (a0) =>
    (_untransformRelOptions = Module['_untransformRelOptions'] =
      wasmExports['untransformRelOptions'])(a0))
  let _text_to_cstring = (Module['_text_to_cstring'] = (a0) =>
    (_text_to_cstring = Module['_text_to_cstring'] =
      wasmExports['text_to_cstring'])(a0))
  let _makeString = (Module['_makeString'] = (a0) =>
    (_makeString = Module['_makeString'] = wasmExports['makeString'])(a0))
  let _makeDefElem = (Module['_makeDefElem'] = (a0, a1, a2) =>
    (_makeDefElem = Module['_makeDefElem'] = wasmExports['makeDefElem'])(
      a0,
      a1,
      a2,
    ))
  let _heap_reloptions = (Module['_heap_reloptions'] = (a0, a1, a2) =>
    (_heap_reloptions = Module['_heap_reloptions'] =
      wasmExports['heap_reloptions'])(a0, a1, a2))
  let _strcpy = (Module['_strcpy'] = (a0, a1) =>
    (_strcpy = Module['_strcpy'] = wasmExports['strcpy'])(a0, a1))
  let _MemoryContextAlloc = (Module['_MemoryContextAlloc'] = (a0, a1) =>
    (_MemoryContextAlloc = Module['_MemoryContextAlloc'] =
      wasmExports['MemoryContextAlloc'])(a0, a1))
  let _parse_bool = (Module['_parse_bool'] = (a0, a1) =>
    (_parse_bool = Module['_parse_bool'] = wasmExports['parse_bool'])(a0, a1))
  let _parse_int = (Module['_parse_int'] = (a0, a1, a2, a3) =>
    (_parse_int = Module['_parse_int'] = wasmExports['parse_int'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _parse_real = (Module['_parse_real'] = (a0, a1, a2, a3) =>
    (_parse_real = Module['_parse_real'] = wasmExports['parse_real'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _pg_strcasecmp = (Module['_pg_strcasecmp'] = (a0, a1) =>
    (_pg_strcasecmp = Module['_pg_strcasecmp'] = wasmExports['pg_strcasecmp'])(
      a0,
      a1,
    ))
  let _ScanKeyInit = (Module['_ScanKeyInit'] = (a0, a1, a2, a3, a4) =>
    (_ScanKeyInit = Module['_ScanKeyInit'] = wasmExports['ScanKeyInit'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _dsm_segment_handle = (Module['_dsm_segment_handle'] = (a0) =>
    (_dsm_segment_handle = Module['_dsm_segment_handle'] =
      wasmExports['dsm_segment_handle'])(a0))
  let _dsm_create = (Module['_dsm_create'] = (a0, a1) =>
    (_dsm_create = Module['_dsm_create'] = wasmExports['dsm_create'])(a0, a1))
  let _dsm_segment_address = (Module['_dsm_segment_address'] = (a0) =>
    (_dsm_segment_address = Module['_dsm_segment_address'] =
      wasmExports['dsm_segment_address'])(a0))
  let _dsa_pin_mapping = (Module['_dsa_pin_mapping'] = (a0) =>
    (_dsa_pin_mapping = Module['_dsa_pin_mapping'] =
      wasmExports['dsa_pin_mapping'])(a0))
  let _dsm_attach = (Module['_dsm_attach'] = (a0) =>
    (_dsm_attach = Module['_dsm_attach'] = wasmExports['dsm_attach'])(a0))
  let _dsm_detach = (Module['_dsm_detach'] = (a0) =>
    (_dsm_detach = Module['_dsm_detach'] = wasmExports['dsm_detach'])(a0))
  let _dsa_detach = (Module['_dsa_detach'] = (a0) =>
    (_dsa_detach = Module['_dsa_detach'] = wasmExports['dsa_detach'])(a0))
  let _ShmemInitStruct = (Module['_ShmemInitStruct'] = (a0, a1, a2) =>
    (_ShmemInitStruct = Module['_ShmemInitStruct'] =
      wasmExports['ShmemInitStruct'])(a0, a1, a2))
  let _LWLockAcquire = (Module['_LWLockAcquire'] = (a0, a1) =>
    (_LWLockAcquire = Module['_LWLockAcquire'] = wasmExports['LWLockAcquire'])(
      a0,
      a1,
    ))
  let _LWLockRelease = (Module['_LWLockRelease'] = (a0) =>
    (_LWLockRelease = Module['_LWLockRelease'] = wasmExports['LWLockRelease'])(
      a0,
    ))
  let _LWLockConditionalAcquire = (Module['_LWLockConditionalAcquire'] = (
    a0,
    a1,
  ) =>
    (_LWLockConditionalAcquire = Module['_LWLockConditionalAcquire'] =
      wasmExports['LWLockConditionalAcquire'])(a0, a1))
  let _dsa_create_ext = (Module['_dsa_create_ext'] = (a0, a1, a2) =>
    (_dsa_create_ext = Module['_dsa_create_ext'] =
      wasmExports['dsa_create_ext'])(a0, a1, a2))
  let _dsa_allocate_extended = (Module['_dsa_allocate_extended'] = (
    a0,
    a1,
    a2,
  ) =>
    (_dsa_allocate_extended = Module['_dsa_allocate_extended'] =
      wasmExports['dsa_allocate_extended'])(a0, a1, a2))
  let _dsa_get_address = (Module['_dsa_get_address'] = (a0, a1) =>
    (_dsa_get_address = Module['_dsa_get_address'] =
      wasmExports['dsa_get_address'])(a0, a1))
  let _LWLockInitialize = (Module['_LWLockInitialize'] = (a0, a1) =>
    (_LWLockInitialize = Module['_LWLockInitialize'] =
      wasmExports['LWLockInitialize'])(a0, a1))
  let _dsa_attach = (Module['_dsa_attach'] = (a0) =>
    (_dsa_attach = Module['_dsa_attach'] = wasmExports['dsa_attach'])(a0))
  let _dsa_free = (Module['_dsa_free'] = (a0, a1) =>
    (_dsa_free = Module['_dsa_free'] = wasmExports['dsa_free'])(a0, a1))
  let _dsa_get_total_size = (Module['_dsa_get_total_size'] = (a0) =>
    (_dsa_get_total_size = Module['_dsa_get_total_size'] =
      wasmExports['dsa_get_total_size'])(a0))
  let _MemoryContextMemAllocated = (Module['_MemoryContextMemAllocated'] = (
    a0,
    a1,
  ) =>
    (_MemoryContextMemAllocated = Module['_MemoryContextMemAllocated'] =
      wasmExports['MemoryContextMemAllocated'])(a0, a1))
  let _check_stack_depth = (Module['_check_stack_depth'] = () =>
    (_check_stack_depth = Module['_check_stack_depth'] =
      wasmExports['check_stack_depth'])())
  let _GetCurrentCommandId = (Module['_GetCurrentCommandId'] = (a0) =>
    (_GetCurrentCommandId = Module['_GetCurrentCommandId'] =
      wasmExports['GetCurrentCommandId'])(a0))
  let _toast_open_indexes = (Module['_toast_open_indexes'] = (a0, a1, a2, a3) =>
    (_toast_open_indexes = Module['_toast_open_indexes'] =
      wasmExports['toast_open_indexes'])(a0, a1, a2, a3))
  let _heap_insert = (Module['_heap_insert'] = (a0, a1, a2, a3, a4) =>
    (_heap_insert = Module['_heap_insert'] = wasmExports['heap_insert'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _RelationGetIndexList = (Module['_RelationGetIndexList'] = (a0) =>
    (_RelationGetIndexList = Module['_RelationGetIndexList'] =
      wasmExports['RelationGetIndexList'])(a0))
  let _list_free = (Module['_list_free'] = (a0) =>
    (_list_free = Module['_list_free'] = wasmExports['list_free'])(a0))
  let _systable_beginscan = (Module['_systable_beginscan'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_systable_beginscan = Module['_systable_beginscan'] =
      wasmExports['systable_beginscan'])(a0, a1, a2, a3, a4, a5))
  let _systable_getnext = (Module['_systable_getnext'] = (a0) =>
    (_systable_getnext = Module['_systable_getnext'] =
      wasmExports['systable_getnext'])(a0))
  let _systable_endscan = (Module['_systable_endscan'] = (a0) =>
    (_systable_endscan = Module['_systable_endscan'] =
      wasmExports['systable_endscan'])(a0))
  let _toast_close_indexes = (Module['_toast_close_indexes'] = (a0, a1, a2) =>
    (_toast_close_indexes = Module['_toast_close_indexes'] =
      wasmExports['toast_close_indexes'])(a0, a1, a2))
  let _systable_beginscan_ordered = (Module['_systable_beginscan_ordered'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_systable_beginscan_ordered = Module['_systable_beginscan_ordered'] =
      wasmExports['systable_beginscan_ordered'])(a0, a1, a2, a3, a4))
  let _systable_getnext_ordered = (Module['_systable_getnext_ordered'] = (
    a0,
    a1,
  ) =>
    (_systable_getnext_ordered = Module['_systable_getnext_ordered'] =
      wasmExports['systable_getnext_ordered'])(a0, a1))
  let _systable_endscan_ordered = (Module['_systable_endscan_ordered'] = (a0) =>
    (_systable_endscan_ordered = Module['_systable_endscan_ordered'] =
      wasmExports['systable_endscan_ordered'])(a0))
  let _get_toast_snapshot = (Module['_get_toast_snapshot'] = () =>
    (_get_toast_snapshot = Module['_get_toast_snapshot'] =
      wasmExports['get_toast_snapshot'])())
  let _convert_tuples_by_position = (Module['_convert_tuples_by_position'] = (
    a0,
    a1,
    a2,
  ) =>
    (_convert_tuples_by_position = Module['_convert_tuples_by_position'] =
      wasmExports['convert_tuples_by_position'])(a0, a1, a2))
  let _execute_attr_map_tuple = (Module['_execute_attr_map_tuple'] = (a0, a1) =>
    (_execute_attr_map_tuple = Module['_execute_attr_map_tuple'] =
      wasmExports['execute_attr_map_tuple'])(a0, a1))
  let _ExecStoreVirtualTuple = (Module['_ExecStoreVirtualTuple'] = (a0) =>
    (_ExecStoreVirtualTuple = Module['_ExecStoreVirtualTuple'] =
      wasmExports['ExecStoreVirtualTuple'])(a0))
  let _bms_is_member = (Module['_bms_is_member'] = (a0, a1) =>
    (_bms_is_member = Module['_bms_is_member'] = wasmExports['bms_is_member'])(
      a0,
      a1,
    ))
  let _bms_add_member = (Module['_bms_add_member'] = (a0, a1) =>
    (_bms_add_member = Module['_bms_add_member'] =
      wasmExports['bms_add_member'])(a0, a1))
  let _CreateTupleDescCopy = (Module['_CreateTupleDescCopy'] = (a0) =>
    (_CreateTupleDescCopy = Module['_CreateTupleDescCopy'] =
      wasmExports['CreateTupleDescCopy'])(a0))
  let _ResourceOwnerEnlarge = (Module['_ResourceOwnerEnlarge'] = (a0) =>
    (_ResourceOwnerEnlarge = Module['_ResourceOwnerEnlarge'] =
      wasmExports['ResourceOwnerEnlarge'])(a0))
  let _ResourceOwnerRemember = (Module['_ResourceOwnerRemember'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ResourceOwnerRemember = Module['_ResourceOwnerRemember'] =
      wasmExports['ResourceOwnerRemember'])(a0, a1, a2))
  let _DecrTupleDescRefCount = (Module['_DecrTupleDescRefCount'] = (a0) =>
    (_DecrTupleDescRefCount = Module['_DecrTupleDescRefCount'] =
      wasmExports['DecrTupleDescRefCount'])(a0))
  let _ResourceOwnerForget = (Module['_ResourceOwnerForget'] = (a0, a1, a2) =>
    (_ResourceOwnerForget = Module['_ResourceOwnerForget'] =
      wasmExports['ResourceOwnerForget'])(a0, a1, a2))
  let _datumIsEqual = (Module['_datumIsEqual'] = (a0, a1, a2, a3) =>
    (_datumIsEqual = Module['_datumIsEqual'] = wasmExports['datumIsEqual'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _namestrcpy = (Module['_namestrcpy'] = (a0, a1) =>
    (_namestrcpy = Module['_namestrcpy'] = wasmExports['namestrcpy'])(a0, a1))
  let _TupleDescInitEntryCollation = (Module['_TupleDescInitEntryCollation'] = (
    a0,
    a1,
    a2,
  ) =>
    (_TupleDescInitEntryCollation = Module['_TupleDescInitEntryCollation'] =
      wasmExports['TupleDescInitEntryCollation'])(a0, a1, a2))
  let _stringToNode = (Module['_stringToNode'] = (a0) =>
    (_stringToNode = Module['_stringToNode'] = wasmExports['stringToNode'])(a0))
  let _psprintf = (Module['_psprintf'] = (a0, a1) =>
    (_psprintf = Module['_psprintf'] = wasmExports['psprintf'])(a0, a1))
  let _pg_detoast_datum_copy = (Module['_pg_detoast_datum_copy'] = (a0) =>
    (_pg_detoast_datum_copy = Module['_pg_detoast_datum_copy'] =
      wasmExports['pg_detoast_datum_copy'])(a0))
  let _get_typlenbyvalalign = (Module['_get_typlenbyvalalign'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_get_typlenbyvalalign = Module['_get_typlenbyvalalign'] =
      wasmExports['get_typlenbyvalalign'])(a0, a1, a2, a3))
  let _deconstruct_array = (Module['_deconstruct_array'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_deconstruct_array = Module['_deconstruct_array'] =
      wasmExports['deconstruct_array'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _ginCompareAttEntries = (Module['_ginCompareAttEntries'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_ginCompareAttEntries = Module['_ginCompareAttEntries'] =
      wasmExports['ginCompareAttEntries'])(a0, a1, a2, a3, a4, a5, a6))
  let _repalloc_huge = (Module['_repalloc_huge'] = (a0, a1) =>
    (_repalloc_huge = Module['_repalloc_huge'] = wasmExports['repalloc_huge'])(
      a0,
      a1,
    ))
  let _GinDataLeafPageGetItems = (Module['_GinDataLeafPageGetItems'] = (
    a0,
    a1,
    a2,
  ) =>
    (_GinDataLeafPageGetItems = Module['_GinDataLeafPageGetItems'] =
      wasmExports['GinDataLeafPageGetItems'])(a0, a1, a2))
  let _tbm_add_tuples = (Module['_tbm_add_tuples'] = (a0, a1, a2, a3) =>
    (_tbm_add_tuples = Module['_tbm_add_tuples'] =
      wasmExports['tbm_add_tuples'])(a0, a1, a2, a3))
  let _ginPostingListDecode = (Module['_ginPostingListDecode'] = (a0, a1) =>
    (_ginPostingListDecode = Module['_ginPostingListDecode'] =
      wasmExports['ginPostingListDecode'])(a0, a1))
  let _ItemPointerCompare = (Module['_ItemPointerCompare'] = (a0, a1) =>
    (_ItemPointerCompare = Module['_ItemPointerCompare'] =
      wasmExports['ItemPointerCompare'])(a0, a1))
  let _gintuple_get_attrnum = (Module['_gintuple_get_attrnum'] = (a0, a1) =>
    (_gintuple_get_attrnum = Module['_gintuple_get_attrnum'] =
      wasmExports['gintuple_get_attrnum'])(a0, a1))
  let _gintuple_get_key = (Module['_gintuple_get_key'] = (a0, a1, a2) =>
    (_gintuple_get_key = Module['_gintuple_get_key'] =
      wasmExports['gintuple_get_key'])(a0, a1, a2))
  let _LockPage = (Module['_LockPage'] = (a0, a1, a2) =>
    (_LockPage = Module['_LockPage'] = wasmExports['LockPage'])(a0, a1, a2))
  let _UnlockPage = (Module['_UnlockPage'] = (a0, a1, a2) =>
    (_UnlockPage = Module['_UnlockPage'] = wasmExports['UnlockPage'])(
      a0,
      a1,
      a2,
    ))
  let _vacuum_delay_point = (Module['_vacuum_delay_point'] = (a0) =>
    (_vacuum_delay_point = Module['_vacuum_delay_point'] =
      wasmExports['vacuum_delay_point'])(a0))
  let _RecordFreeIndexPage = (Module['_RecordFreeIndexPage'] = (a0, a1) =>
    (_RecordFreeIndexPage = Module['_RecordFreeIndexPage'] =
      wasmExports['RecordFreeIndexPage'])(a0, a1))
  let _IndexFreeSpaceMapVacuum = (Module['_IndexFreeSpaceMapVacuum'] = (a0) =>
    (_IndexFreeSpaceMapVacuum = Module['_IndexFreeSpaceMapVacuum'] =
      wasmExports['IndexFreeSpaceMapVacuum'])(a0))
  let _initGinState = (Module['_initGinState'] = (a0, a1) =>
    (_initGinState = Module['_initGinState'] = wasmExports['initGinState'])(
      a0,
      a1,
    ))
  let _pg_prng_double = (Module['_pg_prng_double'] = (a0) =>
    (_pg_prng_double = Module['_pg_prng_double'] =
      wasmExports['pg_prng_double'])(a0))
  let _pgstat_progress_update_param = (Module['_pgstat_progress_update_param'] =
    (a0, a1) =>
      (_pgstat_progress_update_param = Module['_pgstat_progress_update_param'] =
        wasmExports['pgstat_progress_update_param'])(a0, a1))
  let _log_newpage_range = (Module['_log_newpage_range'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_log_newpage_range = Module['_log_newpage_range'] =
      wasmExports['log_newpage_range'])(a0, a1, a2, a3, a4))
  let _GetFreeIndexPage = (Module['_GetFreeIndexPage'] = (a0) =>
    (_GetFreeIndexPage = Module['_GetFreeIndexPage'] =
      wasmExports['GetFreeIndexPage'])(a0))
  let _ConditionalLockBuffer = (Module['_ConditionalLockBuffer'] = (a0) =>
    (_ConditionalLockBuffer = Module['_ConditionalLockBuffer'] =
      wasmExports['ConditionalLockBuffer'])(a0))
  let _LockBufferForCleanup = (Module['_LockBufferForCleanup'] = (a0) =>
    (_LockBufferForCleanup = Module['_LockBufferForCleanup'] =
      wasmExports['LockBufferForCleanup'])(a0))
  let _ReadNextFullTransactionId = (Module['_ReadNextFullTransactionId'] = () =>
    (_ReadNextFullTransactionId = Module['_ReadNextFullTransactionId'] =
      wasmExports['ReadNextFullTransactionId'])())
  let _PageIndexMultiDelete = (Module['_PageIndexMultiDelete'] = (a0, a1, a2) =>
    (_PageIndexMultiDelete = Module['_PageIndexMultiDelete'] =
      wasmExports['PageIndexMultiDelete'])(a0, a1, a2))
  let _list_make1_impl = (Module['_list_make1_impl'] = (a0, a1) =>
    (_list_make1_impl = Module['_list_make1_impl'] =
      wasmExports['list_make1_impl'])(a0, a1))
  let _lcons = (Module['_lcons'] = (a0, a1) =>
    (_lcons = Module['_lcons'] = wasmExports['lcons'])(a0, a1))
  let _pow = (Module['_pow'] = (a0, a1) =>
    (_pow = Module['_pow'] = wasmExports['pow'])(a0, a1))
  let _smgrnblocks = (Module['_smgrnblocks'] = (a0, a1) =>
    (_smgrnblocks = Module['_smgrnblocks'] = wasmExports['smgrnblocks'])(
      a0,
      a1,
    ))
  let _list_free_deep = (Module['_list_free_deep'] = (a0) =>
    (_list_free_deep = Module['_list_free_deep'] =
      wasmExports['list_free_deep'])(a0))
  let _BufFileWrite = (Module['_BufFileWrite'] = (a0, a1, a2) =>
    (_BufFileWrite = Module['_BufFileWrite'] = wasmExports['BufFileWrite'])(
      a0,
      a1,
      a2,
    ))
  let _BufFileReadExact = (Module['_BufFileReadExact'] = (a0, a1, a2) =>
    (_BufFileReadExact = Module['_BufFileReadExact'] =
      wasmExports['BufFileReadExact'])(a0, a1, a2))
  let _BufFileClose = (Module['_BufFileClose'] = (a0) =>
    (_BufFileClose = Module['_BufFileClose'] = wasmExports['BufFileClose'])(a0))
  let _pairingheap_remove_first = (Module['_pairingheap_remove_first'] = (a0) =>
    (_pairingheap_remove_first = Module['_pairingheap_remove_first'] =
      wasmExports['pairingheap_remove_first'])(a0))
  let _pairingheap_add = (Module['_pairingheap_add'] = (a0, a1) =>
    (_pairingheap_add = Module['_pairingheap_add'] =
      wasmExports['pairingheap_add'])(a0, a1))
  let _float_overflow_error = (Module['_float_overflow_error'] = () =>
    (_float_overflow_error = Module['_float_overflow_error'] =
      wasmExports['float_overflow_error'])())
  let _float8_cmp_internal = (Module['_float8_cmp_internal'] = (a0, a1) =>
    (_float8_cmp_internal = Module['_float8_cmp_internal'] =
      wasmExports['float8_cmp_internal'])(a0, a1))
  let _float_underflow_error = (Module['_float_underflow_error'] = () =>
    (_float_underflow_error = Module['_float_underflow_error'] =
      wasmExports['float_underflow_error'])())
  let _DirectFunctionCall5Coll = (Module['_DirectFunctionCall5Coll'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_DirectFunctionCall5Coll = Module['_DirectFunctionCall5Coll'] =
      wasmExports['DirectFunctionCall5Coll'])(a0, a1, a2, a3, a4, a5, a6))
  let _pairingheap_allocate = (Module['_pairingheap_allocate'] = (a0, a1) =>
    (_pairingheap_allocate = Module['_pairingheap_allocate'] =
      wasmExports['pairingheap_allocate'])(a0, a1))
  let _GetXLogInsertRecPtr = (Module['_GetXLogInsertRecPtr'] = () =>
    (_GetXLogInsertRecPtr = Module['_GetXLogInsertRecPtr'] =
      wasmExports['GetXLogInsertRecPtr'])())
  let _OidFunctionCall1Coll = (Module['_OidFunctionCall1Coll'] = (a0, a1, a2) =>
    (_OidFunctionCall1Coll = Module['_OidFunctionCall1Coll'] =
      wasmExports['OidFunctionCall1Coll'])(a0, a1, a2))
  let _GenerationContextCreate = (Module['_GenerationContextCreate'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_GenerationContextCreate = Module['_GenerationContextCreate'] =
      wasmExports['GenerationContextCreate'])(a0, a1, a2, a3, a4))
  let _block_range_read_stream_cb = (Module['_block_range_read_stream_cb'] = (
    a0,
    a1,
    a2,
  ) =>
    (_block_range_read_stream_cb = Module['_block_range_read_stream_cb'] =
      wasmExports['block_range_read_stream_cb'])(a0, a1, a2))
  let _read_stream_begin_relation = (Module['_read_stream_begin_relation'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_read_stream_begin_relation = Module['_read_stream_begin_relation'] =
      wasmExports['read_stream_begin_relation'])(a0, a1, a2, a3, a4, a5, a6))
  let _read_stream_next_buffer = (Module['_read_stream_next_buffer'] = (
    a0,
    a1,
  ) =>
    (_read_stream_next_buffer = Module['_read_stream_next_buffer'] =
      wasmExports['read_stream_next_buffer'])(a0, a1))
  let _read_stream_end = (Module['_read_stream_end'] = (a0) =>
    (_read_stream_end = Module['_read_stream_end'] =
      wasmExports['read_stream_end'])(a0))
  let __hash_getbuf = (Module['__hash_getbuf'] = (a0, a1, a2, a3) =>
    (__hash_getbuf = Module['__hash_getbuf'] = wasmExports['_hash_getbuf'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let __hash_relbuf = (Module['__hash_relbuf'] = (a0, a1) =>
    (__hash_relbuf = Module['__hash_relbuf'] = wasmExports['_hash_relbuf'])(
      a0,
      a1,
    ))
  let __hash_get_indextuple_hashkey = (Module['__hash_get_indextuple_hashkey'] =
    (a0) =>
      (__hash_get_indextuple_hashkey = Module['__hash_get_indextuple_hashkey'] =
        wasmExports['_hash_get_indextuple_hashkey'])(a0))
  let _hashcharextended = (Module['_hashcharextended'] = (a0) =>
    (_hashcharextended = Module['_hashcharextended'] =
      wasmExports['hashcharextended'])(a0))
  let _hashint8 = (Module['_hashint8'] = (a0) =>
    (_hashint8 = Module['_hashint8'] = wasmExports['hashint8'])(a0))
  let _hashint8extended = (Module['_hashint8extended'] = (a0) =>
    (_hashint8extended = Module['_hashint8extended'] =
      wasmExports['hashint8extended'])(a0))
  let _hash_bytes_extended = (Module['_hash_bytes_extended'] = (a0, a1, a2) =>
    (_hash_bytes_extended = Module['_hash_bytes_extended'] =
      wasmExports['hash_bytes_extended'])(a0, a1, a2))
  let _hashfloat8 = (Module['_hashfloat8'] = (a0) =>
    (_hashfloat8 = Module['_hashfloat8'] = wasmExports['hashfloat8'])(a0))
  let _hashfloat8extended = (Module['_hashfloat8extended'] = (a0) =>
    (_hashfloat8extended = Module['_hashfloat8extended'] =
      wasmExports['hashfloat8extended'])(a0))
  let _pg_newlocale_from_collation = (Module['_pg_newlocale_from_collation'] = (
    a0,
  ) =>
    (_pg_newlocale_from_collation = Module['_pg_newlocale_from_collation'] =
      wasmExports['pg_newlocale_from_collation'])(a0))
  let __hash_ovflblkno_to_bitno = (Module['__hash_ovflblkno_to_bitno'] = (
    a0,
    a1,
  ) =>
    (__hash_ovflblkno_to_bitno = Module['__hash_ovflblkno_to_bitno'] =
      wasmExports['_hash_ovflblkno_to_bitno'])(a0, a1))
  let _hash_destroy = (Module['_hash_destroy'] = (a0) =>
    (_hash_destroy = Module['_hash_destroy'] = wasmExports['hash_destroy'])(a0))
  let _list_member_oid = (Module['_list_member_oid'] = (a0, a1) =>
    (_list_member_oid = Module['_list_member_oid'] =
      wasmExports['list_member_oid'])(a0, a1))
  let _CommandCounterIncrement = (Module['_CommandCounterIncrement'] = () =>
    (_CommandCounterIncrement = Module['_CommandCounterIncrement'] =
      wasmExports['CommandCounterIncrement'])())
  let _list_concat_copy = (Module['_list_concat_copy'] = (a0, a1) =>
    (_list_concat_copy = Module['_list_concat_copy'] =
      wasmExports['list_concat_copy'])(a0, a1))
  let _HeapTupleSatisfiesVisibility = (Module['_HeapTupleSatisfiesVisibility'] =
    (a0, a1, a2) =>
      (_HeapTupleSatisfiesVisibility = Module['_HeapTupleSatisfiesVisibility'] =
        wasmExports['HeapTupleSatisfiesVisibility'])(a0, a1, a2))
  let _GetAccessStrategy = (Module['_GetAccessStrategy'] = (a0) =>
    (_GetAccessStrategy = Module['_GetAccessStrategy'] =
      wasmExports['GetAccessStrategy'])(a0))
  let _FreeAccessStrategy = (Module['_FreeAccessStrategy'] = (a0) =>
    (_FreeAccessStrategy = Module['_FreeAccessStrategy'] =
      wasmExports['FreeAccessStrategy'])(a0))
  let _heap_getnext = (Module['_heap_getnext'] = (a0, a1) =>
    (_heap_getnext = Module['_heap_getnext'] = wasmExports['heap_getnext'])(
      a0,
      a1,
    ))
  let _ExecStoreBufferHeapTuple = (Module['_ExecStoreBufferHeapTuple'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ExecStoreBufferHeapTuple = Module['_ExecStoreBufferHeapTuple'] =
      wasmExports['ExecStoreBufferHeapTuple'])(a0, a1, a2))
  let _heap_fetch = (Module['_heap_fetch'] = (a0, a1, a2, a3, a4) =>
    (_heap_fetch = Module['_heap_fetch'] = wasmExports['heap_fetch'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _HeapTupleSatisfiesVacuum = (Module['_HeapTupleSatisfiesVacuum'] = (
    a0,
    a1,
    a2,
  ) =>
    (_HeapTupleSatisfiesVacuum = Module['_HeapTupleSatisfiesVacuum'] =
      wasmExports['HeapTupleSatisfiesVacuum'])(a0, a1, a2))
  let _GetMultiXactIdMembers = (Module['_GetMultiXactIdMembers'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_GetMultiXactIdMembers = Module['_GetMultiXactIdMembers'] =
      wasmExports['GetMultiXactIdMembers'])(a0, a1, a2, a3))
  let _TransactionIdPrecedes = (Module['_TransactionIdPrecedes'] = (a0, a1) =>
    (_TransactionIdPrecedes = Module['_TransactionIdPrecedes'] =
      wasmExports['TransactionIdPrecedes'])(a0, a1))
  let _GetBulkInsertState = (Module['_GetBulkInsertState'] = () =>
    (_GetBulkInsertState = Module['_GetBulkInsertState'] =
      wasmExports['GetBulkInsertState'])())
  let _FreeBulkInsertState = (Module['_FreeBulkInsertState'] = (a0) =>
    (_FreeBulkInsertState = Module['_FreeBulkInsertState'] =
      wasmExports['FreeBulkInsertState'])(a0))
  let _visibilitymap_clear = (Module['_visibilitymap_clear'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_visibilitymap_clear = Module['_visibilitymap_clear'] =
      wasmExports['visibilitymap_clear'])(a0, a1, a2, a3))
  let _pgstat_count_heap_insert = (Module['_pgstat_count_heap_insert'] = (
    a0,
    a1,
  ) =>
    (_pgstat_count_heap_insert = Module['_pgstat_count_heap_insert'] =
      wasmExports['pgstat_count_heap_insert'])(a0, a1))
  let _heap_multi_insert = (Module['_heap_multi_insert'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_heap_multi_insert = Module['_heap_multi_insert'] =
      wasmExports['heap_multi_insert'])(a0, a1, a2, a3, a4, a5))
  let _ExecFetchSlotHeapTuple = (Module['_ExecFetchSlotHeapTuple'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ExecFetchSlotHeapTuple = Module['_ExecFetchSlotHeapTuple'] =
      wasmExports['ExecFetchSlotHeapTuple'])(a0, a1, a2))
  let _heap_delete = (Module['_heap_delete'] = (a0, a1, a2, a3, a4, a5, a6) =>
    (_heap_delete = Module['_heap_delete'] = wasmExports['heap_delete'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
    ))
  let _visibilitymap_pin = (Module['_visibilitymap_pin'] = (a0, a1, a2) =>
    (_visibilitymap_pin = Module['_visibilitymap_pin'] =
      wasmExports['visibilitymap_pin'])(a0, a1, a2))
  let _HeapTupleSatisfiesUpdate = (Module['_HeapTupleSatisfiesUpdate'] = (
    a0,
    a1,
    a2,
  ) =>
    (_HeapTupleSatisfiesUpdate = Module['_HeapTupleSatisfiesUpdate'] =
      wasmExports['HeapTupleSatisfiesUpdate'])(a0, a1, a2))
  let _TransactionIdIsCurrentTransactionId = (Module[
    '_TransactionIdIsCurrentTransactionId'
  ] = (a0) =>
    (_TransactionIdIsCurrentTransactionId = Module[
      '_TransactionIdIsCurrentTransactionId'
    ] =
      wasmExports['TransactionIdIsCurrentTransactionId'])(a0))
  let _TransactionIdDidCommit = (Module['_TransactionIdDidCommit'] = (a0) =>
    (_TransactionIdDidCommit = Module['_TransactionIdDidCommit'] =
      wasmExports['TransactionIdDidCommit'])(a0))
  let _TransactionIdIsInProgress = (Module['_TransactionIdIsInProgress'] = (
    a0,
  ) =>
    (_TransactionIdIsInProgress = Module['_TransactionIdIsInProgress'] =
      wasmExports['TransactionIdIsInProgress'])(a0))
  let _bms_free = (Module['_bms_free'] = (a0) =>
    (_bms_free = Module['_bms_free'] = wasmExports['bms_free'])(a0))
  let _bms_add_members = (Module['_bms_add_members'] = (a0, a1) =>
    (_bms_add_members = Module['_bms_add_members'] =
      wasmExports['bms_add_members'])(a0, a1))
  let _bms_next_member = (Module['_bms_next_member'] = (a0, a1) =>
    (_bms_next_member = Module['_bms_next_member'] =
      wasmExports['bms_next_member'])(a0, a1))
  let _bms_overlap = (Module['_bms_overlap'] = (a0, a1) =>
    (_bms_overlap = Module['_bms_overlap'] = wasmExports['bms_overlap'])(
      a0,
      a1,
    ))
  let _HeapTupleGetUpdateXid = (Module['_HeapTupleGetUpdateXid'] = (a0) =>
    (_HeapTupleGetUpdateXid = Module['_HeapTupleGetUpdateXid'] =
      wasmExports['HeapTupleGetUpdateXid'])(a0))
  let _heap_lock_tuple = (Module['_heap_lock_tuple'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_heap_lock_tuple = Module['_heap_lock_tuple'] =
      wasmExports['heap_lock_tuple'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _MultiXactIdPrecedes = (Module['_MultiXactIdPrecedes'] = (a0, a1) =>
    (_MultiXactIdPrecedes = Module['_MultiXactIdPrecedes'] =
      wasmExports['MultiXactIdPrecedes'])(a0, a1))
  let _heap_tuple_needs_eventual_freeze = (Module[
    '_heap_tuple_needs_eventual_freeze'
  ] = (a0) =>
    (_heap_tuple_needs_eventual_freeze = Module[
      '_heap_tuple_needs_eventual_freeze'
    ] =
      wasmExports['heap_tuple_needs_eventual_freeze'])(a0))
  let _PrefetchBuffer = (Module['_PrefetchBuffer'] = (a0, a1, a2, a3) =>
    (_PrefetchBuffer = Module['_PrefetchBuffer'] =
      wasmExports['PrefetchBuffer'])(a0, a1, a2, a3))
  let _RelationTruncate = (Module['_RelationTruncate'] = (a0, a1) =>
    (_RelationTruncate = Module['_RelationTruncate'] =
      wasmExports['RelationTruncate'])(a0, a1))
  let _FlushRelationBuffers = (Module['_FlushRelationBuffers'] = (a0) =>
    (_FlushRelationBuffers = Module['_FlushRelationBuffers'] =
      wasmExports['FlushRelationBuffers'])(a0))
  let _smgrexists = (Module['_smgrexists'] = (a0, a1) =>
    (_smgrexists = Module['_smgrexists'] = wasmExports['smgrexists'])(a0, a1))
  let _table_slot_create = (Module['_table_slot_create'] = (a0, a1) =>
    (_table_slot_create = Module['_table_slot_create'] =
      wasmExports['table_slot_create'])(a0, a1))
  let _ExecDropSingleTupleTableSlot = (Module['_ExecDropSingleTupleTableSlot'] =
    (a0) =>
      (_ExecDropSingleTupleTableSlot = Module['_ExecDropSingleTupleTableSlot'] =
        wasmExports['ExecDropSingleTupleTableSlot'])(a0))
  let _CreateExecutorState = (Module['_CreateExecutorState'] = () =>
    (_CreateExecutorState = Module['_CreateExecutorState'] =
      wasmExports['CreateExecutorState'])())
  let _MakePerTupleExprContext = (Module['_MakePerTupleExprContext'] = (a0) =>
    (_MakePerTupleExprContext = Module['_MakePerTupleExprContext'] =
      wasmExports['MakePerTupleExprContext'])(a0))
  let _ExecPrepareQual = (Module['_ExecPrepareQual'] = (a0, a1) =>
    (_ExecPrepareQual = Module['_ExecPrepareQual'] =
      wasmExports['ExecPrepareQual'])(a0, a1))
  let _GetOldestNonRemovableTransactionId = (Module[
    '_GetOldestNonRemovableTransactionId'
  ] = (a0) =>
    (_GetOldestNonRemovableTransactionId = Module[
      '_GetOldestNonRemovableTransactionId'
    ] =
      wasmExports['GetOldestNonRemovableTransactionId'])(a0))
  let _FormIndexDatum = (Module['_FormIndexDatum'] = (a0, a1, a2, a3, a4) =>
    (_FormIndexDatum = Module['_FormIndexDatum'] =
      wasmExports['FormIndexDatum'])(a0, a1, a2, a3, a4))
  let _FreeExecutorState = (Module['_FreeExecutorState'] = (a0) =>
    (_FreeExecutorState = Module['_FreeExecutorState'] =
      wasmExports['FreeExecutorState'])(a0))
  let _MakeSingleTupleTableSlot = (Module['_MakeSingleTupleTableSlot'] = (
    a0,
    a1,
  ) =>
    (_MakeSingleTupleTableSlot = Module['_MakeSingleTupleTableSlot'] =
      wasmExports['MakeSingleTupleTableSlot'])(a0, a1))
  let _tuplesort_getdatum = (Module['_tuplesort_getdatum'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_tuplesort_getdatum = Module['_tuplesort_getdatum'] =
      wasmExports['tuplesort_getdatum'])(a0, a1, a2, a3, a4, a5))
  let _ExecStoreHeapTuple = (Module['_ExecStoreHeapTuple'] = (a0, a1, a2) =>
    (_ExecStoreHeapTuple = Module['_ExecStoreHeapTuple'] =
      wasmExports['ExecStoreHeapTuple'])(a0, a1, a2))
  let _XidInMVCCSnapshot = (Module['_XidInMVCCSnapshot'] = (a0, a1) =>
    (_XidInMVCCSnapshot = Module['_XidInMVCCSnapshot'] =
      wasmExports['XidInMVCCSnapshot'])(a0, a1))
  let _bsearch = (Module['_bsearch'] = (a0, a1, a2, a3, a4) =>
    (_bsearch = Module['_bsearch'] = wasmExports['bsearch'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _XLogRecGetBlockTagExtended = (Module['_XLogRecGetBlockTagExtended'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_XLogRecGetBlockTagExtended = Module['_XLogRecGetBlockTagExtended'] =
      wasmExports['XLogRecGetBlockTagExtended'])(a0, a1, a2, a3, a4, a5))
  let _hash_seq_init = (Module['_hash_seq_init'] = (a0, a1) =>
    (_hash_seq_init = Module['_hash_seq_init'] = wasmExports['hash_seq_init'])(
      a0,
      a1,
    ))
  let _hash_seq_search = (Module['_hash_seq_search'] = (a0) =>
    (_hash_seq_search = Module['_hash_seq_search'] =
      wasmExports['hash_seq_search'])(a0))
  let _errcode_for_file_access = (Module['_errcode_for_file_access'] = () =>
    (_errcode_for_file_access = Module['_errcode_for_file_access'] =
      wasmExports['errcode_for_file_access'])())
  let _pg_snprintf = (Module['_pg_snprintf'] = (a0, a1, a2, a3) =>
    (_pg_snprintf = Module['_pg_snprintf'] = wasmExports['pg_snprintf'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _OpenTransientFile = (Module['_OpenTransientFile'] = (a0, a1) =>
    (_OpenTransientFile = Module['_OpenTransientFile'] =
      wasmExports['OpenTransientFile'])(a0, a1))
  let _ftruncate = (Module['_ftruncate'] = (a0, a1) =>
    (_ftruncate = Module['_ftruncate'] = wasmExports['ftruncate'])(a0, a1))
  let ___errno_location = (Module['___errno_location'] = () =>
    (___errno_location = Module['___errno_location'] =
      wasmExports['__errno_location'])())
  let _pwrite = (Module['_pwrite'] = (a0, a1, a2, a3) =>
    (_pwrite = Module['_pwrite'] = wasmExports['pwrite'])(a0, a1, a2, a3))
  let _CloseTransientFile = (Module['_CloseTransientFile'] = (a0) =>
    (_CloseTransientFile = Module['_CloseTransientFile'] =
      wasmExports['CloseTransientFile'])(a0))
  let _sscanf = (Module['_sscanf'] = (a0, a1, a2) =>
    (_sscanf = Module['_sscanf'] = wasmExports['sscanf'])(a0, a1, a2))
  let _unlink = (Module['_unlink'] = (a0) =>
    (_unlink = Module['_unlink'] = wasmExports['unlink'])(a0))
  let _fsync_fname = (Module['_fsync_fname'] = (a0, a1) =>
    (_fsync_fname = Module['_fsync_fname'] = wasmExports['fsync_fname'])(
      a0,
      a1,
    ))
  let _GetCurrentTimestamp = (Module['_GetCurrentTimestamp'] = () =>
    (_GetCurrentTimestamp = Module['_GetCurrentTimestamp'] =
      wasmExports['GetCurrentTimestamp'])())
  let _get_namespace_name = (Module['_get_namespace_name'] = (a0) =>
    (_get_namespace_name = Module['_get_namespace_name'] =
      wasmExports['get_namespace_name'])(a0))
  let _pg_prng_uint32 = (Module['_pg_prng_uint32'] = (a0) =>
    (_pg_prng_uint32 = Module['_pg_prng_uint32'] =
      wasmExports['pg_prng_uint32'])(a0))
  let _GetRecordedFreeSpace = (Module['_GetRecordedFreeSpace'] = (a0, a1) =>
    (_GetRecordedFreeSpace = Module['_GetRecordedFreeSpace'] =
      wasmExports['GetRecordedFreeSpace'])(a0, a1))
  let _visibilitymap_get_status = (Module['_visibilitymap_get_status'] = (
    a0,
    a1,
    a2,
  ) =>
    (_visibilitymap_get_status = Module['_visibilitymap_get_status'] =
      wasmExports['visibilitymap_get_status'])(a0, a1, a2))
  let _vac_estimate_reltuples = (Module['_vac_estimate_reltuples'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_vac_estimate_reltuples = Module['_vac_estimate_reltuples'] =
      wasmExports['vac_estimate_reltuples'])(a0, a1, a2, a3))
  let _WaitLatch = (Module['_WaitLatch'] = (a0, a1, a2, a3) =>
    (_WaitLatch = Module['_WaitLatch'] = wasmExports['WaitLatch'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _ResetLatch = (Module['_ResetLatch'] = (a0) =>
    (_ResetLatch = Module['_ResetLatch'] = wasmExports['ResetLatch'])(a0))
  let _clock_gettime = (Module['_clock_gettime'] = (a0, a1) =>
    (_clock_gettime = Module['_clock_gettime'] = wasmExports['clock_gettime'])(
      a0,
      a1,
    ))
  let _WalUsageAccumDiff = (Module['_WalUsageAccumDiff'] = (a0, a1, a2) =>
    (_WalUsageAccumDiff = Module['_WalUsageAccumDiff'] =
      wasmExports['WalUsageAccumDiff'])(a0, a1, a2))
  let _BufferUsageAccumDiff = (Module['_BufferUsageAccumDiff'] = (a0, a1, a2) =>
    (_BufferUsageAccumDiff = Module['_BufferUsageAccumDiff'] =
      wasmExports['BufferUsageAccumDiff'])(a0, a1, a2))
  let _appendStringInfoString = (Module['_appendStringInfoString'] = (a0, a1) =>
    (_appendStringInfoString = Module['_appendStringInfoString'] =
      wasmExports['appendStringInfoString'])(a0, a1))
  let _set_errcontext_domain = (Module['_set_errcontext_domain'] = (a0) =>
    (_set_errcontext_domain = Module['_set_errcontext_domain'] =
      wasmExports['set_errcontext_domain'])(a0))
  let _errcontext_msg = (Module['_errcontext_msg'] = (a0, a1) =>
    (_errcontext_msg = Module['_errcontext_msg'] =
      wasmExports['errcontext_msg'])(a0, a1))
  let _visibilitymap_prepare_truncate = (Module[
    '_visibilitymap_prepare_truncate'
  ] = (a0, a1) =>
    (_visibilitymap_prepare_truncate = Module[
      '_visibilitymap_prepare_truncate'
    ] =
      wasmExports['visibilitymap_prepare_truncate'])(a0, a1))
  let _check_enable_rls = (Module['_check_enable_rls'] = (a0, a1, a2) =>
    (_check_enable_rls = Module['_check_enable_rls'] =
      wasmExports['check_enable_rls'])(a0, a1, a2))
  let _pg_class_aclcheck = (Module['_pg_class_aclcheck'] = (a0, a1, a2) =>
    (_pg_class_aclcheck = Module['_pg_class_aclcheck'] =
      wasmExports['pg_class_aclcheck'])(a0, a1, a2))
  let _try_index_open = (Module['_try_index_open'] = (a0, a1) =>
    (_try_index_open = Module['_try_index_open'] =
      wasmExports['try_index_open'])(a0, a1))
  let _btboolcmp = (Module['_btboolcmp'] = (a0) =>
    (_btboolcmp = Module['_btboolcmp'] = wasmExports['btboolcmp'])(a0))
  let _btint2cmp = (Module['_btint2cmp'] = (a0) =>
    (_btint2cmp = Module['_btint2cmp'] = wasmExports['btint2cmp'])(a0))
  let _btint4cmp = (Module['_btint4cmp'] = (a0) =>
    (_btint4cmp = Module['_btint4cmp'] = wasmExports['btint4cmp'])(a0))
  let _btint8cmp = (Module['_btint8cmp'] = (a0) =>
    (_btint8cmp = Module['_btint8cmp'] = wasmExports['btint8cmp'])(a0))
  let _btoidcmp = (Module['_btoidcmp'] = (a0) =>
    (_btoidcmp = Module['_btoidcmp'] = wasmExports['btoidcmp'])(a0))
  let _btcharcmp = (Module['_btcharcmp'] = (a0) =>
    (_btcharcmp = Module['_btcharcmp'] = wasmExports['btcharcmp'])(a0))
  let __bt_form_posting = (Module['__bt_form_posting'] = (a0, a1, a2) =>
    (__bt_form_posting = Module['__bt_form_posting'] =
      wasmExports['_bt_form_posting'])(a0, a1, a2))
  let __bt_mkscankey = (Module['__bt_mkscankey'] = (a0, a1) =>
    (__bt_mkscankey = Module['__bt_mkscankey'] = wasmExports['_bt_mkscankey'])(
      a0,
      a1,
    ))
  let __bt_checkpage = (Module['__bt_checkpage'] = (a0, a1) =>
    (__bt_checkpage = Module['__bt_checkpage'] = wasmExports['_bt_checkpage'])(
      a0,
      a1,
    ))
  let __bt_compare = (Module['__bt_compare'] = (a0, a1, a2, a3) =>
    (__bt_compare = Module['__bt_compare'] = wasmExports['_bt_compare'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let __bt_relbuf = (Module['__bt_relbuf'] = (a0, a1) =>
    (__bt_relbuf = Module['__bt_relbuf'] = wasmExports['_bt_relbuf'])(a0, a1))
  let __bt_search = (Module['__bt_search'] = (a0, a1, a2, a3, a4) =>
    (__bt_search = Module['__bt_search'] = wasmExports['_bt_search'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let __bt_binsrch_insert = (Module['__bt_binsrch_insert'] = (a0, a1) =>
    (__bt_binsrch_insert = Module['__bt_binsrch_insert'] =
      wasmExports['_bt_binsrch_insert'])(a0, a1))
  let __bt_freestack = (Module['__bt_freestack'] = (a0) =>
    (__bt_freestack = Module['__bt_freestack'] = wasmExports['_bt_freestack'])(
      a0,
    ))
  let __bt_metaversion = (Module['__bt_metaversion'] = (a0, a1, a2) =>
    (__bt_metaversion = Module['__bt_metaversion'] =
      wasmExports['_bt_metaversion'])(a0, a1, a2))
  let _get_opfamily_member = (Module['_get_opfamily_member'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_get_opfamily_member = Module['_get_opfamily_member'] =
      wasmExports['get_opfamily_member'])(a0, a1, a2, a3))
  let __bt_allequalimage = (Module['__bt_allequalimage'] = (a0, a1) =>
    (__bt_allequalimage = Module['__bt_allequalimage'] =
      wasmExports['_bt_allequalimage'])(a0, a1))
  let ___wasm_setjmp_test = (Module['___wasm_setjmp_test'] = (a0, a1) =>
    (___wasm_setjmp_test = Module['___wasm_setjmp_test'] =
      wasmExports['__wasm_setjmp_test'])(a0, a1))
  let _before_shmem_exit = (Module['_before_shmem_exit'] = (a0, a1) =>
    (_before_shmem_exit = Module['_before_shmem_exit'] =
      wasmExports['before_shmem_exit'])(a0, a1))
  let ___wasm_setjmp = (Module['___wasm_setjmp'] = (a0, a1, a2) =>
    (___wasm_setjmp = Module['___wasm_setjmp'] = wasmExports['__wasm_setjmp'])(
      a0,
      a1,
      a2,
    ))
  let _cancel_before_shmem_exit = (Module['_cancel_before_shmem_exit'] = (
    a0,
    a1,
  ) =>
    (_cancel_before_shmem_exit = Module['_cancel_before_shmem_exit'] =
      wasmExports['cancel_before_shmem_exit'])(a0, a1))
  let _pg_re_throw = (Module['_pg_re_throw'] = () =>
    (_pg_re_throw = Module['_pg_re_throw'] = wasmExports['pg_re_throw'])())
  let _emscripten_longjmp = (Module['_emscripten_longjmp'] = (a0, a1) =>
    (_emscripten_longjmp = Module['_emscripten_longjmp'] =
      wasmExports['emscripten_longjmp'])(a0, a1))
  let _ConditionVariableBroadcast = (Module['_ConditionVariableBroadcast'] = (
    a0,
  ) =>
    (_ConditionVariableBroadcast = Module['_ConditionVariableBroadcast'] =
      wasmExports['ConditionVariableBroadcast'])(a0))
  let _datum_image_eq = (Module['_datum_image_eq'] = (a0, a1, a2, a3) =>
    (_datum_image_eq = Module['_datum_image_eq'] =
      wasmExports['datum_image_eq'])(a0, a1, a2, a3))
  let _time = (Module['_time'] = (a0) =>
    (_time = Module['_time'] = wasmExports['time'])(a0))
  let __bt_check_natts = (Module['__bt_check_natts'] = (a0, a1, a2, a3) =>
    (__bt_check_natts = Module['__bt_check_natts'] =
      wasmExports['_bt_check_natts'])(a0, a1, a2, a3))
  let _strlcpy = (Module['_strlcpy'] = (a0, a1, a2) =>
    (_strlcpy = Module['_strlcpy'] = wasmExports['strlcpy'])(a0, a1, a2))
  let _strncpy = (Module['_strncpy'] = (a0, a1, a2) =>
    (_strncpy = Module['_strncpy'] = wasmExports['strncpy'])(a0, a1, a2))
  let _timestamptz_to_str = (Module['_timestamptz_to_str'] = (a0) =>
    (_timestamptz_to_str = Module['_timestamptz_to_str'] =
      wasmExports['timestamptz_to_str'])(a0))
  let _XLogRecGetBlockRefInfo = (Module['_XLogRecGetBlockRefInfo'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_XLogRecGetBlockRefInfo = Module['_XLogRecGetBlockRefInfo'] =
      wasmExports['XLogRecGetBlockRefInfo'])(a0, a1, a2, a3, a4))
  let _varstr_cmp = (Module['_varstr_cmp'] = (a0, a1, a2, a3, a4) =>
    (_varstr_cmp = Module['_varstr_cmp'] = wasmExports['varstr_cmp'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _getBaseType = (Module['_getBaseType'] = (a0) =>
    (_getBaseType = Module['_getBaseType'] = wasmExports['getBaseType'])(a0))
  let _exprType = (Module['_exprType'] = (a0) =>
    (_exprType = Module['_exprType'] = wasmExports['exprType'])(a0))
  let _GetActiveSnapshot = (Module['_GetActiveSnapshot'] = () =>
    (_GetActiveSnapshot = Module['_GetActiveSnapshot'] =
      wasmExports['GetActiveSnapshot'])())
  let _errdetail_relkind_not_supported = (Module[
    '_errdetail_relkind_not_supported'
  ] = (a0) =>
    (_errdetail_relkind_not_supported = Module[
      '_errdetail_relkind_not_supported'
    ] =
      wasmExports['errdetail_relkind_not_supported'])(a0))
  let _table_openrv = (Module['_table_openrv'] = (a0, a1) =>
    (_table_openrv = Module['_table_openrv'] = wasmExports['table_openrv'])(
      a0,
      a1,
    ))
  let _table_slot_callbacks = (Module['_table_slot_callbacks'] = (a0) =>
    (_table_slot_callbacks = Module['_table_slot_callbacks'] =
      wasmExports['table_slot_callbacks'])(a0))
  let _clamp_row_est = (Module['_clamp_row_est'] = (a0) =>
    (_clamp_row_est = Module['_clamp_row_est'] = wasmExports['clamp_row_est'])(
      a0,
    ))
  let _pre_format_elog_string = (Module['_pre_format_elog_string'] = (a0, a1) =>
    (_pre_format_elog_string = Module['_pre_format_elog_string'] =
      wasmExports['pre_format_elog_string'])(a0, a1))
  let _format_elog_string = (Module['_format_elog_string'] = (a0, a1) =>
    (_format_elog_string = Module['_format_elog_string'] =
      wasmExports['format_elog_string'])(a0, a1))
  let _IsTransactionState = (Module['_IsTransactionState'] = () =>
    (_IsTransactionState = Module['_IsTransactionState'] =
      wasmExports['IsTransactionState'])())
  let _estimate_expression_value = (Module['_estimate_expression_value'] = (
    a0,
    a1,
  ) =>
    (_estimate_expression_value = Module['_estimate_expression_value'] =
      wasmExports['estimate_expression_value'])(a0, a1))
  let _SetConfigOption = (Module['_SetConfigOption'] = (a0, a1, a2, a3) =>
    (_SetConfigOption = Module['_SetConfigOption'] =
      wasmExports['SetConfigOption'])(a0, a1, a2, a3))
  let _XLogFlush = (Module['_XLogFlush'] = (a0) =>
    (_XLogFlush = Module['_XLogFlush'] = wasmExports['XLogFlush'])(a0))
  let _get_call_result_type = (Module['_get_call_result_type'] = (a0, a1, a2) =>
    (_get_call_result_type = Module['_get_call_result_type'] =
      wasmExports['get_call_result_type'])(a0, a1, a2))
  let _HeapTupleHeaderGetDatum = (Module['_HeapTupleHeaderGetDatum'] = (a0) =>
    (_HeapTupleHeaderGetDatum = Module['_HeapTupleHeaderGetDatum'] =
      wasmExports['HeapTupleHeaderGetDatum'])(a0))
  let _GenericXLogStart = (Module['_GenericXLogStart'] = (a0) =>
    (_GenericXLogStart = Module['_GenericXLogStart'] =
      wasmExports['GenericXLogStart'])(a0))
  let _GenericXLogRegisterBuffer = (Module['_GenericXLogRegisterBuffer'] = (
    a0,
    a1,
    a2,
  ) =>
    (_GenericXLogRegisterBuffer = Module['_GenericXLogRegisterBuffer'] =
      wasmExports['GenericXLogRegisterBuffer'])(a0, a1, a2))
  let _GenericXLogFinish = (Module['_GenericXLogFinish'] = (a0) =>
    (_GenericXLogFinish = Module['_GenericXLogFinish'] =
      wasmExports['GenericXLogFinish'])(a0))
  let _GenericXLogAbort = (Module['_GenericXLogAbort'] = (a0) =>
    (_GenericXLogAbort = Module['_GenericXLogAbort'] =
      wasmExports['GenericXLogAbort'])(a0))
  let _errmsg_plural = (Module['_errmsg_plural'] = (a0, a1, a2, a3) =>
    (_errmsg_plural = Module['_errmsg_plural'] = wasmExports['errmsg_plural'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _ReadNextMultiXactId = (Module['_ReadNextMultiXactId'] = () =>
    (_ReadNextMultiXactId = Module['_ReadNextMultiXactId'] =
      wasmExports['ReadNextMultiXactId'])())
  let _ReadMultiXactIdRange = (Module['_ReadMultiXactIdRange'] = (a0, a1) =>
    (_ReadMultiXactIdRange = Module['_ReadMultiXactIdRange'] =
      wasmExports['ReadMultiXactIdRange'])(a0, a1))
  let _MultiXactIdPrecedesOrEquals = (Module['_MultiXactIdPrecedesOrEquals'] = (
    a0,
    a1,
  ) =>
    (_MultiXactIdPrecedesOrEquals = Module['_MultiXactIdPrecedesOrEquals'] =
      wasmExports['MultiXactIdPrecedesOrEquals'])(a0, a1))
  let _init_MultiFuncCall = (Module['_init_MultiFuncCall'] = (a0) =>
    (_init_MultiFuncCall = Module['_init_MultiFuncCall'] =
      wasmExports['init_MultiFuncCall'])(a0))
  let _TupleDescGetAttInMetadata = (Module['_TupleDescGetAttInMetadata'] = (
    a0,
  ) =>
    (_TupleDescGetAttInMetadata = Module['_TupleDescGetAttInMetadata'] =
      wasmExports['TupleDescGetAttInMetadata'])(a0))
  let _per_MultiFuncCall = (Module['_per_MultiFuncCall'] = (a0) =>
    (_per_MultiFuncCall = Module['_per_MultiFuncCall'] =
      wasmExports['per_MultiFuncCall'])(a0))
  let _BuildTupleFromCStrings = (Module['_BuildTupleFromCStrings'] = (a0, a1) =>
    (_BuildTupleFromCStrings = Module['_BuildTupleFromCStrings'] =
      wasmExports['BuildTupleFromCStrings'])(a0, a1))
  let _end_MultiFuncCall = (Module['_end_MultiFuncCall'] = (a0, a1) =>
    (_end_MultiFuncCall = Module['_end_MultiFuncCall'] =
      wasmExports['end_MultiFuncCall'])(a0, a1))
  let _GetCurrentSubTransactionId = (Module['_GetCurrentSubTransactionId'] =
    () =>
      (_GetCurrentSubTransactionId = Module['_GetCurrentSubTransactionId'] =
        wasmExports['GetCurrentSubTransactionId'])())
  let _WaitForBackgroundWorkerShutdown = (Module[
    '_WaitForBackgroundWorkerShutdown'
  ] = (a0) =>
    (_WaitForBackgroundWorkerShutdown = Module[
      '_WaitForBackgroundWorkerShutdown'
    ] =
      wasmExports['WaitForBackgroundWorkerShutdown'])(a0))
  let _RegisterDynamicBackgroundWorker = (Module[
    '_RegisterDynamicBackgroundWorker'
  ] = (a0, a1) =>
    (_RegisterDynamicBackgroundWorker = Module[
      '_RegisterDynamicBackgroundWorker'
    ] =
      wasmExports['RegisterDynamicBackgroundWorker'])(a0, a1))
  let _appendBinaryStringInfo = (Module['_appendBinaryStringInfo'] = (
    a0,
    a1,
    a2,
  ) =>
    (_appendBinaryStringInfo = Module['_appendBinaryStringInfo'] =
      wasmExports['appendBinaryStringInfo'])(a0, a1, a2))
  let _pq_getmsgbyte = (Module['_pq_getmsgbyte'] = (a0) =>
    (_pq_getmsgbyte = Module['_pq_getmsgbyte'] = wasmExports['pq_getmsgbyte'])(
      a0,
    ))
  let _pq_getmsgint = (Module['_pq_getmsgint'] = (a0, a1) =>
    (_pq_getmsgint = Module['_pq_getmsgint'] = wasmExports['pq_getmsgint'])(
      a0,
      a1,
    ))
  let _pq_getmsgint64 = (Module['_pq_getmsgint64'] = (a0) =>
    (_pq_getmsgint64 = Module['_pq_getmsgint64'] =
      wasmExports['pq_getmsgint64'])(a0))
  let _die = (Module['_die'] = (a0) =>
    (_die = Module['_die'] = wasmExports['die'])(a0))
  let _pqsignal_be = (Module['_pqsignal_be'] = (a0, a1) =>
    (_pqsignal_be = Module['_pqsignal_be'] = wasmExports['pqsignal_be'])(
      a0,
      a1,
    ))
  let _BackgroundWorkerUnblockSignals = (Module[
    '_BackgroundWorkerUnblockSignals'
  ] = () =>
    (_BackgroundWorkerUnblockSignals = Module[
      '_BackgroundWorkerUnblockSignals'
    ] =
      wasmExports['BackgroundWorkerUnblockSignals'])())
  let _BackgroundWorkerInitializeConnectionByOid = (Module[
    '_BackgroundWorkerInitializeConnectionByOid'
  ] = (a0, a1, a2) =>
    (_BackgroundWorkerInitializeConnectionByOid = Module[
      '_BackgroundWorkerInitializeConnectionByOid'
    ] =
      wasmExports['BackgroundWorkerInitializeConnectionByOid'])(a0, a1, a2))
  let _GetDatabaseEncoding = (Module['_GetDatabaseEncoding'] = () =>
    (_GetDatabaseEncoding = Module['_GetDatabaseEncoding'] =
      wasmExports['GetDatabaseEncoding'])())
  let _StartTransactionCommand = (Module['_StartTransactionCommand'] = () =>
    (_StartTransactionCommand = Module['_StartTransactionCommand'] =
      wasmExports['StartTransactionCommand'])())
  let _CommitTransactionCommand = (Module['_CommitTransactionCommand'] = () =>
    (_CommitTransactionCommand = Module['_CommitTransactionCommand'] =
      wasmExports['CommitTransactionCommand'])())
  let _PushActiveSnapshot = (Module['_PushActiveSnapshot'] = (a0) =>
    (_PushActiveSnapshot = Module['_PushActiveSnapshot'] =
      wasmExports['PushActiveSnapshot'])(a0))
  let _PopActiveSnapshot = (Module['_PopActiveSnapshot'] = () =>
    (_PopActiveSnapshot = Module['_PopActiveSnapshot'] =
      wasmExports['PopActiveSnapshot'])())
  let _RmgrNotFound = (Module['_RmgrNotFound'] = (a0) =>
    (_RmgrNotFound = Module['_RmgrNotFound'] = wasmExports['RmgrNotFound'])(a0))
  let _InitMaterializedSRF = (Module['_InitMaterializedSRF'] = (a0, a1) =>
    (_InitMaterializedSRF = Module['_InitMaterializedSRF'] =
      wasmExports['InitMaterializedSRF'])(a0, a1))
  let _tuplestore_putvalues = (Module['_tuplestore_putvalues'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_tuplestore_putvalues = Module['_tuplestore_putvalues'] =
      wasmExports['tuplestore_putvalues'])(a0, a1, a2, a3))
  let _pread = (Module['_pread'] = (a0, a1, a2, a3) =>
    (_pread = Module['_pread'] = wasmExports['pread'])(a0, a1, a2, a3))
  let _strspn = (Module['_strspn'] = (a0, a1) =>
    (_strspn = Module['_strspn'] = wasmExports['strspn'])(a0, a1))
  let _strtoll = (Module['_strtoll'] = (a0, a1, a2) =>
    (_strtoll = Module['_strtoll'] = wasmExports['strtoll'])(a0, a1, a2))
  let _AllocateFile = (Module['_AllocateFile'] = (a0, a1) =>
    (_AllocateFile = Module['_AllocateFile'] = wasmExports['AllocateFile'])(
      a0,
      a1,
    ))
  let _ferror = (Module['_ferror'] = (a0) =>
    (_ferror = Module['_ferror'] = wasmExports['ferror'])(a0))
  let _FreeFile = (Module['_FreeFile'] = (a0) =>
    (_FreeFile = Module['_FreeFile'] = wasmExports['FreeFile'])(a0))
  let _getpid = (Module['_getpid'] = () =>
    (_getpid = Module['_getpid'] = wasmExports['getpid'])())
  let _read = (Module['_read'] = (a0, a1, a2) =>
    (_read = Module['_read'] = wasmExports['read'])(a0, a1, a2))
  let _write = (Module['_write'] = (a0, a1, a2) =>
    (_write = Module['_write'] = wasmExports['write'])(a0, a1, a2))
  let _durable_rename = (Module['_durable_rename'] = (a0, a1, a2) =>
    (_durable_rename = Module['_durable_rename'] =
      wasmExports['durable_rename'])(a0, a1, a2))
  let _BlessTupleDesc = (Module['_BlessTupleDesc'] = (a0) =>
    (_BlessTupleDesc = Module['_BlessTupleDesc'] =
      wasmExports['BlessTupleDesc'])(a0))
  let _fstat = (Module['_fstat'] = (a0, a1) =>
    (_fstat = Module['_fstat'] = wasmExports['fstat'])(a0, a1))
  let _superuser_arg = (Module['_superuser_arg'] = (a0) =>
    (_superuser_arg = Module['_superuser_arg'] = wasmExports['superuser_arg'])(
      a0,
    ))
  let _wal_segment_close = (Module['_wal_segment_close'] = (a0) =>
    (_wal_segment_close = Module['_wal_segment_close'] =
      wasmExports['wal_segment_close'])(a0))
  let _wal_segment_open = (Module['_wal_segment_open'] = (a0, a1, a2) =>
    (_wal_segment_open = Module['_wal_segment_open'] =
      wasmExports['wal_segment_open'])(a0, a1, a2))
  let _XLogReaderAllocate = (Module['_XLogReaderAllocate'] = (a0, a1, a2, a3) =>
    (_XLogReaderAllocate = Module['_XLogReaderAllocate'] =
      wasmExports['XLogReaderAllocate'])(a0, a1, a2, a3))
  let _XLogReadRecord = (Module['_XLogReadRecord'] = (a0, a1) =>
    (_XLogReadRecord = Module['_XLogReadRecord'] =
      wasmExports['XLogReadRecord'])(a0, a1))
  let _XLogReaderFree = (Module['_XLogReaderFree'] = (a0) =>
    (_XLogReaderFree = Module['_XLogReaderFree'] =
      wasmExports['XLogReaderFree'])(a0))
  let _strtoull = (Module['_strtoull'] = (a0, a1, a2) =>
    (_strtoull = Module['_strtoull'] = wasmExports['strtoull'])(a0, a1, a2))
  let _access = (Module['_access'] = (a0, a1) =>
    (_access = Module['_access'] = wasmExports['access'])(a0, a1))
  let _IsAbortedTransactionBlockState = (Module[
    '_IsAbortedTransactionBlockState'
  ] = () =>
    (_IsAbortedTransactionBlockState = Module[
      '_IsAbortedTransactionBlockState'
    ] =
      wasmExports['IsAbortedTransactionBlockState'])())
  let _GetTopFullTransactionId = (Module['_GetTopFullTransactionId'] = () =>
    (_GetTopFullTransactionId = Module['_GetTopFullTransactionId'] =
      wasmExports['GetTopFullTransactionId'])())
  let _GetCurrentTransactionNestLevel = (Module[
    '_GetCurrentTransactionNestLevel'
  ] = () =>
    (_GetCurrentTransactionNestLevel = Module[
      '_GetCurrentTransactionNestLevel'
    ] =
      wasmExports['GetCurrentTransactionNestLevel'])())
  let _ResourceOwnerCreate = (Module['_ResourceOwnerCreate'] = (a0, a1) =>
    (_ResourceOwnerCreate = Module['_ResourceOwnerCreate'] =
      wasmExports['ResourceOwnerCreate'])(a0, a1))
  let _AbortCurrentTransaction = (Module['_AbortCurrentTransaction'] = () =>
    (_AbortCurrentTransaction = Module['_AbortCurrentTransaction'] =
      wasmExports['AbortCurrentTransaction'])())
  let _IsTransactionBlock = (Module['_IsTransactionBlock'] = () =>
    (_IsTransactionBlock = Module['_IsTransactionBlock'] =
      wasmExports['IsTransactionBlock'])())
  let _RegisterXactCallback = (Module['_RegisterXactCallback'] = (a0, a1) =>
    (_RegisterXactCallback = Module['_RegisterXactCallback'] =
      wasmExports['RegisterXactCallback'])(a0, a1))
  let _UnregisterXactCallback = (Module['_UnregisterXactCallback'] = (a0, a1) =>
    (_UnregisterXactCallback = Module['_UnregisterXactCallback'] =
      wasmExports['UnregisterXactCallback'])(a0, a1))
  let _RegisterSubXactCallback = (Module['_RegisterSubXactCallback'] = (
    a0,
    a1,
  ) =>
    (_RegisterSubXactCallback = Module['_RegisterSubXactCallback'] =
      wasmExports['RegisterSubXactCallback'])(a0, a1))
  let _BeginInternalSubTransaction = (Module['_BeginInternalSubTransaction'] = (
    a0,
  ) =>
    (_BeginInternalSubTransaction = Module['_BeginInternalSubTransaction'] =
      wasmExports['BeginInternalSubTransaction'])(a0))
  let _ReleaseCurrentSubTransaction = (Module['_ReleaseCurrentSubTransaction'] =
    () =>
      (_ReleaseCurrentSubTransaction = Module['_ReleaseCurrentSubTransaction'] =
        wasmExports['ReleaseCurrentSubTransaction'])())
  let _ResourceOwnerDelete = (Module['_ResourceOwnerDelete'] = (a0) =>
    (_ResourceOwnerDelete = Module['_ResourceOwnerDelete'] =
      wasmExports['ResourceOwnerDelete'])(a0))
  let _RollbackAndReleaseCurrentSubTransaction = (Module[
    '_RollbackAndReleaseCurrentSubTransaction'
  ] = () =>
    (_RollbackAndReleaseCurrentSubTransaction = Module[
      '_RollbackAndReleaseCurrentSubTransaction'
    ] =
      wasmExports['RollbackAndReleaseCurrentSubTransaction'])())
  let _pg_usleep = (Module['_pg_usleep'] = (a0) =>
    (_pg_usleep = Module['_pg_usleep'] = wasmExports['pg_usleep'])(a0))
  let _close = (Module['_close'] = (a0) =>
    (_close = Module['_close'] = wasmExports['close'])(a0))
  let _ReleaseExternalFD = (Module['_ReleaseExternalFD'] = () =>
    (_ReleaseExternalFD = Module['_ReleaseExternalFD'] =
      wasmExports['ReleaseExternalFD'])())
  let _GetDefaultCharSignedness = (Module['_GetDefaultCharSignedness'] = () =>
    (_GetDefaultCharSignedness = Module['_GetDefaultCharSignedness'] =
      wasmExports['GetDefaultCharSignedness'])())
  let _SplitIdentifierString = (Module['_SplitIdentifierString'] = (
    a0,
    a1,
    a2,
  ) =>
    (_SplitIdentifierString = Module['_SplitIdentifierString'] =
      wasmExports['SplitIdentifierString'])(a0, a1, a2))
  let _guc_malloc = (Module['_guc_malloc'] = (a0, a1) =>
    (_guc_malloc = Module['_guc_malloc'] = wasmExports['guc_malloc'])(a0, a1))
  let _find_option = (Module['_find_option'] = (a0, a1, a2, a3) =>
    (_find_option = Module['_find_option'] = wasmExports['find_option'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _gettimeofday = (Module['_gettimeofday'] = (a0, a1) =>
    (_gettimeofday = Module['_gettimeofday'] = wasmExports['gettimeofday'])(
      a0,
      a1,
    ))
  let _pg_strong_random = (Module['_pg_strong_random'] = (a0, a1) =>
    (_pg_strong_random = Module['_pg_strong_random'] =
      wasmExports['pg_strong_random'])(a0, a1))
  let _stat = (Module['_stat'] = (a0, a1) =>
    (_stat = Module['_stat'] = wasmExports['stat'])(a0, a1))
  let _GetFlushRecPtr = (Module['_GetFlushRecPtr'] = (a0) =>
    (_GetFlushRecPtr = Module['_GetFlushRecPtr'] =
      wasmExports['GetFlushRecPtr'])(a0))
  let _GetXLogReplayRecPtr = (Module['_GetXLogReplayRecPtr'] = (a0) =>
    (_GetXLogReplayRecPtr = Module['_GetXLogReplayRecPtr'] =
      wasmExports['GetXLogReplayRecPtr'])(a0))
  let _TimestampDifferenceMilliseconds = (Module[
    '_TimestampDifferenceMilliseconds'
  ] = (a0, a1) =>
    (_TimestampDifferenceMilliseconds = Module[
      '_TimestampDifferenceMilliseconds'
    ] =
      wasmExports['TimestampDifferenceMilliseconds'])(a0, a1))
  let _strtoul = (Module['_strtoul'] = (a0, a1, a2) =>
    (_strtoul = Module['_strtoul'] = wasmExports['strtoul'])(a0, a1, a2))
  let _readlink = (Module['_readlink'] = (a0, a1, a2) =>
    (_readlink = Module['_readlink'] = wasmExports['readlink'])(a0, a1, a2))
  let _pg_fprintf = (Module['_pg_fprintf'] = (a0, a1, a2) =>
    (_pg_fprintf = Module['_pg_fprintf'] = wasmExports['pg_fprintf'])(
      a0,
      a1,
      a2,
    ))
  let _fflush = (Module['_fflush'] = (a0) =>
    (_fflush = Module['_fflush'] = wasmExports['fflush'])(a0))
  let _pgl_system = (Module['_pgl_system'] = (a0) =>
    (_pgl_system = Module['_pgl_system'] = wasmExports['pgl_system'])(a0))
  let _wait_result_to_str = (Module['_wait_result_to_str'] = (a0) =>
    (_wait_result_to_str = Module['_wait_result_to_str'] =
      wasmExports['wait_result_to_str'])(a0))
  let _replace_percent_placeholders = (Module['_replace_percent_placeholders'] =
    (a0, a1, a2, a3) =>
      (_replace_percent_placeholders = Module['_replace_percent_placeholders'] =
        wasmExports['replace_percent_placeholders'])(a0, a1, a2, a3))
  let _makeStringInfo = (Module['_makeStringInfo'] = () =>
    (_makeStringInfo = Module['_makeStringInfo'] =
      wasmExports['makeStringInfo'])())
  let _pg_toupper = (Module['_pg_toupper'] = (a0) =>
    (_pg_toupper = Module['_pg_toupper'] = wasmExports['pg_toupper'])(a0))
  let _numeric_in = (Module['_numeric_in'] = (a0) =>
    (_numeric_in = Module['_numeric_in'] = wasmExports['numeric_in'])(a0))
  let _DirectFunctionCall3Coll = (Module['_DirectFunctionCall3Coll'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_DirectFunctionCall3Coll = Module['_DirectFunctionCall3Coll'] =
      wasmExports['DirectFunctionCall3Coll'])(a0, a1, a2, a3, a4))
  let _palloc_extended = (Module['_palloc_extended'] = (a0, a1) =>
    (_palloc_extended = Module['_palloc_extended'] =
      wasmExports['palloc_extended'])(a0, a1))
  let _pg_vsnprintf = (Module['_pg_vsnprintf'] = (a0, a1, a2, a3) =>
    (_pg_vsnprintf = Module['_pg_vsnprintf'] = wasmExports['pg_vsnprintf'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _XLogFindNextRecord = (Module['_XLogFindNextRecord'] = (a0, a1) =>
    (_XLogFindNextRecord = Module['_XLogFindNextRecord'] =
      wasmExports['XLogFindNextRecord'])(a0, a1))
  let _RestoreBlockImage = (Module['_RestoreBlockImage'] = (a0, a1, a2) =>
    (_RestoreBlockImage = Module['_RestoreBlockImage'] =
      wasmExports['RestoreBlockImage'])(a0, a1, a2))
  let _timestamptz_in = (Module['_timestamptz_in'] = (a0) =>
    (_timestamptz_in = Module['_timestamptz_in'] =
      wasmExports['timestamptz_in'])(a0))
  let _fscanf = (Module['_fscanf'] = (a0, a1, a2) =>
    (_fscanf = Module['_fscanf'] = wasmExports['fscanf'])(a0, a1, a2))
  let _symlink = (Module['_symlink'] = (a0, a1) =>
    (_symlink = Module['_symlink'] = wasmExports['symlink'])(a0, a1))
  let _ConditionVariableTimedSleep = (Module['_ConditionVariableTimedSleep'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ConditionVariableTimedSleep = Module['_ConditionVariableTimedSleep'] =
      wasmExports['ConditionVariableTimedSleep'])(a0, a1, a2))
  let _ParseDateTime = (Module['_ParseDateTime'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_ParseDateTime = Module['_ParseDateTime'] = wasmExports['ParseDateTime'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
    ))
  let _DecodeDateTime = (Module['_DecodeDateTime'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_DecodeDateTime = Module['_DecodeDateTime'] =
      wasmExports['DecodeDateTime'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _tm2timestamp = (Module['_tm2timestamp'] = (a0, a1, a2, a3) =>
    (_tm2timestamp = Module['_tm2timestamp'] = wasmExports['tm2timestamp'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _XLogRecStoreStats = (Module['_XLogRecStoreStats'] = (a0, a1) =>
    (_XLogRecStoreStats = Module['_XLogRecStoreStats'] =
      wasmExports['XLogRecStoreStats'])(a0, a1))
  let _hash_get_num_entries = (Module['_hash_get_num_entries'] = (a0) =>
    (_hash_get_num_entries = Module['_hash_get_num_entries'] =
      wasmExports['hash_get_num_entries'])(a0))
  let _read_local_xlog_page_no_wait = (Module['_read_local_xlog_page_no_wait'] =
    (a0, a1, a2, a3, a4) =>
      (_read_local_xlog_page_no_wait = Module['_read_local_xlog_page_no_wait'] =
        wasmExports['read_local_xlog_page_no_wait'])(a0, a1, a2, a3, a4))
  let _escape_json_with_len = (Module['_escape_json_with_len'] = (a0, a1, a2) =>
    (_escape_json_with_len = Module['_escape_json_with_len'] =
      wasmExports['escape_json_with_len'])(a0, a1, a2))
  let _BufFileSeek = (Module['_BufFileSeek'] = (a0, a1, a2, a3) =>
    (_BufFileSeek = Module['_BufFileSeek'] = wasmExports['BufFileSeek'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _lstat = (Module['_lstat'] = (a0, a1) =>
    (_lstat = Module['_lstat'] = wasmExports['lstat'])(a0, a1))
  let _destroyStringInfo = (Module['_destroyStringInfo'] = (a0) =>
    (_destroyStringInfo = Module['_destroyStringInfo'] =
      wasmExports['destroyStringInfo'])(a0))
  let _list_sort = (Module['_list_sort'] = (a0, a1) =>
    (_list_sort = Module['_list_sort'] = wasmExports['list_sort'])(a0, a1))
  let _pgl_geteuid = (Module['_pgl_geteuid'] = () =>
    (_pgl_geteuid = Module['_pgl_geteuid'] = wasmExports['pgl_geteuid'])())
  let _getegid = (Module['_getegid'] = () =>
    (_getegid = Module['_getegid'] = wasmExports['getegid'])())
  let _pg_checksum_page = (Module['_pg_checksum_page'] = (a0, a1) =>
    (_pg_checksum_page = Module['_pg_checksum_page'] =
      wasmExports['pg_checksum_page'])(a0, a1))
  let _CreateDestReceiver = (Module['_CreateDestReceiver'] = (a0) =>
    (_CreateDestReceiver = Module['_CreateDestReceiver'] =
      wasmExports['CreateDestReceiver'])(a0))
  let _bbsink_forward_end_archive = (Module['_bbsink_forward_end_archive'] = (
    a0,
  ) =>
    (_bbsink_forward_end_archive = Module['_bbsink_forward_end_archive'] =
      wasmExports['bbsink_forward_end_archive'])(a0))
  let _bbsink_forward_begin_manifest = (Module[
    '_bbsink_forward_begin_manifest'
  ] = (a0) =>
    (_bbsink_forward_begin_manifest = Module['_bbsink_forward_begin_manifest'] =
      wasmExports['bbsink_forward_begin_manifest'])(a0))
  let _bbsink_forward_end_manifest = (Module['_bbsink_forward_end_manifest'] = (
    a0,
  ) =>
    (_bbsink_forward_end_manifest = Module['_bbsink_forward_end_manifest'] =
      wasmExports['bbsink_forward_end_manifest'])(a0))
  let _bbsink_forward_end_backup = (Module['_bbsink_forward_end_backup'] = (
    a0,
    a1,
    a2,
  ) =>
    (_bbsink_forward_end_backup = Module['_bbsink_forward_end_backup'] =
      wasmExports['bbsink_forward_end_backup'])(a0, a1, a2))
  let _bbsink_forward_cleanup = (Module['_bbsink_forward_cleanup'] = (a0) =>
    (_bbsink_forward_cleanup = Module['_bbsink_forward_cleanup'] =
      wasmExports['bbsink_forward_cleanup'])(a0))
  let _MemoryContextAllocExtended = (Module['_MemoryContextAllocExtended'] = (
    a0,
    a1,
    a2,
  ) =>
    (_MemoryContextAllocExtended = Module['_MemoryContextAllocExtended'] =
      wasmExports['MemoryContextAllocExtended'])(a0, a1, a2))
  let _appendStringInfoVA = (Module['_appendStringInfoVA'] = (a0, a1, a2) =>
    (_appendStringInfoVA = Module['_appendStringInfoVA'] =
      wasmExports['appendStringInfoVA'])(a0, a1, a2))
  let _list_concat = (Module['_list_concat'] = (a0, a1) =>
    (_list_concat = Module['_list_concat'] = wasmExports['list_concat'])(
      a0,
      a1,
    ))
  let _strrchr = (Module['_strrchr'] = (a0, a1) =>
    (_strrchr = Module['_strrchr'] = wasmExports['strrchr'])(a0, a1))
  let _bbsink_forward_begin_backup = (Module['_bbsink_forward_begin_backup'] = (
    a0,
  ) =>
    (_bbsink_forward_begin_backup = Module['_bbsink_forward_begin_backup'] =
      wasmExports['bbsink_forward_begin_backup'])(a0))
  let _bbsink_forward_archive_contents = (Module[
    '_bbsink_forward_archive_contents'
  ] = (a0, a1) =>
    (_bbsink_forward_archive_contents = Module[
      '_bbsink_forward_archive_contents'
    ] =
      wasmExports['bbsink_forward_archive_contents'])(a0, a1))
  let _bbsink_forward_begin_archive = (Module['_bbsink_forward_begin_archive'] =
    (a0, a1) =>
      (_bbsink_forward_begin_archive = Module['_bbsink_forward_begin_archive'] =
        wasmExports['bbsink_forward_begin_archive'])(a0, a1))
  let _bbsink_forward_manifest_contents = (Module[
    '_bbsink_forward_manifest_contents'
  ] = (a0, a1) =>
    (_bbsink_forward_manifest_contents = Module[
      '_bbsink_forward_manifest_contents'
    ] =
      wasmExports['bbsink_forward_manifest_contents'])(a0, a1))
  let _has_privs_of_role = (Module['_has_privs_of_role'] = (a0, a1) =>
    (_has_privs_of_role = Module['_has_privs_of_role'] =
      wasmExports['has_privs_of_role'])(a0, a1))
  let _BaseBackupAddTarget = (Module['_BaseBackupAddTarget'] = (a0, a1, a2) =>
    (_BaseBackupAddTarget = Module['_BaseBackupAddTarget'] =
      wasmExports['BaseBackupAddTarget'])(a0, a1, a2))
  let _list_copy = (Module['_list_copy'] = (a0) =>
    (_list_copy = Module['_list_copy'] = wasmExports['list_copy'])(a0))
  let _tuplestore_puttuple = (Module['_tuplestore_puttuple'] = (a0, a1) =>
    (_tuplestore_puttuple = Module['_tuplestore_puttuple'] =
      wasmExports['tuplestore_puttuple'])(a0, a1))
  let _isatty = (Module['_isatty'] = (a0) =>
    (_isatty = Module['_isatty'] = wasmExports['isatty'])(a0))
  let _makeRangeVar = (Module['_makeRangeVar'] = (a0, a1, a2) =>
    (_makeRangeVar = Module['_makeRangeVar'] = wasmExports['makeRangeVar'])(
      a0,
      a1,
      a2,
    ))
  let _DefineIndex = (Module['_DefineIndex'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
    a11,
  ) =>
    (_DefineIndex = Module['_DefineIndex'] = wasmExports['DefineIndex'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
      a11,
    ))
  let _getc = (Module['_getc'] = (a0) =>
    (_getc = Module['_getc'] = wasmExports['getc'])(a0))
  let _fread = (Module['_fread'] = (a0, a1, a2, a3) =>
    (_fread = Module['_fread'] = wasmExports['fread'])(a0, a1, a2, a3))
  let _clearerr = (Module['_clearerr'] = (a0) =>
    (_clearerr = Module['_clearerr'] = wasmExports['clearerr'])(a0))
  let _copyObjectImpl = (Module['_copyObjectImpl'] = (a0) =>
    (_copyObjectImpl = Module['_copyObjectImpl'] =
      wasmExports['copyObjectImpl'])(a0))
  let _get_object_address = (Module['_get_object_address'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_get_object_address = Module['_get_object_address'] =
      wasmExports['get_object_address'])(a0, a1, a2, a3, a4, a5))
  let _lappend_oid = (Module['_lappend_oid'] = (a0, a1) =>
    (_lappend_oid = Module['_lappend_oid'] = wasmExports['lappend_oid'])(
      a0,
      a1,
    ))
  let _makeTypeNameFromNameList = (Module['_makeTypeNameFromNameList'] = (a0) =>
    (_makeTypeNameFromNameList = Module['_makeTypeNameFromNameList'] =
      wasmExports['makeTypeNameFromNameList'])(a0))
  let _SearchSysCache2 = (Module['_SearchSysCache2'] = (a0, a1, a2) =>
    (_SearchSysCache2 = Module['_SearchSysCache2'] =
      wasmExports['SearchSysCache2'])(a0, a1, a2))
  let _SysCacheGetAttr = (Module['_SysCacheGetAttr'] = (a0, a1, a2, a3) =>
    (_SysCacheGetAttr = Module['_SysCacheGetAttr'] =
      wasmExports['SysCacheGetAttr'])(a0, a1, a2, a3))
  let _CatalogTupleUpdate = (Module['_CatalogTupleUpdate'] = (a0, a1, a2) =>
    (_CatalogTupleUpdate = Module['_CatalogTupleUpdate'] =
      wasmExports['CatalogTupleUpdate'])(a0, a1, a2))
  let _get_attnum = (Module['_get_attnum'] = (a0, a1) =>
    (_get_attnum = Module['_get_attnum'] = wasmExports['get_attnum'])(a0, a1))
  let _get_rel_name = (Module['_get_rel_name'] = (a0) =>
    (_get_rel_name = Module['_get_rel_name'] = wasmExports['get_rel_name'])(a0))
  let _CatalogTupleDelete = (Module['_CatalogTupleDelete'] = (a0, a1) =>
    (_CatalogTupleDelete = Module['_CatalogTupleDelete'] =
      wasmExports['CatalogTupleDelete'])(a0, a1))
  let _get_namespace_oid = (Module['_get_namespace_oid'] = (a0, a1) =>
    (_get_namespace_oid = Module['_get_namespace_oid'] =
      wasmExports['get_namespace_oid'])(a0, a1))
  let _SearchSysCache3 = (Module['_SearchSysCache3'] = (a0, a1, a2, a3) =>
    (_SearchSysCache3 = Module['_SearchSysCache3'] =
      wasmExports['SearchSysCache3'])(a0, a1, a2, a3))
  let _performDeletion = (Module['_performDeletion'] = (a0, a1, a2) =>
    (_performDeletion = Module['_performDeletion'] =
      wasmExports['performDeletion'])(a0, a1, a2))
  let _CatalogTupleInsert = (Module['_CatalogTupleInsert'] = (a0, a1) =>
    (_CatalogTupleInsert = Module['_CatalogTupleInsert'] =
      wasmExports['CatalogTupleInsert'])(a0, a1))
  let _recordDependencyOn = (Module['_recordDependencyOn'] = (a0, a1, a2) =>
    (_recordDependencyOn = Module['_recordDependencyOn'] =
      wasmExports['recordDependencyOn'])(a0, a1, a2))
  let _get_element_type = (Module['_get_element_type'] = (a0) =>
    (_get_element_type = Module['_get_element_type'] =
      wasmExports['get_element_type'])(a0))
  let _object_aclcheck = (Module['_object_aclcheck'] = (a0, a1, a2, a3) =>
    (_object_aclcheck = Module['_object_aclcheck'] =
      wasmExports['object_aclcheck'])(a0, a1, a2, a3))
  let _isTempNamespace = (Module['_isTempNamespace'] = (a0) =>
    (_isTempNamespace = Module['_isTempNamespace'] =
      wasmExports['isTempNamespace'])(a0))
  let _superuser = (Module['_superuser'] = () =>
    (_superuser = Module['_superuser'] = wasmExports['superuser'])())
  let _SearchSysCacheAttName = (Module['_SearchSysCacheAttName'] = (a0, a1) =>
    (_SearchSysCacheAttName = Module['_SearchSysCacheAttName'] =
      wasmExports['SearchSysCacheAttName'])(a0, a1))
  let _new_object_addresses = (Module['_new_object_addresses'] = () =>
    (_new_object_addresses = Module['_new_object_addresses'] =
      wasmExports['new_object_addresses'])())
  let _free_object_addresses = (Module['_free_object_addresses'] = (a0) =>
    (_free_object_addresses = Module['_free_object_addresses'] =
      wasmExports['free_object_addresses'])(a0))
  let _performMultipleDeletions = (Module['_performMultipleDeletions'] = (
    a0,
    a1,
    a2,
  ) =>
    (_performMultipleDeletions = Module['_performMultipleDeletions'] =
      wasmExports['performMultipleDeletions'])(a0, a1, a2))
  let _recordDependencyOnExpr = (Module['_recordDependencyOnExpr'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_recordDependencyOnExpr = Module['_recordDependencyOnExpr'] =
      wasmExports['recordDependencyOnExpr'])(a0, a1, a2, a3))
  let _query_tree_walker_impl = (Module['_query_tree_walker_impl'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_query_tree_walker_impl = Module['_query_tree_walker_impl'] =
      wasmExports['query_tree_walker_impl'])(a0, a1, a2, a3))
  let _expression_tree_walker_impl = (Module['_expression_tree_walker_impl'] = (
    a0,
    a1,
    a2,
  ) =>
    (_expression_tree_walker_impl = Module['_expression_tree_walker_impl'] =
      wasmExports['expression_tree_walker_impl'])(a0, a1, a2))
  let _add_exact_object_address = (Module['_add_exact_object_address'] = (
    a0,
    a1,
  ) =>
    (_add_exact_object_address = Module['_add_exact_object_address'] =
      wasmExports['add_exact_object_address'])(a0, a1))
  let _get_rel_relkind = (Module['_get_rel_relkind'] = (a0) =>
    (_get_rel_relkind = Module['_get_rel_relkind'] =
      wasmExports['get_rel_relkind'])(a0))
  let _get_typtype = (Module['_get_typtype'] = (a0) =>
    (_get_typtype = Module['_get_typtype'] = wasmExports['get_typtype'])(a0))
  let _list_delete_last = (Module['_list_delete_last'] = (a0) =>
    (_list_delete_last = Module['_list_delete_last'] =
      wasmExports['list_delete_last'])(a0))
  let _type_is_collatable = (Module['_type_is_collatable'] = (a0) =>
    (_type_is_collatable = Module['_type_is_collatable'] =
      wasmExports['type_is_collatable'])(a0))
  let _CatalogOpenIndexes = (Module['_CatalogOpenIndexes'] = (a0) =>
    (_CatalogOpenIndexes = Module['_CatalogOpenIndexes'] =
      wasmExports['CatalogOpenIndexes'])(a0))
  let _CatalogCloseIndexes = (Module['_CatalogCloseIndexes'] = (a0) =>
    (_CatalogCloseIndexes = Module['_CatalogCloseIndexes'] =
      wasmExports['CatalogCloseIndexes'])(a0))
  let _get_relname_relid = (Module['_get_relname_relid'] = (a0, a1) =>
    (_get_relname_relid = Module['_get_relname_relid'] =
      wasmExports['get_relname_relid'])(a0, a1))
  let _GetSysCacheOid = (Module['_GetSysCacheOid'] = (a0, a1, a2, a3, a4, a5) =>
    (_GetSysCacheOid = Module['_GetSysCacheOid'] =
      wasmExports['GetSysCacheOid'])(a0, a1, a2, a3, a4, a5))
  let _CheckTableNotInUse = (Module['_CheckTableNotInUse'] = (a0, a1) =>
    (_CheckTableNotInUse = Module['_CheckTableNotInUse'] =
      wasmExports['CheckTableNotInUse'])(a0, a1))
  let _construct_array = (Module['_construct_array'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_construct_array = Module['_construct_array'] =
      wasmExports['construct_array'])(a0, a1, a2, a3, a4, a5))
  let _make_parsestate = (Module['_make_parsestate'] = (a0) =>
    (_make_parsestate = Module['_make_parsestate'] =
      wasmExports['make_parsestate'])(a0))
  let _addRangeTableEntryForRelation = (Module[
    '_addRangeTableEntryForRelation'
  ] = (a0, a1, a2, a3, a4, a5) =>
    (_addRangeTableEntryForRelation = Module['_addRangeTableEntryForRelation'] =
      wasmExports['addRangeTableEntryForRelation'])(a0, a1, a2, a3, a4, a5))
  let _addNSItemToQuery = (Module['_addNSItemToQuery'] = (a0, a1, a2, a3, a4) =>
    (_addNSItemToQuery = Module['_addNSItemToQuery'] =
      wasmExports['addNSItemToQuery'])(a0, a1, a2, a3, a4))
  let _transformExpr = (Module['_transformExpr'] = (a0, a1, a2) =>
    (_transformExpr = Module['_transformExpr'] = wasmExports['transformExpr'])(
      a0,
      a1,
      a2,
    ))
  let _coerce_to_boolean = (Module['_coerce_to_boolean'] = (a0, a1, a2) =>
    (_coerce_to_boolean = Module['_coerce_to_boolean'] =
      wasmExports['coerce_to_boolean'])(a0, a1, a2))
  let _assign_expr_collations = (Module['_assign_expr_collations'] = (a0, a1) =>
    (_assign_expr_collations = Module['_assign_expr_collations'] =
      wasmExports['assign_expr_collations'])(a0, a1))
  let _equal = (Module['_equal'] = (a0, a1) =>
    (_equal = Module['_equal'] = wasmExports['equal'])(a0, a1))
  let _pull_var_clause = (Module['_pull_var_clause'] = (a0, a1) =>
    (_pull_var_clause = Module['_pull_var_clause'] =
      wasmExports['pull_var_clause'])(a0, a1))
  let _get_attname = (Module['_get_attname'] = (a0, a1, a2) =>
    (_get_attname = Module['_get_attname'] = wasmExports['get_attname'])(
      a0,
      a1,
      a2,
    ))
  let _coerce_to_target_type = (Module['_coerce_to_target_type'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_coerce_to_target_type = Module['_coerce_to_target_type'] =
      wasmExports['coerce_to_target_type'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _nodeToString = (Module['_nodeToString'] = (a0) =>
    (_nodeToString = Module['_nodeToString'] = wasmExports['nodeToString'])(a0))
  let _lappend_int = (Module['_lappend_int'] = (a0, a1) =>
    (_lappend_int = Module['_lappend_int'] = wasmExports['lappend_int'])(
      a0,
      a1,
    ))
  let _list_delete_nth_cell = (Module['_list_delete_nth_cell'] = (a0, a1) =>
    (_list_delete_nth_cell = Module['_list_delete_nth_cell'] =
      wasmExports['list_delete_nth_cell'])(a0, a1))
  let _CatalogTupleInsertWithInfo = (Module['_CatalogTupleInsertWithInfo'] = (
    a0,
    a1,
    a2,
  ) =>
    (_CatalogTupleInsertWithInfo = Module['_CatalogTupleInsertWithInfo'] =
      wasmExports['CatalogTupleInsertWithInfo'])(a0, a1, a2))
  let _buildoidvector = (Module['_buildoidvector'] = (a0, a1) =>
    (_buildoidvector = Module['_buildoidvector'] =
      wasmExports['buildoidvector'])(a0, a1))
  let _parser_errposition = (Module['_parser_errposition'] = (a0, a1) =>
    (_parser_errposition = Module['_parser_errposition'] =
      wasmExports['parser_errposition'])(a0, a1))
  let _exprLocation = (Module['_exprLocation'] = (a0) =>
    (_exprLocation = Module['_exprLocation'] = wasmExports['exprLocation'])(a0))
  let _exprTypmod = (Module['_exprTypmod'] = (a0) =>
    (_exprTypmod = Module['_exprTypmod'] = wasmExports['exprTypmod'])(a0))
  let _get_base_element_type = (Module['_get_base_element_type'] = (a0) =>
    (_get_base_element_type = Module['_get_base_element_type'] =
      wasmExports['get_base_element_type'])(a0))
  let _SystemFuncName = (Module['_SystemFuncName'] = (a0) =>
    (_SystemFuncName = Module['_SystemFuncName'] =
      wasmExports['SystemFuncName'])(a0))
  let _CreateTrigger = (Module['_CreateTrigger'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
    a11,
  ) =>
    (_CreateTrigger = Module['_CreateTrigger'] = wasmExports['CreateTrigger'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
      a11,
    ))
  let _plan_create_index_workers = (Module['_plan_create_index_workers'] = (
    a0,
    a1,
  ) =>
    (_plan_create_index_workers = Module['_plan_create_index_workers'] =
      wasmExports['plan_create_index_workers'])(a0, a1))
  let _tuplesort_begin_datum = (Module['_tuplesort_begin_datum'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_tuplesort_begin_datum = Module['_tuplesort_begin_datum'] =
      wasmExports['tuplesort_begin_datum'])(a0, a1, a2, a3, a4, a5, a6))
  let _tuplesort_putdatum = (Module['_tuplesort_putdatum'] = (a0, a1, a2) =>
    (_tuplesort_putdatum = Module['_tuplesort_putdatum'] =
      wasmExports['tuplesort_putdatum'])(a0, a1, a2))
  let _get_rel_namespace = (Module['_get_rel_namespace'] = (a0) =>
    (_get_rel_namespace = Module['_get_rel_namespace'] =
      wasmExports['get_rel_namespace'])(a0))
  let _ExecOpenIndices = (Module['_ExecOpenIndices'] = (a0, a1) =>
    (_ExecOpenIndices = Module['_ExecOpenIndices'] =
      wasmExports['ExecOpenIndices'])(a0, a1))
  let _ExecCloseIndices = (Module['_ExecCloseIndices'] = (a0) =>
    (_ExecCloseIndices = Module['_ExecCloseIndices'] =
      wasmExports['ExecCloseIndices'])(a0))
  let _ConditionalLockRelationOid = (Module['_ConditionalLockRelationOid'] = (
    a0,
    a1,
  ) =>
    (_ConditionalLockRelationOid = Module['_ConditionalLockRelationOid'] =
      wasmExports['ConditionalLockRelationOid'])(a0, a1))
  let _RelnameGetRelid = (Module['_RelnameGetRelid'] = (a0) =>
    (_RelnameGetRelid = Module['_RelnameGetRelid'] =
      wasmExports['RelnameGetRelid'])(a0))
  let _get_relkind_objtype = (Module['_get_relkind_objtype'] = (a0) =>
    (_get_relkind_objtype = Module['_get_relkind_objtype'] =
      wasmExports['get_relkind_objtype'])(a0))
  let _RelationIsVisible = (Module['_RelationIsVisible'] = (a0) =>
    (_RelationIsVisible = Module['_RelationIsVisible'] =
      wasmExports['RelationIsVisible'])(a0))
  let _TypenameGetTypid = (Module['_TypenameGetTypid'] = (a0) =>
    (_TypenameGetTypid = Module['_TypenameGetTypid'] =
      wasmExports['TypenameGetTypid'])(a0))
  let _get_func_arg_info = (Module['_get_func_arg_info'] = (a0, a1, a2, a3) =>
    (_get_func_arg_info = Module['_get_func_arg_info'] =
      wasmExports['get_func_arg_info'])(a0, a1, a2, a3))
  let _NameListToString = (Module['_NameListToString'] = (a0) =>
    (_NameListToString = Module['_NameListToString'] =
      wasmExports['NameListToString'])(a0))
  let _OpernameGetOprid = (Module['_OpernameGetOprid'] = (a0, a1, a2) =>
    (_OpernameGetOprid = Module['_OpernameGetOprid'] =
      wasmExports['OpernameGetOprid'])(a0, a1, a2))
  let _get_ts_config_oid = (Module['_get_ts_config_oid'] = (a0, a1) =>
    (_get_ts_config_oid = Module['_get_ts_config_oid'] =
      wasmExports['get_ts_config_oid'])(a0, a1))
  let _makeRangeVarFromNameList = (Module['_makeRangeVarFromNameList'] = (a0) =>
    (_makeRangeVarFromNameList = Module['_makeRangeVarFromNameList'] =
      wasmExports['makeRangeVarFromNameList'])(a0))
  let _quote_identifier = (Module['_quote_identifier'] = (a0) =>
    (_quote_identifier = Module['_quote_identifier'] =
      wasmExports['quote_identifier'])(a0))
  let _atoi = (Module['_atoi'] = (a0) =>
    (_atoi = Module['_atoi'] = wasmExports['atoi'])(a0))
  let _GetSearchPathMatcher = (Module['_GetSearchPathMatcher'] = (a0) =>
    (_GetSearchPathMatcher = Module['_GetSearchPathMatcher'] =
      wasmExports['GetSearchPathMatcher'])(a0))
  let _SearchPathMatchesCurrentEnvironment = (Module[
    '_SearchPathMatchesCurrentEnvironment'
  ] = (a0) =>
    (_SearchPathMatchesCurrentEnvironment = Module[
      '_SearchPathMatchesCurrentEnvironment'
    ] =
      wasmExports['SearchPathMatchesCurrentEnvironment'])(a0))
  let _get_collation_oid = (Module['_get_collation_oid'] = (a0, a1) =>
    (_get_collation_oid = Module['_get_collation_oid'] =
      wasmExports['get_collation_oid'])(a0, a1))
  let _GetDatabaseEncodingName = (Module['_GetDatabaseEncodingName'] = () =>
    (_GetDatabaseEncodingName = Module['_GetDatabaseEncodingName'] =
      wasmExports['GetDatabaseEncodingName'])())
  let _CacheRegisterSyscacheCallback = (Module[
    '_CacheRegisterSyscacheCallback'
  ] = (a0, a1, a2) =>
    (_CacheRegisterSyscacheCallback = Module['_CacheRegisterSyscacheCallback'] =
      wasmExports['CacheRegisterSyscacheCallback'])(a0, a1, a2))
  let _fetch_search_path = (Module['_fetch_search_path'] = (a0) =>
    (_fetch_search_path = Module['_fetch_search_path'] =
      wasmExports['fetch_search_path'])(a0))
  let _get_extension_oid = (Module['_get_extension_oid'] = (a0, a1) =>
    (_get_extension_oid = Module['_get_extension_oid'] =
      wasmExports['get_extension_oid'])(a0, a1))
  let _get_role_oid = (Module['_get_role_oid'] = (a0, a1) =>
    (_get_role_oid = Module['_get_role_oid'] = wasmExports['get_role_oid'])(
      a0,
      a1,
    ))
  let _get_am_oid = (Module['_get_am_oid'] = (a0, a1) =>
    (_get_am_oid = Module['_get_am_oid'] = wasmExports['get_am_oid'])(a0, a1))
  let _GetForeignServerByName = (Module['_GetForeignServerByName'] = (a0, a1) =>
    (_GetForeignServerByName = Module['_GetForeignServerByName'] =
      wasmExports['GetForeignServerByName'])(a0, a1))
  let _typeStringToTypeName = (Module['_typeStringToTypeName'] = (a0, a1) =>
    (_typeStringToTypeName = Module['_typeStringToTypeName'] =
      wasmExports['typeStringToTypeName'])(a0, a1))
  let _makeFloat = (Module['_makeFloat'] = (a0) =>
    (_makeFloat = Module['_makeFloat'] = wasmExports['makeFloat'])(a0))
  let _list_make2_impl = (Module['_list_make2_impl'] = (a0, a1, a2) =>
    (_list_make2_impl = Module['_list_make2_impl'] =
      wasmExports['list_make2_impl'])(a0, a1, a2))
  let _check_object_ownership = (Module['_check_object_ownership'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_check_object_ownership = Module['_check_object_ownership'] =
      wasmExports['check_object_ownership'])(a0, a1, a2, a3, a4))
  let _GetUserNameFromId = (Module['_GetUserNameFromId'] = (a0, a1) =>
    (_GetUserNameFromId = Module['_GetUserNameFromId'] =
      wasmExports['GetUserNameFromId'])(a0, a1))
  let _format_type_extended = (Module['_format_type_extended'] = (a0, a1, a2) =>
    (_format_type_extended = Module['_format_type_extended'] =
      wasmExports['format_type_extended'])(a0, a1, a2))
  let _quote_qualified_identifier = (Module['_quote_qualified_identifier'] = (
    a0,
    a1,
  ) =>
    (_quote_qualified_identifier = Module['_quote_qualified_identifier'] =
      wasmExports['quote_qualified_identifier'])(a0, a1))
  let _get_tablespace_name = (Module['_get_tablespace_name'] = (a0) =>
    (_get_tablespace_name = Module['_get_tablespace_name'] =
      wasmExports['get_tablespace_name'])(a0))
  let _GetForeignServerExtended = (Module['_GetForeignServerExtended'] = (
    a0,
    a1,
  ) =>
    (_GetForeignServerExtended = Module['_GetForeignServerExtended'] =
      wasmExports['GetForeignServerExtended'])(a0, a1))
  let _GetForeignServer = (Module['_GetForeignServer'] = (a0) =>
    (_GetForeignServer = Module['_GetForeignServer'] =
      wasmExports['GetForeignServer'])(a0))
  let _get_extension_name = (Module['_get_extension_name'] = (a0) =>
    (_get_extension_name = Module['_get_extension_name'] =
      wasmExports['get_extension_name'])(a0))
  let _construct_empty_array = (Module['_construct_empty_array'] = (a0) =>
    (_construct_empty_array = Module['_construct_empty_array'] =
      wasmExports['construct_empty_array'])(a0))
  let _format_type_be_qualified = (Module['_format_type_be_qualified'] = (a0) =>
    (_format_type_be_qualified = Module['_format_type_be_qualified'] =
      wasmExports['format_type_be_qualified'])(a0))
  let _get_namespace_name_or_temp = (Module['_get_namespace_name_or_temp'] = (
    a0,
  ) =>
    (_get_namespace_name_or_temp = Module['_get_namespace_name_or_temp'] =
      wasmExports['get_namespace_name_or_temp'])(a0))
  let _list_make3_impl = (Module['_list_make3_impl'] = (a0, a1, a2, a3) =>
    (_list_make3_impl = Module['_list_make3_impl'] =
      wasmExports['list_make3_impl'])(a0, a1, a2, a3))
  let _construct_md_array = (Module['_construct_md_array'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
  ) =>
    (_construct_md_array = Module['_construct_md_array'] =
      wasmExports['construct_md_array'])(a0, a1, a2, a3, a4, a5, a6, a7, a8))
  let _pull_varattnos = (Module['_pull_varattnos'] = (a0, a1, a2) =>
    (_pull_varattnos = Module['_pull_varattnos'] =
      wasmExports['pull_varattnos'])(a0, a1, a2))
  let _makeBoolExpr = (Module['_makeBoolExpr'] = (a0, a1, a2) =>
    (_makeBoolExpr = Module['_makeBoolExpr'] = wasmExports['makeBoolExpr'])(
      a0,
      a1,
      a2,
    ))
  let _eval_const_expressions = (Module['_eval_const_expressions'] = (a0, a1) =>
    (_eval_const_expressions = Module['_eval_const_expressions'] =
      wasmExports['eval_const_expressions'])(a0, a1))
  let _get_func_name = (Module['_get_func_name'] = (a0) =>
    (_get_func_name = Module['_get_func_name'] = wasmExports['get_func_name'])(
      a0,
    ))
  let _construct_array_builtin = (Module['_construct_array_builtin'] = (
    a0,
    a1,
    a2,
  ) =>
    (_construct_array_builtin = Module['_construct_array_builtin'] =
      wasmExports['construct_array_builtin'])(a0, a1, a2))
  let _makeObjectName = (Module['_makeObjectName'] = (a0, a1, a2) =>
    (_makeObjectName = Module['_makeObjectName'] =
      wasmExports['makeObjectName'])(a0, a1, a2))
  let _get_primary_key_attnos = (Module['_get_primary_key_attnos'] = (
    a0,
    a1,
    a2,
  ) =>
    (_get_primary_key_attnos = Module['_get_primary_key_attnos'] =
      wasmExports['get_primary_key_attnos'])(a0, a1, a2))
  let _check_functional_grouping = (Module['_check_functional_grouping'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_check_functional_grouping = Module['_check_functional_grouping'] =
      wasmExports['check_functional_grouping'])(a0, a1, a2, a3, a4))
  let _bms_is_subset = (Module['_bms_is_subset'] = (a0, a1) =>
    (_bms_is_subset = Module['_bms_is_subset'] = wasmExports['bms_is_subset'])(
      a0,
      a1,
    ))
  let _getExtensionOfObject = (Module['_getExtensionOfObject'] = (a0, a1) =>
    (_getExtensionOfObject = Module['_getExtensionOfObject'] =
      wasmExports['getExtensionOfObject'])(a0, a1))
  let _find_inheritance_children = (Module['_find_inheritance_children'] = (
    a0,
    a1,
  ) =>
    (_find_inheritance_children = Module['_find_inheritance_children'] =
      wasmExports['find_inheritance_children'])(a0, a1))
  let _find_all_inheritors = (Module['_find_all_inheritors'] = (a0, a1, a2) =>
    (_find_all_inheritors = Module['_find_all_inheritors'] =
      wasmExports['find_all_inheritors'])(a0, a1, a2))
  let _has_superclass = (Module['_has_superclass'] = (a0) =>
    (_has_superclass = Module['_has_superclass'] =
      wasmExports['has_superclass'])(a0))
  let _strstr = (Module['_strstr'] = (a0, a1) =>
    (_strstr = Module['_strstr'] = wasmExports['strstr'])(a0, a1))
  let _memchr = (Module['_memchr'] = (a0, a1, a2) =>
    (_memchr = Module['_memchr'] = wasmExports['memchr'])(a0, a1, a2))
  let _CheckFunctionValidatorAccess = (Module['_CheckFunctionValidatorAccess'] =
    (a0, a1) =>
      (_CheckFunctionValidatorAccess = Module['_CheckFunctionValidatorAccess'] =
        wasmExports['CheckFunctionValidatorAccess'])(a0, a1))
  let _AcquireRewriteLocks = (Module['_AcquireRewriteLocks'] = (a0, a1, a2) =>
    (_AcquireRewriteLocks = Module['_AcquireRewriteLocks'] =
      wasmExports['AcquireRewriteLocks'])(a0, a1, a2))
  let _pg_parse_query = (Module['_pg_parse_query'] = (a0) =>
    (_pg_parse_query = Module['_pg_parse_query'] =
      wasmExports['pg_parse_query'])(a0))
  let _get_func_result_type = (Module['_get_func_result_type'] = (a0, a1, a2) =>
    (_get_func_result_type = Module['_get_func_result_type'] =
      wasmExports['get_func_result_type'])(a0, a1, a2))
  let _function_parse_error_transpose = (Module[
    '_function_parse_error_transpose'
  ] = (a0) =>
    (_function_parse_error_transpose = Module[
      '_function_parse_error_transpose'
    ] =
      wasmExports['function_parse_error_transpose'])(a0))
  let _geterrposition = (Module['_geterrposition'] = () =>
    (_geterrposition = Module['_geterrposition'] =
      wasmExports['geterrposition'])())
  let _getinternalerrposition = (Module['_getinternalerrposition'] = () =>
    (_getinternalerrposition = Module['_getinternalerrposition'] =
      wasmExports['getinternalerrposition'])())
  let _pg_mblen_cstr = (Module['_pg_mblen_cstr'] = (a0) =>
    (_pg_mblen_cstr = Module['_pg_mblen_cstr'] = wasmExports['pg_mblen_cstr'])(
      a0,
    ))
  let _pg_mbstrlen_with_len = (Module['_pg_mbstrlen_with_len'] = (a0, a1) =>
    (_pg_mbstrlen_with_len = Module['_pg_mbstrlen_with_len'] =
      wasmExports['pg_mbstrlen_with_len'])(a0, a1))
  let _errposition = (Module['_errposition'] = (a0) =>
    (_errposition = Module['_errposition'] = wasmExports['errposition'])(a0))
  let _internalerrposition = (Module['_internalerrposition'] = (a0) =>
    (_internalerrposition = Module['_internalerrposition'] =
      wasmExports['internalerrposition'])(a0))
  let _internalerrquery = (Module['_internalerrquery'] = (a0) =>
    (_internalerrquery = Module['_internalerrquery'] =
      wasmExports['internalerrquery'])(a0))
  let _bms_num_members = (Module['_bms_num_members'] = (a0) =>
    (_bms_num_members = Module['_bms_num_members'] =
      wasmExports['bms_num_members'])(a0))
  let _quote_literal_cstr = (Module['_quote_literal_cstr'] = (a0) =>
    (_quote_literal_cstr = Module['_quote_literal_cstr'] =
      wasmExports['quote_literal_cstr'])(a0))
  let _get_array_type = (Module['_get_array_type'] = (a0) =>
    (_get_array_type = Module['_get_array_type'] =
      wasmExports['get_array_type'])(a0))
  let _pnstrdup = (Module['_pnstrdup'] = (a0, a1) =>
    (_pnstrdup = Module['_pnstrdup'] = wasmExports['pnstrdup'])(a0, a1))
  let _smgrtruncate = (Module['_smgrtruncate'] = (a0, a1, a2, a3, a4) =>
    (_smgrtruncate = Module['_smgrtruncate'] = wasmExports['smgrtruncate'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _smgrreadv = (Module['_smgrreadv'] = (a0, a1, a2, a3, a4) =>
    (_smgrreadv = Module['_smgrreadv'] = wasmExports['smgrreadv'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _NewRelationCreateToastTable = (Module['_NewRelationCreateToastTable'] = (
    a0,
    a1,
  ) =>
    (_NewRelationCreateToastTable = Module['_NewRelationCreateToastTable'] =
      wasmExports['NewRelationCreateToastTable'])(a0, a1))
  let _transformStmt = (Module['_transformStmt'] = (a0, a1) =>
    (_transformStmt = Module['_transformStmt'] = wasmExports['transformStmt'])(
      a0,
      a1,
    ))
  let _free_parsestate = (Module['_free_parsestate'] = (a0) =>
    (_free_parsestate = Module['_free_parsestate'] =
      wasmExports['free_parsestate'])(a0))
  let _makeFromExpr = (Module['_makeFromExpr'] = (a0, a1) =>
    (_makeFromExpr = Module['_makeFromExpr'] = wasmExports['makeFromExpr'])(
      a0,
      a1,
    ))
  let _assign_query_collations = (Module['_assign_query_collations'] = (
    a0,
    a1,
  ) =>
    (_assign_query_collations = Module['_assign_query_collations'] =
      wasmExports['assign_query_collations'])(a0, a1))
  let _ParseFuncOrColumn = (Module['_ParseFuncOrColumn'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_ParseFuncOrColumn = Module['_ParseFuncOrColumn'] =
      wasmExports['ParseFuncOrColumn'])(a0, a1, a2, a3, a4, a5, a6))
  let _exprCollation = (Module['_exprCollation'] = (a0) =>
    (_exprCollation = Module['_exprCollation'] = wasmExports['exprCollation'])(
      a0,
    ))
  let _transformSortClause = (Module['_transformSortClause'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_transformSortClause = Module['_transformSortClause'] =
      wasmExports['transformSortClause'])(a0, a1, a2, a3, a4))
  let _transformDistinctClause = (Module['_transformDistinctClause'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_transformDistinctClause = Module['_transformDistinctClause'] =
      wasmExports['transformDistinctClause'])(a0, a1, a2, a3))
  let _makeTargetEntry = (Module['_makeTargetEntry'] = (a0, a1, a2, a3) =>
    (_makeTargetEntry = Module['_makeTargetEntry'] =
      wasmExports['makeTargetEntry'])(a0, a1, a2, a3))
  let _select_common_type = (Module['_select_common_type'] = (a0, a1, a2, a3) =>
    (_select_common_type = Module['_select_common_type'] =
      wasmExports['select_common_type'])(a0, a1, a2, a3))
  let _coerce_to_common_type = (Module['_coerce_to_common_type'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_coerce_to_common_type = Module['_coerce_to_common_type'] =
      wasmExports['coerce_to_common_type'])(a0, a1, a2, a3))
  let _select_common_collation = (Module['_select_common_collation'] = (
    a0,
    a1,
    a2,
  ) =>
    (_select_common_collation = Module['_select_common_collation'] =
      wasmExports['select_common_collation'])(a0, a1, a2))
  let _contain_vars_of_level = (Module['_contain_vars_of_level'] = (a0, a1) =>
    (_contain_vars_of_level = Module['_contain_vars_of_level'] =
      wasmExports['contain_vars_of_level'])(a0, a1))
  let _expandNSItemAttrs = (Module['_expandNSItemAttrs'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_expandNSItemAttrs = Module['_expandNSItemAttrs'] =
      wasmExports['expandNSItemAttrs'])(a0, a1, a2, a3, a4))
  let _makeAlias = (Module['_makeAlias'] = (a0, a1) =>
    (_makeAlias = Module['_makeAlias'] = wasmExports['makeAlias'])(a0, a1))
  let _addRangeTableEntryForSubquery = (Module[
    '_addRangeTableEntryForSubquery'
  ] = (a0, a1, a2, a3, a4) =>
    (_addRangeTableEntryForSubquery = Module['_addRangeTableEntryForSubquery'] =
      wasmExports['addRangeTableEntryForSubquery'])(a0, a1, a2, a3, a4))
  let _assign_list_collations = (Module['_assign_list_collations'] = (a0, a1) =>
    (_assign_list_collations = Module['_assign_list_collations'] =
      wasmExports['assign_list_collations'])(a0, a1))
  let _expandNSItemVars = (Module['_expandNSItemVars'] = (a0, a1, a2, a3, a4) =>
    (_expandNSItemVars = Module['_expandNSItemVars'] =
      wasmExports['expandNSItemVars'])(a0, a1, a2, a3, a4))
  let _markTargetListOrigins = (Module['_markTargetListOrigins'] = (a0, a1) =>
    (_markTargetListOrigins = Module['_markTargetListOrigins'] =
      wasmExports['markTargetListOrigins'])(a0, a1))
  let _addRangeTableEntryForJoin = (Module['_addRangeTableEntryForJoin'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
  ) =>
    (_addRangeTableEntryForJoin = Module['_addRangeTableEntryForJoin'] =
      wasmExports['addRangeTableEntryForJoin'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
    ))
  let _list_truncate = (Module['_list_truncate'] = (a0, a1) =>
    (_list_truncate = Module['_list_truncate'] = wasmExports['list_truncate'])(
      a0,
      a1,
    ))
  let _makeVar = (Module['_makeVar'] = (a0, a1, a2, a3, a4, a5) =>
    (_makeVar = Module['_makeVar'] = wasmExports['makeVar'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
    ))
  let _makeNullConst = (Module['_makeNullConst'] = (a0, a1, a2) =>
    (_makeNullConst = Module['_makeNullConst'] = wasmExports['makeNullConst'])(
      a0,
      a1,
      a2,
    ))
  let _get_sort_group_operators = (Module['_get_sort_group_operators'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_get_sort_group_operators = Module['_get_sort_group_operators'] =
      wasmExports['get_sort_group_operators'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _refnameNamespaceItem = (Module['_refnameNamespaceItem'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_refnameNamespaceItem = Module['_refnameNamespaceItem'] =
      wasmExports['refnameNamespaceItem'])(a0, a1, a2, a3, a4))
  let _setup_parser_errposition_callback = (Module[
    '_setup_parser_errposition_callback'
  ] = (a0, a1, a2) =>
    (_setup_parser_errposition_callback = Module[
      '_setup_parser_errposition_callback'
    ] =
      wasmExports['setup_parser_errposition_callback'])(a0, a1, a2))
  let _cancel_parser_errposition_callback = (Module[
    '_cancel_parser_errposition_callback'
  ] = (a0) =>
    (_cancel_parser_errposition_callback = Module[
      '_cancel_parser_errposition_callback'
    ] =
      wasmExports['cancel_parser_errposition_callback'])(a0))
  let _locate_var_of_level = (Module['_locate_var_of_level'] = (a0, a1) =>
    (_locate_var_of_level = Module['_locate_var_of_level'] =
      wasmExports['locate_var_of_level'])(a0, a1))
  let _makeBoolean = (Module['_makeBoolean'] = (a0) =>
    (_makeBoolean = Module['_makeBoolean'] = wasmExports['makeBoolean'])(a0))
  let _makeInteger = (Module['_makeInteger'] = (a0) =>
    (_makeInteger = Module['_makeInteger'] = wasmExports['makeInteger'])(a0))
  let _makeSimpleA_Expr = (Module['_makeSimpleA_Expr'] = (a0, a1, a2, a3, a4) =>
    (_makeSimpleA_Expr = Module['_makeSimpleA_Expr'] =
      wasmExports['makeSimpleA_Expr'])(a0, a1, a2, a3, a4))
  let _makeTypeName = (Module['_makeTypeName'] = (a0) =>
    (_makeTypeName = Module['_makeTypeName'] = wasmExports['makeTypeName'])(a0))
  let _SystemTypeName = (Module['_SystemTypeName'] = (a0) =>
    (_SystemTypeName = Module['_SystemTypeName'] =
      wasmExports['SystemTypeName'])(a0))
  let _makeFuncCall = (Module['_makeFuncCall'] = (a0, a1, a2, a3) =>
    (_makeFuncCall = Module['_makeFuncCall'] = wasmExports['makeFuncCall'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _makeA_Expr = (Module['_makeA_Expr'] = (a0, a1, a2, a3, a4) =>
    (_makeA_Expr = Module['_makeA_Expr'] = wasmExports['makeA_Expr'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _list_make4_impl = (Module['_list_make4_impl'] = (a0, a1, a2, a3, a4) =>
    (_list_make4_impl = Module['_list_make4_impl'] =
      wasmExports['list_make4_impl'])(a0, a1, a2, a3, a4))
  let _addTargetToSortList = (Module['_addTargetToSortList'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_addTargetToSortList = Module['_addTargetToSortList'] =
      wasmExports['addTargetToSortList'])(a0, a1, a2, a3, a4))
  let _locate_agg_of_level = (Module['_locate_agg_of_level'] = (a0, a1) =>
    (_locate_agg_of_level = Module['_locate_agg_of_level'] =
      wasmExports['locate_agg_of_level'])(a0, a1))
  let _list_intersection_int = (Module['_list_intersection_int'] = (a0, a1) =>
    (_list_intersection_int = Module['_list_intersection_int'] =
      wasmExports['list_intersection_int'])(a0, a1))
  let _get_sortgroupclause_tle = (Module['_get_sortgroupclause_tle'] = (
    a0,
    a1,
  ) =>
    (_get_sortgroupclause_tle = Module['_get_sortgroupclause_tle'] =
      wasmExports['get_sortgroupclause_tle'])(a0, a1))
  let _flatten_join_alias_vars = (Module['_flatten_join_alias_vars'] = (
    a0,
    a1,
    a2,
  ) =>
    (_flatten_join_alias_vars = Module['_flatten_join_alias_vars'] =
      wasmExports['flatten_join_alias_vars'])(a0, a1, a2))
  let _list_member_int = (Module['_list_member_int'] = (a0, a1) =>
    (_list_member_int = Module['_list_member_int'] =
      wasmExports['list_member_int'])(a0, a1))
  let _list_union_int = (Module['_list_union_int'] = (a0, a1) =>
    (_list_union_int = Module['_list_union_int'] =
      wasmExports['list_union_int'])(a0, a1))
  let _makeFuncExpr = (Module['_makeFuncExpr'] = (a0, a1, a2, a3, a4, a5) =>
    (_makeFuncExpr = Module['_makeFuncExpr'] = wasmExports['makeFuncExpr'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
    ))
  let _get_rte_attribute_name = (Module['_get_rte_attribute_name'] = (a0, a1) =>
    (_get_rte_attribute_name = Module['_get_rte_attribute_name'] =
      wasmExports['get_rte_attribute_name'])(a0, a1))
  let _expression_tree_mutator_impl = (Module['_expression_tree_mutator_impl'] =
    (a0, a1, a2) =>
      (_expression_tree_mutator_impl = Module['_expression_tree_mutator_impl'] =
        wasmExports['expression_tree_mutator_impl'])(a0, a1, a2))
  let _checkNameSpaceConflicts = (Module['_checkNameSpaceConflicts'] = (
    a0,
    a1,
    a2,
  ) =>
    (_checkNameSpaceConflicts = Module['_checkNameSpaceConflicts'] =
      wasmExports['checkNameSpaceConflicts'])(a0, a1, a2))
  let _addRangeTableEntryForENR = (Module['_addRangeTableEntryForENR'] = (
    a0,
    a1,
    a2,
  ) =>
    (_addRangeTableEntryForENR = Module['_addRangeTableEntryForENR'] =
      wasmExports['addRangeTableEntryForENR'])(a0, a1, a2))
  let _addRangeTableEntry = (Module['_addRangeTableEntry'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_addRangeTableEntry = Module['_addRangeTableEntry'] =
      wasmExports['addRangeTableEntry'])(a0, a1, a2, a3, a4))
  let _FigureColname = (Module['_FigureColname'] = (a0) =>
    (_FigureColname = Module['_FigureColname'] = wasmExports['FigureColname'])(
      a0,
    ))
  let _coerce_to_specific_type = (Module['_coerce_to_specific_type'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_coerce_to_specific_type = Module['_coerce_to_specific_type'] =
      wasmExports['coerce_to_specific_type'])(a0, a1, a2, a3))
  let _typenameTypeIdAndMod = (Module['_typenameTypeIdAndMod'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_typenameTypeIdAndMod = Module['_typenameTypeIdAndMod'] =
      wasmExports['typenameTypeIdAndMod'])(a0, a1, a2, a3))
  let _get_typcollation = (Module['_get_typcollation'] = (a0) =>
    (_get_typcollation = Module['_get_typcollation'] =
      wasmExports['get_typcollation'])(a0))
  let _markNullableIfNeeded = (Module['_markNullableIfNeeded'] = (a0, a1) =>
    (_markNullableIfNeeded = Module['_markNullableIfNeeded'] =
      wasmExports['markNullableIfNeeded'])(a0, a1))
  let _markVarForSelectPriv = (Module['_markVarForSelectPriv'] = (a0, a1) =>
    (_markVarForSelectPriv = Module['_markVarForSelectPriv'] =
      wasmExports['markVarForSelectPriv'])(a0, a1))
  let _coerce_type = (Module['_coerce_type'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_coerce_type = Module['_coerce_type'] = wasmExports['coerce_type'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
    ))
  let _LookupFuncName = (Module['_LookupFuncName'] = (a0, a1, a2, a3) =>
    (_LookupFuncName = Module['_LookupFuncName'] =
      wasmExports['LookupFuncName'])(a0, a1, a2, a3))
  let _addRangeTableEntryForFunction = (Module[
    '_addRangeTableEntryForFunction'
  ] = (a0, a1, a2, a3, a4, a5, a6) =>
    (_addRangeTableEntryForFunction = Module['_addRangeTableEntryForFunction'] =
      wasmExports['addRangeTableEntryForFunction'])(a0, a1, a2, a3, a4, a5, a6))
  let _parserOpenTable = (Module['_parserOpenTable'] = (a0, a1, a2) =>
    (_parserOpenTable = Module['_parserOpenTable'] =
      wasmExports['parserOpenTable'])(a0, a1, a2))
  let _strip_implicit_coercions = (Module['_strip_implicit_coercions'] = (a0) =>
    (_strip_implicit_coercions = Module['_strip_implicit_coercions'] =
      wasmExports['strip_implicit_coercions'])(a0))
  let _colNameToVar = (Module['_colNameToVar'] = (a0, a1, a2, a3) =>
    (_colNameToVar = Module['_colNameToVar'] = wasmExports['colNameToVar'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _op_hashjoinable = (Module['_op_hashjoinable'] = (a0, a1) =>
    (_op_hashjoinable = Module['_op_hashjoinable'] =
      wasmExports['op_hashjoinable'])(a0, a1))
  let _get_commutator = (Module['_get_commutator'] = (a0) =>
    (_get_commutator = Module['_get_commutator'] =
      wasmExports['get_commutator'])(a0))
  let _can_coerce_type = (Module['_can_coerce_type'] = (a0, a1, a2, a3) =>
    (_can_coerce_type = Module['_can_coerce_type'] =
      wasmExports['can_coerce_type'])(a0, a1, a2, a3))
  let _get_sortgroupref_tle = (Module['_get_sortgroupref_tle'] = (a0, a1) =>
    (_get_sortgroupref_tle = Module['_get_sortgroupref_tle'] =
      wasmExports['get_sortgroupref_tle'])(a0, a1))
  let _assignSortGroupRef = (Module['_assignSortGroupRef'] = (a0, a1) =>
    (_assignSortGroupRef = Module['_assignSortGroupRef'] =
      wasmExports['assignSortGroupRef'])(a0, a1))
  let _targetIsInSortList = (Module['_targetIsInSortList'] = (a0, a1, a2) =>
    (_targetIsInSortList = Module['_targetIsInSortList'] =
      wasmExports['targetIsInSortList'])(a0, a1, a2))
  let _contain_aggs_of_level = (Module['_contain_aggs_of_level'] = (a0, a1) =>
    (_contain_aggs_of_level = Module['_contain_aggs_of_level'] =
      wasmExports['contain_aggs_of_level'])(a0, a1))
  let _find_coercion_pathway = (Module['_find_coercion_pathway'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_find_coercion_pathway = Module['_find_coercion_pathway'] =
      wasmExports['find_coercion_pathway'])(a0, a1, a2, a3))
  let _typeidType = (Module['_typeidType'] = (a0) =>
    (_typeidType = Module['_typeidType'] = wasmExports['typeidType'])(a0))
  let _typeTypeCollation = (Module['_typeTypeCollation'] = (a0) =>
    (_typeTypeCollation = Module['_typeTypeCollation'] =
      wasmExports['typeTypeCollation'])(a0))
  let _typeLen = (Module['_typeLen'] = (a0) =>
    (_typeLen = Module['_typeLen'] = wasmExports['typeLen'])(a0))
  let _typeByVal = (Module['_typeByVal'] = (a0) =>
    (_typeByVal = Module['_typeByVal'] = wasmExports['typeByVal'])(a0))
  let _makeConst = (Module['_makeConst'] = (a0, a1, a2, a3, a4, a5, a6) =>
    (_makeConst = Module['_makeConst'] = wasmExports['makeConst'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
    ))
  let _lookup_rowtype_tupdesc = (Module['_lookup_rowtype_tupdesc'] = (a0, a1) =>
    (_lookup_rowtype_tupdesc = Module['_lookup_rowtype_tupdesc'] =
      wasmExports['lookup_rowtype_tupdesc'])(a0, a1))
  let _verify_common_type = (Module['_verify_common_type'] = (a0, a1) =>
    (_verify_common_type = Module['_verify_common_type'] =
      wasmExports['verify_common_type'])(a0, a1))
  let _bms_del_member = (Module['_bms_del_member'] = (a0, a1) =>
    (_bms_del_member = Module['_bms_del_member'] =
      wasmExports['bms_del_member'])(a0, a1))
  let _list_member = (Module['_list_member'] = (a0, a1) =>
    (_list_member = Module['_list_member'] = wasmExports['list_member'])(
      a0,
      a1,
    ))
  let _raw_expression_tree_walker_impl = (Module[
    '_raw_expression_tree_walker_impl'
  ] = (a0, a1, a2) =>
    (_raw_expression_tree_walker_impl = Module[
      '_raw_expression_tree_walker_impl'
    ] =
      wasmExports['raw_expression_tree_walker_impl'])(a0, a1, a2))
  let _type_is_rowtype = (Module['_type_is_rowtype'] = (a0) =>
    (_type_is_rowtype = Module['_type_is_rowtype'] =
      wasmExports['type_is_rowtype'])(a0))
  let _scanNSItemForColumn = (Module['_scanNSItemForColumn'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_scanNSItemForColumn = Module['_scanNSItemForColumn'] =
      wasmExports['scanNSItemForColumn'])(a0, a1, a2, a3, a4))
  let _make_op = (Module['_make_op'] = (a0, a1, a2, a3, a4, a5) =>
    (_make_op = Module['_make_op'] = wasmExports['make_op'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
    ))
  let _make_scalar_array_op = (Module['_make_scalar_array_op'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_make_scalar_array_op = Module['_make_scalar_array_op'] =
      wasmExports['make_scalar_array_op'])(a0, a1, a2, a3, a4, a5))
  let _count_nonjunk_tlist_entries = (Module['_count_nonjunk_tlist_entries'] = (
    a0,
  ) =>
    (_count_nonjunk_tlist_entries = Module['_count_nonjunk_tlist_entries'] =
      wasmExports['count_nonjunk_tlist_entries'])(a0))
  let _makeWholeRowVar = (Module['_makeWholeRowVar'] = (a0, a1, a2, a3) =>
    (_makeWholeRowVar = Module['_makeWholeRowVar'] =
      wasmExports['makeWholeRowVar'])(a0, a1, a2, a3))
  let _expandRTE = (Module['_expandRTE'] = (a0, a1, a2, a3, a4, a5, a6, a7) =>
    (_expandRTE = Module['_expandRTE'] = wasmExports['expandRTE'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
    ))
  let _bms_int_members = (Module['_bms_int_members'] = (a0, a1) =>
    (_bms_int_members = Module['_bms_int_members'] =
      wasmExports['bms_int_members'])(a0, a1))
  let _contain_var_clause = (Module['_contain_var_clause'] = (a0) =>
    (_contain_var_clause = Module['_contain_var_clause'] =
      wasmExports['contain_var_clause'])(a0))
  let _jsonb_in = (Module['_jsonb_in'] = (a0) =>
    (_jsonb_in = Module['_jsonb_in'] = wasmExports['jsonb_in'])(a0))
  let _escape_json = (Module['_escape_json'] = (a0, a1) =>
    (_escape_json = Module['_escape_json'] = wasmExports['escape_json'])(
      a0,
      a1,
    ))
  let _geterrcode = (Module['_geterrcode'] = () =>
    (_geterrcode = Module['_geterrcode'] = wasmExports['geterrcode'])())
  let _bit_in = (Module['_bit_in'] = (a0) =>
    (_bit_in = Module['_bit_in'] = wasmExports['bit_in'])(a0))
  let _repalloc0 = (Module['_repalloc0'] = (a0, a1, a2) =>
    (_repalloc0 = Module['_repalloc0'] = wasmExports['repalloc0'])(a0, a1, a2))
  let _bms_union = (Module['_bms_union'] = (a0, a1) =>
    (_bms_union = Module['_bms_union'] = wasmExports['bms_union'])(a0, a1))
  let _varstr_levenshtein_less_equal = (Module[
    '_varstr_levenshtein_less_equal'
  ] = (a0, a1, a2, a3, a4, a5, a6, a7, a8) =>
    (_varstr_levenshtein_less_equal = Module['_varstr_levenshtein_less_equal'] =
      wasmExports['varstr_levenshtein_less_equal'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
    ))
  let _raw_parser = (Module['_raw_parser'] = (a0, a1) =>
    (_raw_parser = Module['_raw_parser'] = wasmExports['raw_parser'])(a0, a1))
  let _errsave_start = (Module['_errsave_start'] = (a0, a1) =>
    (_errsave_start = Module['_errsave_start'] = wasmExports['errsave_start'])(
      a0,
      a1,
    ))
  let _errsave_finish = (Module['_errsave_finish'] = (a0, a1, a2, a3) =>
    (_errsave_finish = Module['_errsave_finish'] =
      wasmExports['errsave_finish'])(a0, a1, a2, a3))
  let _makeColumnDef = (Module['_makeColumnDef'] = (a0, a1, a2, a3) =>
    (_makeColumnDef = Module['_makeColumnDef'] = wasmExports['makeColumnDef'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _GetDefaultOpClass = (Module['_GetDefaultOpClass'] = (a0, a1) =>
    (_GetDefaultOpClass = Module['_GetDefaultOpClass'] =
      wasmExports['GetDefaultOpClass'])(a0, a1))
  let _ChooseRelationName = (Module['_ChooseRelationName'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_ChooseRelationName = Module['_ChooseRelationName'] =
      wasmExports['ChooseRelationName'])(a0, a1, a2, a3, a4))
  let _scanner_init = (Module['_scanner_init'] = (a0, a1, a2, a3) =>
    (_scanner_init = Module['_scanner_init'] = wasmExports['scanner_init'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _scanner_finish = (Module['_scanner_finish'] = (a0) =>
    (_scanner_finish = Module['_scanner_finish'] =
      wasmExports['scanner_finish'])(a0))
  let _core_yylex = (Module['_core_yylex'] = (a0, a1, a2) =>
    (_core_yylex = Module['_core_yylex'] = wasmExports['core_yylex'])(
      a0,
      a1,
      a2,
    ))
  let _isxdigit = (Module['_isxdigit'] = (a0) =>
    (_isxdigit = Module['_isxdigit'] = wasmExports['isxdigit'])(a0))
  let _scanner_isspace = (Module['_scanner_isspace'] = (a0) =>
    (_scanner_isspace = Module['_scanner_isspace'] =
      wasmExports['scanner_isspace'])(a0))
  let _truncate_identifier = (Module['_truncate_identifier'] = (a0, a1, a2) =>
    (_truncate_identifier = Module['_truncate_identifier'] =
      wasmExports['truncate_identifier'])(a0, a1, a2))
  let _ScanKeywordLookup = (Module['_ScanKeywordLookup'] = (a0, a1) =>
    (_ScanKeywordLookup = Module['_ScanKeywordLookup'] =
      wasmExports['ScanKeywordLookup'])(a0, a1))
  let _pg_verifymbstr = (Module['_pg_verifymbstr'] = (a0, a1, a2) =>
    (_pg_verifymbstr = Module['_pg_verifymbstr'] =
      wasmExports['pg_verifymbstr'])(a0, a1, a2))
  let _downcase_truncate_identifier = (Module['_downcase_truncate_identifier'] =
    (a0, a1, a2) =>
      (_downcase_truncate_identifier = Module['_downcase_truncate_identifier'] =
        wasmExports['downcase_truncate_identifier'])(a0, a1, a2))
  let _pg_database_encoding_max_length = (Module[
    '_pg_database_encoding_max_length'
  ] = () =>
    (_pg_database_encoding_max_length = Module[
      '_pg_database_encoding_max_length'
    ] =
      wasmExports['pg_database_encoding_max_length'])())
  let _getTypeInputInfo = (Module['_getTypeInputInfo'] = (a0, a1, a2) =>
    (_getTypeInputInfo = Module['_getTypeInputInfo'] =
      wasmExports['getTypeInputInfo'])(a0, a1, a2))
  let _RenameSchema = (Module['_RenameSchema'] = (a0, a1, a2) =>
    (_RenameSchema = Module['_RenameSchema'] = wasmExports['RenameSchema'])(
      a0,
      a1,
      a2,
    ))
  let _namein = (Module['_namein'] = (a0) =>
    (_namein = Module['_namein'] = wasmExports['namein'])(a0))
  let _BlockSampler_Init = (Module['_BlockSampler_Init'] = (a0, a1, a2, a3) =>
    (_BlockSampler_Init = Module['_BlockSampler_Init'] =
      wasmExports['BlockSampler_Init'])(a0, a1, a2, a3))
  let _reservoir_init_selection_state = (Module[
    '_reservoir_init_selection_state'
  ] = (a0, a1) =>
    (_reservoir_init_selection_state = Module[
      '_reservoir_init_selection_state'
    ] =
      wasmExports['reservoir_init_selection_state'])(a0, a1))
  let _reservoir_get_next_S = (Module['_reservoir_get_next_S'] = (a0, a1, a2) =>
    (_reservoir_get_next_S = Module['_reservoir_get_next_S'] =
      wasmExports['reservoir_get_next_S'])(a0, a1, a2))
  let _sampler_random_fract = (Module['_sampler_random_fract'] = (a0) =>
    (_sampler_random_fract = Module['_sampler_random_fract'] =
      wasmExports['sampler_random_fract'])(a0))
  let _std_typanalyze = (Module['_std_typanalyze'] = (a0) =>
    (_std_typanalyze = Module['_std_typanalyze'] =
      wasmExports['std_typanalyze'])(a0))
  let _BlockSampler_HasMore = (Module['_BlockSampler_HasMore'] = (a0) =>
    (_BlockSampler_HasMore = Module['_BlockSampler_HasMore'] =
      wasmExports['BlockSampler_HasMore'])(a0))
  let _BlockSampler_Next = (Module['_BlockSampler_Next'] = (a0) =>
    (_BlockSampler_Next = Module['_BlockSampler_Next'] =
      wasmExports['BlockSampler_Next'])(a0))
  let _Async_Notify = (Module['_Async_Notify'] = (a0, a1) =>
    (_Async_Notify = Module['_Async_Notify'] = wasmExports['Async_Notify'])(
      a0,
      a1,
    ))
  let _RangeVarCallbackMaintainsTable = (Module[
    '_RangeVarCallbackMaintainsTable'
  ] = (a0, a1, a2, a3) =>
    (_RangeVarCallbackMaintainsTable = Module[
      '_RangeVarCallbackMaintainsTable'
    ] =
      wasmExports['RangeVarCallbackMaintainsTable'])(a0, a1, a2, a3))
  let _make_new_heap = (Module['_make_new_heap'] = (a0, a1, a2, a3, a4) =>
    (_make_new_heap = Module['_make_new_heap'] = wasmExports['make_new_heap'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _finish_heap_swap = (Module['_finish_heap_swap'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
  ) =>
    (_finish_heap_swap = Module['_finish_heap_swap'] =
      wasmExports['finish_heap_swap'])(a0, a1, a2, a3, a4, a5, a6, a7, a8))
  let _OpenPipeStream = (Module['_OpenPipeStream'] = (a0, a1) =>
    (_OpenPipeStream = Module['_OpenPipeStream'] =
      wasmExports['OpenPipeStream'])(a0, a1))
  let _pg_is_ascii = (Module['_pg_is_ascii'] = (a0) =>
    (_pg_is_ascii = Module['_pg_is_ascii'] = wasmExports['pg_is_ascii'])(a0))
  let _ClosePipeStream = (Module['_ClosePipeStream'] = (a0) =>
    (_ClosePipeStream = Module['_ClosePipeStream'] =
      wasmExports['ClosePipeStream'])(a0))
  let _BeginCopyFrom = (Module['_BeginCopyFrom'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_BeginCopyFrom = Module['_BeginCopyFrom'] = wasmExports['BeginCopyFrom'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
    ))
  let _EndCopyFrom = (Module['_EndCopyFrom'] = (a0) =>
    (_EndCopyFrom = Module['_EndCopyFrom'] = wasmExports['EndCopyFrom'])(a0))
  let _ProcessCopyOptions = (Module['_ProcessCopyOptions'] = (a0, a1, a2, a3) =>
    (_ProcessCopyOptions = Module['_ProcessCopyOptions'] =
      wasmExports['ProcessCopyOptions'])(a0, a1, a2, a3))
  let _pg_strtoint64 = (Module['_pg_strtoint64'] = (a0) =>
    (_pg_strtoint64 = Module['_pg_strtoint64'] = wasmExports['pg_strtoint64'])(
      a0,
    ))
  let _CopyFromErrorCallback = (Module['_CopyFromErrorCallback'] = (a0) =>
    (_CopyFromErrorCallback = Module['_CopyFromErrorCallback'] =
      wasmExports['CopyFromErrorCallback'])(a0))
  let _bms_make_singleton = (Module['_bms_make_singleton'] = (a0) =>
    (_bms_make_singleton = Module['_bms_make_singleton'] =
      wasmExports['bms_make_singleton'])(a0))
  let _ExecInitRangeTable = (Module['_ExecInitRangeTable'] = (a0, a1, a2, a3) =>
    (_ExecInitRangeTable = Module['_ExecInitRangeTable'] =
      wasmExports['ExecInitRangeTable'])(a0, a1, a2, a3))
  let _ExecInitResultRelation = (Module['_ExecInitResultRelation'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ExecInitResultRelation = Module['_ExecInitResultRelation'] =
      wasmExports['ExecInitResultRelation'])(a0, a1, a2))
  let _ExecInitQual = (Module['_ExecInitQual'] = (a0, a1) =>
    (_ExecInitQual = Module['_ExecInitQual'] = wasmExports['ExecInitQual'])(
      a0,
      a1,
    ))
  let _NextCopyFrom = (Module['_NextCopyFrom'] = (a0, a1, a2, a3) =>
    (_NextCopyFrom = Module['_NextCopyFrom'] = wasmExports['NextCopyFrom'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _ExecCloseResultRelations = (Module['_ExecCloseResultRelations'] = (a0) =>
    (_ExecCloseResultRelations = Module['_ExecCloseResultRelations'] =
      wasmExports['ExecCloseResultRelations'])(a0))
  let _ExecCloseRangeTableRelations = (Module['_ExecCloseRangeTableRelations'] =
    (a0) =>
      (_ExecCloseRangeTableRelations = Module['_ExecCloseRangeTableRelations'] =
        wasmExports['ExecCloseRangeTableRelations'])(a0))
  let _ExecConstraints = (Module['_ExecConstraints'] = (a0, a1, a2) =>
    (_ExecConstraints = Module['_ExecConstraints'] =
      wasmExports['ExecConstraints'])(a0, a1, a2))
  let _ExecInsertIndexTuples = (Module['_ExecInsertIndexTuples'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_ExecInsertIndexTuples = Module['_ExecInsertIndexTuples'] =
      wasmExports['ExecInsertIndexTuples'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _build_column_default = (Module['_build_column_default'] = (a0, a1) =>
    (_build_column_default = Module['_build_column_default'] =
      wasmExports['build_column_default'])(a0, a1))
  let _ExecInitExpr = (Module['_ExecInitExpr'] = (a0, a1) =>
    (_ExecInitExpr = Module['_ExecInitExpr'] = wasmExports['ExecInitExpr'])(
      a0,
      a1,
    ))
  let _fileno = (Module['_fileno'] = (a0) =>
    (_fileno = Module['_fileno'] = wasmExports['fileno'])(a0))
  let _NextCopyFromRawFields = (Module['_NextCopyFromRawFields'] = (
    a0,
    a1,
    a2,
  ) =>
    (_NextCopyFromRawFields = Module['_NextCopyFromRawFields'] =
      wasmExports['NextCopyFromRawFields'])(a0, a1, a2))
  let _resetStringInfo = (Module['_resetStringInfo'] = (a0) =>
    (_resetStringInfo = Module['_resetStringInfo'] =
      wasmExports['resetStringInfo'])(a0))
  let _pq_copymsgbytes = (Module['_pq_copymsgbytes'] = (a0, a1, a2) =>
    (_pq_copymsgbytes = Module['_pq_copymsgbytes'] =
      wasmExports['pq_copymsgbytes'])(a0, a1, a2))
  let _pg_encoding_max_length = (Module['_pg_encoding_max_length'] = (a0) =>
    (_pg_encoding_max_length = Module['_pg_encoding_max_length'] =
      wasmExports['pg_encoding_max_length'])(a0))
  let _tolower = (Module['_tolower'] = (a0) =>
    (_tolower = Module['_tolower'] = wasmExports['tolower'])(a0))
  let _pg_plan_query = (Module['_pg_plan_query'] = (a0, a1, a2, a3) =>
    (_pg_plan_query = Module['_pg_plan_query'] = wasmExports['pg_plan_query'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _PushCopiedSnapshot = (Module['_PushCopiedSnapshot'] = (a0) =>
    (_PushCopiedSnapshot = Module['_PushCopiedSnapshot'] =
      wasmExports['PushCopiedSnapshot'])(a0))
  let _UpdateActiveSnapshotCommandId = (Module[
    '_UpdateActiveSnapshotCommandId'
  ] = () =>
    (_UpdateActiveSnapshotCommandId = Module['_UpdateActiveSnapshotCommandId'] =
      wasmExports['UpdateActiveSnapshotCommandId'])())
  let _CreateQueryDesc = (Module['_CreateQueryDesc'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_CreateQueryDesc = Module['_CreateQueryDesc'] =
      wasmExports['CreateQueryDesc'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _ExecutorStart = (Module['_ExecutorStart'] = (a0, a1) =>
    (_ExecutorStart = Module['_ExecutorStart'] = wasmExports['ExecutorStart'])(
      a0,
      a1,
    ))
  let _ExecutorFinish = (Module['_ExecutorFinish'] = (a0) =>
    (_ExecutorFinish = Module['_ExecutorFinish'] =
      wasmExports['ExecutorFinish'])(a0))
  let _ExecutorEnd = (Module['_ExecutorEnd'] = (a0) =>
    (_ExecutorEnd = Module['_ExecutorEnd'] = wasmExports['ExecutorEnd'])(a0))
  let _FreeQueryDesc = (Module['_FreeQueryDesc'] = (a0) =>
    (_FreeQueryDesc = Module['_FreeQueryDesc'] = wasmExports['FreeQueryDesc'])(
      a0,
    ))
  let _ExecutorRun = (Module['_ExecutorRun'] = (a0, a1, a2) =>
    (_ExecutorRun = Module['_ExecutorRun'] = wasmExports['ExecutorRun'])(
      a0,
      a1,
      a2,
    ))
  let _pg_server_to_any = (Module['_pg_server_to_any'] = (a0, a1, a2) =>
    (_pg_server_to_any = Module['_pg_server_to_any'] =
      wasmExports['pg_server_to_any'])(a0, a1, a2))
  let _fwrite = (Module['_fwrite'] = (a0, a1, a2, a3) =>
    (_fwrite = Module['_fwrite'] = wasmExports['fwrite'])(a0, a1, a2, a3))
  let _CreateTableAsRelExists = (Module['_CreateTableAsRelExists'] = (a0) =>
    (_CreateTableAsRelExists = Module['_CreateTableAsRelExists'] =
      wasmExports['CreateTableAsRelExists'])(a0))
  let _QueryRewrite = (Module['_QueryRewrite'] = (a0) =>
    (_QueryRewrite = Module['_QueryRewrite'] = wasmExports['QueryRewrite'])(a0))
  let _DefineRelation = (Module['_DefineRelation'] = (a0, a1, a2, a3, a4, a5) =>
    (_DefineRelation = Module['_DefineRelation'] =
      wasmExports['DefineRelation'])(a0, a1, a2, a3, a4, a5))
  let _rmdir = (Module['_rmdir'] = (a0) =>
    (_rmdir = Module['_rmdir'] = wasmExports['rmdir'])(a0))
  let _atof = (Module['_atof'] = (a0) =>
    (_atof = Module['_atof'] = wasmExports['atof'])(a0))
  let _int8in = (Module['_int8in'] = (a0) =>
    (_int8in = Module['_int8in'] = wasmExports['int8in'])(a0))
  let _oidin = (Module['_oidin'] = (a0) =>
    (_oidin = Module['_oidin'] = wasmExports['oidin'])(a0))
  let _RemoveObjects = (Module['_RemoveObjects'] = (a0) =>
    (_RemoveObjects = Module['_RemoveObjects'] = wasmExports['RemoveObjects'])(
      a0,
    ))
  let _GetCommandTagName = (Module['_GetCommandTagName'] = (a0) =>
    (_GetCommandTagName = Module['_GetCommandTagName'] =
      wasmExports['GetCommandTagName'])(a0))
  let _NewExplainState = (Module['_NewExplainState'] = () =>
    (_NewExplainState = Module['_NewExplainState'] =
      wasmExports['NewExplainState'])())
  let _ExplainBeginOutput = (Module['_ExplainBeginOutput'] = (a0) =>
    (_ExplainBeginOutput = Module['_ExplainBeginOutput'] =
      wasmExports['ExplainBeginOutput'])(a0))
  let _ExplainEndOutput = (Module['_ExplainEndOutput'] = (a0) =>
    (_ExplainEndOutput = Module['_ExplainEndOutput'] =
      wasmExports['ExplainEndOutput'])(a0))
  let _ExplainOpenGroup = (Module['_ExplainOpenGroup'] = (a0, a1, a2, a3) =>
    (_ExplainOpenGroup = Module['_ExplainOpenGroup'] =
      wasmExports['ExplainOpenGroup'])(a0, a1, a2, a3))
  let _ExplainPrintPlan = (Module['_ExplainPrintPlan'] = (a0, a1) =>
    (_ExplainPrintPlan = Module['_ExplainPrintPlan'] =
      wasmExports['ExplainPrintPlan'])(a0, a1))
  let _ExplainIndentText = (Module['_ExplainIndentText'] = (a0) =>
    (_ExplainIndentText = Module['_ExplainIndentText'] =
      wasmExports['ExplainIndentText'])(a0))
  let _ExplainPropertyInteger = (Module['_ExplainPropertyInteger'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_ExplainPropertyInteger = Module['_ExplainPropertyInteger'] =
      wasmExports['ExplainPropertyInteger'])(a0, a1, a2, a3))
  let _ExplainCloseGroup = (Module['_ExplainCloseGroup'] = (a0, a1, a2, a3) =>
    (_ExplainCloseGroup = Module['_ExplainCloseGroup'] =
      wasmExports['ExplainCloseGroup'])(a0, a1, a2, a3))
  let _ExplainPropertyFloat = (Module['_ExplainPropertyFloat'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_ExplainPropertyFloat = Module['_ExplainPropertyFloat'] =
      wasmExports['ExplainPropertyFloat'])(a0, a1, a2, a3, a4))
  let _ExplainPrintTriggers = (Module['_ExplainPrintTriggers'] = (a0, a1) =>
    (_ExplainPrintTriggers = Module['_ExplainPrintTriggers'] =
      wasmExports['ExplainPrintTriggers'])(a0, a1))
  let _ExplainPropertyUInteger = (Module['_ExplainPropertyUInteger'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_ExplainPropertyUInteger = Module['_ExplainPropertyUInteger'] =
      wasmExports['ExplainPropertyUInteger'])(a0, a1, a2, a3))
  let _ExplainPropertyText = (Module['_ExplainPropertyText'] = (a0, a1, a2) =>
    (_ExplainPropertyText = Module['_ExplainPropertyText'] =
      wasmExports['ExplainPropertyText'])(a0, a1, a2))
  let _GetConfigOptionByName = (Module['_GetConfigOptionByName'] = (
    a0,
    a1,
    a2,
  ) =>
    (_GetConfigOptionByName = Module['_GetConfigOptionByName'] =
      wasmExports['GetConfigOptionByName'])(a0, a1, a2))
  let _ExplainPrintJITSummary = (Module['_ExplainPrintJITSummary'] = (a0, a1) =>
    (_ExplainPrintJITSummary = Module['_ExplainPrintJITSummary'] =
      wasmExports['ExplainPrintJITSummary'])(a0, a1))
  let _ExplainPropertyBool = (Module['_ExplainPropertyBool'] = (a0, a1, a2) =>
    (_ExplainPropertyBool = Module['_ExplainPropertyBool'] =
      wasmExports['ExplainPropertyBool'])(a0, a1, a2))
  let _InstrEndLoop = (Module['_InstrEndLoop'] = (a0) =>
    (_InstrEndLoop = Module['_InstrEndLoop'] = wasmExports['InstrEndLoop'])(a0))
  let _appendStringInfoSpaces = (Module['_appendStringInfoSpaces'] = (a0, a1) =>
    (_appendStringInfoSpaces = Module['_appendStringInfoSpaces'] =
      wasmExports['appendStringInfoSpaces'])(a0, a1))
  let _ExplainQueryText = (Module['_ExplainQueryText'] = (a0, a1) =>
    (_ExplainQueryText = Module['_ExplainQueryText'] =
      wasmExports['ExplainQueryText'])(a0, a1))
  let _ExplainQueryParameters = (Module['_ExplainQueryParameters'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ExplainQueryParameters = Module['_ExplainQueryParameters'] =
      wasmExports['ExplainQueryParameters'])(a0, a1, a2))
  let _get_func_namespace = (Module['_get_func_namespace'] = (a0) =>
    (_get_func_namespace = Module['_get_func_namespace'] =
      wasmExports['get_func_namespace'])(a0))
  let _GetExplainExtensionId = (Module['_GetExplainExtensionId'] = (a0) =>
    (_GetExplainExtensionId = Module['_GetExplainExtensionId'] =
      wasmExports['GetExplainExtensionId'])(a0))
  let _GetExplainExtensionState = (Module['_GetExplainExtensionState'] = (
    a0,
    a1,
  ) =>
    (_GetExplainExtensionState = Module['_GetExplainExtensionState'] =
      wasmExports['GetExplainExtensionState'])(a0, a1))
  let _SetExplainExtensionState = (Module['_SetExplainExtensionState'] = (
    a0,
    a1,
    a2,
  ) =>
    (_SetExplainExtensionState = Module['_SetExplainExtensionState'] =
      wasmExports['SetExplainExtensionState'])(a0, a1, a2))
  let _RegisterExtensionExplainOption = (Module[
    '_RegisterExtensionExplainOption'
  ] = (a0, a1) =>
    (_RegisterExtensionExplainOption = Module[
      '_RegisterExtensionExplainOption'
    ] =
      wasmExports['RegisterExtensionExplainOption'])(a0, a1))
  let _get_function_sibling_type = (Module['_get_function_sibling_type'] = (
    a0,
    a1,
  ) =>
    (_get_function_sibling_type = Module['_get_function_sibling_type'] =
      wasmExports['get_function_sibling_type'])(a0, a1))
  let _GetSysCacheHashValue = (Module['_GetSysCacheHashValue'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_GetSysCacheHashValue = Module['_GetSysCacheHashValue'] =
      wasmExports['GetSysCacheHashValue'])(a0, a1, a2, a3, a4))
  let _CreateSchemaCommand = (Module['_CreateSchemaCommand'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_CreateSchemaCommand = Module['_CreateSchemaCommand'] =
      wasmExports['CreateSchemaCommand'])(a0, a1, a2, a3))
  let _get_rel_type_id = (Module['_get_rel_type_id'] = (a0) =>
    (_get_rel_type_id = Module['_get_rel_type_id'] =
      wasmExports['get_rel_type_id'])(a0))
  let _set_config_option = (Module['_set_config_option'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_set_config_option = Module['_set_config_option'] =
      wasmExports['set_config_option'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _pg_any_to_server = (Module['_pg_any_to_server'] = (a0, a1, a2) =>
    (_pg_any_to_server = Module['_pg_any_to_server'] =
      wasmExports['pg_any_to_server'])(a0, a1, a2))
  let _DirectFunctionCall4Coll = (Module['_DirectFunctionCall4Coll'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_DirectFunctionCall4Coll = Module['_DirectFunctionCall4Coll'] =
      wasmExports['DirectFunctionCall4Coll'])(a0, a1, a2, a3, a4, a5))
  let _replace_text = (Module['_replace_text'] = (a0) =>
    (_replace_text = Module['_replace_text'] = wasmExports['replace_text'])(a0))
  let _ProcessUtility = (Module['_ProcessUtility'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_ProcessUtility = Module['_ProcessUtility'] =
      wasmExports['ProcessUtility'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _CleanQuerytext = (Module['_CleanQuerytext'] = (a0, a1, a2) =>
    (_CleanQuerytext = Module['_CleanQuerytext'] =
      wasmExports['CleanQuerytext'])(a0, a1, a2))
  let _list_delete_cell = (Module['_list_delete_cell'] = (a0, a1) =>
    (_list_delete_cell = Module['_list_delete_cell'] =
      wasmExports['list_delete_cell'])(a0, a1))
  let _GetForeignDataWrapper = (Module['_GetForeignDataWrapper'] = (a0) =>
    (_GetForeignDataWrapper = Module['_GetForeignDataWrapper'] =
      wasmExports['GetForeignDataWrapper'])(a0))
  let _CreateExprContext = (Module['_CreateExprContext'] = (a0) =>
    (_CreateExprContext = Module['_CreateExprContext'] =
      wasmExports['CreateExprContext'])(a0))
  let _EnsurePortalSnapshotExists = (Module['_EnsurePortalSnapshotExists'] =
    () =>
      (_EnsurePortalSnapshotExists = Module['_EnsurePortalSnapshotExists'] =
        wasmExports['EnsurePortalSnapshotExists'])())
  let _CheckIndexCompatible = (Module['_CheckIndexCompatible'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_CheckIndexCompatible = Module['_CheckIndexCompatible'] =
      wasmExports['CheckIndexCompatible'])(a0, a1, a2, a3, a4))
  let _get_opfamily_member_for_cmptype = (Module[
    '_get_opfamily_member_for_cmptype'
  ] = (a0, a1, a2, a3) =>
    (_get_opfamily_member_for_cmptype = Module[
      '_get_opfamily_member_for_cmptype'
    ] =
      wasmExports['get_opfamily_member_for_cmptype'])(a0, a1, a2, a3))
  let _pgstat_count_truncate = (Module['_pgstat_count_truncate'] = (a0) =>
    (_pgstat_count_truncate = Module['_pgstat_count_truncate'] =
      wasmExports['pgstat_count_truncate'])(a0))
  let _SPI_connect = (Module['_SPI_connect'] = () =>
    (_SPI_connect = Module['_SPI_connect'] = wasmExports['SPI_connect'])())
  let _SPI_exec = (Module['_SPI_exec'] = (a0, a1) =>
    (_SPI_exec = Module['_SPI_exec'] = wasmExports['SPI_exec'])(a0, a1))
  let _SPI_execute = (Module['_SPI_execute'] = (a0, a1, a2) =>
    (_SPI_execute = Module['_SPI_execute'] = wasmExports['SPI_execute'])(
      a0,
      a1,
      a2,
    ))
  let _SPI_getvalue = (Module['_SPI_getvalue'] = (a0, a1, a2) =>
    (_SPI_getvalue = Module['_SPI_getvalue'] = wasmExports['SPI_getvalue'])(
      a0,
      a1,
      a2,
    ))
  let _generate_operator_clause = (Module['_generate_operator_clause'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_generate_operator_clause = Module['_generate_operator_clause'] =
      wasmExports['generate_operator_clause'])(a0, a1, a2, a3, a4, a5))
  let _SPI_finish = (Module['_SPI_finish'] = () =>
    (_SPI_finish = Module['_SPI_finish'] = wasmExports['SPI_finish'])())
  let _CreateTransientRelDestReceiver = (Module[
    '_CreateTransientRelDestReceiver'
  ] = (a0) =>
    (_CreateTransientRelDestReceiver = Module[
      '_CreateTransientRelDestReceiver'
    ] =
      wasmExports['CreateTransientRelDestReceiver'])(a0))
  let _MemoryContextSetIdentifier = (Module['_MemoryContextSetIdentifier'] = (
    a0,
    a1,
  ) =>
    (_MemoryContextSetIdentifier = Module['_MemoryContextSetIdentifier'] =
      wasmExports['MemoryContextSetIdentifier'])(a0, a1))
  let _checkExprHasSubLink = (Module['_checkExprHasSubLink'] = (a0) =>
    (_checkExprHasSubLink = Module['_checkExprHasSubLink'] =
      wasmExports['checkExprHasSubLink'])(a0))
  let _MemoryContextSetParent = (Module['_MemoryContextSetParent'] = (a0, a1) =>
    (_MemoryContextSetParent = Module['_MemoryContextSetParent'] =
      wasmExports['MemoryContextSetParent'])(a0, a1))
  let _SetTuplestoreDestReceiverParams = (Module[
    '_SetTuplestoreDestReceiverParams'
  ] = (a0, a1, a2, a3, a4, a5) =>
    (_SetTuplestoreDestReceiverParams = Module[
      '_SetTuplestoreDestReceiverParams'
    ] =
      wasmExports['SetTuplestoreDestReceiverParams'])(a0, a1, a2, a3, a4, a5))
  let _tuplestore_rescan = (Module['_tuplestore_rescan'] = (a0) =>
    (_tuplestore_rescan = Module['_tuplestore_rescan'] =
      wasmExports['tuplestore_rescan'])(a0))
  let _MemoryContextDeleteChildren = (Module['_MemoryContextDeleteChildren'] = (
    a0,
  ) =>
    (_MemoryContextDeleteChildren = Module['_MemoryContextDeleteChildren'] =
      wasmExports['MemoryContextDeleteChildren'])(a0))
  let _makeParamList = (Module['_makeParamList'] = (a0) =>
    (_makeParamList = Module['_makeParamList'] = wasmExports['makeParamList'])(
      a0,
    ))
  let _ReleaseCachedPlan = (Module['_ReleaseCachedPlan'] = (a0, a1) =>
    (_ReleaseCachedPlan = Module['_ReleaseCachedPlan'] =
      wasmExports['ReleaseCachedPlan'])(a0, a1))
  let _bms_equal = (Module['_bms_equal'] = (a0, a1) =>
    (_bms_equal = Module['_bms_equal'] = wasmExports['bms_equal'])(a0, a1))
  let _func_volatile = (Module['_func_volatile'] = (a0) =>
    (_func_volatile = Module['_func_volatile'] = wasmExports['func_volatile'])(
      a0,
    ))
  let _register_label_provider = (Module['_register_label_provider'] = (
    a0,
    a1,
  ) =>
    (_register_label_provider = Module['_register_label_provider'] =
      wasmExports['register_label_provider'])(a0, a1))
  let _DefineSequence = (Module['_DefineSequence'] = (a0, a1, a2) =>
    (_DefineSequence = Module['_DefineSequence'] =
      wasmExports['DefineSequence'])(a0, a1, a2))
  let _AlterSequence = (Module['_AlterSequence'] = (a0, a1, a2) =>
    (_AlterSequence = Module['_AlterSequence'] = wasmExports['AlterSequence'])(
      a0,
      a1,
      a2,
    ))
  let _nextval = (Module['_nextval'] = (a0) =>
    (_nextval = Module['_nextval'] = wasmExports['nextval'])(a0))
  let _textToQualifiedNameList = (Module['_textToQualifiedNameList'] = (a0) =>
    (_textToQualifiedNameList = Module['_textToQualifiedNameList'] =
      wasmExports['textToQualifiedNameList'])(a0))
  let _nextval_internal = (Module['_nextval_internal'] = (a0, a1) =>
    (_nextval_internal = Module['_nextval_internal'] =
      wasmExports['nextval_internal'])(a0, a1))
  let _setval_oid = (Module['_setval_oid'] = (a0) =>
    (_setval_oid = Module['_setval_oid'] = wasmExports['setval_oid'])(a0))
  let _tuplestore_gettupleslot = (Module['_tuplestore_gettupleslot'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_tuplestore_gettupleslot = Module['_tuplestore_gettupleslot'] =
      wasmExports['tuplestore_gettupleslot'])(a0, a1, a2, a3))
  let _list_delete = (Module['_list_delete'] = (a0, a1) =>
    (_list_delete = Module['_list_delete'] = wasmExports['list_delete'])(
      a0,
      a1,
    ))
  let _tuplestore_end = (Module['_tuplestore_end'] = (a0) =>
    (_tuplestore_end = Module['_tuplestore_end'] =
      wasmExports['tuplestore_end'])(a0))
  let _list_append_unique = (Module['_list_append_unique'] = (a0, a1) =>
    (_list_append_unique = Module['_list_append_unique'] =
      wasmExports['list_append_unique'])(a0, a1))
  let _contain_mutable_functions = (Module['_contain_mutable_functions'] = (
    a0,
  ) =>
    (_contain_mutable_functions = Module['_contain_mutable_functions'] =
      wasmExports['contain_mutable_functions'])(a0))
  let _RemoveRelations = (Module['_RemoveRelations'] = (a0) =>
    (_RemoveRelations = Module['_RemoveRelations'] =
      wasmExports['RemoveRelations'])(a0))
  let _ExecuteTruncateGuts = (Module['_ExecuteTruncateGuts'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_ExecuteTruncateGuts = Module['_ExecuteTruncateGuts'] =
      wasmExports['ExecuteTruncateGuts'])(a0, a1, a2, a3, a4, a5))
  let _InitResultRelInfo = (Module['_InitResultRelInfo'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_InitResultRelInfo = Module['_InitResultRelInfo'] =
      wasmExports['InitResultRelInfo'])(a0, a1, a2, a3, a4))
  let _AlterTable = (Module['_AlterTable'] = (a0, a1, a2) =>
    (_AlterTable = Module['_AlterTable'] = wasmExports['AlterTable'])(
      a0,
      a1,
      a2,
    ))
  let _ExecStoreAllNullTuple = (Module['_ExecStoreAllNullTuple'] = (a0) =>
    (_ExecStoreAllNullTuple = Module['_ExecStoreAllNullTuple'] =
      wasmExports['ExecStoreAllNullTuple'])(a0))
  let _ChangeVarNodes = (Module['_ChangeVarNodes'] = (a0, a1, a2, a3) =>
    (_ChangeVarNodes = Module['_ChangeVarNodes'] =
      wasmExports['ChangeVarNodes'])(a0, a1, a2, a3))
  let _tuplestore_begin_heap = (Module['_tuplestore_begin_heap'] = (
    a0,
    a1,
    a2,
  ) =>
    (_tuplestore_begin_heap = Module['_tuplestore_begin_heap'] =
      wasmExports['tuplestore_begin_heap'])(a0, a1, a2))
  let _tuplestore_puttupleslot = (Module['_tuplestore_puttupleslot'] = (
    a0,
    a1,
  ) =>
    (_tuplestore_puttupleslot = Module['_tuplestore_puttupleslot'] =
      wasmExports['tuplestore_puttupleslot'])(a0, a1))
  let _ExecForceStoreHeapTuple = (Module['_ExecForceStoreHeapTuple'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ExecForceStoreHeapTuple = Module['_ExecForceStoreHeapTuple'] =
      wasmExports['ExecForceStoreHeapTuple'])(a0, a1, a2))
  let _ExecUpdateLockMode = (Module['_ExecUpdateLockMode'] = (a0, a1) =>
    (_ExecUpdateLockMode = Module['_ExecUpdateLockMode'] =
      wasmExports['ExecUpdateLockMode'])(a0, a1))
  let _bms_copy = (Module['_bms_copy'] = (a0) =>
    (_bms_copy = Module['_bms_copy'] = wasmExports['bms_copy'])(a0))
  let _strtoint = (Module['_strtoint'] = (a0, a1, a2) =>
    (_strtoint = Module['_strtoint'] = wasmExports['strtoint'])(a0, a1, a2))
  let _strtod = (Module['_strtod'] = (a0, a1) =>
    (_strtod = Module['_strtod'] = wasmExports['strtod'])(a0, a1))
  let _plain_crypt_verify = (Module['_plain_crypt_verify'] = (a0, a1, a2, a3) =>
    (_plain_crypt_verify = Module['_plain_crypt_verify'] =
      wasmExports['plain_crypt_verify'])(a0, a1, a2, a3))
  let _ProcessConfigFile = (Module['_ProcessConfigFile'] = (a0) =>
    (_ProcessConfigFile = Module['_ProcessConfigFile'] =
      wasmExports['ProcessConfigFile'])(a0))
  let _pgl_exit = (Module['_pgl_exit'] = (a0) =>
    (_pgl_exit = Module['_pgl_exit'] = wasmExports['pgl_exit'])(a0))
  let _dsa_get_handle = (Module['_dsa_get_handle'] = (a0) =>
    (_dsa_get_handle = Module['_dsa_get_handle'] =
      wasmExports['dsa_get_handle'])(a0))
  let _pg_strncasecmp = (Module['_pg_strncasecmp'] = (a0, a1, a2) =>
    (_pg_strncasecmp = Module['_pg_strncasecmp'] =
      wasmExports['pg_strncasecmp'])(a0, a1, a2))
  let _ExecReScan = (Module['_ExecReScan'] = (a0) =>
    (_ExecReScan = Module['_ExecReScan'] = wasmExports['ExecReScan'])(a0))
  let _ExecAsyncResponse = (Module['_ExecAsyncResponse'] = (a0) =>
    (_ExecAsyncResponse = Module['_ExecAsyncResponse'] =
      wasmExports['ExecAsyncResponse'])(a0))
  let _ExecAsyncRequestDone = (Module['_ExecAsyncRequestDone'] = (a0, a1) =>
    (_ExecAsyncRequestDone = Module['_ExecAsyncRequestDone'] =
      wasmExports['ExecAsyncRequestDone'])(a0, a1))
  let _ExecAsyncRequestPending = (Module['_ExecAsyncRequestPending'] = (a0) =>
    (_ExecAsyncRequestPending = Module['_ExecAsyncRequestPending'] =
      wasmExports['ExecAsyncRequestPending'])(a0))
  let _ExprEvalPushStep = (Module['_ExprEvalPushStep'] = (a0, a1) =>
    (_ExprEvalPushStep = Module['_ExprEvalPushStep'] =
      wasmExports['ExprEvalPushStep'])(a0, a1))
  let _ExecInitExprWithParams = (Module['_ExecInitExprWithParams'] = (a0, a1) =>
    (_ExecInitExprWithParams = Module['_ExecInitExprWithParams'] =
      wasmExports['ExecInitExprWithParams'])(a0, a1))
  let _ExecInitExprList = (Module['_ExecInitExprList'] = (a0, a1) =>
    (_ExecInitExprList = Module['_ExecInitExprList'] =
      wasmExports['ExecInitExprList'])(a0, a1))
  let _ExecGetResultType = (Module['_ExecGetResultType'] = (a0) =>
    (_ExecGetResultType = Module['_ExecGetResultType'] =
      wasmExports['ExecGetResultType'])(a0))
  let _ExecInitExtraTupleSlot = (Module['_ExecInitExtraTupleSlot'] = (
    a0,
    a1,
    a2,
  ) =>
    (_ExecInitExtraTupleSlot = Module['_ExecInitExtraTupleSlot'] =
      wasmExports['ExecInitExtraTupleSlot'])(a0, a1, a2))
  let _MakeExpandedObjectReadOnlyInternal = (Module[
    '_MakeExpandedObjectReadOnlyInternal'
  ] = (a0) =>
    (_MakeExpandedObjectReadOnlyInternal = Module[
      '_MakeExpandedObjectReadOnlyInternal'
    ] =
      wasmExports['MakeExpandedObjectReadOnlyInternal'])(a0))
  let _tuplesort_puttupleslot = (Module['_tuplesort_puttupleslot'] = (a0, a1) =>
    (_tuplesort_puttupleslot = Module['_tuplesort_puttupleslot'] =
      wasmExports['tuplesort_puttupleslot'])(a0, a1))
  let _ArrayGetNItems = (Module['_ArrayGetNItems'] = (a0, a1) =>
    (_ArrayGetNItems = Module['_ArrayGetNItems'] =
      wasmExports['ArrayGetNItems'])(a0, a1))
  let _expanded_record_fetch_tupdesc = (Module[
    '_expanded_record_fetch_tupdesc'
  ] = (a0) =>
    (_expanded_record_fetch_tupdesc = Module['_expanded_record_fetch_tupdesc'] =
      wasmExports['expanded_record_fetch_tupdesc'])(a0))
  let _expanded_record_fetch_field = (Module['_expanded_record_fetch_field'] = (
    a0,
    a1,
    a2,
  ) =>
    (_expanded_record_fetch_field = Module['_expanded_record_fetch_field'] =
      wasmExports['expanded_record_fetch_field'])(a0, a1, a2))
  let _json_validate = (Module['_json_validate'] = (a0, a1, a2) =>
    (_json_validate = Module['_json_validate'] = wasmExports['json_validate'])(
      a0,
      a1,
      a2,
    ))
  let _JsonbValueToJsonb = (Module['_JsonbValueToJsonb'] = (a0) =>
    (_JsonbValueToJsonb = Module['_JsonbValueToJsonb'] =
      wasmExports['JsonbValueToJsonb'])(a0))
  let _numeric_out = (Module['_numeric_out'] = (a0) =>
    (_numeric_out = Module['_numeric_out'] = wasmExports['numeric_out'])(a0))
  let _boolout = (Module['_boolout'] = (a0) =>
    (_boolout = Module['_boolout'] = wasmExports['boolout'])(a0))
  let _bool_int4 = (Module['_bool_int4'] = (a0) =>
    (_bool_int4 = Module['_bool_int4'] = wasmExports['bool_int4'])(a0))
  let _lookup_rowtype_tupdesc_domain = (Module[
    '_lookup_rowtype_tupdesc_domain'
  ] = (a0, a1, a2) =>
    (_lookup_rowtype_tupdesc_domain = Module['_lookup_rowtype_tupdesc_domain'] =
      wasmExports['lookup_rowtype_tupdesc_domain'])(a0, a1, a2))
  let _MemoryContextGetParent = (Module['_MemoryContextGetParent'] = (a0) =>
    (_MemoryContextGetParent = Module['_MemoryContextGetParent'] =
      wasmExports['MemoryContextGetParent'])(a0))
  let _DeleteExpandedObject = (Module['_DeleteExpandedObject'] = (a0) =>
    (_DeleteExpandedObject = Module['_DeleteExpandedObject'] =
      wasmExports['DeleteExpandedObject'])(a0))
  let _ExecFindJunkAttributeInTlist = (Module['_ExecFindJunkAttributeInTlist'] =
    (a0, a1) =>
      (_ExecFindJunkAttributeInTlist = Module['_ExecFindJunkAttributeInTlist'] =
        wasmExports['ExecFindJunkAttributeInTlist'])(a0, a1))
  let _standard_ExecutorStart = (Module['_standard_ExecutorStart'] = (a0, a1) =>
    (_standard_ExecutorStart = Module['_standard_ExecutorStart'] =
      wasmExports['standard_ExecutorStart'])(a0, a1))
  let _ExecInitNode = (Module['_ExecInitNode'] = (a0, a1, a2) =>
    (_ExecInitNode = Module['_ExecInitNode'] = wasmExports['ExecInitNode'])(
      a0,
      a1,
      a2,
    ))
  let _standard_ExecutorRun = (Module['_standard_ExecutorRun'] = (a0, a1, a2) =>
    (_standard_ExecutorRun = Module['_standard_ExecutorRun'] =
      wasmExports['standard_ExecutorRun'])(a0, a1, a2))
  let _standard_ExecutorFinish = (Module['_standard_ExecutorFinish'] = (a0) =>
    (_standard_ExecutorFinish = Module['_standard_ExecutorFinish'] =
      wasmExports['standard_ExecutorFinish'])(a0))
  let _standard_ExecutorEnd = (Module['_standard_ExecutorEnd'] = (a0) =>
    (_standard_ExecutorEnd = Module['_standard_ExecutorEnd'] =
      wasmExports['standard_ExecutorEnd'])(a0))
  let _ExecEndNode = (Module['_ExecEndNode'] = (a0) =>
    (_ExecEndNode = Module['_ExecEndNode'] = wasmExports['ExecEndNode'])(a0))
  let _InstrAlloc = (Module['_InstrAlloc'] = (a0, a1, a2) =>
    (_InstrAlloc = Module['_InstrAlloc'] = wasmExports['InstrAlloc'])(
      a0,
      a1,
      a2,
    ))
  let _MakeTupleTableSlot = (Module['_MakeTupleTableSlot'] = (a0, a1) =>
    (_MakeTupleTableSlot = Module['_MakeTupleTableSlot'] =
      wasmExports['MakeTupleTableSlot'])(a0, a1))
  let _ExecWithCheckOptions = (Module['_ExecWithCheckOptions'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_ExecWithCheckOptions = Module['_ExecWithCheckOptions'] =
      wasmExports['ExecWithCheckOptions'])(a0, a1, a2, a3))
  let _get_typlenbyval = (Module['_get_typlenbyval'] = (a0, a1, a2) =>
    (_get_typlenbyval = Module['_get_typlenbyval'] =
      wasmExports['get_typlenbyval'])(a0, a1, a2))
  let _ExecInitScanTupleSlot = (Module['_ExecInitScanTupleSlot'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_ExecInitScanTupleSlot = Module['_ExecInitScanTupleSlot'] =
      wasmExports['ExecInitScanTupleSlot'])(a0, a1, a2, a3))
  let _InputFunctionCall = (Module['_InputFunctionCall'] = (a0, a1, a2, a3) =>
    (_InputFunctionCall = Module['_InputFunctionCall'] =
      wasmExports['InputFunctionCall'])(a0, a1, a2, a3))
  let _list_delete_ptr = (Module['_list_delete_ptr'] = (a0, a1) =>
    (_list_delete_ptr = Module['_list_delete_ptr'] =
      wasmExports['list_delete_ptr'])(a0, a1))
  let _FreeExprContext = (Module['_FreeExprContext'] = (a0, a1) =>
    (_FreeExprContext = Module['_FreeExprContext'] =
      wasmExports['FreeExprContext'])(a0, a1))
  let _ExecAssignExprContext = (Module['_ExecAssignExprContext'] = (a0, a1) =>
    (_ExecAssignExprContext = Module['_ExecAssignExprContext'] =
      wasmExports['ExecAssignExprContext'])(a0, a1))
  let _ExecAssignProjectionInfo = (Module['_ExecAssignProjectionInfo'] = (
    a0,
    a1,
  ) =>
    (_ExecAssignProjectionInfo = Module['_ExecAssignProjectionInfo'] =
      wasmExports['ExecAssignProjectionInfo'])(a0, a1))
  let _ExecOpenScanRelation = (Module['_ExecOpenScanRelation'] = (a0, a1, a2) =>
    (_ExecOpenScanRelation = Module['_ExecOpenScanRelation'] =
      wasmExports['ExecOpenScanRelation'])(a0, a1, a2))
  let _bms_intersect = (Module['_bms_intersect'] = (a0, a1) =>
    (_bms_intersect = Module['_bms_intersect'] = wasmExports['bms_intersect'])(
      a0,
      a1,
    ))
  let _GetAttributeByName = (Module['_GetAttributeByName'] = (a0, a1, a2) =>
    (_GetAttributeByName = Module['_GetAttributeByName'] =
      wasmExports['GetAttributeByName'])(a0, a1, a2))
  let _GetAttributeByNum = (Module['_GetAttributeByNum'] = (a0, a1, a2) =>
    (_GetAttributeByNum = Module['_GetAttributeByNum'] =
      wasmExports['GetAttributeByNum'])(a0, a1, a2))
  let _ExecGetReturningSlot = (Module['_ExecGetReturningSlot'] = (a0, a1) =>
    (_ExecGetReturningSlot = Module['_ExecGetReturningSlot'] =
      wasmExports['ExecGetReturningSlot'])(a0, a1))
  let _ExecGetResultRelCheckAsUser = (Module['_ExecGetResultRelCheckAsUser'] = (
    a0,
    a1,
  ) =>
    (_ExecGetResultRelCheckAsUser = Module['_ExecGetResultRelCheckAsUser'] =
      wasmExports['ExecGetResultRelCheckAsUser'])(a0, a1))
  let _MemoryContextRegisterResetCallback = (Module[
    '_MemoryContextRegisterResetCallback'
  ] = (a0, a1) =>
    (_MemoryContextRegisterResetCallback = Module[
      '_MemoryContextRegisterResetCallback'
    ] =
      wasmExports['MemoryContextRegisterResetCallback'])(a0, a1))
  let _cached_function_compile = (Module['_cached_function_compile'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_cached_function_compile = Module['_cached_function_compile'] =
      wasmExports['cached_function_compile'])(a0, a1, a2, a3, a4, a5, a6))
  let _InstrUpdateTupleCount = (Module['_InstrUpdateTupleCount'] = (a0, a1) =>
    (_InstrUpdateTupleCount = Module['_InstrUpdateTupleCount'] =
      wasmExports['InstrUpdateTupleCount'])(a0, a1))
  let _tuplesort_begin_heap = (Module['_tuplesort_begin_heap'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
  ) =>
    (_tuplesort_begin_heap = Module['_tuplesort_begin_heap'] =
      wasmExports['tuplesort_begin_heap'])(a0, a1, a2, a3, a4, a5, a6, a7, a8))
  let _AggCheckCallContext = (Module['_AggCheckCallContext'] = (a0, a1) =>
    (_AggCheckCallContext = Module['_AggCheckCallContext'] =
      wasmExports['AggCheckCallContext'])(a0, a1))
  let _tuplesort_gettupleslot = (Module['_tuplesort_gettupleslot'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_tuplesort_gettupleslot = Module['_tuplesort_gettupleslot'] =
      wasmExports['tuplesort_gettupleslot'])(a0, a1, a2, a3, a4))
  let _bms_del_members = (Module['_bms_del_members'] = (a0, a1) =>
    (_bms_del_members = Module['_bms_del_members'] =
      wasmExports['bms_del_members'])(a0, a1))
  let _AddWaitEventToSet = (Module['_AddWaitEventToSet'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_AddWaitEventToSet = Module['_AddWaitEventToSet'] =
      wasmExports['AddWaitEventToSet'])(a0, a1, a2, a3, a4))
  let _GetNumRegisteredWaitEvents = (Module['_GetNumRegisteredWaitEvents'] = (
    a0,
  ) =>
    (_GetNumRegisteredWaitEvents = Module['_GetNumRegisteredWaitEvents'] =
      wasmExports['GetNumRegisteredWaitEvents'])(a0))
  let _tuplestore_clear = (Module['_tuplestore_clear'] = (a0) =>
    (_tuplestore_clear = Module['_tuplestore_clear'] =
      wasmExports['tuplestore_clear'])(a0))
  let _get_attstatsslot = (Module['_get_attstatsslot'] = (a0, a1, a2, a3, a4) =>
    (_get_attstatsslot = Module['_get_attstatsslot'] =
      wasmExports['get_attstatsslot'])(a0, a1, a2, a3, a4))
  let _free_attstatsslot = (Module['_free_attstatsslot'] = (a0) =>
    (_free_attstatsslot = Module['_free_attstatsslot'] =
      wasmExports['free_attstatsslot'])(a0))
  let _SharedFileSetInit = (Module['_SharedFileSetInit'] = (a0, a1) =>
    (_SharedFileSetInit = Module['_SharedFileSetInit'] =
      wasmExports['SharedFileSetInit'])(a0, a1))
  let _SharedFileSetAttach = (Module['_SharedFileSetAttach'] = (a0, a1) =>
    (_SharedFileSetAttach = Module['_SharedFileSetAttach'] =
      wasmExports['SharedFileSetAttach'])(a0, a1))
  let _tuplesort_reset = (Module['_tuplesort_reset'] = (a0) =>
    (_tuplesort_reset = Module['_tuplesort_reset'] =
      wasmExports['tuplesort_reset'])(a0))
  let _pairingheap_first = (Module['_pairingheap_first'] = (a0) =>
    (_pairingheap_first = Module['_pairingheap_first'] =
      wasmExports['pairingheap_first'])(a0))
  let _bms_nonempty_difference = (Module['_bms_nonempty_difference'] = (
    a0,
    a1,
  ) =>
    (_bms_nonempty_difference = Module['_bms_nonempty_difference'] =
      wasmExports['bms_nonempty_difference'])(a0, a1))
  let _datum_image_hash = (Module['_datum_image_hash'] = (a0, a1, a2) =>
    (_datum_image_hash = Module['_datum_image_hash'] =
      wasmExports['datum_image_hash'])(a0, a1, a2))
  let _tuplesort_rescan = (Module['_tuplesort_rescan'] = (a0) =>
    (_tuplesort_rescan = Module['_tuplesort_rescan'] =
      wasmExports['tuplesort_rescan'])(a0))
  let _WinGetPartitionLocalMemory = (Module['_WinGetPartitionLocalMemory'] = (
    a0,
    a1,
  ) =>
    (_WinGetPartitionLocalMemory = Module['_WinGetPartitionLocalMemory'] =
      wasmExports['WinGetPartitionLocalMemory'])(a0, a1))
  let _WinGetCurrentPosition = (Module['_WinGetCurrentPosition'] = (a0) =>
    (_WinGetCurrentPosition = Module['_WinGetCurrentPosition'] =
      wasmExports['WinGetCurrentPosition'])(a0))
  let _WinGetPartitionRowCount = (Module['_WinGetPartitionRowCount'] = (a0) =>
    (_WinGetPartitionRowCount = Module['_WinGetPartitionRowCount'] =
      wasmExports['WinGetPartitionRowCount'])(a0))
  let _WinGetFuncArgInPartition = (Module['_WinGetFuncArgInPartition'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_WinGetFuncArgInPartition = Module['_WinGetFuncArgInPartition'] =
      wasmExports['WinGetFuncArgInPartition'])(a0, a1, a2, a3, a4, a5, a6))
  let _WinGetFuncArgCurrent = (Module['_WinGetFuncArgCurrent'] = (a0, a1, a2) =>
    (_WinGetFuncArgCurrent = Module['_WinGetFuncArgCurrent'] =
      wasmExports['WinGetFuncArgCurrent'])(a0, a1, a2))
  let _SPI_connect_ext = (Module['_SPI_connect_ext'] = (a0) =>
    (_SPI_connect_ext = Module['_SPI_connect_ext'] =
      wasmExports['SPI_connect_ext'])(a0))
  let _SPI_commit = (Module['_SPI_commit'] = () =>
    (_SPI_commit = Module['_SPI_commit'] = wasmExports['SPI_commit'])())
  let _CopyErrorData = (Module['_CopyErrorData'] = () =>
    (_CopyErrorData = Module['_CopyErrorData'] =
      wasmExports['CopyErrorData'])())
  let _FlushErrorState = (Module['_FlushErrorState'] = () =>
    (_FlushErrorState = Module['_FlushErrorState'] =
      wasmExports['FlushErrorState'])())
  let _ReThrowError = (Module['_ReThrowError'] = (a0) =>
    (_ReThrowError = Module['_ReThrowError'] = wasmExports['ReThrowError'])(a0))
  let _SPI_commit_and_chain = (Module['_SPI_commit_and_chain'] = () =>
    (_SPI_commit_and_chain = Module['_SPI_commit_and_chain'] =
      wasmExports['SPI_commit_and_chain'])())
  let _SPI_rollback = (Module['_SPI_rollback'] = () =>
    (_SPI_rollback = Module['_SPI_rollback'] = wasmExports['SPI_rollback'])())
  let _SPI_rollback_and_chain = (Module['_SPI_rollback_and_chain'] = () =>
    (_SPI_rollback_and_chain = Module['_SPI_rollback_and_chain'] =
      wasmExports['SPI_rollback_and_chain'])())
  let _SPI_freetuptable = (Module['_SPI_freetuptable'] = (a0) =>
    (_SPI_freetuptable = Module['_SPI_freetuptable'] =
      wasmExports['SPI_freetuptable'])(a0))
  let _SPI_execute_extended = (Module['_SPI_execute_extended'] = (a0, a1) =>
    (_SPI_execute_extended = Module['_SPI_execute_extended'] =
      wasmExports['SPI_execute_extended'])(a0, a1))
  let _SPI_execute_plan = (Module['_SPI_execute_plan'] = (a0, a1, a2, a3, a4) =>
    (_SPI_execute_plan = Module['_SPI_execute_plan'] =
      wasmExports['SPI_execute_plan'])(a0, a1, a2, a3, a4))
  let _SPI_execp = (Module['_SPI_execp'] = (a0, a1, a2, a3) =>
    (_SPI_execp = Module['_SPI_execp'] = wasmExports['SPI_execp'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _SPI_execute_plan_extended = (Module['_SPI_execute_plan_extended'] = (
    a0,
    a1,
  ) =>
    (_SPI_execute_plan_extended = Module['_SPI_execute_plan_extended'] =
      wasmExports['SPI_execute_plan_extended'])(a0, a1))
  let _SPI_execute_plan_with_paramlist = (Module[
    '_SPI_execute_plan_with_paramlist'
  ] = (a0, a1, a2, a3) =>
    (_SPI_execute_plan_with_paramlist = Module[
      '_SPI_execute_plan_with_paramlist'
    ] =
      wasmExports['SPI_execute_plan_with_paramlist'])(a0, a1, a2, a3))
  let _SPI_execute_with_args = (Module['_SPI_execute_with_args'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_SPI_execute_with_args = Module['_SPI_execute_with_args'] =
      wasmExports['SPI_execute_with_args'])(a0, a1, a2, a3, a4, a5, a6))
  let _SPI_prepare = (Module['_SPI_prepare'] = (a0, a1, a2) =>
    (_SPI_prepare = Module['_SPI_prepare'] = wasmExports['SPI_prepare'])(
      a0,
      a1,
      a2,
    ))
  let _SPI_prepare_extended = (Module['_SPI_prepare_extended'] = (a0, a1) =>
    (_SPI_prepare_extended = Module['_SPI_prepare_extended'] =
      wasmExports['SPI_prepare_extended'])(a0, a1))
  let _SPI_keepplan = (Module['_SPI_keepplan'] = (a0) =>
    (_SPI_keepplan = Module['_SPI_keepplan'] = wasmExports['SPI_keepplan'])(a0))
  let _SPI_freeplan = (Module['_SPI_freeplan'] = (a0) =>
    (_SPI_freeplan = Module['_SPI_freeplan'] = wasmExports['SPI_freeplan'])(a0))
  let _SPI_copytuple = (Module['_SPI_copytuple'] = (a0) =>
    (_SPI_copytuple = Module['_SPI_copytuple'] = wasmExports['SPI_copytuple'])(
      a0,
    ))
  let _SPI_returntuple = (Module['_SPI_returntuple'] = (a0, a1) =>
    (_SPI_returntuple = Module['_SPI_returntuple'] =
      wasmExports['SPI_returntuple'])(a0, a1))
  let _SPI_modifytuple = (Module['_SPI_modifytuple'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_SPI_modifytuple = Module['_SPI_modifytuple'] =
      wasmExports['SPI_modifytuple'])(a0, a1, a2, a3, a4, a5))
  let _SPI_fnumber = (Module['_SPI_fnumber'] = (a0, a1) =>
    (_SPI_fnumber = Module['_SPI_fnumber'] = wasmExports['SPI_fnumber'])(
      a0,
      a1,
    ))
  let _SPI_fname = (Module['_SPI_fname'] = (a0, a1) =>
    (_SPI_fname = Module['_SPI_fname'] = wasmExports['SPI_fname'])(a0, a1))
  let _SPI_getbinval = (Module['_SPI_getbinval'] = (a0, a1, a2, a3) =>
    (_SPI_getbinval = Module['_SPI_getbinval'] = wasmExports['SPI_getbinval'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _SPI_gettype = (Module['_SPI_gettype'] = (a0, a1) =>
    (_SPI_gettype = Module['_SPI_gettype'] = wasmExports['SPI_gettype'])(
      a0,
      a1,
    ))
  let _SPI_gettypeid = (Module['_SPI_gettypeid'] = (a0, a1) =>
    (_SPI_gettypeid = Module['_SPI_gettypeid'] = wasmExports['SPI_gettypeid'])(
      a0,
      a1,
    ))
  let _SPI_getrelname = (Module['_SPI_getrelname'] = (a0) =>
    (_SPI_getrelname = Module['_SPI_getrelname'] =
      wasmExports['SPI_getrelname'])(a0))
  let _SPI_palloc = (Module['_SPI_palloc'] = (a0) =>
    (_SPI_palloc = Module['_SPI_palloc'] = wasmExports['SPI_palloc'])(a0))
  let _SPI_repalloc = (Module['_SPI_repalloc'] = (a0, a1) =>
    (_SPI_repalloc = Module['_SPI_repalloc'] = wasmExports['SPI_repalloc'])(
      a0,
      a1,
    ))
  let _SPI_pfree = (Module['_SPI_pfree'] = (a0) =>
    (_SPI_pfree = Module['_SPI_pfree'] = wasmExports['SPI_pfree'])(a0))
  let _SPI_datumTransfer = (Module['_SPI_datumTransfer'] = (a0, a1, a2) =>
    (_SPI_datumTransfer = Module['_SPI_datumTransfer'] =
      wasmExports['SPI_datumTransfer'])(a0, a1, a2))
  let _datumTransfer = (Module['_datumTransfer'] = (a0, a1, a2) =>
    (_datumTransfer = Module['_datumTransfer'] = wasmExports['datumTransfer'])(
      a0,
      a1,
      a2,
    ))
  let _SPI_cursor_open_with_args = (Module['_SPI_cursor_open_with_args'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_SPI_cursor_open_with_args = Module['_SPI_cursor_open_with_args'] =
      wasmExports['SPI_cursor_open_with_args'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _SPI_cursor_open_with_paramlist = (Module[
    '_SPI_cursor_open_with_paramlist'
  ] = (a0, a1, a2, a3) =>
    (_SPI_cursor_open_with_paramlist = Module[
      '_SPI_cursor_open_with_paramlist'
    ] =
      wasmExports['SPI_cursor_open_with_paramlist'])(a0, a1, a2, a3))
  let _SPI_cursor_parse_open = (Module['_SPI_cursor_parse_open'] = (
    a0,
    a1,
    a2,
  ) =>
    (_SPI_cursor_parse_open = Module['_SPI_cursor_parse_open'] =
      wasmExports['SPI_cursor_parse_open'])(a0, a1, a2))
  let _SPI_cursor_find = (Module['_SPI_cursor_find'] = (a0) =>
    (_SPI_cursor_find = Module['_SPI_cursor_find'] =
      wasmExports['SPI_cursor_find'])(a0))
  let _SPI_cursor_fetch = (Module['_SPI_cursor_fetch'] = (a0, a1, a2) =>
    (_SPI_cursor_fetch = Module['_SPI_cursor_fetch'] =
      wasmExports['SPI_cursor_fetch'])(a0, a1, a2))
  let _SPI_scroll_cursor_fetch = (Module['_SPI_scroll_cursor_fetch'] = (
    a0,
    a1,
    a2,
  ) =>
    (_SPI_scroll_cursor_fetch = Module['_SPI_scroll_cursor_fetch'] =
      wasmExports['SPI_scroll_cursor_fetch'])(a0, a1, a2))
  let _SPI_scroll_cursor_move = (Module['_SPI_scroll_cursor_move'] = (
    a0,
    a1,
    a2,
  ) =>
    (_SPI_scroll_cursor_move = Module['_SPI_scroll_cursor_move'] =
      wasmExports['SPI_scroll_cursor_move'])(a0, a1, a2))
  let _SPI_cursor_close = (Module['_SPI_cursor_close'] = (a0) =>
    (_SPI_cursor_close = Module['_SPI_cursor_close'] =
      wasmExports['SPI_cursor_close'])(a0))
  let _SPI_plan_is_valid = (Module['_SPI_plan_is_valid'] = (a0) =>
    (_SPI_plan_is_valid = Module['_SPI_plan_is_valid'] =
      wasmExports['SPI_plan_is_valid'])(a0))
  let _SPI_result_code_string = (Module['_SPI_result_code_string'] = (a0) =>
    (_SPI_result_code_string = Module['_SPI_result_code_string'] =
      wasmExports['SPI_result_code_string'])(a0))
  let _SPI_plan_get_plan_sources = (Module['_SPI_plan_get_plan_sources'] = (
    a0,
  ) =>
    (_SPI_plan_get_plan_sources = Module['_SPI_plan_get_plan_sources'] =
      wasmExports['SPI_plan_get_plan_sources'])(a0))
  let _SPI_plan_get_cached_plan = (Module['_SPI_plan_get_cached_plan'] = (a0) =>
    (_SPI_plan_get_cached_plan = Module['_SPI_plan_get_cached_plan'] =
      wasmExports['SPI_plan_get_cached_plan'])(a0))
  let _SPI_register_relation = (Module['_SPI_register_relation'] = (a0) =>
    (_SPI_register_relation = Module['_SPI_register_relation'] =
      wasmExports['SPI_register_relation'])(a0))
  let _create_queryEnv = (Module['_create_queryEnv'] = () =>
    (_create_queryEnv = Module['_create_queryEnv'] =
      wasmExports['create_queryEnv'])())
  let _register_ENR = (Module['_register_ENR'] = (a0, a1) =>
    (_register_ENR = Module['_register_ENR'] = wasmExports['register_ENR'])(
      a0,
      a1,
    ))
  let _SPI_register_trigger_data = (Module['_SPI_register_trigger_data'] = (
    a0,
  ) =>
    (_SPI_register_trigger_data = Module['_SPI_register_trigger_data'] =
      wasmExports['SPI_register_trigger_data'])(a0))
  let _tuplestore_tuple_count = (Module['_tuplestore_tuple_count'] = (a0) =>
    (_tuplestore_tuple_count = Module['_tuplestore_tuple_count'] =
      wasmExports['tuplestore_tuple_count'])(a0))
  let _GetUserMapping = (Module['_GetUserMapping'] = (a0, a1) =>
    (_GetUserMapping = Module['_GetUserMapping'] =
      wasmExports['GetUserMapping'])(a0, a1))
  let _GetForeignTable = (Module['_GetForeignTable'] = (a0) =>
    (_GetForeignTable = Module['_GetForeignTable'] =
      wasmExports['GetForeignTable'])(a0))
  let _GetForeignColumnOptions = (Module['_GetForeignColumnOptions'] = (
    a0,
    a1,
  ) =>
    (_GetForeignColumnOptions = Module['_GetForeignColumnOptions'] =
      wasmExports['GetForeignColumnOptions'])(a0, a1))
  let _initClosestMatch = (Module['_initClosestMatch'] = (a0, a1, a2) =>
    (_initClosestMatch = Module['_initClosestMatch'] =
      wasmExports['initClosestMatch'])(a0, a1, a2))
  let _updateClosestMatch = (Module['_updateClosestMatch'] = (a0, a1) =>
    (_updateClosestMatch = Module['_updateClosestMatch'] =
      wasmExports['updateClosestMatch'])(a0, a1))
  let _getClosestMatch = (Module['_getClosestMatch'] = (a0) =>
    (_getClosestMatch = Module['_getClosestMatch'] =
      wasmExports['getClosestMatch'])(a0))
  let _GetExistingLocalJoinPath = (Module['_GetExistingLocalJoinPath'] = (a0) =>
    (_GetExistingLocalJoinPath = Module['_GetExistingLocalJoinPath'] =
      wasmExports['GetExistingLocalJoinPath'])(a0))
  let _pathkeys_contained_in = (Module['_pathkeys_contained_in'] = (a0, a1) =>
    (_pathkeys_contained_in = Module['_pathkeys_contained_in'] =
      wasmExports['pathkeys_contained_in'])(a0, a1))
  let _bloom_create = (Module['_bloom_create'] = (a0, a1, a2) =>
    (_bloom_create = Module['_bloom_create'] = wasmExports['bloom_create'])(
      a0,
      a1,
      a2,
    ))
  let _bloom_free = (Module['_bloom_free'] = (a0) =>
    (_bloom_free = Module['_bloom_free'] = wasmExports['bloom_free'])(a0))
  let _bloom_add_element = (Module['_bloom_add_element'] = (a0, a1, a2) =>
    (_bloom_add_element = Module['_bloom_add_element'] =
      wasmExports['bloom_add_element'])(a0, a1, a2))
  let _bloom_lacks_element = (Module['_bloom_lacks_element'] = (a0, a1, a2) =>
    (_bloom_lacks_element = Module['_bloom_lacks_element'] =
      wasmExports['bloom_lacks_element'])(a0, a1, a2))
  let _bloom_prop_bits_set = (Module['_bloom_prop_bits_set'] = (a0) =>
    (_bloom_prop_bits_set = Module['_bloom_prop_bits_set'] =
      wasmExports['bloom_prop_bits_set'])(a0))
  let _dshash_create = (Module['_dshash_create'] = (a0, a1, a2) =>
    (_dshash_create = Module['_dshash_create'] = wasmExports['dshash_create'])(
      a0,
      a1,
      a2,
    ))
  let _dshash_attach = (Module['_dshash_attach'] = (a0, a1, a2, a3) =>
    (_dshash_attach = Module['_dshash_attach'] = wasmExports['dshash_attach'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _dshash_detach = (Module['_dshash_detach'] = (a0) =>
    (_dshash_detach = Module['_dshash_detach'] = wasmExports['dshash_detach'])(
      a0,
    ))
  let _dshash_destroy = (Module['_dshash_destroy'] = (a0) =>
    (_dshash_destroy = Module['_dshash_destroy'] =
      wasmExports['dshash_destroy'])(a0))
  let _dshash_get_hash_table_handle = (Module['_dshash_get_hash_table_handle'] =
    (a0) =>
      (_dshash_get_hash_table_handle = Module['_dshash_get_hash_table_handle'] =
        wasmExports['dshash_get_hash_table_handle'])(a0))
  let _dshash_find = (Module['_dshash_find'] = (a0, a1, a2) =>
    (_dshash_find = Module['_dshash_find'] = wasmExports['dshash_find'])(
      a0,
      a1,
      a2,
    ))
  let _dshash_find_or_insert = (Module['_dshash_find_or_insert'] = (
    a0,
    a1,
    a2,
  ) =>
    (_dshash_find_or_insert = Module['_dshash_find_or_insert'] =
      wasmExports['dshash_find_or_insert'])(a0, a1, a2))
  let _dshash_delete_key = (Module['_dshash_delete_key'] = (a0, a1) =>
    (_dshash_delete_key = Module['_dshash_delete_key'] =
      wasmExports['dshash_delete_key'])(a0, a1))
  let _dshash_release_lock = (Module['_dshash_release_lock'] = (a0, a1) =>
    (_dshash_release_lock = Module['_dshash_release_lock'] =
      wasmExports['dshash_release_lock'])(a0, a1))
  let _tag_hash = (Module['_tag_hash'] = (a0, a1) =>
    (_tag_hash = Module['_tag_hash'] = wasmExports['tag_hash'])(a0, a1))
  let _dshash_seq_init = (Module['_dshash_seq_init'] = (a0, a1, a2) =>
    (_dshash_seq_init = Module['_dshash_seq_init'] =
      wasmExports['dshash_seq_init'])(a0, a1, a2))
  let _dshash_seq_next = (Module['_dshash_seq_next'] = (a0) =>
    (_dshash_seq_next = Module['_dshash_seq_next'] =
      wasmExports['dshash_seq_next'])(a0))
  let _dshash_seq_term = (Module['_dshash_seq_term'] = (a0) =>
    (_dshash_seq_term = Module['_dshash_seq_term'] =
      wasmExports['dshash_seq_term'])(a0))
  let _dshash_delete_current = (Module['_dshash_delete_current'] = (a0) =>
    (_dshash_delete_current = Module['_dshash_delete_current'] =
      wasmExports['dshash_delete_current'])(a0))
  let _ldexp = (Module['_ldexp'] = (a0, a1) =>
    (_ldexp = Module['_ldexp'] = wasmExports['ldexp'])(a0, a1))
  let _pg_b64_enc_len = (Module['_pg_b64_enc_len'] = (a0) =>
    (_pg_b64_enc_len = Module['_pg_b64_enc_len'] =
      wasmExports['pg_b64_enc_len'])(a0))
  let _pg_b64_encode = (Module['_pg_b64_encode'] = (a0, a1, a2, a3) =>
    (_pg_b64_encode = Module['_pg_b64_encode'] = wasmExports['pg_b64_encode'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _strtol = (Module['_strtol'] = (a0, a1, a2) =>
    (_strtol = Module['_strtol'] = wasmExports['strtol'])(a0, a1, a2))
  let _gai_strerror = (Module['_gai_strerror'] = (a0) =>
    (_gai_strerror = Module['_gai_strerror'] = wasmExports['gai_strerror'])(a0))
  let _socket = (Module['_socket'] = (a0, a1, a2) =>
    (_socket = Module['_socket'] = wasmExports['socket'])(a0, a1, a2))
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
  let _be_lo_unlink = (Module['_be_lo_unlink'] = (a0) =>
    (_be_lo_unlink = Module['_be_lo_unlink'] = wasmExports['be_lo_unlink'])(a0))
  let _text_to_cstring_buffer = (Module['_text_to_cstring_buffer'] = (
    a0,
    a1,
    a2,
  ) =>
    (_text_to_cstring_buffer = Module['_text_to_cstring_buffer'] =
      wasmExports['text_to_cstring_buffer'])(a0, a1, a2))
  let _pg_mb2wchar_with_len = (Module['_pg_mb2wchar_with_len'] = (a0, a1, a2) =>
    (_pg_mb2wchar_with_len = Module['_pg_mb2wchar_with_len'] =
      wasmExports['pg_mb2wchar_with_len'])(a0, a1, a2))
  let _pg_regcomp = (Module['_pg_regcomp'] = (a0, a1, a2, a3, a4) =>
    (_pg_regcomp = Module['_pg_regcomp'] = wasmExports['pg_regcomp'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _pg_regerror = (Module['_pg_regerror'] = (a0, a1, a2, a3) =>
    (_pg_regerror = Module['_pg_regerror'] = wasmExports['pg_regerror'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _strcat = (Module['_strcat'] = (a0, a1) =>
    (_strcat = Module['_strcat'] = wasmExports['strcat'])(a0, a1))
  let _pgl_getsockname = (Module['_pgl_getsockname'] = (a0, a1, a2) =>
    (_pgl_getsockname = Module['_pgl_getsockname'] =
      wasmExports['pgl_getsockname'])(a0, a1, a2))
  let _pgl_setsockopt = (Module['_pgl_setsockopt'] = (a0, a1, a2, a3, a4) =>
    (_pgl_setsockopt = Module['_pgl_setsockopt'] =
      wasmExports['pgl_setsockopt'])(a0, a1, a2, a3, a4))
  let _pgl_fcntl = (Module['_pgl_fcntl'] = (a0, a1, a2) =>
    (_pgl_fcntl = Module['_pgl_fcntl'] = wasmExports['pgl_fcntl'])(a0, a1, a2))
  let _utime = (Module['_utime'] = (a0, a1) =>
    (_utime = Module['_utime'] = wasmExports['utime'])(a0, a1))
  let _pq_buffer_remaining_data = (Module['_pq_buffer_remaining_data'] = () =>
    (_pq_buffer_remaining_data = Module['_pq_buffer_remaining_data'] =
      wasmExports['pq_buffer_remaining_data'])())
  let _pgl_getsockopt = (Module['_pgl_getsockopt'] = (a0, a1, a2, a3, a4) =>
    (_pgl_getsockopt = Module['_pgl_getsockopt'] =
      wasmExports['pgl_getsockopt'])(a0, a1, a2, a3, a4))
  let _pq_sendtext = (Module['_pq_sendtext'] = (a0, a1, a2) =>
    (_pq_sendtext = Module['_pq_sendtext'] = wasmExports['pq_sendtext'])(
      a0,
      a1,
      a2,
    ))
  let _pq_sendfloat4 = (Module['_pq_sendfloat4'] = (a0, a1) =>
    (_pq_sendfloat4 = Module['_pq_sendfloat4'] = wasmExports['pq_sendfloat4'])(
      a0,
      a1,
    ))
  let _pq_sendfloat8 = (Module['_pq_sendfloat8'] = (a0, a1) =>
    (_pq_sendfloat8 = Module['_pq_sendfloat8'] = wasmExports['pq_sendfloat8'])(
      a0,
      a1,
    ))
  let _pq_begintypsend = (Module['_pq_begintypsend'] = (a0) =>
    (_pq_begintypsend = Module['_pq_begintypsend'] =
      wasmExports['pq_begintypsend'])(a0))
  let _pq_endtypsend = (Module['_pq_endtypsend'] = (a0) =>
    (_pq_endtypsend = Module['_pq_endtypsend'] = wasmExports['pq_endtypsend'])(
      a0,
    ))
  let _pq_getmsgfloat4 = (Module['_pq_getmsgfloat4'] = (a0) =>
    (_pq_getmsgfloat4 = Module['_pq_getmsgfloat4'] =
      wasmExports['pq_getmsgfloat4'])(a0))
  let _pq_getmsgfloat8 = (Module['_pq_getmsgfloat8'] = (a0) =>
    (_pq_getmsgfloat8 = Module['_pq_getmsgfloat8'] =
      wasmExports['pq_getmsgfloat8'])(a0))
  let _pq_getmsgtext = (Module['_pq_getmsgtext'] = (a0, a1, a2) =>
    (_pq_getmsgtext = Module['_pq_getmsgtext'] = wasmExports['pq_getmsgtext'])(
      a0,
      a1,
      a2,
    ))
  let _pg_strtoint32 = (Module['_pg_strtoint32'] = (a0) =>
    (_pg_strtoint32 = Module['_pg_strtoint32'] = wasmExports['pg_strtoint32'])(
      a0,
    ))
  let _main = (Module['_main'] = (a0, a1) =>
    (_main = Module['_main'] = wasmExports['__main_argc_argv'])(a0, a1))
  let _pgl_getuid = (Module['_pgl_getuid'] = () =>
    (_pgl_getuid = Module['_pgl_getuid'] = wasmExports['pgl_getuid'])())
  let _getenv = (Module['_getenv'] = (a0) =>
    (_getenv = Module['_getenv'] = wasmExports['getenv'])(a0))
  let _bms_membership = (Module['_bms_membership'] = (a0) =>
    (_bms_membership = Module['_bms_membership'] =
      wasmExports['bms_membership'])(a0))
  let _RegisterExtensibleNodeMethods = (Module[
    '_RegisterExtensibleNodeMethods'
  ] = (a0) =>
    (_RegisterExtensibleNodeMethods = Module['_RegisterExtensibleNodeMethods'] =
      wasmExports['RegisterExtensibleNodeMethods'])(a0))
  let _list_make5_impl = (Module['_list_make5_impl'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_list_make5_impl = Module['_list_make5_impl'] =
      wasmExports['list_make5_impl'])(a0, a1, a2, a3, a4, a5))
  let _GetMemoryChunkContext = (Module['_GetMemoryChunkContext'] = (a0) =>
    (_GetMemoryChunkContext = Module['_GetMemoryChunkContext'] =
      wasmExports['GetMemoryChunkContext'])(a0))
  let _list_insert_nth = (Module['_list_insert_nth'] = (a0, a1, a2) =>
    (_list_insert_nth = Module['_list_insert_nth'] =
      wasmExports['list_insert_nth'])(a0, a1, a2))
  let _list_member_ptr = (Module['_list_member_ptr'] = (a0, a1) =>
    (_list_member_ptr = Module['_list_member_ptr'] =
      wasmExports['list_member_ptr'])(a0, a1))
  let _list_append_unique_ptr = (Module['_list_append_unique_ptr'] = (a0, a1) =>
    (_list_append_unique_ptr = Module['_list_append_unique_ptr'] =
      wasmExports['list_append_unique_ptr'])(a0, a1))
  let _make_opclause = (Module['_make_opclause'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_make_opclause = Module['_make_opclause'] = wasmExports['make_opclause'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
    ))
  let _exprIsLengthCoercion = (Module['_exprIsLengthCoercion'] = (a0, a1) =>
    (_exprIsLengthCoercion = Module['_exprIsLengthCoercion'] =
      wasmExports['exprIsLengthCoercion'])(a0, a1))
  let _fix_opfuncids = (Module['_fix_opfuncids'] = (a0) =>
    (_fix_opfuncids = Module['_fix_opfuncids'] = wasmExports['fix_opfuncids'])(
      a0,
    ))
  let _outToken = (Module['_outToken'] = (a0, a1) =>
    (_outToken = Module['_outToken'] = wasmExports['outToken'])(a0, a1))
  let _outNode = (Module['_outNode'] = (a0, a1) =>
    (_outNode = Module['_outNode'] = wasmExports['outNode'])(a0, a1))
  let _appendStringInfoStringQuoted = (Module['_appendStringInfoStringQuoted'] =
    (a0, a1, a2) =>
      (_appendStringInfoStringQuoted = Module['_appendStringInfoStringQuoted'] =
        wasmExports['appendStringInfoStringQuoted'])(a0, a1, a2))
  let _EnableQueryId = (Module['_EnableQueryId'] = () =>
    (_EnableQueryId = Module['_EnableQueryId'] =
      wasmExports['EnableQueryId'])())
  let _nodeRead = (Module['_nodeRead'] = (a0, a1) =>
    (_nodeRead = Module['_nodeRead'] = wasmExports['nodeRead'])(a0, a1))
  let _pg_strtok = (Module['_pg_strtok'] = (a0) =>
    (_pg_strtok = Module['_pg_strtok'] = wasmExports['pg_strtok'])(a0))
  let _debackslash = (Module['_debackslash'] = (a0, a1) =>
    (_debackslash = Module['_debackslash'] = wasmExports['debackslash'])(
      a0,
      a1,
    ))
  let _exp2 = (Module['_exp2'] = (a0) =>
    (_exp2 = Module['_exp2'] = wasmExports['exp2'])(a0))
  let _find_base_rel = (Module['_find_base_rel'] = (a0, a1) =>
    (_find_base_rel = Module['_find_base_rel'] = wasmExports['find_base_rel'])(
      a0,
      a1,
    ))
  let _add_path = (Module['_add_path'] = (a0, a1) =>
    (_add_path = Module['_add_path'] = wasmExports['add_path'])(a0, a1))
  let _create_sort_path = (Module['_create_sort_path'] = (a0, a1, a2, a3, a4) =>
    (_create_sort_path = Module['_create_sort_path'] =
      wasmExports['create_sort_path'])(a0, a1, a2, a3, a4))
  let _set_baserel_size_estimates = (Module['_set_baserel_size_estimates'] = (
    a0,
    a1,
  ) =>
    (_set_baserel_size_estimates = Module['_set_baserel_size_estimates'] =
      wasmExports['set_baserel_size_estimates'])(a0, a1))
  let _get_func_support = (Module['_get_func_support'] = (a0) =>
    (_get_func_support = Module['_get_func_support'] =
      wasmExports['get_func_support'])(a0))
  let _clauselist_selectivity = (Module['_clauselist_selectivity'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_clauselist_selectivity = Module['_clauselist_selectivity'] =
      wasmExports['clauselist_selectivity'])(a0, a1, a2, a3, a4))
  let _get_tablespace_page_costs = (Module['_get_tablespace_page_costs'] = (
    a0,
    a1,
    a2,
  ) =>
    (_get_tablespace_page_costs = Module['_get_tablespace_page_costs'] =
      wasmExports['get_tablespace_page_costs'])(a0, a1, a2))
  let _cost_qual_eval = (Module['_cost_qual_eval'] = (a0, a1, a2) =>
    (_cost_qual_eval = Module['_cost_qual_eval'] =
      wasmExports['cost_qual_eval'])(a0, a1, a2))
  let _pull_varnos = (Module['_pull_varnos'] = (a0, a1) =>
    (_pull_varnos = Module['_pull_varnos'] = wasmExports['pull_varnos'])(
      a0,
      a1,
    ))
  let _estimate_num_groups = (Module['_estimate_num_groups'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_estimate_num_groups = Module['_estimate_num_groups'] =
      wasmExports['estimate_num_groups'])(a0, a1, a2, a3, a4))
  let _cost_sort = (Module['_cost_sort'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
  ) =>
    (_cost_sort = Module['_cost_sort'] = wasmExports['cost_sort'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
    ))
  let _get_sortgrouplist_exprs = (Module['_get_sortgrouplist_exprs'] = (
    a0,
    a1,
  ) =>
    (_get_sortgrouplist_exprs = Module['_get_sortgrouplist_exprs'] =
      wasmExports['get_sortgrouplist_exprs'])(a0, a1))
  let _make_restrictinfo = (Module['_make_restrictinfo'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
  ) =>
    (_make_restrictinfo = Module['_make_restrictinfo'] =
      wasmExports['make_restrictinfo'])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9))
  let _setup_eclass_member_iterator = (Module['_setup_eclass_member_iterator'] =
    (a0, a1, a2) =>
      (_setup_eclass_member_iterator = Module['_setup_eclass_member_iterator'] =
        wasmExports['setup_eclass_member_iterator'])(a0, a1, a2))
  let _eclass_member_iterator_next = (Module['_eclass_member_iterator_next'] = (
    a0,
  ) =>
    (_eclass_member_iterator_next = Module['_eclass_member_iterator_next'] =
      wasmExports['eclass_member_iterator_next'])(a0))
  let _remove_nulling_relids = (Module['_remove_nulling_relids'] = (
    a0,
    a1,
    a2,
  ) =>
    (_remove_nulling_relids = Module['_remove_nulling_relids'] =
      wasmExports['remove_nulling_relids'])(a0, a1, a2))
  let _get_mergejoin_opfamilies = (Module['_get_mergejoin_opfamilies'] = (a0) =>
    (_get_mergejoin_opfamilies = Module['_get_mergejoin_opfamilies'] =
      wasmExports['get_mergejoin_opfamilies'])(a0))
  let _generate_implied_equalities_for_column = (Module[
    '_generate_implied_equalities_for_column'
  ] = (a0, a1, a2, a3, a4) =>
    (_generate_implied_equalities_for_column = Module[
      '_generate_implied_equalities_for_column'
    ] =
      wasmExports['generate_implied_equalities_for_column'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _eclass_useful_for_merging = (Module['_eclass_useful_for_merging'] = (
    a0,
    a1,
    a2,
  ) =>
    (_eclass_useful_for_merging = Module['_eclass_useful_for_merging'] =
      wasmExports['eclass_useful_for_merging'])(a0, a1, a2))
  let _join_clause_is_movable_to = (Module['_join_clause_is_movable_to'] = (
    a0,
    a1,
  ) =>
    (_join_clause_is_movable_to = Module['_join_clause_is_movable_to'] =
      wasmExports['join_clause_is_movable_to'])(a0, a1))
  let _get_plan_rowmark = (Module['_get_plan_rowmark'] = (a0, a1) =>
    (_get_plan_rowmark = Module['_get_plan_rowmark'] =
      wasmExports['get_plan_rowmark'])(a0, a1))
  let _is_pseudo_constant_for_index = (Module['_is_pseudo_constant_for_index'] =
    (a0, a1, a2) =>
      (_is_pseudo_constant_for_index = Module['_is_pseudo_constant_for_index'] =
        wasmExports['is_pseudo_constant_for_index'])(a0, a1, a2))
  let _update_mergeclause_eclasses = (Module['_update_mergeclause_eclasses'] = (
    a0,
    a1,
  ) =>
    (_update_mergeclause_eclasses = Module['_update_mergeclause_eclasses'] =
      wasmExports['update_mergeclause_eclasses'])(a0, a1))
  let _pull_vars_of_level = (Module['_pull_vars_of_level'] = (a0, a1) =>
    (_pull_vars_of_level = Module['_pull_vars_of_level'] =
      wasmExports['pull_vars_of_level'])(a0, a1))
  let _find_join_rel = (Module['_find_join_rel'] = (a0, a1) =>
    (_find_join_rel = Module['_find_join_rel'] = wasmExports['find_join_rel'])(
      a0,
      a1,
    ))
  let _make_canonical_pathkey = (Module['_make_canonical_pathkey'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_make_canonical_pathkey = Module['_make_canonical_pathkey'] =
      wasmExports['make_canonical_pathkey'])(a0, a1, a2, a3, a4))
  let _get_sortgroupref_clause_noerr = (Module[
    '_get_sortgroupref_clause_noerr'
  ] = (a0, a1) =>
    (_get_sortgroupref_clause_noerr = Module['_get_sortgroupref_clause_noerr'] =
      wasmExports['get_sortgroupref_clause_noerr'])(a0, a1))
  let _extract_actual_clauses = (Module['_extract_actual_clauses'] = (a0, a1) =>
    (_extract_actual_clauses = Module['_extract_actual_clauses'] =
      wasmExports['extract_actual_clauses'])(a0, a1))
  let _tlist_member = (Module['_tlist_member'] = (a0, a1) =>
    (_tlist_member = Module['_tlist_member'] = wasmExports['tlist_member'])(
      a0,
      a1,
    ))
  let _change_plan_targetlist = (Module['_change_plan_targetlist'] = (
    a0,
    a1,
    a2,
  ) =>
    (_change_plan_targetlist = Module['_change_plan_targetlist'] =
      wasmExports['change_plan_targetlist'])(a0, a1, a2))
  let _make_foreignscan = (Module['_make_foreignscan'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_make_foreignscan = Module['_make_foreignscan'] =
      wasmExports['make_foreignscan'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _IncrementVarSublevelsUp = (Module['_IncrementVarSublevelsUp'] = (
    a0,
    a1,
    a2,
  ) =>
    (_IncrementVarSublevelsUp = Module['_IncrementVarSublevelsUp'] =
      wasmExports['IncrementVarSublevelsUp'])(a0, a1, a2))
  let _op_mergejoinable = (Module['_op_mergejoinable'] = (a0, a1) =>
    (_op_mergejoinable = Module['_op_mergejoinable'] =
      wasmExports['op_mergejoinable'])(a0, a1))
  let _find_nonnullable_rels = (Module['_find_nonnullable_rels'] = (a0) =>
    (_find_nonnullable_rels = Module['_find_nonnullable_rels'] =
      wasmExports['find_nonnullable_rels'])(a0))
  let _standard_planner = (Module['_standard_planner'] = (a0, a1, a2, a3) =>
    (_standard_planner = Module['_standard_planner'] =
      wasmExports['standard_planner'])(a0, a1, a2, a3))
  let _get_relids_in_jointree = (Module['_get_relids_in_jointree'] = (
    a0,
    a1,
    a2,
  ) =>
    (_get_relids_in_jointree = Module['_get_relids_in_jointree'] =
      wasmExports['get_relids_in_jointree'])(a0, a1, a2))
  let _SS_process_sublinks = (Module['_SS_process_sublinks'] = (a0, a1, a2) =>
    (_SS_process_sublinks = Module['_SS_process_sublinks'] =
      wasmExports['SS_process_sublinks'])(a0, a1, a2))
  let _add_new_columns_to_pathtarget = (Module[
    '_add_new_columns_to_pathtarget'
  ] = (a0, a1) =>
    (_add_new_columns_to_pathtarget = Module['_add_new_columns_to_pathtarget'] =
      wasmExports['add_new_columns_to_pathtarget'])(a0, a1))
  let _get_agg_clause_costs = (Module['_get_agg_clause_costs'] = (a0, a1, a2) =>
    (_get_agg_clause_costs = Module['_get_agg_clause_costs'] =
      wasmExports['get_agg_clause_costs'])(a0, a1, a2))
  let _grouping_is_sortable = (Module['_grouping_is_sortable'] = (a0) =>
    (_grouping_is_sortable = Module['_grouping_is_sortable'] =
      wasmExports['grouping_is_sortable'])(a0))
  let _copy_pathtarget = (Module['_copy_pathtarget'] = (a0) =>
    (_copy_pathtarget = Module['_copy_pathtarget'] =
      wasmExports['copy_pathtarget'])(a0))
  let _create_projection_path = (Module['_create_projection_path'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_create_projection_path = Module['_create_projection_path'] =
      wasmExports['create_projection_path'])(a0, a1, a2, a3))
  let _contain_nonstrict_functions = (Module['_contain_nonstrict_functions'] = (
    a0,
  ) =>
    (_contain_nonstrict_functions = Module['_contain_nonstrict_functions'] =
      wasmExports['contain_nonstrict_functions'])(a0))
  let _get_translated_update_targetlist = (Module[
    '_get_translated_update_targetlist'
  ] = (a0, a1, a2, a3) =>
    (_get_translated_update_targetlist = Module[
      '_get_translated_update_targetlist'
    ] =
      wasmExports['get_translated_update_targetlist'])(a0, a1, a2, a3))
  let _add_row_identity_var = (Module['_add_row_identity_var'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_add_row_identity_var = Module['_add_row_identity_var'] =
      wasmExports['add_row_identity_var'])(a0, a1, a2, a3))
  let _get_rel_all_updated_cols = (Module['_get_rel_all_updated_cols'] = (
    a0,
    a1,
  ) =>
    (_get_rel_all_updated_cols = Module['_get_rel_all_updated_cols'] =
      wasmExports['get_rel_all_updated_cols'])(a0, a1))
  let _get_baserel_parampathinfo = (Module['_get_baserel_parampathinfo'] = (
    a0,
    a1,
    a2,
  ) =>
    (_get_baserel_parampathinfo = Module['_get_baserel_parampathinfo'] =
      wasmExports['get_baserel_parampathinfo'])(a0, a1, a2))
  let _create_foreignscan_path = (Module['_create_foreignscan_path'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
    a11,
  ) =>
    (_create_foreignscan_path = Module['_create_foreignscan_path'] =
      wasmExports['create_foreignscan_path'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
      a11,
    ))
  let _create_foreign_join_path = (Module['_create_foreign_join_path'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
    a11,
  ) =>
    (_create_foreign_join_path = Module['_create_foreign_join_path'] =
      wasmExports['create_foreign_join_path'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
      a11,
    ))
  let _create_foreign_upper_path = (Module['_create_foreign_upper_path'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
  ) =>
    (_create_foreign_upper_path = Module['_create_foreign_upper_path'] =
      wasmExports['create_foreign_upper_path'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
    ))
  let _adjust_limit_rows_costs = (Module['_adjust_limit_rows_costs'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_adjust_limit_rows_costs = Module['_adjust_limit_rows_costs'] =
      wasmExports['adjust_limit_rows_costs'])(a0, a1, a2, a3, a4))
  let _add_to_flat_tlist = (Module['_add_to_flat_tlist'] = (a0, a1) =>
    (_add_to_flat_tlist = Module['_add_to_flat_tlist'] =
      wasmExports['add_to_flat_tlist'])(a0, a1))
  let _get_fn_expr_variadic = (Module['_get_fn_expr_variadic'] = (a0) =>
    (_get_fn_expr_variadic = Module['_get_fn_expr_variadic'] =
      wasmExports['get_fn_expr_variadic'])(a0))
  let _get_fn_expr_argtype = (Module['_get_fn_expr_argtype'] = (a0, a1) =>
    (_get_fn_expr_argtype = Module['_get_fn_expr_argtype'] =
      wasmExports['get_fn_expr_argtype'])(a0, a1))
  let _on_shmem_exit = (Module['_on_shmem_exit'] = (a0, a1) =>
    (_on_shmem_exit = Module['_on_shmem_exit'] = wasmExports['on_shmem_exit'])(
      a0,
      a1,
    ))
  let _pgl_shmdt = (Module['_pgl_shmdt'] = (a0) =>
    (_pgl_shmdt = Module['_pgl_shmdt'] = wasmExports['pgl_shmdt'])(a0))
  let _pgl_shmctl = (Module['_pgl_shmctl'] = (a0, a1, a2) =>
    (_pgl_shmctl = Module['_pgl_shmctl'] = wasmExports['pgl_shmctl'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_shmat = (Module['_pgl_shmat'] = (a0, a1, a2) =>
    (_pgl_shmat = Module['_pgl_shmat'] = wasmExports['pgl_shmat'])(a0, a1, a2))
  let _mmap = (Module['_mmap'] = (a0, a1, a2, a3, a4, a5) =>
    (_mmap = Module['_mmap'] = wasmExports['mmap'])(a0, a1, a2, a3, a4, a5))
  let _pgl_shmget = (Module['_pgl_shmget'] = (a0, a1, a2) =>
    (_pgl_shmget = Module['_pgl_shmget'] = wasmExports['pgl_shmget'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_munmap = (Module['_pgl_munmap'] = (a0, a1) =>
    (_pgl_munmap = Module['_pgl_munmap'] = wasmExports['pgl_munmap'])(a0, a1))
  let _SignalHandlerForConfigReload = (Module['_SignalHandlerForConfigReload'] =
    (a0) =>
      (_SignalHandlerForConfigReload = Module['_SignalHandlerForConfigReload'] =
        wasmExports['SignalHandlerForConfigReload'])(a0))
  let _SignalHandlerForShutdownRequest = (Module[
    '_SignalHandlerForShutdownRequest'
  ] = (a0) =>
    (_SignalHandlerForShutdownRequest = Module[
      '_SignalHandlerForShutdownRequest'
    ] =
      wasmExports['SignalHandlerForShutdownRequest'])(a0))
  let _procsignal_sigusr1_handler = (Module['_procsignal_sigusr1_handler'] = (
    a0,
  ) =>
    (_procsignal_sigusr1_handler = Module['_procsignal_sigusr1_handler'] =
      wasmExports['procsignal_sigusr1_handler'])(a0))
  let _RegisterBackgroundWorker = (Module['_RegisterBackgroundWorker'] = (a0) =>
    (_RegisterBackgroundWorker = Module['_RegisterBackgroundWorker'] =
      wasmExports['RegisterBackgroundWorker'])(a0))
  let _WaitForBackgroundWorkerStartup = (Module[
    '_WaitForBackgroundWorkerStartup'
  ] = (a0, a1) =>
    (_WaitForBackgroundWorkerStartup = Module[
      '_WaitForBackgroundWorkerStartup'
    ] =
      wasmExports['WaitForBackgroundWorkerStartup'])(a0, a1))
  let _open = (Module['_open'] = (a0, a1, a2) =>
    (_open = Module['_open'] = wasmExports['open'])(a0, a1, a2))
  let _rename = (Module['_rename'] = (a0, a1) =>
    (_rename = Module['_rename'] = wasmExports['rename'])(a0, a1))
  let _GetConfigOption = (Module['_GetConfigOption'] = (a0, a1, a2) =>
    (_GetConfigOption = Module['_GetConfigOption'] =
      wasmExports['GetConfigOption'])(a0, a1, a2))
  let _puts = (Module['_puts'] = (a0) =>
    (_puts = Module['_puts'] = wasmExports['puts'])(a0))
  let _fopen = (Module['_fopen'] = (a0, a1) =>
    (_fopen = Module['_fopen'] = wasmExports['fopen'])(a0, a1))
  let _fclose = (Module['_fclose'] = (a0) =>
    (_fclose = Module['_fclose'] = wasmExports['fclose'])(a0))
  let _fputc = (Module['_fputc'] = (a0, a1) =>
    (_fputc = Module['_fputc'] = wasmExports['fputc'])(a0, a1))
  let _ftello = (Module['_ftello'] = (a0) =>
    (_ftello = Module['_ftello'] = wasmExports['ftello'])(a0))
  let _malloc = (Module['_malloc'] = (a0) =>
    (_malloc = Module['_malloc'] = wasmExports['malloc'])(a0))
  let _free = (Module['_free'] = (a0) =>
    (_free = Module['_free'] = wasmExports['free'])(a0))
  let _realloc = (Module['_realloc'] = (a0, a1) =>
    (_realloc = Module['_realloc'] = wasmExports['realloc'])(a0, a1))
  let _iswprint_l = (Module['_iswprint_l'] = (a0, a1) =>
    (_iswprint_l = Module['_iswprint_l'] = wasmExports['iswprint_l'])(a0, a1))
  let _iswalpha_l = (Module['_iswalpha_l'] = (a0, a1) =>
    (_iswalpha_l = Module['_iswalpha_l'] = wasmExports['iswalpha_l'])(a0, a1))
  let _iswdigit_l = (Module['_iswdigit_l'] = (a0, a1) =>
    (_iswdigit_l = Module['_iswdigit_l'] = wasmExports['iswdigit_l'])(a0, a1))
  let _isdigit_l = (Module['_isdigit_l'] = (a0, a1) =>
    (_isdigit_l = Module['_isdigit_l'] = wasmExports['isdigit_l'])(a0, a1))
  let _iswpunct_l = (Module['_iswpunct_l'] = (a0, a1) =>
    (_iswpunct_l = Module['_iswpunct_l'] = wasmExports['iswpunct_l'])(a0, a1))
  let _iswspace_l = (Module['_iswspace_l'] = (a0, a1) =>
    (_iswspace_l = Module['_iswspace_l'] = wasmExports['iswspace_l'])(a0, a1))
  let _iswlower_l = (Module['_iswlower_l'] = (a0, a1) =>
    (_iswlower_l = Module['_iswlower_l'] = wasmExports['iswlower_l'])(a0, a1))
  let _iswupper_l = (Module['_iswupper_l'] = (a0, a1) =>
    (_iswupper_l = Module['_iswupper_l'] = wasmExports['iswupper_l'])(a0, a1))
  let _pg_ascii_tolower = (Module['_pg_ascii_tolower'] = (a0) =>
    (_pg_ascii_tolower = Module['_pg_ascii_tolower'] =
      wasmExports['pg_ascii_tolower'])(a0))
  let _towlower_l = (Module['_towlower_l'] = (a0, a1) =>
    (_towlower_l = Module['_towlower_l'] = wasmExports['towlower_l'])(a0, a1))
  let _tolower_l = (Module['_tolower_l'] = (a0, a1) =>
    (_tolower_l = Module['_tolower_l'] = wasmExports['tolower_l'])(a0, a1))
  let _towupper_l = (Module['_towupper_l'] = (a0, a1) =>
    (_towupper_l = Module['_towupper_l'] = wasmExports['towupper_l'])(a0, a1))
  let _toupper_l = (Module['_toupper_l'] = (a0, a1) =>
    (_toupper_l = Module['_toupper_l'] = wasmExports['toupper_l'])(a0, a1))
  let _pg_reg_getinitialstate = (Module['_pg_reg_getinitialstate'] = (a0) =>
    (_pg_reg_getinitialstate = Module['_pg_reg_getinitialstate'] =
      wasmExports['pg_reg_getinitialstate'])(a0))
  let _pg_reg_getfinalstate = (Module['_pg_reg_getfinalstate'] = (a0) =>
    (_pg_reg_getfinalstate = Module['_pg_reg_getfinalstate'] =
      wasmExports['pg_reg_getfinalstate'])(a0))
  let _pg_reg_getnumoutarcs = (Module['_pg_reg_getnumoutarcs'] = (a0, a1) =>
    (_pg_reg_getnumoutarcs = Module['_pg_reg_getnumoutarcs'] =
      wasmExports['pg_reg_getnumoutarcs'])(a0, a1))
  let _pg_reg_getoutarcs = (Module['_pg_reg_getoutarcs'] = (a0, a1, a2, a3) =>
    (_pg_reg_getoutarcs = Module['_pg_reg_getoutarcs'] =
      wasmExports['pg_reg_getoutarcs'])(a0, a1, a2, a3))
  let _pg_reg_getnumcolors = (Module['_pg_reg_getnumcolors'] = (a0) =>
    (_pg_reg_getnumcolors = Module['_pg_reg_getnumcolors'] =
      wasmExports['pg_reg_getnumcolors'])(a0))
  let _pg_reg_colorisbegin = (Module['_pg_reg_colorisbegin'] = (a0, a1) =>
    (_pg_reg_colorisbegin = Module['_pg_reg_colorisbegin'] =
      wasmExports['pg_reg_colorisbegin'])(a0, a1))
  let _pg_reg_colorisend = (Module['_pg_reg_colorisend'] = (a0, a1) =>
    (_pg_reg_colorisend = Module['_pg_reg_colorisend'] =
      wasmExports['pg_reg_colorisend'])(a0, a1))
  let _pg_reg_getnumcharacters = (Module['_pg_reg_getnumcharacters'] = (
    a0,
    a1,
  ) =>
    (_pg_reg_getnumcharacters = Module['_pg_reg_getnumcharacters'] =
      wasmExports['pg_reg_getnumcharacters'])(a0, a1))
  let _pg_reg_getcharacters = (Module['_pg_reg_getcharacters'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_pg_reg_getcharacters = Module['_pg_reg_getcharacters'] =
      wasmExports['pg_reg_getcharacters'])(a0, a1, a2, a3))
  let _dsa_pin = (Module['_dsa_pin'] = (a0) =>
    (_dsa_pin = Module['_dsa_pin'] = wasmExports['dsa_pin'])(a0))
  let _OutputPluginPrepareWrite = (Module['_OutputPluginPrepareWrite'] = (
    a0,
    a1,
  ) =>
    (_OutputPluginPrepareWrite = Module['_OutputPluginPrepareWrite'] =
      wasmExports['OutputPluginPrepareWrite'])(a0, a1))
  let _OutputPluginWrite = (Module['_OutputPluginWrite'] = (a0, a1) =>
    (_OutputPluginWrite = Module['_OutputPluginWrite'] =
      wasmExports['OutputPluginWrite'])(a0, a1))
  let _array_contains_nulls = (Module['_array_contains_nulls'] = (a0) =>
    (_array_contains_nulls = Module['_array_contains_nulls'] =
      wasmExports['array_contains_nulls'])(a0))
  let _CacheRegisterRelcacheCallback = (Module[
    '_CacheRegisterRelcacheCallback'
  ] = (a0, a1) =>
    (_CacheRegisterRelcacheCallback = Module['_CacheRegisterRelcacheCallback'] =
      wasmExports['CacheRegisterRelcacheCallback'])(a0, a1))
  let _hash_seq_term = (Module['_hash_seq_term'] = (a0) =>
    (_hash_seq_term = Module['_hash_seq_term'] = wasmExports['hash_seq_term'])(
      a0,
    ))
  let _FreeErrorData = (Module['_FreeErrorData'] = (a0) =>
    (_FreeErrorData = Module['_FreeErrorData'] = wasmExports['FreeErrorData'])(
      a0,
    ))
  let _RelidByRelfilenumber = (Module['_RelidByRelfilenumber'] = (a0, a1) =>
    (_RelidByRelfilenumber = Module['_RelidByRelfilenumber'] =
      wasmExports['RelidByRelfilenumber'])(a0, a1))
  let _SnapBuildRestoreSnapshot = (Module['_SnapBuildRestoreSnapshot'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_SnapBuildRestoreSnapshot = Module['_SnapBuildRestoreSnapshot'] =
      wasmExports['SnapBuildRestoreSnapshot'])(a0, a1, a2, a3))
  let _WaitLatchOrSocket = (Module['_WaitLatchOrSocket'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_WaitLatchOrSocket = Module['_WaitLatchOrSocket'] =
      wasmExports['WaitLatchOrSocket'])(a0, a1, a2, a3, a4))
  let _BufFileCreateFileSet = (Module['_BufFileCreateFileSet'] = (a0, a1) =>
    (_BufFileCreateFileSet = Module['_BufFileCreateFileSet'] =
      wasmExports['BufFileCreateFileSet'])(a0, a1))
  let _BufFileOpenFileSet = (Module['_BufFileOpenFileSet'] = (a0, a1, a2, a3) =>
    (_BufFileOpenFileSet = Module['_BufFileOpenFileSet'] =
      wasmExports['BufFileOpenFileSet'])(a0, a1, a2, a3))
  let _BufFileTell = (Module['_BufFileTell'] = (a0, a1, a2) =>
    (_BufFileTell = Module['_BufFileTell'] = wasmExports['BufFileTell'])(
      a0,
      a1,
      a2,
    ))
  let _ConditionVariablePrepareToSleep = (Module[
    '_ConditionVariablePrepareToSleep'
  ] = (a0) =>
    (_ConditionVariablePrepareToSleep = Module[
      '_ConditionVariablePrepareToSleep'
    ] =
      wasmExports['ConditionVariablePrepareToSleep'])(a0))
  let _get_row_security_policies = (Module['_get_row_security_policies'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_get_row_security_policies = Module['_get_row_security_policies'] =
      wasmExports['get_row_security_policies'])(a0, a1, a2, a3, a4, a5, a6))
  let _extract_variadic_args = (Module['_extract_variadic_args'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_extract_variadic_args = Module['_extract_variadic_args'] =
      wasmExports['extract_variadic_args'])(a0, a1, a2, a3, a4, a5))
  let _errhidestmt = (Module['_errhidestmt'] = (a0) =>
    (_errhidestmt = Module['_errhidestmt'] = wasmExports['errhidestmt'])(a0))
  let _hash_estimate_size = (Module['_hash_estimate_size'] = (a0, a1) =>
    (_hash_estimate_size = Module['_hash_estimate_size'] =
      wasmExports['hash_estimate_size'])(a0, a1))
  let _ShmemInitHash = (Module['_ShmemInitHash'] = (a0, a1, a2, a3, a4) =>
    (_ShmemInitHash = Module['_ShmemInitHash'] = wasmExports['ShmemInitHash'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _LockBufHdr = (Module['_LockBufHdr'] = (a0) =>
    (_LockBufHdr = Module['_LockBufHdr'] = wasmExports['LockBufHdr'])(a0))
  let _EvictUnpinnedBuffer = (Module['_EvictUnpinnedBuffer'] = (a0, a1) =>
    (_EvictUnpinnedBuffer = Module['_EvictUnpinnedBuffer'] =
      wasmExports['EvictUnpinnedBuffer'])(a0, a1))
  let _EvictAllUnpinnedBuffers = (Module['_EvictAllUnpinnedBuffers'] = (
    a0,
    a1,
    a2,
  ) =>
    (_EvictAllUnpinnedBuffers = Module['_EvictAllUnpinnedBuffers'] =
      wasmExports['EvictAllUnpinnedBuffers'])(a0, a1, a2))
  let _EvictRelUnpinnedBuffers = (Module['_EvictRelUnpinnedBuffers'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_EvictRelUnpinnedBuffers = Module['_EvictRelUnpinnedBuffers'] =
      wasmExports['EvictRelUnpinnedBuffers'])(a0, a1, a2, a3))
  let _have_free_buffer = (Module['_have_free_buffer'] = () =>
    (_have_free_buffer = Module['_have_free_buffer'] =
      wasmExports['have_free_buffer'])())
  let _calloc = (Module['_calloc'] = (a0, a1) =>
    (_calloc = Module['_calloc'] = wasmExports['calloc'])(a0, a1))
  let _BufFileExportFileSet = (Module['_BufFileExportFileSet'] = (a0) =>
    (_BufFileExportFileSet = Module['_BufFileExportFileSet'] =
      wasmExports['BufFileExportFileSet'])(a0))
  let _copy_file = (Module['_copy_file'] = (a0, a1) =>
    (_copy_file = Module['_copy_file'] = wasmExports['copy_file'])(a0, a1))
  let _fdatasync = (Module['_fdatasync'] = (a0) =>
    (_fdatasync = Module['_fdatasync'] = wasmExports['fdatasync'])(a0))
  let _truncate = (Module['_truncate'] = (a0, a1) =>
    (_truncate = Module['_truncate'] = wasmExports['truncate'])(a0, a1))
  let _dup = (Module['_dup'] = (a0) =>
    (_dup = Module['_dup'] = wasmExports['dup'])(a0))
  let _AcquireExternalFD = (Module['_AcquireExternalFD'] = () =>
    (_AcquireExternalFD = Module['_AcquireExternalFD'] =
      wasmExports['AcquireExternalFD'])())
  let _mkdir = (Module['_mkdir'] = (a0, a1) =>
    (_mkdir = Module['_mkdir'] = wasmExports['mkdir'])(a0, a1))
  let _pgl_popen = (Module['_pgl_popen'] = (a0, a1) =>
    (_pgl_popen = Module['_pgl_popen'] = wasmExports['pgl_popen'])(a0, a1))
  let _pgl_pclose = (Module['_pgl_pclose'] = (a0) =>
    (_pgl_pclose = Module['_pgl_pclose'] = wasmExports['pgl_pclose'])(a0))
  let _closedir = (Module['_closedir'] = (a0) =>
    (_closedir = Module['_closedir'] = wasmExports['closedir'])(a0))
  let _opendir = (Module['_opendir'] = (a0) =>
    (_opendir = Module['_opendir'] = wasmExports['opendir'])(a0))
  let _readdir = (Module['_readdir'] = (a0) =>
    (_readdir = Module['_readdir'] = wasmExports['readdir'])(a0))
  let _GetNamedDSMSegment = (Module['_GetNamedDSMSegment'] = (a0, a1, a2, a3) =>
    (_GetNamedDSMSegment = Module['_GetNamedDSMSegment'] =
      wasmExports['GetNamedDSMSegment'])(a0, a1, a2, a3))
  let _pgl_atexit = (Module['_pgl_atexit'] = (a0) =>
    (_pgl_atexit = Module['_pgl_atexit'] = wasmExports['pgl_atexit'])(a0))
  let _RequestAddinShmemSpace = (Module['_RequestAddinShmemSpace'] = (a0) =>
    (_RequestAddinShmemSpace = Module['_RequestAddinShmemSpace'] =
      wasmExports['RequestAddinShmemSpace'])(a0))
  let _GetRunningTransactionData = (Module['_GetRunningTransactionData'] = () =>
    (_GetRunningTransactionData = Module['_GetRunningTransactionData'] =
      wasmExports['GetRunningTransactionData'])())
  let _BackendXidGetPid = (Module['_BackendXidGetPid'] = (a0) =>
    (_BackendXidGetPid = Module['_BackendXidGetPid'] =
      wasmExports['BackendXidGetPid'])(a0))
  let _pg_numa_init = (Module['_pg_numa_init'] = () =>
    (_pg_numa_init = Module['_pg_numa_init'] = wasmExports['pg_numa_init'])())
  let _sysconf = (Module['_sysconf'] = (a0) =>
    (_sysconf = Module['_sysconf'] = wasmExports['sysconf'])(a0))
  let _pg_numa_query_pages = (Module['_pg_numa_query_pages'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_pg_numa_query_pages = Module['_pg_numa_query_pages'] =
      wasmExports['pg_numa_query_pages'])(a0, a1, a2, a3))
  let _pg_get_shmem_pagesize = (Module['_pg_get_shmem_pagesize'] = () =>
    (_pg_get_shmem_pagesize = Module['_pg_get_shmem_pagesize'] =
      wasmExports['pg_get_shmem_pagesize'])())
  let _pgl_poll = (Module['_pgl_poll'] = (a0, a1, a2) =>
    (_pgl_poll = Module['_pgl_poll'] = wasmExports['pgl_poll'])(a0, a1, a2))
  let _GetLockmodeName = (Module['_GetLockmodeName'] = (a0, a1) =>
    (_GetLockmodeName = Module['_GetLockmodeName'] =
      wasmExports['GetLockmodeName'])(a0, a1))
  let _LWLockRegisterTranche = (Module['_LWLockRegisterTranche'] = (a0, a1) =>
    (_LWLockRegisterTranche = Module['_LWLockRegisterTranche'] =
      wasmExports['LWLockRegisterTranche'])(a0, a1))
  let _GetNamedLWLockTranche = (Module['_GetNamedLWLockTranche'] = (a0) =>
    (_GetNamedLWLockTranche = Module['_GetNamedLWLockTranche'] =
      wasmExports['GetNamedLWLockTranche'])(a0))
  let _LWLockNewTrancheId = (Module['_LWLockNewTrancheId'] = () =>
    (_LWLockNewTrancheId = Module['_LWLockNewTrancheId'] =
      wasmExports['LWLockNewTrancheId'])())
  let _RequestNamedLWLockTranche = (Module['_RequestNamedLWLockTranche'] = (
    a0,
    a1,
  ) =>
    (_RequestNamedLWLockTranche = Module['_RequestNamedLWLockTranche'] =
      wasmExports['RequestNamedLWLockTranche'])(a0, a1))
  let _LWLockHeldByMe = (Module['_LWLockHeldByMe'] = (a0) =>
    (_LWLockHeldByMe = Module['_LWLockHeldByMe'] =
      wasmExports['LWLockHeldByMe'])(a0))
  let _ProcessStartupPacket = (Module['_ProcessStartupPacket'] = (a0, a1, a2) =>
    (_ProcessStartupPacket = Module['_ProcessStartupPacket'] =
      wasmExports['ProcessStartupPacket'])(a0, a1, a2))
  let _htons = (a0) => (_htons = wasmExports['htons'])(a0)
  let _htonl = (a0) => (_htonl = wasmExports['htonl'])(a0)
  let _pgl_startPGlite = (Module['_pgl_startPGlite'] = () =>
    (_pgl_startPGlite = Module['_pgl_startPGlite'] =
      wasmExports['pgl_startPGlite'])())
  let _pgl_pq_flush = (Module['_pgl_pq_flush'] = () =>
    (_pgl_pq_flush = Module['_pgl_pq_flush'] = wasmExports['pgl_pq_flush'])())
  let _pgl_getMyProcPort = (Module['_pgl_getMyProcPort'] = () =>
    (_pgl_getMyProcPort = Module['_pgl_getMyProcPort'] =
      wasmExports['pgl_getMyProcPort'])())
  let _pgl_sendConnData = (Module['_pgl_sendConnData'] = () =>
    (_pgl_sendConnData = Module['_pgl_sendConnData'] =
      wasmExports['pgl_sendConnData'])())
  let _PostgresMainLongJmp = (Module['_PostgresMainLongJmp'] = () =>
    (_PostgresMainLongJmp = Module['_PostgresMainLongJmp'] =
      wasmExports['PostgresMainLongJmp'])())
  let _PostgresMainLoopOnce = (Module['_PostgresMainLoopOnce'] = () =>
    (_PostgresMainLoopOnce = Module['_PostgresMainLoopOnce'] =
      wasmExports['PostgresMainLoopOnce'])())
  let _PostgresSendReadyForQueryIfNecessary = (Module[
    '_PostgresSendReadyForQueryIfNecessary'
  ] = () =>
    (_PostgresSendReadyForQueryIfNecessary = Module[
      '_PostgresSendReadyForQueryIfNecessary'
    ] =
      wasmExports['PostgresSendReadyForQueryIfNecessary'])())
  let _standard_ProcessUtility = (Module['_standard_ProcessUtility'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_standard_ProcessUtility = Module['_standard_ProcessUtility'] =
      wasmExports['standard_ProcessUtility'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _lookup_ts_dictionary_cache = (Module['_lookup_ts_dictionary_cache'] = (
    a0,
  ) =>
    (_lookup_ts_dictionary_cache = Module['_lookup_ts_dictionary_cache'] =
      wasmExports['lookup_ts_dictionary_cache'])(a0))
  let _get_tsearch_config_filename = (Module['_get_tsearch_config_filename'] = (
    a0,
    a1,
  ) =>
    (_get_tsearch_config_filename = Module['_get_tsearch_config_filename'] =
      wasmExports['get_tsearch_config_filename'])(a0, a1))
  let _str_tolower = (Module['_str_tolower'] = (a0, a1, a2) =>
    (_str_tolower = Module['_str_tolower'] = wasmExports['str_tolower'])(
      a0,
      a1,
      a2,
    ))
  let _readstoplist = (Module['_readstoplist'] = (a0, a1, a2) =>
    (_readstoplist = Module['_readstoplist'] = wasmExports['readstoplist'])(
      a0,
      a1,
      a2,
    ))
  let _searchstoplist = (Module['_searchstoplist'] = (a0, a1) =>
    (_searchstoplist = Module['_searchstoplist'] =
      wasmExports['searchstoplist'])(a0, a1))
  let _tsearch_readline_begin = (Module['_tsearch_readline_begin'] = (a0, a1) =>
    (_tsearch_readline_begin = Module['_tsearch_readline_begin'] =
      wasmExports['tsearch_readline_begin'])(a0, a1))
  let _tsearch_readline = (Module['_tsearch_readline'] = (a0) =>
    (_tsearch_readline = Module['_tsearch_readline'] =
      wasmExports['tsearch_readline'])(a0))
  let _tsearch_readline_end = (Module['_tsearch_readline_end'] = (a0) =>
    (_tsearch_readline_end = Module['_tsearch_readline_end'] =
      wasmExports['tsearch_readline_end'])(a0))
  let _stringToQualifiedNameList = (Module['_stringToQualifiedNameList'] = (
    a0,
    a1,
  ) =>
    (_stringToQualifiedNameList = Module['_stringToQualifiedNameList'] =
      wasmExports['stringToQualifiedNameList'])(a0, a1))
  let _to_tsvector_byid = (Module['_to_tsvector_byid'] = (a0) =>
    (_to_tsvector_byid = Module['_to_tsvector_byid'] =
      wasmExports['to_tsvector_byid'])(a0))
  let _t_isalnum_with_len = (Module['_t_isalnum_with_len'] = (a0, a1) =>
    (_t_isalnum_with_len = Module['_t_isalnum_with_len'] =
      wasmExports['t_isalnum_with_len'])(a0, a1))
  let _isalnum = (Module['_isalnum'] = (a0) =>
    (_isalnum = Module['_isalnum'] = wasmExports['isalnum'])(a0))
  let _t_isalnum_cstr = (Module['_t_isalnum_cstr'] = (a0) =>
    (_t_isalnum_cstr = Module['_t_isalnum_cstr'] =
      wasmExports['t_isalnum_cstr'])(a0))
  let _pg_mblen_unbounded = (Module['_pg_mblen_unbounded'] = (a0) =>
    (_pg_mblen_unbounded = Module['_pg_mblen_unbounded'] =
      wasmExports['pg_mblen_unbounded'])(a0))
  let _get_restriction_variable = (Module['_get_restriction_variable'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) =>
    (_get_restriction_variable = Module['_get_restriction_variable'] =
      wasmExports['get_restriction_variable'])(a0, a1, a2, a3, a4, a5))
  let _pg_mblen_range = (Module['_pg_mblen_range'] = (a0, a1) =>
    (_pg_mblen_range = Module['_pg_mblen_range'] =
      wasmExports['pg_mblen_range'])(a0, a1))
  let _MemoryContextAllocHuge = (Module['_MemoryContextAllocHuge'] = (a0, a1) =>
    (_MemoryContextAllocHuge = Module['_MemoryContextAllocHuge'] =
      wasmExports['MemoryContextAllocHuge'])(a0, a1))
  let _fseek = (Module['_fseek'] = (a0, a1, a2) =>
    (_fseek = Module['_fseek'] = wasmExports['fseek'])(a0, a1, a2))
  let _WaitEventExtensionNew = (Module['_WaitEventExtensionNew'] = (a0) =>
    (_WaitEventExtensionNew = Module['_WaitEventExtensionNew'] =
      wasmExports['WaitEventExtensionNew'])(a0))
  let _pg_popcount64 = (Module['_pg_popcount64'] = (a0) =>
    (_pg_popcount64 = Module['_pg_popcount64'] = wasmExports['pg_popcount64'])(
      a0,
    ))
  let _expand_array = (Module['_expand_array'] = (a0, a1, a2) =>
    (_expand_array = Module['_expand_array'] = wasmExports['expand_array'])(
      a0,
      a1,
      a2,
    ))
  let _exp = (Module['_exp'] = (a0) =>
    (_exp = Module['_exp'] = wasmExports['exp'])(a0))
  let _arraycontsel = (Module['_arraycontsel'] = (a0) =>
    (_arraycontsel = Module['_arraycontsel'] = wasmExports['arraycontsel'])(a0))
  let _arraycontjoinsel = (Module['_arraycontjoinsel'] = (a0) =>
    (_arraycontjoinsel = Module['_arraycontjoinsel'] =
      wasmExports['arraycontjoinsel'])(a0))
  let _initArrayResult = (Module['_initArrayResult'] = (a0, a1, a2) =>
    (_initArrayResult = Module['_initArrayResult'] =
      wasmExports['initArrayResult'])(a0, a1, a2))
  let _array_create_iterator = (Module['_array_create_iterator'] = (
    a0,
    a1,
    a2,
  ) =>
    (_array_create_iterator = Module['_array_create_iterator'] =
      wasmExports['array_create_iterator'])(a0, a1, a2))
  let _array_iterate = (Module['_array_iterate'] = (a0, a1, a2) =>
    (_array_iterate = Module['_array_iterate'] = wasmExports['array_iterate'])(
      a0,
      a1,
      a2,
    ))
  let _array_free_iterator = (Module['_array_free_iterator'] = (a0) =>
    (_array_free_iterator = Module['_array_free_iterator'] =
      wasmExports['array_free_iterator'])(a0))
  let _ArrayGetIntegerTypmods = (Module['_ArrayGetIntegerTypmods'] = (a0, a1) =>
    (_ArrayGetIntegerTypmods = Module['_ArrayGetIntegerTypmods'] =
      wasmExports['ArrayGetIntegerTypmods'])(a0, a1))
  let _boolin = (Module['_boolin'] = (a0) =>
    (_boolin = Module['_boolin'] = wasmExports['boolin'])(a0))
  let ___multi3 = (Module['___multi3'] = (a0, a1, a2, a3, a4) =>
    (___multi3 = Module['___multi3'] = wasmExports['__multi3'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _cash_cmp = (Module['_cash_cmp'] = (a0) =>
    (_cash_cmp = Module['_cash_cmp'] = wasmExports['cash_cmp'])(a0))
  let _int64_to_numeric = (Module['_int64_to_numeric'] = (a0) =>
    (_int64_to_numeric = Module['_int64_to_numeric'] =
      wasmExports['int64_to_numeric'])(a0))
  let _numeric_div = (Module['_numeric_div'] = (a0) =>
    (_numeric_div = Module['_numeric_div'] = wasmExports['numeric_div'])(a0))
  let _numeric_round = (Module['_numeric_round'] = (a0) =>
    (_numeric_round = Module['_numeric_round'] = wasmExports['numeric_round'])(
      a0,
    ))
  let _numeric_int8 = (Module['_numeric_int8'] = (a0) =>
    (_numeric_int8 = Module['_numeric_int8'] = wasmExports['numeric_int8'])(a0))
  let _numeric_mul = (Module['_numeric_mul'] = (a0) =>
    (_numeric_mul = Module['_numeric_mul'] = wasmExports['numeric_mul'])(a0))
  let _j2date = (Module['_j2date'] = (a0, a1, a2, a3) =>
    (_j2date = Module['_j2date'] = wasmExports['j2date'])(a0, a1, a2, a3))
  let _EncodeDateOnly = (Module['_EncodeDateOnly'] = (a0, a1, a2) =>
    (_EncodeDateOnly = Module['_EncodeDateOnly'] =
      wasmExports['EncodeDateOnly'])(a0, a1, a2))
  let _EncodeSpecialDate = (Module['_EncodeSpecialDate'] = (a0, a1) =>
    (_EncodeSpecialDate = Module['_EncodeSpecialDate'] =
      wasmExports['EncodeSpecialDate'])(a0, a1))
  let _date_eq = (Module['_date_eq'] = (a0) =>
    (_date_eq = Module['_date_eq'] = wasmExports['date_eq'])(a0))
  let _date_lt = (Module['_date_lt'] = (a0) =>
    (_date_lt = Module['_date_lt'] = wasmExports['date_lt'])(a0))
  let _date_le = (Module['_date_le'] = (a0) =>
    (_date_le = Module['_date_le'] = wasmExports['date_le'])(a0))
  let _date_gt = (Module['_date_gt'] = (a0) =>
    (_date_gt = Module['_date_gt'] = wasmExports['date_gt'])(a0))
  let _date_ge = (Module['_date_ge'] = (a0) =>
    (_date_ge = Module['_date_ge'] = wasmExports['date_ge'])(a0))
  let _date_cmp = (Module['_date_cmp'] = (a0) =>
    (_date_cmp = Module['_date_cmp'] = wasmExports['date_cmp'])(a0))
  let _date_mi = (Module['_date_mi'] = (a0) =>
    (_date_mi = Module['_date_mi'] = wasmExports['date_mi'])(a0))
  let _timestamp2tm = (Module['_timestamp2tm'] = (a0, a1, a2, a3, a4, a5) =>
    (_timestamp2tm = Module['_timestamp2tm'] = wasmExports['timestamp2tm'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
    ))
  let _time2tm = (Module['_time2tm'] = (a0, a1, a2) =>
    (_time2tm = Module['_time2tm'] = wasmExports['time2tm'])(a0, a1, a2))
  let _EncodeTimeOnly = (Module['_EncodeTimeOnly'] = (a0, a1, a2, a3, a4, a5) =>
    (_EncodeTimeOnly = Module['_EncodeTimeOnly'] =
      wasmExports['EncodeTimeOnly'])(a0, a1, a2, a3, a4, a5))
  let _time_eq = (Module['_time_eq'] = (a0) =>
    (_time_eq = Module['_time_eq'] = wasmExports['time_eq'])(a0))
  let _time_lt = (Module['_time_lt'] = (a0) =>
    (_time_lt = Module['_time_lt'] = wasmExports['time_lt'])(a0))
  let _time_le = (Module['_time_le'] = (a0) =>
    (_time_le = Module['_time_le'] = wasmExports['time_le'])(a0))
  let _time_gt = (Module['_time_gt'] = (a0) =>
    (_time_gt = Module['_time_gt'] = wasmExports['time_gt'])(a0))
  let _time_ge = (Module['_time_ge'] = (a0) =>
    (_time_ge = Module['_time_ge'] = wasmExports['time_ge'])(a0))
  let _time_cmp = (Module['_time_cmp'] = (a0) =>
    (_time_cmp = Module['_time_cmp'] = wasmExports['time_cmp'])(a0))
  let _time_mi_time = (Module['_time_mi_time'] = (a0) =>
    (_time_mi_time = Module['_time_mi_time'] = wasmExports['time_mi_time'])(a0))
  let _timetz2tm = (Module['_timetz2tm'] = (a0, a1, a2, a3) =>
    (_timetz2tm = Module['_timetz2tm'] = wasmExports['timetz2tm'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _timetz_cmp = (Module['_timetz_cmp'] = (a0) =>
    (_timetz_cmp = Module['_timetz_cmp'] = wasmExports['timetz_cmp'])(a0))
  let _pg_tolower = (Module['_pg_tolower'] = (a0) =>
    (_pg_tolower = Module['_pg_tolower'] = wasmExports['pg_tolower'])(a0))
  let _EncodeDateTime = (Module['_EncodeDateTime'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ) =>
    (_EncodeDateTime = Module['_EncodeDateTime'] =
      wasmExports['EncodeDateTime'])(a0, a1, a2, a3, a4, a5, a6))
  let _TransferExpandedObject = (Module['_TransferExpandedObject'] = (a0, a1) =>
    (_TransferExpandedObject = Module['_TransferExpandedObject'] =
      wasmExports['TransferExpandedObject'])(a0, a1))
  let _forkname_to_number = (Module['_forkname_to_number'] = (a0) =>
    (_forkname_to_number = Module['_forkname_to_number'] =
      wasmExports['forkname_to_number'])(a0))
  let _numeric_lt = (Module['_numeric_lt'] = (a0) =>
    (_numeric_lt = Module['_numeric_lt'] = wasmExports['numeric_lt'])(a0))
  let _numeric_abs = (Module['_numeric_abs'] = (a0) =>
    (_numeric_abs = Module['_numeric_abs'] = wasmExports['numeric_abs'])(a0))
  let _numeric_add = (Module['_numeric_add'] = (a0) =>
    (_numeric_add = Module['_numeric_add'] = wasmExports['numeric_add'])(a0))
  let _numeric_ge = (Module['_numeric_ge'] = (a0) =>
    (_numeric_ge = Module['_numeric_ge'] = wasmExports['numeric_ge'])(a0))
  let _err_generic_string = (Module['_err_generic_string'] = (a0, a1) =>
    (_err_generic_string = Module['_err_generic_string'] =
      wasmExports['err_generic_string'])(a0, a1))
  let _domain_check = (Module['_domain_check'] = (a0, a1, a2, a3, a4) =>
    (_domain_check = Module['_domain_check'] = wasmExports['domain_check'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _enum_lt = (Module['_enum_lt'] = (a0) =>
    (_enum_lt = Module['_enum_lt'] = wasmExports['enum_lt'])(a0))
  let _enum_le = (Module['_enum_le'] = (a0) =>
    (_enum_le = Module['_enum_le'] = wasmExports['enum_le'])(a0))
  let _enum_ge = (Module['_enum_ge'] = (a0) =>
    (_enum_ge = Module['_enum_ge'] = wasmExports['enum_ge'])(a0))
  let _enum_gt = (Module['_enum_gt'] = (a0) =>
    (_enum_gt = Module['_enum_gt'] = wasmExports['enum_gt'])(a0))
  let _enum_cmp = (Module['_enum_cmp'] = (a0) =>
    (_enum_cmp = Module['_enum_cmp'] = wasmExports['enum_cmp'])(a0))
  let _make_expanded_record_from_typeid = (Module[
    '_make_expanded_record_from_typeid'
  ] = (a0, a1, a2) =>
    (_make_expanded_record_from_typeid = Module[
      '_make_expanded_record_from_typeid'
    ] =
      wasmExports['make_expanded_record_from_typeid'])(a0, a1, a2))
  let _make_expanded_record_from_tupdesc = (Module[
    '_make_expanded_record_from_tupdesc'
  ] = (a0, a1) =>
    (_make_expanded_record_from_tupdesc = Module[
      '_make_expanded_record_from_tupdesc'
    ] =
      wasmExports['make_expanded_record_from_tupdesc'])(a0, a1))
  let _make_expanded_record_from_exprecord = (Module[
    '_make_expanded_record_from_exprecord'
  ] = (a0, a1) =>
    (_make_expanded_record_from_exprecord = Module[
      '_make_expanded_record_from_exprecord'
    ] =
      wasmExports['make_expanded_record_from_exprecord'])(a0, a1))
  let _expanded_record_set_tuple = (Module['_expanded_record_set_tuple'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_expanded_record_set_tuple = Module['_expanded_record_set_tuple'] =
      wasmExports['expanded_record_set_tuple'])(a0, a1, a2, a3))
  let _expanded_record_get_tuple = (Module['_expanded_record_get_tuple'] = (
    a0,
  ) =>
    (_expanded_record_get_tuple = Module['_expanded_record_get_tuple'] =
      wasmExports['expanded_record_get_tuple'])(a0))
  let _deconstruct_expanded_record = (Module['_deconstruct_expanded_record'] = (
    a0,
  ) =>
    (_deconstruct_expanded_record = Module['_deconstruct_expanded_record'] =
      wasmExports['deconstruct_expanded_record'])(a0))
  let _expanded_record_lookup_field = (Module['_expanded_record_lookup_field'] =
    (a0, a1, a2) =>
      (_expanded_record_lookup_field = Module['_expanded_record_lookup_field'] =
        wasmExports['expanded_record_lookup_field'])(a0, a1, a2))
  let _expanded_record_set_field_internal = (Module[
    '_expanded_record_set_field_internal'
  ] = (a0, a1, a2, a3, a4, a5) =>
    (_expanded_record_set_field_internal = Module[
      '_expanded_record_set_field_internal'
    ] =
      wasmExports['expanded_record_set_field_internal'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
    ))
  let _expanded_record_set_fields = (Module['_expanded_record_set_fields'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_expanded_record_set_fields = Module['_expanded_record_set_fields'] =
      wasmExports['expanded_record_set_fields'])(a0, a1, a2, a3))
  let _float4in_internal = (Module['_float4in_internal'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_float4in_internal = Module['_float4in_internal'] =
      wasmExports['float4in_internal'])(a0, a1, a2, a3, a4))
  let _strtof = (Module['_strtof'] = (a0, a1) =>
    (_strtof = Module['_strtof'] = wasmExports['strtof'])(a0, a1))
  let _float_to_shortest_decimal_buf = (Module[
    '_float_to_shortest_decimal_buf'
  ] = (a0, a1) =>
    (_float_to_shortest_decimal_buf = Module['_float_to_shortest_decimal_buf'] =
      wasmExports['float_to_shortest_decimal_buf'])(a0, a1))
  let _float8in = (Module['_float8in'] = (a0) =>
    (_float8in = Module['_float8in'] = wasmExports['float8in'])(a0))
  let _float8in_internal = (Module['_float8in_internal'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_float8in_internal = Module['_float8in_internal'] =
      wasmExports['float8in_internal'])(a0, a1, a2, a3, a4))
  let _float8out = (Module['_float8out'] = (a0) =>
    (_float8out = Module['_float8out'] = wasmExports['float8out'])(a0))
  let _float8out_internal = (Module['_float8out_internal'] = (a0) =>
    (_float8out_internal = Module['_float8out_internal'] =
      wasmExports['float8out_internal'])(a0))
  let _float8pl = (Module['_float8pl'] = (a0) =>
    (_float8pl = Module['_float8pl'] = wasmExports['float8pl'])(a0))
  let _float4_cmp_internal = (Module['_float4_cmp_internal'] = (a0, a1) =>
    (_float4_cmp_internal = Module['_float4_cmp_internal'] =
      wasmExports['float4_cmp_internal'])(a0, a1))
  let _btfloat4cmp = (Module['_btfloat4cmp'] = (a0) =>
    (_btfloat4cmp = Module['_btfloat4cmp'] = wasmExports['btfloat4cmp'])(a0))
  let _btfloat8cmp = (Module['_btfloat8cmp'] = (a0) =>
    (_btfloat8cmp = Module['_btfloat8cmp'] = wasmExports['btfloat8cmp'])(a0))
  let _dtoi4 = (Module['_dtoi4'] = (a0) =>
    (_dtoi4 = Module['_dtoi4'] = wasmExports['dtoi4'])(a0))
  let _dtoi2 = (Module['_dtoi2'] = (a0) =>
    (_dtoi2 = Module['_dtoi2'] = wasmExports['dtoi2'])(a0))
  let _cbrt = (Module['_cbrt'] = (a0) =>
    (_cbrt = Module['_cbrt'] = wasmExports['cbrt'])(a0))
  let _dexp = (Module['_dexp'] = (a0) =>
    (_dexp = Module['_dexp'] = wasmExports['dexp'])(a0))
  let _log10 = (Module['_log10'] = (a0) =>
    (_log10 = Module['_log10'] = wasmExports['log10'])(a0))
  let _dacos = (Module['_dacos'] = (a0) =>
    (_dacos = Module['_dacos'] = wasmExports['dacos'])(a0))
  let _acos = (Module['_acos'] = (a0) =>
    (_acos = Module['_acos'] = wasmExports['acos'])(a0))
  let _dasin = (Module['_dasin'] = (a0) =>
    (_dasin = Module['_dasin'] = wasmExports['dasin'])(a0))
  let _asin = (Module['_asin'] = (a0) =>
    (_asin = Module['_asin'] = wasmExports['asin'])(a0))
  let _datan = (Module['_datan'] = (a0) =>
    (_datan = Module['_datan'] = wasmExports['datan'])(a0))
  let _atan = (Module['_atan'] = (a0) =>
    (_atan = Module['_atan'] = wasmExports['atan'])(a0))
  let _datan2 = (Module['_datan2'] = (a0) =>
    (_datan2 = Module['_datan2'] = wasmExports['datan2'])(a0))
  let _atan2 = (Module['_atan2'] = (a0, a1) =>
    (_atan2 = Module['_atan2'] = wasmExports['atan2'])(a0, a1))
  let _dcos = (Module['_dcos'] = (a0) =>
    (_dcos = Module['_dcos'] = wasmExports['dcos'])(a0))
  let _cos = (Module['_cos'] = (a0) =>
    (_cos = Module['_cos'] = wasmExports['cos'])(a0))
  let _dcot = (Module['_dcot'] = (a0) =>
    (_dcot = Module['_dcot'] = wasmExports['dcot'])(a0))
  let _tan = (Module['_tan'] = (a0) =>
    (_tan = Module['_tan'] = wasmExports['tan'])(a0))
  let _dsin = (Module['_dsin'] = (a0) =>
    (_dsin = Module['_dsin'] = wasmExports['dsin'])(a0))
  let _sin = (Module['_sin'] = (a0) =>
    (_sin = Module['_sin'] = wasmExports['sin'])(a0))
  let _dtan = (Module['_dtan'] = (a0) =>
    (_dtan = Module['_dtan'] = wasmExports['dtan'])(a0))
  let _fmod = (Module['_fmod'] = (a0, a1) =>
    (_fmod = Module['_fmod'] = wasmExports['fmod'])(a0, a1))
  let _degrees = (Module['_degrees'] = (a0) =>
    (_degrees = Module['_degrees'] = wasmExports['degrees'])(a0))
  let _dpi = (Module['_dpi'] = (a0) =>
    (_dpi = Module['_dpi'] = wasmExports['dpi'])(a0))
  let _radians = (Module['_radians'] = (a0) =>
    (_radians = Module['_radians'] = wasmExports['radians'])(a0))
  let _sinh = (Module['_sinh'] = (a0) =>
    (_sinh = Module['_sinh'] = wasmExports['sinh'])(a0))
  let _cosh = (Module['_cosh'] = (a0) =>
    (_cosh = Module['_cosh'] = wasmExports['cosh'])(a0))
  let _tanh = (Module['_tanh'] = (a0) =>
    (_tanh = Module['_tanh'] = wasmExports['tanh'])(a0))
  let _asinh = (Module['_asinh'] = (a0) =>
    (_asinh = Module['_asinh'] = wasmExports['asinh'])(a0))
  let _acosh = (Module['_acosh'] = (a0) =>
    (_acosh = Module['_acosh'] = wasmExports['acosh'])(a0))
  let _atanh = (Module['_atanh'] = (a0) =>
    (_atanh = Module['_atanh'] = wasmExports['atanh'])(a0))
  let _float8_accum = (Module['_float8_accum'] = (a0) =>
    (_float8_accum = Module['_float8_accum'] = wasmExports['float8_accum'])(a0))
  let _float8_stddev_pop = (Module['_float8_stddev_pop'] = (a0) =>
    (_float8_stddev_pop = Module['_float8_stddev_pop'] =
      wasmExports['float8_stddev_pop'])(a0))
  let _float8_stddev_samp = (Module['_float8_stddev_samp'] = (a0) =>
    (_float8_stddev_samp = Module['_float8_stddev_samp'] =
      wasmExports['float8_stddev_samp'])(a0))
  let _asc_tolower = (Module['_asc_tolower'] = (a0, a1) =>
    (_asc_tolower = Module['_asc_tolower'] = wasmExports['asc_tolower'])(
      a0,
      a1,
    ))
  let _pg_strfold = (Module['_pg_strfold'] = (a0, a1, a2, a3, a4) =>
    (_pg_strfold = Module['_pg_strfold'] = wasmExports['pg_strfold'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _numeric_power = (Module['_numeric_power'] = (a0) =>
    (_numeric_power = Module['_numeric_power'] = wasmExports['numeric_power'])(
      a0,
    ))
  let _dtoi8 = (Module['_dtoi8'] = (a0) =>
    (_dtoi8 = Module['_dtoi8'] = wasmExports['dtoi8'])(a0))
  let _int8out = (Module['_int8out'] = (a0) =>
    (_int8out = Module['_int8out'] = wasmExports['int8out'])(a0))
  let _fseeko = (Module['_fseeko'] = (a0, a1, a2) =>
    (_fseeko = Module['_fseeko'] = wasmExports['fseeko'])(a0, a1, a2))
  let _int4in = (Module['_int4in'] = (a0) =>
    (_int4in = Module['_int4in'] = wasmExports['int4in'])(a0))
  let _int4_bool = (Module['_int4_bool'] = (a0) =>
    (_int4_bool = Module['_int4_bool'] = wasmExports['int4_bool'])(a0))
  let _int8pl = (Module['_int8pl'] = (a0) =>
    (_int8pl = Module['_int8pl'] = wasmExports['int8pl'])(a0))
  let _int84 = (Module['_int84'] = (a0) =>
    (_int84 = Module['_int84'] = wasmExports['int84'])(a0))
  let _int82 = (Module['_int82'] = (a0) =>
    (_int82 = Module['_int82'] = wasmExports['int82'])(a0))
  let _json_in = (Module['_json_in'] = (a0) =>
    (_json_in = Module['_json_in'] = wasmExports['json_in'])(a0))
  let _EncodeSpecialTimestamp = (Module['_EncodeSpecialTimestamp'] = (a0, a1) =>
    (_EncodeSpecialTimestamp = Module['_EncodeSpecialTimestamp'] =
      wasmExports['EncodeSpecialTimestamp'])(a0, a1))
  let _pushJsonbValue = (Module['_pushJsonbValue'] = (a0, a1, a2) =>
    (_pushJsonbValue = Module['_pushJsonbValue'] =
      wasmExports['pushJsonbValue'])(a0, a1, a2))
  let _numeric_int2 = (Module['_numeric_int2'] = (a0) =>
    (_numeric_int2 = Module['_numeric_int2'] = wasmExports['numeric_int2'])(a0))
  let _numeric_int4 = (Module['_numeric_int4'] = (a0) =>
    (_numeric_int4 = Module['_numeric_int4'] = wasmExports['numeric_int4'])(a0))
  let _numeric_float4 = (Module['_numeric_float4'] = (a0) =>
    (_numeric_float4 = Module['_numeric_float4'] =
      wasmExports['numeric_float4'])(a0))
  let _numeric_normalize = (Module['_numeric_normalize'] = (a0) =>
    (_numeric_normalize = Module['_numeric_normalize'] =
      wasmExports['numeric_normalize'])(a0))
  let _numeric_cmp = (Module['_numeric_cmp'] = (a0) =>
    (_numeric_cmp = Module['_numeric_cmp'] = wasmExports['numeric_cmp'])(a0))
  let _numeric_eq = (Module['_numeric_eq'] = (a0) =>
    (_numeric_eq = Module['_numeric_eq'] = wasmExports['numeric_eq'])(a0))
  let _hash_numeric = (Module['_hash_numeric'] = (a0) =>
    (_hash_numeric = Module['_hash_numeric'] = wasmExports['hash_numeric'])(a0))
  let _hash_numeric_extended = (Module['_hash_numeric_extended'] = (a0) =>
    (_hash_numeric_extended = Module['_hash_numeric_extended'] =
      wasmExports['hash_numeric_extended'])(a0))
  let _int2_numeric = (Module['_int2_numeric'] = (a0) =>
    (_int2_numeric = Module['_int2_numeric'] = wasmExports['int2_numeric'])(a0))
  let _int4_numeric = (Module['_int4_numeric'] = (a0) =>
    (_int4_numeric = Module['_int4_numeric'] = wasmExports['int4_numeric'])(a0))
  let _int8_numeric = (Module['_int8_numeric'] = (a0) =>
    (_int8_numeric = Module['_int8_numeric'] = wasmExports['int8_numeric'])(a0))
  let _float4_numeric = (Module['_float4_numeric'] = (a0) =>
    (_float4_numeric = Module['_float4_numeric'] =
      wasmExports['float4_numeric'])(a0))
  let _float8_numeric = (Module['_float8_numeric'] = (a0) =>
    (_float8_numeric = Module['_float8_numeric'] =
      wasmExports['float8_numeric'])(a0))
  let _numeric_uminus = (Module['_numeric_uminus'] = (a0) =>
    (_numeric_uminus = Module['_numeric_uminus'] =
      wasmExports['numeric_uminus'])(a0))
  let _numeric_is_nan = (Module['_numeric_is_nan'] = (a0) =>
    (_numeric_is_nan = Module['_numeric_is_nan'] =
      wasmExports['numeric_is_nan'])(a0))
  let _numeric_ceil = (Module['_numeric_ceil'] = (a0) =>
    (_numeric_ceil = Module['_numeric_ceil'] = wasmExports['numeric_ceil'])(a0))
  let _numeric_floor = (Module['_numeric_floor'] = (a0) =>
    (_numeric_floor = Module['_numeric_floor'] = wasmExports['numeric_floor'])(
      a0,
    ))
  let _timestamp_cmp = (Module['_timestamp_cmp'] = (a0) =>
    (_timestamp_cmp = Module['_timestamp_cmp'] = wasmExports['timestamp_cmp'])(
      a0,
    ))
  let _macaddr_cmp = (Module['_macaddr_cmp'] = (a0) =>
    (_macaddr_cmp = Module['_macaddr_cmp'] = wasmExports['macaddr_cmp'])(a0))
  let _macaddr_lt = (Module['_macaddr_lt'] = (a0) =>
    (_macaddr_lt = Module['_macaddr_lt'] = wasmExports['macaddr_lt'])(a0))
  let _macaddr_le = (Module['_macaddr_le'] = (a0) =>
    (_macaddr_le = Module['_macaddr_le'] = wasmExports['macaddr_le'])(a0))
  let _macaddr_eq = (Module['_macaddr_eq'] = (a0) =>
    (_macaddr_eq = Module['_macaddr_eq'] = wasmExports['macaddr_eq'])(a0))
  let _macaddr_ge = (Module['_macaddr_ge'] = (a0) =>
    (_macaddr_ge = Module['_macaddr_ge'] = wasmExports['macaddr_ge'])(a0))
  let _macaddr_gt = (Module['_macaddr_gt'] = (a0) =>
    (_macaddr_gt = Module['_macaddr_gt'] = wasmExports['macaddr_gt'])(a0))
  let _macaddr8_cmp = (Module['_macaddr8_cmp'] = (a0) =>
    (_macaddr8_cmp = Module['_macaddr8_cmp'] = wasmExports['macaddr8_cmp'])(a0))
  let _macaddr8_lt = (Module['_macaddr8_lt'] = (a0) =>
    (_macaddr8_lt = Module['_macaddr8_lt'] = wasmExports['macaddr8_lt'])(a0))
  let _macaddr8_le = (Module['_macaddr8_le'] = (a0) =>
    (_macaddr8_le = Module['_macaddr8_le'] = wasmExports['macaddr8_le'])(a0))
  let _macaddr8_eq = (Module['_macaddr8_eq'] = (a0) =>
    (_macaddr8_eq = Module['_macaddr8_eq'] = wasmExports['macaddr8_eq'])(a0))
  let _macaddr8_ge = (Module['_macaddr8_ge'] = (a0) =>
    (_macaddr8_ge = Module['_macaddr8_ge'] = wasmExports['macaddr8_ge'])(a0))
  let _macaddr8_gt = (Module['_macaddr8_gt'] = (a0) =>
    (_macaddr8_gt = Module['_macaddr8_gt'] = wasmExports['macaddr8_gt'])(a0))
  let _current_query = (Module['_current_query'] = (a0) =>
    (_current_query = Module['_current_query'] = wasmExports['current_query'])(
      a0,
    ))
  let _get_fn_expr_arg_stable = (Module['_get_fn_expr_arg_stable'] = (a0, a1) =>
    (_get_fn_expr_arg_stable = Module['_get_fn_expr_arg_stable'] =
      wasmExports['get_fn_expr_arg_stable'])(a0, a1))
  let _unpack_sql_state = (Module['_unpack_sql_state'] = (a0) =>
    (_unpack_sql_state = Module['_unpack_sql_state'] =
      wasmExports['unpack_sql_state'])(a0))
  let _get_fn_expr_rettype = (Module['_get_fn_expr_rettype'] = (a0) =>
    (_get_fn_expr_rettype = Module['_get_fn_expr_rettype'] =
      wasmExports['get_fn_expr_rettype'])(a0))
  let _btnamecmp = (Module['_btnamecmp'] = (a0) =>
    (_btnamecmp = Module['_btnamecmp'] = wasmExports['btnamecmp'])(a0))
  let _inet_in = (Module['_inet_in'] = (a0) =>
    (_inet_in = Module['_inet_in'] = wasmExports['inet_in'])(a0))
  let _network_cmp = (Module['_network_cmp'] = (a0) =>
    (_network_cmp = Module['_network_cmp'] = wasmExports['network_cmp'])(a0))
  let _convert_network_to_scalar = (Module['_convert_network_to_scalar'] = (
    a0,
    a1,
    a2,
  ) =>
    (_convert_network_to_scalar = Module['_convert_network_to_scalar'] =
      wasmExports['convert_network_to_scalar'])(a0, a1, a2))
  let _numeric_sign = (Module['_numeric_sign'] = (a0) =>
    (_numeric_sign = Module['_numeric_sign'] = wasmExports['numeric_sign'])(a0))
  let _numeric_gt = (Module['_numeric_gt'] = (a0) =>
    (_numeric_gt = Module['_numeric_gt'] = wasmExports['numeric_gt'])(a0))
  let _numeric_le = (Module['_numeric_le'] = (a0) =>
    (_numeric_le = Module['_numeric_le'] = wasmExports['numeric_le'])(a0))
  let _numeric_mod = (Module['_numeric_mod'] = (a0) =>
    (_numeric_mod = Module['_numeric_mod'] = wasmExports['numeric_mod'])(a0))
  let _numeric_sqrt = (Module['_numeric_sqrt'] = (a0) =>
    (_numeric_sqrt = Module['_numeric_sqrt'] = wasmExports['numeric_sqrt'])(a0))
  let ___divti3 = (Module['___divti3'] = (a0, a1, a2, a3, a4) =>
    (___divti3 = Module['___divti3'] = wasmExports['__divti3'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _numeric_exp = (Module['_numeric_exp'] = (a0) =>
    (_numeric_exp = Module['_numeric_exp'] = wasmExports['numeric_exp'])(a0))
  let _numeric_ln = (Module['_numeric_ln'] = (a0) =>
    (_numeric_ln = Module['_numeric_ln'] = wasmExports['numeric_ln'])(a0))
  let _numeric_log = (Module['_numeric_log'] = (a0) =>
    (_numeric_log = Module['_numeric_log'] = wasmExports['numeric_log'])(a0))
  let _numeric_float8_no_overflow = (Module['_numeric_float8_no_overflow'] = (
    a0,
  ) =>
    (_numeric_float8_no_overflow = Module['_numeric_float8_no_overflow'] =
      wasmExports['numeric_float8_no_overflow'])(a0))
  let _oidout = (Module['_oidout'] = (a0) =>
    (_oidout = Module['_oidout'] = wasmExports['oidout'])(a0))
  let _btrim1 = (Module['_btrim1'] = (a0) =>
    (_btrim1 = Module['_btrim1'] = wasmExports['btrim1'])(a0))
  let _ltrim1 = (Module['_ltrim1'] = (a0) =>
    (_ltrim1 = Module['_ltrim1'] = wasmExports['ltrim1'])(a0))
  let _rtrim1 = (Module['_rtrim1'] = (a0) =>
    (_rtrim1 = Module['_rtrim1'] = wasmExports['rtrim1'])(a0))
  let _tuplesort_skiptuples = (Module['_tuplesort_skiptuples'] = (a0, a1, a2) =>
    (_tuplesort_skiptuples = Module['_tuplesort_skiptuples'] =
      wasmExports['tuplesort_skiptuples'])(a0, a1, a2))
  let _interval_mi = (Module['_interval_mi'] = (a0) =>
    (_interval_mi = Module['_interval_mi'] = wasmExports['interval_mi'])(a0))
  let _setlocale = (Module['_setlocale'] = (a0, a1) =>
    (_setlocale = Module['_setlocale'] = wasmExports['setlocale'])(a0, a1))
  let _newlocale = (Module['_newlocale'] = (a0, a1, a2) =>
    (_newlocale = Module['_newlocale'] = wasmExports['newlocale'])(a0, a1, a2))
  let _strftime_l = (Module['_strftime_l'] = (a0, a1, a2, a3, a4) =>
    (_strftime_l = Module['_strftime_l'] = wasmExports['strftime_l'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _freelocale = (Module['_freelocale'] = (a0) =>
    (_freelocale = Module['_freelocale'] = wasmExports['freelocale'])(a0))
  let _uselocale = (Module['_uselocale'] = (a0) =>
    (_uselocale = Module['_uselocale'] = wasmExports['uselocale'])(a0))
  let _strcoll_l = (Module['_strcoll_l'] = (a0, a1, a2) =>
    (_strcoll_l = Module['_strcoll_l'] = wasmExports['strcoll_l'])(a0, a1, a2))
  let _strxfrm_l = (Module['_strxfrm_l'] = (a0, a1, a2, a3) =>
    (_strxfrm_l = Module['_strxfrm_l'] = wasmExports['strxfrm_l'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _drandom = (Module['_drandom'] = (a0) =>
    (_drandom = Module['_drandom'] = wasmExports['drandom'])(a0))
  let _quote_ident = (Module['_quote_ident'] = (a0) =>
    (_quote_ident = Module['_quote_ident'] = wasmExports['quote_ident'])(a0))
  let _textregexeq = (Module['_textregexeq'] = (a0) =>
    (_textregexeq = Module['_textregexeq'] = wasmExports['textregexeq'])(a0))
  let _text_substr = (Module['_text_substr'] = (a0) =>
    (_text_substr = Module['_text_substr'] = wasmExports['text_substr'])(a0))
  let _pg_wchar2mb_with_len = (Module['_pg_wchar2mb_with_len'] = (a0, a1, a2) =>
    (_pg_wchar2mb_with_len = Module['_pg_wchar2mb_with_len'] =
      wasmExports['pg_wchar2mb_with_len'])(a0, a1, a2))
  let _regexp_split_to_array = (Module['_regexp_split_to_array'] = (a0) =>
    (_regexp_split_to_array = Module['_regexp_split_to_array'] =
      wasmExports['regexp_split_to_array'])(a0))
  let _regclassin = (Module['_regclassin'] = (a0) =>
    (_regclassin = Module['_regclassin'] = wasmExports['regclassin'])(a0))
  let _regtypeout = (Module['_regtypeout'] = (a0) =>
    (_regtypeout = Module['_regtypeout'] = wasmExports['regtypeout'])(a0))
  let _pg_get_indexdef_columns_extended = (Module[
    '_pg_get_indexdef_columns_extended'
  ] = (a0, a1) =>
    (_pg_get_indexdef_columns_extended = Module[
      '_pg_get_indexdef_columns_extended'
    ] =
      wasmExports['pg_get_indexdef_columns_extended'])(a0, a1))
  let _pg_get_querydef = (Module['_pg_get_querydef'] = (a0, a1) =>
    (_pg_get_querydef = Module['_pg_get_querydef'] =
      wasmExports['pg_get_querydef'])(a0, a1))
  let _strcspn = (Module['_strcspn'] = (a0, a1) =>
    (_strcspn = Module['_strcspn'] = wasmExports['strcspn'])(a0, a1))
  let _generic_restriction_selectivity = (Module[
    '_generic_restriction_selectivity'
  ] = (a0, a1, a2, a3, a4, a5) =>
    (_generic_restriction_selectivity = Module[
      '_generic_restriction_selectivity'
    ] =
      wasmExports['generic_restriction_selectivity'])(a0, a1, a2, a3, a4, a5))
  let _genericcostestimate = (Module['_genericcostestimate'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_genericcostestimate = Module['_genericcostestimate'] =
      wasmExports['genericcostestimate'])(a0, a1, a2, a3))
  let _tidin = (Module['_tidin'] = (a0) =>
    (_tidin = Module['_tidin'] = wasmExports['tidin'])(a0))
  let _tidout = (Module['_tidout'] = (a0) =>
    (_tidout = Module['_tidout'] = wasmExports['tidout'])(a0))
  let _timestamp_in = (Module['_timestamp_in'] = (a0) =>
    (_timestamp_in = Module['_timestamp_in'] = wasmExports['timestamp_in'])(a0))
  let _timestamp_eq = (Module['_timestamp_eq'] = (a0) =>
    (_timestamp_eq = Module['_timestamp_eq'] = wasmExports['timestamp_eq'])(a0))
  let _timestamp_lt = (Module['_timestamp_lt'] = (a0) =>
    (_timestamp_lt = Module['_timestamp_lt'] = wasmExports['timestamp_lt'])(a0))
  let _timestamp_gt = (Module['_timestamp_gt'] = (a0) =>
    (_timestamp_gt = Module['_timestamp_gt'] = wasmExports['timestamp_gt'])(a0))
  let _timestamp_le = (Module['_timestamp_le'] = (a0) =>
    (_timestamp_le = Module['_timestamp_le'] = wasmExports['timestamp_le'])(a0))
  let _timestamp_ge = (Module['_timestamp_ge'] = (a0) =>
    (_timestamp_ge = Module['_timestamp_ge'] = wasmExports['timestamp_ge'])(a0))
  let _interval_eq = (Module['_interval_eq'] = (a0) =>
    (_interval_eq = Module['_interval_eq'] = wasmExports['interval_eq'])(a0))
  let _interval_lt = (Module['_interval_lt'] = (a0) =>
    (_interval_lt = Module['_interval_lt'] = wasmExports['interval_lt'])(a0))
  let _interval_gt = (Module['_interval_gt'] = (a0) =>
    (_interval_gt = Module['_interval_gt'] = wasmExports['interval_gt'])(a0))
  let _interval_le = (Module['_interval_le'] = (a0) =>
    (_interval_le = Module['_interval_le'] = wasmExports['interval_le'])(a0))
  let _interval_ge = (Module['_interval_ge'] = (a0) =>
    (_interval_ge = Module['_interval_ge'] = wasmExports['interval_ge'])(a0))
  let _interval_cmp = (Module['_interval_cmp'] = (a0) =>
    (_interval_cmp = Module['_interval_cmp'] = wasmExports['interval_cmp'])(a0))
  let _timestamp_mi = (Module['_timestamp_mi'] = (a0) =>
    (_timestamp_mi = Module['_timestamp_mi'] = wasmExports['timestamp_mi'])(a0))
  let _interval_um = (Module['_interval_um'] = (a0) =>
    (_interval_um = Module['_interval_um'] = wasmExports['interval_um'])(a0))
  let _has_fn_opclass_options = (Module['_has_fn_opclass_options'] = (a0) =>
    (_has_fn_opclass_options = Module['_has_fn_opclass_options'] =
      wasmExports['has_fn_opclass_options'])(a0))
  let _uuid_in = (Module['_uuid_in'] = (a0) =>
    (_uuid_in = Module['_uuid_in'] = wasmExports['uuid_in'])(a0))
  let _uuid_out = (Module['_uuid_out'] = (a0) =>
    (_uuid_out = Module['_uuid_out'] = wasmExports['uuid_out'])(a0))
  let _uuid_cmp = (Module['_uuid_cmp'] = (a0) =>
    (_uuid_cmp = Module['_uuid_cmp'] = wasmExports['uuid_cmp'])(a0))
  let _gen_random_uuid = (Module['_gen_random_uuid'] = (a0) =>
    (_gen_random_uuid = Module['_gen_random_uuid'] =
      wasmExports['gen_random_uuid'])(a0))
  let _varbit_in = (Module['_varbit_in'] = (a0) =>
    (_varbit_in = Module['_varbit_in'] = wasmExports['varbit_in'])(a0))
  let _biteq = (Module['_biteq'] = (a0) =>
    (_biteq = Module['_biteq'] = wasmExports['biteq'])(a0))
  let _bitlt = (Module['_bitlt'] = (a0) =>
    (_bitlt = Module['_bitlt'] = wasmExports['bitlt'])(a0))
  let _bitle = (Module['_bitle'] = (a0) =>
    (_bitle = Module['_bitle'] = wasmExports['bitle'])(a0))
  let _bitgt = (Module['_bitgt'] = (a0) =>
    (_bitgt = Module['_bitgt'] = wasmExports['bitgt'])(a0))
  let _bitge = (Module['_bitge'] = (a0) =>
    (_bitge = Module['_bitge'] = wasmExports['bitge'])(a0))
  let _bitcmp = (Module['_bitcmp'] = (a0) =>
    (_bitcmp = Module['_bitcmp'] = wasmExports['bitcmp'])(a0))
  let _bpchareq = (Module['_bpchareq'] = (a0) =>
    (_bpchareq = Module['_bpchareq'] = wasmExports['bpchareq'])(a0))
  let _bpcharlt = (Module['_bpcharlt'] = (a0) =>
    (_bpcharlt = Module['_bpcharlt'] = wasmExports['bpcharlt'])(a0))
  let _bpcharle = (Module['_bpcharle'] = (a0) =>
    (_bpcharle = Module['_bpcharle'] = wasmExports['bpcharle'])(a0))
  let _bpchargt = (Module['_bpchargt'] = (a0) =>
    (_bpchargt = Module['_bpchargt'] = wasmExports['bpchargt'])(a0))
  let _bpcharge = (Module['_bpcharge'] = (a0) =>
    (_bpcharge = Module['_bpcharge'] = wasmExports['bpcharge'])(a0))
  let _bpcharcmp = (Module['_bpcharcmp'] = (a0) =>
    (_bpcharcmp = Module['_bpcharcmp'] = wasmExports['bpcharcmp'])(a0))
  let _pg_detoast_datum_slice = (Module['_pg_detoast_datum_slice'] = (
    a0,
    a1,
    a2,
  ) =>
    (_pg_detoast_datum_slice = Module['_pg_detoast_datum_slice'] =
      wasmExports['pg_detoast_datum_slice'])(a0, a1, a2))
  let _text_substr_no_len = (Module['_text_substr_no_len'] = (a0) =>
    (_text_substr_no_len = Module['_text_substr_no_len'] =
      wasmExports['text_substr_no_len'])(a0))
  let _texteq = (Module['_texteq'] = (a0) =>
    (_texteq = Module['_texteq'] = wasmExports['texteq'])(a0))
  let _text_lt = (Module['_text_lt'] = (a0) =>
    (_text_lt = Module['_text_lt'] = wasmExports['text_lt'])(a0))
  let _text_le = (Module['_text_le'] = (a0) =>
    (_text_le = Module['_text_le'] = wasmExports['text_le'])(a0))
  let _text_gt = (Module['_text_gt'] = (a0) =>
    (_text_gt = Module['_text_gt'] = wasmExports['text_gt'])(a0))
  let _text_ge = (Module['_text_ge'] = (a0) =>
    (_text_ge = Module['_text_ge'] = wasmExports['text_ge'])(a0))
  let _bttextcmp = (Module['_bttextcmp'] = (a0) =>
    (_bttextcmp = Module['_bttextcmp'] = wasmExports['bttextcmp'])(a0))
  let _byteaeq = (Module['_byteaeq'] = (a0) =>
    (_byteaeq = Module['_byteaeq'] = wasmExports['byteaeq'])(a0))
  let _bytealt = (Module['_bytealt'] = (a0) =>
    (_bytealt = Module['_bytealt'] = wasmExports['bytealt'])(a0))
  let _byteale = (Module['_byteale'] = (a0) =>
    (_byteale = Module['_byteale'] = wasmExports['byteale'])(a0))
  let _byteagt = (Module['_byteagt'] = (a0) =>
    (_byteagt = Module['_byteagt'] = wasmExports['byteagt'])(a0))
  let _byteage = (Module['_byteage'] = (a0) =>
    (_byteage = Module['_byteage'] = wasmExports['byteage'])(a0))
  let _byteacmp = (Module['_byteacmp'] = (a0) =>
    (_byteacmp = Module['_byteacmp'] = wasmExports['byteacmp'])(a0))
  let _to_hex32 = (Module['_to_hex32'] = (a0) =>
    (_to_hex32 = Module['_to_hex32'] = wasmExports['to_hex32'])(a0))
  let _text_left = (Module['_text_left'] = (a0) =>
    (_text_left = Module['_text_left'] = wasmExports['text_left'])(a0))
  let _text_right = (Module['_text_right'] = (a0) =>
    (_text_right = Module['_text_right'] = wasmExports['text_right'])(a0))
  let _text_reverse = (Module['_text_reverse'] = (a0) =>
    (_text_reverse = Module['_text_reverse'] = wasmExports['text_reverse'])(a0))
  let _varstr_levenshtein = (Module['_varstr_levenshtein'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
  ) =>
    (_varstr_levenshtein = Module['_varstr_levenshtein'] =
      wasmExports['varstr_levenshtein'])(a0, a1, a2, a3, a4, a5, a6, a7))
  let _pg_utf_mblen_private = (Module['_pg_utf_mblen_private'] = (a0) =>
    (_pg_utf_mblen_private = Module['_pg_utf_mblen_private'] =
      wasmExports['pg_utf_mblen_private'])(a0))
  let _pg_xml_init = (Module['_pg_xml_init'] = (a0) =>
    (_pg_xml_init = Module['_pg_xml_init'] = wasmExports['pg_xml_init'])(a0))
  let _xml_ereport = (Module['_xml_ereport'] = (a0, a1, a2, a3) =>
    (_xml_ereport = Module['_xml_ereport'] = wasmExports['xml_ereport'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _pg_xml_done = (Module['_pg_xml_done'] = (a0, a1) =>
    (_pg_xml_done = Module['_pg_xml_done'] = wasmExports['pg_xml_done'])(
      a0,
      a1,
    ))
  let _pg_do_encoding_conversion = (Module['_pg_do_encoding_conversion'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_pg_do_encoding_conversion = Module['_pg_do_encoding_conversion'] =
      wasmExports['pg_do_encoding_conversion'])(a0, a1, a2, a3))
  let _CreateCacheMemoryContext = (Module['_CreateCacheMemoryContext'] = () =>
    (_CreateCacheMemoryContext = Module['_CreateCacheMemoryContext'] =
      wasmExports['CreateCacheMemoryContext'])())
  let _cfunc_resolve_polymorphic_argtypes = (Module[
    '_cfunc_resolve_polymorphic_argtypes'
  ] = (a0, a1, a2, a3, a4, a5) =>
    (_cfunc_resolve_polymorphic_argtypes = Module[
      '_cfunc_resolve_polymorphic_argtypes'
    ] =
      wasmExports['cfunc_resolve_polymorphic_argtypes'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
    ))
  let _get_typsubscript = (Module['_get_typsubscript'] = (a0, a1) =>
    (_get_typsubscript = Module['_get_typsubscript'] =
      wasmExports['get_typsubscript'])(a0, a1))
  let _CachedPlanAllowsSimpleValidityCheck = (Module[
    '_CachedPlanAllowsSimpleValidityCheck'
  ] = (a0, a1, a2) =>
    (_CachedPlanAllowsSimpleValidityCheck = Module[
      '_CachedPlanAllowsSimpleValidityCheck'
    ] =
      wasmExports['CachedPlanAllowsSimpleValidityCheck'])(a0, a1, a2))
  let _CachedPlanIsSimplyValid = (Module['_CachedPlanIsSimplyValid'] = (
    a0,
    a1,
    a2,
  ) =>
    (_CachedPlanIsSimplyValid = Module['_CachedPlanIsSimplyValid'] =
      wasmExports['CachedPlanIsSimplyValid'])(a0, a1, a2))
  let _GetCachedExpression = (Module['_GetCachedExpression'] = (a0) =>
    (_GetCachedExpression = Module['_GetCachedExpression'] =
      wasmExports['GetCachedExpression'])(a0))
  let _FreeCachedExpression = (Module['_FreeCachedExpression'] = (a0) =>
    (_FreeCachedExpression = Module['_FreeCachedExpression'] =
      wasmExports['FreeCachedExpression'])(a0))
  let _ReleaseAllPlanCacheRefsInOwner = (Module[
    '_ReleaseAllPlanCacheRefsInOwner'
  ] = (a0) =>
    (_ReleaseAllPlanCacheRefsInOwner = Module[
      '_ReleaseAllPlanCacheRefsInOwner'
    ] =
      wasmExports['ReleaseAllPlanCacheRefsInOwner'])(a0))
  let _abort = (Module['_abort'] = () =>
    (_abort = Module['_abort'] = wasmExports['abort'])())
  let _in_error_recursion_trouble = (Module['_in_error_recursion_trouble'] =
    () =>
      (_in_error_recursion_trouble = Module['_in_error_recursion_trouble'] =
        wasmExports['in_error_recursion_trouble'])())
  let _pg_vfprintf = (Module['_pg_vfprintf'] = (a0, a1, a2) =>
    (_pg_vfprintf = Module['_pg_vfprintf'] = wasmExports['pg_vfprintf'])(
      a0,
      a1,
      a2,
    ))
  let _pgl_longjmp = (Module['_pgl_longjmp'] = (a0, a1) =>
    (_pgl_longjmp = Module['_pgl_longjmp'] = wasmExports['pgl_longjmp'])(
      a0,
      a1,
    ))
  let _GetErrorContextStack = (Module['_GetErrorContextStack'] = () =>
    (_GetErrorContextStack = Module['_GetErrorContextStack'] =
      wasmExports['GetErrorContextStack'])())
  let _dlsym = (Module['_dlsym'] = (a0, a1) =>
    (_dlsym = Module['_dlsym'] = wasmExports['dlsym'])(a0, a1))
  let _dlopen = (Module['_dlopen'] = (a0, a1) =>
    (_dlopen = Module['_dlopen'] = wasmExports['dlopen'])(a0, a1))
  let _dlerror = (Module['_dlerror'] = () =>
    (_dlerror = Module['_dlerror'] = wasmExports['dlerror'])())
  let _dlclose = (Module['_dlclose'] = (a0) =>
    (_dlclose = Module['_dlclose'] = wasmExports['dlclose'])(a0))
  let _find_rendezvous_variable = (Module['_find_rendezvous_variable'] = (a0) =>
    (_find_rendezvous_variable = Module['_find_rendezvous_variable'] =
      wasmExports['find_rendezvous_variable'])(a0))
  let _CallerFInfoFunctionCall1 = (Module['_CallerFInfoFunctionCall1'] = (
    a0,
    a1,
    a2,
    a3,
  ) =>
    (_CallerFInfoFunctionCall1 = Module['_CallerFInfoFunctionCall1'] =
      wasmExports['CallerFInfoFunctionCall1'])(a0, a1, a2, a3))
  let _CallerFInfoFunctionCall2 = (Module['_CallerFInfoFunctionCall2'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
  ) =>
    (_CallerFInfoFunctionCall2 = Module['_CallerFInfoFunctionCall2'] =
      wasmExports['CallerFInfoFunctionCall2'])(a0, a1, a2, a3, a4))
  let _FunctionCall0Coll = (Module['_FunctionCall0Coll'] = (a0, a1) =>
    (_FunctionCall0Coll = Module['_FunctionCall0Coll'] =
      wasmExports['FunctionCall0Coll'])(a0, a1))
  let _RelationNameGetTupleDesc = (Module['_RelationNameGetTupleDesc'] = (a0) =>
    (_RelationNameGetTupleDesc = Module['_RelationNameGetTupleDesc'] =
      wasmExports['RelationNameGetTupleDesc'])(a0))
  let _hash_freeze = (Module['_hash_freeze'] = (a0) =>
    (_hash_freeze = Module['_hash_freeze'] = wasmExports['hash_freeze'])(a0))
  let _chdir = (Module['_chdir'] = (a0) =>
    (_chdir = Module['_chdir'] = wasmExports['chdir'])(a0))
  let _pg_bindtextdomain = (Module['_pg_bindtextdomain'] = (a0) =>
    (_pg_bindtextdomain = Module['_pg_bindtextdomain'] =
      wasmExports['pg_bindtextdomain'])(a0))
  let _pg_mblen = (Module['_pg_mblen'] = (a0) =>
    (_pg_mblen = Module['_pg_mblen'] = wasmExports['pg_mblen'])(a0))
  let _DefineCustomBoolVariable = (Module['_DefineCustomBoolVariable'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
  ) =>
    (_DefineCustomBoolVariable = Module['_DefineCustomBoolVariable'] =
      wasmExports['DefineCustomBoolVariable'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
    ))
  let _DefineCustomIntVariable = (Module['_DefineCustomIntVariable'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
    a11,
  ) =>
    (_DefineCustomIntVariable = Module['_DefineCustomIntVariable'] =
      wasmExports['DefineCustomIntVariable'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
      a11,
    ))
  let _DefineCustomRealVariable = (Module['_DefineCustomRealVariable'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
    a11,
  ) =>
    (_DefineCustomRealVariable = Module['_DefineCustomRealVariable'] =
      wasmExports['DefineCustomRealVariable'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
      a11,
    ))
  let _DefineCustomStringVariable = (Module['_DefineCustomStringVariable'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
  ) =>
    (_DefineCustomStringVariable = Module['_DefineCustomStringVariable'] =
      wasmExports['DefineCustomStringVariable'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
    ))
  let _DefineCustomEnumVariable = (Module['_DefineCustomEnumVariable'] = (
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
    a7,
    a8,
    a9,
    a10,
  ) =>
    (_DefineCustomEnumVariable = Module['_DefineCustomEnumVariable'] =
      wasmExports['DefineCustomEnumVariable'])(
      a0,
      a1,
      a2,
      a3,
      a4,
      a5,
      a6,
      a7,
      a8,
      a9,
      a10,
    ))
  let _MarkGUCPrefixReserved = (Module['_MarkGUCPrefixReserved'] = (a0) =>
    (_MarkGUCPrefixReserved = Module['_MarkGUCPrefixReserved'] =
      wasmExports['MarkGUCPrefixReserved'])(a0))
  let _sampler_random_init_state = (Module['_sampler_random_init_state'] = (
    a0,
    a1,
  ) =>
    (_sampler_random_init_state = Module['_sampler_random_init_state'] =
      wasmExports['sampler_random_init_state'])(a0, a1))
  let _dsa_trim = (Module['_dsa_trim'] = (a0) =>
    (_dsa_trim = Module['_dsa_trim'] = wasmExports['dsa_trim'])(a0))
  let _pchomp = (Module['_pchomp'] = (a0) =>
    (_pchomp = Module['_pchomp'] = wasmExports['pchomp'])(a0))
  let _PinPortal = (Module['_PinPortal'] = (a0) =>
    (_PinPortal = Module['_PinPortal'] = wasmExports['PinPortal'])(a0))
  let _UnpinPortal = (Module['_UnpinPortal'] = (a0) =>
    (_UnpinPortal = Module['_UnpinPortal'] = wasmExports['UnpinPortal'])(a0))
  let ___lshrti3 = (Module['___lshrti3'] = (a0, a1, a2, a3) =>
    (___lshrti3 = Module['___lshrti3'] = wasmExports['__lshrti3'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _realpath = (Module['_realpath'] = (a0, a1) =>
    (_realpath = Module['_realpath'] = wasmExports['realpath'])(a0, a1))
  let _float_to_shortest_decimal_bufn = (Module[
    '_float_to_shortest_decimal_bufn'
  ] = (a0, a1) =>
    (_float_to_shortest_decimal_bufn = Module[
      '_float_to_shortest_decimal_bufn'
    ] =
      wasmExports['float_to_shortest_decimal_bufn'])(a0, a1))
  let _IsValidJsonNumber = (Module['_IsValidJsonNumber'] = (a0, a1) =>
    (_IsValidJsonNumber = Module['_IsValidJsonNumber'] =
      wasmExports['IsValidJsonNumber'])(a0, a1))
  let _pg_prng_uint64 = (Module['_pg_prng_uint64'] = (a0) =>
    (_pg_prng_uint64 = Module['_pg_prng_uint64'] =
      wasmExports['pg_prng_uint64'])(a0))
  let _makeStringInfoExt = (Module['_makeStringInfoExt'] = (a0) =>
    (_makeStringInfoExt = Module['_makeStringInfoExt'] =
      wasmExports['makeStringInfoExt'])(a0))
  let _pgl_getpwuid = (Module['_pgl_getpwuid'] = (a0) =>
    (_pgl_getpwuid = Module['_pgl_getpwuid'] = wasmExports['pgl_getpwuid'])(a0))
  let _getcwd = (Module['_getcwd'] = (a0, a1) =>
    (_getcwd = Module['_getcwd'] = wasmExports['getcwd'])(a0, a1))
  let _pthread_mutex_lock = (Module['_pthread_mutex_lock'] = (a0) =>
    (_pthread_mutex_lock = Module['_pthread_mutex_lock'] =
      wasmExports['pthread_mutex_lock'])(a0))
  let _localeconv = (Module['_localeconv'] = () =>
    (_localeconv = Module['_localeconv'] = wasmExports['localeconv'])())
  let _pthread_mutex_unlock = (Module['_pthread_mutex_unlock'] = (a0) =>
    (_pthread_mutex_unlock = Module['_pthread_mutex_unlock'] =
      wasmExports['pthread_mutex_unlock'])(a0))
  let _nanosleep = (Module['_nanosleep'] = (a0, a1) =>
    (_nanosleep = Module['_nanosleep'] = wasmExports['nanosleep'])(a0, a1))
  let _strchrnul = (Module['_strchrnul'] = (a0, a1) =>
    (_strchrnul = Module['_strchrnul'] = wasmExports['strchrnul'])(a0, a1))
  let _snprintf = (Module['_snprintf'] = (a0, a1, a2, a3) =>
    (_snprintf = Module['_snprintf'] = wasmExports['snprintf'])(a0, a1, a2, a3))
  let _strerror = (Module['_strerror'] = (a0) =>
    (_strerror = Module['_strerror'] = wasmExports['strerror'])(a0))
  let _clear_setitimer = (Module['_clear_setitimer'] = () =>
    (_clear_setitimer = Module['_clear_setitimer'] =
      wasmExports['clear_setitimer'])())
  let _pgl_setPGliteActive = (Module['_pgl_setPGliteActive'] = (a0) =>
    (_pgl_setPGliteActive = Module['_pgl_setPGliteActive'] =
      wasmExports['pgl_setPGliteActive'])(a0))
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
  let _pgl_run_atexit_funcs = (Module['_pgl_run_atexit_funcs'] = () =>
    (_pgl_run_atexit_funcs = Module['_pgl_run_atexit_funcs'] =
      wasmExports['pgl_run_atexit_funcs'])())
  let _pgl_freopen = (Module['_pgl_freopen'] = (a0, a1, a2) =>
    (_pgl_freopen = Module['_pgl_freopen'] = wasmExports['pgl_freopen'])(
      a0,
      a1,
      a2,
    ))
  let _fiprintf = (Module['_fiprintf'] = (a0, a1, a2) =>
    (_fiprintf = Module['_fiprintf'] = wasmExports['fiprintf'])(a0, a1, a2))
  let _pgl_set_rw_cbs = (Module['_pgl_set_rw_cbs'] = (a0, a1) =>
    (_pgl_set_rw_cbs = Module['_pgl_set_rw_cbs'] =
      wasmExports['pgl_set_rw_cbs'])(a0, a1))
  let _vfprintf = (Module['_vfprintf'] = (a0, a1, a2) =>
    (_vfprintf = Module['_vfprintf'] = wasmExports['vfprintf'])(a0, a1, a2))
  let _pthread_key_create = (Module['_pthread_key_create'] = (a0, a1) =>
    (_pthread_key_create = Module['_pthread_key_create'] =
      wasmExports['pthread_key_create'])(a0, a1))
  let _pthread_getspecific = (Module['_pthread_getspecific'] = (a0) =>
    (_pthread_getspecific = Module['_pthread_getspecific'] =
      wasmExports['pthread_getspecific'])(a0))
  let _pthread_key_delete = (Module['_pthread_key_delete'] = (a0) =>
    (_pthread_key_delete = Module['_pthread_key_delete'] =
      wasmExports['pthread_key_delete'])(a0))
  let _pthread_setspecific = (Module['_pthread_setspecific'] = (a0, a1) =>
    (_pthread_setspecific = Module['_pthread_setspecific'] =
      wasmExports['pthread_setspecific'])(a0, a1))
  let _toupper = (Module['_toupper'] = (a0) =>
    (_toupper = Module['_toupper'] = wasmExports['toupper'])(a0))
  let _iconv_open = (Module['_iconv_open'] = (a0, a1) =>
    (_iconv_open = Module['_iconv_open'] = wasmExports['iconv_open'])(a0, a1))
  let _iconv_close = (Module['_iconv_close'] = (a0) =>
    (_iconv_close = Module['_iconv_close'] = wasmExports['iconv_close'])(a0))
  let _iconv = (Module['_iconv'] = (a0, a1, a2, a3, a4) =>
    (_iconv = Module['_iconv'] = wasmExports['iconv'])(a0, a1, a2, a3, a4))
  let _pthread_mutex_init = (Module['_pthread_mutex_init'] = (a0, a1) =>
    (_pthread_mutex_init = Module['_pthread_mutex_init'] =
      wasmExports['pthread_mutex_init'])(a0, a1))
  let _pthread_mutex_destroy = (Module['_pthread_mutex_destroy'] = (a0) =>
    (_pthread_mutex_destroy = Module['_pthread_mutex_destroy'] =
      wasmExports['pthread_mutex_destroy'])(a0))
  let _pthread_cond_init = (Module['_pthread_cond_init'] = (a0, a1) =>
    (_pthread_cond_init = Module['_pthread_cond_init'] =
      wasmExports['pthread_cond_init'])(a0, a1))
  let _pthread_cond_destroy = (Module['_pthread_cond_destroy'] = (a0) =>
    (_pthread_cond_destroy = Module['_pthread_cond_destroy'] =
      wasmExports['pthread_cond_destroy'])(a0))
  let _pthread_self = (Module['_pthread_self'] = () =>
    (_pthread_self = Module['_pthread_self'] = wasmExports['pthread_self'])())
  let _pthread_cond_wait = (Module['_pthread_cond_wait'] = (a0, a1) =>
    (_pthread_cond_wait = Module['_pthread_cond_wait'] =
      wasmExports['pthread_cond_wait'])(a0, a1))
  let _pthread_cond_signal = (Module['_pthread_cond_signal'] = (a0) =>
    (_pthread_cond_signal = Module['_pthread_cond_signal'] =
      wasmExports['pthread_cond_signal'])(a0))
  let _pthread_once = (Module['_pthread_once'] = (a0, a1) =>
    (_pthread_once = Module['_pthread_once'] = wasmExports['pthread_once'])(
      a0,
      a1,
    ))
  let ___cxa_atexit = (Module['___cxa_atexit'] = (a0, a1, a2) =>
    (___cxa_atexit = Module['___cxa_atexit'] = wasmExports['__cxa_atexit'])(
      a0,
      a1,
      a2,
    ))
  let _fputs = (Module['_fputs'] = (a0, a1) =>
    (_fputs = Module['_fputs'] = wasmExports['fputs'])(a0, a1))
  let _vsnprintf = (Module['_vsnprintf'] = (a0, a1, a2, a3) =>
    (_vsnprintf = Module['_vsnprintf'] = wasmExports['vsnprintf'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let ___small_fprintf = (Module['___small_fprintf'] = (a0, a1, a2) =>
    (___small_fprintf = Module['___small_fprintf'] =
      wasmExports['__small_fprintf'])(a0, a1, a2))
  let ___dynamic_cast = (Module['___dynamic_cast'] = (a0, a1, a2, a3) =>
    (___dynamic_cast = Module['___dynamic_cast'] =
      wasmExports['__dynamic_cast'])(a0, a1, a2, a3))
  let ___cxa_pure_virtual = (Module['___cxa_pure_virtual'] = () =>
    (___cxa_pure_virtual = Module['___cxa_pure_virtual'] =
      wasmExports['__cxa_pure_virtual'])())
  let _modf = (Module['_modf'] = (a0, a1) =>
    (_modf = Module['_modf'] = wasmExports['modf'])(a0, a1))
  let _localtime_r = (Module['_localtime_r'] = (a0, a1) =>
    (_localtime_r = Module['_localtime_r'] = wasmExports['localtime_r'])(
      a0,
      a1,
    ))
  let _strncat = (Module['_strncat'] = (a0, a1, a2) =>
    (_strncat = Module['_strncat'] = wasmExports['strncat'])(a0, a1, a2))
  let _munmap = (Module['_munmap'] = (a0, a1) =>
    (_munmap = Module['_munmap'] = wasmExports['munmap'])(a0, a1))
  let __ZdlPvm = (Module['__ZdlPvm'] = (a0, a1) =>
    (__ZdlPvm = Module['__ZdlPvm'] = wasmExports['_ZdlPvm'])(a0, a1))
  let ___ctype_get_mb_cur_max = (Module['___ctype_get_mb_cur_max'] = () =>
    (___ctype_get_mb_cur_max = Module['___ctype_get_mb_cur_max'] =
      wasmExports['__ctype_get_mb_cur_max'])())
  let ___ctype_tolower_loc = (Module['___ctype_tolower_loc'] = () =>
    (___ctype_tolower_loc = Module['___ctype_tolower_loc'] =
      wasmExports['__ctype_tolower_loc'])())
  let ___ctype_toupper_loc = (Module['___ctype_toupper_loc'] = () =>
    (___ctype_toupper_loc = Module['___ctype_toupper_loc'] =
      wasmExports['__ctype_toupper_loc'])())
  let _fdopen = (Module['_fdopen'] = (a0, a1) =>
    (_fdopen = Module['_fdopen'] = wasmExports['fdopen'])(a0, a1))
  let _sqrt = (Module['_sqrt'] = (a0) =>
    (_sqrt = Module['_sqrt'] = wasmExports['sqrt'])(a0))
  let _acosl = (Module['_acosl'] = (a0, a1, a2) =>
    (_acosl = Module['_acosl'] = wasmExports['acosl'])(a0, a1, a2))
  let _aligned_alloc = (Module['_aligned_alloc'] = (a0, a1) =>
    (_aligned_alloc = Module['_aligned_alloc'] = wasmExports['aligned_alloc'])(
      a0,
      a1,
    ))
  let _atan2l = (Module['_atan2l'] = (a0, a1, a2, a3, a4) =>
    (_atan2l = Module['_atan2l'] = wasmExports['atan2l'])(a0, a1, a2, a3, a4))
  let ___funcs_on_exit = () =>
    (___funcs_on_exit = wasmExports['__funcs_on_exit'])()
  let _atexit = (Module['_atexit'] = (a0) =>
    (_atexit = Module['_atexit'] = wasmExports['atexit'])(a0))
  let ___cxa_finalize = (Module['___cxa_finalize'] = (a0) =>
    (___cxa_finalize = Module['___cxa_finalize'] =
      wasmExports['__cxa_finalize'])(a0))
  let _btowc = (Module['_btowc'] = (a0) =>
    (_btowc = Module['_btowc'] = wasmExports['btowc'])(a0))
  let _clock = (Module['_clock'] = () =>
    (_clock = Module['_clock'] = wasmExports['clock'])())
  let _scalbn = (Module['_scalbn'] = (a0, a1) =>
    (_scalbn = Module['_scalbn'] = wasmExports['scalbn'])(a0, a1))
  let _cosl = (Module['_cosl'] = (a0, a1, a2) =>
    (_cosl = Module['_cosl'] = wasmExports['cosl'])(a0, a1, a2))
  let _dladdr = (Module['_dladdr'] = (a0, a1) =>
    (_dladdr = Module['_dladdr'] = wasmExports['dladdr'])(a0, a1))
  let ___dl_seterr = (a0, a1) =>
    (___dl_seterr = wasmExports['__dl_seterr'])(a0, a1)
  let _duplocale = (Module['_duplocale'] = (a0) =>
    (_duplocale = Module['_duplocale'] = wasmExports['duplocale'])(a0))
  let _fchmod = (Module['_fchmod'] = (a0, a1) =>
    (_fchmod = Module['_fchmod'] = wasmExports['fchmod'])(a0, a1))
  let _fchmodat = (Module['_fchmodat'] = (a0, a1, a2, a3) =>
    (_fchmodat = Module['_fchmodat'] = wasmExports['fchmodat'])(a0, a1, a2, a3))
  let _fchown = (Module['_fchown'] = (a0, a1, a2) =>
    (_fchown = Module['_fchown'] = wasmExports['fchown'])(a0, a1, a2))
  let _fcntl = (Module['_fcntl'] = (a0, a1, a2) =>
    (_fcntl = Module['_fcntl'] = wasmExports['fcntl'])(a0, a1, a2))
  let _fdopendir = (Module['_fdopendir'] = (a0) =>
    (_fdopendir = Module['_fdopendir'] = wasmExports['fdopendir'])(a0))
  let _fmax = (Module['_fmax'] = (a0, a1) =>
    (_fmax = Module['_fmax'] = wasmExports['fmax'])(a0, a1))
  let _fmin = (Module['_fmin'] = (a0, a1) =>
    (_fmin = Module['_fmin'] = wasmExports['fmin'])(a0, a1))
  let _fputwc = (Module['_fputwc'] = (a0, a1) =>
    (_fputwc = Module['_fputwc'] = wasmExports['fputwc'])(a0, a1))
  let _frexp = (Module['_frexp'] = (a0, a1) =>
    (_frexp = Module['_frexp'] = wasmExports['frexp'])(a0, a1))
  let _ftell = (Module['_ftell'] = (a0) =>
    (_ftell = Module['_ftell'] = wasmExports['ftell'])(a0))
  let _getentropy = (Module['_getentropy'] = (a0, a1) =>
    (_getentropy = Module['_getentropy'] = wasmExports['getentropy'])(a0, a1))
  let _geteuid = (Module['_geteuid'] = () =>
    (_geteuid = Module['_geteuid'] = wasmExports['geteuid'])())
  let _getgid = (Module['_getgid'] = () =>
    (_getgid = Module['_getgid'] = wasmExports['getgid'])())
  let _mbtowc = (Module['_mbtowc'] = (a0, a1, a2) =>
    (_mbtowc = Module['_mbtowc'] = wasmExports['mbtowc'])(a0, a1, a2))
  let _getuid = (Module['_getuid'] = () =>
    (_getuid = Module['_getuid'] = wasmExports['getuid'])())
  let _getwc = (Module['_getwc'] = (a0) =>
    (_getwc = Module['_getwc'] = wasmExports['getwc'])(a0))
  let _gmtime = (Module['_gmtime'] = (a0) =>
    (_gmtime = Module['_gmtime'] = wasmExports['gmtime'])(a0))
  let _hypot = (Module['_hypot'] = (a0, a1) =>
    (_hypot = Module['_hypot'] = wasmExports['hypot'])(a0, a1))
  let _mbrtowc = (Module['_mbrtowc'] = (a0, a1, a2, a3) =>
    (_mbrtowc = Module['_mbrtowc'] = wasmExports['mbrtowc'])(a0, a1, a2, a3))
  let _ioctl = (Module['_ioctl'] = (a0, a1, a2) =>
    (_ioctl = Module['_ioctl'] = wasmExports['ioctl'])(a0, a1, a2))
  let _isalpha = (Module['_isalpha'] = (a0) =>
    (_isalpha = Module['_isalpha'] = wasmExports['isalpha'])(a0))
  let _isgraph = (Module['_isgraph'] = (a0) =>
    (_isgraph = Module['_isgraph'] = wasmExports['isgraph'])(a0))
  let _isspace = (Module['_isspace'] = (a0) =>
    (_isspace = Module['_isspace'] = wasmExports['isspace'])(a0))
  let _iswblank_l = (Module['_iswblank_l'] = (a0, a1) =>
    (_iswblank_l = Module['_iswblank_l'] = wasmExports['iswblank_l'])(a0, a1))
  let _iswcntrl_l = (Module['_iswcntrl_l'] = (a0, a1) =>
    (_iswcntrl_l = Module['_iswcntrl_l'] = wasmExports['iswcntrl_l'])(a0, a1))
  let _iswxdigit_l = (Module['_iswxdigit_l'] = (a0, a1) =>
    (_iswxdigit_l = Module['_iswxdigit_l'] = wasmExports['iswxdigit_l'])(
      a0,
      a1,
    ))
  let _isxdigit_l = (Module['_isxdigit_l'] = (a0, a1) =>
    (_isxdigit_l = Module['_isxdigit_l'] = wasmExports['isxdigit_l'])(a0, a1))
  let _pthread_cond_broadcast = (Module['_pthread_cond_broadcast'] = (a0) =>
    (_pthread_cond_broadcast = Module['_pthread_cond_broadcast'] =
      wasmExports['pthread_cond_broadcast'])(a0))
  let _pthread_atfork = (Module['_pthread_atfork'] = (a0, a1, a2) =>
    (_pthread_atfork = Module['_pthread_atfork'] =
      wasmExports['pthread_atfork'])(a0, a1, a2))
  let _pthread_mutexattr_init = (Module['_pthread_mutexattr_init'] = (a0) =>
    (_pthread_mutexattr_init = Module['_pthread_mutexattr_init'] =
      wasmExports['pthread_mutexattr_init'])(a0))
  let _pthread_mutexattr_setprotocol = (Module[
    '_pthread_mutexattr_setprotocol'
  ] = (a0, a1) =>
    (_pthread_mutexattr_setprotocol = Module['_pthread_mutexattr_setprotocol'] =
      wasmExports['pthread_mutexattr_setprotocol'])(a0, a1))
  let _pthread_mutexattr_settype = (Module['_pthread_mutexattr_settype'] = (
    a0,
    a1,
  ) =>
    (_pthread_mutexattr_settype = Module['_pthread_mutexattr_settype'] =
      wasmExports['pthread_mutexattr_settype'])(a0, a1))
  let _pthread_mutexattr_destroy = (Module['_pthread_mutexattr_destroy'] = (
    a0,
  ) =>
    (_pthread_mutexattr_destroy = Module['_pthread_mutexattr_destroy'] =
      wasmExports['pthread_mutexattr_destroy'])(a0))
  let _pthread_mutexattr_setpshared = (Module['_pthread_mutexattr_setpshared'] =
    (a0, a1) =>
      (_pthread_mutexattr_setpshared = Module['_pthread_mutexattr_setpshared'] =
        wasmExports['pthread_mutexattr_setpshared'])(a0, a1))
  let _pthread_mutex_trylock = (Module['_pthread_mutex_trylock'] = (a0) =>
    (_pthread_mutex_trylock = Module['_pthread_mutex_trylock'] =
      wasmExports['pthread_mutex_trylock'])(a0))
  let _pthread_create = (Module['_pthread_create'] = (a0, a1, a2, a3) =>
    (_pthread_create = Module['_pthread_create'] =
      wasmExports['pthread_create'])(a0, a1, a2, a3))
  let _pthread_join = (Module['_pthread_join'] = (a0, a1) =>
    (_pthread_join = Module['_pthread_join'] = wasmExports['pthread_join'])(
      a0,
      a1,
    ))
  let _pthread_cond_timedwait = (Module['_pthread_cond_timedwait'] = (
    a0,
    a1,
    a2,
  ) =>
    (_pthread_cond_timedwait = Module['_pthread_cond_timedwait'] =
      wasmExports['pthread_cond_timedwait'])(a0, a1, a2))
  let _pthread_detach = (Module['_pthread_detach'] = (a0) =>
    (_pthread_detach = Module['_pthread_detach'] =
      wasmExports['pthread_detach'])(a0))
  let _link = (Module['_link'] = (a0, a1) =>
    (_link = Module['_link'] = wasmExports['link'])(a0, a1))
  let _llround = (Module['_llround'] = (a0) =>
    (_llround = Module['_llround'] = wasmExports['llround'])(a0))
  let _localtime = (Module['_localtime'] = (a0) =>
    (_localtime = Module['_localtime'] = wasmExports['localtime'])(a0))
  let _log2 = (Module['_log2'] = (a0) =>
    (_log2 = Module['_log2'] = wasmExports['log2'])(a0))
  let _logb = (Module['_logb'] = (a0) =>
    (_logb = Module['_logb'] = wasmExports['logb'])(a0))
  let _lround = (Module['_lround'] = (a0) =>
    (_lround = Module['_lround'] = wasmExports['lround'])(a0))
  let _mbrlen = (Module['_mbrlen'] = (a0, a1, a2) =>
    (_mbrlen = Module['_mbrlen'] = wasmExports['mbrlen'])(a0, a1, a2))
  let _mbsnrtowcs = (Module['_mbsnrtowcs'] = (a0, a1, a2, a3, a4) =>
    (_mbsnrtowcs = Module['_mbsnrtowcs'] = wasmExports['mbsnrtowcs'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _mbsrtowcs = (Module['_mbsrtowcs'] = (a0, a1, a2, a3) =>
    (_mbsrtowcs = Module['_mbsrtowcs'] = wasmExports['mbsrtowcs'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _memrchr = (Module['_memrchr'] = (a0, a1, a2) =>
    (_memrchr = Module['_memrchr'] = wasmExports['memrchr'])(a0, a1, a2))
  let _emscripten_builtin_memalign = (a0, a1) =>
    (_emscripten_builtin_memalign = wasmExports['emscripten_builtin_memalign'])(
      a0,
      a1,
    )
  let _nextafter = (Module['_nextafter'] = (a0, a1) =>
    (_nextafter = Module['_nextafter'] = wasmExports['nextafter'])(a0, a1))
  let _nextafterf = (Module['_nextafterf'] = (a0, a1) =>
    (_nextafterf = Module['_nextafterf'] = wasmExports['nextafterf'])(a0, a1))
  let _ntohs = (a0) => (_ntohs = wasmExports['ntohs'])(a0)
  let _openat = (Module['_openat'] = (a0, a1, a2, a3) =>
    (_openat = Module['_openat'] = wasmExports['openat'])(a0, a1, a2, a3))
  let _pathconf = (Module['_pathconf'] = (a0, a1) =>
    (_pathconf = Module['_pathconf'] = wasmExports['pathconf'])(a0, a1))
  let _perror = (Module['_perror'] = (a0) =>
    (_perror = Module['_perror'] = wasmExports['perror'])(a0))
  let _iprintf = (Module['_iprintf'] = (a0, a1) =>
    (_iprintf = Module['_iprintf'] = wasmExports['iprintf'])(a0, a1))
  let ___small_printf = (Module['___small_printf'] = (a0, a1) =>
    (___small_printf = Module['___small_printf'] =
      wasmExports['__small_printf'])(a0, a1))
  let _pthread_mutexattr_getprotocol = (Module[
    '_pthread_mutexattr_getprotocol'
  ] = (a0, a1) =>
    (_pthread_mutexattr_getprotocol = Module['_pthread_mutexattr_getprotocol'] =
      wasmExports['pthread_mutexattr_getprotocol'])(a0, a1))
  let _pthread_mutexattr_getpshared = (Module['_pthread_mutexattr_getpshared'] =
    (a0, a1) =>
      (_pthread_mutexattr_getpshared = Module['_pthread_mutexattr_getpshared'] =
        wasmExports['pthread_mutexattr_getpshared'])(a0, a1))
  let _pthread_mutexattr_getrobust = (Module['_pthread_mutexattr_getrobust'] = (
    a0,
    a1,
  ) =>
    (_pthread_mutexattr_getrobust = Module['_pthread_mutexattr_getrobust'] =
      wasmExports['pthread_mutexattr_getrobust'])(a0, a1))
  let _pthread_mutexattr_gettype = (Module['_pthread_mutexattr_gettype'] = (
    a0,
    a1,
  ) =>
    (_pthread_mutexattr_gettype = Module['_pthread_mutexattr_gettype'] =
      wasmExports['pthread_mutexattr_gettype'])(a0, a1))
  let _putchar = (Module['_putchar'] = (a0) =>
    (_putchar = Module['_putchar'] = wasmExports['putchar'])(a0))
  let _qsort = (Module['_qsort'] = (a0, a1, a2, a3) =>
    (_qsort = Module['_qsort'] = wasmExports['qsort'])(a0, a1, a2, a3))
  let _srand = (Module['_srand'] = (a0) =>
    (_srand = Module['_srand'] = wasmExports['srand'])(a0))
  let _rand = (Module['_rand'] = () =>
    (_rand = Module['_rand'] = wasmExports['rand'])())
  let _remainder = (Module['_remainder'] = (a0, a1) =>
    (_remainder = Module['_remainder'] = wasmExports['remainder'])(a0, a1))
  let _remove = (Module['_remove'] = (a0) =>
    (_remove = Module['_remove'] = wasmExports['remove'])(a0))
  let _remquo = (Module['_remquo'] = (a0, a1, a2) =>
    (_remquo = Module['_remquo'] = wasmExports['remquo'])(a0, a1, a2))
  let _round = (Module['_round'] = (a0) =>
    (_round = Module['_round'] = wasmExports['round'])(a0))
  let _roundf = (Module['_roundf'] = (a0) =>
    (_roundf = Module['_roundf'] = wasmExports['roundf'])(a0))
  let __emscripten_timeout = (a0, a1) =>
    (__emscripten_timeout = wasmExports['_emscripten_timeout'])(a0, a1)
  let _sinl = (Module['_sinl'] = (a0, a1, a2) =>
    (_sinl = Module['_sinl'] = wasmExports['sinl'])(a0, a1, a2))
  let _siprintf = (Module['_siprintf'] = (a0, a1, a2) =>
    (_siprintf = Module['_siprintf'] = wasmExports['siprintf'])(a0, a1, a2))
  let _sqrtl = (Module['_sqrtl'] = (a0, a1, a2) =>
    (_sqrtl = Module['_sqrtl'] = wasmExports['sqrtl'])(a0, a1, a2))
  let _vsscanf = (Module['_vsscanf'] = (a0, a1, a2) =>
    (_vsscanf = Module['_vsscanf'] = wasmExports['vsscanf'])(a0, a1, a2))
  let _statvfs = (Module['_statvfs'] = (a0, a1) =>
    (_statvfs = Module['_statvfs'] = wasmExports['statvfs'])(a0, a1))
  let _strcasecmp = (Module['_strcasecmp'] = (a0, a1) =>
    (_strcasecmp = Module['_strcasecmp'] = wasmExports['strcasecmp'])(a0, a1))
  let _strerror_r = (Module['_strerror_r'] = (a0, a1, a2) =>
    (_strerror_r = Module['_strerror_r'] = wasmExports['strerror_r'])(
      a0,
      a1,
      a2,
    ))
  let _strftime = (Module['_strftime'] = (a0, a1, a2, a3) =>
    (_strftime = Module['_strftime'] = wasmExports['strftime'])(a0, a1, a2, a3))
  let _strncasecmp = (Module['_strncasecmp'] = (a0, a1, a2) =>
    (_strncasecmp = Module['_strncasecmp'] = wasmExports['strncasecmp'])(
      a0,
      a1,
      a2,
    ))
  let ___multf3 = (Module['___multf3'] = (a0, a1, a2, a3, a4) =>
    (___multf3 = Module['___multf3'] = wasmExports['__multf3'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let ___addtf3 = (Module['___addtf3'] = (a0, a1, a2, a3, a4) =>
    (___addtf3 = Module['___addtf3'] = wasmExports['__addtf3'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let ___extenddftf2 = (Module['___extenddftf2'] = (a0, a1) =>
    (___extenddftf2 = Module['___extenddftf2'] = wasmExports['__extenddftf2'])(
      a0,
      a1,
    ))
  let ___subtf3 = (Module['___subtf3'] = (a0, a1, a2, a3, a4) =>
    (___subtf3 = Module['___subtf3'] = wasmExports['__subtf3'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let ___divtf3 = (Module['___divtf3'] = (a0, a1, a2, a3, a4) =>
    (___divtf3 = Module['___divtf3'] = wasmExports['__divtf3'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let ___eqtf2 = (Module['___eqtf2'] = (a0, a1, a2, a3) =>
    (___eqtf2 = Module['___eqtf2'] = wasmExports['__eqtf2'])(a0, a1, a2, a3))
  let ___trunctfdf2 = (Module['___trunctfdf2'] = (a0, a1) =>
    (___trunctfdf2 = Module['___trunctfdf2'] = wasmExports['__trunctfdf2'])(
      a0,
      a1,
    ))
  let _strtold = (Module['_strtold'] = (a0, a1, a2) =>
    (_strtold = Module['_strtold'] = wasmExports['strtold'])(a0, a1, a2))
  let _strtof_l = (Module['_strtof_l'] = (a0, a1, a2) =>
    (_strtof_l = Module['_strtof_l'] = wasmExports['strtof_l'])(a0, a1, a2))
  let _strtod_l = (Module['_strtod_l'] = (a0, a1, a2) =>
    (_strtod_l = Module['_strtod_l'] = wasmExports['strtod_l'])(a0, a1, a2))
  let _strtold_l = (Module['_strtold_l'] = (a0, a1, a2, a3) =>
    (_strtold_l = Module['_strtold_l'] = wasmExports['strtold_l'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _strtok = (Module['_strtok'] = (a0, a1) =>
    (_strtok = Module['_strtok'] = wasmExports['strtok'])(a0, a1))
  let _strtoull_l = (Module['_strtoull_l'] = (a0, a1, a2, a3) =>
    (_strtoull_l = Module['_strtoull_l'] = wasmExports['strtoull_l'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _strtoll_l = (Module['_strtoll_l'] = (a0, a1, a2, a3) =>
    (_strtoll_l = Module['_strtoll_l'] = wasmExports['strtoll_l'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _swprintf = (Module['_swprintf'] = (a0, a1, a2, a3) =>
    (_swprintf = Module['_swprintf'] = wasmExports['swprintf'])(a0, a1, a2, a3))
  let _trunc = (Module['_trunc'] = (a0) =>
    (_trunc = Module['_trunc'] = wasmExports['trunc'])(a0))
  let _ungetc = (Module['_ungetc'] = (a0, a1) =>
    (_ungetc = Module['_ungetc'] = wasmExports['ungetc'])(a0, a1))
  let _ungetwc = (Module['_ungetwc'] = (a0, a1) =>
    (_ungetwc = Module['_ungetwc'] = wasmExports['ungetwc'])(a0, a1))
  let _unlinkat = (Module['_unlinkat'] = (a0, a1, a2) =>
    (_unlinkat = Module['_unlinkat'] = wasmExports['unlinkat'])(a0, a1, a2))
  let _usleep = (Module['_usleep'] = (a0) =>
    (_usleep = Module['_usleep'] = wasmExports['usleep'])(a0))
  let _utimensat = (Module['_utimensat'] = (a0, a1, a2, a3) =>
    (_utimensat = Module['_utimensat'] = wasmExports['utimensat'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _vasprintf = (Module['_vasprintf'] = (a0, a1, a2) =>
    (_vasprintf = Module['_vasprintf'] = wasmExports['vasprintf'])(a0, a1, a2))
  let _wcrtomb = (Module['_wcrtomb'] = (a0, a1, a2) =>
    (_wcrtomb = Module['_wcrtomb'] = wasmExports['wcrtomb'])(a0, a1, a2))
  let _wcslen = (Module['_wcslen'] = (a0) =>
    (_wcslen = Module['_wcslen'] = wasmExports['wcslen'])(a0))
  let _wcscoll_l = (Module['_wcscoll_l'] = (a0, a1, a2) =>
    (_wcscoll_l = Module['_wcscoll_l'] = wasmExports['wcscoll_l'])(a0, a1, a2))
  let _wcsnrtombs = (Module['_wcsnrtombs'] = (a0, a1, a2, a3, a4) =>
    (_wcsnrtombs = Module['_wcsnrtombs'] = wasmExports['wcsnrtombs'])(
      a0,
      a1,
      a2,
      a3,
      a4,
    ))
  let _wcstof = (Module['_wcstof'] = (a0, a1) =>
    (_wcstof = Module['_wcstof'] = wasmExports['wcstof'])(a0, a1))
  let _wcstod = (Module['_wcstod'] = (a0, a1) =>
    (_wcstod = Module['_wcstod'] = wasmExports['wcstod'])(a0, a1))
  let _wcstold = (Module['_wcstold'] = (a0, a1, a2) =>
    (_wcstold = Module['_wcstold'] = wasmExports['wcstold'])(a0, a1, a2))
  let _wcstoull = (Module['_wcstoull'] = (a0, a1, a2) =>
    (_wcstoull = Module['_wcstoull'] = wasmExports['wcstoull'])(a0, a1, a2))
  let _wcstoll = (Module['_wcstoll'] = (a0, a1, a2) =>
    (_wcstoll = Module['_wcstoll'] = wasmExports['wcstoll'])(a0, a1, a2))
  let _wcstoul = (Module['_wcstoul'] = (a0, a1, a2) =>
    (_wcstoul = Module['_wcstoul'] = wasmExports['wcstoul'])(a0, a1, a2))
  let _wcstol = (Module['_wcstol'] = (a0, a1, a2) =>
    (_wcstol = Module['_wcstol'] = wasmExports['wcstol'])(a0, a1, a2))
  let _wcsxfrm_l = (Module['_wcsxfrm_l'] = (a0, a1, a2, a3) =>
    (_wcsxfrm_l = Module['_wcsxfrm_l'] = wasmExports['wcsxfrm_l'])(
      a0,
      a1,
      a2,
      a3,
    ))
  let _wctob = (Module['_wctob'] = (a0) =>
    (_wctob = Module['_wctob'] = wasmExports['wctob'])(a0))
  let _wmemchr = (Module['_wmemchr'] = (a0, a1, a2) =>
    (_wmemchr = Module['_wmemchr'] = wasmExports['wmemchr'])(a0, a1, a2))
  let _wmemcmp = (Module['_wmemcmp'] = (a0, a1, a2) =>
    (_wmemcmp = Module['_wmemcmp'] = wasmExports['wmemcmp'])(a0, a1, a2))
  let ___lttf2 = (Module['___lttf2'] = (a0, a1, a2, a3) =>
    (___lttf2 = Module['___lttf2'] = wasmExports['__lttf2'])(a0, a1, a2, a3))
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
  let __Znwm = (Module['__Znwm'] = (a0) =>
    (__Znwm = Module['__Znwm'] = wasmExports['_Znwm'])(a0))
  let __ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t = (Module[
    '__ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t'
  ] = (a0, a1, a2) =>
    (__ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t = Module[
      '__ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t'
    ] =
      wasmExports['_ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t'])(
      a0,
      a1,
      a2,
    ))
  let __ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t = (Module[
    '__ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t'
  ] = (a0, a1, a2) =>
    (__ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t = Module[
      '__ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t'
    ] =
      wasmExports['_ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t'])(
      a0,
      a1,
      a2,
    ))
  let __ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t = (Module[
    '__ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t'
  ] = (a0, a1, a2) =>
    (__ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t = Module[
      '__ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t'
    ] =
      wasmExports['_ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t'])(
      a0,
      a1,
      a2,
    ))
  let __ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t = (Module[
    '__ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t'
  ] = (a0, a1, a2) =>
    (__ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t = Module[
      '__ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t'
    ] =
      wasmExports['_ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t'])(
      a0,
      a1,
      a2,
    ))
  let __ZSt15get_new_handlerv = (Module['__ZSt15get_new_handlerv'] = () =>
    (__ZSt15get_new_handlerv = Module['__ZSt15get_new_handlerv'] =
      wasmExports['_ZSt15get_new_handlerv'])())
  let __ZdlPv = (Module['__ZdlPv'] = (a0) =>
    (__ZdlPv = Module['__ZdlPv'] = wasmExports['_ZdlPv'])(a0))
  let __ZNSt13runtime_errorD2Ev = (Module['__ZNSt13runtime_errorD2Ev'] = (a0) =>
    (__ZNSt13runtime_errorD2Ev = Module['__ZNSt13runtime_errorD2Ev'] =
      wasmExports['_ZNSt13runtime_errorD2Ev'])(a0))
  let __ZNKSt13runtime_error4whatEv = (Module['__ZNKSt13runtime_error4whatEv'] =
    (a0) =>
      (__ZNKSt13runtime_error4whatEv = Module['__ZNKSt13runtime_error4whatEv'] =
        wasmExports['_ZNKSt13runtime_error4whatEv'])(a0))
  let __ZSt9terminatev = (Module['__ZSt9terminatev'] = () =>
    (__ZSt9terminatev = Module['__ZSt9terminatev'] =
      wasmExports['_ZSt9terminatev'])())
  let __ZNSt11logic_errorD2Ev = (Module['__ZNSt11logic_errorD2Ev'] = (a0) =>
    (__ZNSt11logic_errorD2Ev = Module['__ZNSt11logic_errorD2Ev'] =
      wasmExports['_ZNSt11logic_errorD2Ev'])(a0))
  let ___cxa_decrement_exception_refcount = (Module[
    '___cxa_decrement_exception_refcount'
  ] = (a0) =>
    (___cxa_decrement_exception_refcount = Module[
      '___cxa_decrement_exception_refcount'
    ] =
      wasmExports['__cxa_decrement_exception_refcount'])(a0))
  let ___cxa_increment_exception_refcount = (Module[
    '___cxa_increment_exception_refcount'
  ] = (a0) =>
    (___cxa_increment_exception_refcount = Module[
      '___cxa_increment_exception_refcount'
    ] =
      wasmExports['__cxa_increment_exception_refcount'])(a0))
  let __ZNSt9exceptionD2Ev = (Module['__ZNSt9exceptionD2Ev'] = (a0) =>
    (__ZNSt9exceptionD2Ev = Module['__ZNSt9exceptionD2Ev'] =
      wasmExports['_ZNSt9exceptionD2Ev'])(a0))
  let __ZNKSt11logic_error4whatEv = (Module['__ZNKSt11logic_error4whatEv'] = (
    a0,
  ) =>
    (__ZNKSt11logic_error4whatEv = Module['__ZNKSt11logic_error4whatEv'] =
      wasmExports['_ZNKSt11logic_error4whatEv'])(a0))
  let ___cxa_bad_cast = (Module['___cxa_bad_cast'] = () =>
    (___cxa_bad_cast = Module['___cxa_bad_cast'] =
      wasmExports['__cxa_bad_cast'])())
  let ___cxa_bad_typeid = (Module['___cxa_bad_typeid'] = () =>
    (___cxa_bad_typeid = Module['___cxa_bad_typeid'] =
      wasmExports['__cxa_bad_typeid'])())
  let ___cxa_allocate_exception = (Module['___cxa_allocate_exception'] = (a0) =>
    (___cxa_allocate_exception = Module['___cxa_allocate_exception'] =
      wasmExports['__cxa_allocate_exception'])(a0))
  let ___cxa_free_exception = (Module['___cxa_free_exception'] = (a0) =>
    (___cxa_free_exception = Module['___cxa_free_exception'] =
      wasmExports['__cxa_free_exception'])(a0))
  let ___cxa_init_primary_exception = (Module['___cxa_init_primary_exception'] =
    (a0, a1, a2) =>
      (___cxa_init_primary_exception = Module['___cxa_init_primary_exception'] =
        wasmExports['__cxa_init_primary_exception'])(a0, a1, a2))
  let __ZNSt9type_infoD2Ev = (Module['__ZNSt9type_infoD2Ev'] = (a0) =>
    (__ZNSt9type_infoD2Ev = Module['__ZNSt9type_infoD2Ev'] =
      wasmExports['_ZNSt9type_infoD2Ev'])(a0))
  let ___cxa_can_catch = (a0, a1, a2) =>
    (___cxa_can_catch = wasmExports['__cxa_can_catch'])(a0, a1, a2)
  let ___cxa_get_exception_ptr = (Module['___cxa_get_exception_ptr'] = (a0) =>
    (___cxa_get_exception_ptr = Module['___cxa_get_exception_ptr'] =
      wasmExports['__cxa_get_exception_ptr'])(a0))
  let __ZNSt9exceptionD0Ev = (Module['__ZNSt9exceptionD0Ev'] = (a0) =>
    (__ZNSt9exceptionD0Ev = Module['__ZNSt9exceptionD0Ev'] =
      wasmExports['_ZNSt9exceptionD0Ev'])(a0))
  let __ZNSt9exceptionD1Ev = (Module['__ZNSt9exceptionD1Ev'] = (a0) =>
    (__ZNSt9exceptionD1Ev = Module['__ZNSt9exceptionD1Ev'] =
      wasmExports['_ZNSt9exceptionD1Ev'])(a0))
  let __ZNKSt9exception4whatEv = (Module['__ZNKSt9exception4whatEv'] = (a0) =>
    (__ZNKSt9exception4whatEv = Module['__ZNKSt9exception4whatEv'] =
      wasmExports['_ZNKSt9exception4whatEv'])(a0))
  let __ZNSt13bad_exceptionD0Ev = (Module['__ZNSt13bad_exceptionD0Ev'] = (a0) =>
    (__ZNSt13bad_exceptionD0Ev = Module['__ZNSt13bad_exceptionD0Ev'] =
      wasmExports['_ZNSt13bad_exceptionD0Ev'])(a0))
  let __ZNSt13bad_exceptionD1Ev = (Module['__ZNSt13bad_exceptionD1Ev'] = (a0) =>
    (__ZNSt13bad_exceptionD1Ev = Module['__ZNSt13bad_exceptionD1Ev'] =
      wasmExports['_ZNSt13bad_exceptionD1Ev'])(a0))
  let __ZNKSt13bad_exception4whatEv = (Module['__ZNKSt13bad_exception4whatEv'] =
    (a0) =>
      (__ZNKSt13bad_exception4whatEv = Module['__ZNKSt13bad_exception4whatEv'] =
        wasmExports['_ZNKSt13bad_exception4whatEv'])(a0))
  let __ZNSt9bad_allocC2Ev = (Module['__ZNSt9bad_allocC2Ev'] = (a0) =>
    (__ZNSt9bad_allocC2Ev = Module['__ZNSt9bad_allocC2Ev'] =
      wasmExports['_ZNSt9bad_allocC2Ev'])(a0))
  let __ZNSt9bad_allocD0Ev = (Module['__ZNSt9bad_allocD0Ev'] = (a0) =>
    (__ZNSt9bad_allocD0Ev = Module['__ZNSt9bad_allocD0Ev'] =
      wasmExports['_ZNSt9bad_allocD0Ev'])(a0))
  let __ZNSt9bad_allocD1Ev = (Module['__ZNSt9bad_allocD1Ev'] = (a0) =>
    (__ZNSt9bad_allocD1Ev = Module['__ZNSt9bad_allocD1Ev'] =
      wasmExports['_ZNSt9bad_allocD1Ev'])(a0))
  let __ZNKSt9bad_alloc4whatEv = (Module['__ZNKSt9bad_alloc4whatEv'] = (a0) =>
    (__ZNKSt9bad_alloc4whatEv = Module['__ZNKSt9bad_alloc4whatEv'] =
      wasmExports['_ZNKSt9bad_alloc4whatEv'])(a0))
  let __ZNSt20bad_array_new_lengthC2Ev = (Module[
    '__ZNSt20bad_array_new_lengthC2Ev'
  ] = (a0) =>
    (__ZNSt20bad_array_new_lengthC2Ev = Module[
      '__ZNSt20bad_array_new_lengthC2Ev'
    ] =
      wasmExports['_ZNSt20bad_array_new_lengthC2Ev'])(a0))
  let __ZNSt20bad_array_new_lengthD0Ev = (Module[
    '__ZNSt20bad_array_new_lengthD0Ev'
  ] = (a0) =>
    (__ZNSt20bad_array_new_lengthD0Ev = Module[
      '__ZNSt20bad_array_new_lengthD0Ev'
    ] =
      wasmExports['_ZNSt20bad_array_new_lengthD0Ev'])(a0))
  let __ZNSt20bad_array_new_lengthD1Ev = (Module[
    '__ZNSt20bad_array_new_lengthD1Ev'
  ] = (a0) =>
    (__ZNSt20bad_array_new_lengthD1Ev = Module[
      '__ZNSt20bad_array_new_lengthD1Ev'
    ] =
      wasmExports['_ZNSt20bad_array_new_lengthD1Ev'])(a0))
  let __ZNKSt20bad_array_new_length4whatEv = (Module[
    '__ZNKSt20bad_array_new_length4whatEv'
  ] = (a0) =>
    (__ZNKSt20bad_array_new_length4whatEv = Module[
      '__ZNKSt20bad_array_new_length4whatEv'
    ] =
      wasmExports['_ZNKSt20bad_array_new_length4whatEv'])(a0))
  let __ZNSt13bad_exceptionD2Ev = (Module['__ZNSt13bad_exceptionD2Ev'] = (a0) =>
    (__ZNSt13bad_exceptionD2Ev = Module['__ZNSt13bad_exceptionD2Ev'] =
      wasmExports['_ZNSt13bad_exceptionD2Ev'])(a0))
  let __ZNSt9bad_allocC1Ev = (Module['__ZNSt9bad_allocC1Ev'] = (a0) =>
    (__ZNSt9bad_allocC1Ev = Module['__ZNSt9bad_allocC1Ev'] =
      wasmExports['_ZNSt9bad_allocC1Ev'])(a0))
  let __ZNSt9bad_allocD2Ev = (Module['__ZNSt9bad_allocD2Ev'] = (a0) =>
    (__ZNSt9bad_allocD2Ev = Module['__ZNSt9bad_allocD2Ev'] =
      wasmExports['_ZNSt9bad_allocD2Ev'])(a0))
  let __ZNSt20bad_array_new_lengthC1Ev = (Module[
    '__ZNSt20bad_array_new_lengthC1Ev'
  ] = (a0) =>
    (__ZNSt20bad_array_new_lengthC1Ev = Module[
      '__ZNSt20bad_array_new_lengthC1Ev'
    ] =
      wasmExports['_ZNSt20bad_array_new_lengthC1Ev'])(a0))
  let __ZNSt20bad_array_new_lengthD2Ev = (Module[
    '__ZNSt20bad_array_new_lengthD2Ev'
  ] = (a0) =>
    (__ZNSt20bad_array_new_lengthD2Ev = Module[
      '__ZNSt20bad_array_new_lengthD2Ev'
    ] =
      wasmExports['_ZNSt20bad_array_new_lengthD2Ev'])(a0))
  let __ZNSt11logic_errorD0Ev = (Module['__ZNSt11logic_errorD0Ev'] = (a0) =>
    (__ZNSt11logic_errorD0Ev = Module['__ZNSt11logic_errorD0Ev'] =
      wasmExports['_ZNSt11logic_errorD0Ev'])(a0))
  let __ZNSt11logic_errorD1Ev = (Module['__ZNSt11logic_errorD1Ev'] = (a0) =>
    (__ZNSt11logic_errorD1Ev = Module['__ZNSt11logic_errorD1Ev'] =
      wasmExports['_ZNSt11logic_errorD1Ev'])(a0))
  let __ZNSt13runtime_errorD0Ev = (Module['__ZNSt13runtime_errorD0Ev'] = (a0) =>
    (__ZNSt13runtime_errorD0Ev = Module['__ZNSt13runtime_errorD0Ev'] =
      wasmExports['_ZNSt13runtime_errorD0Ev'])(a0))
  let __ZNSt13runtime_errorD1Ev = (Module['__ZNSt13runtime_errorD1Ev'] = (a0) =>
    (__ZNSt13runtime_errorD1Ev = Module['__ZNSt13runtime_errorD1Ev'] =
      wasmExports['_ZNSt13runtime_errorD1Ev'])(a0))
  let __ZNSt12domain_errorD0Ev = (Module['__ZNSt12domain_errorD0Ev'] = (a0) =>
    (__ZNSt12domain_errorD0Ev = Module['__ZNSt12domain_errorD0Ev'] =
      wasmExports['_ZNSt12domain_errorD0Ev'])(a0))
  let __ZNSt12domain_errorD1Ev = (Module['__ZNSt12domain_errorD1Ev'] = (a0) =>
    (__ZNSt12domain_errorD1Ev = Module['__ZNSt12domain_errorD1Ev'] =
      wasmExports['_ZNSt12domain_errorD1Ev'])(a0))
  let __ZNSt16invalid_argumentD0Ev = (Module['__ZNSt16invalid_argumentD0Ev'] = (
    a0,
  ) =>
    (__ZNSt16invalid_argumentD0Ev = Module['__ZNSt16invalid_argumentD0Ev'] =
      wasmExports['_ZNSt16invalid_argumentD0Ev'])(a0))
  let __ZNSt16invalid_argumentD1Ev = (Module['__ZNSt16invalid_argumentD1Ev'] = (
    a0,
  ) =>
    (__ZNSt16invalid_argumentD1Ev = Module['__ZNSt16invalid_argumentD1Ev'] =
      wasmExports['_ZNSt16invalid_argumentD1Ev'])(a0))
  let __ZNSt12length_errorD0Ev = (Module['__ZNSt12length_errorD0Ev'] = (a0) =>
    (__ZNSt12length_errorD0Ev = Module['__ZNSt12length_errorD0Ev'] =
      wasmExports['_ZNSt12length_errorD0Ev'])(a0))
  let __ZNSt12length_errorD1Ev = (Module['__ZNSt12length_errorD1Ev'] = (a0) =>
    (__ZNSt12length_errorD1Ev = Module['__ZNSt12length_errorD1Ev'] =
      wasmExports['_ZNSt12length_errorD1Ev'])(a0))
  let __ZNSt12out_of_rangeD0Ev = (Module['__ZNSt12out_of_rangeD0Ev'] = (a0) =>
    (__ZNSt12out_of_rangeD0Ev = Module['__ZNSt12out_of_rangeD0Ev'] =
      wasmExports['_ZNSt12out_of_rangeD0Ev'])(a0))
  let __ZNSt12out_of_rangeD1Ev = (Module['__ZNSt12out_of_rangeD1Ev'] = (a0) =>
    (__ZNSt12out_of_rangeD1Ev = Module['__ZNSt12out_of_rangeD1Ev'] =
      wasmExports['_ZNSt12out_of_rangeD1Ev'])(a0))
  let __ZNSt11range_errorD0Ev = (Module['__ZNSt11range_errorD0Ev'] = (a0) =>
    (__ZNSt11range_errorD0Ev = Module['__ZNSt11range_errorD0Ev'] =
      wasmExports['_ZNSt11range_errorD0Ev'])(a0))
  let __ZNSt11range_errorD1Ev = (Module['__ZNSt11range_errorD1Ev'] = (a0) =>
    (__ZNSt11range_errorD1Ev = Module['__ZNSt11range_errorD1Ev'] =
      wasmExports['_ZNSt11range_errorD1Ev'])(a0))
  let __ZNSt14overflow_errorD0Ev = (Module['__ZNSt14overflow_errorD0Ev'] = (
    a0,
  ) =>
    (__ZNSt14overflow_errorD0Ev = Module['__ZNSt14overflow_errorD0Ev'] =
      wasmExports['_ZNSt14overflow_errorD0Ev'])(a0))
  let __ZNSt14overflow_errorD1Ev = (Module['__ZNSt14overflow_errorD1Ev'] = (
    a0,
  ) =>
    (__ZNSt14overflow_errorD1Ev = Module['__ZNSt14overflow_errorD1Ev'] =
      wasmExports['_ZNSt14overflow_errorD1Ev'])(a0))
  let __ZNSt15underflow_errorD0Ev = (Module['__ZNSt15underflow_errorD0Ev'] = (
    a0,
  ) =>
    (__ZNSt15underflow_errorD0Ev = Module['__ZNSt15underflow_errorD0Ev'] =
      wasmExports['_ZNSt15underflow_errorD0Ev'])(a0))
  let __ZNSt15underflow_errorD1Ev = (Module['__ZNSt15underflow_errorD1Ev'] = (
    a0,
  ) =>
    (__ZNSt15underflow_errorD1Ev = Module['__ZNSt15underflow_errorD1Ev'] =
      wasmExports['_ZNSt15underflow_errorD1Ev'])(a0))
  let __ZNSt12domain_errorD2Ev = (Module['__ZNSt12domain_errorD2Ev'] = (a0) =>
    (__ZNSt12domain_errorD2Ev = Module['__ZNSt12domain_errorD2Ev'] =
      wasmExports['_ZNSt12domain_errorD2Ev'])(a0))
  let __ZNSt16invalid_argumentD2Ev = (Module['__ZNSt16invalid_argumentD2Ev'] = (
    a0,
  ) =>
    (__ZNSt16invalid_argumentD2Ev = Module['__ZNSt16invalid_argumentD2Ev'] =
      wasmExports['_ZNSt16invalid_argumentD2Ev'])(a0))
  let __ZNSt12length_errorD2Ev = (Module['__ZNSt12length_errorD2Ev'] = (a0) =>
    (__ZNSt12length_errorD2Ev = Module['__ZNSt12length_errorD2Ev'] =
      wasmExports['_ZNSt12length_errorD2Ev'])(a0))
  let __ZNSt12out_of_rangeD2Ev = (Module['__ZNSt12out_of_rangeD2Ev'] = (a0) =>
    (__ZNSt12out_of_rangeD2Ev = Module['__ZNSt12out_of_rangeD2Ev'] =
      wasmExports['_ZNSt12out_of_rangeD2Ev'])(a0))
  let __ZNSt11range_errorD2Ev = (Module['__ZNSt11range_errorD2Ev'] = (a0) =>
    (__ZNSt11range_errorD2Ev = Module['__ZNSt11range_errorD2Ev'] =
      wasmExports['_ZNSt11range_errorD2Ev'])(a0))
  let __ZNSt14overflow_errorD2Ev = (Module['__ZNSt14overflow_errorD2Ev'] = (
    a0,
  ) =>
    (__ZNSt14overflow_errorD2Ev = Module['__ZNSt14overflow_errorD2Ev'] =
      wasmExports['_ZNSt14overflow_errorD2Ev'])(a0))
  let __ZNSt15underflow_errorD2Ev = (Module['__ZNSt15underflow_errorD2Ev'] = (
    a0,
  ) =>
    (__ZNSt15underflow_errorD2Ev = Module['__ZNSt15underflow_errorD2Ev'] =
      wasmExports['_ZNSt15underflow_errorD2Ev'])(a0))
  let __ZNSt9type_infoD0Ev = (Module['__ZNSt9type_infoD0Ev'] = (a0) =>
    (__ZNSt9type_infoD0Ev = Module['__ZNSt9type_infoD0Ev'] =
      wasmExports['_ZNSt9type_infoD0Ev'])(a0))
  let __ZNSt9type_infoD1Ev = (Module['__ZNSt9type_infoD1Ev'] = (a0) =>
    (__ZNSt9type_infoD1Ev = Module['__ZNSt9type_infoD1Ev'] =
      wasmExports['_ZNSt9type_infoD1Ev'])(a0))
  let __ZNSt8bad_castC2Ev = (Module['__ZNSt8bad_castC2Ev'] = (a0) =>
    (__ZNSt8bad_castC2Ev = Module['__ZNSt8bad_castC2Ev'] =
      wasmExports['_ZNSt8bad_castC2Ev'])(a0))
  let __ZNSt8bad_castD2Ev = (Module['__ZNSt8bad_castD2Ev'] = (a0) =>
    (__ZNSt8bad_castD2Ev = Module['__ZNSt8bad_castD2Ev'] =
      wasmExports['_ZNSt8bad_castD2Ev'])(a0))
  let __ZNSt8bad_castD0Ev = (Module['__ZNSt8bad_castD0Ev'] = (a0) =>
    (__ZNSt8bad_castD0Ev = Module['__ZNSt8bad_castD0Ev'] =
      wasmExports['_ZNSt8bad_castD0Ev'])(a0))
  let __ZNSt8bad_castD1Ev = (Module['__ZNSt8bad_castD1Ev'] = (a0) =>
    (__ZNSt8bad_castD1Ev = Module['__ZNSt8bad_castD1Ev'] =
      wasmExports['_ZNSt8bad_castD1Ev'])(a0))
  let __ZNKSt8bad_cast4whatEv = (Module['__ZNKSt8bad_cast4whatEv'] = (a0) =>
    (__ZNKSt8bad_cast4whatEv = Module['__ZNKSt8bad_cast4whatEv'] =
      wasmExports['_ZNKSt8bad_cast4whatEv'])(a0))
  let __ZNSt10bad_typeidC2Ev = (Module['__ZNSt10bad_typeidC2Ev'] = (a0) =>
    (__ZNSt10bad_typeidC2Ev = Module['__ZNSt10bad_typeidC2Ev'] =
      wasmExports['_ZNSt10bad_typeidC2Ev'])(a0))
  let __ZNSt10bad_typeidD2Ev = (Module['__ZNSt10bad_typeidD2Ev'] = (a0) =>
    (__ZNSt10bad_typeidD2Ev = Module['__ZNSt10bad_typeidD2Ev'] =
      wasmExports['_ZNSt10bad_typeidD2Ev'])(a0))
  let __ZNSt10bad_typeidD0Ev = (Module['__ZNSt10bad_typeidD0Ev'] = (a0) =>
    (__ZNSt10bad_typeidD0Ev = Module['__ZNSt10bad_typeidD0Ev'] =
      wasmExports['_ZNSt10bad_typeidD0Ev'])(a0))
  let __ZNSt10bad_typeidD1Ev = (Module['__ZNSt10bad_typeidD1Ev'] = (a0) =>
    (__ZNSt10bad_typeidD1Ev = Module['__ZNSt10bad_typeidD1Ev'] =
      wasmExports['_ZNSt10bad_typeidD1Ev'])(a0))
  let __ZNKSt10bad_typeid4whatEv = (Module['__ZNKSt10bad_typeid4whatEv'] = (
    a0,
  ) =>
    (__ZNKSt10bad_typeid4whatEv = Module['__ZNKSt10bad_typeid4whatEv'] =
      wasmExports['_ZNKSt10bad_typeid4whatEv'])(a0))
  let __ZNSt8bad_castC1Ev = (Module['__ZNSt8bad_castC1Ev'] = (a0) =>
    (__ZNSt8bad_castC1Ev = Module['__ZNSt8bad_castC1Ev'] =
      wasmExports['_ZNSt8bad_castC1Ev'])(a0))
  let __ZNSt10bad_typeidC1Ev = (Module['__ZNSt10bad_typeidC1Ev'] = (a0) =>
    (__ZNSt10bad_typeidC1Ev = Module['__ZNSt10bad_typeidC1Ev'] =
      wasmExports['_ZNSt10bad_typeidC1Ev'])(a0))
  let ___wasm_apply_data_relocs = () =>
    (___wasm_apply_data_relocs = wasmExports['__wasm_apply_data_relocs'])()
  Module['_LocalBufferBlockPointers'] = 2796604
  Module['_BufferBlocks'] = 2791308
  Module['_wal_level'] = 2582944
  Module['_CurrentMemoryContext'] = 2880704
  Module['_SnapshotAnyData'] = 2674208
  Module['_debug_query_string'] = 2804316
  Module['_maintenance_work_mem'] = 2618976
  Module['_CritSectionCount'] = 2875364
  Module['_InterruptPending'] = 2875312
  Module['_ParallelWorkerNumber'] = 2574456
  Module['_pg_number_of_ones'] = 2034800
  Module['_TopMemoryContext'] = 2880708
  Module['_IsUnderPostmaster'] = 2875397
  Module['_MainLWLockArray'] = 2802324
  Module['_CurrentResourceOwner'] = 2880756
  Module['_work_mem'] = 2618964
  Module['_pg_global_prng_state'] = 2964208
  Module['_NBuffers'] = 2618984
  Module['_XactIsoLevel'] = 2582808
  Module['_bsysscan'] = 2775716
  Module['_CheckXidAlive'] = 2775712
  Module['_MyProc'] = 2804140
  Module['_MyDatabaseId'] = 2875376
  Module['_TTSOpsBufferHeapTuple'] = 2586992
  Module['_RecentXmin'] = 2674356
  Module['_TTSOpsHeapTuple'] = 2586888
  Module['_pgWalUsage'] = 2779064
  Module['_pgBufferUsage'] = 2778936
  Module['_error_context_stack'] = 2873608
  Module['_MyLatch'] = 2875524
  Module['___THREW__'] = 2981972
  Module['___threwValue'] = 2981976
  Module['_PG_exception_stack'] = 2873612
  Module['_TTSOpsVirtual'] = 2586836
  Module['_GUC_check_errdetail_string'] = 2879292
  Module['_TransamVariables'] = 2775704
  Module['_TopTransactionContext'] = 2880728
  Module['_MyProcPid'] = 2875448
  Module['_RmgrTable'] = 2574528
  Module['_process_shared_preload_libraries_in_progress'] = 2878688
  Module['_wal_segment_size'] = 2582964
  Module['_TopTransactionResourceOwner'] = 2880764
  Module['_arch_module_check_errdetail_string'] = 2788776
  Module['_stdout'] = 2770224
  Module['_stdin'] = 2770072
  Module['_object_access_hook'] = 2777456
  Module['_InvalidObjectAddress'] = 736344
  Module['_check_function_bodies'] = 2619166
  Module['_post_parse_analyze_hook'] = 2777496
  Module['_ScanKeywordTokens'] = 1285648
  Module['_ScanKeywords'] = 2726024
  Module['_None_Receiver'] = 2592780
  Module['_explain_per_plan_hook'] = 2777640
  Module['_explain_per_node_hook'] = 2777644
  Module['_CacheMemoryContext'] = 2880720
  Module['_SPI_processed'] = 2779256
  Module['_SPI_tuptable'] = 2779264
  Module['_TTSOpsMinimalTuple'] = 2586940
  Module['_check_password_hook'] = 2777804
  Module['_ConfigReloadPending'] = 2788748
  Module['_max_parallel_maintenance_workers'] = 2618980
  Module['_DateStyle'] = 2618952
  Module['_ExecutorStart_hook'] = 2778912
  Module['_ExecutorRun_hook'] = 2778916
  Module['_ExecutorFinish_hook'] = 2778920
  Module['_ExecutorEnd_hook'] = 2778924
  Module['_SPI_result'] = 2779268
  Module['_stderr'] = 2769920
  Module['_MyProcPort'] = 2875476
  Module['_ClientAuthentication_hook'] = 2779472
  Module['_set_rel_pathlist_hook'] = 2788336
  Module['_cpu_tuple_cost'] = 2587464
  Module['_cpu_operator_cost'] = 2587480
  Module['_seq_page_cost'] = 2587448
  Module['_planner_hook'] = 2788380
  Module['_QueryCancelPending'] = 2875316
  Module['_ShutdownRequestPending'] = 2788752
  Module['_MyStartTime'] = 2875456
  Module['_cluster_name'] = 2619216
  Module['_ProcDiePending'] = 2875320
  Module['_application_name'] = 2879500
  Module['_row_security_policy_hook_restrictive'] = 2791276
  Module['_row_security_policy_hook_permissive'] = 2791272
  Module['_BufferDescriptors'] = 2791304
  Module['_shmem_startup_hook'] = 2797300
  Module['_ProcessUtility_hook'] = 2804520
  Module['_IntervalStyle'] = 2875400
  Module['_extra_float_digits'] = 2609272
  Module['_pg_crc32_table'] = 1698672
  Module['_shmem_request_hook'] = 2878692
  Module['__ZTVN10__cxxabiv120__si_class_type_infoE'] = 2770852
  Module['__ZTVN10__cxxabiv117__class_type_infoE'] = 2770812
  Module['__ZTVN10__cxxabiv121__vmi_class_type_infoE'] = 2770904
  Module['__ZTVSt11logic_error'] = 2771164
  Module['__ZTVSt9exception'] = 2771080
  Module['__ZTVSt13runtime_error'] = 2771184
  Module['__ZTISt13runtime_error'] = 2771376
  Module['__ZTISt9exception'] = 2771100
  Module['__ZTISt11logic_error'] = 2771236
  Module['__ZTISt9type_info'] = 2771508
  Module['__ZTVN10__cxxabiv116__shim_type_infoE'] = 2770500
  Module['__ZTVN10__cxxabiv123__fundamental_type_infoE'] = 2770528
  Module['__ZTVN10__cxxabiv119__pointer_type_infoE'] = 2770984
  Module['__ZTIb'] = 2770584
  Module['__ZTIPKc'] = 2770600
  Module['__ZTIh'] = 2770616
  Module['__ZTIa'] = 2770624
  Module['__ZTIs'] = 2770632
  Module['__ZTIt'] = 2770640
  Module['__ZTIi'] = 2770648
  Module['__ZTIj'] = 2770656
  Module['__ZTIl'] = 2770664
  Module['__ZTIm'] = 2770672
  Module['__ZTIx'] = 2770680
  Module['__ZTIf'] = 2770688
  Module['__ZTId'] = 2770696
  Module['__ZTVN10__cxxabiv117__array_type_infoE'] = 2770704
  Module['__ZTVN10__cxxabiv120__function_type_infoE'] = 2770744
  Module['__ZTVN10__cxxabiv116__enum_type_infoE'] = 2770772
  Module['__ZTVN10__cxxabiv117__pbase_type_infoE'] = 2770956
  Module['__ZTVN10__cxxabiv129__pointer_to_member_type_infoE'] = 2771012
  Module['__ZTVSt9bad_alloc'] = 2771040
  Module['__ZTVSt20bad_array_new_length'] = 2771060
  Module['__ZTISt9bad_alloc'] = 2771140
  Module['__ZTISt20bad_array_new_length'] = 2771152
  Module['__ZTSSt9exception'] = 2559709
  Module['__ZTVSt13bad_exception'] = 2771108
  Module['__ZTISt13bad_exception'] = 2771128
  Module['__ZTSSt13bad_exception'] = 2559722
  Module['__ZTSSt9bad_alloc'] = 2559740
  Module['__ZTSSt20bad_array_new_length'] = 2559753
  Module['__ZTVSt12domain_error'] = 2771204
  Module['__ZTISt12domain_error'] = 2771224
  Module['__ZTSSt12domain_error'] = 2559778
  Module['__ZTSSt11logic_error'] = 2559795
  Module['__ZTVSt16invalid_argument'] = 2771248
  Module['__ZTISt16invalid_argument'] = 2771268
  Module['__ZTSSt16invalid_argument'] = 2559811
  Module['__ZTVSt12length_error'] = 2771280
  Module['__ZTISt12length_error'] = 2771300
  Module['__ZTSSt12length_error'] = 2559832
  Module['__ZTVSt12out_of_range'] = 2771312
  Module['__ZTISt12out_of_range'] = 2771332
  Module['__ZTSSt12out_of_range'] = 2559849
  Module['__ZTVSt11range_error'] = 2771344
  Module['__ZTISt11range_error'] = 2771364
  Module['__ZTSSt11range_error'] = 2559866
  Module['__ZTSSt13runtime_error'] = 2559882
  Module['__ZTVSt14overflow_error'] = 2771388
  Module['__ZTISt14overflow_error'] = 2771408
  Module['__ZTSSt14overflow_error'] = 2559900
  Module['__ZTVSt15underflow_error'] = 2771420
  Module['__ZTISt15underflow_error'] = 2771440
  Module['__ZTSSt15underflow_error'] = 2559919
  Module['__ZTVSt8bad_cast'] = 2771452
  Module['__ZTVSt10bad_typeid'] = 2771472
  Module['__ZTISt8bad_cast'] = 2771516
  Module['__ZTISt10bad_typeid'] = 2771528
  Module['__ZTVSt9type_info'] = 2771492
  Module['__ZTSSt9type_info'] = 2559939
  Module['__ZTSSt8bad_cast'] = 2559952
  Module['__ZTSSt10bad_typeid'] = 2559964
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
  Module['setValue'] = setValue
  Module['getValue'] = getValue
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
  return Module as PostgresMod
}

const PostgresModFactory = createPostgresModule

export default PostgresModFactory
