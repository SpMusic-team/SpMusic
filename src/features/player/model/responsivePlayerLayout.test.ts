/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculatePlayerLayoutCandidate,
  PLAYER_LAYOUT_MODES,
  RESPONSIVE_PLAYER_LAYOUT_CONFIG,
  resolveResponsivePlayerLayout,
  type ResponsivePlayerLayoutConfig,
} from './responsivePlayerLayout.ts'

const EPSILON = 1e-9

function assertClose(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, message ?? `${actual} != ${expected}`)
}

test('方案一集中定义设计范围和选择参数', () => {
  assert.equal(RESPONSIVE_PLAYER_LAYOUT_CONFIG.minScale, 0.9)
  assert.equal(RESPONSIVE_PLAYER_LAYOUT_CONFIG.promotionScale, 0.96)
  assert.equal(RESPONSIVE_PLAYER_LAYOUT_CONFIG.decisionBucketPx, 4)
  assert.deepEqual(RESPONSIVE_PLAYER_LAYOUT_CONFIG.layouts, {
    full: {
      minWidth: 1920,
      maxWidth: 2560,
      minHeight: 1080,
      maxHeight: 1440,
      informationLevel: 3,
      tieBreakPriority: 4,
    },
    horizontal: {
      minWidth: 1723,
      maxWidth: 2560,
      minHeight: 595,
      maxHeight: 1080,
      informationLevel: 2,
      tieBreakPriority: 3,
    },
    vertical: {
      minWidth: 1024,
      maxWidth: 1920,
      minHeight: 1120,
      maxHeight: 1440,
      informationLevel: 2,
      tieBreakPriority: 2,
    },
    quarter: {
      minWidth: 640,
      maxWidth: 1024,
      minHeight: 1200,
      maxHeight: 1440,
      informationLevel: 1,
      tieBreakPriority: 1,
    },
  })
})

test('文档中的尺寸示例得到预期视图', () => {
  const examples = [
    [2560, 1440, 'full', false],
    [2560, 595, 'horizontal', false],
    [2560, 1080, 'full', false],
    [1920, 1080, 'full', false],
    [1850, 1050, 'full', false],
    [1800, 1050, 'horizontal', false],
    [1819, 1108, 'vertical', false],
    [1600, 900, 'horizontal', false],
    [1280, 1050, 'vertical', false],
    [1024, 1200, 'vertical', false],
    [900, 1100, 'quarter', false],
    [1100, 700, 'horizontal', true],
  ] as const

  for (const [width, height, layout, fallback] of examples) {
    const result = resolveResponsivePlayerLayout(width, height)
    assert.equal(result.layout, layout, `${width}x${height}`)
    assert.equal(result.fallback, fallback, `${width}x${height}`)
  }
})

test('1819x1108 选择竖半屏，因为其缩放失真小于横半屏的高度溢出', () => {
  const viewport = { width: 1816, height: 1108 }
  const result = resolveResponsivePlayerLayout(1819, 1108)
  const horizontal = calculatePlayerLayoutCandidate('horizontal', viewport)
  const vertical = calculatePlayerLayoutCandidate('vertical', viewport)

  assert.ok(horizontal)
  assert.ok(vertical)
  assert.equal(result.layout, 'vertical')
  assert.equal(result.fallback, false)
  assertClose(result.scale, 1108 / 1120)
  assertClose(horizontal.distortion, 1108 / 1080 - 1)
  assertClose(vertical.distortion, 1 - 1108 / 1120)
  assert.ok(horizontal.distortion > vertical.distortion)
})

test('非 4px 整除的横半屏最小边界保持原比例有效', () => {
  const result = resolveResponsivePlayerLayout(1723, 595)
  assert.equal(result.layout, 'horizontal')
  assert.equal(result.fallback, false)
  assert.equal(result.scale, 1)
  assert.deepEqual(
    [result.decisionWidth, result.decisionHeight],
    [1723, 595],
  )
})

