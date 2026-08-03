import { execFile } from "node:child_process"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import chokidar from "chokidar"
import express from "express"

import {
  buildDocumentIndex,
  contentVersion,
  DocsManagerError,
  loadAllDocuments,
  parseDocument,
  resolveDocumentAssetPath,
  resolveManagedPath,
} from "./lib.mjs"

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(toolDirectory, "../..")
const production = process.argv.includes("--production")
const port = Number(process.env.DOCS_MANAGER_PORT || 4175)
const host = "127.0.0.1"

const app = express()
app.disable("x-powered-by")
app.use(express.json({ limit: "6mb" }))

let cachedDocuments = null
let refreshPromise = null
const eventClients = new Set()

function broadcast(event = "refresh") {
  for (const response of eventClients) response.write(`event: ${event}\ndata: ${Date.now()}\n\n`)
}

async function refreshDocuments() {
  if (!refreshPromise) {
    refreshPromise = loadAllDocuments(repositoryRoot)
      .then((documents) => {
        cachedDocuments = documents
        return documents
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

async function documents() {
  return cachedDocuments ?? refreshDocuments()
}

function requireMutationHeader(request, _response, next) {
  if (request.get("x-docs-manager") !== "1") {
    next(new DocsManagerError(403, "MISSING_LOCAL_HEADER", "缺少本地文档工作台请求标识"))
    return
  }
  next()
}

async function verifyVersion(absolutePath, expectedVersion) {
  if (!expectedVersion) return
  const current = await readFile(absolutePath, "utf8")
  if (contentVersion(current) !== expectedVersion) {
    throw new DocsManagerError(409, "DOCUMENT_CHANGED", "文档已被其他程序修改，请刷新后再保存")
  }
}

function validateContent(content) {
  if (typeof content !== "string") throw new DocsManagerError(400, "INVALID_CONTENT", "文档内容必须是文本")
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, repositoryRoot, port })
})

app.get("/api/documents", async (request, response, next) => {
  try {
    const { q, docType, status, owner, scope, internal, ...extra } = request.query
    const extraFilters = Object.fromEntries(
      Object.entries(extra).map(([key, value]) => [key, Array.isArray(value) ? String(value[0]) : String(value ?? "")]),
    )
    const index = buildDocumentIndex(await refreshDocuments(), {
      query: q,
      docType,
      status,
      owner,
      scope,
      includeInternal: internal === "true",
      ...extraFilters,
    })
    response.json(index)
  } catch (error) {
    next(error)
  }
})

app.get("/api/documents/content", async (request, response, next) => {
  try {
    const { absolutePath, relativePath } = resolveManagedPath(repositoryRoot, request.query.path)
    const [content, fileStat] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)])
    response.json(await parseDocument(repositoryRoot, relativePath, content, fileStat))
  } catch (error) {
    next(error)
  }
})

app.get("/api/assets", async (request, response, next) => {
  try {
    const { absolutePath, contentType } = resolveDocumentAssetPath(repositoryRoot, request.query.document, request.query.src)
    await stat(absolutePath)
    response.setHeader("Content-Type", contentType)
    response.setHeader("Cache-Control", "no-cache")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.sendFile(absolutePath)
  } catch (error) {
    next(error)
  }
})

app.post("/api/documents", requireMutationHeader, async (request, response, next) => {
  try {
    validateContent(request.body.content)
    const { absolutePath, relativePath } = resolveManagedPath(repositoryRoot, request.body.path, { write: true })
    if (!relativePath.startsWith("docs/")) {
      throw new DocsManagerError(403, "CREATE_IN_DOCS_ONLY", "新文档只能创建在 docs 目录中")
    }
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, request.body.content, { encoding: "utf8", flag: "wx" })
    cachedDocuments = null
    const fileStat = await stat(absolutePath)
    response.status(201).json(await parseDocument(repositoryRoot, relativePath, request.body.content, fileStat))
  } catch (error) {
    if (error?.code === "EEXIST") next(new DocsManagerError(409, "DOCUMENT_EXISTS", "目标文档已经存在"))
    else next(error)
  }
})

app.put("/api/documents", requireMutationHeader, async (request, response, next) => {
  try {
    validateContent(request.body.content)
    const { absolutePath, relativePath } = resolveManagedPath(repositoryRoot, request.body.path, { write: true })
    await verifyVersion(absolutePath, request.body.expectedVersion)
    await writeFile(absolutePath, request.body.content, "utf8")
    cachedDocuments = null
    const fileStat = await stat(absolutePath)
    response.json(await parseDocument(repositoryRoot, relativePath, request.body.content, fileStat))
  } catch (error) {
    next(error)
  }
})

