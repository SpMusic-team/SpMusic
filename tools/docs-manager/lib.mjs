import { createHash } from "node:crypto"
import { access, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import matter from "gray-matter"

export const REQUIRED_METADATA_FIELDS = [
  "doc_id",
  "title",
  "doc_type",
  "status",
  "owner_agent",
  "version_scope",
  "created",
  "updated",
  "source_documents",
]

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-docs-manager",
  "target",
  "coverage",
])

const EDITABLE_ROOT_FILES = new Set(["README.md", "GIT_WORKFLOW.md"])
const INTERNAL_PREFIXES = [".agents/", ".codex/", "agent-prompt/"]
const PM_MANAGED_INTERNAL_DOC_TYPES = new Set(["agent-prompt", "template"])
const ASSET_CONTENT_TYPES = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
])

export class DocsManagerError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = "DocsManagerError"
    this.status = status
    this.code = code
  }
}

export function normalizeRepoPath(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new DocsManagerError(400, "INVALID_PATH", "文档路径不能为空")
  }

  if (input.includes("\0") || path.isAbsolute(input)) {
    throw new DocsManagerError(400, "INVALID_PATH", "文档路径必须是仓库内的相对路径")
  }

  const normalized = path.posix.normalize(input.replaceAll("\\", "/")).replace(/^\.\//, "")
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new DocsManagerError(403, "PATH_OUTSIDE_REPOSITORY", "不能访问仓库以外的路径")
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new DocsManagerError(400, "MARKDOWN_ONLY", "文档工作台只管理 Markdown 文件")
  }
  return normalized
}

export function isInternalPath(relativePath) {
  return INTERNAL_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
}

export function isEditablePath(relativePath) {
  const normalized = normalizeRepoPath(relativePath)
  return normalized.startsWith("docs/")
    || normalized.startsWith(".agents/prompt/")
    || EDITABLE_ROOT_FILES.has(normalized)
}

export function resolveManagedPath(repositoryRoot, input, { write = false } = {}) {
  const relativePath = normalizeRepoPath(input)
  if (write && !isEditablePath(relativePath)) {
    throw new DocsManagerError(403, "READ_ONLY_DOCUMENT", "该文档属于受保护的项目配置，只能在工作台中查看")
  }

  const root = path.resolve(repositoryRoot)
  const absolutePath = path.resolve(root, ...relativePath.split("/"))
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new DocsManagerError(403, "PATH_OUTSIDE_REPOSITORY", "不能访问仓库以外的路径")
  }
  return { absolutePath, relativePath }
}

function normalizeAssetSource(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new DocsManagerError(400, "INVALID_ASSET_PATH", "图片路径不能为空")
  }

  const source = input.trim().replace(/^<|>$/g, "").split("#")[0].split("?")[0].replaceAll("\\", "/")
  if (!source || source.startsWith("//") || source.includes("\0") || /^[a-z][a-z0-9+.-]*:/i.test(source) || /^[a-z]:/i.test(source)) {
    throw new DocsManagerError(400, "INVALID_ASSET_PATH", "图片路径必须是仓库内的相对路径")
  }
  return source
}

export function resolveDocumentAssetPath(repositoryRoot, documentInput, sourceInput) {
  const documentPath = normalizeRepoPath(documentInput)
  const source = normalizeAssetSource(sourceInput)
  const contentType = ASSET_CONTENT_TYPES.get(path.extname(source).toLowerCase())
  if (!contentType) {
    throw new DocsManagerError(400, "IMAGE_ASSET_ONLY", "文档预览只允许加载图片资源")
  }

  const relativePath = path.posix.normalize(
    source.startsWith("/")
      ? source.slice(1)
      : path.posix.join(path.posix.dirname(documentPath), source),
  )
  if (relativePath === ".." || relativePath.startsWith("../") || relativePath.includes("/../")) {
    throw new DocsManagerError(403, "ASSET_OUTSIDE_REPOSITORY", "不能访问仓库以外的图片")
  }

  const root = path.resolve(repositoryRoot)
  const absolutePath = path.resolve(root, ...relativePath.split("/"))
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new DocsManagerError(403, "ASSET_OUTSIDE_REPOSITORY", "不能访问仓库以外的图片")
  }
  return { absolutePath, relativePath, contentType }
}

