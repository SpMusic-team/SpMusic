import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDocumentIndex,
  contentVersion,
  isEditablePath,
  normalizeRepoPath,
  resolveDocumentAssetPath,
  validateMetadata,
} from "./lib.mjs"

test("normalizeRepoPath normalizes separators and blocks traversal", () => {
  assert.equal(normalizeRepoPath("docs\\requirements.md"), "docs/requirements.md")
  assert.throws(() => normalizeRepoPath("../outside.md"), /仓库以外/)
  assert.throws(() => normalizeRepoPath("docs/data.json"), /Markdown/)
})

test("editable paths are limited to project documentation", () => {
  assert.equal(isEditablePath("docs/tasks/sp-001.md"), true)
  assert.equal(isEditablePath("README.md"), true)
  assert.equal(isEditablePath(".agents/prompt/PM_Agent.md"), true)
  assert.equal(isEditablePath(".agents/skills/shadcn/SKILL.md"), false)
})

test("metadata validation reports missing fields", () => {
  const issues = validateMetadata({ title: "测试" }, true)
  assert.ok(issues.some((item) => item.message.includes("doc_id")))
  assert.ok(issues.some((item) => item.message.includes("updated")))
})

test("content versions are stable and content-sensitive", () => {
  assert.equal(contentVersion("same"), contentVersion("same"))
  assert.notEqual(contentVersion("same"), contentVersion("changed"))
})

test("document index applies query and metadata filters", () => {
  const base = {
    path: "docs/a.md",
    title: "Alpha",
    excerpt: "music player",
    content: "music player",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    metadata: { doc_type: "requirements", status: "active", owner_agent: "PM", version_scope: "v1" },
    editable: true,
    internal: false,
    issues: [],
  }
  const index = buildDocumentIndex([base, { ...base, path: "docs/b.md", title: "Beta", content: "other" }], {
    query: "Alpha",
    docType: "requirements",
  })
  assert.equal(index.documents.length, 1)
  assert.equal(index.documents[0].title, "Alpha")
})

function makeDoc(path, metadata = {}) {
  return {
    path,
    title: path,
    excerpt: "",
    content: "",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { ...metadata },
    editable: true,
    internal: false,
    issues: [],
  }
}

test("document index exposes unified filter schema and applies declared fields", () => {
  const base = {
    path: "docs/changes/bugs/BUG-0001.md",
    title: "Bug 1",
    excerpt: "",
    content: "",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    metadata: {
      doc_type: "bug",
      status: "待处理",
      owner_agent: "Documentation Agent",
      version_scope: "project",
      severity: "中",
      module: "歌词页",
    },
    editable: true,
    internal: false,
    issues: [],
  }
  const other = {
    ...base,
    path: "docs/changes/bugs/BUG-0002.md",
    title: "Bug 2",
    metadata: { ...base.metadata, severity: "高", module: "播放控制器" },
  }

  const docs = [base, other]

  const severityIndex = buildDocumentIndex(docs, { severity: "中" })
  assert.equal(severityIndex.documents.length, 1)
  assert.equal(severityIndex.documents[0].path, "docs/changes/bugs/BUG-0001.md")

  const moduleIndex = buildDocumentIndex(docs, { module: "播放控制器" })
  assert.equal(moduleIndex.documents.length, 1)
  assert.equal(moduleIndex.documents[0].path, "docs/changes/bugs/BUG-0002.md")

  const bothIndex = buildDocumentIndex(docs, { docType: "bug", severity: "中", module: "歌词页" })
  assert.equal(bothIndex.documents.length, 1)
  assert.deepEqual(bothIndex.filterSchema.map((field) => field.key), [
    "doc_type",
    "status",
    "owner_agent",
    "version_scope",
    "severity",
    "module",
    "priority",
  ])
  // module=歌词页 会引导 severity 的可用值只剩「中」。
  assert.deepEqual(bothIndex.facets.severity.map((option) => option.value), ["中"])
  // 只筛 docType 时 severity 两个值都在，并带计数。
  const typeOnlyIndex = buildDocumentIndex(docs, { docType: "bug" })
  assert.deepEqual(typeOnlyIndex.facets.severity.map((option) => option.value).sort(), ["中", "高"])
  assert.equal(typeOnlyIndex.facets.severity.find((option) => option.value === "中").count, 1)

  const ignoredIndex = buildDocumentIndex(docs, { docType: "bug", undeclared: "x" })
  assert.equal(ignoredIndex.documents.length, 2)
})

