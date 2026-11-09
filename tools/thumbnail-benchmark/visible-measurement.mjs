// Executed only by the external Release UI test, never bundled into the app.
export const VISIBLE_MEASUREMENT = String.raw`async (options) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
  const grid = document.querySelector('.playlist-grid');
  const panel = grid?.closest('.playlist-panel');
  if (!panel) throw new Error('Real playlist panel absent');
  const imageFor = card => card.querySelector('img.playlist-card-cover-image, img.playlist-card-cover-image-eager');
  const visibleImage = image => Boolean(image?.complete && image.naturalWidth > 0 && Number(getComputedStyle(image).opacity) >= .99);
  const episodes = [], frames = [], recent = new WeakMap();
  let active = null, running = true, previousFrame = performance.now();
  function frame(now) {
    frames.push(now - previousFrame); previousFrame = now;
    if (running) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  function record(image, time) {
    if (!active || !visibleImage(image)) return;
    const card = image.closest('[data-playlist-track-id]');
    const row = active.rows.get(card?.dataset.playlistTrackId);
    if (!row) return;
    const elapsed = Math.max(0, time - active.t0);
    if (row.firstVisibleMs === null) row.firstVisibleMs = elapsed;
    const last = row.history.at(-1);
    const size = Math.max(image.naturalWidth, image.naturalHeight);
    if (!last || last.edge !== size) row.history.push({ ms: elapsed, edge: size });
  }
  function loaded(event) {
    const image = event.target;
    if (image.tagName !== 'IMG') return;
    recent.set(image, { time: performance.now(), src: image.currentSrc || image.src });
    // Observe the mounted image after style/layout application, not Image.decode.
    requestAnimationFrame(() => record(image, performance.now()));
  }
  function transitioned(event) {
    if (event.target.tagName === 'IMG' && event.propertyName === 'opacity') record(event.target, performance.now());
  }
  function failed(event) {
    if (!active || event.target.tagName !== 'IMG') return;
    const id = event.target.closest('[data-playlist-track-id]')?.dataset.playlistTrackId;
    const row = active.rows.get(id);
    if (row) row.errors += 1;
  }
  panel.addEventListener('load', loaded, true);
  panel.addEventListener('error', failed, true);
  panel.addEventListener('transitionend', transitioned, true);
  try {
    for (const fraction of options.fractions) {
      active = null;
      const t0 = performance.now();
      panel.scrollTop = Math.round((panel.scrollHeight - panel.clientHeight) * fraction);
      await raf(); await raf();
      const bounds = panel.getBoundingClientRect();
      const dock = [...document.querySelectorAll('.playlist-playback-dock')].find(element => {
        const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > bounds.top && r.top < bounds.bottom;
      });
      const bottom = Math.min(bounds.bottom, dock ? dock.getBoundingClientRect().top : bounds.bottom);
      const cards = [...grid.querySelectorAll('[data-playlist-track-id]')];
      const targets = cards.filter(card => {
        const r = card.getBoundingClientRect();
        return r.bottom > bounds.top && r.top < bottom && r.right > bounds.left && r.left < bounds.right;
      });
      const rows = new Map(targets.map(card => [card.dataset.playlistTrackId, {
        id: card.dataset.playlistTrackId, index: cards.indexOf(card), firstVisibleMs: null,
        alreadyReady: false, history: [], errors: 0,
      }]));
      active = { t0, rows };
      for (const card of targets) {
        const image = imageFor(card), row = rows.get(card.dataset.playlistTrackId);
        const load = image ? recent.get(image) : null;
        row.alreadyReady = visibleImage(image) && (!load || load.time < t0);
        if (row.alreadyReady) {
          row.firstVisibleMs = 0;
          row.history.push({ ms: 0, edge: Math.max(image.naturalWidth, image.naturalHeight) });
        } else if (visibleImage(image)) record(image, performance.now());
      }
      await sleep(options.dwellMs);
      for (const card of targets) {
        const image = imageFor(card), row = rows.get(card.dataset.playlistTrackId);
        record(image, performance.now());
        row.unavailable = card.getAttribute('data-unavailable') === 'true';
        row.state = card.getAttribute('data-cover-state');
        row.contentVisible = card.getAttribute('data-content-visible') === 'true';
        row.complete = visibleImage(image);
        row.finalEdge = row.complete ? Math.max(image.naturalWidth, image.naturalHeight) : null;
      }
      episodes.push({ fraction, t0, dwellMs: options.dwellMs, snapshotMs: performance.now() - t0 - options.dwellMs,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        coverCssPixels: targets[0]?.querySelector('.playlist-card-cover')?.getBoundingClientRect().width,
        rows: [...rows.values()] });
    }
    return { episodes, frames, cardCount: grid.querySelectorAll('[data-playlist-track-id]').length,
      layoutLevel: grid.dataset.layoutLevel, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } };
  } finally {
    active = null; running = false;
    panel.removeEventListener('load', loaded, true);
    panel.removeEventListener('error', failed, true);
    panel.removeEventListener('transitionend', transitioned, true);
  }
}`
