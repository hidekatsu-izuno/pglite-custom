import { readFileSync } from 'node:fs'

const resolveNodeFile = (filename: string | URL) =>
  filename instanceof URL ? filename : new URL(filename, import.meta.url)

export const readBinary = (filename: string | URL) =>
  new Uint8Array(readFileSync(resolveNodeFile(filename)))

export const readAsync = async (
  filename: string | URL,
  binary = true,
): Promise<Uint8Array | string> =>
  readFileSync(resolveNodeFile(filename), binary ? undefined : 'utf8')

export async function instantiateNodeWasm(
  wasmBinary: WebAssembly.Module | BufferSource | undefined,
  wasmBinaryFile: URL,
  imports: WebAssembly.Imports,
  onError: (reason: unknown) => never,
) {
  try {
    const binary = wasmBinary ?? readBinary(wasmBinaryFile)
    const result = await WebAssembly.instantiate(binary, imports)
    return result instanceof WebAssembly.Instance
      ? { instance: result, module: binary as WebAssembly.Module }
      : result
  } catch (reason) {
    return onError(reason)
  }
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
      dir = dir.substr(0, dir.length - 1)
    }
    return root + dir
  },
  basename: (path: string) => {
    if (path === '/') return '/'
    path = PATH.normalize(path)
    path = path.replace(/\/$/, '')
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash === -1) return path
    return path.substr(lastSlash + 1)
  },
  join: (...paths: string[]) => PATH.normalize(paths.join('/')),
  join2: (left: string, right: string) => PATH.normalize(left + '/' + right),
}

const UTF8Decoder =
  typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined

export const UTF8ArrayToString = (
  heapOrArray: Uint8Array,
  idx = 0,
  maxBytesToRead = Number.NaN,
) => {
  const endIdx = idx + maxBytesToRead
  let endPtr = idx
  while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr
  if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
    return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr))
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
