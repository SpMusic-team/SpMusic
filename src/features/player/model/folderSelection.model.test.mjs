import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compiled = ts.transpileModule(await readFile(new URL('./folderSelection.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const { folderSelectionPath, isRootSelectionActive, isDirectorySelected, toggleDirectorySelection, getDirectorySelectionState, projectSelectedFolder } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const rule = (relativePath, selected) => ({ relativePath, selected })
const root = (selected = true, directoryRules = [], path = 'D:/Music') => ({ path, selected, directoryRules })
const raw = (path = 'D:/Music') => ({ sourceKind: 'folder', sourcePath: path, directoryPath: path, sourceName: 'Music', directoryName: 'Music', selectedIndex: 0,
  directoryPaths: [path, `${path}/Album`, `${path}/Album/Disc`, `${path}/Empty`, `${path}/New`],
  tracks: ['root.flac', 'Album/a.flac', 'Album/Disc/deep.flac', 'New/new.flac'].map((relative, index) => ({ id: String(index), sourcePath: `${path}/${relative}`, fileName: relative.split('/').at(-1), available: true })) })

test('path identity normalizes Windows separators and case without merging segment siblings', () => {
  assert.equal(folderSelectionPath('D:\\Music\\Album\\'), 'd:/music/album')
  const selection = root(true, [rule('Album', false)])
  assert.equal(isDirectorySelected(selection, 'ALBUM/Disc'), false)
  assert.equal(isDirectorySelected(selection, 'Album-other'), true)
})

test('nearest ancestor wins regardless of rule order; unenumerated descendants inherit', () => {
  const rules = [rule('Album/Disc/Live', false), rule('Album', false), rule('Album/Disc', true)]
  for (const directoryRules of [rules, [...rules].reverse(), [rules[1], rules[0], rules[2]]]) {
    const selection = root(true, directoryRules)
    assert.equal(isDirectorySelected(selection, 'Album/a-new-directory'), false)
    assert.equal(isDirectorySelected(selection, 'Album/Disc/New'), true)
    assert.equal(isDirectorySelected(selection, 'Album/Disc/Live/New'), false)
    assert.equal(isDirectorySelected(selection, ''), true)
  }
})

test('disabled root can select a grandchild and computes mixed ancestors', () => {
  const selection = root(false, [rule('Album/Disc', true)])
  assert.equal(isRootSelectionActive(selection), true)
  assert.equal(getDirectorySelectionState(selection, ''), 'indeterminate')
  assert.equal(getDirectorySelectionState(selection, 'Album'), 'indeterminate')
  assert.equal(getDirectorySelectionState(selection, 'Album/Disc'), true)
  assert.equal(getDirectorySelectionState(selection, 'Empty'), false)
  assert.deepEqual(projectSelectedFolder(raw(), selection).tracks.map(track => track.fileName), ['deep.flac'])
  assert(projectSelectedFolder(raw(), selection).directoryPaths.includes('D:/Music/Album'), 'unchecked bridge remains navigable to checked descendants')
})

test('parent toggle clears all descendant overrides but preserves independent siblings immutably', () => {
  const original = root(true, [rule('Album', false), rule('Album/Disc', true), rule('Album/Disc/Live', false), rule('Album-other', false)])
  const snapshot = structuredClone(original)
  const changed = toggleDirectorySelection(original, 'Album', true)
  assert.deepEqual(changed.directoryRules, [rule('Album-other', false), rule('Album', true)])
  assert.equal(getDirectorySelectionState(changed, 'Album'), true)
  assert.deepEqual(original, snapshot)
  assert.deepEqual(toggleDirectorySelection(original, '', false), root(false))
  assert.deepEqual(toggleDirectorySelection(original, '', true), root(true))
})

test('projection excludes deselected descendants, neighboring roots, and preserves raw descriptors', () => {
  const source = raw(), snapshot = structuredClone(source)
  source.tracks.push({ id: 'outside', sourcePath: 'D:/Music-else/out.flac', fileName: 'out.flac', available: true })
  snapshot.tracks.push(source.tracks.at(-1))
  const projected = projectSelectedFolder(source, root(true, [rule('Album', false)]))
  assert.deepEqual(projected.tracks.map(track => track.fileName), ['root.flac', 'new.flac'])
  assert(!projected.directoryPaths.includes('D:/Music/Album'))
  assert(projected.directoryPaths.includes('D:/Music/Empty'), 'selected empty directory remains in complete directory metadata')
  assert.deepEqual(source, snapshot)
  assert.equal(projected.tracks[0], source.tracks[0], 'track identity remains stable for queue and metadata cache')
})

test('disabled roots remain representable while exposing no candidates', () => {
  const selection = root(false)
  assert.equal(isRootSelectionActive(selection), false)
  const projected = projectSelectedFolder(raw(), selection)
  assert.deepEqual(projected.tracks, [])
  assert.deepEqual(projected.directoryPaths, [])
  assert.deepEqual(selection, root(false))
})

test('overlapping roots project independent rules and removing a parent preserves child candidates', () => {
  const parent = projectSelectedFolder(raw(), root(true, [rule('Album', false)]))
  const childSelection = root(true, [], 'D:/Music/Album')
  const child = projectSelectedFolder(raw('D:/Music/Album'), childSelection)
  assert(child.tracks.length > 0)
  assert(parent.tracks.every(track => !track.sourcePath.startsWith('D:/Music/Album/')))
  assert.deepEqual(projectSelectedFolder(raw('D:/Music/Album'), childSelection), child)
})

test('drive root and UNC share selection retain descendant containment', () => {
  for (const path of ['D:/', '\\\\server\\share\\Music\\']) {
    const source = raw(path.replace(/[\\/]+$/, ''))
    assert.equal(projectSelectedFolder(source, root(true, [], path)).tracks.length, 4)
  }
})
