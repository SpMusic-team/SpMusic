// Current hero-menu contract: natural content height, viewport-bound native scroll fallback.
// Real PlaylistPanel + shared menu; the native filesystem is not needed for this UI test.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const source=readFileSync(new URL('./playlistManagementLayouts.browser.test.mjs',import.meta.url),'utf8')
const literal=source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(literal)
let fixture=runInNewContext(literal[1],{dependency})
fixture=fixture.replace("[view,setView]=React.useState('management')","[view,setView]=React.useState('detail')")
fixture=fixture.replace('React.createElement(PlaylistPanel,{...common,library,tracks,',"React.createElement(PlaylistPanel,{...common,library,tracks,playlistName:new URLSearchParams(location.search).has('long')?'很长的播放列表名称'.repeat(30):'测试播放列表',totalDurationSeconds:Number(new URLSearchParams(location.search).get('duration')??14400),totalDurationStatus:new URLSearchParams(location.search).get('status')??'ready',onOpenAudio:()=>window.actions.push('import-audio'),isOpenAudioDisabled:new URLSearchParams(location.search).has('busy'),")
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__hero_fit_fixture.js"')
const directory=process.env.SPMUSIC_TEST_SCREENSHOTS||'C:/Users/winkeses/AppData/Local/Temp/spmusic-hero-fit-content'
mkdirSync(directory,{recursive:true})
for(const name of ['3ae57','9b2af','66817','9a79e','08f63','f277d','b969c','e41ce'])assert(statSync(new URL('../../../assets/playlist-hero-menu/'+name+'.svg',import.meta.url)).size>0)
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']})
const labels=['重新扫描','专辑封面','删除重复项','重新排序','添加地址','在侧栏置顶','列表选项'],evidence=[]
async function open(width,height,query=''){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.setDefaultTimeout(10000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>localStorage.clear())
 await page.route('**/__hero_fit_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__hero_fit_test*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__hero_fit_test'+query);await page.locator('.playlist-panel').waitFor();await page.evaluate(()=>document.fonts.ready)
 return {page,errors}
}
const trigger=page=>page.locator('.playlist-panel > .playlist-hero .playlist-hero-more-button')
const menu=page=>page.getByRole('dialog',{name:'播放列表更多操作',exact:true})
async function geometry(page){return menu(page).evaluate(node=>{const r=node.getBoundingClientRect();return {height:r.height,width:r.width,top:r.top,bottom:r.bottom,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,overflow:getComputedStyle(node).overflowY,rows:[...node.querySelectorAll('.playlist-hero-more-action')].map(row=>{const b=row.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height}}),images:[...node.querySelectorAll('img')].map(image=>({loaded:image.complete&&image.naturalWidth>0,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height})),nestedOverflow:[...node.querySelectorAll('*')].filter(child=>child.scrollHeight>child.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(child).overflowY)).length}})}
try{
 for(const [width,height] of [[640,1440],[1920,1080]]){
  const {page,errors}=await open(width,height);await trigger(page).click();await menu(page).waitFor()
  assert.deepEqual(await menu(page).locator('.playlist-hero-more-action span').allTextContents(),labels)
  assert.match(await menu(page).innerText(),/80\s*\|\s*4:00:00/)
  const measured=await geometry(page);assert(measured.height<=height-32,'natural dialog height remains within the viewport')
  assert(measured.scrollHeight<=measured.clientHeight+1,'normal viewport needs no scroll')
  assert(measured.rows.every(row=>row.top>=measured.top&&row.bottom<=measured.bottom&&row.height===48),'all seven actions are visible together')
  assert.equal(measured.nestedOverflow,0);assert(measured.images.every(image=>image.loaded));assert.equal(measured.images.length,9)
  assert.deepEqual(measured.images.map(image=>[image.width,image.height]),[[160,160],[24,24],...labels.map(()=>[48,48])])
  await menu(page).screenshot({path:directory+'/playlist-fit-'+width+'.png'});evidence.push({width,height,...measured})
  await page.keyboard.press('Escape');await menu(page).waitFor({state:'hidden'});assert(await trigger(page).evaluate(node=>node===document.activeElement))
  for(const label of labels){await trigger(page).click();await menu(page).getByRole('button',{name:label,exact:true}).click();const notice=page.getByRole('dialog',{name:label,exact:true});await notice.waitFor();assert.match(await notice.innerText(),/尚未接入/);assert.equal(await page.getByRole('dialog').count(),1);await notice.getByRole('button',{name:'知道了',exact:true}).click();await notice.waitFor({state:'hidden'});assert(await trigger(page).evaluate(node=>node===document.activeElement))}
  assert.deepEqual(await page.evaluate(()=>window.actions),[]);assert.deepEqual(errors,[]);await page.close()
 }
 for(const height of [420,260]){
  const {page,errors}=await open(360,height,'?long&duration=1596');await trigger(page).click();await menu(page).waitFor()
  const measured=await geometry(page);assert(measured.height<=height-32&&measured.top>=0&&measured.bottom<=height)
  assert(measured.scrollHeight>measured.clientHeight,'constrained viewport uses native dialog overflow');assert.equal(measured.overflow,'auto');assert.equal(measured.nestedOverflow,0)
  await menu(page).getByRole('button',{name:'列表选项',exact:true}).focus()
  const last=await menu(page).getByRole('button',{name:'列表选项',exact:true}).boundingBox();assert(last.y>=measured.top&&last.y+last.height<=measured.bottom,'last action remains fully reachable by keyboard')
  await page.keyboard.press('Enter');const notice=page.getByRole('dialog',{name:'列表选项',exact:true});await notice.waitFor();await notice.getByRole('button',{name:'返回更多操作',exact:true}).click();await menu(page).waitFor()
  await menu(page).screenshot({path:directory+'/playlist-small-'+height+'.png'});await page.keyboard.press('Escape');await menu(page).waitFor({state:'hidden'});assert(await trigger(page).evaluate(node=>node===document.activeElement))
  assert.deepEqual(errors,[]);evidence.push({smallHeight:height,...measured});await page.close()
 }
 for(const [query,label] of [['?duration=1596','26:36'],['?duration=5196','1:26:36'],['?status=loading','统计中…'],['?status=unknown','时长未知'],['?status=error','统计失败']]){
  const {page,errors}=await open(640,1440,query)
  assert.equal(await page.locator('.playlist-panel > .playlist-hero .playlist-hero-total').textContent(),label,'playlist hero duration/status')
  await trigger(page).click();await menu(page).waitFor();assert.match(await menu(page).locator('.playlist-hero-more-info p').textContent(),new RegExp('80\\s*\\|\\s*'+label.replaceAll('.','\\.')))
  await page.keyboard.press('Escape');assert.deepEqual(errors,[]);await page.close()
 }
 writeFileSync(directory+'/evidence.json',JSON.stringify(evidence,null,2));console.log('PASS playlist hero menu natural height, seven actions, compact clock/status, tiny viewport native overflow and focus: '+directory)
}finally{await browser.close()}
