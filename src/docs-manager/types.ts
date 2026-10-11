export type MetadataValue = string | string[]

export interface DocumentIssue {
  code: string
  message: string
  severity: "error" | "warning"
}

export interface DocumentSummary {
  path: string
  title: string
  metadata: Record<string, MetadataValue>
  excerpt: string
  modifiedAt: string
  createdAt: string
  size: number
  version: string
  editable: boolean
  internal: boolean
  issues: DocumentIssue[]
}

export interface DocumentDetail extends DocumentSummary {
  content: string
}

export interface FilterField {
  key: string
  param: string
  label: string
}

export interface FacetOption {
  value: string
  count: number
}

export type FilterSort = "updated" | "created" | "title" | "docId"
export type FilterOrder = "asc" | "desc"
export type IssuesFilter = "" | "any" | "errors" | "none"

export interface DocumentIndex {
  documents: DocumentSummary[]
  filterSchema: FilterField[]
  facets: Record<string, FacetOption[]>
  stats: {
    total: number
    filtered: number
    editable: number
    withIssues: number
    errors: number
  }
  generatedAt: string
}

export interface DocumentFilters {
  query: string
  values: Record<string, string[]>
  issues: IssuesFilter
  sort: FilterSort
  order: FilterOrder
  includeInternal: boolean
}

export interface NewDocumentFields {
  path: string
  docId: string
  title: string
  docType: string
  status: string
  ownerAgent: string
  versionScope: string
  sourceDocument: string
}
