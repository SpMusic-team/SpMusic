import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  ArrowUpDownIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  FileIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  createDocument,
  deleteDocument,
  documentAssetUrl,
  getDocument,
  listDocuments,
  moveDocument,
  openDocument,
  saveDocument,
} from "./api"
import { DocumentForm } from "./document-form"
import type {
  DocumentDetail,
  DocumentFilters,
  DocumentIndex,
  DocumentSummary,
  FacetOption,
  FilterOrder,
  FilterSort,
  IssuesFilter,
  MetadataValue,
  NewDocumentFields,
} from "./types"

const FILTER_PARAMS = ["docType", "status", "owner", "scope", "severity", "module", "priority"]

const PARAM_LABELS: Record<string, string> = {
  docType: "类型",
  status: "状态",
  owner: "负责 Agent",
  scope: "版本范围",
  severity: "严重程度",
  module: "模块",
  priority: "优先级",
}

const PARAM_KEYS: Record<string, string> = {
  docType: "doc_type",
  status: "status",
  owner: "owner_agent",
  scope: "version_scope",
  severity: "severity",
  module: "module",
  priority: "priority",
}

const DOC_TYPE_LABELS: Record<string, string> = {
  task: "任务",
  "optimization-requirement": "优化需求",
  bug: "缺陷",
  decision: "决策",
  architecture: "架构",
  requirements: "需求",
  implementation: "实现说明",
  "compatibility-evidence": "兼容性证据",
  "implementation-evidence": "实现证据",
  readme: "项目说明",
  "release-plan": "发布计划",
  "requirements-index": "需求索引",
  roadmap: "路线图",
  "sprint-plan": "迭代计划",
  "technical-decision-record": "技术决策记录",
  "test-catalog": "测试目录",
  "test-report": "测试报告",
  "ui-spec": "界面规范",
  "agent-prompt": "Agent 提示词",
  template: "模板",
}

const ISSUES_OPTIONS: { value: IssuesFilter; label: string }[] = [
  { value: "", label: "全部问题状态" },
  { value: "any", label: "有问题" },
  { value: "errors", label: "仅错误" },
  { value: "none", label: "无问题" },
]

const SORT_ITEMS: { sort: FilterSort; order: FilterOrder; label: string }[] = [
  { sort: "updated", order: "desc", label: "更新时间（新→旧）" },
  { sort: "updated", order: "asc", label: "更新时间（旧→新）" },
  { sort: "created", order: "desc", label: "创建时间（新→旧）" },
  { sort: "created", order: "asc", label: "创建时间（旧→新）" },
  { sort: "title", order: "asc", label: "标题（A→Z）" },
  { sort: "title", order: "desc", label: "标题（Z→A）" },
  { sort: "docId", order: "asc", label: "文档 ID（A→Z）" },
  { sort: "docId", order: "desc", label: "文档 ID（Z→A）" },
]

const INITIAL_FILTERS: DocumentFilters = {
  query: "",
  values: {},
  issues: "",
  sort: "updated",
  order: "desc",
  includeInternal: false,
}

function parseSort(value: string | null): FilterSort {
  return value === "created" || value === "title" || value === "docId" ? value : "updated"
}

function parseOrder(value: string | null): FilterOrder {
  return value === "asc" ? "asc" : "desc"
}

function parseIssues(value: string | null): IssuesFilter {
  return value === "any" || value === "errors" || value === "none" ? value : ""
}

function filtersFromUrl(): DocumentFilters {
  const params = new URLSearchParams(window.location.search)
  const values: Record<string, string[]> = {}
  for (const param of FILTER_PARAMS) {
    const raw = params.get(param)
    if (raw) {
      const list = raw.split(",").map((item) => item.trim()).filter(Boolean)
      if (list.length) values[param] = list
    }
  }
  return {
    query: params.get("q") ?? "",
    values,
    issues: parseIssues(params.get("issues")),
    sort: parseSort(params.get("sort")),
    order: parseOrder(params.get("order")),
    includeInternal: params.get("internal") === "true",
  }
}

function metadataText(value: MetadataValue | undefined) {
  return Array.isArray(value) ? value.join(", ") : value || "—"
}

