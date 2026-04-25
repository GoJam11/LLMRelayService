import { useState } from "react"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
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
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center">
        <Card className="w-full">
          <CardHeader className="gap-3 border-b border-border/60">
            <Badge variant="outline" className="w-fit">
              AI Gateway Observatory
            </Badge>
            <CardTitle className="text-3xl tracking-tight">{title}</CardTitle>
            <CardDescription className="text-sm leading-6">
              {description}
            </CardDescription>
          </CardHeader>
          {children ? <CardContent className="pt-6">{children}</CardContent> : null}
        </Card>
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
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { t } = useTranslation()

  return (
    <CenteredShell
      title={t("session.loginTitle")}
      description={t("session.loginDescription")}
    >
      <form
        className="space-y-4"
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
          <Alert variant="destructive">
            <AlertTitle>{t("session.loginFailed")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">{t("session.passwordLabel")}</FieldLabel>
            <FieldContent>
              <Input
                id="password"
                type="password"
                placeholder={t("session.passwordPlaceholder")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <FieldDescription>
                {t("session.passwordHint")}
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? t("session.submitting") : t("session.submitButton")}
          </Button>
        </div>
      </form>
    </CenteredShell>
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
        <AlertDescription>
          {t("session.errorHint")}
        </AlertDescription>
      </Alert>
    </CenteredShell>
  )
}
