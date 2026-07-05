#!/usr/bin/env node

import { access, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const DEFAULT_DIR = 'postgres-pglite/dist/bin'
const DEFAULT_MAX_BODY_BYTES = 60_000
const DEFAULT_CHUNK_BYTES = 40_000
const DEFAULT_CPS_MIN_BODY_BYTES = 1_000_000
const DEFAULT_CPS_ROUNDS = 1

const args = parseArgs(process.argv.slice(2))
const targetDir = resolve(args.dir ?? DEFAULT_DIR)
const maxBodyBytes = readInt(args['max-body-bytes'], DEFAULT_MAX_BODY_BYTES)
const chunkBytes = readInt(args['chunk-bytes'], DEFAULT_CHUNK_BYTES)
const cpsMinBodyBytes = readInt(args['cps-min-body-bytes'], DEFAULT_CPS_MIN_BODY_BYTES)
const cpsRounds = readInt(args['cps-rounds'], DEFAULT_CPS_ROUNDS)
const cpsFuncRegex = args['cps-func-regex'] == null ? null : new RegExp(args['cps-func-regex'])
const cpsWide = Boolean(args['cps-wide'])
const dryRun = Boolean(args['dry-run'])
const verbose = Boolean(args.verbose)
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
      printed = await run(await tool('wasm-opt'), [wasmPath, '--all-features', '--print'], {
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
      const baseHelperPrefix = `$__shortfunc_cps_${sanitizeName(basename(fileName, '.wasm'))}`
      let cpsWat = inputWat
      const cpsSplits = []
      for (let round = 0; round < cpsRounds; round++) {
        const cpsResult = splitLongCpsTopLevelForms(cpsWat, {
          maxBodyBytes,
          cpsMinBodyBytes,
          helperPrefix: `${baseHelperPrefix}_r${round}`,
          funcRegex: cpsFuncRegex,
          verbose,
          cpsWide,
        })
        if (cpsResult.splits.length === 0) break
        cpsWat = cpsResult.wat
        cpsSplits.push(...cpsResult.splits)
      }
      result = { wat: cpsWat, splits: cpsSplits }
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

    await run(await tool('wasm-opt'), [outWatPath, '--all-features', '-o', outWasmPath], {
      capture: false,
    })
    await run(
      await tool('wasm-opt'),
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
    if (wat.slice(bodyStart, func.end).includes('tuple.')) continue
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

function splitLongCpsTopLevelForms(wat, options) {
  globalThis.__modShortfuncCpsWide = Boolean(options.cpsWide)
  const moduleEnd = findMatchingParen(wat, skipSpace(wat, 0))
  const funcs = findTopLevelForms(wat, 'func')
  const edits = []
  const helpers = []
  const globals = []
  const splits = []

  for (const func of funcs) {
    const headerEnd = findFuncHeaderEnd(wat, func.start + 1)
    if (headerEnd === -1) continue

    const header = wat.slice(func.start, headerEnd)
    const signature = parseFuncSignature(header)
    if (options.funcRegex != null && !options.funcRegex.test(signature?.name ?? '')) continue
    if (signature == null || !isSupportedCpsResultSignature(signature.results)) continue

    const bodyStart = skipSpace(wat, headerEnd)
    const directChildren = findChildForms(wat, bodyStart, func.end)
    if (directChildren.length === 0) continue

    const localDecls = []
    let firstBodyChild = 0
    while (firstBodyChild < directChildren.length) {
      const child = directChildren[firstBodyChild]
      if (readHead(wat, child.start) !== 'local') break
      const local = parseLocalDecl(wat.slice(child.start, child.end + 1))
      if (local == null) break
      localDecls.push(local)
      firstBodyChild++
    }

    const locals = [...signature.params, ...localDecls]
    if (locals.length === 0 || locals.some((local) => !isSpillableType(local.type))) continue

    const candidateRoots = directChildren.slice(firstBodyChild)
    const candidateThreshold = Math.max(options.maxBodyBytes, options.cpsMinBodyBytes)
    const candidate = findChainCpsCandidate(wat, candidateRoots, candidateThreshold)
      ?? findRootCpsCandidate(wat, candidateRoots, candidateThreshold)
      ?? findCpsCandidate(wat, candidateRoots, candidateThreshold)
    if (candidate == null) continue

    const candidateText = wat.slice(candidate.start, candidate.end + 1)
    const branchTargets = [...candidate.externalLabels]

    if (candidate.wideSequence) {
      const result = buildWideCpsSplit({
        wat,
        options,
        signature,
        locals,
        candidate,
        branchTargets,
        splitIndex: splits.length,
      })
      globals.push(...result.globals)
      helpers.push(...result.helpers)
      edits.push(result.edit)
      splits.push(result.split)
      continue
    }

    if (candidate.chainSegments != null) {
      const result = buildChainCpsSplit({
        wat,
        options,
        signature,
        locals,
        candidate,
        splitIndex: splits.length,
      })
      globals.push(...result.globals)
      helpers.push(...result.helpers)
      edits.push(result.edit)
      splits.push(result.split)
      continue
    }

    if (candidate.valueTarget != null) {
      const helperName = `${options.helperPrefix}_${splits.length}`
      const numericLocals = locals.filter((local) => local.type !== 'exnref')
      const refLocals = locals.filter((local) => local.type === 'exnref')
      const spillGlobals = numericLocals.map((local, index) => ({
        ...local,
        global: `${helperName}_local_${index}`,
      }))
      for (const spill of spillGlobals) {
        globals.push(`\n (global ${spill.global} (mut ${spill.type}) ${defaultWatValue(spill.type)})`)
      }
      const statusGlobal = `${helperName}_status`
      const returnGlobal = signature.results.length === 1 ? `${helperName}_return` : null
      const brTableIndexLocal = `${helperName}_br_table_index`
      const valueLocal = `${helperName}_value`
      globals.push(`\n (global ${statusGlobal} (mut i32) (i32.const 0))`)
      if (returnGlobal != null) {
        globals.push(`\n (global ${returnGlobal} (mut ${signature.results[0]}) ${defaultWatValue(signature.results[0])})`)
      }
      const branchStatuses = new Map(branchTargets.map((label, index) => [label, index + 2]))
      const cpsBody = rewriteBranchesForValueCps(
        rewriteReturnsForValueCps(candidateText, signature.results, returnGlobal, refLocals),
        branchStatuses,
        brTableIndexLocal,
        refLocals,
      )
      const helperParams = refLocals.map((local) => ` (param ${local.name} ${local.type})`).join('')
      const helperLocals = [
        ...numericLocals.map((local) => `  (local ${local.name} ${local.type})`),
        `  (local ${brTableIndexLocal} i32)`,
      ].join('\n')
      const loadHelper = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
      const storeHelper = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
      const helperResults = ['i32', ...refLocals.map((local) => local.type), 'exnref'].map((type) => ` (result ${type})`).join('')
      const normalResults = ['(i32.const 0)', ...refLocals.map((local) => `(local.get ${local.name})`)].map((line) => `  ${line}`).join('\n')
      helpers.push(`
 (func ${helperName}${helperParams}${helperResults}
${helperLocals}
${loadHelper}
  (local.set ${candidate.valueTarget}
   (block (result exnref)
${indent(cpsBody, 4)}
   )
  )
${storeHelper}
${normalResults}
  (local.get ${candidate.valueTarget})
 )`)

      const storeCaller = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
      const callArgs = refLocals.map((local) => `   (local.get ${local.name})`).join('\n')
      const callHelper = refLocals.length === 0
        ? `  (call ${helperName})`
        : `  (call ${helperName}\n${callArgs}\n  )`
      const loadCaller = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
      edits.push({
        start: candidate.parent.start,
        end: candidate.parent.end + 1,
        text: [
          storeCaller,
          callHelper,
          `  (local.set ${candidate.valueTarget})`,
          [...refLocals].reverse().map((local) => `  (local.set ${local.name})`).join('\n'),
          `  (global.set ${statusGlobal})`,
          `  (if\n   (i32.eq (global.get ${statusGlobal}) (i32.const 1))\n   (then\n${loadCaller}\n${cpsCallerReturn(signature.results, returnGlobal, statusGlobal, refLocals)}\n   )\n  )`,
          ...branchTargets.map((label, index) => `  (if\n   (i32.eq (global.get ${statusGlobal}) (i32.const ${index + 2}))\n   (then\n${loadCaller}\n    (br ${label})\n   )\n  )`),
          loadCaller,
        ].filter((part) => part.length > 0).join('\n'),
      })
      splits.push({
        funcName: signature.name ?? `$func${splits.length}`,
        originalBytes: candidate.end - candidate.start + 1,
        helperCount: 1,
        kind: candidate.kind ?? readHead(wat, candidate.start),
      })
      continue
    }

    if (signature.results.length > 1) continue

    const helperName = `${options.helperPrefix}_${splits.length}`
    const numericLocals = locals.filter((local) => local.type !== 'exnref')
    const refLocals = locals.filter((local) => local.type === 'exnref')
    const spillGlobals = numericLocals.map((local, index) => ({
      ...local,
      global: `${helperName}_local_${index}`,
    }))
    const returnGlobal = signature.results.length === 1
      ? `${helperName}_return`
      : null

    for (const spill of spillGlobals) {
      globals.push(`\n (global ${spill.global} (mut ${spill.type}) ${defaultWatValue(spill.type)})`)
    }
    const statusGlobal = `${helperName}_status`
    globals.push(`\n (global ${statusGlobal} (mut i32) (i32.const 0))`)
    if (returnGlobal != null) {
      globals.push(`\n (global ${returnGlobal} (mut ${signature.results[0]}) ${defaultWatValue(signature.results[0])})`)
    }

    const branchStatuses = new Map(branchTargets.map((label, index) => [label, index + 2]))
    const brTableIndexLocal = `${helperName}_br_table_index`
    const cpsBody = rewriteBranchesForCps(
      rewriteReturnsForCps(candidateText, signature.results, returnGlobal, refLocals),
      branchStatuses,
      refLocals,
      `${helperName}_br_table_index`,
    )
    const helperParams = refLocals.map((local) => ` (param ${local.name} ${local.type})`).join('')
    const helperResults = ['i32', ...refLocals.map((local) => local.type)].map((type) => ` (result ${type})`).join('')
    const helperLocals = [...numericLocals.map((local) => `  (local ${local.name} ${local.type})`), `  (local ${brTableIndexLocal} i32)`].join('\n')
    const loadHelper = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
    const storeHelper = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
    const normalResults = ['(i32.const 0)', ...refLocals.map((local) => `(local.get ${local.name})`)].map((line) => `  ${line}`).join('\n')
    helpers.push(`\n (func ${helperName}${helperParams}${helperResults}\n${helperLocals}\n${loadHelper}\n${indent(cpsBody, 2)}\n${storeHelper}\n${normalResults}\n )`)

    const storeCaller = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
    const callArgs = refLocals.map((local) => `   (local.get ${local.name})`).join('\n')
    const callHelper = refLocals.length === 0
      ? `  (call ${helperName})`
      : `  (call ${helperName}\n${callArgs}\n  )`
    const captureRefResults = [...refLocals].reverse().map((local) => `  (local.set ${local.name})`).join('\n')
    const captureStatus = `  (global.set ${statusGlobal})`
    const loadCaller = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
    const returnCaller = cpsCallerReturn(signature.results, returnGlobal, statusGlobal, refLocals)
    edits.push({
      start: candidate.start,
      end: candidate.end + 1,
      text: [
        storeCaller,
        callHelper,
        captureRefResults,
        captureStatus,
        `  (if\n   (i32.eq (global.get ${statusGlobal}) (i32.const 1))\n   (then\n${loadCaller}\n${returnCaller}\n   )\n  )`,
        ...branchTargets.map((label, index) => `  (if\n   (i32.eq (global.get ${statusGlobal}) (i32.const ${index + 2}))\n   (then\n${loadCaller}\n    (br ${label})\n   )\n  )`),
        loadCaller,
      ].filter((part) => part.length > 0).join('\n'),
    })
    splits.push({
      funcName: signature.name ?? `$func${splits.length}`,
      originalBytes: candidate.end - candidate.start + 1,
      helperCount: 1,
      kind: candidate.kind ?? readHead(wat, candidate.start),
    })
  }

  if (helpers.length > 0) {
    edits.push({ start: moduleEnd, end: moduleEnd, text: `${globals.join('')}${helpers.join('')}` })
  }

  return { wat: applyEdits(wat, edits), splits }
}

function buildWideCpsSplit({ wat, options, signature, locals, candidate, branchTargets, splitIndex }) {
  if (candidate.valueType === 'exnref' && candidate.valueTarget != null) {
    return buildWideValueCpsSplit({ wat, options, signature, locals, candidate, branchTargets, splitIndex })
  }

  const helperBaseName = `${options.helperPrefix}_${splitIndex}`
  const numericLocals = locals.filter((local) => local.type !== 'exnref')
  const refLocals = locals.filter((local) => local.type === 'exnref')
  const spillGlobals = numericLocals.map((local, index) => ({ ...local, global: `${helperBaseName}_local_${index}` }))
  const globals = spillGlobals.map((spill) => `
 (global ${spill.global} (mut ${spill.type}) ${defaultWatValue(spill.type)})`)
  const statusGlobal = `${helperBaseName}_status`
  const returnGlobal = signature.results.length === 1 ? `${helperBaseName}_return` : null
  globals.push(`
 (global ${statusGlobal} (mut i32) (i32.const 0))`)
  if (returnGlobal != null) {
    globals.push(`
 (global ${returnGlobal} (mut ${signature.results[0]}) ${defaultWatValue(signature.results[0])})`)
  }
  const branchStatuses = new Map(branchTargets.map((label, index) => [label, index + 2]))
  const helperParams = refLocals.map((local) => ` (param ${local.name} ${local.type})`).join('')
  const helperResults = ['i32', ...refLocals.map((local) => local.type)].map((type) => ` (result ${type})`).join('')
  const loadHelper = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
  const storeHelper = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
  const normalResults = ['(i32.const 0)', ...refLocals.map((local) => `(local.get ${local.name})`)].map((line) => `  ${line}`).join('\n')
  const helpers = []
  const calls = []
  const storeCaller = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
  const loadCaller = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
  const callArgs = refLocals.map((local) => `   (local.get ${local.name})`).join('\n')
  for (const [index, chunk] of candidate.chunks.entries()) {
    const helperName = `${helperBaseName}_${index}`
    const brTableIndexLocal = `${helperName}_br_table_index`
    const helperLocals = [...numericLocals.map((local) => `  (local ${local.name} ${local.type})`), `  (local ${brTableIndexLocal} i32)`].join('\n')
    const body = wat.slice(chunk[0].start, chunk.at(-1).end + 1)
    const cpsBody = rewriteBranchesForCps(body, branchStatuses, refLocals, brTableIndexLocal)
    helpers.push(`
 (func ${helperName}${helperParams}${helperResults}
${helperLocals}
${loadHelper}
${indent(cpsBody, 2)}
${storeHelper}
${normalResults}
 )`)
    const callHelper = refLocals.length === 0 ? `  (call ${helperName})` : `  (call ${helperName}
${callArgs}
  )`
    const captureRefResults = [...refLocals].reverse().map((local) => `  (local.set ${local.name})`).join('\n')
    calls.push(callHelper)
    if (captureRefResults.length > 0) calls.push(captureRefResults)
    calls.push(`  (global.set ${statusGlobal})`)
    if (returnGlobal != null) {
      calls.push(`  (if\n   (i32.eq (global.get ${statusGlobal}) (i32.const 1))\n   (then\n${loadCaller}\n${cpsCallerReturn(signature.results, returnGlobal, statusGlobal, refLocals)}\n   )\n  )`)
    }
    for (const [labelIndex, label] of branchTargets.entries()) {
      calls.push(`  (if
   (i32.eq (global.get ${statusGlobal}) (i32.const ${labelIndex + 2}))
   (then
${loadCaller}
    (br ${label})
   )
  )`)
    }
    if (loadCaller.length > 0) calls.push(loadCaller)
  }
  return {
    globals,
    helpers,
    edit: { start: candidate.start, end: candidate.end + 1, text: [storeCaller, ...calls].filter((part) => part.length > 0).join('\n') },
    split: {
      funcName: signature.name ?? `$func${splitIndex}`,
      originalBytes: candidate.end - candidate.start + 1,
      helperCount: candidate.chunks.length,
      kind: candidate.kind,
    },
  }
}

function buildWideValueCpsSplit({ wat, options, signature, locals, candidate, branchTargets, splitIndex }) {
  const helperBaseName = `${options.helperPrefix}_${splitIndex}`
  const numericLocals = locals.filter((local) => local.type !== 'exnref')
  const refLocals = locals.filter((local) => local.type === 'exnref')
  const spillGlobals = numericLocals.map((local, index) => ({ ...local, global: `${helperBaseName}_local_${index}` }))
  const globals = spillGlobals.map((spill) => `
 (global ${spill.global} (mut ${spill.type}) ${defaultWatValue(spill.type)})`)
  const statusGlobal = `${helperBaseName}_status`
  const returnGlobal = signature.results.length === 1 ? `${helperBaseName}_return` : null
  globals.push(`
 (global ${statusGlobal} (mut i32) (i32.const 0))`)
  if (returnGlobal != null) {
    globals.push(`
 (global ${returnGlobal} (mut ${signature.results[0]}) ${defaultWatValue(signature.results[0])})`)
  }
  const branchStatuses = new Map(branchTargets.map((label, index) => [label, index + 2]))
  const helperParams = refLocals.map((local) => ` (param ${local.name} ${local.type})`).join('')
  const helperResults = ['i32', ...refLocals.map((local) => local.type), candidate.valueType].map((type) => ` (result ${type})`).join('')
  const loadHelper = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
  const storeHelper = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
  const storeCaller = spillGlobals.map((spill) => `  (global.set ${spill.global} (local.get ${spill.name}))`).join('\n')
  const loadCaller = spillGlobals.map((spill) => `  (local.set ${spill.name} (global.get ${spill.global}))`).join('\n')
  const callArgs = refLocals.map((local) => `   (local.get ${local.name})`).join('\n')
  const helpers = []
  const calls = []

  for (const [index, chunk] of candidate.chunks.entries()) {
    const helperName = `${helperBaseName}_${index}`
    const brTableIndexLocal = `${helperName}_br_table_index`
    const valueLocal = `${helperName}_value`
    const helperLocals = [
      ...numericLocals.map((local) => `  (local ${local.name} ${local.type})`),
      `  (local ${brTableIndexLocal} i32)`,
      `  (local ${valueLocal} ${candidate.valueType})`,
    ].join('\n')
    const body = wat.slice(chunk[0].start, chunk.at(-1).end + 1)
    const cpsBody = rewriteBranchesForValueCps(
      rewriteReturnsForValueCps(body, signature.results, returnGlobal, refLocals),
      branchStatuses,
      brTableIndexLocal,
      refLocals,
    )
    const isLastChunk = index === candidate.chunks.length - 1
    const valueBody = isLastChunk
      ? `(block (result ${candidate.valueType})\n${indent(cpsBody, 2)}\n )`
      : `(block (result ${candidate.valueType})\n${indent(cpsBody, 2)}\n ${defaultCpsValue(candidate.valueType, refLocals)}\n )`
    const normalResults = ['(i32.const 0)', ...refLocals.map((local) => `(local.get ${local.name})`), `(local.get ${valueLocal})`].map((line) => `  ${line}`).join('\n')
    helpers.push(`
 (func ${helperName}${helperParams}${helperResults}
${helperLocals}
${loadHelper}
  (local.set ${valueLocal}
   ${valueBody}
  )
${storeHelper}
${normalResults}
 )`)

    const callHelper = refLocals.length === 0 ? `  (call ${helperName})` : `  (call ${helperName}
${callArgs}
  )`
    const captureRefResults = [...refLocals].reverse().map((local) => `  (local.set ${local.name})`).join('\n')
    calls.push(callHelper)
    calls.push(`  (local.set ${candidate.valueTarget})`)
    if (captureRefResults.length > 0) calls.push(captureRefResults)
    calls.push(`  (global.set ${statusGlobal})`)
    if (returnGlobal != null) {
      calls.push(`  (if\n   (i32.eq (global.get ${statusGlobal}) (i32.const 1))\n   (then\n${loadCaller}\n${cpsCallerReturn(signature.results, returnGlobal, statusGlobal, refLocals)}\n   )\n  )`)
    }
    for (const [labelIndex, label] of branchTargets.entries()) {
      calls.push(`  (if
   (i32.eq (global.get ${statusGlobal}) (i32.const ${labelIndex + 2}))
   (then
${loadCaller}
    (br ${label})
   )
  )`)
    }
    if (loadCaller.length > 0) calls.push(loadCaller)
  }
  calls.push(`  (local.get ${candidate.valueTarget})`)

  return {
    globals,
    helpers,
    edit: { start: candidate.start, end: candidate.end + 1, text: [storeCaller, ...calls].filter((part) => part.length > 0).join('\n') },
    split: {
      funcName: signature.name ?? `$func${splitIndex}`,
      originalBytes: candidate.end - candidate.start + 1,
      helperCount: candidate.chunks.length,
      kind: candidate.kind,
    },
  }
}

function parseFuncSignature(header) {
  return {
    name: getFuncName(header),
    params: [...header.matchAll(/\(param\s+(\$[^\s()]+)\s+([^\s()]+)\)/g)].map((m) => ({ name: m[1], type: m[2] })),
    results: [...header.matchAll(/\(result\s+([^\s()]+)\)/g)].map((m) => m[1]),
  }
}

function isSupportedCpsResultSignature(results) {
  if (results.some((type) => type.startsWith('tuple') || type.includes('.'))) return false
  return results.length <= 1 || (results[0] === 'i32' && results.slice(1).every((type) => type === 'exnref'))
}

function cpsCallerReturn(resultTypes, returnGlobal, statusGlobal, refLocals) {
  if (resultTypes.length === 0) return '  (return)'
  if (resultTypes.length === 1) return `  (return (global.get ${returnGlobal}))`
  const values = [`(global.get ${statusGlobal})`, ...refLocals.map((local) => `(local.get ${local.name})`)]
  for (const type of resultTypes.slice(values.length)) {
    values.push(defaultCpsValue(type, refLocals))
  }
  return `  (return\n${values.map((value) => `   ${value}`).join('\n')}\n  )`
}


function parseLocalDecl(text) {
  const match = text.match(/^\(local\s+(\$[^\s()]+)\s+([^\s()]+)\)$/)
  return match == null ? null : { name: match[1], type: match[2] }
}

function isSpillableType(type) {
  return ['i32', 'i64', 'f32', 'f64', 'exnref'].includes(type)
}

function defaultWatValue(type) {
  switch (type) {
    case 'i32': return '(i32.const 0)'
    case 'i64': return '(i64.const 0)'
    case 'f32': return '(f32.const 0)'
    case 'f64': return '(f64.const 0)'
    case 'exnref': return '(ref.null noexn)'
    default: throw new Error(`unsupported spill type: ${type}`)
  }
}

function defaultCpsValue(type, refLocals = []) {
  if (type === 'exnref' && refLocals.length > 0) return `(local.get ${refLocals[0].name})`
  return defaultWatValue(type)
}

function isStatementLikeCpsCandidate(wat, child) {
  const head = readHead(wat, child.start)
  if (['global.set', 'local.set', 'i32.store', 'i64.store', 'f32.store', 'f64.store', 'drop', 'br', 'br_if', 'throw', 'throw_ref', 'unreachable'].includes(head)) {
    return true
  }
  if (['if', 'block', 'loop', 'try_table'].includes(head)) {
    return !blockDeclaresResult(wat, child.start)
  }
  return false
}

function blockDeclaresResult(wat, start) {
  const childrenStart = findChildrenStart(wat, start)
  const header = wat.slice(start, childrenStart)
  return /\(result\b/.test(header)
}

function findChainCpsCandidate(wat, roots, threshold) {
  return findChainCpsCandidateByScan(wat, roots, threshold)

  let forms = roots.map((form) => ({ ...form, parent: null }))
  let ancestors = []
  let lastSplittable = null
  for (let depth = 0; depth < 512 && forms.length > 0; depth++) {
    const parent = forms.reduce((max, child) =>
      child.end - child.start > max.end - max.start ? child : max,
      forms[0],
    )
    const parentHead = readHead(wat, parent.start)
    if (!['block', 'loop', 'if'].includes(parentHead) || blockDeclaresResult(wat, parent.start)) return null
    const label = readOptionalLabel(wat, parent.start)
    const nextAncestors = label == null ? ancestors : [...ancestors, label]
    let children
    try {
      children = findChildForms(wat, findChildrenStart(wat, parent.start), parent.end)
    } catch {
      return null
    }
    if (children.length === 0) return null
    const indexed = children.map((child, index) => ({ ...child, index, parent }))
    const largest = indexed.reduce((max, child) =>
      child.end - child.start > max.end - max.start ? child : max,
      indexed[0],
    )
    const largestSize = largest.end - largest.start + 1
    const parentSize = parent.end - parent.start + 1
    const suffixSize = parentSize - largestSize

    if (isStatementLikeCpsCandidate(wat, largest) && !blockDeclaresResult(wat, largest.start)) {
      lastSplittable = { ...largest, parent, externalLabels: new Set(nextAncestors), kind: `chain:${parentHead}:${children.length}:${largest.index}:d${depth}` }
      if (largestSize <= threshold && parentSize > threshold * 4) {
        return lastSplittable
      }
    }
    if (largestSize <= threshold) return lastSplittable
    if (!['block', 'loop', 'if'].includes(readHead(wat, largest.start))) return lastSplittable
    ancestors = nextAncestors
    forms = [largest]
  }
  return lastSplittable
}

function findChainCpsCandidateByScan(wat, roots, threshold) {
  if (roots.length === 0) return null
  const rangeStart = roots[0].start
  const rangeEnd = roots.at(-1).end
  const nodes = []
  const byStart = new Map()
  const stack = []
  for (let pos = rangeStart; pos <= rangeEnd; pos++) {
    const char = wat[pos]
    if (char === '"') {
      pos = skipString(wat, pos)
    } else if (char === '(') {
      const node = {
        start: pos,
        end: -1,
        head: readHead(wat, pos),
        parentIndex: stack.length === 0 ? -1 : stack.at(-1),
        childCount: 0,
        largestChildIndex: -1,
        largestChildSize: 0,
      }
      nodes.push(node)
      byStart.set(pos, nodes.length - 1)
      stack.push(nodes.length - 1)
    } else if (char === ')') {
      const index = stack.pop()
      if (index == null) return null
      const node = nodes[index]
      node.end = pos
      if (node.parentIndex !== -1) {
        const parent = nodes[node.parentIndex]
        const size = node.end - node.start + 1
        parent.childCount++
        if (size > parent.largestChildSize) {
          parent.largestChildSize = size
          parent.largestChildIndex = index
        }
      }
    }
  }
  const rootIndexes = roots.map((root) => byStart.get(root.start)).filter((index) => index != null)
  if (rootIndexes.length === 0) return null
  let currentIndex = rootIndexes.reduce((best, index) =>
    nodes[index].end - nodes[index].start > nodes[best].end - nodes[best].start ? index : best,
    rootIndexes[0],
  )
  const ancestors = []
  let lastSplittable = null
  for (let depth = 0; depth < 4096 && currentIndex !== -1; depth++) {
    const parent = nodes[currentIndex]
    if (!['block', 'loop', 'if'].includes(parent.head) || blockDeclaresResult(wat, parent.start)) break
    const label = readOptionalLabel(wat, parent.start)
    if (label != null) ancestors.push(label)
    const childIndex = parent.largestChildIndex
    if (childIndex === -1) break
    const child = nodes[childIndex]
    const childSize = child.end - child.start + 1
    const parentSize = parent.end - parent.start + 1
    if (isStatementLikeCpsCandidate(wat, child) && !blockDeclaresResult(wat, child.start)) {
      lastSplittable = {
        start: child.start,
        end: child.end,
        parent: { start: parent.start, end: parent.end },
        externalLabels: new Set(ancestors),
        kind: `chain-scan:${parent.head}:${parent.childCount}:d${depth}`,
      }
      if (childSize <= threshold && parentSize > threshold * 4) return lastSplittable
    }
    if (childSize <= threshold || !['block', 'loop', 'if'].includes(child.head)) break
    currentIndex = childIndex
  }
  return lastSplittable
}

function findRootCpsCandidate(wat, roots, threshold) {
  let best = null
  for (const root of roots) {
    const size = root.end - root.start + 1
    if (size <= threshold * 4) continue
    if (!isStatementLikeCpsCandidate(wat, root)) continue
    if (blockDeclaresResult(wat, root.start)) continue
    if (best == null || size > best.end - best.start + 1) best = root
  }
  return best == null ? null : { ...best, externalLabels: new Set(), kind: `root:${readHead(wat, best.start)}` }
}

function findCpsCandidate(wat, roots, threshold) {
  let best = null
  let forms = roots.map((form) => ({ ...form, parent: null }))
  let ancestors = []
  while (forms.length > 0) {
    const form = forms.reduce((max, child) =>
      child.end - child.start > max.end - max.start ? child : max,
      forms[0],
    )
    const size = form.end - form.start + 1
    if (size <= threshold) break
    if (isValueReturningLocalSetCandidate(wat, form)) {
      const formText = wat.slice(form.start, form.end + 1)
      const externalLabels = collectExternalBranchLabels(formText, ancestors)
      collectExternalBranchTableLabels(formText, ancestors, externalLabels)
      best = { ...form, externalLabels, valueTarget: readLocalSetTarget(wat, form.parent.start), valueType: readBlockResultType(wat, form.start) }
    } else if (isStatementLikeCpsCandidate(wat, form) && !isInsideResultBlock(wat, form)) {
      const formText = wat.slice(form.start, form.end + 1)
      const externalLabels = collectExternalBranchLabels(formText, ancestors)
      collectExternalBranchTableLabels(formText, ancestors, externalLabels)
      best = { ...form, externalLabels }
    }
    const head = readHead(wat, form.start)
    if (!isCpsSearchContainer(head)) break
    const label = readOptionalLabel(wat, form.start)
    if (label != null) ancestors = [...ancestors, label]
    try {
      const children = findChildForms(wat, findCpsSearchChildrenStart(wat, form.start), form.end)
      const wide = findWideCpsChildSequence(wat, form, children, threshold, ancestors)
      if (wide != null && globalThis.__modShortfuncCpsWide) return wide
      forms = children.map((child) => ({ ...child, parent: form }))
    } catch {
      break
    }
  }
  return best
}

function isInsideResultBlock(wat, form) {
  for (let current = form.parent; current != null; current = current.parent) {
    if (['block', 'loop', 'try_table'].includes(readHead(wat, current.start)) && blockDeclaresResult(wat, current.start)) return true
  }
  return false
}

function findWideCpsChildSequence(wat, parent, children, threshold, ancestors) {
  if (children.length < 2) return null
  const total = children.at(-1).end - children[0].start + 1
  if (total <= threshold) return null
  if (children.some((child) => child.end - child.start + 1 > threshold)) return null
  const head = readHead(wat, parent.start)
  if (!['block', 'loop', 'try_table'].includes(head)) return null
  const valueType = readBlockResultType(wat, parent.start)
  const valueTarget = findEnclosingLocalSetTarget(wat, parent)
  if (valueType !== 'exnref' || valueTarget == null) return null
  const chunks = chunkForms(children, Math.max(40_000, Math.floor(threshold / 2)))
  if (chunks.length < 2) return null
  const start = children[0].start
  const end = children.at(-1).end
  const text = wat.slice(start, end + 1)
  const externalLabels = collectExternalBranchLabels(text, ancestors)
  collectExternalBranchTableLabels(text, ancestors, externalLabels)
  return { start, end, parent, externalLabels, wideSequence: true, chunks, valueType, valueTarget, kind: `wide:${head}:${children.length}` }
}
function findEnclosingLocalSetTarget(wat, form) {
  for (let current = form; current != null; current = current.parent) {
    if (readHead(wat, current.start) === 'local.set') return readLocalSetTarget(wat, current.start)
  }
  return null
}

function isValueReturningLocalSetCandidate(wat, form) {
  return form.parent != null && readHead(wat, form.parent.start) === 'local.set' && readHead(wat, form.start) === 'block' && readBlockResultType(wat, form.start) === 'exnref'
}

function readLocalSetTarget(wat, formStart) {
  const pos = findInstructionOperandsStart(wat, formStart)
  return wat.slice(pos, skipToken(wat, pos))
}

function readBlockResultType(wat, formStart) {
  const childrenStart = findChildrenStart(wat, formStart)
  const header = wat.slice(formStart, childrenStart)
  return header.match(/\(result\s+([^\s()]+)\)/)?.[1] ?? null
}
function isCpsSearchContainer(head) {
  return ['block', 'loop', 'if', 'local.set', 'global.set', 'drop'].includes(head)
}

function findCpsSearchChildrenStart(wat, formStart) {
  const head = readHead(wat, formStart)
  if (['block', 'loop', 'if', 'try_table'].includes(head)) return findChildrenStart(wat, formStart)
  let pos = findInstructionOperandsStart(wat, formStart)
  if (['local.set', 'global.set'].includes(head)) {
    pos = skipSpace(wat, skipToken(wat, pos))
  }
  return pos
}

function readOptionalLabel(wat, formStart) {
  let pos = skipSpace(wat, skipToken(wat, formStart + 1))
  if (wat[pos] !== '$') return null
  return wat.slice(pos, skipToken(wat, pos))
}

function collectExternalBranchLabels(text, ancestorLabels) {
  const ancestorSet = new Set(ancestorLabels)
  const labels = new Set()
  collectExternalBranchLabelsInRange(text, 0, text.length, [], ancestorSet, labels)
  return labels
}

function collectExternalBranchTableLabels(text, ancestorLabels, labels) {
  collectExternalBranchLabelsInRange(text, 0, text.length, [], new Set(ancestorLabels), labels)
}

function collectExternalBranchLabelsInRange(text, start, end, stack, ancestorSet, labels) {
  for (let pos = skipSpace(text, start); pos < end; pos = skipSpace(text, pos)) {
    if (text[pos] !== '(') {
      pos++
      continue
    }
    const formEnd = findMatchingParen(text, pos)
    const head = readHead(text, pos)
    if (head === 'br' || head === 'br_if') {
      const labelStart = findInstructionOperandsStart(text, pos)
      const label = text.slice(labelStart, skipToken(text, labelStart))
      collectExternalResolvedLabel(label, stack, ancestorSet, labels)
    } else if (head === 'br_table') {
      for (const label of readBranchTableLabels(text, { start: pos, end: formEnd })) {
        collectExternalResolvedLabel(label, stack, ancestorSet, labels)
      }
    }
    const label = ['block', 'loop', 'try_table'].includes(head) ? readOptionalLabel(text, pos) : null
    const nextStack = label == null ? stack : [...stack, label]
    if (!['br', 'br_if', 'br_table'].includes(head)) {
      collectExternalBranchLabelsInRange(text, findChildrenStart(text, pos), formEnd, nextStack, ancestorSet, labels)
    }
    pos = formEnd + 1
  }
}

function collectExternalResolvedLabel(label, stack, ancestorSet, labels) {
  if (stack.includes(label)) return
  labels.add(label)
}

function canRewriteBranchTables(text, externalLabels) {
  for (const form of findFormsByHead(text, 'br_table')) {
    for (const label of readBranchTableLabels(text, form)) {
      if (!externalLabels.has(label)) return false
    }
  }
  return true
}

function findInstructionOperandsStart(wat, formStart) {
  return skipSpace(wat, skipToken(wat, formStart + 1))
}

function readBranchTableLabels(text, form) {
  const labels = []
  let pos = findInstructionOperandsStart(text, form.start)
  while (text[pos] === '$') {
    const end = skipToken(text, pos)
    labels.push(text.slice(pos, end))
    pos = skipSpace(text, end)
  }
  return labels
}

function containsFormHead(text, head) {
  return findFormsByHead(text, head).length > 0
}
function hasExternalBranchTable(text, ancestorLabels) {
  const localLabels = new Set([...text.matchAll(/\((?:block|loop|try_table)\s+(\$[^\s()]+)/g)].map((m) => m[1]))
  const ancestorSet = new Set(ancestorLabels)
  for (const form of findFormsByHead(text, 'br_table')) {
    const labelsText = text.slice(findChildrenStart(text, form.start), form.end)
    for (const match of labelsText.matchAll(/\$[^\s()]+/g)) {
      const label = match[0]
      if (!localLabels.has(label) && ancestorSet.has(label)) return true
    }
  }
  return false
}
function rewriteBranchesForValueCps(text, branchStatuses, brTableIndexLocal, refLocals = []) {
  if (branchStatuses.size === 0) return text
  const edits = []
  for (const form of findFormsByHead(text, 'br')) {
    const childrenStart = findInstructionOperandsStart(text, form.start)
    const label = text.slice(childrenStart, skipToken(text, childrenStart))
    const status = branchStatuses.get(label)
    if (status != null) edits.push({ start: form.start, end: form.end + 1, text: cpsValueStatusReturn(status, refLocals) })
  }
  for (const form of findFormsByHead(text, 'br_if')) {
    const childrenStart = findInstructionOperandsStart(text, form.start)
    const labelEnd = skipToken(text, childrenStart)
    const label = text.slice(childrenStart, labelEnd)
    const status = branchStatuses.get(label)
    if (status != null) {
      const cond = text.slice(skipSpace(text, labelEnd), form.end).trim()
      edits.push({ start: form.start, end: form.end + 1, text: '(if ' + cond + '\n (then\n  ' + cpsValueStatusReturn(status, refLocals) + '\n )\n)' })
    }
  }
  for (const form of findFormsByHead(text, 'br_table')) {
    const labels = readBranchTableLabels(text, form)
    if (labels.length === 0) continue
    let pos = findInstructionOperandsStart(text, form.start)
    for (const label of labels) pos = skipSpace(text, skipToken(text, pos))
    const indexExpr = text.slice(pos, form.end).trim()
    const cases = labels.slice(0, -1).map((label, index) =>
      ' (if (i32.eq (local.get ' + brTableIndexLocal + ') (i32.const ' + index + '))\n' +
      '  (then\n   ' + cpsValueBranchTableAction(label, branchStatuses, refLocals) + '\n  )\n )',
    ).join('\n')
    const defaultLabel = labels.at(-1)
    edits.push({ start: form.start, end: form.end + 1, text: '(block\n (local.set ' + brTableIndexLocal + ' ' + indexExpr + ')\n' + cases + '\n ' + cpsValueBranchTableAction(defaultLabel, branchStatuses, refLocals) + '\n)' })
  }
  return applyEdits(text, edits)
}

function cpsValueBranchTableAction(label, branchStatuses, refLocals) {
  const status = branchStatuses.get(label)
  return status == null ? `(br ${label})` : cpsValueStatusReturn(status, refLocals)
}

function cpsValueStatusReturn(status, refLocals = []) {
  const value = defaultCpsValue('exnref', refLocals)
  return '(return\n (i32.const ' + status + ')' + refLocals.map((local) => '\n (local.get ' + local.name + ')').join('') + '\n ' + value + '\n)'
}

function rewriteBranchesForCps(text, branchStatuses, refLocals, brTableIndexLocal) {
  if (branchStatuses.size === 0) return text
  const edits = []
  for (const form of findFormsByHead(text, 'br')) {
    const childrenStart = findInstructionOperandsStart(text, form.start)
    const label = text.slice(childrenStart, skipToken(text, childrenStart))
    const status = branchStatuses.get(label)
    if (status != null) {
      edits.push({ start: form.start, end: form.end + 1, text: cpsStatusReturn(status, refLocals) })
    }
  }
  for (const form of findFormsByHead(text, 'br_if')) {
    const childrenStart = findInstructionOperandsStart(text, form.start)
    const labelEnd = skipToken(text, childrenStart)
    const label = text.slice(childrenStart, labelEnd)
    const status = branchStatuses.get(label)
    if (status != null) {
      const cond = text.slice(skipSpace(text, labelEnd), form.end).trim()
      edits.push({ start: form.start, end: form.end + 1, text: '(if ' + cond + '\n (then\n  ' + cpsStatusReturn(status, refLocals) + '\n )\n)' })
    }
  }
  for (const form of findFormsByHead(text, 'br_table')) {
    const labels = readBranchTableLabels(text, form)
    if (labels.length === 0) continue
    let pos = findInstructionOperandsStart(text, form.start)
    for (const label of labels) pos = skipSpace(text, skipToken(text, pos))
    const indexExpr = text.slice(pos, form.end).trim()
    const cases = labels.slice(0, -1).map((label, index) =>
      ' (if (i32.eq (local.get ' + brTableIndexLocal + ') (i32.const ' + index + '))\n' +
      '  (then\n   ' + cpsBranchTableAction(label, branchStatuses, refLocals) + '\n  )\n )',
    ).join('\n')
    const defaultLabel = labels.at(-1)
    edits.push({
      start: form.start,
      end: form.end + 1,
      text: '(block\n (local.set ' + brTableIndexLocal + ' ' + indexExpr + ')\n' + cases + '\n ' + cpsBranchTableAction(defaultLabel, branchStatuses, refLocals) + '\n)',
    })
  }
  return applyEdits(text, edits)
}

function cpsBranchTableAction(label, branchStatuses, refLocals) {
  const status = branchStatuses.get(label)
  return status == null ? `(br ${label})` : cpsStatusReturn(status, refLocals)
}

function cpsStatusReturn(status, refLocals) {
  return '(return\n (i32.const ' + status + ')' + refLocals.map((local) => '\n (local.get ' + local.name + ')').join('') + '\n)'
}
function hasBranchToExternalLabel(text) {
  const labels = new Set([...text.matchAll(/\((?:block|loop|try_table)\s+(\$[^\s()]+)/g)].map((m) => m[1]))
  for (const match of text.matchAll(/\b(?:br|br_if|br_on_null|br_on_non_null)\s+(\$[^\s()]+)/g)) {
    if (!labels.has(match[1])) return true
  }
  return false
}

function rewriteReturnsForValueCps(text, resultTypes, returnGlobal, refLocals = []) {
  if (resultTypes.length > 1) return text
  const edits = []
  for (const form of findFormsByHead(text, 'return')) {
    const childrenStart = findInstructionOperandsStart(text, form.start)
    const payload = text.slice(childrenStart, form.end).trim()
    let replacement
    if (resultTypes.length === 0) {
      replacement = cpsValueStatusReturn(1, refLocals)
    } else if (payload.length === 0) {
      throw new Error('non-void return without payload')
    } else {
      replacement = `(block\n (global.set ${returnGlobal} ${payload})\n ${cpsValueStatusReturn(1, refLocals)}\n)`
    }
    edits.push({ start: form.start, end: form.end + 1, text: replacement })
  }
  return applyEdits(text, edits)
}

function rewriteReturnsForCps(text, resultTypes, returnGlobal, refLocals = []) {
  if (resultTypes.length > 1) return text
  const edits = []
  for (const form of findFormsByHead(text, 'return')) {
    const childrenStart = findInstructionOperandsStart(text, form.start)
    const payload = text.slice(childrenStart, form.end).trim()
    let replacement
    if (resultTypes.length === 0) {
      replacement = cpsReturnStatus(refLocals)
    } else if (payload.length === 0) {
      throw new Error('non-void return without payload')
    } else {
      replacement = `(block\n (global.set ${returnGlobal} ${payload})\n ${cpsReturnStatus(refLocals)}\n)`
    }
    edits.push({ start: form.start, end: form.end + 1, text: replacement })
  }
  return applyEdits(text, edits)
}

function cpsReturnStatus(refLocals) {
  return `(return\n (i32.const 1)${refLocals.map((local) => `\n (local.get ${local.name})`).join('')}\n)`
}

function findFormsByHead(wat, head) {
  const forms = []
  for (let pos = 0; pos < wat.length; pos++) {
    if (wat[pos] === '"') {
      pos = skipString(wat, pos)
    } else if (wat[pos] === '(' && readHead(wat, pos) === head) {
      forms.push({ start: pos, end: findMatchingParen(wat, pos) })
    }
  }
  return forms
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
  let pos = skipSpace(wat, skipToken(wat, formStart + 1))
  if (wat[pos] === '$') {
    pos = skipSpace(wat, skipToken(wat, pos))
  }
  while (wat[pos] === '(' && ['param', 'result'].includes(readHead(wat, pos))) {
    pos = skipSpace(wat, findMatchingParen(wat, pos) + 1)
  }
  return pos
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
        `${split.funcName} (${split.originalBytes} WAT bytes -> ${split.helperCount} helpers${split.kind ? `, ${split.kind}` : ''})`,
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

async function tool(command) {
  const path = normalizePath(process.env.PATH ?? '')
  for (const dir of path.split(':')) {
    if (dir.length === 0) continue
    const candidate = join(dir, command)
    try {
      await access(candidate, 0o111)
      return candidate
    } catch {
      // Try the next PATH entry.
    }
  }
  return command
}

function normalizePath(path) {
  const home = process.env.HOME
  if (!home) return path
  return path
    .split(':')
    .map((entry) => entry === '~' ? home : entry.startsWith('~/') ? join(home, entry.slice(2)) : entry)
    .join(':')
}

function run(command, args, { capture }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PATH: normalizePath(process.env.PATH ?? '') },
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
