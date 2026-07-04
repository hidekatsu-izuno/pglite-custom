import InitdbModFactory, { InitdbMod } from './initdbModFactory'
import parse from './argsParser'

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed')
  }
}

export const PG_ROOT = '/pglite'
export const PGDATA = '/data'
export const ICU_DATA_PATH = PG_ROOT + '/icu'
export const INITDB_EXE_PATH = PG_ROOT + '/bin/initdb'
export const POSTGRES_EXE_PATH = PG_ROOT + '/bin/postgres'

const pgstdoutPath = PG_ROOT + '/pgstdout'
const pgstdinPath = PG_ROOT + '/pgstdin'

/**
 * Interface defining what initdb needs from a PGlite instance.
 * This avoids a circular dependency between pglite and pglite-initdb.
 */
export interface PGliteForInitdb {
  Module: {
    HEAPU8: Uint8Array
    stringToUTF8OnStack(str: string): number
    _pgl_freopen(path: number, mode: number, fd: number): void
    _close?(fd: number): number
    FS: any
    __wasi?: boolean
  }
  callMain(args: string[]): number
}

interface ExecResult {
  exitCode: number
  stderr: string
  stdout: string
  dataFolder: string
}

function log(debug?: number, ...args: any[]) {
  if (debug && debug > 0) {
    console.log('initdb: ', ...args)
  }
}

function getHostTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function getHostLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

