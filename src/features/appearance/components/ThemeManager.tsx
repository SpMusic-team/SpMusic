import { useEffect, useRef, useState } from 'react'
import {
  CopyIcon,
  DownloadIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useThemeDraft } from '../hooks/useThemeDraft'
import { AdvancedThemeTab } from './theme-manager/AdvancedThemeTab'
import { ExperimentalThemeTab } from './theme-manager/ExperimentalThemeTab'
import { GeneralThemeTab } from './theme-manager/GeneralThemeTab'
import { PlayerThemeTab } from './theme-manager/PlayerThemeTab'
import { ThemeTokensTab } from './theme-manager/ThemeTokensTab'

type ThemeManagerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ThemeManager({ open, onOpenChange }: ThemeManagerProps) {
  const themeDraft = useThemeDraft()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const cancelDraftRef = useRef(themeDraft.cancelDraft)
  const keepAppliedPreviewRef = useRef(false)

  useEffect(() => {
    cancelDraftRef.current = themeDraft.cancelDraft
  })

  useEffect(() => () => {
    if (!keepAppliedPreviewRef.current) cancelDraftRef.current()
  }, [])

  function closeManager() {
    themeDraft.cancelDraft()
    onOpenChange(false)
  }

  function applyDraft() {
    if (!themeDraft.applyDraft()) return
    keepAppliedPreviewRef.current = true
    onOpenChange(false)
  }

  function removeTheme() {
    if (!themeDraft.removeTheme()) return
    setDeleteDialogOpen(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!nextOpen) closeManager()
      }}>
        <DialogContent
          className="theme-manager-dialog top-4 right-4 bottom-auto left-auto flex h-[calc(100svh-2rem)] w-[min(580px,calc(100vw-2rem))] max-w-[min(580px,calc(100vw-2rem))] translate-none flex-col gap-0 overflow-hidden p-0 max-[700px]:!inset-0 max-[700px]:!h-[100svh] max-[700px]:!w-screen max-[700px]:!max-h-none max-[700px]:!max-w-none max-[700px]:rounded-none max-[700px]:!translate-none"
          overlayClassName="theme-manager-overlay"
          showCloseButton={false}
        >
          <DialogHeader className="relative min-h-18 shrink-0 justify-center border-b px-4 py-3 pr-14">
            <DialogTitle>主题工作室</DialogTitle>
            <DialogDescription>管理内置与用户主题，实时预览 tokens、组件变体和受控 CSS。</DialogDescription>
            <DialogClose render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="关闭主题工作室" />}>
              <XIcon />
              <span className="sr-only">关闭主题工作室</span>
            </DialogClose>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Select items={themeDraft.themeOptions} value={themeDraft.selectedThemeId} onValueChange={(value) => value && themeDraft.chooseTheme(value)}>
                <SelectTrigger className="w-full" aria-label="当前主题"><SelectValue /></SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>{themeDraft.themeOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" aria-label="复制主题" onClick={themeDraft.duplicateTheme}><CopyIcon data-icon="inline-start" /></Button>
                <Button variant="outline" size="icon" aria-label="删除主题" disabled={themeDraft.selectedBuiltin || !themeDraft.selectedPersistedUser} onClick={() => setDeleteDialogOpen(true)}><Trash2Icon data-icon="inline-start" /></Button>
              </div>
            </div>

            <Tabs className="min-h-0" defaultValue="general">
              <TabsList>
                <TabsTrigger value="general">常规</TabsTrigger>
                <TabsTrigger value="player">播放器</TabsTrigger>
                <TabsTrigger value="tokens">Tokens</TabsTrigger>
                <TabsTrigger value="advanced">高级</TabsTrigger>
                <TabsTrigger value="experimental">实验</TabsTrigger>
              </TabsList>
              <GeneralThemeTab
                draft={themeDraft.draft}
                colorSchemePreference={themeDraft.draftColorSchemePreference}
                resolvedColorScheme={themeDraft.resolvedColorScheme}
                updateDraft={themeDraft.updateDraft}
                onColorSchemePreferenceChange={themeDraft.changeColorSchemePreference}
                onTierChange={themeDraft.changeTier}
              />
              <PlayerThemeTab
                draft={themeDraft.draft}
                resolvedColorScheme={themeDraft.resolvedColorScheme}
                updateDraft={themeDraft.updateDraft}
                updateDraftColor={themeDraft.updateDraftColor}
              />
              <ThemeTokensTab draft={themeDraft.draft} updateDraft={themeDraft.updateDraft} updateDraftColor={themeDraft.updateDraftColor} />
              <AdvancedThemeTab draft={themeDraft.draft} riskConfirmed={themeDraft.riskConfirmed} updateDraft={themeDraft.updateDraft} onConfirmRisk={themeDraft.confirmRisk} />
              <ExperimentalThemeTab
                draft={themeDraft.draft}
                resourcesText={themeDraft.resourcesText}
                riskConfirmed={themeDraft.riskConfirmed}
                updateDraft={themeDraft.updateDraft}
                onResourcesChange={themeDraft.updateResources}
                onConfirmRisk={themeDraft.confirmRisk}
              />
            </Tabs>
          </div>

          <DialogFooter className="m-0 block shrink-0 rounded-none border-t bg-muted/50 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={themeDraft.draft.metadata.tier === 'standard' ? 'secondary' : 'destructive'}>{themeDraft.draft.metadata.tier}</Badge>
                <span className="min-w-0 flex-1 text-sm text-muted-foreground" role="status">{themeDraft.status ?? '更改会实时预览；点击“取消”可完整恢复。'}</span>
              </div>
              <Separator />
              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void themeDraft.importThemeFile(file)
                      event.currentTarget.value = ''
                    }}
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}><UploadIcon data-icon="inline-start" />导入</Button>
                  <Button variant="outline" onClick={themeDraft.exportDraft}><DownloadIcon data-icon="inline-start" />导出</Button>
                  <Button variant="outline" onClick={themeDraft.resetDefaultTheme}><RotateCcwIcon data-icon="inline-start" />恢复默认</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeManager}>取消</Button>
                  <Button onClick={applyDraft}><SaveIcon data-icon="inline-start" />应用</Button>
                </div>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>立即删除“{themeDraft.draft.name}”？</AlertDialogTitle>
            <AlertDialogDescription>该用户主题会立即从本地主题库移除，关闭或取消主题工作室不会撤销此操作。内置主题不会受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留主题</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removeTheme}>删除主题</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
