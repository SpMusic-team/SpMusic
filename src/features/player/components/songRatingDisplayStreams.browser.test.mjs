import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const server=await createServer({cacheDir:mkdtempSync(path.join(tmpdir(),'song-rating-display-vite-')),server:{host:'127.0.0.1',port:5196,strictPort:true}})
const evidence=path.join(tmpdir(),'spmusic-song-rating-display-evidence');mkdirSync(evidence,{recursive:true})
let browser
try {
 await server.listen();const origin='http://127.0.0.1:5196'
 const main=await(await fetch(origin+'/src/main.tsx')).text()
 const dependency=name=>{const m=main.match(new RegExp('"(/[^"\\n]+/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(m);return m[1]}
 const shared=readFileSync(new URL('./streamAuthor.browser.test.mjs',import.meta.url),'utf8')
 const literal=shared.match(/const fixture = (`[^]*?`)\r?\nconst html/);assert(literal)
  const fixture=runInNewContext(literal[1],{dependency})+`
import {Toaster} from '/src/components/ui/sonner.tsx';
const toastHost=document.createElement('div');document.body.append(toastHost);ReactDOM.createRoot(toastHost).render(React.createElement(Toaster));
`
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
 await page.route('**/__highest_test*',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(()=>{if(!sessionStorage.getItem('rating.persistence.initialized')){localStorage.clear();localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.player.rating-mode.v1','stars');sessionStorage.setItem('rating.persistence.initialized','1');localStorage.setItem('spmusic.bookmarks.v1',JSON.stringify({version:1,entries:[{id:'bookmark-a',sourcePath:'/music/a.flac',positionMs:1000,createdAt:1,sort:0}]}));localStorage.setItem('spmusic.most-played.v1',JSON.stringify({version:1,entries:[{sourcePath:'/music/a.flac',playCount:3,lastPlayedAt:100}]}))}})
 const category=async id=>{await page.evaluate(id=>window.vm.playlist.library.onSelectCategory(id),id);await page.waitForFunction(id=>window.vm.playlist.library.route.categoryId===id,id)}
 const card=id=>page.locator(`.playlist-card[data-playlist-track-id="${id}"]:visible`).first()
 const mode=async label=>{await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:label,exact:true}).click();await page.keyboard.press('Escape')}
 try{
  await page.goto(origin+'/__highest_test');await page.waitForFunction(()=>window.vm?.playlist.library)
  await category('streams');await card('station').waitFor()
  await page.evaluate(()=>{window.vm.feedback.onRatingChange('station',5);window.vm.feedback.onRatingChange('custom',1);window.vm.feedback.onRatingChange('fresh',3)})
  const change=async level=>{await page.keyboard.down('Control');try{for(let i=0;i<12;i++){const current=Number(await page.locator('.all-songs-list:visible').getAttribute('data-layout-level'));if(current===level)return;await page.locator('.all-songs-list:visible').dispatchEvent('wheel',{ctrlKey:true,deltaY:current>level?-60:60});await page.waitForTimeout(180)}assert.fail('stream layout '+level)}finally{await page.keyboard.up('Control')}}
  for(const level of [0,4,5,6,8]){
   await change(level)
   assert.equal(await card('station').locator('.playlist-card-rating:visible').count(),1,'one visible stream rating at layout '+level)
   assert.equal(await card('station').locator('.playlist-card-rating-star:visible').count(),5)
   await card('unknown').scrollIntoViewIfNeeded();assert.equal(await card('unknown').locator('.playlist-card-rating').count(),0)
   assert.equal(await card('unknown').getAttribute('data-has-play-count'),null)
  }
  await change(4);await mode('赞／踩')
  assert.equal(await card('station').locator('.playlist-card-rating-thumb:visible').count(),1)
  assert.equal(await card('custom').locator('.playlist-card-rating-thumb.is-disliked:visible').count(),1)
  assert.equal(await card('fresh').locator('.playlist-card-rating').count(),0)
  assert.equal(await card('fresh').getAttribute('data-has-play-count'),null)
  await page.screenshot({path:path.join(evidence,'song-rating-streams.png')})
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,covered:'stream layout0/4/5/6/8 and mode changes'}))
 }catch(e){await page.screenshot({path:path.join(evidence,'streams-failure.png')});throw e}
}finally{if(browser)await browser.close();await server.close()}