async function execInitdb({
  pg,
  debug,
  args,
  wasmModule,
}: {
  pg: PGliteForInitdb
  debug?: number
  args: string[]
  wasmModule?: WebAssembly.Module
}): Promise<ExecResult> {
  let system_fn, popen_fn, pclose_fn

  let needToCallPGmain = false
  let postgresArgs: string[] = []

  let pgMainResult = 0

  let initdb_stdin_fd = -1
  let initdb_stdout_fd = -1
  let pg_locale_a_fd = -1
  let stderrOutput: string = ''
  let stdoutOutput: string = ''

  const reopenPgStreams = () => {
    const pglite_stdin_path = pg.Module.stringToUTF8OnStack(pgstdinPath)
    const rmode = pg.Module.stringToUTF8OnStack('r')
    pg.Module._pgl_freopen(pglite_stdin_path, rmode, 0)
    const pglite_stdout_path = pg.Module.stringToUTF8OnStack(pgstdoutPath)
    const wmode = pg.Module.stringToUTF8OnStack('w')
    pg.Module._pgl_freopen(pglite_stdout_path, wmode, 1)
  }

  const toWaitStatus = (exitCode: number) => exitCode << 8

  const copyFile = (fromFs: any, toFs: any, path: string) => {
    const data = fromFs.readFile(path)
    toFs.writeFile(path, data)
  }

  const getWasiExitCode = (err: unknown): number | undefined => {
    if (typeof err !== 'symbol' || String(err) !== 'Symbol(kExitCode)') {
      return undefined
    }
    const wasi = pg.Module.__wasi
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

  const callPgMain = (args: string[]) => {
    const firstArg = args.shift()
    log(debug, 'firstArg', firstArg)
    assert(firstArg === '/pglite/bin/postgres', `trying to execute ${firstArg}`)

    if (origHEAPU8) {
      pg.Module.HEAPU8.set(origHEAPU8)
    }
    if (pg.Module.__wasi) {
      pg.Module._pgl_chdir?.(pg.Module.stringToUTF8OnStack(PGDATA))
      reopenPgStreams()
    }

    log(debug, 'executing pg main with', args)
    let result: number
    try {
      result = pg.callMain(args)
    } catch (err) {
      const wasiExitCode = getWasiExitCode(err)
      if (wasiExitCode === undefined) {
        throw err
      }
      result = wasiExitCode
    }
    log(debug, 'pg main result', result)

    postgresArgs = []

    return result
  }

  let origHEAPU8: Uint8Array | undefined
  const hostTimeZone = getHostTimeZone()

  const runtimeOpts: Partial<InitdbMod> = {
    arguments: args,
    ENV: hostTimeZone ? { TZ: hostTimeZone } : undefined,
    noExitRuntime: false,
    thisProgram: INITDB_EXE_PATH,
    print: (text) => {
      stdoutOutput += text
      log(debug, 'initdbout', text)
    },
    printErr: (text) => {
      stderrOutput += text
      log(debug, 'initdberr', text)
    },
    __wasiRoot: pg.Module.FS.__root,
    // Align the initdb module's PGDATA with the Postgres module it drives so
    // the cluster is written straight into the live instance's data directory
    // (works for both memory:// and file:// backed instances).
    __wasiDataRoot: (pg.Module as unknown as { __wasiDataRoot?: string })
      .__wasiDataRoot,
    wasmModule,
    preRun: [
      (mod: any) => {
        mod.ENV.PGDATA = PGDATA
        mod.ENV.HOME = '/home/postgres'
        mod.ENV.USER = 'postgres'
        mod.ENV.LOGNAME = 'postgres'
        mod.ENV.ICU_DATA = ICU_DATA_PATH
      },
      (mod: any) => {
        system_fn = mod.addFunction((cmd_ptr: number) => {
          postgresArgs = getArgs(mod.UTF8ToString(cmd_ptr))
          log(debug, 'system', postgresArgs)
          return toWaitStatus(callPgMain(postgresArgs))
        }, 'pi')

        mod._pgl_set_system_fn(system_fn)

        popen_fn = mod.addFunction((cmd_ptr: number, mode: number) => {
          const smode = mod.UTF8ToString(mode)
          postgresArgs = getArgs(mod.UTF8ToString(cmd_ptr))
          log(debug, 'popen', smode, postgresArgs)

          if (smode === 'r') {
            pgMainResult = callPgMain(postgresArgs)
            if (pg.Module.__wasi) {
              copyFile(pg.Module.FS, mod.FS, pgstdoutPath)
              if (initdb_stdin_fd !== -1) {
                mod._fclose(initdb_stdin_fd)
              }
              const path = mod.stringToUTF8OnStack(pgstdoutPath)
              const rmode = mod.stringToUTF8OnStack('r')
              initdb_stdin_fd = mod._fopen(path, rmode)
            }
            return initdb_stdin_fd
          } else {
            if (smode === 'w') {
              if (pg.Module.__wasi) {
                const path = mod.stringToUTF8OnStack(pgstdinPath)
                const wmode = mod.stringToUTF8OnStack('w')
                initdb_stdout_fd = mod._fopen(path, wmode)
              }
              needToCallPGmain = true
              return initdb_stdout_fd
            } else {
              throw `Unexpected popen mode value ${smode}`
            }
          }
        }, 'ppi')

        mod._pgl_set_popen_fn(popen_fn)

        pclose_fn = mod.addFunction((stream: number) => {
          log(debug, 'pclose', stream, {
            initdb_stdin_fd,
            initdb_stdout_fd,
          })
          if (stream === initdb_stdin_fd || stream === initdb_stdout_fd) {
            if (pg.Module.__wasi && stream === initdb_stdout_fd) {
              mod._fflush(stream)
              mod._fclose(stream)
              copyFile(mod.FS, pg.Module.FS, pgstdinPath)
              initdb_stdout_fd = -1
            }
            // if the last popen had mode w, execute now postgres' main()
            if (needToCallPGmain) {
              needToCallPGmain = false
              pgMainResult = callPgMain(postgresArgs)
            }
            return toWaitStatus(pgMainResult)
          } else {
            return mod._pclose(stream)
          }
        }, 'pi')

        mod._pgl_set_pclose_fn(pclose_fn)

        if (pg.Module.__wasi) {
          const pgPopenFn = pg.Module.addFunction(
            (cmdPtr: number, modePtr: number) => {
              const command = pg.Module.UTF8ToString(cmdPtr)
              const smode = pg.Module.UTF8ToString(modePtr)
              if (command === 'locale -a' && smode === 'r') {
                const localePath = '/pglite/locale-a'
                pg.Module.FS.writeFile(localePath, 'C\nC.UTF-8\nPOSIX\n')
                const path = pg.Module.stringToUTF8OnStack(localePath)
                const rmode = pg.Module.stringToUTF8OnStack('r')
                pg_locale_a_fd = pg.Module._fopen(path, rmode)
                return pg_locale_a_fd
              }
              return 0
            },
            'ppi',
          )
          const pgPcloseFn = pg.Module.addFunction((stream: number) => {
            if (stream === pg_locale_a_fd) {
              pg_locale_a_fd = -1
              return pg.Module._fclose(stream)
            }
            return -1
          }, 'pi')
          pg.Module._pgl_set_popen_fn(pgPopenFn)
          pg.Module._pgl_set_pclose_fn(pgPcloseFn)
        }

        if (pg.Module.__wasi) {
          pg.Module.FS.writeFile(pgstdinPath, new Uint8Array())
          pg.Module.FS.writeFile(pgstdoutPath, new Uint8Array())
        }
        reopenPgStreams()

        {
          const initdb_path = mod.stringToUTF8OnStack(pgstdoutPath)
          const rmode = mod.stringToUTF8OnStack('r')
          initdb_stdin_fd = mod._fopen(initdb_path, rmode)

          if (pg.Module.__wasi) {
            initdb_stdout_fd = -1
          } else {
            const path = mod.stringToUTF8OnStack(pgstdinPath)
            const wmode = mod.stringToUTF8OnStack('w')
            initdb_stdout_fd = mod._fopen(path, wmode)
          }

          if (pg.Module.__wasi) {
            origHEAPU8 = pg.Module.HEAPU8.slice()
          }
        }
      },
      (mod: any) => {
        mod.FS.mkdir(PG_ROOT)
        mod.FS.mount(
          mod.PROXYFS,
          {
            root: PG_ROOT,
            fs: pg.Module.FS,
          },
          PG_ROOT,
        )
      },
    ],
  }

  const initDbMod = await InitdbModFactory(runtimeOpts)

  log(debug, 'calling initdb.main with', args)
  const result = initDbMod.callMain(args)

  // Restore the Postgres module to the pristine state captured before
  // bootstrap. Because the system/popen/pclose callback pointers live in the
  // linear memory (C globals), this both cleans up the heap dirtied by the
  // bootstrap backends and reverts the callbacks initdb overrode, so the same
  // module can be reused directly as the live backend.
  if (pg.Module.__wasi && origHEAPU8) {
    pg.Module.HEAPU8.set(origHEAPU8)
  }

  return {
    exitCode: result,
    stderr: stderrOutput,
    stdout: stdoutOutput,
    dataFolder: PGDATA,
  }
}

interface InitdbOptions {
  pg: PGliteForInitdb
  debug?: number
  args?: string[]
  wasmModule?: WebAssembly.Module
}

function getArgs(cmd: string) {
  const a: string[] = []
  const parsed = parse(cmd)
  for (let i = 0; i < parsed.length; i++) {
    const token = parsed[i]
    if (typeof token === 'object' && 'op' in token) break
    if (typeof token === 'string') a.push(token)
  }
  return a
}

function hasOption(args: string[] | undefined, option: string) {
  return !!args?.some((arg) => arg === option || arg.startsWith(`${option}=`))
}

function getOptionValue(args: string[] | undefined, option: string) {
  if (!args) {
    return undefined
  }
  let value: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith(`${option}=`)) {
      value = arg.substring(option.length + 1)
    }
    if (arg === option) {
      value = args[i + 1]?.startsWith('-') ? undefined : args[i + 1]
    }
  }
  return value
}

function getHostIcuLocaleArgs(args: string[] | undefined): string[] {
  if (getOptionValue(args, '--locale-provider') !== 'icu') {
    return []
  }
  if (hasOption(args, '--icu-locale')) {
    return []
  }
  const hostLocale = getHostLocale()
  return hostLocale ? [`--icu-locale=${hostLocale}`] : []
}

/**
 * Execute initdb
 */
export async function initdb({
  pg,
  debug,
  args,
  wasmModule,
}: InitdbOptions): Promise<ExecResult> {
  const execResult = await execInitdb({
    pg,
    debug,
    args: [
      '-D',
      PGDATA,
      '--allow-group-access',
      '--encoding',
      'UTF8',
      '--locale=C.UTF-8',
      '--locale-provider=libc',
      ...getHostIcuLocaleArgs(args),
      '--auth=trust',
      // The data directory lives in the in-memory WASI filesystem and is
      // immediately dumped to a tarball afterwards, so fsync'ing it to "disk"
      // only adds a full directory-tree walk with no durability benefit.
      '--no-sync',
      ...(args ?? []),
    ],
    wasmModule,
  })

  return execResult
}
