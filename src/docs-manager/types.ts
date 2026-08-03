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
  label: string
}

export interface DocumentIndex {
  documents: DocumentSummary[]
  filterSchema: Record<string, FilterField[]>
  facets: {
    docTypes: string[]
    statuses: string[]
    owners: string[]
    scopes: string[]
    [key: string]: string[]
  }
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
  docType: string
  status: string
  owner: string
  scope: string
  includeInternal: boolean
  extra: Record<string, string>
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
