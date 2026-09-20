/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculatePlayerLayoutCandidate,
  PLAYER_LAYOUT_MODES,
  RESPONSIVE_PLAYER_LAYOUT_CONFIG,
  resolveResponsivePlayerLayout,
  type CompactLayoutProfile,
  type PlayerLayoutMode,
  type ResponsivePlayerLayoutConfig,
  type ResponsivePlayerLayoutResult,
} from './responsivePlayerLayout.ts'

const EPSILON = 1e-9

function assertClose(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, message ?? `${actual} != ${expected}`)
}

function isScoredLayout(layout: ResponsivePlayerLayoutResult['layout']): layout is PlayerLayoutMode {
  return layout !== 'compact'
}

function stateKey(result: ResponsivePlayerLayoutResult): string {
  return `${result.layout}:${result.compactProfile ?? '-'}`
}

function assertResolved(
  width: number,
  height: number,
  layout: ResponsivePlayerLayoutResult['layout'],
  compactProfile: CompactLayoutProfile | null,
) {
  const result = resolveResponsivePlayerLayout(width, height)
  assert.equal(result.layout, layout, `${width}x${height}: layout`)
  assert.equal(result.compactProfile, compactProfile, `${width}x${height}: compactProfile`)
  assert.equal(result.fallback, false, `${width}x${height}: fallback`)
}

function assertCompactFallback(
  width: number,
  height: number,
  compactProfile: CompactLayoutProfile,
  scale: number,
) {
  const result = resolveResponsivePlayerLayout(width, height)
  assert.equal(result.layout, 'compact', `${width}x${height}: layout`)
  assert.equal(result.compactProfile, compactProfile, `${width}x${height}: compactProfile`)
  assert.equal(result.fallback, true, `${width}x${height}: fallback`)
  assertClose(result.scale, scale, `${width}x${height}: scale`)
  assert.ok(Number.isFinite(result.scale), `${width}x${height}: finite scale`)
}

