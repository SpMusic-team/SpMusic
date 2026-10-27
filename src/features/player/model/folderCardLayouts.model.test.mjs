import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function loadModel(name) {
  const source = await readFile(new URL(name, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}
const { FOLDER_CARD_LAYOUTS: folders } = await loadModel('./folderCardLayouts.ts')
const { PLAYLIST_SONG_LAYOUTS: songs } = await loadModel('./playlistSongLayouts.ts')

test('folder variants keep the existing song gesture slots and artwork boundaries', () => {
  assert.equal(folders.length, songs.length)
  for (const [level, folder] of folders.entries()) {
    assert.equal(folder.level, level)
    assert.equal(folder.flow, songs[level].flow)
    assert.equal(folder.coverWidth > 0, songs[level].showArtwork)
  }
})

test('tile cards preserve square cover slots, badge sizes and field visibility', () => {
  assert.deepEqual(folders.slice(0, 3).map(item => [item.coverWidth, item.coverHeight, item.cardWidth, item.folderGlyph]), [
    [240, 240, 270, 28], [155, 155, 185, 24], [120, 120, 130, 16],
  ])
  assert(folders.slice(0, 3).every(item => item.showParent && !item.showStatistics))
})

test('row and text variants select their own grouping rather than inheriting song text geometry', () => {
  assert.deepEqual(folders.slice(3, 7).map(item => [item.variant, item.coverWidth, item.coverHeight, item.folderGlyph]), [
    ['row-wide', 240, 165, 48], ['row-wide', 155, 107, 48],
    ['row-compact', 64, 64, 32], ['text-two-line', 0, 0, 32],
  ])
  assert(folders.slice(7).every(item => !item.showParent && item.showStatistics && item.folderGlyph === 16))
  assert.equal(folders[9].cardWidth, 270)
})
