#!/usr/bin/env node
/**
 * Writes SHA256SUMS.txt for the release artifacts in a directory.
 *
 * Why a Node script instead of `sha256sum` + shell globbing in the workflow:
 *   - macOS runners ship `shasum -a 256`, not `sha256sum`;
 *   - `sort -z` / `xargs -0` are not portable to BSD tools;
 *   - artifact names contain spaces ("IPATool GUI-0.1.1-..."), which plain
 *     `xargs` would split.
 * Node is on every runner and the project already requires it, so this is the
 * portable option - and being a real file it can be unit-tested.
 *
 * Usage: node scripts/sha256sums.mjs [directory]   (default: release)
 *
 * The manifest format is the one `sha256sum -c` expects: "<hex><2 spaces><name>".
 * Names are relative to the directory so the file verifies from inside it.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Artifact extensions that ship to users. Intermediate build output is skipped. */
const ARTIFACT_SUFFIXES = ['.exe', '.dmg', '.app.tar.gz', '.AppImage', '.deb', '.zip']

export const MANIFEST_NAME = 'SHA256SUMS.txt'

/**
 * True when `name` looks like a publishable artifact.
 *
 * Matched on the full suffix, so `.app.tar.gz` is not mistaken for a random
 * archive and `builder-effective-config.yaml` is not picked up.
 */
export function isArtifact(name) {
  const lower = name.toLowerCase()
  return ARTIFACT_SUFFIXES.some((suffix) => lower.endsWith(suffix.toLowerCase()))
}

/** Hashes a file with SHA-256. Streaming keeps memory flat for large installers. */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Builds the manifest text for `dir`.
 *
 * Returns an empty string when there is nothing to checksum: the caller decides
 * whether that is an error (in CI it is - an empty manifest would silently
 * publish an unverifiable release).
 */
export async function buildManifest(dir) {
  const entries = await readdir(dir)
  const files = entries.filter(isArtifact).sort()

  const lines = []
  for (const name of files) {
    const full = path.join(dir, name)
    const info = await stat(full)
    if (!info.isFile()) continue
    lines.push(`${await hashFile(full)}  ${name}`)
  }
  return lines.length === 0 ? '' : lines.join('\n') + '\n'
}

/** Writes the manifest into `dir`. Returns the line count written. */
export async function writeManifest(dir) {
  const text = await buildManifest(dir)
  if (text === '') return 0
  await writeFile(path.join(dir, MANIFEST_NAME), text, 'utf8')
  return text.trimEnd().split('\n').length
}

/** True when this file was invoked directly rather than imported by a test. */
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const dir = process.argv[2] ?? 'release'
  let count
  try {
    count = await writeManifest(dir)
  } catch (error) {
    // A missing directory is a deployment mistake, not a reason to dump a stack
    // trace: report it the way the workflow can annotate it.
    const message = error instanceof Error ? error.message : String(error)
    console.error(`::error::cannot checksum ${dir}: ${message}`)
    process.exit(1)
  }
  if (count === 0) {
    console.error(`::error::no release artifacts to checksum in ${dir}`)
    process.exit(1)
  }
  console.log(`wrote ${path.join(dir, MANIFEST_NAME)} (${count} artifact(s))`)
}