test('每个候选满足最小尺寸且可计算有限的内容画布 cap', () => {
  const config = RESPONSIVE_PLAYER_LAYOUT_CONFIG

  for (let width = 576; width <= 2560; width += 4) {
    for (let height = 536; height <= 1440; height += 4) {
      for (const layout of PLAYER_LAYOUT_MODES) {
        const candidate = calculatePlayerLayoutCandidate(layout, { width, height }, config)
        if (candidate === null) continue

        const bounds = config.layouts[layout]
        const virtualWidth = width / candidate.scale
        const virtualHeight = height / candidate.scale
        const contentDesignWidth = Math.min(virtualWidth, bounds.maxWidth)
        const contentDesignHeight = Math.min(virtualHeight, bounds.maxHeight)
        assert.ok(candidate.lower <= candidate.scale + EPSILON, `${layout}@${width}x${height}: lower`)
        assert.ok(candidate.scale <= candidate.upper + EPSILON, `${layout}@${width}x${height}: upper`)
        assert.ok(candidate.scale + EPSILON >= config.minScale, `${layout}@${width}x${height}: minScale`)
        assert.ok(candidate.scale <= 1 + EPSILON, `${layout}@${width}x${height}: maxScale`)
        assertClose(candidate.lower, config.minScale, `${layout}@${width}x${height}: lower formula`)
        assertClose(
          candidate.upper,
          Math.min(1, width / bounds.minWidth, height / bounds.minHeight),
          `${layout}@${width}x${height}: decisionScale formula`,
        )
        assert.ok(contentDesignWidth + EPSILON >= bounds.minWidth, `${layout}@${width}x${height}: minWidth`)
        assert.ok(contentDesignWidth <= bounds.maxWidth + EPSILON, `${layout}@${width}x${height}: width cap`)
        assert.ok(contentDesignHeight + EPSILON >= bounds.minHeight, `${layout}@${width}x${height}: minHeight`)
        assert.ok(contentDesignHeight <= bounds.maxHeight + EPSILON, `${layout}@${width}x${height}: height cap`)
        assert.ok(Number.isFinite(contentDesignWidth), `${layout}@${width}x${height}: finite width cap`)
        assert.ok(Number.isFinite(contentDesignHeight), `${layout}@${width}x${height}: finite height cap`)
      }
    }
  }
})

test('非 fallback 结果的原始尺寸达到最小尺寸且内容画布受 max cap 限制', () => {
  const boundaryHeights = [
    595, 596, 597, 598, 599,
    1078, 1079, 1080, 1081, 1082,
    1118, 1119, 1120, 1121, 1122,
    1198, 1199, 1200, 1201, 1202,
    1438, 1439, 1440,
  ]

  for (let width = 640; width <= 2560; width += 1) {
    for (const height of boundaryHeights) {
      const result = resolveResponsivePlayerLayout(width, height)
      if (result.fallback) continue

      const bounds = RESPONSIVE_PLAYER_LAYOUT_CONFIG.layouts[result.layout]
      const virtualWidth = width / result.scale
      const virtualHeight = height / result.scale
      const contentDesignWidth = Math.min(virtualWidth, bounds.maxWidth)
      const contentDesignHeight = Math.min(virtualHeight, bounds.maxHeight)
      assert.ok(contentDesignWidth + EPSILON >= bounds.minWidth, `${result.layout}@${width}x${height}: minWidth`)
      assert.ok(contentDesignWidth <= bounds.maxWidth + EPSILON, `${result.layout}@${width}x${height}: width cap`)
      assert.ok(contentDesignHeight + EPSILON >= bounds.minHeight, `${result.layout}@${width}x${height}: minHeight`)
      assert.ok(contentDesignHeight <= bounds.maxHeight + EPSILON, `${result.layout}@${width}x${height}: height cap`)
    }
  }
})

