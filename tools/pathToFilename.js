#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dirIndex = args.indexOf('--dir')
if (dirIndex === -1 || !args[dirIndex + 1]) {
  console.error('Usage: node pathToFilename.js --dir <path>')
  process.exit(1)
}

const baseDir = path.resolve(args[dirIndex + 1])

function collectFiles(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...collectFiles(full))
    else if (entry.isFile()) results.push(full)
  }
  return results
}

const files = collectFiles(baseDir)

for (const filePath of files) {
  const rel = path.relative(baseDir, filePath)
  const parts = rel.split(path.sep)

  // ディレクトリを含まない（トップ直下）はスキップ
  if (parts.length === 1) continue

  const ext = path.extname(parts[parts.length - 1])
  const baseName = path.basename(parts[parts.length - 1], ext)
  parts[parts.length - 1] = baseName

  const newName = parts.join('_') + ext
  const newPath = path.join(baseDir, newName)

  if (fs.existsSync(newPath)) {
    console.warn(`SKIP (already exists): ${newPath}`)
    continue
  }

  fs.renameSync(filePath, newPath)
  console.log(`${filePath} → ${newPath}`)
}
