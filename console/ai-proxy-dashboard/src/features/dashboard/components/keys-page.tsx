import { useEffect, useMemo, useState } from "react"
import { BarChart3, Copy, Filter, Gauge, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Combobox } from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import { createKey, deleteKey, fetchKeys, fetchModels, getKey, renameKey, setKeyAllowedModels, setKeyCostQuota } from "@/features/dashboard/api"
import type { GatewayModel, ManagedApiKey, ManagedApiKeyDetail } from "@/features/dashboard/types"
import { formatCost } from "@/features/dashboard/utils"

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
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [savingModelsId, setSavingModelsId] = useState<string | null>(null)
  const [savingQuotaId, setSavingQuotaId] = useState<string | null>(null)
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyQuotaDraft, setNewKeyQuotaDraft] = useState("")
  const [renameDraft, setRenameDraft] = useState("")
  const [renameTarget, setRenameTarget] = useState<ManagedApiKey | null>(null)
  const [visibleKey, setVisibleKey] = useState<ManagedApiKeyDetail | null>(null)
  const [modelsTarget, setModelsTarget] = useState<ManagedApiKey | null>(null)
  const [quotaTarget, setQuotaTarget] = useState<ManagedApiKey | null>(null)
  const [quotaDraft, setQuotaDraft] = useState("")
  const [modelsDraft, setModelsDraft] = useState<string[]>([])
  const [modelsInput, setModelsInput] = useState("")
  const [configuredModels, setConfiguredModels] = useState<GatewayModel[]>([])
  const [modelsChannelFilter, setModelsChannelFilter] = useState("")
  const [modelsModelSelect, setModelsModelSelect] = useState("")

  const showFeedback = (message: string) => {
    toast.success(message)
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

    const trimmedQuota = newKeyQuotaDraft.trim()
    const costQuota = trimmedQuota === "" ? null : Number(trimmedQuota)
    if (costQuota != null && (!Number.isFinite(costQuota) || costQuota < 0)) {
      setError(t("keys.quotaValidation"))
      return
    }

    try {
      setCreating(true)
      const created = await createKey(name, costQuota)
      setKeys((current) => [created.record, ...(current ?? [])])
      setVisibleKey({ ...created.record, key: created.key })
      setCreateOpen(false)
      setNewKeyName("")
      setNewKeyQuotaDraft("")
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

  const openQuotaDialog = (key: ManagedApiKey) => {
    setQuotaTarget(key)
    setQuotaDraft(key.cost_quota == null ? "" : String(key.cost_quota))
    setQuotaOpen(true)
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

  const handleSaveQuota = async () => {
    const target = quotaTarget
    if (!target) return

    const trimmed = quotaDraft.trim()
    const costQuota = trimmed === "" ? null : Number(trimmed)
    if (costQuota != null && (!Number.isFinite(costQuota) || costQuota < 0)) {
      setError(t("keys.quotaValidation"))
      return
    }

    try {
      setSavingQuotaId(target.id)
      const updated = await setKeyCostQuota(target.id, costQuota)
      setKeys((current) => (current ?? []).map((item) => item.id === target.id ? { ...item, ...updated } : item))
      setVisibleKey((current) => current?.id === target.id ? { ...current, ...updated } : current)
      setQuotaOpen(false)
      setQuotaTarget(null)
      setError("")
      showFeedback(t("keys.quotaUpdated"))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setSavingQuotaId(null)
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
      {/* Toolbar — count + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {t("keys.totalCount", { count: keys?.length ?? 0 })}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadKeys()}>{t("common.refreshData")}</Button>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />{t("keys.newKey")}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("common.errorOccurred")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {keys === null ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : hasKeys ? (
        <div className="overflow-x-auto">
          <div className="grid min-w-[860px] grid-cols-[1.5fr_1fr_1.15fr_0.9fr_84px_140px] items-center gap-4 border-b border-border px-2 py-3 text-[10.5px] font-semibold text-muted-foreground">
            <span>{t("keys.nameCol")} / {t("keys.allowedModelsCol")}</span>
            <span>Key</span>
            <span>{t("keys.costQuotaCol")}</span>
            <span>{t("keys.lastUsedCol")}</span>
            <span>{t("keys.statusCol")}</span>
            <span className="text-right">{t("keys.actionsCol")}</span>
          </div>
          {keys.map((key) => {
            const wl = key.allowed_models ?? []
            const hasQuota = key.cost_quota != null
            const pct = hasQuota
              ? Math.min(100, Math.round((Number(key.cost_used) / Number(key.cost_quota || 1)) * 100))
              : 0
            const status = key.quota_exhausted
              ? { txt: t("keys.statusExhausted"), fg: "var(--lrs-danger)", bg: "var(--lrs-danger-bg)" }
              : hasQuota && pct >= 90
                ? { txt: t("keys.statusNearLimit"), fg: "var(--lrs-warn)", bg: "var(--lrs-warn-bg)" }
                : { txt: t("keys.statusEnabled"), fg: "var(--lrs-success)", bg: "var(--lrs-success-bg)" }
            const barColor = key.quota_exhausted
              ? "var(--lrs-danger)"
              : pct >= 90
                ? "var(--lrs-warn)"
                : "var(--primary)"
            return (
              <div
                key={key.id}
                className="grid min-w-[860px] grid-cols-[1.5fr_1fr_1.15fr_0.9fr_84px_140px] items-center gap-4 border-b border-border/60 px-2 py-4 text-[12.5px]"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{key.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {wl.length === 0 ? (
                      <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t("keys.allModels")}
                      </span>
                    ) : (
                      <>
                        {wl.slice(0, 4).map((m) => (
                          <span
                            key={m}
                            className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {m}
                          </span>
                        ))}
                        {wl.length > 4 ? (
                          <span className="text-[10px] text-muted-foreground">+{wl.length - 4}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
                  <span className="truncate">{key.prefix}••••</span>
                  <button
                    type="button"
                    className="shrink-0 text-primary"
                    title={t("common.copy")}
                    onClick={async () => {
                      const detail = await getKey(key.id)
                      const copied = await copyText(detail.key)
                      if (copied) toast.success(t("keys.keyCopied"))
                      else toast.error(t("keys.copyFailed"))
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div>
                  {hasQuota ? (
                    <>
                      <div className="mb-1 flex justify-between font-mono text-[11px]">
                        <span className="text-foreground">{formatCost(key.cost_used)}</span>
                        <span className="text-muted-foreground">/ {formatCost(key.cost_quota)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("keys.quotaUnlimited")}</span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {formatDateTime(key.last_used_at)}
                </div>
                <div>
                  <span
                    className="rounded-md px-2 py-1 text-[11px] font-semibold"
                    style={{ color: status.fg, background: status.bg }}
                  >
                    {status.txt}
                  </span>
                </div>
                <div className="flex justify-end gap-0.5">
                  <Button type="button" size="icon-sm" variant="ghost" title={t("keys.viewUsage")} onClick={() => onViewUsage(key.name)}>
                    <BarChart3 />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" title={t("keys.rename")} onClick={() => { setRenameTarget(key); setRenameDraft(key.name); setRenameOpen(true) }}>
                    <Pencil />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" title={t("keys.manageModels")} onClick={() => openModelsDialog(key)}>
                    <Filter />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" title={t("keys.manageQuota")} onClick={() => openQuotaDialog(key)}>
                    <Gauge />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" title={t("common.delete")} disabled={deletingId === key.id} onClick={() => void handleDelete(key)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            )
          })}
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
          <Field>
            <FieldLabel htmlFor="new-key-quota">{t("keys.quotaInputLabel")}</FieldLabel>
            <FieldContent>
              <Input
                id="new-key-quota"
                type="number"
                min={0}
                step="0.01"
                placeholder={t("keys.quotaInputPlaceholder")}
                value={newKeyQuotaDraft}
                onChange={(event) => setNewKeyQuotaDraft(event.target.value)}
              />
              <FieldDescription>{t("keys.createQuotaHint")}</FieldDescription>
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

      <Dialog open={quotaOpen} onOpenChange={(open) => { if (!open) { setQuotaOpen(false); setQuotaTarget(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keys.manageQuotaDialogTitle")}</DialogTitle>
            <DialogDescription>{t("keys.manageQuotaDialogDesc", { name: quotaTarget?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="quota-input">{t("keys.quotaInputLabel")}</FieldLabel>
            <FieldContent>
              <Input
                id="quota-input"
                type="number"
                min={0}
                step="0.01"
                placeholder={t("keys.quotaInputPlaceholder")}
                value={quotaDraft}
                onChange={(event) => setQuotaDraft(event.target.value)}
              />
              <FieldDescription>{t("keys.quotaInputHint", { used: formatCost(quotaTarget?.cost_used ?? 0) })}</FieldDescription>
            </FieldContent>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setQuotaOpen(false); setQuotaTarget(null) }}>{t("common.cancel")}</Button>
            <Button type="button" disabled={savingQuotaId === quotaTarget?.id} onClick={() => void handleSaveQuota()}>
              {savingQuotaId === quotaTarget?.id ? t("keys.quotaSaving") : t("keys.quotaSave")}
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
              if (copied) toast.success(t("keys.keyCopied"))
              else toast.error(t("keys.copyFailed"))
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
