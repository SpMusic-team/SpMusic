// Independent acceptance: actual PlayerShell, simulated existing native transport.
// Requires Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__year_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;let viewModel=new URLSearchParams(location.search).has('indexLocal')?{...props.viewModel,search:undefined}:props.viewModel;if(new URLSearchParams(location.search).has('playlistReference'))viewModel={...viewModel,playlist:{...viewModel.playlist,tracks:(viewModel.playlist.library.allSongs??[]).slice(0,3).map(item=>item.track),metadataStatus:'ready',library:{...viewModel.playlist.library,isOpen:false}}};return React.createElement(RealSurface,{...props,viewModel})}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.scanGate=new URLSearchParams(location.search).has('scanGate');window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingScans=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/music/Mixed','/external','/empty','/hidden'];
const rows=[
 ['mixed-a','/music/Mixed/a.flac','Mixed','Ensemble',2018],
 ['mixed-b','/music/Mixed/b.flac','Mixed','Ensemble',2019],
 ['mixed-c','/external/Mixed/c.flac','Mixed','Ensemble',null],
 ['solo','/music/Solo/solo.flac','Solo','Solo',2018],
 ['modern','/music/Modern/modern.flac','Modern','Modern',2026],
 ['older','/music/Older/older.flac','Older','Older',2017],
 ['unknown','/music/Unknown/unknown.flac','Unknown','Unknown',null],
 ['invalid','/music/Invalid/invalid.flac','Invalid','Invalid',0],
 ['bad','/music/Bad/bad.flac','Bad','Bad',2025],
 ['hidden','/hidden/hidden.flac','Hidden','Hidden',2027]
];
const mixedArtists=new URLSearchParams(location.search).has('mixedArtists');
if(mixedArtists)rows.splice(0,rows.length,
 ['martyr','/music/Mentalmeisters - 殉道者.flac','《明日方舟》游戏原声OST','Mentalmeisters',2022],
 ['nightfall','/music/塞壬唱片-MSR - 夜幕.mp3','《明日方舟》游戏原声OST','塞壬唱片-MSR',null]);
