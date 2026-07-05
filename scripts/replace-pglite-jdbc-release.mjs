#!/usr/bin/env node

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

const args = parseArgs(process.argv.slice(2))
const jdbcDir = resolve(args['jdbc-dir'] ?? resolve(repoRoot, '../pglite-jdbc'))
const sourceDir = resolve(args.source ?? resolve(repoRoot, 'packages/pglite/release'))
const targetDir = resolve(
  args.target ??
    resolve(
      jdbcDir,
      'src/main/resources/io/github/hidekatsu_izuno/pglite_jdbc/pglite/release',
    ),
)
const dryRun = Boolean(args['dry-run'])

await assertDirectory(sourceDir, 'source release directory')
await replaceWholeRelease()

async function replaceWholeRelease() {
  const sourceFiles = await listFiles(sourceDir)
  const removed = existsSync(targetDir) ? await listFiles(targetDir) : []
  const archives = sourceFiles.filter((file) => file.endsWith('.tar.gz'))
  const copiedFiles = sourceFiles.filter((file) => !file.endsWith('.tar.gz'))

  if (!dryRun) {
    await rm(targetDir, { recursive: true, force: true })
    await mkdir(dirname(targetDir), { recursive: true })
    for (const relPath of copiedFiles) {
      await copyReleaseFile(relPath)
    }
    for (const relPath of archives) {
      await extractReleaseArchive(relPath)
    }
  }

  printSummary({
    copied: copiedFiles,
    extracted: archives,
    removed,
  })
}

async function copyReleaseFile(relPath) {
  const sourcePath = resolve(sourceDir, relPath)
  const targetPath = resolve(targetDir, relPath)
  await mkdir(dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath)
}

async function extractReleaseArchive(relPath) {
  const sourcePath = resolve(sourceDir, relPath)
  const archiveTargetDir = resolve(targetDir, relPath)
  await mkdir(archiveTargetDir, { recursive: true })
  await run('tar', ['-xzf', sourcePath, '-C', archiveTargetDir])
}

async function assertDirectory(dir, label) {
  let stats
  try {
    stats = await stat(dir)
  } catch {
    throw new Error(`${label} does not exist: ${dir}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${dir}`)
  }
}

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, base)))
    } else if (entry.isFile()) {
      files.push(relative(base, fullPath))
    }
  }
  return files.sort()
}

function printSummary({ copied, extracted, removed }) {
  console.log(`source: ${sourceDir}`)
  console.log(`target: ${targetDir}`)
  console.log(`mode: replace${dryRun ? ' dry-run' : ''}`)
  console.log(`copied: ${copied.length}`)
  console.log(`extracted archives: ${extracted.length}`)
  if (removed.length > 0) {
    console.log(`removed before copy: ${removed.length}`)
  }
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`)
    }
    const name = arg.slice(2)
    if (name === 'dry-run') {
      parsed[name] = true
      continue
    }
    const value = argv[++i]
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${name}`)
    }
    parsed[name] = value
  }
  return parsed
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(
          new Error(
            `${command} ${commandArgs.join(' ')} exited with ${code}\n${stderr}`,
          ),
        )
      }
    })
  })
}
