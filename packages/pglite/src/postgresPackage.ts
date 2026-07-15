import { readFileSync } from 'node:fs'
import { POSTGRES_PACKAGE_METADATA } from './postgresPackageMetadata.js'

type PackageFile = {
  filename: string
  start: number
  end: number
}

type PackageFileSystem = {
  createPath: (
    parent: string,
    name: string,
    canRead: boolean,
    canWrite: boolean,
  ) => void
  createDataFile: (
    parent: string,
    name: null,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean,
  ) => void
}

type RunDependencyHandler = (id: string) => void
type GetPreloadedPackage = (
  packageName: string,
  packageSize: number,
) => ArrayBuffer

const PACKAGE_NAME = 'pglite.data'
const PACKAGE_DEPENDENCY = 'datafile_pglite.data'

const readLocalPackage = () => {
  try {
    const data = readFileSync(
      new URL('../release/' + PACKAGE_NAME, import.meta.url),
    )
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
  } catch (error) {
    console.error('package error:', error)
    return null
  }
}

const assertPackage: (check: unknown, message: string) => asserts check = (
  check,
  message,
) => {
  if (!check) throw message + new Error().stack
}

const createPackageDirectories = (
  fileSystem: PackageFileSystem,
  files: PackageFile[],
) => {
  const createdDirectories = new Set(['/'])

  for (const file of files) {
    const pathSegments = file.filename.split('/').filter(Boolean)
    pathSegments.pop()

    let parent = '/'
    for (const segment of pathSegments) {
      const path = parent === '/' ? '/' + segment : parent + '/' + segment
      if (!createdDirectories.has(path)) {
        fileSystem.createPath(parent, segment, true, true)
        createdDirectories.add(path)
      }
      parent = path
    }
  }
}

const validatePackage = (arrayBuffer: ArrayBuffer | null) => {
  assertPackage(arrayBuffer, 'Loading data file failed.')
  assertPackage(
    arrayBuffer.constructor.name === ArrayBuffer.name,
    'bad input to processPackageData',
  )
  return arrayBuffer
}

const unpackPackage = (
  fileSystem: PackageFileSystem,
  packageBuffer: ArrayBuffer,
  addRunDependency: RunDependencyHandler,
  removeRunDependency: RunDependencyHandler,
) => {
  const files = POSTGRES_PACKAGE_METADATA.files
  createPackageDirectories(fileSystem, files)

  for (const file of files) {
    addRunDependency(`fp ${file.filename}`)
  }
  addRunDependency(PACKAGE_DEPENDENCY)

  const packageData = new Uint8Array(packageBuffer)
  for (const file of files) {
    fileSystem.createDataFile(
      file.filename,
      null,
      packageData.subarray(file.start, file.end),
      true,
      true,
      true,
    )
    removeRunDependency(`fp ${file.filename}`)
  }
  removeRunDependency(PACKAGE_DEPENDENCY)
}

export const preparePostgresPackage = (
  getPreloadedPackage?: GetPreloadedPackage,
) => {
  const packageSize = POSTGRES_PACKAGE_METADATA.remote_package_size
  const packageBuffer = validatePackage(
    getPreloadedPackage?.(PACKAGE_NAME, packageSize) || readLocalPackage(),
  )

  return (
    fileSystem: PackageFileSystem,
    addRunDependency: RunDependencyHandler,
    removeRunDependency: RunDependencyHandler,
  ) =>
    unpackPackage(
      fileSystem,
      packageBuffer,
      addRunDependency,
      removeRunDependency,
    )
}
