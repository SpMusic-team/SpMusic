import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type { NewDocumentFields } from "./types"

const INITIAL_FIELDS: NewDocumentFields = {
  path: "docs/",
  docId: "",
  title: "",
  docType: "",
  status: "draft",
  ownerAgent: "Documentation Agent",
  versionScope: "project",
  sourceDocument: "user request",
}

interface DocumentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (fields: NewDocumentFields) => Promise<void>
}

export function DocumentForm({ open, onOpenChange, onSubmit }: DocumentFormProps) {
  const [fields, setFields] = useState(INITIAL_FIELDS)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setFields(INITIAL_FIELDS)
      setError("")
    }
    onOpenChange(nextOpen)
  }

  function update(field: keyof NewDocumentFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!fields.path.startsWith("docs/") || !fields.path.endsWith(".md")) {
      setError("路径必须位于 docs/ 下并以 .md 结尾")
      return
    }
    if (!fields.docId || !fields.title || !fields.docType) {
      setError("文档 ID、标题和类型不能为空")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      await onSubmit(fields)
      handleOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建文档失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新建项目文档</DialogTitle>
          <DialogDescription>生成符合项目 YAML 元数据规范的 Markdown 文档。</DialogDescription>
        </DialogHeader>
        <form id="new-document-form" onSubmit={submit}>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="document-path">仓库路径</FieldLabel>
              <Input id="document-path" value={fields.path} onChange={(event) => update("path", event.target.value)} aria-invalid={Boolean(error)} />
              <FieldDescription>例如 docs/requirements/document-manager.md</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="document-id">文档 ID</FieldLabel>
              <Input id="document-id" value={fields.docId} onChange={(event) => update("docId", event.target.value)} placeholder="DOC-DOCUMENT-MANAGER" />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-title">标题</FieldLabel>
              <Input id="document-title" value={fields.title} onChange={(event) => update("title", event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-type">文档类型</FieldLabel>
              <Input id="document-type" value={fields.docType} onChange={(event) => update("docType", event.target.value)} placeholder="requirements" />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-status">状态</FieldLabel>
              <Input id="document-status" value={fields.status} onChange={(event) => update("status", event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-owner">负责 Agent</FieldLabel>
              <Input id="document-owner" value={fields.ownerAgent} onChange={(event) => update("ownerAgent", event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-scope">版本范围</FieldLabel>
              <Input id="document-scope" value={fields.versionScope} onChange={(event) => update("versionScope", event.target.value)} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="document-source">来源文档</FieldLabel>
              <Input id="document-source" value={fields.sourceDocument} onChange={(event) => update("sourceDocument", event.target.value)} />
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>取消</Button>
          <Button type="submit" form="new-document-form" disabled={submitting}>{submitting ? "创建中…" : "创建文档"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
