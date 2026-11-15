/**
 * 头图显示租约（方案 §3 的粘性持有）。
 *
 * ## 要解决的问题
 *
 * 手动点击歌单内曲目后，`PlayerShell.tsx:843` 会把面板的封面 owner 从
 * `useAudioPlayer`（活动歌单）换成 `useLibraryArtwork`（浏览）。两个 owner 是两个
 * 独立的 store，hero 发布**无法跨 owner 交接**：新 owner 的 hero 槽是空的，面板
 * `useHeroArtwork` 的 `hero ?? row` 回退到首行的 256 预览，头图降档。
 *
 * 租约就是那段交接窗口里的显示层缓冲：仍描述同一详情页时继续渲染上一张已发布的
 * 快照，一旦不再描述就立刻丢掉。
 *
 * ## 为什么放在 `PlayerSurface` 而不是 `PlaylistPanel`
 *
 * `PlaylistPanel` 挂在 `key={playlist.deleteScope ?? …}` 之下。同列表点歌时该 key
 * 稳定（实测），但 `pageOrigin.kind !== 'playlist'` 的路径（队列 / 全部歌曲 /
 * 最近播放等）会变 —— 整块重挂载会连组件内 state 一起丢掉。放在 key 之外，
 * 「重挂载导致丢图」这一整类风险被一次性消掉，且不需要改动 `deleteScope` 的任何
 * 既有消费者。
 *
 * ## 用什么判定「还是同一个详情页」
 *
 * 用 **hero 键**，不用 trackId、也不用 scope 单独比较。hero 键必须由行键派生
 * （`heroPlaylistArtworkKey(keyByTrackId.get(firstTrackId))`），架构 R6 要求两个
 * owner 对同一个详情页算出同一个键，构造上保证 scope / id / 源路径三者相等。
 * 于是「租约还指向这个详情页」就等于「租约的 hero 键 == 面板当前的 hero 键」，
 * 这是一次字符串相等，没有第二套身份概念，也不会因为 scope 拼法不同而漂移。
 *
 * `identity`（`heroDisplayIdentity` 五元组）仍然随租约保存，但只用于诊断与
 * 请求代次判定，不参与「是否仍是同一页」的判定：它含 `artworkRevision`，重扫会
 * 让它变化，而重扫并不改变「屏幕上还是这个歌单」这一事实。
 *
 * ## 边界（结构性的，不靠自觉）
 *
 * 租约只服务头图渲染。它保存的是**已经发布过的** `PlaylistCoverImage` /
 * `CoverPresentation`，不参与任何按 trackId 的行映射，也不创建、不撤销 URL ——
 * URL 的所有权仍然完全属于发布它的 owner。租约只是「在 owner 交接期间继续指向
 * 那张图」。
 *
 * 因此租约必须有明确的结束点：新 owner 以同一 hero 键发布自己的快照后立即交棒。
 */
import type { PlaylistCoverImage } from '@/features/player/model/playerUiViewModel'
import type { CoverPresentation } from '@/features/player/model/playlistCoverReadiness'

/** 一条头图发布中，显示层需要保留的最少字段。 */
export type HeroLeasePublication = Readonly<{
  /** 该发布所在的 hero 键（由行键派生）。 */
  heroKey: string
  /** `heroDisplayIdentity` 五元组字符串。诊断与代次判定用。 */
  identity: string
  /** 该发布实际产出的档位。 */
  edge?: number
  image: PlaylistCoverImage
  presentation?: CoverPresentation
}>

/** 租约持有的显示快照。 */
export type HeroDisplayLease = Readonly<{
  heroKey: string
  identity: string
  image: PlaylistCoverImage
  presentation?: CoverPresentation
}>

export type HeroLeaseDecision = Readonly<{
  /** 本轮应当渲染的快照。`undefined` 表示没有可渲染的头图。 */
  render: HeroDisplayLease | undefined
  /** 本轮结果是否来自 owner 自己的发布（而不是租约）。 */
  fromOwner: boolean
}>

function asLease(publication: HeroLeasePublication): HeroDisplayLease {
  return {
    heroKey: publication.heroKey,
    identity: publication.identity,
    image: publication.image,
    ...(publication.presentation ? { presentation: publication.presentation } : {}),
  }
}

