// Real artwork hook and real display canvas. Candidate publication is fixture data.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()+await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const dep=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match,name);return match[1]}
let hook=await(await fetch(origin+'/src/features/player/hooks/useArtworkVisualResource.ts')).text()
hook=hook.replace('setPaintedPreviewTokenId(preview.previewTokenId);',`window.order.push({type:'mark-ready',token:preview.previewTokenId,layer:preview.id,time:performance.now()});setPaintedPreviewTokenId(preview.previewTokenId);`)
 .replace('if (!previewToken) return;\n\t\tsetPaintedPreviewTokenId(null);',`if (!previewToken) return;window.order.push({type:'reset-null',token:previewToken.id,painted:[...paintedLayerIdsRef.current],existing:layersRef.current.some(layer=>layer.previewTokenId===previewToken.id),time:performance.now()});\n\t\tsetPaintedPreviewTokenId(null);`)
 .replace('const previewArtworkReady =',`window.readPainted=()=>({token:previewToken?.id,paintedToken:paintedPreviewTokenId,paintedLayers:[...paintedLayerIdsRef.current]});const previewArtworkReady =`)
const fixture=`
import React from '${dep('react.js')}';import ReactDOM from '${dep('react-dom_client.js')}';import ReactDOMCore from '${dep('react-dom.js')}';
import {useArtworkVisualResource} from '/src/features/player/hooks/useArtworkVisualResource.ts';
import {ArtworkCanvas} from '/src/features/player/components/ArtworkCanvas.tsx';
window.order=[];
const tracks=['A','B'].map((id,index)=>({id,title:id,artist:'Artist',album:'Album',coverTone:'lagoon',durationSeconds:180,lyrics:[],coverImage:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="'+(index?'blue':'red')+'"/></svg>')}));
const artworks=tracks.map(track=>({id:track.id,resourceKey:track.id,coverTone:track.coverTone,coverImage:track.coverImage}));
function Harness(){
 const[token,setToken]=React.useState(null),[candidates,setCandidates]=React.useState([]),[show,setShow]=React.useState(false);
 const visual=useArtworkVisualResource(artworks[0],tracks[0],false,candidates,0,null,token);
 const latched=React.useRef(false);
 React.useLayoutEffect(()=>{window.order.push({type:'observer',ready:visual.previewArtworkReady,time:performance.now()});if(visual.previewArtworkReady)latched.current=true},[visual.previewArtworkReady]);
 window.api={begin:()=>setToken({id:1,originTrackId:'A',targetTrackId:'B',direction:1,track:tracks[1],artwork:artworks[1]}),show:()=>setShow(true),publish:()=>setCandidates(previous=>[...previous]),both:()=>ReactDOMCore.flushSync(()=>{setShow(true);setCandidates(previous=>[...previous])}),snapshot:()=>({ready:visual.previewArtworkReady,latched:latched.current,painted:window.readPainted(),layers:visual.slots.map(layer=>layer&&({id:layer.id,phase:layer.phase,token:layer.previewTokenId,track:layer.track.id,view:Boolean(layer.resource.view)}))})};
 return React.createElement('main',null,visual.slots.filter(Boolean).map(layer=>layer.phase==='preview'&&!show?null:React.createElement(ArtworkCanvas,{key:layer.id,className:'display',source:layer.resource.view,label:layer.track.id,onReady:()=>{window.order.push({type:'canvas-ready',layer:layer.id,time:performance.now()});visual.markReady(layer.id)}})));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__preview_readiness.js"').replace('</head>','<style>.display{display:block;width:180px;height:180px}</style></head>')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
let passed=0
try{
 for(const sameCommit of [false,true]){
  if(process.env.SPMUSIC_READINESS_MODE&&process.env.SPMUSIC_READINESS_MODE!==(sameCommit?'same':'stable'))continue
  const page=await browser.newPage({viewport:{width:800,height:600}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  try{
   await page.route('**/src/features/player/hooks/useArtworkVisualResource.ts*',route=>route.fulfill({contentType:'text/javascript',body:hook}))
   await page.route('**/__preview_readiness.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
   await page.route('**/__preview_readiness_test',route=>route.fulfill({contentType:'text/html',body:html}))
   await page.goto(origin+'/__preview_readiness_test')
   await page.waitForFunction(()=>window.api?.snapshot().layers.some(layer=>layer?.phase==='active'))
   await page.evaluate(()=>window.api.begin())
   await page.waitForFunction(()=>window.api.snapshot().layers.some(layer=>layer?.phase==='preview'&&layer.view))
   assert.equal(await page.evaluate(()=>window.api.snapshot().ready),false,'a source view alone is not a painted preview')
   await page.evaluate(()=>window.api.publish())
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   assert.equal(await page.evaluate(()=>window.api.snapshot().ready),false,'republishing candidates cannot promote an unpainted preview')
   if(sameCommit)await page.evaluate(()=>window.api.both())
   else{
    await page.evaluate(()=>window.api.show())
    await page.waitForFunction(()=>window.api.snapshot().ready)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.evaluate(()=>{window.order.push({type:'republish',time:performance.now()});window.api.publish()})
   }
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   const result=await page.evaluate(()=>({snapshot:window.api.snapshot(),order:window.order}))
   const path=join(tmpdir(),'spmusic-preview-readiness-'+(process.env.SPMUSIC_READINESS_LABEL||'current')+'-'+(sameCommit?'same':'stable')+'.json')
   writeFileSync(path,JSON.stringify(result,null,2));console.log('READINESS',JSON.stringify({sameCommit,...result,path}))
   assert.deepEqual(errors,[])
   assert.equal(result.snapshot.ready,true,'a painted bound preview stays ready across equivalent candidate publication')
   passed++
  }finally{await page.close()}
 }
}finally{await browser.close()}
console.log(JSON.stringify({passed}))