const indexSize=Number(new URLSearchParams(location.search).get('indexSize'));
if(indexSize)rows.splice(0,rows.length,...Array.from({length:indexSize},(_,i)=>['index-'+i,'/music/Index/'+i+'.flac','Index Album','Ensemble',2022,i===0?'0 Number':i===indexSize-1?'中文尾曲':(i<indexSize/3?'Alpha ':i<indexSize*2/3?'Middle ':'Zulu ')+String(i).padStart(3,'0')]));
if(new URLSearchParams(location.search).has('inheritOnly'))rows.splice(0,rows.length,...rows.filter(row=>['mixed-a','mixed-c'].includes(row[0])));
window.summaryYears=Object.fromEntries(rows.map(row=>[row[0],row[4]]));
if(new URLSearchParams(location.search).has('inheritOnly'))window.summaryYears['mixed-a']=null;
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor),all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path),tags=rows.find(value=>value[1]===path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:tags[5]??'Title '+row.id,artist:mixedArtists?tags[3]:'Singer '+tags[3],album:tags[2],albumArtist:mixedArtists?null:tags[3],genre:null,year:1999,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));return folder(args.path)}
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_folder_thumbnail')return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);if(item.id==='bad')return {sourcePath,summary:null,error:{code:'DECODE_FAILED',message:'Unreadable tags',recoverable:true}};return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,year:window.summaryYears[item.id],bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__year_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce' })
page.setDefaultTimeout(15000)
const errors = [], consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__year_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__year_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__year_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
  if (new URLSearchParams(location.search).has('indexSize')) localStorage.setItem('spmusic.year-songs.sort.v1', JSON.stringify({ field: 'title', direction: 'asc' }))
  if (new URLSearchParams(location.search).has('entryHover')) {
    for (const scope of ['year-albums', 'artist-albums', 'album-artist-albums', 'composer-albums']) localStorage.setItem('spmusic.' + scope + '.layout-level.v1', new URLSearchParams(location.search).get('entryLevel') ?? '5')
  }
  if (new URLSearchParams(location.search).has('playlistReference')) localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
})
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }
const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const active = () => page.locator('.album-library-content:not([inert])')
const songs = () => active().locator('.album-songs .playlist-card[data-song-key]')
const songNames = () => songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1)).sort())
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id).sort())
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const backFromPlayer = async () => {
  await page.evaluate(() => window.vm.playlist.onOpenChange(false)); await page.waitForFunction(() => !window.vm.playlist.isOpen)
  await page.evaluate(() => window.vm.playlist.onOpenChange(true)); await page.waitForFunction(() => window.vm.playlist.isOpen)
}
const up = async () => {
  await active().locator('.playlist-hero-category').click()
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content:not([inert])').length === 1)
}
const years = () => active().locator('.year-card[data-year-key]')
const year = value => years().filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + value + '$') }) })
const albums = () => active().locator('.album-card:not(.year-card)')
const album = name => albums().filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + name + '$') }) })
const view = async expected => { await active().waitFor(); await page.waitForFunction(expected => document.querySelector('.album-library-content:not([inert])')?.dataset.yearView === expected, expected) }
const sort = async (scope, fieldLabel, directionLabel, value) => {
  await active().locator('.playlist-hero-more-button').first().click()
  await page.getByRole('dialog').getByRole('button', { name: '重新排序', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '年份排序', exact: true })
  await dialog.waitFor()
  await dialog.getByRole('combobox', { name: '排序依据', exact: true }).click()
  await page.getByRole('option', { name: fieldLabel, exact: true }).click()
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).click()
  await page.getByRole('option', { name: directionLabel, exact: true }).click()
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(scope => JSON.parse(localStorage.getItem('spmusic.year-' + scope + '.sort.v1')), scope), value)
}
const search = async query => {
  const box = page.getByRole('searchbox')
  if (!await box.count()) await active().locator('.playlist-search-button').click()
  await page.getByRole('searchbox').fill(query)
}
const clearSearch = async () => {
  await page.evaluate(() => window.vm.search.onOpenChange(false))
  await page.locator('.search-page').waitFor({ state: 'hidden' })
}
const verifyRootDesign = async () => {
  await page.waitForFunction(() => {
    const row = document.querySelector('.album-library-content:not([inert]) .year-card'), cover = row?.querySelector('.folder-cover')
    return row && cover && Math.abs(row.getBoundingClientRect().height - 88) < .001 && Math.abs(cover.getBoundingClientRect().width - 64) < .001
  })
  for (const file of ['1fed4.svg', '36e6f.svg', '1e93b.svg']) assert(statSync(new URL('../../../assets/year-library/' + file, import.meta.url)).size > 0)
  const design = await active().evaluate(async node => {
    const read = selector => {
      const element = node.querySelector(selector), rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      const pixel = value => Math.round(value * 100) / 100
      return { x: pixel(rect.x), y: pixel(rect.y), width: pixel(rect.width), height: pixel(rect.height), size: style.fontSize, line: style.lineHeight, radius: style.borderRadius, mask: style.maskImage, src: element.getAttribute('src') }
    }
    const urls = await Promise.all(['1fed4.svg', '36e6f.svg', '1e93b.svg'].map(async file => (await import('/src/assets/year-library/' + file + '?import')).default))
    return { title: read('.playlist-management-heading h2'), category: read('.playlist-management-category'), glyph: read('.media-library-category-glyph'),
      more: read('.playlist-management-selection-more .playlist-hero-more-button'), moreIcon: read('.playlist-management-selection-more img'),
      row: read('.year-card'), cover: read('.year-card .folder-cover'), name: read('.year-card .folder-name'), music: read('.year-card-music'), urls }
  })
  assert.deepEqual([design.category.width, design.category.height, design.glyph.width, design.glyph.height], [84, 84, 48, 48])
  assert.deepEqual([design.more.width, design.more.height, design.moreIcon.width, design.moreIcon.height], [64, 64, 48, 48])
  assert.deepEqual([design.row.height, design.cover.width, design.cover.height, design.cover.radius], [88, 64, 64, '20px'])
  assert.deepEqual([design.title.size, design.title.line, design.name.size, design.name.line], ['57px', '64px', '24px', '32px'])
  assert.deepEqual([design.music.width, design.music.height], [16, 16])
  assert(design.glyph.mask.includes(design.urls[0]) && design.music.mask.includes(design.urls[1]) && design.moreIcon.src === design.urls[2], 'exact local static assets occupy their design slots')
  assert.equal(design.name.x - (design.cover.x + design.cover.width), 24)
  if ((Number(process.env.SPMUSIC_TEST_WIDTH) || 640) === 640) {
    assert.equal(design.cover.x, 25); assert.equal(design.cover.y, 364)
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'root has no horizontal overflow')
  const geometry = Object.fromEntries(Object.entries(design).filter(([name]) => name !== 'urls').map(([name, value]) => [name, Object.fromEntries(Object.entries(value).filter(([property]) => !['mask', 'src'].includes(property)))]))
  console.log('YEAR_ROOT_GEOMETRY', JSON.stringify(geometry))
}
const heroGeometry = async () => active().evaluate(node => {
  const rect = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
  const hero = node.querySelector(':scope > .playlist-hero')
  return { hero: rect(hero), panel: rect(node), copy: rect(hero.querySelector('.playlist-hero-copy')),
    title: rect(hero.querySelector('.playlist-hero-title')), meta: rect(hero.querySelector('.playlist-hero-meta')),
    actions: rect(hero.querySelector('.playlist-hero-actions')), icon: rect(hero.querySelector('.playlist-hero-meta svg')),
    sidebar: [...document.querySelectorAll('.playlist-library-sidebar:not([data-overlay="true"])')].some(element => element.getBoundingClientRect().width > 0) }
})
const verifyYearAlbumHero = geometry => {
  assert(Math.abs(geometry.meta.x - geometry.title.x) < 1, 'year statistics align with the year title left edge')
  assert(Math.abs(geometry.meta.x - geometry.copy.x) < 1, 'year statistics align with the copy left edge')
  assert(geometry.meta.y >= geometry.title.bottom && geometry.meta.bottom <= geometry.actions.y, 'statistics sit between the title and actions without overlap')
  assert(Math.abs(geometry.icon.y + geometry.icon.height / 2 - geometry.meta.y - geometry.meta.height / 2) < 1, 'music icon remains vertically centered within the statistics strip')
}
const verifyHeroPair = (albums, songs) => {
  for (const property of ['x', 'width', 'height']) assert(Math.abs(albums.hero[property] - songs.hero[property]) < 1, 'year album and song heroes share ' + property)
  assert.equal(albums.sidebar, songs.sidebar, 'comparison retains the same sidebar condition')
  assert.equal(songs.sidebar, page.viewportSize().width > 1024, 'exercise both compact layout and desktop sidebar')
  console.log('YEAR_CHILD_HERO_GEOMETRY', JSON.stringify({ viewport: page.viewportSize(), albums, songs }))
}
const verifyYearContent = async () => {
  const geometry = await active().evaluate(node => {
    const read = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height } }
    const entry = node.querySelector('.year-all-songs .artist-all-songs-cover')
    return { view: node.dataset.yearView, hero: read(node.querySelector(':scope > .playlist-hero')),
      grid: read(node.querySelector('.album-list, .album-songs')),
      cover: read(node.querySelector('.album-list .folder-cover, .album-songs .playlist-card-cover')),
      copies: [...node.querySelectorAll('.album-list .folder-copy, .album-songs .playlist-card-copy')].map(read),
      entry: read(entry), radius: entry ? parseFloat(getComputedStyle(entry).borderTopLeftRadius) : null }
  })
  assert(Math.abs(geometry.cover.x - geometry.hero.x) < 1, 'first visible cover aligns with the hero outer left edge')
  for (const copy of geometry.copies) assert(copy.x >= geometry.hero.x - 1 && copy.right <= geometry.hero.right + 1, 'visible text area stays inside the hero horizontal boundaries')
  if (geometry.entry) {
    assert(Math.abs(geometry.entry.x - geometry.hero.x) < 1, 'all-year-song entry cover aligns with hero outer edge')
    assert.equal(geometry.entry.width, geometry.entry.height, 'entry artwork remains square')
    assert(geometry.radius > 0 && geometry.radius < geometry.entry.width / 2, 'entry artwork is a rounded square rather than a circle')
  }
  console.log('YEAR_CONTENT_GEOMETRY', JSON.stringify({ viewport: page.viewportSize(), ...geometry }))
}

