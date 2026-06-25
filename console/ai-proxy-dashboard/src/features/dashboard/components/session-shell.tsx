import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Skeleton } from "@/components/ui/skeleton"

/**
 * 风格五 · LRS Clear — clean teal session screens (login / loading / disabled / error).
 * A single white card with a branded header (logo + live status) and footer chrome.
 */
function ClearShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()

  return (
    <main className="lrs-clear flex min-h-screen items-center justify-center px-4 py-10 text-[#15282a]">
      <div className="flex w-full max-w-[440px] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_1px_3px_rgba(20,20,40,0.08)]">
        <div className="flex items-center justify-between border-b border-[#edf2f2] px-8 py-6">
          <div className="flex items-center gap-[11px]">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[#0f9aa6] text-sm font-extrabold text-white">
              L
            </div>
            <span className="text-base font-extrabold tracking-[0.03em]">LRS</span>
          </div>
          <div className="flex items-center gap-[7px] text-xs text-[#5a6e70]">
            <span className="lrs-pulse h-[7px] w-[7px] rounded-full bg-[#0f9aa6]" />
            {t("session.statusLabel")} ·{" "}
            <span className="font-mono">{t("session.versionLabel")}</span>
          </div>
        </div>

        <div className="px-8 py-9">{children}</div>

        <div className="flex items-center justify-between border-t border-[#edf2f2] px-8 py-4 text-[11.5px] text-[#9bb0b0]">
          <span>{t("session.footerNote")}</span>
          <span className="font-mono">{t("session.footerLicense")}</span>
        </div>
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
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { t } = useTranslation()

  return (
    <ClearShell>
      <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#0f9aa6]">
        {t("session.eyebrow")}
      </div>
      <h1 className="mb-2 mt-2.5 text-[30px] font-extrabold tracking-[-0.01em]">
        {t("session.loginTitle")}
      </h1>
      <p className="mb-8 text-[13.5px] leading-[1.6] text-[#8aa0a1]">
        {t("session.loginDescription")}
      </p>

      <form
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
        {error ? (
          <div className="mb-4 rounded-[12px] border border-[#f3c8c2] bg-[#fdf3f1] px-3.5 py-2.5 text-[12.5px] text-[#c5402f]">
            <span className="font-semibold">{t("session.loginFailed")}</span> · {error}
          </div>
        ) : null}

        <label
          htmlFor="password"
          className="mb-[9px] block text-[12.5px] font-semibold text-[#5a6e70]"
        >
          {t("session.passwordLabel")}
        </label>
        <div className="flex h-[50px] items-center gap-2.5 rounded-[12px] border border-[#dde7e7] bg-[#fbfdfd] px-3.5 transition-colors focus-within:border-[#0f9aa6]">
          <span className="text-[15px] text-[#b6c6c6]">🔑</span>
          <input
            id="password"
            type={reveal ? "text" : "password"}
            placeholder={t("session.passwordPlaceholder")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="flex-1 border-none bg-transparent font-mono text-[15px] tracking-[0.06em] text-[#15282a] outline-none placeholder:tracking-normal placeholder:text-[#b6c6c6]"
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            className="cursor-pointer bg-transparent text-xs text-[#8aa0a1] hover:text-[#5a6e70]"
          >
            {reveal ? t("session.hideLabel") : t("session.showLabel")}
          </button>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-[26px] h-[50px] w-full cursor-pointer rounded-[12px] border-none bg-[#0f9aa6] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(15,154,166,0.25)] transition-[opacity,filter] hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t("session.submitting") : `${t("session.submitButton")} →`}
        </button>

        <div className="mt-6 flex items-start gap-2.5 border-t border-[#edf2f2] pt-5">
          <span className="text-sm leading-[1.4] text-[#b6c6c6]">ⓘ</span>
          <p className="m-0 text-[11.5px] leading-[1.65] text-[#9bb0b0]">
            <span className="font-mono text-[#5a6e70]">GATEWAY_API_KEY</span>{" "}
            {t("session.keyNote")}
          </p>
        </div>
      </form>
    </ClearShell>
  )
}

export function DisabledView() {
  const { t } = useTranslation()
  return (
    <ClearShell>
      <h1 className="mb-2 text-[26px] font-extrabold tracking-[-0.01em]">
        {t("session.disabledTitle")}
      </h1>
      <p className="text-[13.5px] leading-[1.65] text-[#8aa0a1]">
        {t("session.disabledDescription")}
      </p>
    </ClearShell>
  )
}

export function LoadingView() {
  const { t } = useTranslation()
  return (
    <ClearShell>
      <h1 className="mb-2 text-[26px] font-extrabold tracking-[-0.01em]">
        {t("session.loadingTitle")}
      </h1>
      <p className="mb-6 text-[13.5px] leading-[1.65] text-[#8aa0a1]">
        {t("session.loadingDescription")}
      </p>
      <div className="space-y-3">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </ClearShell>
  )
}

export function SessionErrorView({ description }: { description: string }) {
  const { t } = useTranslation()
  return (
    <ClearShell>
      <h1 className="mb-2 text-[26px] font-extrabold tracking-[-0.01em]">
        {t("session.errorTitle")}
      </h1>
      <p className="mb-4 text-[13.5px] leading-[1.65] text-[#8aa0a1]">{description}</p>
      <div className="rounded-[12px] border border-[#f3c8c2] bg-[#fdf3f1] px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-[#c5402f]">
        {t("session.errorHint")}
      </div>
    </ClearShell>
  )
}