function docTypeLabel(value: string) {
  return DOC_TYPE_LABELS[value] ?? `未知类型（${value}）`
}

function docTypeText(value: MetadataValue | undefined) {
  if (Array.isArray(value)) return value.map(docTypeLabel).join(", ")
  return value ? docTypeLabel(value) : "—"
}

function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function escapeYaml(value: string) {
  return JSON.stringify(value.trim())
}

function documentTemplate(fields: NewDocumentFields) {
  const today = new Date().toISOString().slice(0, 10)
  return `---
doc_id: ${escapeYaml(fields.docId)}
title: ${escapeYaml(fields.title)}
doc_type: ${escapeYaml(fields.docType)}
status: ${escapeYaml(fields.status)}
owner_agent: ${escapeYaml(fields.ownerAgent)}
version_scope: ${escapeYaml(fields.versionScope)}
created: ${escapeYaml(today)}
updated: ${escapeYaml(today)}
source_documents:
  - ${escapeYaml(fields.sourceDocument)}
---

# ${fields.title.trim()}

## 摘要

请在此补充文档内容。
`
}

interface FilterMultiSelectProps {
  label: string
  selected: string[]
  options: FacetOption[]
  onChange: (values: string[]) => void
  getOptionLabel?: (value: string) => string
}

function FilterMultiSelect({ label, selected, options, onChange, getOptionLabel = (value) => value }: FilterMultiSelectProps) {
  const summary = selected.length === 0 ? `全部${label}` : selected.length === 1 ? getOptionLabel(selected[0]) : `${label} ${selected.length} 项`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="w-full justify-start gap-1.5 px-2.5 font-normal" aria-label={label} />
        }
      >
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-64">
        <DropdownMenuGroup>
          {options.length === 0 ? (
            <DropdownMenuItem disabled>当前条件下无可用选项</DropdownMenuItem>
          ) : options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={() => onChange(
                selected.includes(option.value)
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value],
              )}
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{getOptionLabel(option.value)}</span>
                <span className="text-xs text-muted-foreground">{option.count}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>清空{label}筛选</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DocumentListItem({ document, selected, onSelect }: { document: DocumentSummary; selected: boolean; onSelect: () => void }) {
  const errorCount = document.issues.filter((item) => item.severity === "error").length
  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent text-accent-foreground",
      )}
      onClick={onSelect}
    >
      <span className="flex w-full items-start gap-2">
        <FileIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{document.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{document.path}</span>
        </span>
        {document.issues.length > 0 && (
          <Badge variant={errorCount > 0 ? "destructive" : "secondary"}>{document.issues.length}</Badge>
        )}
      </span>
      {document.excerpt && <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{document.excerpt}</span>}
      <span className="flex flex-wrap gap-1">
        {document.metadata.doc_type && <Badge variant="outline">{docTypeText(document.metadata.doc_type)}</Badge>}
        {document.metadata.status && <Badge variant="secondary">{metadataText(document.metadata.status)}</Badge>}
        {!document.editable && <Badge variant="outline">只读</Badge>}
      </span>
    </button>
  )
}

function LoadingWorkspace() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-[60vh] w-full" />
    </div>
  )
}

