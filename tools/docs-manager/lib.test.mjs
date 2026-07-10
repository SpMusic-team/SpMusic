import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDocumentIndex,
  contentVersion,
  isEditablePath,
  normalizeRepoPath,
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
  assert.equal(isEditablePath(".agents/prompt/PM_Agent.md"), false)
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
