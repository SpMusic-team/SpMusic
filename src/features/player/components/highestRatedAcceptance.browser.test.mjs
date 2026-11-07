import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const server=await createServer({cacheDir:mkdtempSync(path.join(tmpdir(),'highest-rated-vite-')),server:{host:'127.0.0.1',port:5193,strictPort:true}})
const evidence=path.join(tmpdir(),'spmusic-highest-rated-evidence');mkdirSync(evidence,{recursive:true})
let browser
try {
 await server.listen();const origin='http://127.0.0.1:5193'
 const main=await(await fetch(origin+'/src/main.tsx')).text()
 const dependency=name=>{const m=main.match(new RegExp('"(/[^"\\n]+/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(m);return m[1]}
 const shared=readFileSync(new URL('./mostPlayedAcceptance.browser.test.mjs',import.meta.url),'utf8')
 const literal=shared.match(/const fixture = (`[^]*?`)\r?\nconst html/);assert(literal)
 const fixture=runInNewContext(literal[1],{dependency})
 const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text()).replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;').replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{delete window.listeners[name]}};')
 assert(service.includes('window.backendInvoke'))
 const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
 const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__highest_real.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
 const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__highest_fixture.js"')
 browser=await chromium.launch({headless:true,channel:'msedge'})
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'})
 page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.routeWebSocket(origin.replace('http:','ws:')+'/**',socket=>socket.close())
 for(const [url,body] of [['**/src/features/player/services/audioCommands.ts*',service],['**/src/features/player/components/PlayerSurface.tsx*',surface],['**/__highest_real.js',realSurface],['**/__highest_fixture.js',fixture]])await page.route(url,r=>r.fulfill({contentType:'text/javascript',body}))
 await page.route('**/__highest_test',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.player.rating-mode.v1','thumbs')})
 const active=()=>page.locator('.playlist-management-content:not([inert])')
 const songs=()=>active().locator('.all-songs-list [data-song-key]')
 const ids=()=>songs().evaluateAll(nodes=>nodes.map(n=>n.dataset.songKey.split('/').at(-1).replace('.flac','')))
 const category=async id=>{await page.evaluate(id=>window.vm.playlist.library.onSelectCategory(id),id);await page.waitForFunction(id=>window.vm.playlist.library.route.categoryId===id,id)}
 const rate=async(id,n)=>{await page.evaluate(({id,n})=>window.vm.feedback.onRatingChange(id,n),{id,n});await page.waitForFunction(({id,n})=>(window.vm.feedback.ratingsByTrackId[id]??0)===n,{id,n})}
 const ready=()=>page.waitForFunction(()=>!window.vm.playback.isSelectionPending)
 try {
  await page.goto(origin+'/__highest_test');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
  await category('highest-rated');assert.equal(await songs().count(),0)
  assert(await page.getByRole('button',{name:'播放最高评级',exact:true}).isDisabled())
  await rate('a',5);await rate('b',2);await rate('duet',4);await rate('missing',1);await rate('literal',3);await rate('hidden',5)
  await songs().first().waitFor();assert.deepEqual(await ids(),['a'],'thumbs highest-rated shows only rating 5')
  assert.equal(await active().locator('.playlist-management-quick-index').count(),0)
  await page.screenshot({path:path.join(evidence,'highest-thumbs-1280.png')})
  // Display assertions use accessible label rather than internal rendering details.
  assert.equal(await songs().first().locator('.playlist-card-format .playlist-card-rating-thumb:visible').count(),1)
  assert.equal(await songs().count(),1,'intermediate and low/unrated scores are excluded in thumbs mode')
  const geometry=await songs().first().locator('.playlist-card-format .playlist-card-rating-thumb').evaluate(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,color:getComputedStyle(n).color}))
  assert(geometry.w>0&&geometry.h>0)
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
  await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'五星评分',exact:true}).click();await page.keyboard.press('Escape')
  await songs().first().locator('.playlist-card-format .playlist-card-rating-star').first().waitFor()
  assert.deepEqual(await ids(),['a','duet','literal','b'],'stars mode restores intermediate scores with rating-descending order')
  assert.equal(await songs().first().locator('.playlist-card-format .playlist-card-rating-star').count(),5)
  assert.equal(await songs().nth(1).locator('.playlist-card-format .playlist-card-rating-star').count(),4)
  const expectSolidStar=async selector=>{
    const glyph=selector.first()
    const shape=await glyph.evaluate(svg=>{
      const box=svg.getBoundingClientRect(),v=svg.viewBox.baseVal,point=svg.createSVGPoint();point.x=v.x+v.width/2;point.y=v.y+v.height/2
      return {tag:svg.tagName.toLowerCase(),w:box.width,h:box.height,centerFilled:[...svg.querySelectorAll('path')].some(p=>p.isPointInFill(point)),fill:getComputedStyle(svg).fill,overflow:getComputedStyle(svg).overflow}
    })
    assert.equal(shape.tag,'svg');assert.equal(shape.centerFilled,true,'earned star fills its center instead of drawing a hollow outline')
    assert(shape.w>0,'earned stars have positive size');assert(Math.abs(shape.w-shape.h)<.1);assert.notEqual(shape.fill,'none')
  }
  await expectSolidStar(songs().first().locator('.playlist-card-format .playlist-card-rating-star'))
  const changeLayout=async target=>{
    await page.keyboard.down('Control')
    try {for(let attempt=0;attempt<12;attempt++){
      const level=Number(await active().locator('.all-songs-list').getAttribute('data-layout-level'));if(level===target)return
      await active().locator('.all-songs-list').dispatchEvent('wheel',{ctrlKey:true,deltaY:target<level?-60:60});await page.waitForTimeout(180)
    }assert.fail('layout did not reach '+target)}finally{await page.keyboard.up('Control')}
  }
  const tiers=[]
  const expectRatingTier=async level=>{
    const expected=level<=4?8.832:level<=6?7.084:5.336
    const geometry=await songs().first().evaluate(card=>{
      const visible=n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0
      const strip=[...card.querySelectorAll('.playlist-card-rating')].find(visible),cover=card.querySelector('.playlist-card-cover').getBoundingClientRect()
      const badge=strip.getBoundingClientRect(),star=strip.querySelector('.playlist-card-rating-star').getBoundingClientRect(),pill=strip.parentElement.getBoundingClientRect()
      return {cover:cover.width,strip:badge.width,pill:pill.width,star:star.width,starHeight:star.height,insidePill:badge.left>=pill.left-.1&&badge.right<=pill.right+.1&&badge.top>=pill.top-.1&&badge.bottom<=pill.bottom+.1}
    })
    const lowerWidth=await songs().nth(1).locator('.playlist-card-rating-star:visible').first().evaluate(n=>n.getBoundingClientRect().width)
    assert(Math.abs(lowerWidth-geometry.star)<.03,'lower scores use the same star size as full five')
    assert(Math.abs(geometry.star-expected)<.03,`layout ${level} size must match fixed tier ${expected}: ${JSON.stringify(geometry)}`)
    assert.equal(geometry.insidePill,true,'rating strip remains inside badge without clipping')
    assert(Math.abs(geometry.strip-geometry.star*5)<.1,'full five badge keeps all solid star glyphs without compression')
    tiers.push({level,expected,...geometry})
  }
  for(const level of [0,1,2,3,4,5,6,7,8,9]){
    await changeLayout(level)
    const stars=songs().first().locator('.playlist-card-rating-star:visible')
    await stars.first().waitFor();assert.equal(await stars.count(),5);await expectSolidStar(stars);await expectRatingTier(level)
    await page.screenshot({path:path.join(evidence,'highest-stars-fixed-tier-'+level+'.png')})
  }
  const thumbTiers=[]
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
  await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'赞／踩',exact:true}).click();await page.keyboard.press('Escape')
  assert.deepEqual(await ids(),['a'],'switching to thumbs removes scores 2–4')
  for(const level of [0,1,2,3,4,5,6,7,8,9]){
    await changeLayout(level)
    const thumb=songs().first().locator('.playlist-card-rating-thumb:visible');await thumb.waitFor()
    const glyph=await thumb.evaluate(n=>{
      const r=n.getBoundingClientRect(),pill=n.closest('.playlist-card-play-count').getBoundingClientRect(),style=getComputedStyle(n)
      // Highest-rated excludes rating 1. Verify the generic dislike CSS on a copy
      // of the actual glyph, without introducing a lowest-rated view or data.
      const dislike=n.cloneNode(true);dislike.classList.add('is-disliked');n.parentElement.append(dislike)
      const d=dislike.getBoundingClientRect(),ds=getComputedStyle(dislike),result={w:r.width,h:r.height,mask:style.maskSize,insidePill:r.left>=pill.left-.1&&r.right<=pill.right+.1&&r.top>=pill.top-.1&&r.bottom<=pill.bottom+.1,dislikeW:d.width,dislikeH:d.height,dislikeMask:ds.maskSize,dislikeTransform:ds.transform};dislike.remove();return result
    })
    const star=tiers.find(t=>t.level===level).star
    const thumbSize=level<=4?17.572:level<=6?15.824:14.076
    assert(Math.abs(glyph.w-thumbSize)<.03&&Math.abs(glyph.h-thumbSize)<.03,'thumb has independently enlarged tier for layout '+level)
    assert(Math.abs(glyph.w-star-8.74)<.03,'five thumb size increments leave star size unchanged')
    assert.equal(glyph.mask,'contain');assert.equal(glyph.insidePill,true)
    assert(Math.abs(glyph.dislikeW-thumbSize)<.03&&Math.abs(glyph.dislikeH-thumbSize)<.03,'generic dislike glyph retains tier size')
    assert.equal(glyph.dislikeMask,'contain');assert.equal(glyph.dislikeTransform,'matrix(-1, 0, 0, -1, 0, 0)')
    thumbTiers.push({level,...glyph})
    await page.screenshot({path:path.join(evidence,'highest-thumbs-fixed-tier-'+level+'.png')})
  }
  await changeLayout(4)
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
  await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'五星评分',exact:true}).click();await page.keyboard.press('Escape')
  assert.deepEqual(await ids(),['a','duet','literal','b'],'switching back restores all eligible stars')
  assert.equal(await songs().first().locator('.playlist-card-format .playlist-card-rating-star').count(),5)
  await page.screenshot({path:path.join(evidence,'highest-stars-1280.png')})
  await active().getByRole('button',{name:'选择',exact:true}).click()
  await songs().first().click();assert.equal(await songs().first().getAttribute('aria-pressed'),'true')
  assert.equal(await active().locator('.playlist-card-reorder-handle').count(),0)
  await page.getByRole('button',{name:'退出选择',exact:true}).click()
  await page.setViewportSize({width:640,height:1024});await page.screenshot({path:path.join(evidence,'highest-stars-640.png')});await page.setViewportSize({width:1280,height:900})
  await active().getByRole('button',{name:'搜索最高评级',exact:true}).click()
  await page.getByRole('searchbox',{name:'聚合搜索',exact:true}).fill('Song b')
  await page.locator('.search-page').waitFor()
  await page.locator('.playlist-playback-dock:not([data-dock-superseded])').filter({visible:true}).getByRole('button',{name:'搜索',exact:true}).click()
  await page.locator('.search-page').waitFor({state:'hidden'})
  assert.equal(await active().getAttribute('data-library-category'),'highest-rated','search returns to highest-rated source')
  await active().getByRole('button',{name:'返回媒体库',exact:true}).click()
  await page.waitForFunction(()=>window.vm.playlist.library.route.view==='overview');await category('highest-rated')
  await rate('a',1);await page.waitForFunction(()=>window.vm.playlist.library.highestRatedSongs.length===3)
  assert.deepEqual(await ids(),['duet','literal','b'])
  await rate('a',5);await songs().first().waitFor()
  await songs().first().click();await ready();assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)),['a','duet','literal','b'])
  const savedQueue=await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id))
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
  await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'赞／踩',exact:true}).click();await page.keyboard.press('Escape')
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('highest-rated')
  assert.deepEqual(await ids(),['a'],'thumbs display matches only liked tracks')
  assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)),savedQueue,'mode switch leaves active playback queue snapshot unchanged')
  await page.getByRole('button',{name:'播放最高评级',exact:true}).click();await ready()
  assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)),['a'],'new thumbs play uses filtered display scope')
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('highest-rated')
  await page.getByRole('button',{name:'随机播放最高评级',exact:true}).click();await ready()
  assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)),['a'],'new thumbs shuffle uses filtered display scope')
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('highest-rated')
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
  await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'五星评分',exact:true}).click();await page.keyboard.press('Escape')
  assert.deepEqual(await ids(),['a','duet','literal','b'])
  await songs().first().click();await ready()
  await rate('duet',1);assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)),['a','duet','literal','b'],'rating change preserves playback snapshot')
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('highest-rated')
  await page.getByRole('button',{name:'随机播放最高评级',exact:true}).click();await ready();assert.deepEqual((await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id))).sort(),['a','b','literal'])
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('lowest-rated')
  await songs().first().waitFor();assert.deepEqual(await ids(),['duet','missing'],'lowest-rated includes exactly rating 1')
  assert.equal(await songs().first().locator('.playlist-card-rating-star:visible').count(),1)
  await songs().first().click();await ready();assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)),['duet','missing'],'lowest row play uses the displayed source')
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('lowest-rated')
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
  await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'赞／踩',exact:true}).click();await page.keyboard.press('Escape')
  assert.deepEqual(await ids(),['duet','missing'],'lowest mode switch retains only dislikes')
  assert.equal(await songs().first().locator('.playlist-card-rating-thumb.is-disliked:visible').count(),1)
  await page.getByRole('button',{name:'随机播放最低评级',exact:true}).click();await ready();assert.deepEqual((await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id))).sort(),['duet','missing'],'lowest shuffle uses only disliked songs')
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await category('lowest-rated')
  await page.screenshot({path:path.join(evidence,'lowest-thumbs-filtered.png')})
  await rate('duet',0);await rate('missing',0);assert.equal(await songs().count(),0)
  assert(await page.getByRole('button',{name:'播放最低评级',exact:true}).isDisabled())
  assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id)).then(ids=>ids.sort()),['duet','missing'],'rating removal preserves lowest playback snapshot')
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,evidence,tiers,thumbTiers}))
 } catch(e){await page.screenshot({path:path.join(evidence,'failure.png')});console.error(await active().innerText().catch(()=>''));throw e}
} finally {if(browser)await browser.close();await server.close()}