test('0.90 是合法候选且低于下限会进入 fallback', () => {
  const atMinimum = resolveResponsivePlayerLayout(576, 1080)
  assert.equal(atMinimum.layout, 'quarter')
  assert.equal(atMinimum.fallback, false)
  assertClose(atMinimum.scale, 0.9)

  const belowMinimum = resolveResponsivePlayerLayout(576, 1079)
  assert.equal(belowMinimum.fallback, true)
  assertClose(belowMinimum.scale, 0.9)
})

test('0.96 晋级门槛按闭区间处理', () => {
  const config: ResponsivePlayerLayoutConfig = {
    minScale: 0.9,
    promotionScale: 0.96,
    decisionBucketPx: 1,
    layouts: {
      full: {
        minWidth: 1000,
        maxWidth: 2000,
        minHeight: 1000,
        maxHeight: 2000,
        informationLevel: 3,
        tieBreakPriority: 4,
      },
      horizontal: {
        minWidth: 900,
        maxWidth: 2000,
        minHeight: 1000,
        maxHeight: 2000,
        informationLevel: 2,
        tieBreakPriority: 3,
      },
      vertical: {
        minWidth: 5000,
        maxWidth: 6000,
        minHeight: 5000,
        maxHeight: 6000,
        informationLevel: 2,
        tieBreakPriority: 2,
      },
      quarter: {
        minWidth: 7000,
        maxWidth: 8000,
        minHeight: 7000,
        maxHeight: 8000,
        informationLevel: 1,
        tieBreakPriority: 1,
      },
    },
  }

  assert.equal(resolveResponsivePlayerLayout(960, 1000, config).layout, 'full')
  assert.equal(resolveResponsivePlayerLayout(959, 1000, config).layout, 'horizontal')
})

test('0.96 对应的 0.04 失真门槛在溢出侧也按闭区间处理', () => {
  const config: ResponsivePlayerLayoutConfig = {
    minScale: 0.9,
    promotionScale: 0.96,
    decisionBucketPx: 1,
    layouts: {
      full: {
        minWidth: 1000,
        maxWidth: 1000,
        minHeight: 1000,
        maxHeight: 1000,
        informationLevel: 3,
        tieBreakPriority: 4,
      },
      horizontal: {
        minWidth: 900,
        maxWidth: 2000,
        minHeight: 1000,
        maxHeight: 2000,
        informationLevel: 2,
        tieBreakPriority: 3,
      },
      vertical: {
        minWidth: 5000,
        maxWidth: 6000,
        minHeight: 5000,
        maxHeight: 6000,
        informationLevel: 2,
        tieBreakPriority: 2,
      },
      quarter: {
        minWidth: 7000,
        maxWidth: 8000,
        minHeight: 7000,
        maxHeight: 8000,
        informationLevel: 1,
        tieBreakPriority: 1,
      },
    },
  }

  const below = calculatePlayerLayoutCandidate('full', { width: 1039, height: 1000 }, config)
  const at = calculatePlayerLayoutCandidate('full', { width: 1040, height: 1000 }, config)
  const above = calculatePlayerLayoutCandidate('full', { width: 1041, height: 1000 }, config)

  assert.ok(below)
  assert.ok(at)
  assert.ok(above)
  assertClose(below.distortion, 0.039)
  assertClose(at.distortion, 0.04)
  assertClose(above.distortion, 0.041)
  assert.equal(resolveResponsivePlayerLayout(1039, 1000, config).layout, 'full')
  assert.equal(resolveResponsivePlayerLayout(1040, 1000, config).layout, 'full')
  assert.equal(resolveResponsivePlayerLayout(1041, 1000, config).layout, 'horizontal')
})

test('同一 4px 判定桶内 layout 稳定，最终 scale 使用原始尺寸连续变化', () => {
  const first = resolveResponsivePlayerLayout(1848, 1050)
  const last = resolveResponsivePlayerLayout(1851, 1050)

  assert.equal(first.decisionWidth, last.decisionWidth)
  assert.equal(first.layout, 'full')
  assert.equal(last.layout, 'full')
  assert.ok(last.scale > first.scale)
})

