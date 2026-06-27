import { useEffect, useState } from "react"
import { Clock, Loader2, RefreshCw, Save } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchGatewayTimeoutSettings, updateGatewayTimeoutSettings } from "@/features/dashboard/api"
import type { GatewayTimeoutSettingsPayload, TimeoutLimit } from "@/features/dashboard/types"

type TimeoutFormState = {
  defaultFirstByteTimeoutSeconds: string
  streamFirstByteTimeoutSeconds: string
  imageFirstByteTimeoutSeconds: string
  responseIdleTimeoutSeconds: string
}

function secondsText(ms: number): string {
  const seconds = ms / 1000
  return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(3)))
}

function toForm(settings: GatewayTimeoutSettingsPayload): TimeoutFormState {
  return {
    defaultFirstByteTimeoutSeconds: secondsText(settings.defaultFirstByteTimeoutMs),
    streamFirstByteTimeoutSeconds: secondsText(settings.streamFirstByteTimeoutMs),
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
  if (!trimmed) throw new Error(t("settings.validationRequired", { label }))
  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds)) throw new Error(t("settings.validationNumber", { label }))
  const ms = Math.round(seconds * 1000)
  if (ms < limit.minMs || ms > limit.maxMs) {
    throw new Error(
      t("settings.validationRange", {
        label,
        min: secondsText(limit.minMs),
        max: secondsText(limit.maxMs),
      }),
    )
  }
  return ms
}

function SettingRow({
  label,
  desc,
  value,
  onChange,
  limit,
}: {
  label: string
  desc: string
  value: string
  onChange: (value: string) => void
  limit: TimeoutLimit
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-foreground">{label}</div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{desc}</div>
      </div>
      <div className="relative w-[132px] shrink-0">
        <Input
          type="number"
          min={secondsText(limit.minMs)}
          max={secondsText(limit.maxMs)}
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pr-9 font-mono tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {t("settings.secondsSuffix")}
        </span>
      </div>
    </div>
  )
}

export function SettingsPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<GatewayTimeoutSettingsPayload | null>(null)
  const [form, setForm] = useState<TimeoutFormState>({
    defaultFirstByteTimeoutSeconds: "300",
    streamFirstByteTimeoutSeconds: "300",
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

  const restoreDefaults = () => {
    if (!settings) return
    setForm({
      defaultFirstByteTimeoutSeconds: secondsText(settings.defaults.defaultFirstByteTimeoutMs),
      streamFirstByteTimeoutSeconds: secondsText(settings.defaults.streamFirstByteTimeoutMs),
      imageFirstByteTimeoutSeconds: secondsText(settings.defaults.imageFirstByteTimeoutMs),
      responseIdleTimeoutSeconds: secondsText(settings.defaults.responseIdleTimeoutMs),
    })
  }

  const handleSave = async () => {
    if (!settings) return
    try {
      setSaving(true)
      const payload = {
        defaultFirstByteTimeoutMs: parseSeconds(form.defaultFirstByteTimeoutSeconds, t("settings.defaultFirstByteLabel"), settings.limits.firstByte, t),
        streamFirstByteTimeoutMs: parseSeconds(form.streamFirstByteTimeoutSeconds, t("settings.streamFirstByteLabel"), settings.limits.firstByte, t),
        imageFirstByteTimeoutMs: parseSeconds(form.imageFirstByteTimeoutSeconds, t("settings.imageFirstByteLabel"), settings.limits.firstByte, t),
        responseIdleTimeoutMs: parseSeconds(form.responseIdleTimeoutSeconds, t("settings.responseIdleLabel"), settings.limits.responseIdle, t),
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

  const fieldDesc = (defaultMs: number, limit: TimeoutLimit) =>
    `${t("settings.defaultValue", { value: secondsText(defaultMs) })} · ${t("settings.rangeHint", { min: secondsText(limit.minMs), max: secondsText(limit.maxMs) })}`

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar — actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadSettings()}>
          <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : ""} />
          {t("common.refresh")}
        </Button>
        <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void handleSave()}>
          {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>

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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          {/* Section nav */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-[color:var(--accent-foreground)]/20 bg-accent px-3.5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Clock className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[13.5px] font-bold text-accent-foreground">{t("settings.navUpstream")}</div>
                <div className="text-[11px] text-muted-foreground">{t("settings.itemCount", { count: 4 })}</div>
              </div>
            </div>
            <div className="mt-auto rounded-xl border border-border bg-muted/40 p-4">
              <div className="text-[11.5px] font-bold text-foreground">{t("settings.applyTitle")}</div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">{t("settings.applyNote")}</p>
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-col">
            <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-primary">
              {t("settings.firstByteTitle")}
            </div>
            <div className="mt-4 grid gap-3.5 md:grid-cols-2">
              <SettingRow
                label={t("settings.defaultFirstByteLabel")}
                desc={fieldDesc(settings.defaults.defaultFirstByteTimeoutMs, settings.limits.firstByte)}
                value={form.defaultFirstByteTimeoutSeconds}
                onChange={(value) => setForm((c) => ({ ...c, defaultFirstByteTimeoutSeconds: value }))}
                limit={settings.limits.firstByte}
              />
              <SettingRow
                label={t("settings.streamFirstByteLabel")}
                desc={fieldDesc(settings.defaults.streamFirstByteTimeoutMs, settings.limits.firstByte)}
                value={form.streamFirstByteTimeoutSeconds}
                onChange={(value) => setForm((c) => ({ ...c, streamFirstByteTimeoutSeconds: value }))}
                limit={settings.limits.firstByte}
              />
              <SettingRow
                label={t("settings.imageFirstByteLabel")}
                desc={fieldDesc(settings.defaults.imageFirstByteTimeoutMs, settings.limits.firstByte)}
                value={form.imageFirstByteTimeoutSeconds}
                onChange={(value) => setForm((c) => ({ ...c, imageFirstByteTimeoutSeconds: value }))}
                limit={settings.limits.firstByte}
              />
              <SettingRow
                label={t("settings.responseIdleLabel")}
                desc={fieldDesc(settings.defaults.responseIdleTimeoutMs, settings.limits.responseIdle)}
                value={form.responseIdleTimeoutSeconds}
                onChange={(value) => setForm((c) => ({ ...c, responseIdleTimeoutSeconds: value }))}
                limit={settings.limits.responseIdle}
              />
            </div>

            <div className="mt-6 flex items-center gap-3 border-t border-border pt-5">
              <span className="text-[11.5px] text-muted-foreground">{t("settings.applyNote")}</span>
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={restoreDefaults}>
                {t("settings.restoreDefaults")}
              </Button>
              <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void handleSave()}>
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
