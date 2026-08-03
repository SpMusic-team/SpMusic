import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
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
  Trash2Icon,
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
  MetadataValue,
  NewDocumentFields,
} from "./types"

const INITIAL_FILTERS: DocumentFilters = {
  query: "",
  docType: "",
  status: "",
  owner: "",
  scope: "",
  includeInternal: false,
  extra: {},
}

function metadataText(value: MetadataValue | undefined) {
  return Array.isArray(value) ? value.join(", ") : value || "—"
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

interface FilterSelectProps {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const items = [{ label: `全部${label}`, value: "__all__" }, ...options.map((option) => ({ label: option, value: option }))]
  return (
    <Select items={items} value={value || "__all__"} onValueChange={(nextValue) => onChange(nextValue === "__all__" || nextValue == null ? "" : nextValue)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
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
        {document.metadata.doc_type && <Badge variant="outline">{metadataText(document.metadata.doc_type)}</Badge>}
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
  const [filters, setFilters] = useState(INITIAL_FILTERS)
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

  function updateFilter(key: keyof DocumentFilters, value: string | boolean) {
    setFilters((current) => ({ ...current, [key]: value, ...(key === "docType" ? { extra: {} } : {}) }))
  }

  function updateExtraField(key: string, value: string) {
    setFilters((current) => {
      const extra = { ...current.extra }
      if (value) extra[key] = value
      else delete extra[key]
      return { ...current, extra }
    })
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

  const hasFilters = useMemo(() => Boolean(filters.query || filters.docType || filters.status || filters.owner || filters.scope || Object.keys(filters.extra).length > 0), [filters])
  const activeTypeFields = useMemo(() => {
    if (!filters.docType || !index) return []
    return index.filterSchema[filters.docType] ?? []
  }, [filters.docType, index])
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
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-2 rounded-lg border bg-background px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input
                className="border-0 px-0 shadow-none focus-visible:ring-0"
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="搜索标题、正文或元数据"
                aria-label="全文搜索"
              />
            </div>
            <FieldGroup className="gap-2">
              <FilterSelect label="类型" value={filters.docType} options={index?.facets.docTypes ?? []} onChange={(value) => updateFilter("docType", value)} />
              <FilterSelect label="状态" value={filters.status} options={index?.facets.statuses ?? []} onChange={(value) => updateFilter("status", value)} />
              <FilterSelect label="负责 Agent" value={filters.owner} options={index?.facets.owners ?? []} onChange={(value) => updateFilter("owner", value)} />
              <FilterSelect label="版本范围" value={filters.scope} options={index?.facets.scopes ?? []} onChange={(value) => updateFilter("scope", value)} />
              {activeTypeFields.map((field) => (
                <FilterSelect
                  key={field.key}
                  label={field.label}
                  value={filters.extra[field.key] ?? ""}
                  options={index?.facets[field.key] ?? []}
                  onChange={(value) => updateExtraField(field.key, value)}
                />
              ))}
            </FieldGroup>
            {hasFilters && <Button variant="ghost" size="sm" onClick={() => setFilters((current) => ({ ...INITIAL_FILTERS, includeInternal: current.includeInternal }))}>清除筛选</Button>}
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
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                <MoreHorizontalIcon />
                <span className="sr-only">列表选项</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem checked={filters.includeInternal} onCheckedChange={(checked) => updateFilter("includeInternal", checked === true)}>
                    显示 Agent 与内部文档
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {loadingIndex && !index ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />) : null}
              {!loadingIndex && index?.documents.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><FileIcon /></EmptyMedia>
                    <EmptyTitle>没有匹配的文档</EmptyTitle>
                    <EmptyDescription>调整搜索条件，或新建一份项目文档。</EmptyDescription>
                  </EmptyHeader>
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
                        <dt className="text-muted-foreground">类型</dt><dd>{metadataText(activeDocument.metadata.doc_type)}</dd>
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
