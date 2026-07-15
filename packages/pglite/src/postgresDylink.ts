import { UTF8ArrayToString } from './emscriptenCommon.js'

export type DylinkMetadata = {
  neededDynlibs: string[]
  tlsExports: Set<string>
  weakImports: Set<string>
  memorySize?: number
  memoryAlign?: number
  tableSize?: number
  tableAlign?: number
}

class DylinkMetadataReader {
  private binary: WebAssembly.Module | Uint8Array
  private offset = 0
  private end = 0

  constructor(binary: WebAssembly.Module | Uint8Array) {
    this.binary = binary
  }

  private readByte() {
    return (this.binary as Uint8Array)[this.offset++]
  }

  private readLEB() {
    let value = 0
    let multiplier = 1
    while (true) {
      const byte = this.readByte()
      value += (byte & 127) * multiplier
      multiplier *= 128
      if (!(byte & 128)) break
    }
    return value
  }

  private readString() {
    const length = this.readLEB()
    const start = this.offset
    this.offset += length
    return UTF8ArrayToString(this.binary as Uint8Array, start, length)
  }

  private failIf(condition: boolean, message?: string) {
    if (condition) throw new Error(message)
  }

  private readSectionName() {
    let name = 'dylink.0'
    if (!(this.binary instanceof WebAssembly.Module)) {
      const int32View = new Uint32Array(
        new Uint8Array(this.binary.subarray(0, 24)).buffer,
      )
      this.failIf(int32View[0] !== 1836278016, 'need to see wasm magic number')
      this.failIf(this.binary[8] !== 0, 'need the dylink section to be first')
      this.offset = 9
      const sectionSize = this.readLEB()
      this.end = this.offset + sectionSize
      return this.readString()
    }

    let dylinkSection = WebAssembly.Module.customSections(this.binary, name)
    if (dylinkSection.length === 0) {
      name = 'dylink'
      dylinkSection = WebAssembly.Module.customSections(this.binary, name)
    }
    this.failIf(dylinkSection.length === 0, 'need dylink section')
    const sectionData = new Uint8Array(dylinkSection[0])
    this.binary = sectionData
    this.end = sectionData.length
    return name
  }

  private readNeededLibraries(metadata: DylinkMetadata) {
    const count = this.readLEB()
    for (let i = 0; i < count; ++i) {
      metadata.neededDynlibs.push(this.readString())
    }
  }

  private readLegacyMetadata(metadata: DylinkMetadata) {
    metadata.memorySize = this.readLEB()
    metadata.memoryAlign = this.readLEB()
    metadata.tableSize = this.readLEB()
    metadata.tableAlign = this.readLEB()
    this.readNeededLibraries(metadata)
  }

  private readExportInfo(metadata: DylinkMetadata) {
    const WASM_SYMBOL_TLS = 256
    let count = this.readLEB()
    while (count--) {
      const symbolName = this.readString()
      const flags = this.readLEB()
      if (flags & WASM_SYMBOL_TLS) {
        metadata.tlsExports.add(symbolName)
      }
    }
  }

  private readImportInfo(metadata: DylinkMetadata) {
    const WASM_SYMBOL_BINDING_MASK = 3
    const WASM_SYMBOL_BINDING_WEAK = 1
    let count = this.readLEB()
    while (count--) {
      this.readString()
      const symbolName = this.readString()
      const flags = this.readLEB()
      if ((flags & WASM_SYMBOL_BINDING_MASK) === WASM_SYMBOL_BINDING_WEAK) {
        metadata.weakImports.add(symbolName)
      }
    }
  }

  private readModernMetadata(metadata: DylinkMetadata) {
    const WASM_DYLINK_MEM_INFO = 1
    const WASM_DYLINK_NEEDED = 2
    const WASM_DYLINK_EXPORT_INFO = 3
    const WASM_DYLINK_IMPORT_INFO = 4

    while (this.offset < this.end) {
      const subsectionType = this.readByte()
      const subsectionSize = this.readLEB()
      switch (subsectionType) {
        case WASM_DYLINK_MEM_INFO:
          metadata.memorySize = this.readLEB()
          metadata.memoryAlign = this.readLEB()
          metadata.tableSize = this.readLEB()
          metadata.tableAlign = this.readLEB()
          break
        case WASM_DYLINK_NEEDED:
          this.readNeededLibraries(metadata)
          break
        case WASM_DYLINK_EXPORT_INFO:
          this.readExportInfo(metadata)
          break
        case WASM_DYLINK_IMPORT_INFO:
          this.readImportInfo(metadata)
          break
        default:
          this.offset += subsectionSize
      }
    }
  }

  read(): DylinkMetadata {
    const name = this.readSectionName()
    const metadata: DylinkMetadata = {
      neededDynlibs: [],
      tlsExports: new Set(),
      weakImports: new Set(),
    }

    if (name === 'dylink') {
      this.readLegacyMetadata(metadata)
    } else {
      this.failIf(name !== 'dylink.0')
      this.readModernMetadata(metadata)
    }

    return metadata
  }
}

export const getDylinkMetadata = (binary: WebAssembly.Module | Uint8Array) =>
  new DylinkMetadataReader(binary).read()