test("filter fields accept multiple values with OR semantics", () => {
  const docs = [
    makeDoc("docs/a.md", { doc_type: "task", status: "ready", owner_agent: "PM Agent", version_scope: "v1" }),
    makeDoc("docs/b.md", { doc_type: "task", status: "in-progress", owner_agent: "PM Agent", version_scope: "v1" }),
    makeDoc("docs/c.md", { doc_type: "task", status: "done", owner_agent: "PM Agent", version_scope: "v1" }),
  ]

  const commaSeparated = buildDocumentIndex(docs, { status: "ready,in-progress" })
  assert.equal(commaSeparated.documents.length, 2)

  const arrayValues = buildDocumentIndex(docs, { status: ["ready", "done"] })
  assert.equal(arrayValues.documents.length, 2)

  const single = buildDocumentIndex(docs, { status: "ready" })
  assert.equal(single.documents.length, 1)
})

test("facets are guided by other active filters and exclude their own field", () => {
  const docs = [
    makeDoc("docs/changes/bugs/BUG-0001.md", {
      doc_type: "bug",
      status: "待处理",
      severity: "中",
      module: "歌词页",
      owner_agent: "Documentation Agent",
      version_scope: "project",
    }),
    makeDoc("docs/changes/bugs/BUG-0002.md", {
      doc_type: "bug",
      status: "待处理",
      severity: "高",
      module: "播放控制器",
      owner_agent: "Documentation Agent",
      version_scope: "project",
    }),
    makeDoc("docs/changes/optimizations/OPT-0001.md", {
      doc_type: "optimization-requirement",
      status: "待评估",
      priority: "高",
      module: "音频后端",
      owner_agent: "Documentation Agent",
      version_scope: "project",
    }),
  ]

  // 只筛 docType=bug 时，severity 选项只剩 bug 文档的值，OPT 文档的 priority 不再污染它。
  const bugIndex = buildDocumentIndex(docs, { docType: "bug" })
  assert.deepEqual(bugIndex.facets.severity.map((option) => option.value).sort(), ["中", "高"])
  assert.deepEqual(bugIndex.facets.module.map((option) => option.value).sort(), ["播放控制器", "歌词页"])

  // severity 自己的筛选不缩小自己的可选值，方便继续多选。
  const selfIndex = buildDocumentIndex(docs, { severity: "中" })
  assert.deepEqual(selfIndex.facets.severity.map((option) => option.value).sort(), ["中", "高"])

  // 状态筛选也会引导其他字段：只看待评估时，severity 不再出现 bug 的值。
  const evalIndex = buildDocumentIndex(docs, { status: "待评估" })
  assert.equal(evalIndex.documents.length, 1)
  assert.deepEqual(evalIndex.facets.severity, [])
})

test("document index sorts by requested field and order", () => {
  const docs = [
    makeDoc("docs/b.md", { doc_id: "B-1", doc_type: "bug" }),
    makeDoc("docs/a.md", { doc_id: "A-1", doc_type: "bug" }),
  ]

  const byTitle = buildDocumentIndex(docs, { sort: "title", order: "asc" })
  assert.deepEqual(byTitle.documents.map((document) => document.path), ["docs/a.md", "docs/b.md"])

  const byDocId = buildDocumentIndex(docs, { sort: "docId", order: "desc" })
  assert.deepEqual(byDocId.documents.map((document) => document.metadata.doc_id), ["B-1", "A-1"])
})

