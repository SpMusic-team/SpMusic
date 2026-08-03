import type { DocumentDetail, DocumentFilters, DocumentIndex } from "./types"

export class ApiError extends Error {
  code: string
  status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? `请求失败（${response.status}）`,
    )
  }
  return response.json() as Promise<T>
}

function mutation(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
      "x-docs-manager": "1",
    },
    body: body == null ? undefined : JSON.stringify(body),
  }
}

export function documentAssetUrl(documentPath: string, source?: string) {
  const src = source?.trim()
  if (!src || src.startsWith("//") || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(src)) return src ?? ""

  const query = new URLSearchParams({ document: documentPath, src })
  return `/api/assets?${query}`
}

export function listDocuments(filters: DocumentFilters) {
  const query = new URLSearchParams()
  if (filters.query) query.set("q", filters.query)
  if (filters.docType) query.set("docType", filters.docType)
  if (filters.status) query.set("status", filters.status)
  if (filters.owner) query.set("owner", filters.owner)
  if (filters.scope) query.set("scope", filters.scope)
  if (filters.includeInternal) query.set("internal", "true")
  for (const [key, value] of Object.entries(filters.extra)) {
    if (value) query.set(key, value)
  }
  return request<DocumentIndex>(`/api/documents?${query}`)
}

export function getDocument(path: string) {
  return request<DocumentDetail>(`/api/documents/content?path=${encodeURIComponent(path)}`)
}

export function createDocument(path: string, content: string) {
  return request<DocumentDetail>("/api/documents", mutation("POST", { path, content }))
}

export function saveDocument(path: string, content: string, expectedVersion: string) {
  return request<DocumentDetail>("/api/documents", mutation("PUT", { path, content, expectedVersion }))
}

export function moveDocument(path: string, newPath: string, expectedVersion: string) {
  return request<{ path: string }>("/api/documents/move", mutation("PATCH", { path, newPath, expectedVersion }))
}

export function deleteDocument(path: string, expectedVersion: string) {
  const query = new URLSearchParams({ path, expectedVersion })
  return request<{ deleted: string }>(`/api/documents?${query}`, mutation("DELETE"))
}

export function openDocument(path: string, reveal = false) {
  return request<{ opened: boolean }>("/api/open", mutation("POST", { path, reveal }))
}