export function App() {
  const [filters, setFilters] = useState(filtersFromUrl)
  const [index, setIndex] = useState<DocumentIndex | null>(null)
  const [selectedPath, setSelectedPath] = useState("")
  const [document, setDocument] = useState<DocumentDetail | null>(null)
  const [source, setSource] = useState("")
  const [loadingIndex, setLoadingIndex] = useState(true)
  const [loadingDocument, setLoadingDocument] = useState(false)
  const [serverError, setServerError] = useState("")
  const [saving, setSaving] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renamePath, setRenamePath] = useState("")
  const [renameError, setRenameError] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [documentListCollapsed, setDocumentListCollapsed] = useState(false)
  const [documentInfoCollapsed, setDocumentInfoCollapsed] = useState(false)
  const queryTimer = useRef<number | null>(null)

  const activeDocument = document?.path === selectedPath ? document : null
  const dirty = Boolean(activeDocument && source !== activeDocument.content)

  const refreshIndex = useCallback(async (nextFilters = filters, quiet = false) => {
    if (!quiet) setLoadingIndex(true)
    try {
      const nextIndex = await listDocuments(nextFilters)
      setIndex(nextIndex)
      setServerError("")
      setSelectedPath((current) => {
        if (current && nextIndex.documents.some((item) => item.path === current)) return current
        return nextIndex.documents[0]?.path ?? ""
      })
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "无法连接文档服务")
    } finally {
      setLoadingIndex(false)
    }
  }, [filters])

  useEffect(() => {
    if (queryTimer.current) window.clearTimeout(queryTimer.current)
    queryTimer.current = window.setTimeout(() => void refreshIndex(filters), 180)
    return () => {
      if (queryTimer.current) window.clearTimeout(queryTimer.current)
    }
  }, [filters, refreshIndex])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.query) params.set("q", filters.query)
    for (const [param, values] of Object.entries(filters.values)) {
      if (values.length > 0) params.set(param, values.join(","))
    }
    if (filters.issues) params.set("issues", filters.issues)
    if (filters.sort !== "updated") params.set("sort", filters.sort)
    if (filters.order !== "desc") params.set("order", filters.order)
    if (filters.includeInternal) params.set("internal", "true")
    const search = params.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
  }, [filters])

  useEffect(() => {
    const events = new EventSource("/api/events")
    events.addEventListener("refresh", () => void refreshIndex(filters, true))
    return () => events.close()
  }, [filters, refreshIndex])

  useEffect(() => {
    if (!selectedPath) return
    let active = true
    void getDocument(selectedPath)
      .then((nextDocument) => {
        if (!active) return
        setDocument(nextDocument)
        setSource(nextDocument.content)
        setRenamePath(nextDocument.path)
      })
      .catch((error) => active && toast.error(error instanceof Error ? error.message : "读取文档失败"))
      .finally(() => active && setLoadingDocument(false))
    return () => { active = false }
  }, [selectedPath])

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const save = useCallback(async () => {
    if (!document || !dirty || !document.editable) return
    setSaving(true)
    try {
      const saved = await saveDocument(document.path, source, document.version)
      setDocument(saved)
      setSource(saved.content)
      toast.success("文档已保存")
      await refreshIndex(filters, true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存文档失败")
    } finally {
      setSaving(false)
    }
  }, [dirty, document, filters, refreshIndex, source])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [save])

  function setParamValues(param: string, values: string[]) {
    setFilters((current) => {
      const nextValues = { ...current.values }
      if (values.length) nextValues[param] = values
      else delete nextValues[param]
      return { ...current, values: nextValues }
    })
  }

  function setIssues(issues: IssuesFilter) {
    setFilters((current) => ({ ...current, issues }))
  }

  function setSorting(sort: FilterSort, order: FilterOrder) {
    setFilters((current) => ({ ...current, sort, order }))
  }

  function setIncludeInternal(checked: boolean) {
    setFilters((current) => ({ ...current, includeInternal: checked }))
  }

  function clearAllFilters() {
    setFilters((current) => ({ ...INITIAL_FILTERS, includeInternal: current.includeInternal }))
  }

  function applyPreset(preset: Partial<DocumentFilters>) {
    setFilters((current) => ({
      ...INITIAL_FILTERS,
      ...preset,
      values: preset.values ?? {},
      includeInternal: current.includeInternal,
    }))
  }

  async function create(fields: NewDocumentFields) {
    const created = await createDocument(fields.path, documentTemplate(fields))
    toast.success("文档已创建")
    setFilters(INITIAL_FILTERS)
    setDocument(created)
    setSource(created.content)
    setSelectedPath(created.path)
    await refreshIndex(INITIAL_FILTERS, true)
  }

  async function renameCurrent(event: React.FormEvent) {
    event.preventDefault()
    if (!document) return
    setRenameError("")
    try {
      const result = await moveDocument(document.path, renamePath, document.version)
      setRenameOpen(false)
      setSelectedPath(result.path)
      toast.success("文档路径已更新")
      await refreshIndex(filters, true)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "移动文档失败")
    }
  }

  async function removeCurrent() {
    if (!document) return
    setDeleting(true)
    try {
      await deleteDocument(document.path, document.version)
      setDeleteOpen(false)
      setSelectedPath("")
      setDocument(null)
      toast.success("文档已删除")
      await refreshIndex(filters, true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除文档失败")
    } finally {
      setDeleting(false)
    }
  }

  const hasFilters = useMemo(() => Boolean(
    filters.query
    || filters.issues
    || Object.values(filters.values).some((values) => values.length > 0),
  ), [filters])
  const schemaFields = useMemo(() => index?.filterSchema ?? FILTER_PARAMS.map((param) => ({
    key: PARAM_KEYS[param] ?? param,
    param,
    label: PARAM_LABELS[param] ?? param,
  })), [index])
  const activeChips = useMemo(() => {
    const chips: { param: string; label: string; value: string; displayValue: string }[] = []
    for (const param of FILTER_PARAMS) {
      const label = PARAM_LABELS[param] ?? param
      for (const value of filters.values[param] ?? []) {
        chips.push({ param, label, value, displayValue: param === "docType" ? docTypeLabel(value) : value })
      }
    }
    if (filters.issues === "any") chips.push({ param: "issues", label: "问题", value: "有问题", displayValue: "有问题" })
    if (filters.issues === "errors") chips.push({ param: "issues", label: "问题", value: "仅错误", displayValue: "仅错误" })
    if (filters.issues === "none") chips.push({ param: "issues", label: "问题", value: "无问题", displayValue: "无问题" })
    return chips
  }, [filters])
  const currentSortLabel = useMemo(
    () => SORT_ITEMS.find((item) => item.sort === filters.sort && item.order === filters.order)?.label ?? "排序",
    [filters.sort, filters.order],
  )
  const previewSource = useMemo(() => source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/u, ""), [source])

  return (
    <div className="docs-manager-shell">
      <header className="flex h-16 items-center justify-between gap-4 border-b px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">SpMusic 文档工作台</h1>
            <Badge variant={serverError ? "destructive" : "secondary"}>{serverError ? "服务异常" : "本地服务"}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">仓库 Markdown 的搜索、校验与编辑中心 · 127.0.0.1:4175</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon" onClick={() => void refreshIndex(filters)} />}>
              <RefreshCwIcon aria-hidden="true" />
              <span className="sr-only">刷新索引</span>
            </TooltipTrigger>
            <TooltipContent>刷新索引</TooltipContent>
          </Tooltip>
          <Button onClick={() => setNewOpen(true)}>
            <FilePlus2Icon data-icon="inline-start" />
            新建文档
          </Button>
        </div>
      </header>

      <main
        className={cn(
          "docs-manager-grid",
          filtersCollapsed && "docs-manager-grid-filters-collapsed",
          documentListCollapsed && "docs-manager-grid-list-collapsed",
        )}
      >
        <aside
          id="docs-filter-sidebar"
          className="docs-filter-sidebar flex min-h-0 flex-col border-r bg-muted/20"
          aria-hidden={filtersCollapsed}
        >
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
            <div className="flex items-center gap-2 rounded-lg border bg-background px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input
                className="border-0 px-0 shadow-none focus-visible:ring-0"
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="搜索标题、正文，或字段:值（如 status:待处理）"
                aria-label="全文搜索"
              />
            </div>
            {activeChips.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {activeChips.map((chip) => (
                  <Badge key={`${chip.param}:${chip.value}`} variant="secondary" className="gap-1 pr-1">
                    <span className="text-xs">{chip.label}: {chip.displayValue}</span>
                    <button
                      type="button"
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                      onClick={() => {
                        if (chip.param === "issues") setIssues("")
                        else setParamValues(chip.param, (filters.values[chip.param] ?? []).filter((value) => value !== chip.value))
                      }}
                      aria-label={`移除筛选 ${chip.label}: ${chip.displayValue}`}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <FieldGroup className="gap-2">
              {schemaFields.map((field) => (
                <FilterMultiSelect
                  key={field.param}
                  label={field.label}
                  selected={filters.values[field.param] ?? []}
                  options={index?.facets[field.param] ?? []}
                  onChange={(values) => setParamValues(field.param, values)}
                  getOptionLabel={field.param === "docType" ? docTypeLabel : undefined}
                />
              ))}
              <Select
                value={filters.issues || "__all__"}
                onValueChange={(value) => setIssues(value === "__all__" ? "" : value as IssuesFilter)}
              >
                <SelectTrigger className="w-full" aria-label="问题状态">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {ISSUES_OPTIONS.map((option) => (
                      <SelectItem key={option.value || "__all__"} value={option.value || "__all__"}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldGroup>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="flex-1" />}>
                  <SlidersHorizontalIcon data-icon="inline-start" />
                  预设
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={clearAllFilters}>全部文档</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyPreset({ values: { status: ["待处理"] } })}>待处理项</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyPreset({ values: { status: ["待评估"] } })}>待评估项</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyPreset({ issues: "any" })}>有问题文档</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyPreset({ issues: "errors" })}>仅错误文档</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {hasFilters && <Button variant="ghost" size="sm" onClick={clearAllFilters}>清除筛选</Button>}
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-2 p-4 text-sm">
            <div><span className="block text-2xl font-semibold">{index?.stats.total ?? 0}</span><span className="text-xs text-muted-foreground">文档总数</span></div>
            <div><span className="block text-2xl font-semibold">{index?.stats.filtered ?? 0}</span><span className="text-xs text-muted-foreground">当前结果</span></div>
            <div><span className="block text-2xl font-semibold">{index?.stats.editable ?? 0}</span><span className="text-xs text-muted-foreground">可编辑</span></div>
            <div><span className="block text-2xl font-semibold">{index?.stats.withIssues ?? 0}</span><span className="text-xs text-muted-foreground">需要检查</span></div>
          </div>
          <div className="mt-auto p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><ShieldCheckIcon className="size-4" />仅监听本机，写操作限制在项目文档目录。</div>
          </div>
        </aside>

        <section
          id="docs-document-list"
          className="docs-document-list flex min-h-0 flex-col border-r"
          aria-label="文档列表"
          aria-hidden={documentListCollapsed}
        >
          <div className="flex h-12 items-center justify-between gap-2 border-b px-3">
            <div className="flex min-w-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-controls="docs-filter-sidebar"
                      aria-expanded={!filtersCollapsed}
                      onClick={() => setFiltersCollapsed((current) => !current)}
                    />
                  }
                >
                  {filtersCollapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftCloseIcon aria-hidden="true" />}
                  <span className="sr-only">{filtersCollapsed ? "展开筛选栏" : "收起筛选栏"}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{filtersCollapsed ? "展开筛选栏" : "收起筛选栏"}</TooltipContent>
              </Tooltip>
              <span className="truncate text-sm font-medium">文档</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="sm" className="gap-1 px-2 text-xs font-normal text-muted-foreground" />
                  }
                >
                  <ArrowUpDownIcon className="size-4" />
                  <span className="hidden max-w-28 truncate lg:inline">{currentSortLabel}</span>
                  <span className="sr-only">排序</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>排序</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={`${filters.sort}:${filters.order}`}
                    onValueChange={(value) => {
                      const [sort, order] = value.split(":") as [FilterSort, FilterOrder]
                      setSorting(sort, order)
                    }}
                  >
                    {SORT_ITEMS.map((item) => (
                      <DropdownMenuRadioItem key={`${item.sort}:${item.order}`} value={`${item.sort}:${item.order}`}>
                        {item.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                  <MoreHorizontalIcon />
                  <span className="sr-only">列表选项</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem checked={filters.includeInternal} onCheckedChange={(checked) => setIncludeInternal(checked === true)}>
                      显示 Agent 与内部文档
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {loadingIndex && !index ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />) : null}
              {!loadingIndex && index?.documents.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><FileIcon /></EmptyMedia>
                    <EmptyTitle>没有匹配的文档</EmptyTitle>
                    <EmptyDescription>
                      {hasFilters ? "当前筛选条件下没有结果，可移除部分筛选后重试。" : "调整搜索条件，或新建一份项目文档。"}
                    </EmptyDescription>
                  </EmptyHeader>
                  {hasFilters && <Button variant="outline" size="sm" onClick={clearAllFilters}>清除筛选</Button>}
                </Empty>
              ) : null}
              {index?.documents.map((item) => (
                <DocumentListItem key={item.path} document={item} selected={item.path === selectedPath} onSelect={() => {
                  if (dirty && item.path !== selectedPath && !window.confirm("当前修改尚未保存，确定切换文档吗？")) return
                  setLoadingDocument(true)
                  setSelectedPath(item.path)
                }} />
              ))}
            </div>
          </ScrollArea>
        </section>

        <section className="min-h-0 min-w-0" aria-label="文档工作区">
          {serverError ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon"><AlertTriangleIcon /></EmptyMedia>
                <EmptyTitle>无法连接文档服务</EmptyTitle>
                <EmptyDescription>{serverError}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : loadingDocument ? <LoadingWorkspace /> : activeDocument ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex min-h-16 items-center justify-between gap-3 border-b px-5 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-controls="docs-document-list"
                          aria-expanded={!documentListCollapsed}
                          onClick={() => setDocumentListCollapsed((current) => !current)}
                        />
                      }
                    >
                      {documentListCollapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftCloseIcon aria-hidden="true" />}
                      <span className="sr-only">{documentListCollapsed ? "展开文档列表" : "收起文档列表"}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{documentListCollapsed ? "展开文档列表" : "收起文档列表"}</TooltipContent>
                  </Tooltip>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-semibold">{activeDocument.title}</h2>
                      {dirty && <Badge variant="secondary">未保存</Badge>}
                      {!activeDocument.editable && <Badge variant="outline">只读</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{activeDocument.path}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          aria-controls="docs-info-panel"
                          aria-expanded={!documentInfoCollapsed}
                          onClick={() => setDocumentInfoCollapsed((current) => !current)}
                        />
                      }
                    >
                      {documentInfoCollapsed ? <PanelRightOpenIcon aria-hidden="true" /> : <PanelRightCloseIcon aria-hidden="true" />}
                      <span className="sr-only">{documentInfoCollapsed ? "展开文档信息" : "隐藏文档信息"}</span>
                    </TooltipTrigger>
                    <TooltipContent>{documentInfoCollapsed ? "展开文档信息" : "隐藏文档信息"}</TooltipContent>
                  </Tooltip>
                  <Button onClick={() => void save()} disabled={!dirty || saving || !activeDocument.editable}>
                    {saving ? <RefreshCwIcon data-icon="inline-start" className="animate-spin" /> : <SaveIcon data-icon="inline-start" />}
                    {saving ? "保存中…" : "保存"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
                      <MoreHorizontalIcon />
                      <span className="sr-only">文档操作</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => void openDocument(activeDocument.path)}><ExternalLinkIcon />使用默认程序打开</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void openDocument(activeDocument.path, true)}><FolderOpenIcon />在资源管理器中显示</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(activeDocument.path).then(() => toast.success("路径已复制"))}><ClipboardIcon />复制仓库路径</DropdownMenuItem>
                      </DropdownMenuGroup>
                      {activeDocument.editable && activeDocument.path.startsWith("docs/") && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => { setRenamePath(activeDocument.path); setRenameOpen(true) }}><FilePenLineIcon />移动或重命名</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2Icon />删除文档</DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className={cn("docs-workspace-grid", documentInfoCollapsed && "docs-workspace-grid-info-collapsed")}>
                <Tabs defaultValue="preview" className="min-h-0 min-w-0 p-4">
                  <TabsList>
                    <TabsTrigger value="preview">预览</TabsTrigger>
                    <TabsTrigger value="source">源码</TabsTrigger>
                  </TabsList>
                  <TabsContent value="preview" className="mt-3 h-[calc(100%-2.75rem)] overflow-auto rounded-lg border bg-background p-6">
                    <article className="document-preview">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          img(props) {
                            const { node, src, alt, ...imageProps } = props
                            void node
                            return (
                              <img
                                {...imageProps}
                                src={documentAssetUrl(activeDocument.path, src)}
                                alt={alt ?? ""}
                                loading="lazy"
                              />
                            )
                          },
                        }}
                      >
                        {previewSource}
                      </ReactMarkdown>
                    </article>
                  </TabsContent>
                  <TabsContent value="source" className="mt-3 h-[calc(100%-2.75rem)]">
                    <Textarea
                      className="h-full min-h-0 resize-none font-mono leading-relaxed"
                      value={source}
                      onChange={(event) => setSource(event.target.value)}
                      readOnly={!activeDocument.editable}
                      spellCheck={false}
                      aria-label="Markdown 源码"
                    />
                  </TabsContent>
                </Tabs>

                <ScrollArea
                  id="docs-info-panel"
                  className="docs-info-panel border-l bg-muted/10"
                  aria-hidden={documentInfoCollapsed}
                >
                  <div className="flex flex-col gap-5 p-4">
                    <section className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">文档信息</h3>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-controls="docs-info-panel"
                                aria-expanded={!documentInfoCollapsed}
                                onClick={() => setDocumentInfoCollapsed(true)}
                              />
                            }
                          >
                            <PanelRightCloseIcon aria-hidden="true" />
                            <span className="sr-only">关闭信息面板</span>
                          </TooltipTrigger>
                          <TooltipContent>关闭信息面板</TooltipContent>
                        </Tooltip>
                      </div>
                      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
                        <dt className="text-muted-foreground">文档 ID</dt><dd className="break-all">{metadataText(activeDocument.metadata.doc_id)}</dd>
                        <dt className="text-muted-foreground">类型</dt><dd>{docTypeText(activeDocument.metadata.doc_type)}</dd>
                        <dt className="text-muted-foreground">状态</dt><dd>{metadataText(activeDocument.metadata.status)}</dd>
                        <dt className="text-muted-foreground">负责 Agent</dt><dd>{metadataText(activeDocument.metadata.owner_agent)}</dd>
                        <dt className="text-muted-foreground">版本范围</dt><dd>{metadataText(activeDocument.metadata.version_scope)}</dd>
                        <dt className="text-muted-foreground">文件大小</dt><dd>{Math.max(1, Math.round(activeDocument.size / 1024))} KB</dd>
                        <dt className="text-muted-foreground">磁盘更新</dt><dd>{dateText(activeDocument.modifiedAt)}</dd>
                      </dl>
                    </section>
                    <Separator />
                    <section className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">规范检查</h3>
                        <Badge variant={activeDocument.issues.length ? "secondary" : "outline"}>{activeDocument.issues.length}</Badge>
                      </div>
                      {activeDocument.issues.length === 0 ? (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckIcon className="size-4" />未发现问题</p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {activeDocument.issues.map((item, index) => (
                            <li key={`${item.code}-${index}`} className="flex gap-2 text-xs leading-relaxed">
                              <AlertTriangleIcon className={cn("mt-0.5 size-4 shrink-0", item.severity === "error" ? "text-destructive" : "text-muted-foreground")} />
                              <span>{item.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileIcon /></EmptyMedia>
                <EmptyTitle>选择一份文档</EmptyTitle>
                <EmptyDescription>从左侧列表选择文档以预览、检查或编辑。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </main>

      <DocumentForm open={newOpen} onOpenChange={setNewOpen} onSubmit={create} />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动或重命名文档</DialogTitle>
            <DialogDescription>目标必须位于 docs/ 目录，并保留 .md 扩展名。</DialogDescription>
          </DialogHeader>
          <form id="rename-document-form" onSubmit={(event) => void renameCurrent(event)}>
            <FieldGroup>
              <Field data-invalid={Boolean(renameError)}>
                <FieldLabel htmlFor="rename-path">目标路径</FieldLabel>
                <Input id="rename-path" value={renamePath} onChange={(event) => setRenamePath(event.target.value)} aria-invalid={Boolean(renameError)} />
                <FieldDescription>移动后，工作台会自动刷新索引。</FieldDescription>
                <FieldError>{renameError}</FieldError>
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button type="submit" form="rename-document-form">确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia><Trash2Icon /></AlertDialogMedia>
            <AlertDialogTitle>删除这份文档？</AlertDialogTitle>
            <AlertDialogDescription>{document?.path} 将从磁盘删除，此操作不会进入工作台回收站。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={() => void removeCurrent()}>{deleting ? "删除中…" : "确认删除"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
