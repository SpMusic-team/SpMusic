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

function facetValues(documents, field) {
  return [...new Set(documents.map((document) => document.metadata[field]).filter((value) => typeof value === "string" && value))].sort()
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
  const normalizedQuery = String(filters.query ?? "").trim().toLocaleLowerCase()
  const filtered = visibleDocuments.filter((document) => {
    const matchesQuery = !normalizedQuery || [
      document.path,
      document.title,
      document.excerpt,
      document.content,
      ...Object.values(document.metadata).flat(),
    ].join(" ").toLocaleLowerCase().includes(normalizedQuery)
    return matchesQuery
      && (!filters.docType || document.metadata.doc_type === filters.docType)
      && (!filters.status || document.metadata.status === filters.status)
      && (!filters.owner || document.metadata.owner_agent === filters.owner)
      && (!filters.scope || document.metadata.version_scope === filters.scope)
  })

  return {
    documents: filtered.map(({ content: _content, ...document }) => document),
    facets: {
      docTypes: facetValues(visibleDocuments, "doc_type"),
      statuses: facetValues(visibleDocuments, "status"),
      owners: facetValues(visibleDocuments, "owner_agent"),
      scopes: facetValues(visibleDocuments, "version_scope"),
    },
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