app.patch("/api/documents/move", requireMutationHeader, async (request, response, next) => {
  try {
    const source = resolveManagedPath(repositoryRoot, request.body.path, { write: true })
    const target = resolveManagedPath(repositoryRoot, request.body.newPath, { write: true })
    if (!source.relativePath.startsWith("docs/")) {
      throw new DocsManagerError(403, "MOVE_DOCS_ONLY", "只有 docs 目录中的文档可以移动或重命名")
    }
    if (!target.relativePath.startsWith("docs/")) {
      throw new DocsManagerError(403, "MOVE_IN_DOCS_ONLY", "文档只能移动到 docs 目录中")
    }
    await verifyVersion(source.absolutePath, request.body.expectedVersion)
    await mkdir(path.dirname(target.absolutePath), { recursive: true })
    try {
      await stat(target.absolutePath)
      throw new DocsManagerError(409, "DOCUMENT_EXISTS", "目标文档已经存在")
    } catch (error) {
      if (error instanceof DocsManagerError) throw error
      if (error?.code !== "ENOENT") throw error
    }
    await rename(source.absolutePath, target.absolutePath)
    cachedDocuments = null
    response.json({ path: target.relativePath })
  } catch (error) {
    next(error)
  }
})

app.delete("/api/documents", requireMutationHeader, async (request, response, next) => {
  try {
    const { absolutePath, relativePath } = resolveManagedPath(repositoryRoot, request.query.path, { write: true })
    if (!relativePath.startsWith("docs/")) {
      throw new DocsManagerError(403, "DELETE_DOCS_ONLY", "只有 docs 目录中的文档可以删除")
    }
    await verifyVersion(absolutePath, request.query.expectedVersion)
    await rm(absolutePath)
    cachedDocuments = null
    response.json({ deleted: relativePath })
  } catch (error) {
    next(error)
  }
})

app.post("/api/open", requireMutationHeader, async (request, response, next) => {
  try {
    const { absolutePath } = resolveManagedPath(repositoryRoot, request.body.path)
    const reveal = request.body.reveal === true
    if (process.platform === "win32") {
      execFile("explorer.exe", reveal ? [`/select,${absolutePath}`] : [absolutePath])
    } else if (process.platform === "darwin") {
      execFile("open", reveal ? ["-R", absolutePath] : [absolutePath])
    } else {
      execFile("xdg-open", [reveal ? path.dirname(absolutePath) : absolutePath])
    }
    response.json({ opened: true })
  } catch (error) {
    next(error)
  }
})

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream")
  response.setHeader("Cache-Control", "no-cache")
  response.setHeader("Connection", "keep-alive")
  response.flushHeaders()
  response.write(`event: connected\ndata: ${Date.now()}\n\n`)
  eventClients.add(response)
  request.on("close", () => eventClients.delete(response))
})

const watcher = chokidar.watch(["**/*.md"], {
  cwd: repositoryRoot,
  ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/dist-docs-manager/**", "**/target/**"],
  ignoreInitial: true,
})
watcher.on("all", () => {
  cachedDocuments = null
  broadcast()
})

if (production) {
  const distribution = path.join(repositoryRoot, "dist-docs-manager")
  app.use(express.static(distribution))
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(distribution, "docs-manager.html")))
} else {
  const { createServer } = await import("vite")
  const vite = await createServer({
    configFile: path.join(repositoryRoot, "docs-manager.vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  })
  app.use((request, _response, next) => {
    if (request.url === "/") request.url = "/docs-manager.html"
    next()
  })
  app.use(vite.middlewares)
}

app.use((error, _request, response, _next) => {
  const status = error instanceof DocsManagerError ? error.status : 500
  const code = error instanceof DocsManagerError ? error.code : error?.code === "ENOENT" ? "DOCUMENT_NOT_FOUND" : "INTERNAL_ERROR"
  const message = error instanceof DocsManagerError ? error.message : error?.code === "ENOENT" ? "文档不存在" : "文档工作台发生内部错误"
  if (status === 500) console.error(error)
  response.status(status).json({ error: { code, message } })
})

const server = app.listen(port, host, async () => {
  await refreshDocuments()
  console.log(`SpMusic 文档工作台：http://${host}:${port}`)
})

async function shutdown() {
  await watcher.close()
  server.close(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