/**
 * 判断本轮头图该渲染什么。
 *
 * 决策优先级（从高到低）：
 *
 * 1. **owner 有 hero 发布** → 一律以 owner 为准。这是稳态，也是租约唯一的正常
 *    结束方式：新 owner 发布后旧图立即退场，不会出现「租约压住新图」。
 *    （`useHeroArtwork` 只订阅当前的 hero 键，所以到达这里的事件必然描述当前页。）
 * 2. **owner 没有 hero 发布，且租约的 hero 键 == 面板当前的 hero 键** → 继续渲染
 *    租约（交接窗口内，两者是同一张封面资源）。
 * 3. **其余** → 无头图。真的切到别的歌单时，旧图必须立刻消失。
 *
 * `currentHeroKey === undefined` 表示「面板此刻还没有可用首曲」，不是「换了详情页」：
 * 此时不做切换判断（保持租约），否则每次重挂载都会白丢一张好图。
 *
 * 纯函数：不读写 ref、不触发渲染、不释放 URL。所有状态迁移留在调用点，因此每种
 * 迁移都能用 `node --test` 直接断言，无需浏览器。
 */
export function decideHeroLease(input: {
  /** 当前租约（`undefined` = 此刻没有显示任何头图）。 */
  lease: HeroDisplayLease | undefined
  /** owner 此刻的 hero 发布（仅 hero 车道；行回退快照不算发布）。 */
  publication: HeroLeasePublication | undefined
  /** 面板按首曲行键派生出的 hero 键。 */
  currentHeroKey: string | undefined
}): HeroLeaseDecision {
  const { lease, publication, currentHeroKey } = input
  if (publication) return { render: asLease(publication), fromOwner: true }
  if (!lease) return { render: undefined, fromOwner: false }
  if (currentHeroKey !== undefined && lease.heroKey !== currentHeroKey) {
    return { render: undefined, fromOwner: false }
  }
  return { render: lease, fromOwner: false }
}

/**
 * 把一次决策写回租约状态。
 *
 * 单独一个函数，是为了让「渲染什么」与「记住什么」都能被同一个纯测试覆盖：
 * `render === undefined` 必须真的清掉租约，否则切走之后的一张图会留在内存里，
 * 被下一次同 hero 键的详情页误用。
 */
export function commitHeroLease(decision: HeroLeaseDecision): HeroDisplayLease | undefined {
  return decision.render ? asLease(decision.render) : undefined
}

/**
 * 两份租约是否描述同一张待显示的快照。
 *
 * 必须有这个判定，否则「渲染租约」这条路径会自我循环：每轮决策都会产出内容相同
 * 但对象不同的租约，写回状态后触发重渲染，再产出新对象……最终渲染风暴。
 * 比较的是**内容**而不是对象身份，因此上层的 `setState(previous => previous)`
 * 能真正 bail out。
 */
export function isSameHeroLease(
  left: HeroDisplayLease | undefined,
  right: HeroDisplayLease | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.heroKey !== right.heroKey) return false
  if (left.identity !== right.identity) return false
  if (left.image.src !== right.image.src) return false
  // The token is what makes a later DOM report attributable, so a new publication
  // of the same URL is still a different thing to remember.
  return left.presentation?.token.sessionGeneration === right.presentation?.token.sessionGeneration
    && left.presentation?.token.publishGeneration === right.presentation?.token.publishGeneration
}

/**
 * Whether a lease's image would survive its owner releasing it.
 *
 * This is the difference between the two URL kinds `releasePlaylistCoverUrl`
 * documents, and it decides whether the hold needs its own copy:
 *
 * - An **asset-protocol URL** (the path lane's `convertFileSrc`) stays loadable
 *   after release: `URL.revokeObjectURL` is a spec-level no-op on it, and the
 *   bitmap belongs to the WebView until the last `<img>` unmounts. Holding one is
 *   safe with no copy.
 * - A **`blob:` object URL** (the pixel fallback) is revoked by the releasing
 *   owner, and the held `<img>` would then point at a dead URL. Measured: two
 *   frames (~95 ms) of a held 512px hero rendered from a revoked URL during an
 *   owner handover, which is exactly the broken-image case the hold must not
 *   introduce. Such a lease needs a private copy.
 */
export function heroLeaseNeedsCopy(image: { src: string }): boolean {
  return image.src.startsWith('blob:')
}