export function contentVersion(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

function firstHeading(content) {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function plainExcerpt(content) {
  return content
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
}

function stringifyMetadata(data) {
  return Object.fromEntries(
    Object.entries(data ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((item) => String(item))
        : value == null
          ? ""
          : String(value),
    ]),
  )
}

function issue(code, message, severity = "warning") {
  return { code, message, severity }
}

export function validateMetadata(metadata, hasFrontMatter) {
  const issues = []
  if (!hasFrontMatter) {
    issues.push(issue("MISSING_FRONT_MATTER", "缺少 YAML front matter", "error"))
  }

  for (const field of REQUIRED_METADATA_FIELDS) {
    const value = metadata[field]
    if (value === "" || value == null || (Array.isArray(value) && value.length === 0)) {
      issues.push(issue("MISSING_METADATA", `缺少元数据字段：${field}`, "error"))
    }
  }

  for (const field of ["created", "updated"]) {
    const value = metadata[field]
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      issues.push(issue("INVALID_DATE", `${field} 应使用 YYYY-MM-DD 格式`))
    }
  }
  return issues
}

async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function validateLinks(repositoryRoot, relativePath, content) {
  const issues = []
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, "")
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(rawTarget)) continue

    let decodedTarget
    try {
      decodedTarget = decodeURIComponent(rawTarget.split("#")[0].split("?")[0])
    } catch {
      issues.push(issue("INVALID_LINK", `无法解析链接：${rawTarget}`))
      continue
    }
    if (!decodedTarget) continue

    const documentDirectory = path.dirname(path.resolve(repositoryRoot, ...relativePath.split("/")))
    const target = path.resolve(documentDirectory, decodedTarget)
    const root = path.resolve(repositoryRoot)
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      issues.push(issue("LINK_OUTSIDE_REPOSITORY", `链接指向仓库外：${rawTarget}`))
      continue
    }
    if (!(await pathExists(target))) {
      issues.push(issue("BROKEN_LINK", `链接目标不存在：${rawTarget}`))
    }
  }
  return issues
}

export async function parseDocument(repositoryRoot, relativePath, content, fileStat) {
  let parsed
  let parseError
  try {
    parsed = matter(content)
  } catch (error) {
    parsed = { data: {}, content }
    parseError = error instanceof Error ? error.message : "YAML 解析失败"
  }

  const metadata = stringifyMetadata(parsed.data)
  const hasFrontMatter = /^---\s*\r?\n/.test(content)
  const issues = validateMetadata(metadata, hasFrontMatter)
  if (parseError) issues.unshift(issue("INVALID_FRONT_MATTER", parseError, "error"))
  issues.push(...(await validateLinks(repositoryRoot, relativePath, content)))

  const fallbackTitle = firstHeading(parsed.content) ?? path.basename(relativePath, path.extname(relativePath))
  const title = String(metadata.title || fallbackTitle)
  if (metadata.title && firstHeading(parsed.content) && metadata.title !== firstHeading(parsed.content)) {
    issues.push(issue("TITLE_MISMATCH", "元数据 title 与正文一级标题不一致"))
  }

  return {
    path: relativePath,
    title,
    metadata,
    excerpt: plainExcerpt(parsed.content),
    modifiedAt: fileStat.mtime.toISOString(),
    createdAt: fileStat.birthtime.toISOString(),
    size: fileStat.size,
    version: contentVersion(content),
    editable: isEditablePath(relativePath),
    internal: isInternalPath(relativePath),
    issues,
    content,
  }
}

async function collectMarkdownFiles(repositoryRoot, directory = "") {
  const absoluteDirectory = path.join(repositoryRoot, directory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const relativePath = path.posix.join(directory.replaceAll("\\", "/"), entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(repositoryRoot, relativePath)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(relativePath)
    }
  }
  return files
}

