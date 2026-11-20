// Unit test for the R2 diagnostic probe, run against a DOM-ish stub.
//
// The stub is deliberately shaped like the parts of the platform the probe touches:
//   * Element.prototype.removeAttribute, because that is the lane's real release path
//     (playlistCoverPathLane.finish() calls removeAttribute('src') for every outcome);
//   * a src accessor on the image prototype, because that is where a request starts;
//   * createElement-style DOM images that are NOT constructed through window.Image, so
//     the "only temporaries count as predecodes" rule can be asserted.
//
// Each assertion states the failure it prevents, because every one of these was an actual
// defect found in a real run.
import { diagProbeScript } from './r2diag-probe.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + '  got=' + JSON.stringify(actual) + (ok ? '' : ' want=' + JSON.stringify(expected)))
  if (!ok) failures += 1
}

// ---- stub platform ---------------------------------------------------------
class StubElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this._listeners = new Map()
    this._attributes = new Map()
    this.complete = false
    this.naturalWidth = 0
    this.naturalHeight = 0
    this.currentSrc = ''
  }
  addEventListener(type, fn) {
    const list = this._listeners.get(type) || []
    list.push(fn)
    this._listeners.set(type, list)
  }
  removeEventListener(type, fn) {
    const list = (this._listeners.get(type) || []).filter(f => f !== fn)
    this._listeners.set(type, list)
  }
  dispatch(type) {
    for (const fn of this._listeners.get(type) || []) fn({ target: this })
    const prop = this['on' + type]
    if (typeof prop === 'function') prop({ target: this })
  }
  setAttribute(name, value) { this._attributes.set(name, value) }
  getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null }
  removeAttribute(name) { this._attributes.delete(name) }
}
class StubImage extends StubElement {
  constructor() { super('img') }
}
Object.defineProperty(StubImage.prototype, 'src', {
  configurable: true,
  get() { return this._attributes.get('src') || '' },
  set(value) { this._attributes.set('src', value) },
})

globalThis.Element = StubElement
globalThis.HTMLImageElement = StubImage
globalThis.location = { href: 'http://localhost/' }
globalThis.document = { addEventListener() {} }
globalThis.performance = { now: () => Date.now() }
const fakeWindow = { Image: StubImage }
globalThis.window = fakeWindow

// The harness the probe extends.
const cards = []
globalThis.window.__coverlane = {
  helpers: {
    visibleBounds: () => ({ top: 0, bottom: 600, left: 0, right: 800 }),
    gridNow: () => ({ querySelectorAll: () => cards }),
    imageFor: card => card._img || null,
  },
}

const installed = eval(diagProbeScript())
check('probe installs', installed.installed, true)
check('Image proxied', installed.imageProxied, true)
check('src setter patched', installed.srcPatched, true)

const ImageCtor = globalThis.window.Image
const diag = globalThis.window.__r2diag

// ---- C: in-flight counting -------------------------------------------------
const a = new ImageCtor()
a.src = 'asset://localhost/a.jpg'
const b = new ImageCtor()
b.src = 'asset://localhost/a.jpg'      // same URL while a is running
const c = new ImageCtor()
c.src = 'asset://localhost/c.jpg'
let s = diag.helpers.snapshot(20)
check('three temporaries are in flight', s.inflight, 3)
check('peak tracks the concurrent maximum', s.inflightPeak, 3)
check('same-URL overlap counted once', s.overlapPairs, 1)

b.dispatch('load')
c.dispatch('error')
a.dispatch('load')
s = diag.helpers.snapshot(20)
check('load/error both release', s.inflight, 0)
check('all three rows keep their outcome', s.rows.map(r => r.outcome).join(','), 'load,load,error')

// REGRESSION 1: this was the bug behind an in-flight peak of 1005 on a lane of width 4.
// finish() removes the attribute rather than assigning an empty src.
const d = new ImageCtor()
d.src = 'asset://localhost/d.jpg'
check('one temporary open', diag.helpers.snapshot(20).inflight, 1)
d.removeAttribute('src')
s = diag.helpers.snapshot(20)
check('removeAttribute(src) releases the request', s.inflight, 0)
check('its row records src-removed', s.rows.find(r => r.url.endsWith('d.jpg')).outcome, 'src-removed')

// A temporary re-src'd without an event is a new request, and the old one is finished.
const e = new ImageCtor()
e.src = 'asset://localhost/e1.jpg'
e.src = 'asset://localhost/e2.jpg'
s = diag.helpers.snapshot(20)
check('reassignment finishes the old request', s.rows.filter(r => r.url.endsWith('e1.jpg'))[0].outcome, 'reassigned')
check('and leaves exactly one open', s.inflight, 1)
e.removeAttribute('src')
check('nothing open before the DOM-cover assertion', diag.helpers.snapshot(20).inflight, 0)

// REGRESSION 2: the first smoke run counted the whole mounted grid. A DOM cover element
// is created by the framework, never through new Image(), so it must be ignored.
const domCover = Object.create(StubImage.prototype)
domCover._listeners = new Map()
domCover._attributes = new Map()
domCover.src = 'asset://localhost/dom-cover.jpg'
check('DOM cover element is not a predecode', diag.helpers.snapshot(20).inflight, 0)

// ---- B: mounted population -------------------------------------------------
function makeCard(id, top, image) {
  return {
    dataset: { playlistTrackId: id },
    _img: image,
    getBoundingClientRect: () => ({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100 }),
  }
}
function decodedImage(w, h, src) {
  const img = new ImageCtor()
  img.complete = true
  img.naturalWidth = w
  img.naturalHeight = h
  img.currentSrc = src
  img._attributes.set('src', src)
  return img
}
cards.push(makeCard('1', 100, decodedImage(256, 256, 'asset://localhost/x.jpg')))
cards.push(makeCard('2', 2000, decodedImage(256, 256, 'asset://localhost/x.jpg')))
cards.push(makeCard('3', 2400, decodedImage(256, 256, 'asset://localhost/x.jpg')))
const m = diag.helpers.sampleMounts('unit')
check('one card on screen', m.onscreen, 1)
check('two cards off screen', m.offscreen, 2)
check('duplicate URLs collapse', m.uniqueUrls, 1)
check('duplicate elements counted', m.duplicateElements, 2)
check('off-screen decoded source area', m.offscreenAreaPx, 2 * 256 * 256)
check('on-screen decoded source area', m.onscreenAreaPx, 256 * 256)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)')
process.exitCode = failures === 0 ? 0 : 1
