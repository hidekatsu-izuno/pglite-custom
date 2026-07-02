import { PGlite } from '@electric-sql/pglite'

const dumpFilePath = '/tmp/out.sql'

type PgDumpExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  __wasm_call_ctors?: () => void
  __main_argc_argv: (argc: number, argv: number) => number
  malloc: (size: number) => number
  free?: (ptr: number) => void
}

interface ExecResult {
  exitCode: number
  fileContents: string
  stderr: string
  stdout: string
}

interface PgDumpOptions {
  pg: PGlite
  args?: string[]
  database?: string
  fileName?: string
  verbose?: boolean
}

const WASI_ESUCCESS = 0
const WASI_EBADF = 8
const WASI_EINVAL = 28
const WASI_ENOENT = 44

const WASI_FILETYPE_DIRECTORY = 3
const WASI_FILETYPE_REGULAR_FILE = 4

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function concat(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength)
  tmp.set(new Uint8Array(buffer1), 0)
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength)
  return tmp
}

function fillRandom(buffer: Uint8Array) {
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer)
    return
  }
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256)
  }
}

async function readPgDumpWasm(): Promise<BufferSource> {
  const wasmUrl = new URL('pg_dump.wasm', import.meta.url)
  if (typeof process === 'object' && process.versions?.node) {
    const fs = await import('node:fs/promises')
    return await fs.readFile(wasmUrl)
  }
  const response = await fetch(wasmUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch pg_dump.wasm: ${response.status}`)
  }
  return await response.arrayBuffer()
}

function readCString(heapU8: Uint8Array, ptr: number, length: number) {
  const bytes = heapU8.subarray(ptr, ptr + length)
  const end = bytes.indexOf(0)
  return textDecoder.decode(end === -1 ? bytes : bytes.subarray(0, end))
}

function writeCString(heapU8: Uint8Array, ptr: number, value: string) {
  const bytes = textEncoder.encode(value)
  heapU8.set(bytes, ptr)
  heapU8[ptr + bytes.length] = 0
}

function writeWasiFilestat(
  heapU8: Uint8Array,
  ptr: number,
  stat: { mode?: number; size?: number } | undefined,
) {
  heapU8.fill(0, ptr, ptr + 64)
  const view = new DataView(heapU8.buffer)
  const isDir = Boolean(stat?.mode && (stat.mode & 0o170000) === 0o040000)
  heapU8[ptr + 16] = isDir
    ? WASI_FILETYPE_DIRECTORY
    : WASI_FILETYPE_REGULAR_FILE
  view.setBigUint64(ptr + 32, BigInt(stat?.size ?? 0), true)
}

function makePgEncodingToChar(exportsRef: () => PgDumpExports | undefined) {
  const allocated = new Map<number, number>()
  const encodings = new Map<number, string>([
    [0, 'SQL_ASCII'],
    [6, 'UTF8'],
    [7, 'LATIN1'],
    [8, 'LATIN2'],
    [9, 'LATIN3'],
    [10, 'LATIN4'],
    [11, 'ISO_8859_5'],
    [12, 'ISO_8859_6'],
    [13, 'ISO_8859_7'],
    [14, 'ISO_8859_8'],
    [15, 'LATIN5'],
    [16, 'LATIN6'],
    [17, 'LATIN7'],
    [18, 'LATIN8'],
    [19, 'LATIN9'],
    [20, 'LATIN10'],
    [21, 'WIN1256'],
    [22, 'WIN1258'],
    [23, 'WIN866'],
    [24, 'WIN874'],
    [25, 'KOI8R'],
    [26, 'WIN1251'],
    [27, 'WIN1252'],
    [28, 'ISO_8859_5'],
    [29, 'ISO_8859_6'],
    [30, 'ISO_8859_7'],
    [31, 'ISO_8859_8'],
    [32, 'WIN1250'],
    [33, 'WIN1253'],
    [34, 'WIN1254'],
    [35, 'WIN1255'],
    [36, 'WIN1257'],
  ])

  return (encoding: number) => {
    const exports = exportsRef()
    if (!exports) return 0
    const cached = allocated.get(encoding)
    if (cached) return cached
    const name = encodings.get(encoding) ?? 'UTF8'
    const ptr = exports.malloc(textEncoder.encode(name).length + 1)
    writeCString(new Uint8Array(exports.memory.buffer), ptr, name)
    allocated.set(encoding, ptr)
    return ptr
  }
}

async function execPgDump({
  pg,
  args,
}: {
  pg: PGlite
  args: string[]
}): Promise<ExecResult> {
  let exitCode = 0
  let stderrOutput = ''
  let stdoutOutput = ''
  let bufferedBytes: Uint8Array = new Uint8Array()
  const exportsRef: { current?: PgDumpExports } = {}
  let nextFd = 4
  const files = new Map<string, Uint8Array>()
  files.set('/home/postgres/.pgpass', textEncoder.encode('\n'))
  const fds = new Map<number, { path: string; position: number }>()
  const argv = ['/pglite/bin/pg_dump', ...args]
  const envStrings = [
    'HOME=/home/postgres',
    'PATH=/pglite/bin',
    'USER=postgres',
    'LOGNAME=postgres',
  ]

  const heapU8 = () => new Uint8Array(exportsRef.current!.memory.buffer)
  const heapView = () => new DataView(exportsRef.current!.memory.buffer)
  const pathFromWasi = (ptr: number, len: number) =>
    `/${readCString(heapU8(), ptr, len)}`.replace(/\/+/g, '/')

  const writeToPg = (ptr: number, length: number, heap: Uint8Array): number => {
    const bytes = heap.subarray(ptr, ptr + length)
    pg.execProtocolRawStream(bytes, {
      onRawData: (bytes) => {
        bufferedBytes = concat(bufferedBytes, bytes)
      },
    })
    return length
  }

  const readFromPg = (
    ptr: number,
    maxLength: number,
    heap: Uint8Array,
  ): number => {
    const length = Math.min(bufferedBytes.length, maxLength)
    heap.set(bufferedBytes.subarray(0, length), ptr)
    bufferedBytes = bufferedBytes.subarray(length)
    return length
  }

  const fdWrite = (fd: number, iov: number, iovcnt: number, pnum: number) => {
    const heap = heapU8()
    const view = heapView()
    let written = 0
    for (let i = 0; i < iovcnt; i++) {
      const ptr = view.getUint32(iov + i * 8, true)
      const len = view.getUint32(iov + i * 8 + 4, true)
      const bytes = heap.subarray(ptr, ptr + len)
      if (fd === 1) {
        stdoutOutput += textDecoder.decode(bytes)
      } else if (fd === 2) {
        stderrOutput += textDecoder.decode(bytes)
      } else {
        const file = fds.get(fd)
        if (!file) return WASI_EBADF
        const current = files.get(file.path) ?? new Uint8Array()
        const nextLength = Math.max(current.length, file.position + len)
        const next = new Uint8Array(nextLength)
        next.set(current)
        next.set(bytes, file.position)
        files.set(file.path, next)
        file.position += len
      }
      written += len
    }
    view.setUint32(pnum, written, true)
    return WASI_ESUCCESS
  }

  const fdRead = (fd: number, iov: number, iovcnt: number, pnum: number) => {
    const file = fds.get(fd)
    if (!file) {
      heapView().setUint32(pnum, 0, true)
      return fd === 0 ? WASI_ESUCCESS : WASI_EBADF
    }
    const data = files.get(file.path) ?? new Uint8Array()
    const heap = heapU8()
    const view = heapView()
    let read = 0
    for (let i = 0; i < iovcnt; i++) {
      const ptr = view.getUint32(iov + i * 8, true)
      const len = view.getUint32(iov + i * 8 + 4, true)
      const bytes = data.subarray(file.position, file.position + len)
      heap.set(bytes, ptr)
      file.position += bytes.length
      read += bytes.length
      if (bytes.length < len) break
    }
    view.setUint32(pnum, read, true)
    return WASI_ESUCCESS
  }

  const writeStringArray = (
    values: string[],
    ptrsPtr: number,
    bufferPtr: number,
  ) => {
    const view = heapView()
    const heap = heapU8()
    let offset = bufferPtr
    for (let i = 0; i < values.length; i++) {
      view.setUint32(ptrsPtr + i * 4, offset, true)
      writeCString(heap, offset, values[i])
      offset += textEncoder.encode(values[i]).length + 1
    }
    return WASI_ESUCCESS
  }

  const imports: WebAssembly.Imports = {
    env: {
      tmpfile: () => 0,
      pg_encoding_to_char: makePgEncodingToChar(() => exports),
      __wasm_longjmp: () => {
        throw new Error('pg_dump wasm longjmp')
      },
      __wasm_setjmp: () => 0,
      __wasm_setjmp_test: () => 0,
      __c_longjmp:
        typeof (WebAssembly as any).Tag === 'function'
          ? new (WebAssembly as any).Tag({ parameters: ['i32'], results: [] })
          : undefined,
    },
    pglite: {
      random: (ptr: number, length: number) => {
        fillRandom(heapU8().subarray(ptr, ptr + length))
        return 0
      },
      socket_read: (ptr: number, maxLength: number) =>
        readFromPg(ptr, maxLength, heapU8()),
      socket_write: (ptr: number, length: number) =>
        writeToPg(ptr, length, heapU8()),
      blob_read: () => 0,
      blob_write: (_ptr: number, length: number) => length,
      blob_llseek: () => -1,
    },
    wasi_snapshot_preview1: {
      args_sizes_get: (argcPtr: number, argvBufSizePtr: number) => {
        const view = heapView()
        view.setUint32(argcPtr, argv.length, true)
        view.setUint32(
          argvBufSizePtr,
          argv.reduce(
            (total, arg) => total + textEncoder.encode(arg).length + 1,
            0,
          ),
          true,
        )
        return WASI_ESUCCESS
      },
      args_get: (argvPtr: number, argvBufPtr: number) =>
        writeStringArray(argv, argvPtr, argvBufPtr),
      environ_sizes_get: (countPtr: number, bufSizePtr: number) => {
        const view = heapView()
        view.setUint32(countPtr, envStrings.length, true)
        view.setUint32(
          bufSizePtr,
          envStrings.reduce(
            (total, env) => total + textEncoder.encode(env).length + 1,
            0,
          ),
          true,
        )
        return WASI_ESUCCESS
      },
      environ_get: (environPtr: number, environBufPtr: number) =>
        writeStringArray(envStrings, environPtr, environBufPtr),
      clock_time_get: (
        _clockId: number,
        _precision: bigint,
        timePtr: number,
      ) => {
        heapView().setBigUint64(timePtr, BigInt(Date.now()) * 1000000n, true)
        return WASI_ESUCCESS
      },
      fd_advise: () => WASI_ESUCCESS,
      fd_close: (fd: number) => {
        if (fd > 2) fds.delete(fd)
        return WASI_ESUCCESS
      },
      fd_fdstat_get: (fd: number, statPtr: number) => {
        if (fd !== 3 && fd > 2 && !fds.has(fd)) return WASI_EBADF
        const heap = heapU8()
        heap.fill(0, statPtr, statPtr + 24)
        heap[statPtr] =
          fd === 3 ? WASI_FILETYPE_DIRECTORY : WASI_FILETYPE_REGULAR_FILE
        return WASI_ESUCCESS
      },
      fd_fdstat_set_flags: () => WASI_ESUCCESS,
      fd_filestat_get: (fd: number, statPtr: number) => {
        const file = fds.get(fd)
        if (fd !== 3 && !file) return WASI_EBADF
        writeWasiFilestat(
          heapU8(),
          statPtr,
          fd === 3
            ? { mode: 0o040000, size: 0 }
            : { mode: 0o100000, size: files.get(file!.path)?.length ?? 0 },
        )
        return WASI_ESUCCESS
      },
      fd_filestat_set_size: (fd: number, size: bigint | number) => {
        const file = fds.get(fd)
        if (!file) return WASI_EBADF
        const resized = new Uint8Array(Number(size))
        resized.set(
          (files.get(file.path) ?? new Uint8Array()).subarray(0, Number(size)),
        )
        files.set(file.path, resized)
        return WASI_ESUCCESS
      },
      fd_prestat_get: (fd: number, prestatPtr: number) => {
        if (fd !== 3) return WASI_EBADF
        const view = heapView()
        view.setUint32(prestatPtr, 0, true)
        view.setUint32(prestatPtr + 4, 1, true)
        return WASI_ESUCCESS
      },
      fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) => {
        if (fd !== 3 || pathLen < 1) return WASI_EBADF
        heapU8()[pathPtr] = '/'.charCodeAt(0)
        return WASI_ESUCCESS
      },
      fd_read: fdRead,
      fd_readdir: () => WASI_EINVAL,
      fd_renumber: () => WASI_EINVAL,
      fd_seek: (
        fd: number,
        offset: bigint | number,
        whence: number,
        newOffsetPtr: number,
      ) => {
        const file = fds.get(fd)
        if (!file) return WASI_EBADF
        const base =
          whence === 0
            ? 0
            : whence === 1
              ? file.position
              : (files.get(file.path)?.length ?? 0)
        file.position = Math.max(0, base + Number(offset))
        heapView().setBigUint64(newOffsetPtr, BigInt(file.position), true)
        return WASI_ESUCCESS
      },
      fd_sync: () => WASI_ESUCCESS,
      fd_tell: (fd: number, offsetPtr: number) => {
        const file = fds.get(fd)
        if (!file) return WASI_EBADF
        heapView().setBigUint64(offsetPtr, BigInt(file.position), true)
        return WASI_ESUCCESS
      },
      fd_write: fdWrite,
      path_create_directory: () => WASI_ESUCCESS,
      path_filestat_get: (
        _dirFd: number,
        _flags: number,
        pathPtr: number,
        pathLen: number,
        statPtr: number,
      ) => {
        const path = pathFromWasi(pathPtr, pathLen)
        if (
          path === '/' ||
          path === '/tmp' ||
          path === '/home' ||
          path === '/home/postgres' ||
          path === '/pglite' ||
          path === '/pglite/bin'
        ) {
          writeWasiFilestat(heapU8(), statPtr, { mode: 0o040000, size: 0 })
          return WASI_ESUCCESS
        }
        if (path === '/pglite/bin/pg_dump') {
          writeWasiFilestat(heapU8(), statPtr, { mode: 0o100000, size: 0 })
          return WASI_ESUCCESS
        }
        const file = files.get(path)
        if (!file) return WASI_ENOENT
        writeWasiFilestat(heapU8(), statPtr, {
          mode: 0o100000,
          size: file.length,
        })
        return WASI_ESUCCESS
      },
      path_open: (
        _dirFd: number,
        _dirFlags: number,
        pathPtr: number,
        pathLen: number,
        oflags: number,
        _rightsBase: bigint | number,
        _rightsInheriting: bigint | number,
        fdFlags: number,
        openedFdPtr: number,
      ) => {
        const path = pathFromWasi(pathPtr, pathLen)
        const create = (oflags & 1) !== 0
        const trunc = (oflags & 8) !== 0
        const append = (fdFlags & 1) !== 0
        if (!files.has(path)) {
          if (!create) return WASI_ENOENT
          files.set(path, new Uint8Array())
        } else if (trunc) {
          files.set(path, new Uint8Array())
        }
        const fd = nextFd++
        fds.set(fd, {
          path,
          position: append ? files.get(path)!.length : 0,
        })
        heapView().setUint32(openedFdPtr, fd, true)
        return WASI_ESUCCESS
      },
      path_readlink: () => WASI_EINVAL,
      poll_oneoff: () => WASI_EINVAL,
      proc_exit: (code: number) => {
        exitCode = code
        throw { name: 'ExitStatus', status: code }
      },
    },
  }

  const wasm = await readPgDumpWasm()
  const instantiated = await WebAssembly.instantiate(wasm, imports)
  exportsRef.current = instantiated.instance.exports as PgDumpExports
  const exports = exportsRef.current
  exports.__wasm_call_ctors?.()

  const argPtrs = argv.map((arg) => {
    const ptr = exports.malloc(textEncoder.encode(arg).length + 1)
    writeCString(heapU8(), ptr, arg)
    return ptr
  })
  const argvPtr = exports.malloc((argPtrs.length + 1) * 4)
  for (let i = 0; i < argPtrs.length; i++) {
    heapView().setUint32(argvPtr + i * 4, argPtrs[i], true)
  }
  heapView().setUint32(argvPtr + argPtrs.length * 4, 0, true)

  try {
    exitCode = exports.__main_argc_argv(argPtrs.length, argvPtr)
  } catch (err) {
    if (
      typeof err !== 'object' ||
      err === null ||
      (err as { name?: unknown }).name !== 'ExitStatus'
    ) {
      throw err
    }
  } finally {
    exports.free?.(argvPtr)
    for (const ptr of argPtrs) exports.free?.(ptr)
  }

  return {
    exitCode,
    fileContents: textDecoder.decode(
      files.get(dumpFilePath) ?? new Uint8Array(),
    ),
    stderr: stderrOutput,
    stdout: stdoutOutput,
  }
}

/**
 * Execute pg_dump
 * @param pg - The PGlite database
 * @param args - Arguments to pass to pg_dump
 * @param fileName - The name of the returned file
 * @returns The file containing the dump
 */
export async function pgDump({
  pg,
  args,
  fileName = 'dump.sql',
}: PgDumpOptions) {
  const getSearchPath = await pg.query<{ search_path: string }>(
    'SHOW SEARCH_PATH;',
  )
  const searchPath = getSearchPath.rows[0].search_path

  const baseArgs = [
    '-U',
    'postgres',
    '--inserts',
    '-j',
    '1',
    '-f',
    dumpFilePath,
  ]

  const execResult = await execPgDump({
    pg,
    args: [...(args ?? []), ...baseArgs],
  })

  await pg.exec(`DEALLOCATE ALL`)
  await pg.exec(`SET SEARCH_PATH = ${searchPath}`)
  const newSearchPath = await pg.query<{ search_path: string }>(
    'SHOW SEARCH_PATH;',
  )
  if (newSearchPath.rows[0].search_path !== searchPath) {
    console.warn(
      `Warning: search_path has been changed from ${searchPath} to ${newSearchPath}`,
      searchPath,
      newSearchPath,
    )
  }

  if (execResult.exitCode !== 0) {
    throw new Error(
      `pg_dump failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}`,
    )
  }

  const contentsPruned = execResult.fileContents.replace(
    /^(?:\\(?:un)?restrict\b.*\r?\n?)/gim,
    '',
  )

  return new File([contentsPruned], fileName, {
    type: 'text/plain',
  })
}