export async function loadAllDocuments(repositoryRoot) {
  const files = await collectMarkdownFiles(repositoryRoot)
  const documents = await Promise.all(
    files.map(async (relativePath) => {
      const { absolutePath } = resolveManagedPath(repositoryRoot, relativePath)
      const [content, fileStat] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)])
      return parseDocument(repositoryRoot, relativePath, content, fileStat)
    }),
  )

  const ids = new Map()
  for (const document of documents) {
    const id = document.metadata.doc_id
    if (!id || Array.isArray(id)) continue
    const paths = ids.get(id) ?? []
    paths.push(document.path)
    ids.set(id, paths)
  }
  for (const document of documents) {
    const id = document.metadata.doc_id
    if (typeof id === "string" && (ids.get(id)?.length ?? 0) > 1) {
      document.issues.push(issue("DUPLICATE_DOC_ID", `doc_id 与其他文档重复：${id}`, "error"))
    }
  }
  return documents.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

// 统一的元数据筛选字段。severity/module/priority 等不再依附某个 doc_type 才出现，
// 而是全部作为一级筛选项，通过 facet 计数引导可用值。
export const FILTER_FIELDS = [
  { key: "doc_type", param: "docType", label: "类型" },
  { key: "status", param: "status", label: "状态" },
  { key: "owner_agent", param: "owner", label: "负责 Agent" },
  { key: "version_scope", param: "scope", label: "版本范围" },
  { key: "severity", param: "severity", label: "严重程度" },
  { key: "module", param: "module", label: "模块" },
  { key: "priority", param: "priority", label: "优先级" },
]

// 搜索框 `字段:值` 快捷语法：doc_id/title/path 走包含匹配，其余与 FILTER_FIELDS 一致。
const QUERY_FIELD_ALIASES = {
  doc_id: "doc_id",
  docId: "doc_id",
  title: "title",
  path: "path",
  doc_type: "docType",
  docType: "docType",
  status: "status",
  owner: "owner",
  owner_agent: "owner",
  scope: "scope",
  version_scope: "scope",
  severity: "severity",
  module: "module",
  priority: "priority",
}

const QUERY_MATCH_FIELDS = [
  { key: "doc_id", param: "doc_id", match: "contains" },
  { key: "title", param: "title", match: "contains" },
  { key: "path", param: "path", match: "contains" },
]

function splitQueryTokens(query) {
  const tokens = []
  let current = ""
  let inQuotes = false
  for (const char of String(query ?? "")) {
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
    } else if (/\s/.test(char) && !inQuotes) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseQueryTokens(query) {
  const fieldValues = new Map()
  const textParts = []
  for (const token of splitQueryTokens(query)) {
    const colon = token.indexOf(":")
    if (colon > 0) {
      const name = token.slice(0, colon).trim().toLowerCase()
      let value = token.slice(colon + 1).trim()
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1)
      }
      const param = QUERY_FIELD_ALIASES[name]
      if (param && value) {
        const values = fieldValues.get(param) ?? []
        if (!values.includes(value)) values.push(value)
        fieldValues.set(param, values)
        continue
      }
    }
    const clean = token.startsWith('"') && token.endsWith('"') && token.length >= 2 ? token.slice(1, -1) : token
    if (clean) textParts.push(clean)
  }
  return { text: textParts.join(" ").trim(), fieldValues }
}

function toFilterValues(value) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  return [...new Set(list.flatMap((item) => String(item ?? "").split(",")).map((item) => item.trim()).filter(Boolean))]
}

function matchesField(document, field, values) {
  if (values.length === 0) return true
  if (field.match === "contains") {
    const source = field.key === "title"
      ? document.title
      : field.key === "path"
        ? document.path
        : String(document.metadata[field.key] ?? "")
    const haystack = source.toLocaleLowerCase()
    return values.some((value) => haystack.includes(value.toLocaleLowerCase()))
  }
  const haystack = String(document.metadata[field.key] ?? "")
  return values.some((value) => haystack === value)
}

function matchesIssues(document, value) {
  const mode = toFilterValues(value)[0]
  if (!mode) return true
  if (mode === "any") return document.issues.length > 0
  if (mode === "errors") return document.issues.some((item) => item.severity === "error")
  if (mode === "none") return document.issues.length === 0
  return true
}

