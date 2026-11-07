// Independent Figma 7756:6360 acceptance: ten folder-card variants in both roots and mixed directories.
// SPMUSIC_FOLDER_LAYOUT_BASELINE=1 records pre-change geometry without accepting it as the target.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${name}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {FolderHierarchyPanel} from '/src/features/player/components/FolderHierarchyPanel.tsx';
import {createAllSongsCoverStore} from '/src/features/player/hooks/useAllSongsWindow.ts';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{};
function Fixture(){
 const [spec,setSpec]=React.useState({level:0,count:1,stage:'root'});const store=React.useMemo(createAllSongsCoverStore,[]);
 window.configureFolderCards=next=>{localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1',String(next.level));setSpec(next)};
 const base=spec.count===1?'/D:':'/非常长的上一级文件夹名称 Parent 0123456789';
 const names=Array.from({length:spec.count},(_,i)=>i===0?'Music':i===1?'超长文件夹名称・Long folder name '.repeat(4):i===2?'名字含有空格 (合集) #02': '最后一个文件夹');
 const roots=names.map(name=>({path:base+'/'+name,directoryPaths:[base+'/'+name],status:'ready'}));
 const songs=roots.map((root,i)=>({key:root.path+'/song.flac',scope:'folder-'+i,trackId:'track-'+i,sourcePath:root.path+'/song.flac',available:true,track:{id:'track-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:383496,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false}}));
 const direct={key:base+'/direct.flac',scope:'direct',trackId:'direct',sourcePath:base+'/direct.flac',available:true,track:{id:'direct',title:'Direct song',artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false}};
 const library={isOpen:true,route:{view:'category',categoryId:'folders'},items:[],allSongs:spec.stage==='mixed'?[direct,...songs]:songs,allSongsMetadataStatus:'ready',folderRoots:spec.stage==='mixed'?[{path:base,directoryPaths:[base,...roots.map(root=>root.path)],status:'ready'}]:roots,folderLocation:spec.stage==='mixed'?{rootPath:base,directoryPath:base}:null,onFolderLocationChange:noop,currentScope:null,activeScope:null,onOpen:noop,onSelect:noop,onSelectCategory:noop,onOpenOverview:noop,onPlay:noop,onPlaySong:noop,onShufflePlay:()=>true,onSelectFolders:noop};
 const playlist={isOpen:true,library,tracks:[],shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onOpenChange:noop,isOpenAudioDisabled:false};
 return React.createElement('main',{className:'player-shell','data-layout-fixture':spec.stage+':'+spec.level+':'+spec.count},React.createElement(FolderHierarchyPanel,{key:spec.stage+':'+spec.level+':'+spec.count,playlist,allSongsCoverStore:store,librarySidebarOpen:false,onLibrarySidebarOpenChange:noop}));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__folder_card_layouts_fixture.js"')
const baseline = process.env.SPMUSIC_FOLDER_LAYOUT_BASELINE === '1'
const directory = process.env.SPMUSIC_TEST_SCREENSHOTS || 'C:/Users/winkeses/.codex/tmp/folder-card-layouts'
mkdirSync(directory, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const failures = [], report = [], errors = []
const expect = (condition, message) => { if (!condition) failures.push(message) }
const near = (actual, expected) => Math.abs(actual - expected) <= 1
async function measure(page) {
  return page.locator('.folder-row').evaluateAll(rows => rows.map(row => {
    const part = selector => {
      const node=row.querySelector(selector)
      if(!node)return null
      const r=node.getBoundingClientRect(),s=getComputedStyle(node)
      return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,font:Number.parseFloat(s.fontSize),radius:s.borderRadius,display:s.display,visible:r.width>0&&r.height>0&&s.display!=='none',text:node.textContent,overflow:s.overflow,textOverflow:s.textOverflow,src:node.getAttribute('src'),color:s.color,background:s.backgroundColor,mask:s.maskImage}
    }
    const r=row.getBoundingClientRect(), cover=row.querySelector('.folder-cover'), icon=row.querySelector('.folder-row-icon'),rowStyle=getComputedStyle(row)
    const badge=icon?.closest('.folder-cover')?icon.parentElement:null
    const b=badge?.getBoundingClientRect(),bs=badge?getComputedStyle(badge):null
    return {row:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,radius:rowStyle.borderRadius},variant:row.dataset.folderVariant,cover:part('.folder-cover'),copy:part('.folder-copy'),name:part('.folder-name'),parent:part('.folder-parent-name'),meta:part('.folder-meta'),music:part('.folder-music-icon'),icon:part('.folder-row-icon'),badge:b?{x:b.x,y:b.y,right:b.right,width:b.width,height:b.height,padding:bs.padding,background:bs.backgroundColor}:null,coverHasIcon:Boolean(cover?.contains(icon))}
  }))
}
function verify(sample) {
  const {width,level,stage,count,rows}=sample, key=`${stage}/${width}/L${level}/${count}`
  expect(rows.length===count,`${key}: folder count`)
  if((level===7||level===8)&&count>=4){
    const expectedGap=level===7?12:4
    for(let index=1;index<rows.length;index++)expect(near(rows[index].row.y-rows[index-1].row.bottom,expectedGap),`${key}: actual card gap is ${expectedGap}px`)
    if(level===8){
      const lessDense=report.find(item=>item.width===width&&item.stage===stage&&item.count===count&&item.level===7)
      expect(Boolean(lessDense),`${key}: less dense card comparison exists`)
      rows.forEach((row,index)=>{
        const previous=lessDense?.rows[index]
        for(const part of ['row','copy','name','meta','music','icon'])expect(near(row[part]?.width??0,previous?.[part]?.width??0)&&near(row[part]?.height??0,previous?.[part]?.height??0),`${key}: ${part} geometry matches level7`)
      })
    }
  }
  for(const row of rows){
    if(level>=3&&level<=5){
      expect(row.meta?.color==='rgb(150, 205, 248)',`${key}: statistics use inverse-primary`)
      expect(row.music?.color===row.meta?.color&&row.music?.background===row.meta?.color&&row.music?.mask!=='none',`${key}: music uses the statistics color through its SVG mask`)
    }
    expect(row.row.radius==='20px',`${key}: outer card radius ${row.row.radius} expected20px`)
    const v=part=>Boolean(row[part]?.visible)
    const n=(part,size)=>expect(near(row[part]?.font??0,size),`${key}: ${part} font ${row[part]?.font} expected ${size}`)
    const cover=(w,h)=>{expect(v('cover')&&near(row.cover.width,w)&&near(row.cover.height,h),`${key}: cover ${row.cover?.width}x${row.cover?.height} expected ${w}x${h}`);expect(row.cover?.radius==='20px',`${key}: cover radius ${row.cover?.radius} expected20px`)}
    const icon=size=>expect(v('icon')&&near(row.icon.width,size)&&near(row.icon.height,size),`${key}: folder glyph expected ${size}`)
    if(level<=2){
      const size=[240,155,120][level];cover(size,size);n('name',16);n('parent',14);icon([28,24,16][level]);
      expect(near(row.row.width,[270,185,130][level]),`${key}: tile outer width ${row.row.width}`)
      expect(!v('meta')&&v('parent'),`${key}: tile has parent and no statistics`)
      expect(row.coverHasIcon&&row.badge?.background==='rgb(255, 255, 255)'&&row.badge?.padding==='5px',`${key}: folder glyph sits in white padded cover badge`)
      expect(row.badge&&near(row.badge.width,[38,34,26][level])&&near(row.badge.height,[38,34,26][level])&&near(row.badge.y-row.cover.y,10)&&near(row.cover.right-row.badge.right,10),`${key}: badge matches its top-right10px slot and padded glyph bounds`)
    }else if(level<=4){
      cover(...(level===3?[240,165]:[155,107]));n('name',level===3?32:28);n('parent',28);n('meta',level===3?28:24);icon(48)
      expect(v('parent')&&v('meta')&&!row.coverHasIcon,`${key}: row has parent/statistics and trailing folder glyph`)
      expect(v('music')&&near(row.music.width,level===3?22.667:24)&&near(row.music.height,level===3?26.667:24),`${key}: row music glyph matches its Figma slot`)
    }else if(level===5||level===6){
      if(level===5)cover(64,64);else{
        expect(!v('cover'),`${key}: text-L has no cover`)
        expect(near(row.copy?.height??0,88)&&near(row.copy.width,row.row.width-30),`${key}: text-L body height88 and fills the card content width`)
        expect(near(row.copy.right,row.row.right-15)&&near(row.icon.right,row.copy.right)&&near(row.meta.right,row.copy.right),`${key}: text-L content, folder glyph and statistics reach the available right edge`)
      }
      n('name',24);n('parent',16);n('meta',14);icon(32)
      expect(v('parent')&&row.parent.y>row.name.y+20,`${key}: parent belongs on the second line`)
      expect(near(row.name.y+row.name.height/2,row.icon.y+row.icon.height/2),`${key}: name and folder glyph share first line`)
      expect(near(row.parent.y+row.parent.height/2,row.meta.y+row.meta.height/2),`${key}: parent and statistics share second line`)
      expect(v('music')&&near(row.music.width,16)&&near(row.music.height,16),`${key}: small second-line music glyph is16`)
    }else{
      expect(!v('cover')&&!v('parent')&&v('meta'),`${key}: compact text has name/statistics only`);n('name',24);n('meta',14);icon(16)
      expect(near(row.name.y+row.name.height/2,row.meta.y+row.meta.height/2)&&near(row.name.y+row.name.height/2,row.icon.y+row.icon.height/2),`${key}: compact text fields share one line`)
      if(level===9)expect(near(row.row.width,270)&&near(row.copy?.width??0,240),`${key}: double text outer270/content240`)
      expect(v('music')&&near(row.music.width,16)&&near(row.music.height,16),`${key}: compact music glyph is16`)
    }
    for(const part of ['cover','copy','name','parent','meta','music','icon'])if(v(part)){
      expect(row[part].x>=row.row.x-1&&row[part].right<=row.row.right+1,`${key}: ${part} stays within horizontal card bounds`)
      expect(row[part].y>=row.row.y-1&&row[part].bottom<=row.row.bottom+1,`${key}: ${part} stays within vertical card bounds`)
    }
  }
}
try {
  for(const width of [640,1920]){
    const page=await browser.newPage({viewport:{width,height:1440},reducedMotion:'reduce'})
    page.on('pageerror',error=>errors.push(error.message))
    await page.addInitScript(()=>localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1','0'))
    await page.route('**/__folder_card_layouts_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
    await page.route('**/__folder_card_layouts_test',route=>route.fulfill({contentType:'text/html',body:html}))
    await page.goto(origin+'/__folder_card_layouts_test')
    await page.locator('.folder-row').first().waitFor();await page.evaluate(()=>document.fonts.ready)
    for(const stage of ['root','mixed'])for(const count of [1,4])for(let level=0;level<10;level++){
      await page.evaluate(spec=>window.configureFolderCards(spec),{level,stage,count})
      await page.waitForFunction(key=>document.querySelector('[data-layout-fixture]')?.dataset.layoutFixture===key,`${stage}:${level}:${count}`)
      const rows=await measure(page), sample={width,stage,count,level,rows};report.push(sample)
      verify(sample)
      if(width===640&&stage==='root'&&count===1&&level>=3&&level<=5){
        await page.locator('.player-shell').evaluate(node=>node.style.setProperty('--player-inverse-primary','#c64e91'))
        const themed=await measure(page)
        expect(themed.every(row=>row.meta?.color==='rgb(198, 78, 145)'&&row.music?.color===row.meta.color&&row.music?.background===row.meta.color),`${stage}/${width}/L${level}: statistics and music follow a custom inverse-primary token`)
        await page.locator('.player-shell').evaluate(node=>node.style.removeProperty('--player-inverse-primary'))
      }
      if(count===1||level>=5)await page.screenshot({path:`${directory}/${stage}-${width}-level-${level}-${count===1?'single':'long'}.png`})
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${stage}/${width}/L${level}/${count}: no document horizontal overflow`)
      if(stage==='mixed')expect(await page.locator('.folder-songs').getAttribute('data-layout-flow')===['tile','tile','tile','row','row','row','text','text','text','text'][level],`${stage}/${width}/L${level}/${count}: song and folder flow stay synchronized`)
    }
    await page.close()
  }
  writeFileSync(`${directory}/geometry.json`,JSON.stringify({report,failures,errors},null,2))
  console.log(`${baseline?'BASELINE':'FINAL'} folder card layouts: ${report.length} cases, ${failures.length} design mismatches, ${errors.length} runtime errors; ${directory}`)
  if(failures.length)console.log(failures.slice(0,45).join('\n'))
  assert.deepEqual(errors,[],'no browser runtime errors')
  if(!baseline)assert.deepEqual(failures,[],'all ten folder variants match the Figma geometry and visible fields')
}finally{await browser.close()}
