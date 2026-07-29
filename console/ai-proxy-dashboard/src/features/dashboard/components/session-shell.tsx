import { useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRound, RefreshCw, ScrollText, Clock, Info } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

function CenteredShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-xl overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_3px_rgba(20,20,40,0.08)]">
        <div className="border-b border-border px-8 py-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-base font-extrabold text-primary-foreground">
              L
            </span>
            <span className="text-[17px] font-extrabold tracking-[0.04em]">LRS</span>
          </div>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {children ? <div className="px-8 py-6">{children}</div> : null}
      </div>
    </main>
  )
}

export function LoginView({
  onLogin,
}: {
  onLogin: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { t } = useTranslation()

  const features = [
    {
      icon: RefreshCw,
      title: t("loginHero.feature1Title"),
      desc: t("loginHero.feature1Desc"),
    },
    {
      icon: ScrollText,
      title: t("loginHero.feature2Title"),
      desc: t("loginHero.feature2Desc"),
    },
    {
      icon: Clock,
      title: t("loginHero.feature3Title"),
      desc: t("loginHero.feature3Desc"),
    },
  ]

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      {/* Hero */}
      <div className="hidden w-[44%] max-w-[560px] flex-col bg-lrs-hero px-12 py-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-primary text-base font-extrabold text-white">
            L
          </div>
          <span className="text-lg font-extrabold tracking-[0.04em]">LRS</span>
        </div>
        <div className="mt-auto">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5fc6cf]">
            LLM Relay Service
          </div>
          <h1 className="mt-4 text-[42px] font-extrabold leading-[1.12] tracking-[-0.02em]">
            {t("loginHero.heroTitleLine1")}
            <br />
            {t("loginHero.heroTitleLine2")}
          </h1>
          <p className="mt-5 max-w-[400px] text-[15px] leading-[1.7] text-[#9fb6b8]">
            {t("loginHero.heroDesc")}
          </p>
          <div className="mt-9 flex flex-col gap-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-primary/20 text-[#5fc6cf]">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-0.5 text-xs text-[#8aa0a1]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-auto flex justify-between pt-10 text-xs text-[#6f8688]">
          <span>{t("loginHero.heroTagline")}</span>
          <span className="font-mono">v1.0 · MIT</span>
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-end border-b border-border px-10 py-6">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="lrs-pulse h-[7px] w-[7px] rounded-full bg-primary" />
            {t("loginHero.gatewayRunning")} · <span className="font-mono">v1.0</span>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-6 sm:px-10">
          <form
            className="w-full max-w-[400px]"
            onSubmit={async (event) => {
              event.preventDefault()
              setSubmitting(true)
              setError("")
              try {
                await onLogin(password)
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : String(nextError))
              } finally {
                setSubmitting(false)
              }
            }}
          >
            <h2 className="text-3xl font-extrabold tracking-[-0.01em]">{t("session.loginTitle")}</h2>
            <p className="mt-2 mb-8 text-[13.5px] leading-[1.6] text-muted-foreground">
              {t("session.loginDescription")}
            </p>

            {error ? (
              <Alert variant="destructive" className="mb-5">
                <AlertTitle>{t("session.loginFailed")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <label className="mb-2.5 block text-[12.5px] font-semibold text-muted-foreground">
              {t("session.passwordLabel")}
            </label>
            <div className="flex h-[52px] items-center gap-2.5 rounded-xl border border-input bg-muted/40 px-3.5">
              <KeyRound className="h-4 w-4 text-muted-foreground/70" />
              <input
                type={show ? "text" : "password"}
                placeholder={t("session.passwordPlaceholder")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="flex-1 border-none bg-transparent font-mono text-[15px] tracking-[0.12em] text-foreground outline-none placeholder:tracking-normal placeholder:text-muted-foreground/70"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="text-xs text-muted-foreground"
              >
                {show ? t("common.hide") : t("common.show")}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setRemember((r) => !r)}
              className="my-4 flex items-center gap-2.5"
            >
              <span
                className={
                  "flex h-[18px] w-[18px] items-center justify-center rounded-md text-[11px] font-extrabold text-white transition-colors " +
                  (remember ? "bg-primary" : "bg-muted-foreground/30")
                }
              >
                {remember ? "✓" : ""}
              </span>
              <span className="text-[12.5px] text-muted-foreground">{t("loginHero.rememberDevice")}</span>
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="h-[52px] w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(15,154,166,0.25)] transition-opacity hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? t("session.submitting") : t("session.submitButton") + " →"}
            </button>

            <div className="mt-6 flex items-start gap-2.5 border-t border-border pt-5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <p className="text-[11.5px] leading-[1.65] text-muted-foreground">
                {t("session.passwordHint")}
              </p>
            </div>
          </form>
        </div>
        <div className="flex justify-between border-t border-border px-10 py-4 text-[11.5px] text-muted-foreground">
          <span>{t("loginHero.singleAdmin")}</span>
          <span className="font-mono">MIT License</span>
        </div>
      </div>
    </main>
  )
}

export function DisabledView() {
  const { t } = useTranslation()
  return (
    <CenteredShell
      title={t("session.disabledTitle")}
      description={t("session.disabledDescription")}
    />
  )
}

export function LoadingView() {
  const { t } = useTranslation()
  return (
    <CenteredShell
      title={t("session.loadingTitle")}
      description={t("session.loadingDescription")}
    >
      <div className="space-y-3">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </CenteredShell>
  )
}

export function SessionErrorView({ description }: { description: string }) {
  const { t } = useTranslation()
  return (
    <CenteredShell title={t("session.errorTitle")} description={description}>
      <Alert variant="destructive">
        <AlertTitle>{t("common.connectionFailed")}</AlertTitle>
        <AlertDescription>{t("session.errorHint")}</AlertDescription>
      </Alert>
    </CenteredShell>
  )
}
