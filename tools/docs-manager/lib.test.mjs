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

test("document index exposes per-type filter schema and applies declared fields", () => {
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
  assert.deepEqual(bothIndex.filterSchema.bug.map((field) => field.key), ["severity", "module"])
  assert.deepEqual(bothIndex.facets.severity, ["中", "高"])
  assert.deepEqual(bothIndex.facets.module, ["播放控制器", "歌词页"])

  const ignoredIndex = buildDocumentIndex(docs, { docType: "bug", undeclared: "x" })
  assert.equal(ignoredIndex.documents.length, 2)
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
