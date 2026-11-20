#!/usr/bin/env node
// Unused-binding check for the coverlane harness.
//
// The repository eslint config only matches `**/*.{ts,tsx}`, so
// `npx eslint tools/thumbnail-benchmark/` exits 0 without inspecting a single
// `.mjs` file (verified with a canary: the same broken code passes as `.mjs` and
// fails as `.ts`). Rather than add a lint config to the repository — which is not
// this task's scope — this script performs the subset that matters for these
// files: an imported binding that is never referenced, and a declared local that
// is never referenced.
//
// It is deliberately conservative: names appearing inside strings, comments or
// template literals still count as uses, so a false "used" is possible but a
// false "unused" is not. That direction is the safe one for a lint substitute.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIRECTORY = process.argv[2] ?? 'tools/thumbnail-benchmark'

/** Strip line and block comments plus string/template literals, keeping length. */
function blankOutLiterals(source) {
  let out = source
  out = out.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  out = out.replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
  // Single and double quoted strings, then template literals (no nesting support,
  // which is acceptable because this only feeds a symbol-mention counter).
  out = out.replace(/'(?:[^'\\\n]|\\.)*'/g, match => ' '.repeat(match.length))
  out = out.replace(/"(?:[^"\\\n]|\\.)*"/g, match => ' '.repeat(match.length))
  out = out.replace(/`(?:[^`\\]|\\.)*`/g, match => ' '.repeat(match.length))
  return out
}

/**
 * Count mentions in the ORIGINAL source, not the stripped one.
 *
 * Template literals matter here: `throw new Error(\`...\n${USAGE}\`)` is a real use
 * of USAGE, and a stripper that blanks template literals would report it unused.
 * So the stripped text is used only to locate declarations and import lists; the
 * mention count runs over the original text. That can produce a false "used" (a
 * name inside a comment) but never a false "unused", which is the safe direction
 * for a lint substitute.
 */
function countMentions(haystack, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g')
  return (haystack.match(pattern) ?? []).length
}

const problems = []
const files = readdirSync(DIRECTORY)
  .filter(name => name.startsWith('coverlane-') && name.endsWith('.mjs'))
  .sort()

for (const file of files) {
  const full = join(DIRECTORY, file)
  const source = readFileSync(full, 'utf8')
  const stripped = blankOutLiterals(source)

  // Imported bindings.
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g
  for (const match of stripped.matchAll(importPattern)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (!name) continue
      // One mention is the import itself; the file needs at least one more.
      if (countMentions(source, name) <= 1) {
        problems.push({ file, name, kind: 'unused import' })
      }
    }
  }

  // Top-level `const x = ` / `let x = ` declarations.
  const declarationPattern = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm
  for (const match of stripped.matchAll(declarationPattern)) {
    const name = match[1]
    if (countMentions(source, name) <= 1) {
      problems.push({ file, name, kind: 'unused top-level binding' })
    }
  }
}

if (problems.length === 0) {
  console.log(JSON.stringify({ ok: true, filesChecked: files.length, problems: [] }, null, 2))
  process.exit(0)
}
console.log(JSON.stringify({ ok: false, filesChecked: files.length, problems }, null, 2))
process.exit(1)
