// Real PlayerShell with controlled track-cover IPC responses.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
function dependency(name) {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, name)
  return match[1]
}

const source = readFileSync(new URL('./artistLibrary.browser.test.mjs', import.meta.url), 'utf8')
const literal = source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse the actual shell native transport fixture')
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC3sAAAAASUVORK5CYII='
const descriptorAnchor = 'const descriptor='
const backendAnchor = 'const input=args?.input;window.calls.push({command,input,args});'
const fixtureSource = runInNewContext(literal[1], { dependency })
assert(fixtureSource.includes(descriptorAnchor) && fixtureSource.includes(backendAnchor), 'fixture edit anchors')
const fixture = fixtureSource
  .replace(descriptorAnchor, `roots.splice(0, roots.length, '/music');
rows.splice(0, rows.length, ...Array.from({length:8}, (_, group) =>
  Array.from({length:group<4 ? 3 : 1}, (_, candidate) => {
    const name='A0'+group;
    return [name+'-'+candidate, '/music/'+name+'/'+candidate+'.flac', name, name, name];
  })).flat());
window.coverQueries=[];
const blockedArtwork=new Promise(resolve=>{window.releaseArtwork=resolve});
const descriptor=`)
  .replace(backendAnchor, `${backendAnchor}
if(command==='audio_playlist_decode_permit_width')return 4;
if(command==='audio_load_track_thumbnail_path'){
  const path=input.sourcePath;
  window.coverQueries.push(path);
  if(/^\\/music\\/A0[0-3]\\/0\\.flac$/.test(path))return null;
  if(/^\\/music\\/A0[0-3]\\/1\\.flac$/.test(path)){await blockedArtwork;return null;}
  return {path:${JSON.stringify(image)}+'#'+encodeURIComponent(path),width:1,height:1,byteLength:70};
}`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'), 'install isolated native command stubs')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__category_fairness_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^"]+"/, 'src="/__category_fairness_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
try {
  for (const category of ['album', 'artist']) {
    const page = await browser.newPage({ viewport: { width: 1560, height: 1400 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(12000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const assets = {
      '**/src/features/player/services/audioCommands.ts*': service,
      '**/src/features/player/components/PlayerSurface.tsx*': surface,
      '**/__category_fairness_surface.js': realSurface,
      '**/__category_fairness_fixture.js': fixture,
    }
    for (const [url, body] of Object.entries(assets)) {
      await page.route(url, route => route.fulfill({ contentType: 'text/javascript', body }))
    }
    await page.route('**/__category_fairness_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
    await page.goto(origin + '/__category_fairness_test?cover=1')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 16 && !window.vm.playlist.library.isImportPending)
    await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)

    // Four early visible collections hit confirmed misses. Their second probes
    // stay blocked while later visible collections already have a cover.
    const cover = name => page.locator('.album-library-content:not([inert]) .album-card')
      .filter({ has: page.getByText(name, { exact: true }) }).locator('img.folder-cover-image')
    const sourceFor = (group, candidate) => '/music/A0' + group + '/' + candidate + '.flac'
    async function expectCover(group, candidate) {
      const candidateImage = cover('A0' + group)
      await candidateImage.waitFor()
      await candidateImage.evaluate(element => element.decode())
      assert((await candidateImage.getAttribute('src')).endsWith('#' + encodeURIComponent(sourceFor(group, candidate))), 'uses the correct track cover')
    }
    for (let group = 4; group < 8; group++) await expectCover(group, 0)
    assert.equal(await cover('A00').count(), 0, 'later cards paint before a blocked deep scan')
    const early = await page.evaluate(() => window.coverQueries.slice(0, 8))
    assert.deepEqual(new Set(early), new Set(Array.from({ length: 8 }, (_, group) => sourceFor(group, 0))),
      'each visible collection gets a first probe before any continuation')
    await page.evaluate(() => window.releaseArtwork())
    for (let group = 0; group < 4; group++) {
      await expectCover(group, 2)
      const pathPrefix = '/music/A0' + group + '/'
      const attempts = await page.evaluate(prefix => window.coverQueries.filter(path => path.startsWith(prefix)), pathPrefix)
      assert.deepEqual(attempts, [sourceFor(group, 0), sourceFor(group, 1), sourceFor(group, 2)], 'tries each source once in collection order')
    }
    assert.deepEqual(errors, [])
    console.log('PASS', category, 'visible first probes and ordered candidate continuation')
    await page.close()
  }
} finally {
  await browser.close()
}

