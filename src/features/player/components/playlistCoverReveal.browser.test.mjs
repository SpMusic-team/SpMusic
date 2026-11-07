// Real Card + image decoder + theme/CSS. Start Vite and provide Playwright.
// Predecoding is intentional: first presentation must animate even when the
// image is already ready, while the same retained resource remounts immediately.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const only=process.env.SPMUSIC_REVEAL_ONLY
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{
  const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'resolve '+name)
  return match[1]
}
const fixture=`
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlaylistCard} from '/src/features/player/components/PlaylistCard.tsx';
import {PLAYLIST_SONG_LAYOUTS} from '/src/features/player/model/playlistSongLayouts.ts';
import {decodePlaylistCover,isPlaylistCoverDecoded,isPlaylistCoverPresented} from '/src/features/player/model/playlistCoverReadiness.ts';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{};window.images={};window.parentRenders=0;window.coverErrors=[];
window.prepare=async name=>{const blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="'+(name.includes('second')?'#31aeba':'#b83c75')+'"/></svg>'],{type:'image/svg+xml'});const image={src:URL.createObjectURL(blob),width:128,height:128,encodedBytes:blob.size};await decodePlaylistCover(image);window.images[name]=image;return {decoded:isPlaylistCoverDecoded(image),presented:isPlaylistCoverPresented(image)}};
window.prepareFailure=name=>{window.images[name]={src:URL.createObjectURL(new Blob(['invalid image'],{type:'image/png'})),width:128,height:128,encodedBytes:13}};
function Fixture(){
 const theme=useAppearance();const [state,setState]=React.useState({show:false,kind:'thumbnail',name:null,key:0,offscreen:false,fallback:null});window.parentRenders++;
 window.showCover=(kind,name,options={})=>setState(previous=>({...previous,show:true,kind,name,...options}));
 window.hideCover=()=>setState(previous=>({...previous,show:false}));
 window.setMotion=level=>theme.previewAppearance({...theme.appearance,motion:{...theme.appearance.motion,level}});
 window.motionDisabled=theme.motion.disabled;
 const image=state.name?window.images[state.name]:undefined;
 const track={id:'test-song',title:'Song',artist:'Artist',album:'Album',coverTone:'lagoon',hasLocalArtwork:true,
   ...(state.kind==='thumbnail'?{coverThumbnail:image}:{}),...(state.fallback?{coverImageFallback:window.images[state.fallback].src}:{})};
 return React.createElement('section',{id:'reveal-scroll',style:{width:500,height:300,overflow:'auto',position:'relative',margin:80}},
   state.offscreen&&React.createElement('div',{style:{height:700}}),
   React.createElement('div',{className:'playlist-grid','data-layout-level':'2','data-layout-flow':'tile','data-layout-columns':'4','data-cover-motion':theme.motion.disabled?'off':undefined,
     style:{...PLAYLIST_SONG_LAYOUTS[2].style,display:'grid',gridTemplateColumns:'160px',gap:12}},state.show&&React.createElement(PlaylistCard,{key:state.key,track,
       ...(state.kind==='url'?{coverUrl:image.src}:{}),current:false,unavailable:false,canActivate:true,selectMode:false,selected:false,artworkVisible:true,showExtendedMetadata:false,contentVisible:true,contentRepresentative:true,contentShape:3,coverFailed:false,
       onCoverFailed:(...args)=>window.coverErrors.push(args),onActivate:noop,onToggleSelect:noop})))
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountReveal=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__reveal_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge'})
let passed=0
async function open(reducedMotion='no-preference'){
  const page=await browser.newPage({viewport:{width:1000,height:800},reducedMotion})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/__reveal_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__reveal_test',route=>route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__reveal_test')
  await page.waitForFunction(()=>typeof window.showCover==='function')
  await page.evaluate(()=>document.fonts.ready)
  return {page,errors}
}
async function sample(page,action,duration=420){
  return page.evaluate(async({action,duration})=>{
    const frames=[],start=performance.now()
    const capture=()=>{
      const image=document.querySelector('.playlist-card-cover-image')
      if(!image)return
      const rect=image.getBoundingClientRect(),style=getComputedStyle(image)
      frames.push({time:performance.now()-start,opacity:Number(style.opacity),transform:style.transform,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
        loaded:image.dataset.loaded,complete:image.complete&&image.naturalWidth>0,hidden:image.hidden,parentRenders:window.parentRenders,
        animations:image.getAnimations().filter(animation=>animation.playState==='running').map(animation=>({duration:animation.effect.getComputedTiming().duration,iterations:animation.effect.getTiming().iterations}))})
    }
    if(action.type==='show')window.showCover(action.kind,action.name,action.options)
    else if(action.type==='remount'){window.hideCover();await new Promise(requestAnimationFrame);window.showCover(action.kind,action.name,{key:action.key})}
    else if(action.type==='scroll')document.querySelector('#reveal-scroll').scrollTop=800
    else if(action.type==='motion')window.setMotion(action.level)
    while(performance.now()-start<duration){await new Promise(requestAnimationFrame);capture()}
    return frames
  },{action,duration})
}
function stableGeometry(frames){
  assert(frames.length>2)
  const first=frames[0]
  assert(first.width>50&&first.height>50,'the actual cover has visible nonzero layout dimensions')
  assert(frames.every(frame=>['x','y','width','height'].every(key=>Math.abs(frame[key]-first[key])<.1)),'cover reveal changes no layout geometry')
  assert(frames.every(frame=>frame.transform==='none'||frame.transform==='matrix(1, 0, 0, 1, 0, 0)'),'reference reveal has no slide or scale')
}
function revealed(frames,label){
  stableGeometry(frames)
  assert(frames.some(frame=>frame.complete&&frame.opacity>.02&&frame.opacity<.98),label+' contains a visible opacity intermediate after predecode')
  assert(frames.at(-1).complete&&frames.at(-1).opacity>.999,label+' finishes fully visible')
  assert.equal(new Set(frames.map(frame=>frame.parentRenders)).size,1,'cover animation stays local and never rerenders its parent')
  const durations=frames.flatMap(frame=>frame.animations.map(animation=>animation.duration))
  if(durations.length)assert(durations.every(duration=>duration>=150&&duration<=300),'default reveal stays near the 200ms reference')
}
function immediatelyVisible(frames,label){
  stableGeometry(frames)
  assert(frames.every(frame=>frame.complete&&frame.opacity>.999&&!frame.hidden),label+' never returns to a transparent placeholder: '+JSON.stringify(frames.filter(frame=>!frame.complete||frame.opacity<=.999||frame.hidden).slice(0,5)))
  assert(frames.every(frame=>frame.animations.length===0),label+' never starts a second reveal')
}
try{
  for(const kind of ['thumbnail','url']){
    if(only&&only!==kind)continue
    const {page,errors}=await open()
    try{
      assert.deepEqual(await page.evaluate(name=>window.prepare(name),kind+'-first'),{decoded:true,presented:false})
      const first=await sample(page,{type:'show',kind,name:kind+'-first'})
      revealed(first,kind+' cold first presentation')
      immediatelyVisible(await sample(page,{type:'remount',kind,name:kind+'-first',key:1},260),kind+' warm remount')
      await page.evaluate(name=>window.prepare(name),kind+'-second')
      immediatelyVisible(await sample(page,{type:'show',kind,name:kind+'-second'},260),kind+' same-element upgrade/source replacement')
      immediatelyVisible(await sample(page,{type:'remount',kind,name:kind+'-second',key:2},260),kind+' upgraded resource warm remount')
      await page.evaluate(name=>window.prepare(name),kind+'-offscreen')
      const offscreen=await sample(page,{type:'show',kind,name:kind+'-offscreen',options:{key:3,offscreen:true}},500)
      assert(offscreen.every(frame=>frame.animations.every(animation=>animation.iterations!==Infinity)),'offscreen image never owns an unbounded animation')
      assert.equal(offscreen.at(-1).animations.length,0,'offscreen reveal cannot keep running after its finite duration')
      await sample(page,{type:'scroll'},300)
      await page.evaluate(()=>window.unmountReveal())
      assert.equal(await page.locator('.playlist-card-cover-image').count(),0)
      assert.deepEqual(errors,[])
      passed++;console.log('PASS',kind,'predecode reveal, warm remount, upgrade, offscreen and cleanup',JSON.stringify({samples:first.length,firstOpacity:first[0].opacity,finalOpacity:first.at(-1).opacity}))
    }finally{await page.close()}
  }
  for(const preference of ['off','reduce']){
    if(only&&only!==preference)continue
    const {page,errors}=await open(preference==='reduce'?'reduce':'no-preference')
    try{
      if(preference==='off')await page.evaluate(()=>window.setMotion('off'))
      await page.waitForFunction(()=>window.motionDisabled)
      for(const kind of ['thumbnail','url']){
        const name=preference+'-'+kind
        await page.evaluate(name=>window.prepare(name),name)
        immediatelyVisible(await sample(page,{type:'show',kind,name,options:{key:name}},250),preference+' '+kind)
      }
      if(preference==='off')immediatelyVisible(await sample(page,{type:'motion',level:'subtle'},280),'enabling motion keeps an already presented cover stable')
      else {
        const restoring=sample(page,{type:'observe'},280)
        await page.emulateMedia({reducedMotion:'no-preference'})
        immediatelyVisible(await restoring,'leaving reduced motion keeps an already presented cover stable')
      }
      assert.deepEqual(errors,[]);passed++;console.log('PASS',preference,'motion skips reveal for both image paths')
    }finally{await page.close()}
  }
  if(!only||only==='fallback'){
    const {page,errors}=await open()
    try{
      await page.evaluate(()=>{window.prepareFailure('broken');return window.prepare('valid-fallback')})
      const frames=await sample(page,{type:'show',kind:'url',name:'broken',options:{fallback:'valid-fallback'}})
      assert(frames.at(-1)?.complete&&frames.at(-1).opacity>.999&&!frames.at(-1).hidden,'existing error fallback renders a valid cover')
      assert.equal(await page.evaluate(()=>window.coverErrors.length),0,'successful fallback never marks the entire song failed')
      assert.equal(await page.evaluate(async()=>{const {isPlaylistCoverPresented}=await import('/src/features/player/model/playlistCoverReadiness.ts');return isPlaylistCoverPresented(window.images.broken.src)}),false,'failed URL cannot consume a first-presentation marker')
      assert.deepEqual(errors,[]);passed++;console.log('PASS','failed raw URL keeps successful fallback and leaves failed source unpresented')
    }finally{await page.close()}
  }
  console.log('PLAYLIST_COVER_REVEAL_RESULT',passed,'passed')
}finally{await browser.close()}
