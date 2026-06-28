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

  const callPgMain = (args: string[]) => {
    const firstArg = args.shift()
    log(debug, 'initdb: firstArg', firstArg)
    assert(firstArg === '/pglite/bin/postgres', `trying to execute ${firstArg}`)

    pg.Module.HEAPU8.set(origHEAPU8)
    if (pg.Module.__wasi) {
      for (let fd = 7; fd < 1024; fd++) {
        pg.Module._close?.(fd)
      }
      pg.Module._pgl_chdir?.(pg.Module.stringToUTF8OnStack(PGDATA))
      reopenPgStreams()
    }

    log(debug, 'executing pg main with', args)
    const result = pg.callMain(args)

    log(debug, result)

    postgresArgs = []

    return result
  }

  const origHEAPU8 = pg.Module.HEAPU8.slice()

  const runtimeOpts: Partial<InitdbMod> = {
    arguments: args,
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
        mod.onRuntimeInitialized = () => {
          system_fn = mod.addFunction((cmd_ptr: number) => {
            postgresArgs = getArgs(mod.UTF8ToString(cmd_ptr))
            return callPgMain(postgresArgs)
          }, 'pi')

          mod._pgl_set_system_fn(system_fn)

          popen_fn = mod.addFunction((cmd_ptr: number, mode: number) => {
            const smode = mod.UTF8ToString(mode)
            postgresArgs = getArgs(mod.UTF8ToString(cmd_ptr))

            if (smode === 'r') {
              pgMainResult = callPgMain(postgresArgs)
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
            if (stream === initdb_stdin_fd || stream === initdb_stdout_fd) {
              if (pg.Module.__wasi && stream === initdb_stdout_fd) {
                mod._fflush(stream)
                mod._fclose(stream)
                initdb_stdout_fd = -1
              }
              // if the last popen had mode w, execute now postgres' main()
              if (needToCallPGmain) {
                needToCallPGmain = false
                pgMainResult = callPgMain(postgresArgs)
              }
              return pgMainResult
            } else {
              return mod._pclose(stream)
            }
          }, 'pi')

          mod._pgl_set_pclose_fn(pclose_fn)

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
  let result = initDbMod.callMain(args)
  if (
    result !== 0 &&
    pg.Module.__wasi &&
    pg.Module.FS.analyzePath(`${PGDATA}/PG_VERSION`).exists &&
    pg.Module.FS.analyzePath(`${PGDATA}/base/1/1255`).exists
  ) {
    result = 0
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
      '--auth=trust',
      ...(args ?? []),
    ],
    wasmModule,
  })

  return execResult
}