test('相同尺寸重复调用及不同调用顺序不改变结果', () => {
  const sizes = [
    [2560, 1440],
    [1850, 1050],
    [1819, 1108],
    [1723, 595],
    [1280, 1050],
    [900, 1100],
    [1120, 720],
    [640, 595],
  ] as const
  const expected = sizes.map(([width, height]) => resolveResponsivePlayerLayout(width, height))

  for (let iteration = 0; iteration < 100; iteration += 1) {
    for (let index = sizes.length - 1; index >= 0; index -= 1) {
      const [width, height] = sizes[index]
      assert.deepEqual(resolveResponsivePlayerLayout(width, height), expected[index])
    }
  }
})

function assertNoLayoutReentry(sizes: ReadonlyArray<readonly [number, number]>) {
  const exitedLayouts = new Set<string>()
  const [initialWidth, initialHeight] = sizes[0]
  let previousLayout = resolveResponsivePlayerLayout(initialWidth, initialHeight).layout

  for (const [width, height] of sizes.slice(1)) {
    const layout = resolveResponsivePlayerLayout(width, height).layout
    if (layout === previousLayout) continue

    exitedLayouts.add(previousLayout)
    assert.equal(
      exitedLayouts.has(layout),
      false,
      `${previousLayout} -> ${layout} at ${width}x${height} re-enters an exited layout`,
    )
    previousLayout = layout
  }
}

test('规格列出的单向拉宽和拉高扫描不会回到已离开的视图', () => {
  for (const height of [595, 900, 1050, 1080, 1120, 1200]) {
    assertNoLayoutReentry(
      Array.from({ length: 2560 - 640 + 1 }, (_, index) => [640 + index, height] as const),
    )
  }

  for (const width of [640, 1024, 1723, 1920]) {
    assertNoLayoutReentry(
      Array.from({ length: 1440 - 595 + 1 }, (_, index) => [width, 595 + index] as const),
    )
  }
})

test('1050 高度及横竖半屏相邻高度的双向拉宽扫描无视图重入', () => {
  for (const height of [1050, 1079, 1080, 1081, 1108, 1119, 1120]) {
    const increasing = Array.from(
      { length: 2560 - 640 + 1 },
      (_, index) => [640 + index, height] as const,
    )
    assertNoLayoutReentry(increasing)
    assertNoLayoutReentry([...increasing].reverse())
  }
})

test('默认尺寸与最小尺寸使用有限且确定的 fail-safe', () => {
  for (const [width, height] of [[1120, 720], [640, 595]] as const) {
    const expected = resolveResponsivePlayerLayout(width, height)
    assert.equal(expected.fallback, true)
    assertClose(expected.scale, 0.9)
    assert.ok(Number.isFinite(expected.scale))

    for (let iteration = 0; iteration < 100; iteration += 1) {
      assert.deepEqual(resolveResponsivePlayerLayout(width, height), expected)
    }
  }
})

test('fail-safe 不把超过内容画布 max 的轴计入失真距离', () => {
  const result = resolveResponsivePlayerLayout(1510, 980)

  assert.equal(result.fallback, true)
  assert.equal(result.layout, 'horizontal')
  assertClose(result.scale, 0.9)
})

test('非法 viewport 输入也返回确定结果且不产生 NaN 或 Infinity', () => {
  for (const [width, height] of [
    [Number.NaN, Number.NaN],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [0, -1],
  ]) {
    const result = resolveResponsivePlayerLayout(width, height)
    assert.equal(result.layout, 'full')
    assert.equal(result.fallback, false)
    assert.equal(result.scale, 1)
    assert.ok(Number.isFinite(result.decisionWidth))
    assert.ok(Number.isFinite(result.decisionHeight))
  }
})
