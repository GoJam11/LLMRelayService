import { useEffect, useMemo, useState } from "react"
import { Image, Loader2, RefreshCw, Save, Settings2, TimerReset } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchGatewayTimeoutSettings, updateGatewayTimeoutSettings } from "@/features/dashboard/api"
import type { GatewayTimeoutSettingsPayload, TimeoutLimit } from "@/features/dashboard/types"

type TimeoutFormState = {
  defaultFirstByteTimeoutSeconds: string
  imageFirstByteTimeoutSeconds: string
  responseIdleTimeoutSeconds: string
}

function secondsText(ms: number): string {
  const seconds = ms / 1000
  return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(3)))
}

function formatUpdatedAt(timestamp: number | null, language: string): string {
  if (!timestamp) return "--"
  return new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN", { hour12: false })
}

function toForm(settings: GatewayTimeoutSettingsPayload): TimeoutFormState {
  return {
    defaultFirstByteTimeoutSeconds: secondsText(settings.defaultFirstByteTimeoutMs),
    imageFirstByteTimeoutSeconds: secondsText(settings.imageFirstByteTimeoutMs),
    responseIdleTimeoutSeconds: secondsText(settings.responseIdleTimeoutMs),
  }
}

function parseSeconds(
  value: string,
  label: string,
  limit: TimeoutLimit,
  t: (key: string, options?: Record<string, unknown>) => string,
): number {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(t("settings.validationRequired", { label }))
  }

  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds)) {
    throw new Error(t("settings.validationNumber", { label }))
  }

  const ms = Math.round(seconds * 1000)
  if (ms < limit.minMs || ms > limit.maxMs) {
    throw new Error(t("settings.validationRange", {
      label,
      min: secondsText(limit.minMs),
      max: secondsText(limit.maxMs),
    }))
  }

  return ms
}

function TimeoutField({
  id,
  label,
  value,
  onChange,
  defaultMs,
  limit,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  defaultMs: number
  limit: TimeoutLimit
}) {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldContent>
        <div className="relative">
          <Input
            id={id}
            type="number"
            min={secondsText(limit.minMs)}
            max={secondsText(limit.maxMs)}
            step="1"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="pr-12 tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {t("settings.secondsSuffix")}
          </span>
        </div>
        <FieldDescription>
          {t("settings.defaultValue", { value: secondsText(defaultMs) })} · {t("settings.rangeHint", {
            min: secondsText(limit.minMs),
            max: secondsText(limit.maxMs),
          })}
        </FieldDescription>
      </FieldContent>
    </Field>
  )
}

function PolicyCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Settings2
  label: string
  value: string
}) {
  return (
    <div className="flex min-h-24 flex-col justify-between border border-border/70 bg-card/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 text-2xl font-bold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

export function SettingsPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<GatewayTimeoutSettingsPayload | null>(null)
  const [form, setForm] = useState<TimeoutFormState>({
    defaultFirstByteTimeoutSeconds: "30",
    imageFirstByteTimeoutSeconds: "300",
    responseIdleTimeoutSeconds: "300",
  })
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleUnauthorized = (message: string) => {
    if (message === "unauthorized") {
      onUnauthorized()
      return true
    }
    return false
  }

  const loadSettings = async () => {
    setLoading(true)
    try {
      const data = await fetchGatewayTimeoutSettings()
      setSettings(data)
      setForm(toForm(data))
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  const canSubmit = settings !== null && !saving

  const currentPolicy = useMemo(() => {
    const source = settings
    if (!source) return []
    return [
      {
        label: t("settings.normalPolicy"),
        value: `${secondsText(source.defaultFirstByteTimeoutMs)}s`,
        icon: Settings2,
      },
      {
        label: t("settings.imagePolicy"),
        value: `${secondsText(source.imageFirstByteTimeoutMs)}s`,
        icon: Image,
      },
      {
        label: t("settings.bodyIdlePolicy"),
        value: source.responseIdleTimeoutMs === 0
          ? t("settings.disabledPolicy")
          : `${secondsText(source.responseIdleTimeoutMs)}s`,
        icon: TimerReset,
      },
    ]
  }, [settings, t])

  const handleSave = async () => {
    if (!settings) return
    try {
      setSaving(true)
      const payload = {
        defaultFirstByteTimeoutMs: parseSeconds(
          form.defaultFirstByteTimeoutSeconds,
          t("settings.defaultFirstByteLabel"),
          settings.limits.firstByte,
          t,
        ),
        imageFirstByteTimeoutMs: parseSeconds(
          form.imageFirstByteTimeoutSeconds,
          t("settings.imageFirstByteLabel"),
          settings.limits.firstByte,
          t,
        ),
        responseIdleTimeoutMs: parseSeconds(
          form.responseIdleTimeoutSeconds,
          t("settings.responseIdleLabel"),
          settings.limits.responseIdle,
          t,
        ),
      }
      const next = await updateGatewayTimeoutSettings(payload)
      setSettings(next)
      setForm(toForm(next))
      setError("")
      setFeedback(t("settings.saved"))
      window.setTimeout(() => setFeedback(""), 1800)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauthorized(message)) return
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Settings2}
        title={t("settings.title")}
        description={t("settings.description")}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void loadSettings()}
            >
              <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : ""} />
              {t("common.refresh")}
            </Button>
            <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void handleSave()}>
              {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{settings ? t("common.errorOccurred") : t("settings.loadFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert>
          <AlertTitle>{t("common.done")}</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      {settings === null ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="gap-2 border-b border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{t("settings.firstByteTitle")}</CardTitle>
                  <CardDescription className="mt-1">{t("settings.firstByteDesc")}</CardDescription>
                </div>
                <Badge variant="secondary">
                  {t("settings.updatedAt", { time: formatUpdatedAt(settings.updatedAt, i18n.language) })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <TimeoutField
                  id="default-first-byte-timeout"
                  label={t("settings.defaultFirstByteLabel")}
                  value={form.defaultFirstByteTimeoutSeconds}
                  onChange={(value) => setForm((current) => ({ ...current, defaultFirstByteTimeoutSeconds: value }))}
                  defaultMs={settings.defaults.defaultFirstByteTimeoutMs}
                  limit={settings.limits.firstByte}
                />
                <TimeoutField
                  id="image-first-byte-timeout"
                  label={t("settings.imageFirstByteLabel")}
                  value={form.imageFirstByteTimeoutSeconds}
                  onChange={(value) => setForm((current) => ({ ...current, imageFirstByteTimeoutSeconds: value }))}
                  defaultMs={settings.defaults.imageFirstByteTimeoutMs}
                  limit={settings.limits.firstByte}
                />
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-2 border-b border-border/60">
              <CardTitle>{t("settings.responseIdleTitle")}</CardTitle>
              <CardDescription>{t("settings.responseIdleDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <TimeoutField
                  id="response-idle-timeout"
                  label={t("settings.responseIdleLabel")}
                  value={form.responseIdleTimeoutSeconds}
                  onChange={(value) => setForm((current) => ({ ...current, responseIdleTimeoutSeconds: value }))}
                  defaultMs={settings.defaults.responseIdleTimeoutMs}
                  limit={settings.limits.responseIdle}
                />
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-2 border-b border-border/60">
              <CardTitle>{t("settings.currentPolicyTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-5 md:grid-cols-3">
              {currentPolicy.map((item) => (
                <PolicyCard
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
