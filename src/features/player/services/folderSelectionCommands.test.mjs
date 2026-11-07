import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function harness(response) {
  const calls = []
  globalThis.__folderSelectionInvoke = async (command, args) => { calls.push({ command, args }); if (response?.code) throw response; return response }
  let compiled = ts.transpileModule(await readFile(new URL('./audioCommands.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
  compiled = compiled.replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=globalThis.__folderSelectionInvoke;const convertFileSrc=path=>path;')
    .replace(/import \{ listen \} from [^;]+;/, 'const listen=()=>{};')
    .replace(/import \{ AUDIO_PLAYLIST_DURATION_BATCH_LIMIT \} from [^;]+;/, 'const AUDIO_PLAYLIST_DURATION_BATCH_LIMIT=128;')
  assert(!/^import /m.test(compiled), 'only native transport and unrelated duration constant substituted')
  return { calls, api: await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`) }
}

test('get and atomic replace preserve revision, disabled roots and unordered directory rules', async () => {
  const settings = { revision: 4, roots: [{ path: 'D:/Music', selected: false, directoryRules: [{ relativePath: 'Album/Disc', selected: true }, { relativePath: 'Album', selected: false }] }] }
  const h = await harness(settings)
  assert.deepEqual(await h.api.getLibraryFolders(), settings)
  const input = { expectedRevision: 3, roots: settings.roots }
  assert.deepEqual(await h.api.replaceLibraryFolders(input), settings)
  assert.deepEqual(h.calls, [{ command: 'library_get_folders', args: undefined }, { command: 'library_replace_folders', args: { input } }])
})

test('pure folder picker forwards cancel or selected paths without registration or scan commands', async () => {
  for (const response of [null, ['D:/Music']]) {
    const h = await harness(response)
    assert.deepEqual(await h.api.selectLibraryFolders(), response)
    assert.deepEqual(h.calls, [{ command: 'library_select_folders', args: undefined }])
  }
})

test('lazy direct-child command preserves empty leaf and unknown/error child semantics', async () => {
  const input = { rootPath: 'D:/Music', directoryPath: 'D:/Music/Album' }
  const response = { ...input, children: [{ path: 'D:/Music/Album/Empty', name: 'Empty', hasChildren: false }, { path: 'D:/Music/Album/Denied', name: 'Denied', hasChildren: null, readError: { code: 'IO_ERROR', message: 'Denied' } }] }
  const h = await harness(response)
  assert.deepEqual(await h.api.listLibraryFolderDirectories(input), response)
  assert.deepEqual(h.calls, [{ command: 'library_list_folder_directories', args: { input } }])
})

test('CAS conflicts preserve native identity instead of becoming success or empty settings', async () => {
  const conflict = { code: 'LIBRARY_SETTINGS_CONFLICT', message: 'Settings changed' }
  const h = await harness(conflict)
  await assert.rejects(h.api.replaceLibraryFolders({ expectedRevision: 1, roots: [] }), error => error === conflict)
  assert.equal(h.calls.length, 1)
})
