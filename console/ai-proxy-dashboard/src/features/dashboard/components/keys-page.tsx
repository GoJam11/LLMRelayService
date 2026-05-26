import { useEffect, useMemo, useState } from "react"
import { BarChart3, Copy, Filter, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Combobox } from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createKey, deleteKey, fetchKeys, fetchModels, getKey, renameKey, setKeyAllowedModels } from "@/features/dashboard/api"
import type { GatewayModel, ManagedApiKey, ManagedApiKeyDetail } from "@/features/dashboard/types"

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return "--"
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function KeysPage({
  onUnauthorized,
  onViewUsage,
}: {
  onUnauthorized: () => void
  onViewUsage: (client: string) => void
}) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<ManagedApiKey[] | null>(null)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [savingModelsId, setSavingModelsId] = useState<string | null>(null)
  const [newKeyName, setNewKeyName] = useState("")
  const [renameDraft, setRenameDraft] = useState("")
  const [renameTarget, setRenameTarget] = useState<ManagedApiKey | null>(null)
  const [visibleKey, setVisibleKey] = useState<ManagedApiKeyDetail | null>(null)
  const [modelsTarget, setModelsTarget] = useState<ManagedApiKey | null>(null)
  const [modelsDraft, setModelsDraft] = useState<string[]>([])
  const [modelsInput, setModelsInput] = useState("")
  const [configuredModels, setConfiguredModels] = useState<GatewayModel[]>([])
  const [modelsChannelFilter, setModelsChannelFilter] = useState("")
  const [modelsModelSelect, setModelsModelSelect] = useState("")

  const showFeedback = (message: string) => {
    setFeedback(message)
    window.setTimeout(() => setFeedback(""), 1800)
  }

  const handleUnauthorized = (message: string) => {
    if (message === "unauthorized") {
      onUnauthorized()
      return true
    }
    return false
  }

  const loadKeys = async () => {
    try {
      const data = await fetchKeys()
      setKeys(data.keys)
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    }
  }

  const loadConfiguredModels = async () => {
    try {
      const data = await fetchModels()
      setConfiguredModels([...data.anthropic, ...data.openai])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    }
  }

  useEffect(() => {
    void loadKeys()
  }, [])

  useEffect(() => {
    if (modelsOpen) {
      void loadConfiguredModels()
    }
  }, [modelsOpen])

  const hasKeys = useMemo(() => (keys?.length ?? 0) > 0, [keys])
  const modelChannelOptions = useMemo(() => {
    return Array.from(new Set(configuredModels.map((model) => model.channelName)))
      .sort((left, right) => left.localeCompare(right))
      .map((channelName) => ({ value: channelName, label: channelName }))
  }, [configuredModels])
  const configuredModelOptions = useMemo(() => {
    const models = modelsChannelFilter
      ? configuredModels.filter((model) => model.channelName === modelsChannelFilter)
      : configuredModels
    return models
      .map((model) => ({
        value: JSON.stringify([model.channelName, model.id]),
        label: `${model.channelName} / ${model.id}`,
        modelId: model.id,
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [configuredModels, modelsChannelFilter])

  const handleCreate = async () => {
    const name = newKeyName.trim()
    if (!name) {
      setError(t("keys.nameEmptyError"))
      return
    }

    try {
      setCreating(true)
      const created = await createKey(name)
      setKeys((current) => [created.record, ...(current ?? [])])
      setVisibleKey({ ...created.record, key: created.key })
      setCreateOpen(false)
      setNewKeyName("")
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  const handleRename = async () => {
    const target = renameTarget
    const nextName = renameDraft.trim()
    if (!target) return
    if (!nextName) {
      setError(t("keys.nameEmptyError"))
      return
    }

    try {
      setRenamingId(target.id)
      const updated = await renameKey(target.id, nextName)
      setKeys((current) => (current ?? []).map((item) => item.id === target.id ? { ...item, ...updated } : item))
      setVisibleKey((current) => current?.id === target.id ? { ...current, name: updated.name } : current)
      setRenameOpen(false)
      setRenameTarget(null)
      setRenameDraft("")
      setError("")
      showFeedback(t("keys.keyNameUpdated"))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setRenamingId(null)
    }
  }

  const handleDelete = async (key: ManagedApiKey) => {
    const confirmed = window.confirm(t("keys.confirmDelete", { name: key.name }))
    if (!confirmed) return

    try {
      setDeletingId(key.id)
      await deleteKey(key.id)
      setKeys((current) => (current ?? []).filter((item) => item.id !== key.id))
      setVisibleKey((current) => (current?.id === key.id ? null : current))
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setDeletingId(null)
    }
  }

  const openModelsDialog = (key: ManagedApiKey) => {
    setModelsTarget(key)
    setModelsDraft([...(key.allowed_models ?? [])])
    setModelsInput("")
    setModelsChannelFilter("")
    setModelsModelSelect("")
    setModelsOpen(true)
  }

  const addModelRestriction = (value: string) => {
    const model = value.trim()
    if (!model || modelsDraft.includes(model)) return
    setModelsDraft((prev) => [...prev, model])
  }

  const handleModelsInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addModelRestriction(modelsInput)
      setModelsInput("")
    }
  }

  const handleSelectConfiguredModel = (value: string) => {
    setModelsModelSelect(value)
    const option = configuredModelOptions.find((item) => item.value === value)
    if (option) {
      addModelRestriction(option.modelId)
      setModelsModelSelect("")
    }
  }

  const removeModel = (model: string) => {
    setModelsDraft((prev) => prev.filter((m) => m !== model))
  }

  const handleSaveModels = async () => {
    const target = modelsTarget
    if (!target) return

    try {
      setSavingModelsId(target.id)
      const updated = await setKeyAllowedModels(target.id, modelsDraft)
      setKeys((current) => (current ?? []).map((item) => item.id === target.id ? { ...item, ...updated } : item))
      setModelsOpen(false)
      setModelsTarget(null)
      setError("")
      showFeedback(t("keys.allowedModelsUpdated"))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setSavingModelsId(null)
    }
  }

  if (error && keys === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("common.loadFailed")}</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={KeyRound}
        title={t("keys.title")}
        description={t("keys.description")}
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadKeys()}>{t("common.refreshData")}</Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />{t("keys.newKey")}
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("common.errorOccurred")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert>
          <AlertTitle>{t("common.done")}</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      {keys === null ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : hasKeys ? (
        <div className="rounded-lg border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("keys.nameCol")}</TableHead>
                <TableHead>{t("keys.prefixCol")}</TableHead>
                <TableHead>{t("keys.allowedModelsCol")}</TableHead>
                <TableHead>{t("keys.createdCol")}</TableHead>
                <TableHead>{t("keys.lastUsedCol")}</TableHead>
                <TableHead className="text-right">{t("keys.actionsCol")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono">{key.prefix}</Badge></TableCell>
                  <TableCell>
                    {(key.allowed_models ?? []).length === 0 ? (
                      <span className="text-muted-foreground text-xs">{t("keys.allowedModelsNone")}</span>
                    ) : (
                      <Badge variant="secondary" className="font-mono text-xs">
                        {t("keys.allowedModelsCount", { count: key.allowed_models.length })}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatDateTime(key.created_at)}</TableCell>
                  <TableCell>{formatDateTime(key.last_used_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="xs" variant="ghost" onClick={async () => {
                        const detail = await getKey(key.id)
                        const copied = await copyText(detail.key)
                        showFeedback(copied ? t("keys.keyCopied") : t("keys.copyFailed"))
                      }}>
                        <Copy data-icon="inline-start" />{t("common.copy")}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => onViewUsage(key.name)}>
                        <BarChart3 data-icon="inline-start" />{t("keys.viewUsage")}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => {
                        setRenameTarget(key)
                        setRenameDraft(key.name)
                        setRenameOpen(true)
                      }}>
                        <Pencil data-icon="inline-start" />{t("keys.rename")}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => openModelsDialog(key)}>
                        <Filter data-icon="inline-start" />{t("keys.manageModels")}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" disabled={deletingId === key.id} onClick={() => void handleDelete(key)}>
                        <Trash2 data-icon="inline-start" />{deletingId === key.id ? t("common.deleting") : t("common.delete")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("keys.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("keys.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keys.createDialogTitle")}</DialogTitle>
            <DialogDescription>{t("keys.createDialogDesc")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="new-key-name">{t("keys.keyNameLabel")}</FieldLabel>
            <FieldContent>
              <Input id="new-key-name" placeholder={t("keys.keyNamePlaceholder")} value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} />
            </FieldContent>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button type="button" disabled={creating} onClick={() => void handleCreate()}>
              <KeyRound data-icon="inline-start" />{creating ? t("keys.creating") : t("keys.createKey")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keys.renameDialogTitle")}</DialogTitle>
            <DialogDescription>{t("keys.renameDialogDesc")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rename-key-name">{t("keys.keyNameLabel")}</FieldLabel>
            <FieldContent>
              <Input id="rename-key-name" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
            </FieldContent>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>{t("common.cancel")}</Button>
            <Button type="button" disabled={renamingId === renameTarget?.id} onClick={() => void handleRename()}>
              <Pencil data-icon="inline-start" />{renamingId === renameTarget?.id ? t("common.saving") : t("keys.saveNameBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modelsOpen} onOpenChange={(open) => { if (!open) { setModelsOpen(false); setModelsTarget(null) } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("keys.manageModelsDialogTitle")}</DialogTitle>
            <DialogDescription>{t("keys.manageModelsDialogDesc", { name: modelsTarget?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>{t("keys.allowedModelsChannelLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={modelChannelOptions}
                  value={modelsChannelFilter}
                  onChange={(value) => {
                    setModelsChannelFilter(value)
                    setModelsModelSelect("")
                  }}
                  placeholder={t("keys.allowedModelsAllChannels")}
                  searchPlaceholder={t("common.searchRoute")}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("keys.allowedModelsConfiguredLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={configuredModelOptions}
                  value={modelsModelSelect}
                  onChange={handleSelectConfiguredModel}
                  placeholder={t("keys.allowedModelsSelectPlaceholder")}
                  searchPlaceholder={t("common.searchModel")}
                  emptyText={t("keys.allowedModelsNoConfigured")}
                />
              </FieldContent>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="models-input">{t("keys.allowedModelsInputPlaceholder")}</FieldLabel>
            <FieldContent>
              <Input
                id="models-input"
                placeholder={t("keys.allowedModelsInputPlaceholder")}
                value={modelsInput}
                onChange={(e) => setModelsInput(e.target.value)}
                onKeyDown={handleModelsInputKeyDown}
              />
            </FieldContent>
          </Field>
          {modelsDraft.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("keys.allowedModelsEmptyHint")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {modelsDraft.map((model) => (
                <Badge key={model} variant="secondary" className="font-mono text-xs gap-1 pr-1">
                  {model}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    onClick={() => removeModel(model)}
                    aria-label={`Remove ${model}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setModelsOpen(false); setModelsTarget(null) }}>{t("common.cancel")}</Button>
            <Button type="button" disabled={savingModelsId === modelsTarget?.id} onClick={() => void handleSaveModels()}>
              {savingModelsId === modelsTarget?.id ? t("keys.allowedModelsSaving") : t("keys.allowedModelsSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={visibleKey !== null} onOpenChange={(open) => { if (!open) setVisibleKey(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keys.viewDialogTitle")}</DialogTitle>
            <DialogDescription>{t("keys.viewDialogDesc", { name: visibleKey?.name || "API key" })}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-xs break-all text-foreground">{visibleKey?.key}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={async () => {
              if (!visibleKey?.key) return
              const copied = await copyText(visibleKey.key)
              showFeedback(copied ? t("keys.keyCopied") : t("keys.copyFailed"))
            }}>
              <Copy data-icon="inline-start" />{t("keys.copyKey")}
            </Button>
            <Button type="button" onClick={() => setVisibleKey(null)}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

