#!/usr/bin/env node

import { mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const DEFAULT_DIR = 'postgres-pglite/dist/bin'
const DEFAULT_MAX_BODY_BYTES = 60_000
const DEFAULT_CHUNK_BYTES = 40_000

const args = parseArgs(process.argv.slice(2))
const targetDir = resolve(args.dir ?? DEFAULT_DIR)
const maxBodyBytes = readInt(args['max-body-bytes'], DEFAULT_MAX_BODY_BYTES)
const chunkBytes = readInt(args['chunk-bytes'], DEFAULT_CHUNK_BYTES)
const dryRun = Boolean(args['dry-run'])
const keepWat = Boolean(args['keep-wat'])

if (chunkBytes >= maxBodyBytes) {
  throw new Error('--chunk-bytes must be smaller than --max-body-bytes')
}

const wasmFiles = (await readdir(targetDir))
  .filter((name) => extname(name) === '.wasm')
  .sort()

if (wasmFiles.length === 0) {
  console.log(`No .wasm files found under ${targetDir}`)
  process.exit(0)
}

const workDir = await mkdtemp(join(tmpdir(), 'mod-shortfunc-wasm-'))
let changed = 0

try {
  for (const fileName of wasmFiles) {
    const wasmPath = join(targetDir, fileName)
    const watPath = join(workDir, `${fileName}.wat`)
    const outWatPath = join(workDir, `${fileName}.shortfunc.wat`)
    const outWasmPath = join(workDir, `${fileName}.shortfunc.wasm`)

    let printed
    try {
      printed = await run('wasm-opt', [wasmPath, '--all-features', '--print'], {
        capture: true,
      })
    } catch (error) {
      console.warn(`${fileName}: skipped; wasm-opt could not parse this file`)
      console.warn(indent(String(error.message ?? error).trim(), 2))
      continue
    }
    await writeFile(watPath, printed.stdout)

    const inputWat = printed.stdout
    let result
    try {
      result = splitLongFlatBlocks(inputWat, {
        maxBodyBytes,
        chunkBytes,
        helperPrefix: `$__shortfunc_${sanitizeName(basename(fileName, '.wasm'))}`,
      })
    } catch (error) {
      console.warn(`${fileName}: skipped; unsupported WAT shape`)
      console.warn(indent(String(error.message ?? error).trim(), 2))
      continue
    }

    if (result.splits.length === 0) {
      console.log(
        `${fileName}: no splittable functions over ${maxBodyBytes} WAT bytes`,
      )
      continue
    }

    await writeFile(outWatPath, result.wat)

    if (dryRun) {
      console.log(`${fileName}: would split ${describeSplits(result.splits)}`)
      continue
    }

    await run('wasm-opt', [outWatPath, '--all-features', '-o', outWasmPath], {
      capture: false,
    })
    await run(
      'wasm-opt',
      [
        outWasmPath,
        '--all-features',
        '-o',
        join(workDir, `${fileName}.checked.wasm`),
      ],
      {
        capture: false,
      },
    )

    const original = await stat(wasmPath)
    const rewritten = await stat(outWasmPath)
    await rename(outWasmPath, wasmPath)
    if (keepWat) {
      await writeFile(`${wasmPath}.wat`, result.wat)
    }

    changed++
    console.log(
      `${fileName}: split ${describeSplits(result.splits)}; size ${original.size} -> ${rewritten.size}`,
    )
  }
} finally {
  if (!keepWat) {
    await rm(workDir, { force: true, recursive: true })
  } else {
    console.log(`temporary WAT kept in ${workDir}`)
  }
}

console.log(`Done. Rewritten wasm files: ${changed}`)

function splitLongFlatBlocks(wat, options) {
  const moduleEnd = findMatchingParen(wat, skipSpace(wat, 0))
  const funcs = findTopLevelForms(wat, 'func')
  const edits = []
  const splits = []

  for (const func of funcs) {
    const headerEnd = findFuncHeaderEnd(wat, func.start + 1)
    if (headerEnd === -1) continue

    const header = wat.slice(func.start, headerEnd)
    if (/\(\s*(param|result|local)\b/.test(header)) continue

    const bodyStart = skipSpace(wat, headerEnd)
    const directChildren = findChildForms(wat, bodyStart, func.end)
    if (directChildren.length === 0) continue
    if (
      directChildren.some((child) =>
        ['param', 'result', 'local'].includes(readHead(wat, child.start)),
      )
    ) {
      continue
    }

    const isSingleBlock =
      directChildren.length === 1 &&
      readHead(wat, directChildren[0].start) === 'block'
    const splitStart = isSingleBlock
      ? findBlockChildrenStart(wat, directChildren[0].start)
      : bodyStart
    const splitEnd = isSingleBlock ? directChildren[0].end : func.end
    if (splitEnd - splitStart <= options.maxBodyBytes) continue

    const children = isSingleBlock
      ? findChildForms(wat, splitStart, splitEnd)
      : directChildren
    if (children.length < 2) continue

    const chunks = chunkForms(children, options.chunkBytes)
    if (chunks.length < 2) continue

    const funcName = getFuncName(header) ?? `$func${splits.length}`
    const helpers = chunks.map((chunk, index) => {
      const helperName = `${options.helperPrefix}_${splits.length}_${index}`
      const body = wat.slice(chunk[0].start, chunk.at(-1).end + 1)
      return {
        name: helperName,
        text: isSingleBlock
          ? `\n (func ${helperName}\n  (block\n${indent(body, 3)}\n  )\n )`
          : `\n (func ${helperName}\n${indent(body, 2)}\n )`,
      }
    })

    const callIndent = isSingleBlock ? '   ' : '  '
    const replacementBody = helpers
      .map((helper) => `${callIndent}(call ${helper.name})`)
      .join('\n')
    const replacement = `${wat.slice(func.start, splitStart)}\n${replacementBody}\n${wat.slice(splitEnd, func.end + 1)}`
    edits.push({ start: func.start, end: func.end + 1, text: replacement })
    edits.push({
      start: moduleEnd,
      end: moduleEnd,
      text: helpers.map((h) => h.text).join(''),
    })
    splits.push({
      funcName,
      originalBytes: splitEnd - splitStart,
      helperCount: helpers.length,
    })
  }

  return { wat: applyEdits(wat, edits), splits }
}

function findTopLevelForms(wat, head) {
  const moduleStart = skipSpace(wat, 0)
  if (readHead(wat, moduleStart) !== 'module') {
    throw new Error('wasm-opt did not emit a WAT module')
  }
  const moduleEnd = findMatchingParen(wat, moduleStart)
  const start = findChildrenStart(wat, moduleStart)
  return findChildForms(wat, start, moduleEnd).filter(
    (form) => readHead(wat, form.start) === head,
  )
}

function findChildForms(wat, start, end) {
  const forms = []
  for (let pos = skipSpace(wat, start); pos < end; pos = skipSpace(wat, pos)) {
    if (wat[pos] !== '(') {
      throw new Error(`unexpected token while scanning WAT near byte ${pos}`)
    }
    const formEnd = findMatchingParen(wat, pos)
    forms.push({ start: pos, end: formEnd })
    pos = formEnd + 1
  }
  return forms
}

function chunkForms(forms, limit) {
  const chunks = []
  let chunk = []
  let chunkStart = forms[0].start
  for (const form of forms) {
    if (chunk.length > 0 && form.end - chunkStart + 1 > limit) {
      chunks.push(chunk)
      chunk = []
      chunkStart = form.start
    }
    chunk.push(form)
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

function findFuncHeaderEnd(wat, pos) {
  let depth = 0
  for (let i = pos; i < wat.length; i++) {
    const char = wat[i]
    if (char === '"') {
      i = skipString(wat, i)
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      if (depth === 0) return i
      depth--
    } else if (char === '\n' && depth === 0) {
      return i
    }
  }
  return -1
}

function findBlockChildrenStart(wat, blockStart) {
  const afterHead = skipToken(wat, blockStart + 1)
  let pos = skipSpace(wat, afterHead)
  while (wat[pos] === '(' && ['param', 'result'].includes(readHead(wat, pos))) {
    pos = skipSpace(wat, findMatchingParen(wat, pos) + 1)
  }
  return pos
}

function findChildrenStart(wat, formStart) {
  return skipSpace(wat, skipToken(wat, formStart + 1))
}

function findMatchingParen(wat, start) {
  let depth = 0
  for (let i = start; i < wat.length; i++) {
    const char = wat[i]
    if (char === '"') {
      i = skipString(wat, i)
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error(`unclosed WAT form near byte ${start}`)
}

function readHead(wat, start) {
  return wat.slice(start + 1, skipToken(wat, start + 1))
}

function skipToken(wat, pos) {
  while (pos < wat.length && !/\s|\(|\)/.test(wat[pos])) pos++
  return pos
}

function skipSpace(wat, pos) {
  while (pos < wat.length) {
    if (/\s/.test(wat[pos])) {
      pos++
    } else if (wat[pos] === ';' && wat[pos + 1] === ';') {
      const next = wat.indexOf('\n', pos + 2)
      pos = next === -1 ? wat.length : next + 1
    } else {
      return pos
    }
  }
  return pos
}

function skipString(wat, pos) {
  for (let i = pos + 1; i < wat.length; i++) {
    if (wat[i] === '\\') {
      i++
    } else if (wat[i] === '"') {
      return i
    }
  }
  throw new Error(`unterminated WAT string near byte ${pos}`)
}

function getFuncName(header) {
  const match = header.match(/^\(func\s+(\$[^\s()]+)/)
  return match?.[1]
}

function indent(text, spaces) {
  const prefix = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n')
}

function applyEdits(input, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start)
  let output = input
  for (const edit of ordered) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`
  }
  return output
}

function describeSplits(splits) {
  return splits
    .map(
      (split) =>
        `${split.funcName} (${split.originalBytes} WAT bytes -> ${split.helperCount} helpers)`,
    )
    .join(', ')
}

function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_')
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`)
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      parsed[body.slice(0, eq)] = body.slice(eq + 1)
    } else if (['dry-run', 'keep-wat'].includes(body)) {
      parsed[body] = true
    } else {
      parsed[body] = argv[++i]
    }
  }
  return parsed
}

function readInt(value, fallback) {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got ${value}`)
  }
  return parsed
}

function run(command, args, { capture }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: capture
        ? ['ignore', 'pipe', 'pipe']
        : ['ignore', 'inherit', 'inherit'],
    })
    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
    }
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with ${code}\n${stderr}`,
          ),
        )
      }
    })
  })
}
