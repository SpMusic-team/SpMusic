// OPT-0017 页内只读探针。注入渲染进程，只读数、不改行为。
//
// 硬约束（照抄 OPT-0018 r2diag 的三条教训，这是它们踩过坑才总结出来的）：
//   1. 不发起任何请求、不改任何调度、不修改 DOM 属性。删掉本文件后行为回到原样。
//   2. 只读 React fiber 的 hook 状态与 DOM 几何，不做任何写入。
//   3. 输出的 identity 全部是本次会话随机盐哈希后的不透明 ID，不含路径、曲名与 URL。
//
// 与 r2diag 的区别：OPT-0017 的内存归属是播放页的 **8 槽 canvas 资源池**（方案 §2 第 2 条），
// 不是列表封面网格。因此这个探针重点读：
//   pool        8 个槽的 canvas 尺寸、是否在展出、累计 lease/release 次数
//   registry    身份注册表的条目数、references、是否已 released
//   layers      当前图层阶段（incoming/active/exiting/preview）与绘制状态
//   scheduler   进行中作业、队列长度、消费者数、已中止数
//   canvasArea  活动 canvas 的 backing 像素面积合计（= 源像素驻留的直接度量）
//   images      页面里已解码的 <img>（背景/过渡层）与源像素面积
// 另外每个 tick 记录 performance.memory（若可用）作为 JS 堆参考。

(() => {
  if (window.__spm0017Probe) throw new Error('an OPT-0017 probe is already active')
  const started = performance.now()
  const salt = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)
  const digest = value => {
    if (value == null) return null
    let hash = salt ^ 2166136261
    const text = String(value)
    for (let index = 0; index < text.length && index < 512; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
    return 'id-' + (hash >>> 0).toString(16)
  }
  const readFiberRoot = () => {
    const node = document.querySelector('.player-shell') || document.getElementById('root')?.firstElementChild
    if (!node) return null
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'))
    let fiber = key ? node[key] : null
    while (fiber?.return) fiber = fiber.return
    return fiber?.stateNode?.current || fiber
  }
  const walk = (root, limit = 30000) => {
    const all = [], stack = root ? [root] : []
    while (stack.length && all.length < limit) {
      const fiber = stack.pop()
      all.push(fiber)
      if (fiber.child) stack.push(fiber.child)
      if (fiber.sibling) stack.push(fiber.sibling)
    }
    return all
  }
  const hookValues = fiber => {
    const values = []
    let hook = fiber?.memoizedState
    for (let count = 0; hook && count < 600; count += 1, hook = hook.next) {
      const value = hook.memoizedState
      values.push(value)
      if (value && typeof value === 'object' && 'current' in value) values.push(value.current)
      if (Array.isArray(value) && value.length === 2 && Array.isArray(value[1])) values.push(value[0])
    }
    return values
  }
  const rect = node => {
    const box = node.getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top), bottom: Math.round(box.bottom) }
  }
  const snapshot = () => {
    const root = readFiberRoot()
    const fibers = walk(root)
    const surface = fibers.find(f => f.memoizedProps?.viewModel?.playback && f.memoizedProps?.viewModel?.playlist)
    const values = surface ? hookValues(surface) : []
    const layers = values.find(value => Array.isArray(value) && value.some(layer => layer?.resource && layer?.track && typeof layer.phase === 'string'))
    const registry = values.find(value => value instanceof Map && value.size > 0)
    const pool = values.find(value => value && typeof value.hasAvailable === 'function' && typeof value.waitForAvailable === 'function')
    const lifecycles = values.filter(value => value && typeof value === 'object' && !Array.isArray(value) &&
      ('requestedArtwork' in value || ('identity' in value && ('controller' in value || 'phase' in value))))

    // ---- canvas 池：DOM 上真实的 canvas backing 面积 ----
    const canvases = [...document.querySelectorAll('canvas')].map(canvas => {
      const box = canvas.getBoundingClientRect()
      const inView = box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && box.width > 0 && box.height > 0
      return {
        width: canvas.width, height: canvas.height,
        backingBytes: canvas.width * canvas.height * 4,
        renderedWidth: Math.round(box.width), renderedHeight: Math.round(box.height),
        inView,
      }
    })
    const canvasArea = canvases.reduce((sum, c) => sum + c.backingBytes, 0)
    const visibleCanvasArea = canvases.filter(c => c.inView).reduce((sum, c) => sum + c.backingBytes, 0)

    // ---- 已解码 <img>（背景 / 过渡 / fallback 层） ----
    const images = [...document.images]
      .filter(image => image.complete && image.naturalWidth > 0)
      .map(image => {
        const box = image.getBoundingClientRect()
        const inView = box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && box.width > 0 && box.height > 0
        return {
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          sourcePixels: image.naturalWidth * image.naturalHeight,
          inView,
        }
      })

    const memory = performance.memory
      ? { jsHeapUsed: performance.memory.usedJSHeapSize, jsHeapTotal: performance.memory.totalJSHeapSize }
      : null

    return {
      t: Math.round(performance.now() - started),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      layers: (layers || []).map(layer => ({
        id: layer.id, identity: digest(layer.identity), track: digest(layer.track?.id),
        phase: layer.phase, consumer: layer.consumer ?? null,
        hasResource: Boolean(layer.resource), painted: Boolean(layer.resource?.view),
        previewTokenId: layer.previewTokenId ?? null,
      })),
      registry: registry ? [...registry].slice(0, 24).map(([identity, entry]) => ({
        identity: digest(identity), references: entry?.references ?? null,
        released: entry?.resource?.isReleased?.() ?? null, hasView: Boolean(entry?.resource?.view),
      })) : null,
      pool: pool ? { hasAvailable: pool.hasAvailable() } : null,
      scheduler: values.find(value => value && typeof value === 'object' && typeof value.active === 'number' && typeof value.queued === 'number') ?? null,
      lifecycles: lifecycles.slice(0, 12).map(value => ({
        identity: digest(value.identity), phase: value.phase ?? null,
        aborted: value.controller?.signal?.aborted ?? null,
        hasResource: Boolean(value.resource), painted: Boolean(value.resource?.view),
      })),
      canvases: { count: canvases.length, canvasArea, visibleCanvasArea, items: canvases.slice(0, 16) },
      images: {
        decoded: images.length,
        inView: images.filter(image => image.inView).length,
        sourcePixels: images.reduce((sum, image) => sum + image.sourcePixels, 0),
        inViewSourcePixels: images.filter(image => image.inView).reduce((sum, image) => sum + image.sourcePixels, 0),
      },
      memory,
    }
  }
  window.__spm0017Probe = {
    snapshot,
    dispose: () => { delete window.__spm0017Probe },
  }
  return snapshot()
})