test('集中定义现有设计范围和选择参数', () => {
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
      minHeight: 720,
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

test('Compact 精确边界矩阵与三个退出边界符合规格', () => {
  const examples = [
    [640, 720, 'compact', 'compact-row'],
    [899, 720, 'compact', 'compact-row'],
    [900, 720, 'compact', 'compact-row-lyric'],
    [640, 890, 'compact', 'compact-row'],
    [640, 891, 'compact', 'compact-stacked'],
    [899, 1030, 'compact', 'compact-stacked'],
    [899, 1031, 'compact', 'compact-stacked-lyric'],
    [900, 1030, 'compact', 'compact-row-lyric'],
    [900, 1031, 'compact', 'compact-stacked-lyric'],
    [923, 1079, 'compact', 'compact-stacked-lyric'],
    [924, 1007, 'compact', 'compact-row-lyric'],
    [924, 1008, 'vertical', null],
    [1551, 720, 'compact', 'compact-row-lyric'],
    [1552, 720, 'horizontal', null],
    [640, 1079, 'compact', 'compact-stacked-lyric'],
    [640, 1080, 'quarter', null],
  ] as const satisfies ReadonlyArray<readonly [
    number,
    number,
    ResponsivePlayerLayoutResult['layout'],
    CompactLayoutProfile | null,
  ]>

  for (const [width, height, layout, compactProfile] of examples) {
    assertResolved(width, height, layout, compactProfile)
  }
})

test('891 与 1031 锚点不会被 4px 分桶吞掉', () => {
  const at891 = resolveResponsivePlayerLayout(640, 891)
  const at1031 = resolveResponsivePlayerLayout(640, 1031)

  assert.equal(at891.decisionHeight, 891)
  assert.equal(at891.compactProfile, 'compact-stacked')
  assert.equal(at1031.decisionHeight, 1031)
  assert.equal(at1031.compactProfile, 'compact-stacked-lyric')
})

test('Compact 安全下溢域按原始 viewport 比例整体缩放', () => {
  const examples = [
    [629, 715, 'compact-row', 629 / 640],
    [1220, 714, 'compact-row-lyric', 714 / 720],
    [576, 648, 'compact-row', 0.9],
    [639, 720, 'compact-row', 639 / 640],
    [640, 719, 'compact-row', 719 / 720],
    [1510, 719, 'compact-row-lyric', 719 / 720],
  ] as const satisfies ReadonlyArray<readonly [number, number, CompactLayoutProfile, number]>

  for (const [width, height, compactProfile, scale] of examples) {
    assertCompactFallback(width, height, compactProfile, scale)

    const expected = resolveResponsivePlayerLayout(width, height)
    for (let iteration = 0; iteration < 100; iteration += 1) {
      assert.deepEqual(resolveResponsivePlayerLayout(width, height), expected)
    }
  }
})

test('Compact 安全下溢域在 576x648 逐像素边界外退出到 legacy fail-safe', () => {
  for (const [width, height] of [[575, 648], [576, 647]] as const) {
    const result = resolveResponsivePlayerLayout(width, height)
    assert.notEqual(result.layout, 'compact', `${width}x${height}: layout`)
    assert.equal(result.compactProfile, null, `${width}x${height}: compactProfile`)
    assert.equal(result.fallback, true, `${width}x${height}: fallback`)
    assertClose(result.scale, 0.9, `${width}x${height}: scale`)
    assert.ok(Number.isFinite(result.scale), `${width}x${height}: finite scale`)
  }
})

test('正式候选优先于 Compact 安全下溢域', () => {
  const result = resolveResponsivePlayerLayout(1552, 714)

  assert.equal(result.layout, 'horizontal')
  assert.equal(result.compactProfile, null)
  assert.equal(result.fallback, false)
  assertClose(result.scale, 1552 / 1723)
})

test('全部受支持整数尺寸都由正式视图覆盖', () => {
  for (let width = 640; width <= 2560; width += 1) {
    for (let height = 720; height <= 1440; height += 1) {
      const result = resolveResponsivePlayerLayout(width, height)
      assert.equal(result.fallback, false, `${width}x${height}: ${stateKey(result)}`)
      assert.ok(Number.isFinite(result.scale), `${width}x${height}: finite scale`)
      if (result.layout === 'compact') {
        assert.equal(result.scale, 1, `${width}x${height}: compact scale`)
        assert.notEqual(result.compactProfile, null, `${width}x${height}: compact profile`)
      } else {
        assert.equal(result.compactProfile, null, `${width}x${height}: non-compact profile`)
      }
    }
  }
})

test('三个缺陷复现尺寸解析为批准的正式或安全下溢 Compact 状态', () => {
  assertCompactFallback(629, 715, 'compact-row', 0.9828125)

  const lyric = resolveResponsivePlayerLayout(955, 795)
  assert.equal(lyric.layout, 'compact')
  assert.equal(lyric.compactProfile, 'compact-row-lyric')
  assert.equal(lyric.fallback, false)
  assertClose(lyric.scale, 1)

  assertCompactFallback(1220, 714, 'compact-row-lyric', 0.9916666666666667)
})

test('1819x1108 继续选择竖半屏且候选没有内容尺寸溢出回归', () => {
  const viewport = { width: 1816, height: 1108 }
  const result = resolveResponsivePlayerLayout(1819, 1108)
  const horizontal = calculatePlayerLayoutCandidate('horizontal', viewport)
  const vertical = calculatePlayerLayoutCandidate('vertical', viewport)

  assert.ok(horizontal)
  assert.ok(vertical)
  assert.equal(result.layout, 'vertical')
  assert.equal(result.compactProfile, null)
  assert.equal(result.fallback, false)
  assertClose(result.scale, 1108 / 1120)
  assertClose(horizontal.distortion, 1108 / 1080 - 1)
  assertClose(vertical.distortion, 1 - 1108 / 1120)
  assert.ok(horizontal.distortion > vertical.distortion)

  const bounds = RESPONSIVE_PLAYER_LAYOUT_CONFIG.layouts.vertical
  const virtualWidth = 1819 / result.scale
  const virtualHeight = 1108 / result.scale
  assert.ok(virtualWidth + EPSILON >= bounds.minWidth)
  assert.ok(virtualHeight + EPSILON >= bounds.minHeight)
  assert.ok(Math.min(virtualWidth, bounds.maxWidth) <= bounds.maxWidth + EPSILON)
  assert.ok(Math.min(virtualHeight, bounds.maxHeight) <= bounds.maxHeight + EPSILON)
})

test('每个现有视图候选满足最小尺寸且可计算有限内容画布 cap', () => {
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

test('非 Compact 正式结果满足对应候选的最小尺寸与 max cap', () => {
  const boundaryHeights = [
    720, 721,
    1007, 1008,
    1079, 1080, 1081,
    1119, 1120, 1121,
    1199, 1200, 1201,
    1439, 1440,
  ]

  for (let width = 640; width <= 2560; width += 1) {
    for (const height of boundaryHeights) {
      const result = resolveResponsivePlayerLayout(width, height)
      if (result.fallback || !isScoredLayout(result.layout)) continue

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

test('0.90 是现有视图合法候选且低于下限进入 fail-safe', () => {
  const atMinimum = resolveResponsivePlayerLayout(576, 1080)
  assert.equal(atMinimum.layout, 'quarter')
  assert.equal(atMinimum.fallback, false)
  assertClose(atMinimum.scale, 0.9)

  const belowMinimum = resolveResponsivePlayerLayout(576, 1079)
  assert.equal(belowMinimum.layout, 'compact')
  assert.equal(belowMinimum.compactProfile, 'compact-stacked-lyric')
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

test('同一普通 4px 判定桶内布局稳定且最终 scale 使用原始尺寸连续变化', () => {
  const first = resolveResponsivePlayerLayout(1848, 1050)
  const last = resolveResponsivePlayerLayout(1851, 1050)

  assert.equal(first.decisionWidth, last.decisionWidth)
  assert.equal(first.layout, 'full')
  assert.equal(last.layout, 'full')
  assert.ok(last.scale > first.scale)
})

test('相同尺寸重复调用及乱序调用不改变顶层与 Compact 子状态', () => {
  const sizes = [
    [2560, 1440],
    [1819, 1108],
    [1552, 720],
    [924, 1008],
    [923, 1079],
    [900, 1031],
    [900, 720],
    [640, 1031],
    [640, 891],
    [640, 720],
    [639, 720],
    [629, 715],
    [576, 648],
    [575, 648],
    [576, 647],
  ] as const
  const expected = sizes.map(([width, height]) => resolveResponsivePlayerLayout(width, height))

  for (let iteration = 0; iteration < 100; iteration += 1) {
    for (let index = sizes.length - 1; index >= 0; index -= 1) {
      const [width, height] = sizes[index]
      assert.deepEqual(resolveResponsivePlayerLayout(width, height), expected[index])
    }
  }
})

function assertNoStateReentry(sizes: ReadonlyArray<readonly [number, number]>) {
  const exitedStates = new Set<string>()
  const [initialWidth, initialHeight] = sizes[0]
  let previousState = stateKey(resolveResponsivePlayerLayout(initialWidth, initialHeight))

  for (const [width, height] of sizes.slice(1)) {
    const state = stateKey(resolveResponsivePlayerLayout(width, height))
    if (state === previousState) continue

    exitedStates.add(previousState)
    assert.equal(
      exitedStates.has(state),
      false,
      `${previousState} -> ${state} at ${width}x${height} re-enters an exited state`,
    )
    previousState = state
  }
}

test('受支持域的横向与纵向正反扫描没有 layout+compactProfile 的 A→B→A', () => {
  for (const height of [720, 890, 891, 1007, 1008, 1030, 1031, 1079, 1080, 1120, 1200, 1440]) {
    const increasing = Array.from(
      { length: 2560 - 640 + 1 },
      (_, index) => [640 + index, height] as const,
    )
    assertNoStateReentry(increasing)
    assertNoStateReentry([...increasing].reverse())
  }

  for (const width of [640, 899, 900, 923, 924, 1024, 1551, 1552, 1723, 1920, 2560]) {
    const increasing = Array.from(
      { length: 1440 - 720 + 1 },
      (_, index) => [width, 720 + index] as const,
    )
    assertNoStateReentry(increasing)
    assertNoStateReentry([...increasing].reverse())
  }
})

test('宽轴充足但高度下溢时优先使用 Compact 安全画布', () => {
  const result = resolveResponsivePlayerLayout(1510, 719)

  assert.equal(result.fallback, true)
  assert.equal(result.layout, 'compact')
  assert.equal(result.compactProfile, 'compact-row-lyric')
  assertClose(result.scale, 719 / 720)
})

test('非法 viewport 输入也返回确定结果且不产生 NaN 或 Infinity', () => {
  for (const [width, height] of [
    [Number.NaN, Number.NaN],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [0, -1],
  ]) {
    const result = resolveResponsivePlayerLayout(width, height)
    assert.equal(result.layout, 'full')
    assert.equal(result.compactProfile, null)
    assert.equal(result.fallback, false)
    assert.equal(result.scale, 1)
    assert.ok(Number.isFinite(result.decisionWidth))
    assert.ok(Number.isFinite(result.decisionHeight))
  }
})
