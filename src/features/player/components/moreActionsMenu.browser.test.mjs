// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Real menu, appearance runtime and responsive resolver; only track/callback data are fixtures.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baseline = process.env.SPMUSIC_MORE_BASELINE === '1'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {MoreActionsMenu} from '/src/features/player/components/MoreActionsMenu.tsx';
import {ResponsivePlayerLayout} from '/src/features/player/components/ResponsivePlayerLayout.tsx';
import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
import {useSystemIcons} from '/src/features/appearance/hooks/useAppearance.ts';
import '/src/index.css';import '/src/features/player/styles/player.css';
function Fixture(){
 const icons=useSystemIcons(),[feedback,setFeedback]=React.useState(null),[track,setTrack]=React.useState({id:'menu-fixture',title:'祠 / ある監視の視点',artist:'Feryquitous',album:'Irui',durationSeconds:398,fileExtension:'flac',coverTone:'lagoon',lyrics:[]});
 window.menuFixture={longTitle:()=>setTrack(t=>({...t,title:'很长的歌曲名称与アルバムのタイトル '.repeat(12),artist:'Artist '.repeat(30),album:'Album '.repeat(30)}))};
 return React.createElement('main',{className:'player-shell'},React.createElement(ResponsivePlayerLayout,{nativeWindowState:'normal',windowBar:null},React.createElement('div',{style:{position:'absolute',left:30,top:30}},React.createElement(MoreActionsMenu,{track,likeIcon:icons.like,dislikeIcon:icons.dislike,liked:feedback==='liked',disliked:feedback==='disliked',onLike:()=>setFeedback(f=>f==='liked'?null:'liked'),onDislike:()=>setFeedback(f=>f==='disliked'?null:'disliked')}))));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountMenuFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(TooltipProvider,null,React.createElement(Fixture)))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__more_menu_fixture.js"')
