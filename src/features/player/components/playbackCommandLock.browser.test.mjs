// Independent browser regression for the reported "button blink while a song
// starts playing". Run Vite and point SPMUSIC_PLAYWRIGHT at an existing
// Playwright package; this file is a plain `node <file>` harness and the repo
// installs no browser dependency.
//
// Reported defect: clicking a song makes the media-library "全部歌曲" header's two
// leftmost buttons (随机播放 / 播放全部歌曲) and the playlist-detail hero play/更多
// buttons blink.
//
// Lead's hypothesis under test (do not assume it is correct): the transient
// playback command lock that PlayerShell publishes as
// `playlist.isOpenAudioDisabled` (audioBusy || transportBusy || selectionPending
// || seeking) is mapped straight into the native `disabled` attribute. The Base
// UI/shadcn Button carries `transition-all` + `disabled:opacity-50`, so the lock
// dims the buttons to ~0.5 and restores them, which is the visible blink.
//
// The fixture renders the real PlaylistLibraryPanel (route
// {view:'category',categoryId:'songs'} with a ready, non-empty allSongs list)
// and the real PlaylistPanel hero. `window.setPlaybackLock` drives exactly the
// inputs the app drives: the library view-model `playlist.isOpenAudioDisabled`
// and PlaylistPanel's `isOpenAudioDisabled` prop plus the busy-dependent
// `onTrackSelect` becoming undefined.
//
// Measured evidence and permanent assertions:
//  - while the lock flips false -> true -> false, per-animation-frame effective
//    opacity (product of the element and all ancestors) must never drop below
//    0.99; the pre-fix tree fails this with a minimum near 0.5 (the blink);
//  - genuinely unavailable actions (every song available:false / no playable
//    hero track and no more-actions capability) must still be dimmed at <= 0.6,
//    so a fix cannot mask real unavailability;
//  - the fixture must exercise the real mechanism: the four buttons are disabled
//    during the lock and enabled at rest;
//  - DOM contract: `data-playback-command-lock` is "true" only on the four
//    buttons and only while the lock is held, the native disabled behaviour is
//    unchanged, neighbouring toolbar controls are untouched, and geometry is
//    identical with and without the attribute;
//  - documented residual risk: structural unavailability while the same lock is
//    held also carries the attribute, so those buttons keep full opacity for the
//    duration of the lock (recorded as evidence, not asserted as a failure);
//    their disabled/click semantics are asserted to remain intact.
//
// Exit code 1 on any assertion failure. Evidence JSON, per-frame opacity
// sequences and screenshots are written under SPMUSIC_SCREENSHOT_DIR (defaults
// to the system temp directory) and printed to stdout.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}

// The library toolbar's first two buttons are the reported ones (audio lock is
// part of their disabled expression; search/select are not). The hero selectors
// are scoped to header.playlist-hero because PlaylistPanel also renders a
// compact copy of the actions outside the hero.
const libraryTargets = [
  { key: 'library-shuffle', selector: '.playlist-management-actions button:nth-of-type(1)' },
  { key: 'library-play', selector: '.playlist-management-actions button:nth-of-type(2)' },
]
const heroTargets = [
  { key: 'hero-play', selector: '.playlist-hero .playlist-hero-play-button' },
  { key: 'hero-more', selector: '.playlist-hero .playlist-hero-more-button' },
]

