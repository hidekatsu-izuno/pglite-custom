import { createWasiModule, type FS, type PostgresMod } from './postgresMod.js'

export interface InitdbMod extends PostgresMod {
  FS: FS
  onExit?: (status: number) => void
  print?: (text: string) => void
  printErr?: (text: string) => void
  ___errno_location: () => number
  _strerror: (errno: number) => number
  _pclose: (stream: number) => number
  _pipe: (fd: number) => number
  onRuntimeInitialized?: () => void
}

type InitdbFactory<T extends InitdbMod = InitdbMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

const InitdbModFactory: InitdbFactory<InitdbMod> = (moduleOverrides) =>
  createWasiModule(
    moduleOverrides,
    new URL('../release/initdb.wasm', import.meta.url),
  ) as Promise<InitdbMod>

export default InitdbModFactory
