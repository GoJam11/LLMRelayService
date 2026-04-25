import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle, GitFork, Loader2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, Wifi, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  createModelAlias,
  deleteModelAlias,
  fetchModelAliases,
  fetchProviders,
  testProvider,
  toggleModelAlias,
  updateModelAlias,
} from "@/features/dashboard/api"
import type { ModelAlias, ProviderInfo } from "@/features/dashboard/types"
import type { TestProviderResult } from "@/features/dashboard/api"

const EMPTY_FORM = {
  alias: "",
  provider: "",
  model: "",
  description: "",
}

function AliasForm({
  draft,
  providers,
  onChange,
}: {
  draft: typeof EMPTY_FORM
  providers: ProviderInfo[]
  onChange: (patch: Partial<typeof EMPTY_FORM>) => void
}) {
  const { t } = useTranslation()
  const selectedProvider = providers.find((p) => (p.providerUuid || p.channelName) === draft.provider)
  const availableModels = selectedProvider?.models ?? []

  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel>{t("routes.aliasLabel")}</FieldLabel>
        <FieldDescription>
          {t("routes.aliasHint")}
        </FieldDescription>
        <Input
          placeholder="Auto"
          value={draft.alias}
          onChange={(e) => onChange({ alias: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>{t("routes.targetProvider")}</FieldLabel>
        <Select
          value={draft.provider}
          onValueChange={(v) => onChange({ provider: v, model: "" })}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("routes.selectProvider")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providers.map((p) => (
                <SelectItem key={p.providerUuid || p.channelName} value={p.providerUuid || p.channelName}>
                  <span className="flex items-center gap-2">
                    {p.channelName}
                    {!p.enabled && (
                      <Badge variant="secondary" className="text-xs">{t("common.disabled")}</Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>{t("routes.targetModel")}</FieldLabel>
        <Select
          value={draft.model}
          onValueChange={(v) => onChange({ model: v })}
          disabled={!draft.provider || availableModels.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                !draft.provider
                  ? t("routes.selectFirstProvider")
                  : availableModels.length === 0
                    ? t("routes.noProviderModels")
                    : t("routes.selectTargetModel")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {availableModels.map((m) => (
                <SelectItem key={m.model} value={m.model}>
                  {m.model}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>{t("routes.notesLabel")}</FieldLabel>
        <Input
          placeholder={t("routes.notesPlaceholder")}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
    </FieldGroup>
  )
}

function AliasStatus({
  alias,
  providers,
}: {
  alias: ModelAlias
  providers: ProviderInfo[]
}) {
  const { t } = useTranslation()
  const provider = providers.find((p) => p.providerUuid === alias.provider) ?? providers.find((p) => p.channelName === alias.provider)
  const providerLabel = provider?.channelName ?? alias.provider
  if (!provider) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="gap-1 text-xs">
              <TriangleAlert className="h-3 w-3" />
              {t("providers.providerNotExist")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("providers.providerDeletedHint", { name: providerLabel })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  const modelExists = provider.models.some((m) => m.model === alias.model)
  if (!modelExists) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 border-yellow-500 text-xs text-yellow-600 dark:text-yellow-400">
              <TriangleAlert className="h-3 w-3" />
              {t("providers.modelRemoved")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("providers.modelRemovedHint", { model: alias.model, provider: providerLabel })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  if (!provider.enabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-xs">{t("providers.providerDisabled")}</Badge>
          </TooltipTrigger>
          <TooltipContent>{t("providers.providerDisabledHint", { name: providerLabel })}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return null
}

export function RoutesPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t } = useTranslation()
  const [aliases, setAliases] = useState<ModelAlias[] | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ModelAlias | null>(null)
  const [draft, setDraft] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Map<number, TestProviderResult | "loading">>(new Map())

  const handleUnauth = useCallback(
    (message: string) => {
      if (message === "unauthorized") {
        onUnauthorized()
        return true
      }
      return false
    },
    [onUnauthorized],
  )

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [aliasData, providerData] = await Promise.all([
        fetchModelAliases(),
        fetchProviders(),
      ])
      setAliases(aliasData.aliases)
      setProviders(providerData.providers)
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [handleUnauth])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditTarget(null)
    setDraft(EMPTY_FORM)
    setSubmitError("")
    setDialogOpen(true)
  }

  const openEdit = (alias: ModelAlias) => {
    setEditTarget(alias)
    setDraft({
      alias: alias.alias,
      provider: alias.provider,
      model: alias.model,
      description: alias.description ?? "",
    })
    setSubmitError("")
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    const trimmed = {
      alias: draft.alias.trim(),
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      description: draft.description.trim() || null,
    }
    if (!trimmed.alias || !trimmed.provider || !trimmed.model) {
      setSubmitError(t("routes.requiredFieldsError"))
      return
    }
    try {
      setSubmitting(true)
      setSubmitError("")
      if (editTarget) {
        const updated = await updateModelAlias(editTarget.id, trimmed)
        setAliases((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
      } else {
        const created = await createModelAlias(trimmed)
        setAliases((cur) => [...(cur ?? []), created])
      }
      setDialogOpen(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (alias: ModelAlias, enabled: boolean) => {
    try {
      setTogglingId(alias.id)
      const updated = await toggleModelAlias(alias.id, enabled)
      setAliases((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setError(message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      setDeletingId(id)
      await deleteModelAlias(id)
      setAliases((cur) => cur?.filter((a) => a.id !== id) ?? null)
      setTestResults((cur) => { const next = new Map(cur); next.delete(id); return next })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setError(message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleTest = async (alias: ModelAlias) => {
    setTestResults((cur) => new Map(cur).set(alias.id, "loading"))
    try {
      const resolvedChannelName = providers.find((p) => p.providerUuid === alias.provider)?.channelName ?? alias.provider
      const result = await testProvider(resolvedChannelName, alias.model)
      setTestResults((cur) => new Map(cur).set(alias.id, result))
    } catch (err) {
      setTestResults((cur) => new Map(cur).set(alias.id, {
        status: "error",
        statusCode: 0,
        message: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const hasAliases = useMemo(() => (aliases?.length ?? 0) > 0, [aliases])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={GitFork}
        title={t("routes.title")}
        description={t("routes.description", { interpolation: { escapeValue: false } })}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              {t("common.refresh")}
            </Button>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus />
              {t("routes.newAlias")}
            </Button>
          </>
        }
      />

      <Card>
        {error && (
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        )}

        <CardContent className="p-0">
          {aliases === null ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !hasAliases ? (
            <Empty>
              <EmptyHeader>
                <GitFork className="h-8 w-8 text-muted-foreground" />
              </EmptyHeader>
              <EmptyContent>
              <EmptyTitle>{t("routes.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("routes.emptyDescription")}
                </EmptyDescription>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("routes.colAlias")}</TableHead>
                  <TableHead>{t("routes.colProvider")}</TableHead>
                  <TableHead>{t("routes.colTargetModel")}</TableHead>
                  <TableHead>{t("routes.colNotes")}</TableHead>
                  <TableHead>{t("routes.colStatus")}</TableHead>
                  <TableHead className="w-24 text-right">{t("routes.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aliases.map((alias) => (
                  <TableRow key={alias.id} className={!alias.enabled ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-xs font-medium">{alias.alias}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {providers.find((p) => p.providerUuid === alias.provider)?.channelName ?? alias.provider}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {alias.model}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {alias.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={alias.enabled}
                          disabled={togglingId === alias.id}
                          onCheckedChange={(checked) => handleToggle(alias, checked)}
                        />
                        {alias.enabled && (
                          <AliasStatus alias={alias} providers={providers} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {(() => {
                          const result = testResults.get(alias.id)
                          if (result === "loading") {
                            return (
                              <Button type="button" variant="outline" size="xs" disabled>
                                <Loader2 data-icon="inline-start" className="animate-spin" />
                                {t("common.testing")}
                              </Button>
                            )
                          }
                          if (result) {
                            return (
                              <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className={result.status === "ok" ? "text-green-600 border-green-500/50 hover:text-green-700" : "text-destructive border-destructive/50 hover:text-destructive"}
                                    onClick={() => handleTest(alias)}
                                  >
                                    {result.status === "ok"
                                      ? <CheckCircle data-icon="inline-start" />
                                      : <XCircle data-icon="inline-start" />
                                    }
                                    {t("common.test")}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">{result.message}</p>
                                  {result.latencyMs != null && (
                                    <p className="text-xs text-muted-foreground">{result.latencyMs}ms</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                              </TooltipProvider>
                            )
                          }
                          return (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => handleTest(alias)}
                            >
                              <Wifi data-icon="inline-start" />
                              {t("common.test")}
                            </Button>
                          )
                        })()}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => openEdit(alias)}
                        >
                          <Pencil data-icon="inline-start" />
                          {t("common.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === alias.id}
                          onClick={() => handleDelete(alias.id)}
                        >
                          <Trash2 data-icon="inline-start" />
                          {t("common.delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? t("routes.editDialogTitle") : t("routes.createDialogTitle")}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? t("routes.editDialogDesc")
                : t("routes.createDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <AliasForm
            draft={draft}
            providers={providers}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