let oldCssModule
if (baseline) {
  const oldMenu = execFileSync('git', ['show', 'HEAD:src/features/player/styles/player/more-actions-menu.css'], {encoding:'utf8'})
  const oldResponsive = execFileSync('git', ['show', 'HEAD:src/features/player/styles/player/responsive.css'], {encoding:'utf8'})
  const legacyStart = oldResponsive.indexOf('@media (max-width: 700px) {\n  .more-actions-menu')
  const legacyEnd = oldResponsive.indexOf('@media (prefers-reduced-motion: reduce)', legacyStart)
  const module = await (await fetch(origin + '/src/features/player/styles/player.css')).text()
  const match = module.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/)
  assert(match, 'Vite bundled CSS')
  const css = JSON.parse(match[1])
  const start = css.indexOf('.more-actions-overlay[data-slot=')
  const end = css.indexOf('.press-feedback-button {', start)
  assert(start >= 0 && end > start, 'isolate menu stylesheet in bundle')
  const replaced = css.slice(0,start) + oldMenu + '\n' + css.slice(end) + '\n' + oldResponsive.slice(legacyStart,legacyEnd)
  oldCssModule = module.replace(match[0], () => 'const __vite__css = ' + JSON.stringify(replaced))
}
const screenshotDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(),'spmusic-more-actions-menu-leading')
mkdirSync(screenshotDirectory,{recursive:true})
const browser = await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge'})
const results=[]
let passed=0
async function open(width=900,height=720) {
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'})
  page.setDefaultTimeout(10000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(()=>{
    const NativeResizeObserver=window.ResizeObserver
    const stats={observed:0,disconnected:0,active:0}
    window.menuResizeObserverStats=stats
    window.ResizeObserver=class extends NativeResizeObserver {
      targets=new Set()
      observe(target,options){
        if(target.classList.contains('more-actions-leading')&&!this.targets.has(target)){this.targets.add(target);stats.observed++;stats.active++}
        return super.observe(target,options)
      }
      unobserve(target){if(this.targets.delete(target)){stats.disconnected++;stats.active--}return super.unobserve(target)}
      disconnect(){stats.disconnected+=this.targets.size;stats.active-=this.targets.size;this.targets.clear();return super.disconnect()}
    }
  })
  await page.route('**/__more_menu_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__more_menu_test',route=>route.fulfill({contentType:'text/html',body:html}))
  if(oldCssModule)await page.route('**/src/features/player/styles/player.css*',route=>route.fulfill({contentType:'text/javascript',body:oldCssModule}))
  await page.goto(origin+'/__more_menu_test')
  await page.locator('.more-button').waitFor()
  await page.evaluate(()=>document.fonts.ready)
  await page.locator('.more-button').click()
  await page.locator('.more-actions-menu').waitFor()
  if(!baseline)await page.waitForFunction(()=>{
    const menu=document.querySelector('.more-actions-menu')
    return parseFloat(getComputedStyle(menu).getPropertyValue('--more-leading-height'))>0
  })
  await settleGeometry(page)
  return {page,errors}
}
async function metrics(page) {
  return page.evaluate(()=>{
    const menu=document.querySelector('.more-actions-menu'),s=getComputedStyle(menu),rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},actions=[...menu.querySelectorAll('.more-action')]
    const leading=menu.querySelector('.more-actions-leading')
    return {layout:document.querySelector('[data-player-layout]').dataset.playerLayout,viewport:{width:innerWidth,height:innerHeight},menu:rect(menu),leading:leading?rect(leading):null,scroll:{height:menu.scrollHeight,client:menu.clientHeight,top:menu.scrollTop,overflow:s.overflowY},paddingBottom:parseFloat(s.paddingBottom),fontSize:parseFloat(getComputedStyle(actions[0].querySelector('strong')).fontSize),cover:rect(menu.querySelector('.more-menu-cover')),feedback:[...menu.querySelectorAll('.more-feedback-action')].map(rect),actions:actions.map(el=>({label:el.textContent,disabled:el.disabled,...rect(el)}))}
  })
}
async function settleGeometry(page) {
  await page.evaluate(async()=>{
    const menu=document.querySelector('.more-actions-menu')
    // The shared Dialog duration class transitions geometry during a resize.
    // Await actual finite CSS animations rather than substituting a timed delay.
    await Promise.all(menu.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})))
  })
}
function isRestricted(m){return m.layout!=='full'&&!(m.layout==='compact'&&m.viewport.width>=800&&m.viewport.height>=720)}
function assertFits(m,{scroll=false}={}) {
  assert(m.menu.x>=7&&m.menu.y>=7&&m.menu.right<=m.viewport.width-7&&m.menu.bottom<=m.viewport.height-7, 'menu stays inside viewport: '+JSON.stringify(m))
  assert.equal(m.actions.length,11,'every existing action retained')
  assert(m.actions.every(a=>a.disabled),'unimplemented actions stay unavailable')
  assert(m.fontSize>=13,'action copy stays readable')
  assert(m.feedback.every(r=>r.height>=32&&r.width>=32),'feedback targets stay usable')
  assert(m.actions.every(a=>a.x>=m.menu.x&&a.right<=m.menu.right+1),'actions do not overflow horizontally')
  if(!scroll){
    assert(m.scroll.height<=m.scroll.client+2,'normal view has no hidden or scrolling content: '+JSON.stringify(m))
    assert(m.actions.every(a=>a.y>=m.menu.y&&a.bottom<=m.menu.bottom),'all actions fully visible')
    assert(m.menu.bottom-m.actions.at(-1).bottom<=m.paddingBottom+3,'height ends at content padding without fixed-height blank space')
  }
}
function assertInitialDisplay(m) {
  if(!isRestricted(m)){assertFits(m);return}
  assertFits(m,{scroll:true})
  assert.equal(m.scroll.top,0,'menu opens at the beginning')
  assert(m.scroll.height>m.scroll.client+2&&['auto','scroll'].includes(m.scroll.overflow),'secondary group remains accessible in a scrolling menu')
  assert(m.actions.slice(0,6).every(a=>a.y>=m.menu.y&&a.bottom<=m.menu.bottom+1),'initial menu shows the complete first group')
  assert(m.cover.y>=m.menu.y&&m.cover.bottom<=m.menu.bottom,'track artwork fully visible initially')
  assert(m.feedback.every(a=>a.y>=m.menu.y&&a.bottom<=m.menu.bottom),'track feedback fully visible initially')
  assert(m.actions.slice(6).every(a=>a.y>=m.menu.bottom-1),'secondary actions begin below the initial viewport')
  assert(m.leading&&Math.abs(m.leading.bottom-m.menu.bottom)<=2,'initial menu ends at the divider after the first group')
  if(m.layout==='horizontal')for(let row=0;row<3;row++){
    const [left,right]=m.actions.slice(row*2,row*2+2)
    assert(Math.abs(left.y-right.y)<1&&right.x>left.x,'horizontal first group has two sequential actions in each of three rows')
  }
}
async function assertWheelAccess(page,name) {
  const m=await metrics(page)
  await page.mouse.move(m.menu.x+m.menu.width/2,m.menu.y+m.menu.height/2)
  await page.mouse.wheel(0,Math.max(1000,m.scroll.height))
  await page.waitForFunction(()=>{
    const menu=document.querySelector('.more-actions-menu'),r=menu.getBoundingClientRect(),last=menu.querySelector('.more-action-grid-secondary .more-action:last-child').getBoundingClientRect()
    return menu.scrollTop>0&&last.bottom<=r.bottom+1&&last.top>=r.top
  })
  const end=await metrics(page)
  assert(end.actions.at(-1).y>=end.menu.y&&end.actions.at(-1).bottom<=end.menu.bottom+1,'wheel reaches the last secondary action')
  if(name)await page.screenshot({path:join(screenshotDirectory,name+'-scrolled.png')})
}
async function check(name,run,width,height) {
  if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
  const {page,errors}=await open(width,height)
  try {await run(page);assert.deepEqual(errors,[],'no uncaught browser errors');console.log('PASS',name);passed++}finally{await page.close()}
}
try {
  const views=[['full',2560,1440],['horizontal',1920,800],['vertical',1200,1400],['quarter',800,1280],['compact',900,720]]
  for(const [layout,width,height] of views)await check(layout+' initial content and scrolling',async page=>{
    const m=await metrics(page);assert.equal(m.layout,layout);results.push(m)
    if(!baseline)assertInitialDisplay(m)
    console.log('VIEW_SIZE',layout,m.menu.width,m.menu.height,'font',m.fontSize)
    await page.screenshot({path:join(screenshotDirectory,(baseline?'baseline-':'')+layout+'.png')})
    if(!baseline&&isRestricted(m))await assertWheelAccess(page,layout)
  },width,height)
  if(!baseline){
    if(results.length===5)assert(results[0].menu.width>results[1].menu.width&&results[1].menu.width>results[2].menu.width&&results[2].menu.width>results[4].menu.width,'sizes follow full, horizontal, portrait, compact views')
    await check('long text, missing artwork and feedback state',async page=>{
      await page.evaluate(()=>window.menuFixture.longTitle())
      await page.locator('.more-track-title').filter({hasText:'很长的歌曲名称'}).waitFor()
      assertFits(await metrics(page))
      assert.equal(await page.locator('.more-menu-cover-mark').count(),1,'missing artwork uses real placeholder')
      const like=page.locator('.more-actions-menu').getByRole('button',{name:'喜欢',exact:true}),dislike=page.locator('.more-actions-menu').getByRole('button',{name:'不喜欢',exact:true})
      await like.click();assert.equal(await like.getAttribute('aria-pressed'),'true')
      await dislike.click();assert.equal(await dislike.getAttribute('aria-pressed'),'true');assert.equal(await like.getAttribute('aria-pressed'),'false')
      await dislike.click();assert.equal(await dislike.getAttribute('aria-pressed'),'false')
      // Move off the feedback tooltip before testing the parent modal's Escape.
      await page.locator('.more-track-title').hover()
      await page.waitForFunction(()=>!document.querySelector('.more-feedback-action[data-popup-open]'))
      await page.keyboard.press('Escape');await page.locator('.more-actions-menu').waitFor({state:'detached'})
      assert.equal(await page.locator('.more-button').evaluate(el=>el===document.activeElement),true,'Escape restores trigger focus')
      await page.locator('.more-button').click();await page.locator('.more-actions-menu').waitFor()
      await page.mouse.click(4,4);await page.locator('.more-actions-menu').waitFor({state:'detached'})
      assert.equal(await page.locator('.more-button').evaluate(el=>el===document.activeElement),true,'outside click restores trigger focus')
    })
    await check('resize open menu through all resolver layouts',async page=>{
      for(const [layout,width,height] of views){await page.setViewportSize({width,height});await page.waitForFunction(layout=>document.querySelector('[data-player-layout]').dataset.playerLayout===layout,layout);await settleGeometry(page);assertInitialDisplay(await metrics(page));assert.equal(await page.evaluate(()=>window.menuResizeObserverStats.active),1,'resize retains exactly one observer for the leading group')}
      await page.keyboard.press('Tab');assert.equal(await page.locator('.more-actions-menu').evaluate(el=>el.contains(document.activeElement)),true,'keyboard stays in modal')
    })
    for(const [width,height] of [[640,720],[576,648]])await check('small Compact first group and wheel '+width+'x'+height,async page=>{
      const m=await metrics(page);assert.equal(m.layout,'compact');assertInitialDisplay(m)
      await page.screenshot({path:join(screenshotDirectory,'compact-small-'+width+'.png')})
      await assertWheelAccess(page,'compact-small-'+width)
    },width,height)
    for(const [width,height] of [[1920,720],[1723,720],[1552,648]])await check('horizontal lower bound '+width+'x'+height,async page=>{
      const m=await metrics(page);assert.equal(m.layout,'horizontal');assertInitialDisplay(m)
      await assertWheelAccess(page)
      console.log('HORIZONTAL_BOUND',width,height,m.menu.width,m.menu.height)
    },width,height)
    await check('short window permits scrolling to last action',async page=>{
      const m=await metrics(page);assertFits(m,{scroll:true})
      if(m.scroll.height>m.scroll.client+2)assert(['auto','scroll'].includes(m.scroll.overflow),'short viewport scrolls instead of clipping')
      await assertWheelAccess(page)
    },640,360)
    await check('StrictMode repeated mount close and observer cleanup',async page=>{
      assert.equal(await page.evaluate(()=>window.menuResizeObserverStats.active),1,'one active leading observer')
      for(let index=0;index<3;index++){
        await page.mouse.click(4,4);await page.locator('.more-actions-menu').waitFor({state:'detached'})
        assert.equal(await page.evaluate(()=>window.menuResizeObserverStats.active),0,'closing disconnects observer')
        await page.locator('.more-button').click();await page.locator('.more-actions-menu').waitFor();await settleGeometry(page)
        assert.equal(await page.evaluate(()=>window.menuResizeObserverStats.active),1,'reopening creates one observer without retaining previous observer')
      }
      await page.evaluate(()=>window.unmountMenuFixture())
      assert.equal(await page.evaluate(()=>window.menuResizeObserverStats.active),0,'unmount disconnects observer')
      await page.setViewportSize({width:640,height:720})
      console.log('OBSERVER_LIFECYCLE',await page.evaluate(()=>window.menuResizeObserverStats))
    })
    if(!process.env.SPMUSIC_TEST_FILTER||process.env.SPMUSIC_TEST_FILTER==='demo'){
      const page=await browser.newPage({viewport:{width:900,height:720},reducedMotion:'reduce'})
      try{
        await page.goto(origin+'/demo-player.html')
        await page.locator('.more-button').first().click()
        await page.locator('.more-actions-menu canvas').waitFor()
        await page.evaluate(()=>document.fonts.ready)
        assertFits(await metrics(page))
        await page.screenshot({path:join(screenshotDirectory,'compact-demo-artwork.png')})
        console.log('PASS real demo menu with dynamic artwork');passed++
      }finally{await page.close()}
    }
  }
  console.log('MENU_GEOMETRY',JSON.stringify(results))
  console.log('SCREENSHOTS',screenshotDirectory)
  console.log('Passed',passed,'more menu checks'+(baseline?' (baseline measurements only)':''))
}finally{await browser.close()}