try {
  if (process.env.SPMUSIC_TEST_ENTRY_HOVER || process.env.SPMUSIC_TEST_MEDIUM_ROW || process.env.SPMUSIC_TEST_ROW_MATRIX || process.env.SPMUSIC_TEST_ENTRY_GAP) {
    const mediumRow = Boolean(process.env.SPMUSIC_TEST_MEDIUM_ROW)
    const rowMatrix = Boolean(process.env.SPMUSIC_TEST_ROW_MATRIX)
    const entryGap = Boolean(process.env.SPMUSIC_TEST_ENTRY_GAP), yearGaps = new Map()
    const scenarios = entryGap ? [[640, 3], [1440, 3], [1440, 4]] : rowMatrix ? [[640, 3], [1440, 3], [1440, 4], [1440, 5]] : [640, 1440].map(width => [width, mediumRow ? 4 : 5])
    for (const [width, rowLevel] of scenarios) {
      await page.setViewportSize({ width, height: 1100 })
      if (mediumRow) {
        await page.goto(origin + '/__year_test?playlistReference=1')
        await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
        const playlist = page.locator('.playlist-panel:not([inert])')
        await playlist.locator('.playlist-card').first().waitFor()
        const reference = await playlist.evaluate(node => { const hero = node.querySelector('.playlist-hero').getBoundingClientRect(), row = node.querySelector('.playlist-card').getBoundingClientRect(), cover = node.querySelector('.playlist-card-cover').getBoundingClientRect(); return { level: node.querySelector('.playlist-grid').dataset.layoutLevel, hero: { x: hero.x, right: hero.right }, row: { x: row.x, right: row.right }, cover: { x: cover.x } } })
        console.log('REAL_PLAYLIST_ROW_REFERENCE', JSON.stringify({ width, ...reference }))
        assert.equal(reference.level, '4')
        assert(Math.abs(reference.hero.x - reference.row.x) < 1 && Math.abs(reference.hero.right - reference.row.right) < 1, 'actual PlaylistPanel row outer frame aligns to hero')
        assert(reference.cover.x > reference.row.x, 'actual playlist artwork is inset inside its hover frame')
        await screenshot('playlist-medium-row-reference-' + width)
      }
      await page.goto(origin + '/__year_test?entryHover=1&entryLevel=' + rowLevel)
      await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
      for (const [category, name] of (entryGap && rowLevel !== 3 ? [['artist', 'Singer Ensemble']] : rowMatrix && rowLevel !== 3 ? [['year', '2018'], ['artist', 'Singer Ensemble']] : [['year', '2018'], ['artist', 'Singer Ensemble'], ['album-artist', 'Ensemble'], ['composer', '未知作曲家']])) {
        await selectCategory(category)
        await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
        if (category === 'year') { await year(name).click(); await view('albums') }
        else await active().locator('.artist-card').filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + name + '$') }) }).click()
        const entry = active().locator('.artist-all-songs')
        const row = albums().first()
        await entry.waitFor(); await row.waitFor()
        const measure = element => {
          const r = element.getBoundingClientRect(), style = getComputedStyle(element), cover = element.querySelector('.folder-cover, .artist-all-songs-cover'), c = cover?.getBoundingClientRect()
          return { x: r.x, right: r.right, width: r.width, radius: style.borderRadius, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], color: style.backgroundColor, outline: [style.outlineWidth, style.outlineStyle, style.outlineOffset], focused: element.matches(':focus-visible'), cover: c ? { x: c.x, width: c.width, height: c.height, radius: getComputedStyle(cover).borderRadius } : null }
        }
        await row.hover(); await row.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
        const rowHover = await row.evaluate(measure)
        await entry.hover(); await entry.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
        const entryHover = await entry.evaluate(measure)
        console.log('ALL_SONGS_ENTRY_HOVER', JSON.stringify({ width, rowLevel, category, row: rowHover, entry: entryHover }))
        if (entryGap) {
          const gap = await active().evaluate(node => node.querySelector('.artist-all-songs').getBoundingClientRect().top - node.querySelector(':scope > .playlist-hero').getBoundingClientRect().bottom)
          if (category === 'year') yearGaps.set(width, gap)
          assert(yearGaps.get(width) > 0, 'year entry establishes a positive reference gap')
          assert(Math.abs(gap - yearGaps.get(width)) < 1, category + ' hero-to-entry gap matches the year page')
          console.log('ALL_SONGS_ENTRY_GAP', JSON.stringify({ width, rowLevel, category, gap, yearReference: yearGaps.get(width) }))
        }
        {
          assert.equal(await active().locator('.album-list').getAttribute('data-folder-level'), String(rowLevel), 'requested artwork row layout is selected')
          assert.equal(await row.getAttribute('data-folder-variant'), rowLevel === 5 ? 'row-compact' : 'row-wide')
          assert.equal(await row.getAttribute('data-folder-size'), { 3: 'large', 4: 'medium', 5: 'small' }[rowLevel])
          const hero = await active().locator(':scope > .playlist-hero').evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right } })
          assert(Math.abs(rowHover.x - hero.x) < 1 && Math.abs(rowHover.right - hero.right) < 1, category + ' row hover outer frame aligns to hero')
          assert(Math.abs(rowHover.cover.x - rowHover.x - 15) < 1 && Math.abs(entryHover.cover.x - entryHover.x - 15) < 1, 'artwork stays within the 15px row hover frame padding')
        }
        for (const property of ['x', 'right', 'width']) assert(Math.abs(rowHover[property] - entryHover[property]) < 1, category + ' entry hover shares album row ' + property)
        assert.equal(entryHover.radius, rowHover.radius, category + ' entry hover has the album row corner radius')
        assert.deepEqual(entryHover.padding, rowHover.padding, category + ' entry hover uses the same internal spacing')
        assert.equal(entryHover.color, rowHover.color, category + ' hover background matches album row')
        if (category === 'year') {
          const heroX = await active().locator(':scope > .playlist-hero').evaluate(element => element.getBoundingClientRect().x)
          assert(Math.abs(entryHover.x - heroX) < 1, 'year artwork-row entry outer frame aligns with hero')
          assert.equal(entryHover.cover.width, entryHover.cover.height)
          assert(parseFloat(entryHover.cover.radius) < entryHover.cover.width / 2, 'year artwork remains a rounded square')
        }
        const prefix = entryGap ? 'gap-row-' + rowLevel + '-' : rowMatrix ? 'row-' + rowLevel + '-' : mediumRow ? 'medium-' : ''
        await screenshot(prefix + 'entry-hover-' + category + '-' + width)
        await page.mouse.move(1, 1); await page.keyboard.press('Tab'); await row.focus()
        await row.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
        const rowFocus = await row.evaluate(measure)
        await entry.focus(); await entry.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
        const entryFocus = await entry.evaluate(measure)
        assert(rowFocus.focused && entryFocus.focused, 'both controls expose keyboard focus')
        assert.deepEqual(entryFocus.outline, rowFocus.outline, 'entry focus outline uses album row treatment')
        await screenshot(prefix + 'entry-focus-' + category + '-' + width)
        await entry.press('Enter'); await songs().first().waitFor()
        assert(await songs().count() > 0, category + ' entry still opens its song scope')
        if (category === 'year') await view('songs')
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
    console.log('year library: four all-song entry hover/focus boundaries and navigation passed')
  } else if (process.env.SPMUSIC_TEST_QUICK_INDEX) {
    for (const [width, count] of [[640, 12], [1440, 600]]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(origin + '/__year_test?indexLocal=1&indexSize=' + count)
      await page.waitForFunction(count => window.vm?.playlist.library.allSongs.length === count, count)
      await selectCategory('year')
      await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
      await year('2022').click(); await view('albums')
      assert.equal(await active().locator('.year-all-songs .artist-all-songs-title').innerText(), '所有年份歌曲')
      await active().locator('.year-all-songs').click(); await view('songs'); await songs().first().waitFor()
      assert.equal(await active().locator('.playlist-hero-title').innerText(), '所有年份歌曲')
      const rail = page.getByRole('navigation', { name: '歌曲快速查找', exact: true })
      assert.equal(await rail.count(), 1, 'year songs render the shared song quick index')
      if (count > 100) assert(await songs().count() < count, 'large fixture exercises actual windowed rendering')
      const jump = async (label, title, keyboard = false) => {
        const button = rail.getByRole('button', { name: label, exact: true })
        if (keyboard) { await button.focus(); await button.press('Enter') } else await button.click()
        await page.waitForFunction(title => {
          const panel = document.querySelector('.album-library-content:not([inert])'), bounds = panel.getBoundingClientRect()
          const bottom = Math.min(bounds.bottom, document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')?.getBoundingClientRect().top ?? bounds.bottom)
          const row = [...panel.querySelectorAll('.playlist-card-title')].find(element => element.textContent === title)?.closest('.playlist-card')
          const rect = row?.getBoundingClientRect()
          return rect && rect.top >= bounds.top - 1 && rect.top < bottom && rect.bottom > bounds.top
        }, title)
      }
      await jump('查找 M 开头的歌曲', 'Middle ' + String(count / 3).padStart(3, '0'))
      const middle = await active().evaluate(element => element.scrollTop)
      assert(middle > 100, 'letter jump scrolls the actual song viewport')
      await rail.getByRole('button', { name: '查找 B 开头的歌曲', exact: true }).click()
      assert.equal(await active().evaluate(element => element.scrollTop), middle, 'an absent initial does not redirect to an unrelated song')
      await jump('查找 Z 开头的歌曲', 'Zulu ' + String(count * 2 / 3).padStart(3, '0'), true)
      await jump('查找其他字符开头的歌曲', '中文尾曲')
      await screenshot('year-song-index-' + width)
      await rail.getByRole('button', { name: '返回列表顶部', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.album-library-content:not([inert])').scrollTop === 0)
      await jump('查找数字开头的歌曲', '0 Number')
      await sort('songs', '歌曲名称', '降序', { field: 'title', direction: 'desc' })
      await jump('查找 M 开头的歌曲', 'Middle ' + String(count * 2 / 3 - 1).padStart(3, '0'))
      await active().locator('.playlist-search-button').click()
      const localSearch = active().getByRole('searchbox')
      await localSearch.fill('Zulu')
      await jump('查找 Z 开头的歌曲', 'Zulu ' + String(count - 2).padStart(3, '0'))
      assert((await songs().locator('.playlist-card-title').allTextContents()).every(title => title.startsWith('Zulu')), 'quick index follows the filtered song scope')
      await localSearch.fill('no-such-song')
      await page.waitForFunction(() => !document.querySelector('.album-library-content:not([inert]) .playlist-card[data-song-key]'))
      await rail.getByRole('button', { name: '查找 Z 开头的歌曲', exact: true }).click()
      await rail.getByRole('button', { name: '返回列表顶部', exact: true }).click()
      assert.equal(await songs().count(), 0, 'empty-filter index actions cannot resurrect songs')
      await localSearch.fill(''); await localSearch.press('Escape')
      console.log('YEAR_SONG_QUICK_INDEX', JSON.stringify({ width, count, rendered: await songs().count(), middleScroll: middle }))
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
    console.log('year library: all-year-song labels and actual song quick-index navigation passed')
  } else if (process.env.SPMUSIC_TEST_SIDEBAR) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(origin + '/__year_test?sidebar=1')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
    await selectCategory('album')
    for (const [index, target] of ['year', 'composer', 'genre', 'year', 'year'].entries()) {
      const nav = page.locator('.playlist-library-sidebar:not([inert]):visible .playlist-library-categories').last()
      const requested = await nav.evaluate((element, id) => {
        const button = element.querySelector('[data-category-id="' + id + '"]')
        element.scrollTop += button.getBoundingClientRect().top - element.getBoundingClientRect().top - 80
        window.previousSidebarNav = element
        return element.scrollTop
      }, target)
      assert(requested > 0, 'test begins with a scrolled category list')
      const button = nav.locator('[data-category-id="' + target + '"]')
      if (index % 2) { await button.focus(); assert(await button.evaluate(element => element === document.activeElement), 'sidebar category remains keyboard-focusable') }
      else await button.click({ trial: true })
      const before = await nav.evaluate(element => { element.addEventListener('click', () => { window.sidebarClickScroll = element.scrollTop }, { capture: true, once: true }); return element.scrollTop })
      assert(before > 0, 'real input starts after browser actionability scrolling with a nonzero position')
      if (index % 2) await button.press('Enter')
      else await button.click()
      await page.waitForFunction(target => window.vm.playlist.library.route.categoryId === target, target)
      await page.waitForFunction(() => document.querySelectorAll('.playlist-library-sidebar:not([inert]) .playlist-library-category[aria-current="page"]').length === 1)
      const after = await page.locator('.playlist-library-sidebar:not([inert]):visible .playlist-library-categories').last().evaluate(element => element.scrollTop)
      console.log('SIDEBAR_SCROLL_GEOMETRY', JSON.stringify({ target, requested, before, click: await page.evaluate(() => window.sidebarClickScroll), after }))
      assert(Math.abs(before - after) < 1, 'category navigation preserves the scrolled sidebar position')
      if (index < 4) {
        const late = await page.evaluate(() => { const old = window.previousSidebarNav; const current = [...document.querySelectorAll('.playlist-library-sidebar:not([inert]) .playlist-library-categories')].at(-1); if (old === current) return 'same-node'; const connected = old.isConnected; old.scrollTop = 0; old.dispatchEvent(new Event('scroll', { bubbles: true })); return connected ? 'exiting-node' : 'detached-node' })
        assert.equal(await page.locator('.playlist-library-sidebar:not([inert]):visible .playlist-library-categories').last().evaluate(element => element.scrollTop), after, 'late departing-node scroll cannot move the active sidebar')
        console.log('SIDEBAR_LATE_EVENT', JSON.stringify({ target, late }))
      }
      await screenshot('sidebar-' + target)
    }
    const desktopNav = () => page.locator('.playlist-library-sidebar:not([inert]):visible .playlist-library-categories').last()
    const desktopPosition = await desktopNav().evaluate(element => element.scrollTop)
    await year('2018').click(); await view('albums'); await active().locator('.year-all-songs').click(); await view('songs')
    const mainScroll = await active().evaluate(element => { element.scrollTop = 150; return element.scrollTop })
    assert(mainScroll > 0, 'main content actually scrolls in the test')
    assert.equal(await desktopNav().evaluate(element => element.scrollTop), desktopPosition, 'main content scroll does not move the category list')
    await desktopNav().evaluate(element => { element.scrollTop = 200 })
    assert.equal(await active().evaluate(element => element.scrollTop), mainScroll, 'category scroll does not move the main content')
    await page.setViewportSize({ width: 640, height: 1000 })
    await page.locator('#playlist-library-menu').click()
    const overlay = page.locator('.playlist-library-dialog .playlist-library-categories')
    await overlay.waitFor()
    assert.equal(await overlay.evaluate(element => element.scrollTop), 0, 'overlay does not borrow desktop position')
    await overlay.evaluate(element => { const button = element.querySelector('[data-category-id="composer"]'); element.scrollTop += button.getBoundingClientRect().top - element.getBoundingClientRect().top - 80 })
    await overlay.locator('[data-category-id="composer"]').click({ trial: true })
    const overlayPosition = await overlay.evaluate(element => element.scrollTop)
    await overlay.locator('[data-category-id="composer"]').click()
    await page.waitForFunction(() => window.vm.playlist.library.route.categoryId === 'composer')
    await page.locator('.playlist-library-dialog').waitFor({ state: 'hidden' })
    await page.locator('#playlist-library-menu').click(); await overlay.waitFor()
    assert.equal(await overlay.evaluate(element => element.scrollTop), overlayPosition, 'overlay retains its own position across classification changes')
    await page.keyboard.press('Escape'); await page.locator('.playlist-library-dialog').waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    assert.equal(await desktopNav().evaluate(element => element.scrollTop), 200, 'desktop position returns after an overlay category remount while desktop was hidden')
    await screenshot('sidebar-return-desktop')
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
    console.log('year library: sidebar scroll retention passed')
  } else if (process.env.SPMUSIC_TEST_GEOMETRY) {
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 1440 })
      await page.goto(origin + '/__year_test?geometry=' + width)
      await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
      await selectCategory('year')
      await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
      await year('2018').click(); await view('albums'); await album('Mixed').waitFor()
      const albumHero = await heroGeometry(); verifyYearAlbumHero(albumHero); await verifyYearContent()
      await screenshot('year-albums-' + width)
      await active().locator('.year-all-songs').click(); await view('songs'); await songs().first().waitFor()
      const songHero = await heroGeometry(); verifyHeroPair(albumHero, songHero); await verifyYearContent()
      await screenshot('year-all-songs-' + width)
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
    console.log('year library: desktop hero boundaries and left-aligned statistics passed')
  } else {
  await page.goto(origin + '/__year_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
  await selectCategory('year')
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await view('root'); await year('2018').waitFor()
  assert.deepEqual(await years().locator('.folder-name').allTextContents(), ['2026', '2019', '2018', '2017'])
  assert.equal(await years().count(), 4, 'hidden 2027, failed-summary 2025 and unresolved years are absent')
  await verifyRootDesign()
  assert.match(await year('2018').locator('.year-card-meta').innerText(), /3\s*\|\s*9:00/, 'root count and duration include the inherited missing-year song')
  assert.equal(await year('未知年份').count(), 0, 'unresolved completed metadata has no visible unknown-year branch')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.length), 9, 'year filtering leaves the underlying library intact')
  const pinsBeforeMenu = await page.evaluate(() => window.vm.playlist.library.pinnedCategoryIds)
  await active().locator('.playlist-hero-more-button').click()
  const rootMenu = page.locator('.library-root-menu')
  await rootMenu.waitFor()
  assert.deepEqual(await rootMenu.locator('.folder-root-menu-action span').allTextContents(), ['选择文件夹', '重新扫描', '列表选项'])
  assert.equal(await rootMenu.getByRole('button', { name: /重新排序|侧栏置顶/ }).count(), 0)
  await screenshot('year-root-more')
  await page.keyboard.press('Escape'); await rootMenu.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.pinnedCategoryIds), pinsBeforeMenu)
  await screenshot('year-root')

  await year('2018').click(); await view('albums'); await album('Mixed').waitFor()
  assert.deepEqual((await albums().locator('.folder-name').allTextContents()).sort(), ['Mixed', 'Solo'])
  assert.match(await active().locator('.year-all-songs').innerText(), /3\s*首歌曲/, 'flat songs count includes the inherited member while keeping the explicit 2019 member separate')
  const albumHero = await heroGeometry(); verifyYearAlbumHero(albumHero); await verifyYearContent()
  await screenshot('year-albums')
  await album('Mixed').click(); await view('album'); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'b.flac', 'c.flac'], 'album branch retains complete global membership')
  await sort('album-tracks', '歌曲名称', '降序', { field: 'title', direction: 'desc' })
  assert.deepEqual(await songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1))), ['c.flac', 'b.flac', 'a.flac'])
  await screenshot('year-album-tracks')
  await active().locator('.playlist-hero-play-button').click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-b', 'mixed-c'])
  assert(await page.evaluate(() => window.calls.some(call => call.command === 'audio_load_and_play' && call.input.path.endsWith('/c.flac'))), 'descending first item drives real playback command')
  await backFromPlayer(); await view('album')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.yearLocation.view), 'album')
  await up(); await view('albums')
  await sort('albums', '专辑名称', '降序', { field: 'name', direction: 'desc' })
  assert.deepEqual(await albums().locator('.folder-name').allTextContents(), ['Solo', 'Mixed'])
  await active().locator('.year-all-songs').click(); await view('songs')
  verifyHeroPair(albumHero, await heroGeometry())
  await verifyYearContent()
  assert.deepEqual(await songNames(), ['a.flac', 'c.flac', 'solo.flac'])
  assert.match(await active().locator('.playlist-hero-meta').last().innerText(), /3\s*首歌曲\s*\|\s*9:00/)
  await active().locator('.playlist-hero-play-button').click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-c', 'solo'], 'year all-songs playback uses the same effective-year membership')
  await backFromPlayer(); await view('songs')
  const rawMissing = await page.evaluate(() => { const item = window.vm.playlist.library.allSongs.find(item => item.trackId === 'mixed-c'); return { year: item.track.libraryYear, scope: item.scope, id: item.trackId } })
  assert.equal(rawMissing.year, null); assert.equal(rawMissing.id, 'mixed-c'); assert(rawMissing.scope, 'real source scope remains available')
  await sort('songs', '年份', '升序', { field: 'year', direction: 'asc' })
  assert.deepEqual(await songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1))), ['a.flac', 'c.flac', 'solo.flac'], 'effective-year ties use title ordering rather than putting the raw null last')
  await sort('songs', '歌曲名称', '降序', { field: 'title', direction: 'desc' })
  await screenshot('year-all-songs')
  await search('mixed-a'); await page.waitForFunction(() => document.querySelectorAll('.search-page .playlist-card[data-song-key]').length === 1)
  assert.match(await page.locator('.search-page').innerText(), /Title mixed-a/)
  await screenshot('year-global-search')
  await page.locator('.search-page').getByRole('button', { name: '随机播放搜索结果', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a'], 'existing global search filters actual shuffle candidates')
  await clearSearch(); await backFromPlayer(); await view('songs')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content:not([inert]) .album-songs .playlist-card[data-song-key]').length === 3)
  assert(!await page.evaluate(() => window.vm.playlist.library.allSongs.some(item => item.track.libraryYear === 1999)), 'playback hydration cannot replace summary years')
  await up(); await view('albums'); await up(); await view('root')
  await page.evaluate(() => localStorage.setItem('spmusic.year-root.sort.v1', JSON.stringify({ field: 'year', direction: 'asc' })))
  assert.deepEqual(await page.evaluate(() => ['root', 'albums', 'songs', 'album-tracks'].map(scope => JSON.parse(localStorage.getItem('spmusic.year-' + scope + '.sort.v1')))), [
    { field: 'year', direction: 'asc' }, { field: 'name', direction: 'desc' }, { field: 'title', direction: 'desc' }, { field: 'title', direction: 'desc' },
  ], 'existing root sort cache and the three child sorting preferences remain independent')

  await year('2019').click(); await view('albums')
  assert.equal(await albums().count(), 0, 'a 2019 track does not duplicate its 2018 album')
  await active().locator('.year-all-songs').click(); await view('songs')
  assert.deepEqual(await songNames(), ['b.flac'])
  await up(); await view('albums'); await up(); await view('root')
  assert.equal(await year('未知年份').count(), 0, 'unknown remains absent after visiting known-year branches')
  for (const oldView of ['albums', 'songs']) {
    await page.evaluate(oldView => window.vm.playlist.library.onYearLocationChange({ year: null, view: oldView }), oldView)
    await page.waitForFunction(() => window.vm.playlist.library.yearLocation === null)
    await view('root')
  }

  await active().locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
  await year('2018').click()
  await active().getByRole('button', { name: '播放年份歌曲', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-c', 'solo'], 'root selected year uses effective-year membership')
  await backFromPlayer(); await view('root')
  const previousSelection = active().getByRole('button', { name: '取消选择', exact: true })
  if (await previousSelection.count()) await previousSelection.click()
  await active().locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
  await year('2018').click(); await year('2019').click()
  await active().getByRole('button', { name: '播放年份歌曲', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-b', 'mixed-c', 'solo'], 'selected years include inherited membership exactly once')
  await backFromPlayer(); await selectCategory('year'); await view('root')
  const cancelSelection = active().getByRole('button', { name: '取消选择', exact: true })
  if (await cancelSelection.count()) await cancelSelection.click()
  await year('2018').click(); await view('albums')
  const retained = await page.evaluate(() => window.vm.playlist.library.yearLocation)
  await page.evaluate(() => { window.scanGate = true; window.vm.playlist.library.onRescanFolders() })
  await page.waitForFunction(() => window.pendingScans.length > 0)
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.yearLocation), retained, 'temporary rescan projection does not clear current year')
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending && window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await view('albums'); assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.yearLocation), retained)
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0 && window.vm.playlist.library.yearLocation === null)
  await page.getByText('暂无年份', { exact: true }).waitFor(); await screenshot('year-empty')

  await page.goto(origin + '/__year_test?summaryGate=1'); await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
  await selectCategory('year'); await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.equal(await years().count(), 0, 'pending metadata does not create unknown-year rows')
  await page.evaluate(() => window.settings.onClear()); await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await years().count(), 0, 'late metadata cannot resurrect cleared years')

  await page.goto(origin + '/__year_test?normal=2'); await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
  await selectCategory('year'); await year('2018').waitFor()
  assert.equal(await years().first().locator('.folder-name').textContent(), '2017', 'root sort persists through remount')
  await year('2018').click(); await view('albums'); await album('Mixed').waitFor()
  assert.deepEqual(await albums().locator('.folder-name').allTextContents(), ['Solo', 'Mixed'])
  await album('Mixed').click(); await view('album'); await songs().first().waitFor()
  assert.deepEqual(await songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1))), ['c.flac', 'b.flac', 'a.flac'])
  await selectCategory('album'); await album('Mixed').waitFor(); await album('Mixed').click(); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'b.flac', 'c.flac'], 'global album member scope remains unchanged')
  await up()
  for (const name of ['Invalid', 'Unknown', '未知专辑']) await album(name).waitFor()
  for (const [category, name] of [['artist', 'Singer Ensemble'], ['album-artist', 'Ensemble'], ['composer', '未知作曲家']]) {
    await selectCategory(category)
    const contributor = active().locator('.artist-card').filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + name + '$') }) })
    await contributor.waitFor(); await contributor.click(); await album('Mixed').waitFor(); await album('Mixed').click(); await songs().first().waitFor()
    assert.deepEqual(await songNames(), ['a.flac', 'b.flac', 'c.flac'], category + ' shared panel navigation and member scope remain unchanged')
  }
  await page.goto(origin + '/__year_test?inheritOnly=1'); await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 2)
  await selectCategory('year')
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await view('root'); await page.getByText('暂无年份', { exact: true }).waitFor()
  assert.equal(await years().count(), 0, 'an entirely unknown library shows the normal year empty state')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.length), 2, 'unknown library members are retained')
  await screenshot('year-all-unknown-empty')
  await selectCategory('album'); await album('Mixed').click(); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'c.flac'], 'unknown-only album remains accessible outside year classification')
  await selectCategory('year'); await view('root')
  await page.evaluate(() => { window.summaryYears['mixed-a'] = 2018; window.scanGate = true; window.vm.playlist.library.onRescanFolders() })
  await page.waitForFunction(() => window.pendingScans.length > 0)
  await page.evaluate(() => window.vm.playlist.library.onYearLocationChange({ year: null, view: 'albums' }))
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.yearLocation), { year: null, view: 'albums' }, 'unknown location remains during in-flight rescans')
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending && window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await page.waitForFunction(() => window.vm.playlist.library.yearLocation === null)
  await view('root'); await year('2018').waitFor()
  assert.equal(await years().count(), 1, 'resolved album year reveals the complete known-year category')
  assert.match(await year('2018').locator('.year-card-meta').innerText(), /2\s*\|\s*6:00/)
  await year('2018').click(); await view('albums')
  await page.evaluate(() => { window.summaryYears['mixed-a'] = null; window.scanGate = true; window.vm.playlist.library.onRescanFolders() })
  await page.waitForFunction(() => window.pendingScans.length > 0)
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.yearLocation), { year: 2018, view: 'albums' }, 'known location is retained until rescan settles')
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending && window.vm.playlist.library.allSongsMetadataStatus === 'ready' && window.vm.playlist.library.yearLocation === null)
  await view('root'); await page.getByText('暂无年份', { exact: true }).waitFor()
  await selectCategory('album'); await album('Mixed').click(); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'c.flac'], 'losing all known years does not delete album membership')
  await page.goto(origin + '/__year_test?mixedArtists=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 2)
  await selectCategory('year')
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await view('root'); await year('2022').waitFor()
  assert.deepEqual(await years().locator('.folder-name').allTextContents(), ['2022'], 'same-directory OST with different track artists inherits its known year')
  assert.match(await year('2022').locator('.year-card-meta').innerText(), /2\s*\|\s*6:00/)
  await screenshot('year-mixed-artists-root')
  await year('2022').click(); await view('albums')
  assert.equal(await albums().count(), 1, 'year album view uses the merged complete OST')
  await album('《明日方舟》游戏原声OST').click(); await view('album')
  assert.deepEqual(await songNames(), ['Mentalmeisters - 殉道者.flac', '塞壬唱片-MSR - 夜幕.mp3'].sort())
  await screenshot('year-mixed-artists-album')
  await active().locator('.playlist-hero-play-button').click(); await ready()
  assert.deepEqual(await queueIds(), ['martyr', 'nightfall'], 'merged album preserves real playback descriptors')
  await backFromPlayer(); await view('album'); await up(); await view('albums')
  await active().locator('.year-all-songs').click(); await view('songs')
  assert.equal(await songs().count(), 2, 'flat year songs agree with album membership for the original missing-year case')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.find(item => item.trackId === 'nightfall').track.libraryYear), null, 'inheritance does not rewrite the original missing year')
  await selectCategory('album')
  assert.equal(await albums().count(), 1, 'global album view shares the merged identity')
  await album('《明日方舟》游戏原声OST').click(); await songs().first().waitFor()
  assert.equal(await songs().count(), 2)
  for (const [artist, file] of [['Mentalmeisters', 'Mentalmeisters - 殉道者.flac'], ['塞壬唱片-MSR', '塞壬唱片-MSR - 夜幕.mp3']]) {
    await selectCategory('artist')
    await active().locator('.artist-card').filter({ has: page.locator('.folder-name', { hasText: artist }) }).click()
    await album('《明日方舟》游戏原声OST').click(); await songs().first().waitFor()
    assert.deepEqual(await songNames(), [file], 'artist projection keeps only its own credited songs')
  }
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
  console.log('year library: album year fallback, mixed-artist OST, three-action root menu, full albums, playback candidates, scoped sorts, navigation, pending and rescan passed')
  }
} catch (error) {
  await screenshot('year-failure')
  console.error(await page.evaluate(() => ({ location: window.vm?.playlist.library.yearLocation, route: window.vm?.playlist.library.route, text: document.querySelector('.album-library-content:not([inert])')?.innerText })), errors, consoleErrors)
  throw error
} finally { await browser.close() }
