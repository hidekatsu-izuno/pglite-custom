import type { FsType, Filesystem } from './base.js'
import { MemoryFS } from './memoryfs.js'

export {
  BaseFilesystem,
  ERRNO_CODES,
  type Filesystem,
  type FsType,
  type FsStats,
} from './base.js'

export function parseDataDir(dataDir?: string) {
  let fsType: FsType
  if (dataDir?.startsWith('file://')) {
    // Remove the file:// prefix, and use node filesystem
    dataDir = dataDir.slice(7)
    if (!dataDir) {
      throw new Error('Invalid dataDir, must be a valid path')
    }
    fsType = 'nodefs'
  } else if (!dataDir || dataDir?.startsWith('memory://')) {
    // Use in-memory filesystem
    fsType = 'memoryfs'
  } else {
    // No prefix, use node filesystem
    fsType = 'nodefs'
  }
  return { dataDir, fsType }
}

export async function loadFs(dataDir?: string, fsType?: FsType) {
  let fs: Filesystem
  if (dataDir && fsType === 'nodefs') {
    // Lazy load the nodefs to avoid bundling it in the browser
    const { NodeFS } = await import('./nodefs.js')
    fs = new NodeFS(dataDir)
  } else {
    fs = new MemoryFS()
  }
  return fs
}