test("query field tokens narrow results and merge with explicit filters", () => {
  const docs = [
    makeDoc("docs/changes/bugs/BUG-0001.md", {
      doc_id: "BUG-0001",
      doc_type: "bug",
      status: "待处理",
      severity: "中",
      owner_agent: "Documentation Agent",
    }),
    makeDoc("docs/changes/optimizations/OPT-0001.md", {
      doc_id: "OPT-0001",
      doc_type: "optimization-requirement",
      status: "待评估",
      priority: "高",
      owner_agent: "Documentation Agent",
    }),
  ]

  const byDocId = buildDocumentIndex(docs, { query: "doc_id:OPT-0001" })
  assert.deepEqual(byDocId.documents.map((document) => document.path), ["docs/changes/optimizations/OPT-0001.md"])

  // 搜索框里的 status:待处理 与显式 status=待评估 取并集。
  const merged = buildDocumentIndex(docs, { query: "status:待处理", status: "待评估" })
  assert.equal(merged.documents.length, 2)

  // 引号包裹的带空格值。
  const quoted = buildDocumentIndex(docs, { query: 'owner:"Documentation Agent"' })
  assert.equal(quoted.documents.length, 2)
})

test("issues filter narrows documents with validation problems", () => {
  const clean = makeDoc("docs/clean.md", { doc_id: "C-1", doc_type: "bug" })
  const warning = {
    ...makeDoc("docs/warn.md", { doc_id: "W-1", doc_type: "bug" }),
    issues: [{ code: "WARN", message: "提示", severity: "warning" }],
  }
  const error = {
    ...makeDoc("docs/error.md", { doc_id: "E-1", doc_type: "bug" }),
    issues: [{ code: "ERR", message: "错误", severity: "error" }],
  }

  assert.equal(buildDocumentIndex([clean, warning, error], { issues: "any" }).documents.length, 2)
  assert.equal(buildDocumentIndex([clean, warning, error], { issues: "errors" }).documents.length, 1)
  assert.equal(buildDocumentIndex([clean, warning, error], { issues: "none" }).documents.length, 1)
})

test("PM owner filter includes PM-managed internal agent prompts", () => {
  const base = {
    path: "docs/tasks/sp-001.md",
    title: "Task",
    excerpt: "planning",
    content: "planning",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    metadata: { doc_type: "task", status: "ready", owner_agent: "PM Agent", version_scope: "v1" },
    editable: true,
    internal: false,
    issues: [],
  }
  const pmPrompt = {
    ...base,
    path: ".agents/prompt/PM_Agent.md",
    title: "PM Agent 系统提示词",
    metadata: { doc_type: "agent-prompt", status: "active", owner_agent: "PM Agent", version_scope: "project" },
    internal: true,
  }
  const frontendPrompt = {
    ...pmPrompt,
    path: ".agents/prompt/Frontend_Agent.md",
    title: "Frontend Agent 系统提示词",
    metadata: { ...pmPrompt.metadata, owner_agent: "Frontend Agent" },
  }

  const pmIndex = buildDocumentIndex([base, pmPrompt, frontendPrompt], { owner: "PM Agent" })
  assert.deepEqual(pmIndex.documents.map((document) => document.path).sort(), [
    ".agents/prompt/PM_Agent.md",
    "docs/tasks/sp-001.md",
  ])

  const frontendIndex = buildDocumentIndex([base, pmPrompt, frontendPrompt], { owner: "Frontend Agent" })
  assert.equal(frontendIndex.documents.length, 0)
})

test("document image assets resolve relative to the markdown document", () => {
  const asset = resolveDocumentAssetPath(
    process.cwd(),
    "docs/ui/player-shell.md",
    "assets/player-shell-prototype.png",
  )
  assert.equal(asset.relativePath, "docs/ui/assets/player-shell-prototype.png")
  assert.equal(asset.contentType, "image/png")
})

test("document image assets reject unsupported and outside paths", () => {
  assert.throws(
    () => resolveDocumentAssetPath(process.cwd(), "docs/ui/player-shell.md", "assets/data.json"),
    (error) => error.code === "IMAGE_ASSET_ONLY",
  )
  assert.throws(
    () => resolveDocumentAssetPath(process.cwd(), "docs/ui/player-shell.md", "../../../secret.png"),
    (error) => error.code === "ASSET_OUTSIDE_REPOSITORY",
  )
})
