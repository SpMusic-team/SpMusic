import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./quickIndex.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const current = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const oldSource = compiled.replace('naturalCollator.compare(left, right)', 'left.localeCompare(right, undefined, { numeric: true })')
const previous = await import('data:text/javascript;base64,' + Buffer.from(oldSource).toString('base64'))
test('reused collator preserves quick-index ordering across numeric, punctuation, Unicode and equivalent names', () => {
  const names = ['', ' ', '!One', '@Two', '2', '10', 'Album 2', 'Album 10', 'album 02', 'Å', 'Écho', '中文', '日本語', '中文2', '中文10', '😀', 'Zed', 'A', 'a']
  for (const left of names) for (const right of names) {
    assert.equal(Math.sign(current.compareByQuickIndex(left, right)), Math.sign(previous.compareByQuickIndex(left, right)), left + ' / ' + right)
  }
})