function matchText(document, normalizedQuery) {
  return !normalizedQuery || [
    document.path,
    document.title,
    document.excerpt,
    document.content,
    ...Object.values(document.metadata).flat(),
  ].join(" ").toLocaleLowerCase().includes(normalizedQuery)
}

const SORTERS = {
  updated: (left, right) => left.modifiedAt.localeCompare(right.modifiedAt),
  created: (left, right) => left.createdAt.localeCompare(right.createdAt),
  title: (left, right) => left.title.localeCompare(right.title, "zh-CN"),
  docId: (left, right) => String(left.metadata.doc_id ?? "").localeCompare(String(right.metadata.doc_id ?? ""), "zh-CN"),
}

function applySort(documents, sort, order) {
  const sorter = SORTERS[sort] ?? SORTERS.updated
  const multiplier = order === "asc" ? 1 : -1
  return [...documents].sort((left, right) => multiplier * sorter(left, right))
}

function facetOptions(candidates, field) {
  const counts = new Map()
  for (const document of candidates) {
    const value = document.metadata[field.key]
    if (typeof value === "string" && value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "zh-CN"))
}

function isPmManagedInternalDocument(document) {
  return document.internal
    && document.metadata.owner_agent === "PM Agent"
    && PM_MANAGED_INTERNAL_DOC_TYPES.has(document.metadata.doc_type)
}

function isVisibleDocument(document, filters) {
  if (filters.includeInternal || !document.internal) return true
  return filters.owner === "PM Agent" && isPmManagedInternalDocument(document)
}

export function buildDocumentIndex(documents, filters = {}) {
  const visibleDocuments = documents.filter((document) => isVisibleDocument(document, filters))
  const { text, fieldValues } = parseQueryTokens(filters.query)
  const normalizedQuery = text.toLocaleLowerCase()

  // 显式筛选与搜索框 `字段:值` 语法合并，同一字段多值取并集（OR），跨字段 AND。
  const applied = new Map()
  for (const field of FILTER_FIELDS) {
    const values = [...toFilterValues(filters[field.param])]
    for (const value of fieldValues.get(field.param) ?? []) {
      if (!values.includes(value)) values.push(value)
    }
    if (values.length > 0) applied.set(field.param, values)
  }
  for (const field of QUERY_MATCH_FIELDS) {
    const values = fieldValues.get(field.param) ?? []
    if (values.length > 0) applied.set(field.param, values)
  }

  const matches = (document) => matchText(document, normalizedQuery)
    && FILTER_FIELDS.every((field) => matchesField(document, field, applied.get(field.param) ?? []))
    && QUERY_MATCH_FIELDS.every((field) => matchesField(document, field, applied.get(field.param) ?? []))
    && matchesIssues(document, filters.issues)

  const filtered = applySort(visibleDocuments.filter(matches), filters.sort, filters.order)

  // 动态 facet：除当前字段外的所有筛选（含全文与 issues）都参与候选集，
  // 因此每个下拉只展示「在其余条件下仍然存在的值」，并带计数。
  const facetCandidates = (skipParam) => visibleDocuments.filter((document) => {
    if (!matchText(document, normalizedQuery)) return false
    for (const field of FILTER_FIELDS) {
      if (field.param === skipParam) continue
      if (!matchesField(document, field, applied.get(field.param) ?? [])) return false
    }
    for (const field of QUERY_MATCH_FIELDS) {
      if (!matchesField(document, field, applied.get(field.param) ?? [])) return false
    }
    return matchesIssues(document, filters.issues)
  })

  return {
    documents: filtered.map(({ content: _content, ...document }) => document),
    filterSchema: FILTER_FIELDS,
    facets: Object.fromEntries(FILTER_FIELDS.map((field) => [field.param, facetOptions(facetCandidates(field.param), field)])),
    stats: {
      total: visibleDocuments.length,
      filtered: filtered.length,
      editable: visibleDocuments.filter((document) => document.editable).length,
      withIssues: visibleDocuments.filter((document) => document.issues.length > 0).length,
      errors: visibleDocuments.reduce((count, document) => count + document.issues.filter((item) => item.severity === "error").length, 0),
    },
    generatedAt: new Date().toISOString(),
  }
}