const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlaylistLibraryPanel} from '/src/features/player/components/PlaylistLibraryPanel.tsx';
import {PlaylistPanel} from '/src/features/player/components/PlaylistPanel.tsx';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{};
const coverBlob=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#478"/></svg>'],{type:'image/svg+xml'}));
const cover={src:coverBlob,width:128,height:128,encodedBytes:256};
const tracks=Array.from({length:8},(_,i)=>({id:'track-'+i,title:'Song '+i,artist:'Artist '+i,album:'Album '+i,durationSeconds:180,fileExtension:'flac',hasLocalArtwork:true,coverThumbnail:cover}));
window.actions=[];
function Fixture(){
 const [view,setView]=React.useState('library');
 const [lock,setLock]=React.useState(false);
 const [songsUnavailable,setSongsUnavailable]=React.useState(false);
 const [heroUnavailable,setHeroUnavailable]=React.useState(false);
 const [sidebarOpen,setSidebarOpen]=React.useState(false);
 // Same inputs PlayerShell feeds the panels. The hero play button additionally
 // locks itself when onTrackSelect is undefined, exactly like the app while a
 // playback command is in flight.
 window.setPlaybackLock=value=>setLock(Boolean(value));
 window.setAllSongsUnavailable=value=>setSongsUnavailable(Boolean(value));
 window.setHeroUnavailable=value=>setHeroUnavailable(Boolean(value));
 window.showLibraryView=()=>{setView('library');return 'library'};
 window.showPlaylistView=()=>{setView('playlist');return 'playlist'};
 const allSongs=tracks.map((track,index)=>({key:'song-'+index,scope:'songs',trackId:track.id,sourcePath:'/audio/'+track.id+'.flac',track,available:!songsUnavailable}));
 const library={isOpen:view==='library',route:{view:'category',categoryId:'songs'},items:[],allSongs,allSongsMetadataStatus:'ready',currentScope:'songs',activeScope:'songs',
  onOpen:()=>setView('library'),onOpenOverview:noop,onSelectCategory:categoryId=>window.actions.push('category:'+categoryId),
  onSelect:scope=>{window.actions.push('select:'+scope);setView('playlist')},onPlay:scope=>window.actions.push('play:'+scope),
  onPlaySong:(scope,trackId)=>window.actions.push('song:'+trackId),onSelectFolders:noop,onImportPlaylist:noop,isImportPending:false,onCreatePlaylist:()=>null};
 const playback={track:{...tracks[3],lyrics:[]},isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:lock,isSelectionPending:lock,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
 const timeline={positionSeconds:60,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
 const common={playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:noop,librarySidebarOpen:sidebarOpen,onLibrarySidebarOpenChange:setSidebarOpen};
 if(view==='library')return React.createElement('main',{className:'player-shell'},React.createElement(PlaylistLibraryPanel,{...common,playlist:{isOpen:true,library,onOpenAudio:noop,onOpenChange:noop,isOpenAudioDisabled:lock,tracks,currentTrackId:'track-3',shuffleMode:'none',onShuffleCycle:noop},onOpenPlayer:noop}));
 return React.createElement('main',{className:'player-shell'},React.createElement(PlaylistPanel,{...common,library,unavailableTrackIds:heroUnavailable?new Set(tracks.map(track=>track.id)):undefined,tracks,currentTrackId:'track-3',entryPosition:{requestId:1,target:'top'},shuffleMode:'none',onShuffleCycle:noop,isOpenAudioDisabled:lock,onOpenAudio:heroUnavailable?undefined:noop,onTrackSelect:(lock||heroUnavailable)?undefined:noop,onVisibleTrackIdsChange:noop,onClose:noop}));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`

const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^"]+"/, 'src="/__playback_command_lock_fixture.js"')
const directory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-playback-command-lock')
mkdirSync(directory, { recursive: true })
const evidencePath = join(directory, 'evidence.json')

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.setDefaultTimeout(15000)
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))

// Wait until the target's effective opacity is >= 0.99 for 8 consecutive
// frames, so entry animations (toolbar/content fade-in) cannot pollute the
// baseline. Effective opacity is the product of the element and every ancestor.
async function waitSettled(selectors) {
  return page.evaluate(async selectors => {
    const nodes = selectors.map(selector => {
      const node = document.querySelector(selector)
      if (!node) throw new Error('missing target ' + selector)
      return node
    })
    const opacityOf = node => {
      let value = 1
      for (let element = node; element; element = element.parentElement) {
        const opacity = Number.parseFloat(getComputedStyle(element).opacity)
        if (Number.isFinite(opacity)) value *= opacity
      }
      return value
    }
    const startedAt = performance.now()
    let streak = 0
    while (performance.now() - startedAt < 4000) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      streak = nodes.every(node => opacityOf(node) >= 0.99) ? streak + 1 : 0
      if (streak >= 8) return nodes.map(opacityOf)
    }
    throw new Error('targets did not settle: ' + JSON.stringify(nodes.map(opacityOf)))
  }, selectors)
}

// false -> true -> false playback command lock, sampling every animation frame
// (rest / locked / released stages) for the requested targets.
async function measureLock(targets, hold) {
  return page.evaluate(async ({ targets, hold }) => {
    const nodes = targets.map(target => {
      const node = document.querySelector(target.selector)
      if (!node) throw new Error('missing target ' + target.key + ': ' + target.selector)
      return { key: target.key, selector: target.selector, node }
    })
    const opacityOf = node => {
      let value = 1
      for (let element = node; element; element = element.parentElement) {
        const opacity = Number.parseFloat(getComputedStyle(element).opacity)
        if (Number.isFinite(opacity)) value *= opacity
      }
      return value
    }
    const frames = []
    const capture = stage => frames.push({
      stage,
      at: performance.now(),
      opacity: nodes.map(entry => opacityOf(entry.node)),
      disabled: nodes.map(entry => Boolean(entry.node.disabled)),
      commandLock: nodes.map(entry => entry.node.getAttribute('data-playback-command-lock')),
    })
    const frame = stage => new Promise(resolve => requestAnimationFrame(() => {
      capture(stage)
      resolve()
    }))
    window.setPlaybackLock(false)
    for (let index = 0; index < 6; index += 1) await frame('rest')
    window.setPlaybackLock(true)
    const lockedAt = performance.now()
    while (performance.now() - lockedAt < hold.locked) await frame('locked')
    window.setPlaybackLock(false)
    const releasedAt = performance.now()
    while (performance.now() - releasedAt < hold.released) await frame('released')
    return {
      targets: nodes.map(entry => ({
        key: entry.key,
        selector: entry.selector,
        ariaLabel: entry.node.getAttribute('aria-label'),
        text: (entry.node.textContent || '').trim(),
      })),
      frames,
    }
  }, { targets, hold })
}

// Steady-state sampling for permanently unavailable actions (no lock).
async function measureSteady(targets, frameCount) {
  return page.evaluate(async ({ targets, frameCount }) => {
    const nodes = targets.map(target => {
      const node = document.querySelector(target.selector)
      if (!node) throw new Error('missing target ' + target.key + ': ' + target.selector)
      return { key: target.key, selector: target.selector, node }
    })
    const opacityOf = node => {
      let value = 1
      for (let element = node; element; element = element.parentElement) {
        const opacity = Number.parseFloat(getComputedStyle(element).opacity)
        if (Number.isFinite(opacity)) value *= opacity
      }
      return value
    }
    const frames = []
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      frames.push({
        opacity: nodes.map(entry => opacityOf(entry.node)),
        disabled: nodes.map(entry => Boolean(entry.node.disabled)),
      })
    }
    return {
      targets: nodes.map(entry => ({
        key: entry.key,
        selector: entry.selector,
        ariaLabel: entry.node.getAttribute('aria-label'),
      })),
      frames,
    }
  }, { targets, frameCount })
}

const minimum = values => values.length ? Math.min(...values) : null
const maximum = values => values.length ? Math.max(...values) : null
const round = value => Math.round(value * 1000) / 1000

// Collapse consecutive identical opacities so the evidence stays readable while
// preserving the exact animation-frame sequence.
function compress(values) {
  const runs = []
  for (const value of values) {
    const opacity = round(value)
    const last = runs[runs.length - 1]
    if (last && last.opacity === opacity) last.frames += 1
    else runs.push({ opacity, frames: 1 })
  }
  return runs
}

function summarizeTransition(measurement) {
  const { targets, frames } = measurement
  const stageValues = (stage, index) => frames.filter(frame => frame.stage === stage).map(frame => frame.opacity[index])
  const targetsSummary = targets.map((target, index) => {
    const rest = stageValues('rest', index)
    const locked = stageValues('locked', index)
    const released = stageValues('released', index)
    const transient = [...locked, ...released]
    const disabled = stage => frames.filter(frame => frame.stage === stage).map(frame => frame.disabled[index])
    const attribute = stage => frames.filter(frame => frame.stage === stage).map(frame => frame.commandLock[index])
    const transientMin = round(minimum(transient))
    return {
      key: target.key,
      selector: target.selector,
      ariaLabel: target.ariaLabel,
      restMin: round(minimum(rest)),
      restMax: round(maximum(rest)),
      lockedMin: round(minimum(locked)),
      releasedMin: round(minimum(released)),
      transientMin,
      transientMax: round(maximum(transient)),
      belowOneFrames: transient.filter(value => value < 0.99).length,
      atMinFrames: transient.filter(value => round(value) === transientMin).length,
      frames: { rest: rest.length, locked: locked.length, released: released.length },
      disabledAtRest: disabled('rest').some(Boolean),
      disabledDuringLock: disabled('locked').every(Boolean),
      commandLockAttributeSeen: frames.some(frame => frame.commandLock[index] !== null),
      commandLockAttributeDuringLock: attribute('locked').every(value => value === 'true'),
      commandLockAttributeOnlyWhileLocked: [...attribute('rest'), ...attribute('released')].every(value => value === null),
      transientSequence: compress(transient),
    }
  })
  return {
    targets: targetsSummary,
    durationMs: frames.length ? round(frames[frames.length - 1].at - frames[0].at) : 0,
  }
}

function summarizeSteady(measurement) {
  const { targets, frames } = measurement
  return {
    targets: targets.map((target, index) => {
      const values = frames.map(frame => frame.opacity[index])
      const disabled = frames.map(frame => frame.disabled[index])
      return {
        key: target.key,
        selector: target.selector,
        ariaLabel: target.ariaLabel,
        steadyMin: round(minimum(values)),
        steadyMax: round(maximum(values)),
        frames: values.length,
        disabled: disabled.every(Boolean),
      }
    }),
  }
}

// Contract probe: attribute value, native disabled state, computed opacity and
// geometry for the target buttons and their untouched toolbar neighbours.
async function probeContract(plan) {
  return page.evaluate(plan => {
    const read = selector => {
      const node = document.querySelector(selector)
      if (!node) throw new Error('missing probe target ' + selector)
      const rect = node.getBoundingClientRect()
      return {
        selector,
        ariaLabel: node.getAttribute('aria-label'),
        attribute: node.getAttribute('data-playback-command-lock'),
        disabled: Boolean(node.disabled),
        opacity: Math.round(Number.parseFloat(getComputedStyle(node).opacity) * 1000) / 1000,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }
    }
    return { targets: plan.targets.map(read), neighbors: plan.neighbors.map(read) }
  }, plan)
}

const sameRect = (left, right) => ['x', 'y', 'width', 'height'].every(axis => Math.abs(left[axis] - right[axis]) < 0.01)

const waitForDisabled = selectors => page.waitForFunction(
  selectors => selectors.every(selector => {
    const node = document.querySelector(selector)
    return Boolean(node && node.disabled)
  }),
  selectors,
)

const libraryPlan = {
  targets: libraryTargets.map(target => target.selector),
  neighbors: [
    '.playlist-management-actions button:nth-of-type(3)',
    '.playlist-management-actions button:nth-of-type(4)',
  ],
}
const heroPlan = {
  targets: heroTargets.map(target => target.selector),
  neighbors: [
    '.playlist-hero .playlist-hero-shuffle-button',
    '.playlist-hero .playlist-search-button',
    '.playlist-hero .playlist-select-toggle',
  ],
}

const evidence = {
  origin,
  browser: browser.version(),
  viewport: { width: 1280, height: 900 },
  screenshots: directory,
  surfaces: {},
  controls: {},
  contract: {},
  residual: {},
  pageErrors,
}

try {
  await page.route('**/__playback_command_lock_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__playback_command_lock_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__playback_command_lock_test')
  await page.waitForFunction(() => typeof window.setPlaybackLock === 'function')
  await page.evaluate(() => document.fonts.ready)

  // ---- Media library "全部歌曲" toolbar -------------------------------------
  await page.locator('.playlist-management-actions').waitFor()
  await waitSettled(libraryTargets.map(target => target.selector))
  const libraryContract = { rest: await probeContract(libraryPlan), locked: null, released: null }
  await page.screenshot({ path: join(directory, 'library-rest.png') })
  await page.evaluate(() => window.setPlaybackLock(true))
  await page.waitForTimeout(500)
  libraryContract.locked = await probeContract(libraryPlan)
  await page.screenshot({ path: join(directory, 'library-locked.png') })
  await page.evaluate(() => window.setPlaybackLock(false))
  await waitSettled(libraryTargets.map(target => target.selector))
  libraryContract.released = await probeContract(libraryPlan)
  evidence.contract.library = libraryContract
  evidence.surfaces.library = summarizeTransition(await measureLock(libraryTargets, { locked: 600, released: 600 }))

  // Control: all songs unavailable at rest must still look disabled.
  await page.evaluate(() => window.setAllSongsUnavailable(true))
  await waitForDisabled(libraryTargets.map(target => target.selector))
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(directory, 'library-unavailable.png') })
  evidence.controls.library = summarizeSteady(await measureSteady(libraryTargets, 12))
  await page.evaluate(() => window.setAllSongsUnavailable(false))
  await waitSettled(libraryTargets.map(target => target.selector))

  // Residual risk (documented, not a failure): structural unavailability while
  // the command lock is held. The lock attribute is present by design, so the
  // shared neutralisation also covers genuinely unavailable buttons for the
  // lifetime of the lock. Click semantics must stay disabled.
  await page.evaluate(() => {
    window.setAllSongsUnavailable(true)
    window.setPlaybackLock(true)
  })
  await waitForDisabled(libraryTargets.map(target => target.selector))
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(directory, 'library-unavailable-locked.png') })
  evidence.residual.library = {
    probe: await probeContract({ targets: libraryPlan.targets, neighbors: [] }),
    steady: summarizeSteady(await measureSteady(libraryTargets, 6)),
  }
  await page.evaluate(() => {
    window.setPlaybackLock(false)
    window.setAllSongsUnavailable(false)
  })
  await waitSettled(libraryTargets.map(target => target.selector))

  // ---- Playlist detail hero ------------------------------------------------
  await page.evaluate(() => window.showPlaylistView())
  await page.locator('.playlist-hero .playlist-hero-play-button').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await waitSettled(heroTargets.map(target => target.selector))
  const heroContract = { rest: await probeContract(heroPlan), locked: null, released: null }
  await page.screenshot({ path: join(directory, 'hero-rest.png') })
  await page.evaluate(() => window.setPlaybackLock(true))
  await page.waitForTimeout(500)
  heroContract.locked = await probeContract(heroPlan)
  await page.screenshot({ path: join(directory, 'hero-locked.png') })
  await page.evaluate(() => window.setPlaybackLock(false))
  await waitSettled(heroTargets.map(target => target.selector))
  heroContract.released = await probeContract(heroPlan)
  evidence.contract.hero = heroContract
  evidence.surfaces.hero = summarizeTransition(await measureLock(heroTargets, { locked: 600, released: 600 }))

  // Control: no playable track and no more-actions capability.
  await page.evaluate(() => window.setHeroUnavailable(true))
  await waitForDisabled(heroTargets.map(target => target.selector))
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(directory, 'hero-unavailable.png') })
  evidence.controls.hero = summarizeSteady(await measureSteady(heroTargets, 12))
  await page.evaluate(() => window.setHeroUnavailable(false))

  // Residual risk (documented, not a failure): no playable hero track and no
  // more-actions capability while the command lock is held.
  await page.evaluate(() => {
    window.setHeroUnavailable(true)
    window.setPlaybackLock(true)
  })
  await waitForDisabled(heroTargets.map(target => target.selector))
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(directory, 'hero-unavailable-locked.png') })
  evidence.residual.hero = {
    probe: await probeContract({ targets: heroPlan.targets, neighbors: [] }),
    steady: summarizeSteady(await measureSteady(heroTargets, 6)),
  }
  await page.evaluate(() => {
    window.setPlaybackLock(false)
    window.setHeroUnavailable(false)
  })
  await waitSettled(heroTargets.map(target => target.selector))
} finally {
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  // Compact stdout evidence; the full per-frame sweep (including every sampled
  // opacity run) is kept in evidence.json next to the screenshots.
  const compactTarget = target => ({
    target: target.key,
    ariaLabel: target.ariaLabel,
    restMin: target.restMin,
    lockedMin: target.lockedMin,
    releasedMin: target.releasedMin,
    transientMin: target.transientMin,
    belowOneFrames: target.belowOneFrames,
    atMinFrames: target.atMinFrames,
    disabledDuringLock: target.disabledDuringLock,
    disabledAtRest: target.disabledAtRest,
    commandLockAttributeSeen: target.commandLockAttributeSeen,
  })
  const compactControl = target => ({
    target: target.key,
    ariaLabel: target.ariaLabel,
    steadyMin: target.steadyMin,
    steadyMax: target.steadyMax,
    disabled: target.disabled,
  })
  const targetSets = { library: libraryTargets, hero: heroTargets }
  const geometryStable = contract => ['targets', 'neighbors'].every(group =>
    contract.rest[group].every((entry, index) =>
      sameRect(entry.rect, contract.locked[group][index].rect) && sameRect(entry.rect, contract.released[group][index].rect)))
  const compactContract = (contract, targets) => contract ? {
    geometryStable: geometryStable(contract),
    stages: ['rest', 'locked', 'released'].map(stage => ({
      stage,
      targets: contract[stage].targets.map((entry, index) => ({
        target: targets[index].key,
        attribute: entry.attribute,
        disabled: entry.disabled,
        opacity: entry.opacity,
      })),
    })),
    neighbors: contract.locked.neighbors.map((entry, index) => ({
      selector: entry.selector,
      attribute: entry.attribute,
      disabled: entry.disabled,
      opacity: entry.opacity,
      disabledAtRest: contract.rest.neighbors[index].disabled,
    })),
  } : null
  const compactResidual = residual => residual ? {
    targets: residual.steady.targets.map((entry, index) => ({
      target: entry.key,
      steadyMax: entry.steadyMax,
      attribute: residual.probe.targets[index].attribute,
      disabled: entry.disabled,
    })),
  } : null
  console.log(JSON.stringify({
    origin,
    browser: evidence.browser,
    viewport: evidence.viewport,
    screenshots: directory,
    evidence: evidencePath,
    surfaces: {
      library: evidence.surfaces.library ? evidence.surfaces.library.targets.map(compactTarget) : null,
      hero: evidence.surfaces.hero ? evidence.surfaces.hero.targets.map(compactTarget) : null,
    },
    controls: {
      library: evidence.controls.library ? evidence.controls.library.targets.map(compactControl) : null,
      hero: evidence.controls.hero ? evidence.controls.hero.targets.map(compactControl) : null,
    },
    contract: {
      library: compactContract(evidence.contract.library, libraryTargets),
      hero: compactContract(evidence.contract.hero, heroTargets),
    },
    residualRisk: {
      library: compactResidual(evidence.residual.library),
      hero: compactResidual(evidence.residual.hero),
    },
    pageErrors,
  }, null, 2))
  await browser.close()
}

// ---- Permanent assertions ---------------------------------------------------
assert.deepEqual(pageErrors, [], 'page errors during the fixture: ' + JSON.stringify(pageErrors))

// The fixture must exercise the real mechanism, otherwise the opacity numbers
// below prove nothing. The lock keeps all four buttons natively disabled while
// held and enabled at rest, regardless of how the fix neutralises the styling.
const fixtureFailures = []
for (const surface of ['library', 'hero']) {
  for (const target of evidence.surfaces[surface].targets) {
    if (!target.disabledDuringLock) fixtureFailures.push({ surface, target: target.key, problem: 'not disabled during the lock' })
    if (target.disabledAtRest) fixtureFailures.push({ surface, target: target.key, problem: 'disabled at rest before the lock' })
  }
}
assert.deepEqual(fixtureFailures, [], 'fixture did not exercise the real native disabled lock: ' + JSON.stringify(fixtureFailures))

// (a) The transient playback command lock is an interaction lock, not an
// unavailable action: opacity must not change at all on these four buttons.
const transientViolations = []
for (const surface of ['library', 'hero']) {
  for (const target of evidence.surfaces[surface].targets) {
    if (!(target.transientMin >= 0.99)) {
      transientViolations.push({
        surface,
        target: target.key,
        transientMin: target.transientMin,
        lockedMin: target.lockedMin,
        releasedMin: target.releasedMin,
        belowOneFrames: target.belowOneFrames,
        atMinFrames: target.atMinFrames,
      })
    }
  }
}
assert.deepEqual(transientViolations, [],
  'transient playback command lock visibly dimmed action buttons (the reported blink); full per-frame sweep: ' + evidencePath + '; violations: ' + JSON.stringify(transientViolations))

// (b) Genuinely unavailable actions must still look disabled, so the fix in
// task-2 cannot hide real unavailability.
const unavailabilityViolations = []
for (const surface of ['library', 'hero']) {
  for (const target of evidence.controls[surface].targets) {
    if (!(target.steadyMax <= 0.6)) {
      unavailabilityViolations.push({ surface, target: target.key, steadyMax: target.steadyMax, disabled: target.disabled })
    }
    if (!target.disabled) {
      unavailabilityViolations.push({ surface, target: target.key, problem: 'not disabled while genuinely unavailable' })
    }
  }
}
assert.deepEqual(unavailabilityViolations, [],
  'genuinely unavailable actions lost their disabled treatment: ' + JSON.stringify(unavailabilityViolations))

// (c) DOM contract: the lock attribute appears only while the lock is held,
// keeps the native disabled behaviour, never leaks onto neighbouring toolbar
// controls, and changes no geometry (the fix is opacity-only).
const contractViolations = []
const targetSets = { library: libraryTargets, hero: heroTargets }
for (const surface of ['library', 'hero']) {
  const contract = evidence.contract[surface]
  const targets = targetSets[surface]
  for (const [index, target] of targets.entries()) {
    const rest = contract.rest.targets[index]
    const locked = contract.locked.targets[index]
    const released = contract.released.targets[index]
    if (rest.attribute !== null) contractViolations.push({ surface, target: target.key, stage: 'rest', problem: 'lock attribute present while unlocked', actual: rest.attribute })
    if (released.attribute !== null) contractViolations.push({ surface, target: target.key, stage: 'released', problem: 'lock attribute present after release', actual: released.attribute })
    if (locked.attribute !== 'true') contractViolations.push({ surface, target: target.key, stage: 'locked', problem: 'lock attribute missing or not "true"', actual: locked.attribute })
    if (rest.disabled) contractViolations.push({ surface, target: target.key, stage: 'rest', problem: 'disabled at rest' })
    if (released.disabled) contractViolations.push({ surface, target: target.key, stage: 'released', problem: 'still disabled after release' })
    if (!locked.disabled) contractViolations.push({ surface, target: target.key, stage: 'locked', problem: 'lock no longer disables the button' })
    if (!(locked.opacity >= 0.99)) contractViolations.push({ surface, target: target.key, stage: 'locked', problem: 'element opacity below 0.99', actual: locked.opacity })
    if (!sameRect(rest.rect, locked.rect) || !sameRect(rest.rect, released.rect)) {
      contractViolations.push({ surface, target: target.key, problem: 'geometry changed while the attribute was present', rest: rest.rect, locked: locked.rect })
    }
    const frameTarget = evidence.surfaces[surface].targets[index]
    if (!frameTarget.commandLockAttributeDuringLock) contractViolations.push({ surface, target: target.key, problem: 'attribute not present on every locked animation frame' })
    if (!frameTarget.commandLockAttributeOnlyWhileLocked) contractViolations.push({ surface, target: target.key, problem: 'attribute present on a rest/released animation frame' })
  }
  for (const [index, neighbor] of contract.locked.neighbors.entries()) {
    const rest = contract.rest.neighbors[index]
    const released = contract.released.neighbors[index]
    if (neighbor.attribute !== null || rest.attribute !== null || released.attribute !== null) {
      contractViolations.push({ surface, neighbor: neighbor.selector, problem: 'neighbouring toolbar control unexpectedly carries the lock attribute' })
    }
    if (neighbor.disabled !== rest.disabled || released.disabled !== rest.disabled) {
      contractViolations.push({ surface, neighbor: neighbor.selector, problem: 'neighbouring toolbar control disabled state changed', rest: rest.disabled, locked: neighbor.disabled, released: released.disabled })
    }
    if (!(neighbor.opacity >= 0.99) || Math.abs(neighbor.opacity - rest.opacity) > 0.001) {
      contractViolations.push({ surface, neighbor: neighbor.selector, problem: 'neighbouring toolbar control opacity changed', rest: rest.opacity, locked: neighbor.opacity })
    }
    if (!sameRect(rest.rect, neighbor.rect) || !sameRect(rest.rect, released.rect)) {
      contractViolations.push({ surface, neighbor: neighbor.selector, problem: 'neighbouring toolbar control geometry shifted', rest: rest.rect, locked: neighbor.rect })
    }
  }
}
assert.deepEqual(contractViolations, [], 'DOM/geometry contract violated: ' + JSON.stringify(contractViolations))

// (d) Documented residual risk: structural unavailability while the lock is
// held shares the lock attribute, so the neutralisation also applies while both
// are true. This is recorded in evidence.residualRisk (opacity is expected to be
// 1 there by design) and only the click semantics are asserted: the buttons
// must stay genuinely disabled so no unavailable action can run.
const residualViolations = []
for (const surface of ['library', 'hero']) {
  const residual = evidence.residual[surface]
  for (const [index, target] of targetSets[surface].entries()) {
    const probe = residual.probe.targets[index]
    const steady = residual.steady.targets[index]
    if (!probe.disabled || !steady.disabled) residualViolations.push({ surface, target: target.key, problem: 'unavailable action not disabled while the lock is held' })
    if (probe.attribute !== 'true') residualViolations.push({ surface, target: target.key, problem: 'lock attribute missing in the combined unavailability+lock state' })
  }
}
assert.deepEqual(residualViolations, [], 'residual unavailability+lock state lost disabled semantics: ' + JSON.stringify(residualViolations))

console.log('playback command lock: all opacity, DOM-contract and residual-risk assertions passed')
