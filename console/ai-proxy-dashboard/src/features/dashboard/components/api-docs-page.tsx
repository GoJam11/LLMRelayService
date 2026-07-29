import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react"

interface Endpoint {
  method: string
  path: string
  description: string
  auth: boolean
  body?: BodyExample
}

interface BodyExample {
  description: string
  json: unknown
}

function getBodyExamples(t: TFunction) {
  const PROVIDER_BODY: BodyExample = {
    description: t("apiDocs.body.providerBody"),
    json: {
      channelName: "my-openai",
      type: "openai",
      targetBaseUrl: "https://api.openai.com/v1",
      systemPrompt: null,
      models: ["gpt-4o", "gpt-4o-mini"],
      priority: 100,
      auth: {
        header: "authorization",
        value: "sk-xxxx"
      },
      responsesMode: "native",
      extraFields: null
    }
  }

  const PROVIDER_ENABLED_BODY: BodyExample = {
    description: t("apiDocs.body.providerEnabledBody"),
    json: {
      enabled: true
    }
  }

  const KEY_NAME_BODY: BodyExample = {
    description: t("apiDocs.body.keyNameBody"),
    json: {
      name: "my-key"
    }
  }

  const KEY_MODELS_BODY: BodyExample = {
    description: t("apiDocs.body.keyModelsBody"),
    json: {
      models: ["gpt-4o", "gpt-4o-mini"]
    }
  }

  const ALIAS_BODY: BodyExample = {
    description: t("apiDocs.body.aliasBody"),
    json: {
      alias: "gpt-4o",
      provider: "my-openai",
      model: "gpt-4o-2024-08-06",
      description: t("apiDocs.body.aliasDescriptionExample"),
      enabled: true
    }
  }

  const ALIAS_ENABLED_BODY: BodyExample = {
    description: t("apiDocs.body.aliasEnabledBody"),
    json: {
      enabled: true
    }
  }

  const MODEL_METADATA_BODY: BodyExample = {
    description: t("apiDocs.body.modelMetadataBody"),
    json: {
      context: 128000,
      pricing: {
        input: 1.25,
        output: 2.5,
        cache_read: 0.125,
        cache_write: 1.5
      }
    }
  }

  return {
    PROVIDER_BODY,
    PROVIDER_ENABLED_BODY,
    KEY_NAME_BODY,
    KEY_MODELS_BODY,
    ALIAS_BODY,
    ALIAS_ENABLED_BODY,
    MODEL_METADATA_BODY,
  }
}

function getEndpoints(t: TFunction): Endpoint[] {
  const {
    PROVIDER_BODY,
    PROVIDER_ENABLED_BODY,
    KEY_NAME_BODY,
    KEY_MODELS_BODY,
    ALIAS_BODY,
    ALIAS_ENABLED_BODY,
    MODEL_METADATA_BODY,
  } = getBodyExamples(t)

  return [
    { method: "GET", path: "/api/v1/health", description: t("apiDocs.ep.health"), auth: false },
    { method: "GET", path: "/api/v1/providers", description: t("apiDocs.ep.providersList"), auth: true },
    { method: "GET", path: "/api/v1/providers/:channelName", description: t("apiDocs.ep.providerGet"), auth: true },
    { method: "POST", path: "/api/v1/providers", description: t("apiDocs.ep.providerCreate"), auth: true, body: PROVIDER_BODY },
    { method: "PATCH", path: "/api/v1/providers/:channelName", description: t("apiDocs.ep.providerUpdate"), auth: true, body: PROVIDER_BODY },
    { method: "DELETE", path: "/api/v1/providers/:channelName", description: t("apiDocs.ep.providerDelete"), auth: true },
    { method: "PATCH", path: "/api/v1/providers/:channelName/enabled", description: t("apiDocs.ep.providerEnabled"), auth: true, body: PROVIDER_ENABLED_BODY },
    { method: "GET", path: "/api/v1/requests", description: t("apiDocs.ep.requestsList"), auth: true },
    { method: "GET", path: "/api/v1/requests/:requestId", description: t("apiDocs.ep.requestGet"), auth: true },
    { method: "GET", path: "/api/v1/stats", description: t("apiDocs.ep.statsGet"), auth: true },
    { method: "GET", path: "/api/v1/keys", description: t("apiDocs.ep.keysList"), auth: true },
    { method: "GET", path: "/api/v1/keys/:id", description: t("apiDocs.ep.keyGet"), auth: true },
    { method: "POST", path: "/api/v1/keys", description: t("apiDocs.ep.keyCreate"), auth: true, body: KEY_NAME_BODY },
    { method: "PATCH", path: "/api/v1/keys/:id", description: t("apiDocs.ep.keyRename"), auth: true, body: KEY_NAME_BODY },
    { method: "DELETE", path: "/api/v1/keys/:id", description: t("apiDocs.ep.keyDelete"), auth: true },
    { method: "PATCH", path: "/api/v1/keys/:id/allowed-models", description: t("apiDocs.ep.keyAllowedModels"), auth: true, body: KEY_MODELS_BODY },
    { method: "PATCH", path: "/__console/api/models/:channelName/:modelId/metadata", description: t("apiDocs.ep.modelMetadata"), auth: true, body: MODEL_METADATA_BODY },
    { method: "GET", path: "/api/v1/aliases", description: t("apiDocs.ep.aliasesList"), auth: true },
    { method: "POST", path: "/api/v1/aliases", description: t("apiDocs.ep.aliasCreate"), auth: true, body: ALIAS_BODY },
    { method: "PATCH", path: "/api/v1/aliases/:id", description: t("apiDocs.ep.aliasUpdate"), auth: true, body: ALIAS_BODY },
    { method: "PATCH", path: "/api/v1/aliases/:id/enabled", description: t("apiDocs.ep.aliasEnabled"), auth: true, body: ALIAS_ENABLED_BODY },
    { method: "DELETE", path: "/api/v1/aliases/:id", description: t("apiDocs.ep.aliasDelete"), auth: true },
  ]
}

const BASE_URL = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : ""

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-[#0f9aa6]/10 text-[#0f9aa6] hover:bg-[#0f9aa6]/10",
    POST: "bg-green-500/10 text-green-500 hover:bg-green-500/10",
    PATCH: "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/10",
    DELETE: "bg-red-500/10 text-red-500 hover:bg-red-500/10",
  }
  return <Badge className={`${colors[method] ?? "bg-gray-500/10 text-gray-500"} font-mono text-xs`}>{method}</Badge>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
}

function EndpointItem({ ep }: { ep: Endpoint }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border">
      <div
        className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer select-none"
        onClick={() => ep.body && setExpanded((v) => !v)}
      >
        <MethodBadge method={ep.method} />
        <code className="flex-1 text-sm font-mono">{ep.path}</code>
        <span className="text-sm text-muted-foreground">{ep.description}</span>
        {ep.auth && <Badge variant="outline" className="text-xs">{t("apiDocs.authRequired")}</Badge>}
        {ep.body && (
          expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {expanded && ep.body && (
        <div className="border-t px-3 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{ep.body.description} - Request Body</span>
            <CopyButton text={JSON.stringify(ep.body.json, null, 2)} />
          </div>
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
            <code>{JSON.stringify(ep.body.json, null, 2)}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

export function ApiDocsPage() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState("")

  const endpoints = useMemo(() => getEndpoints(t), [t])

  const filtered = endpoints.filter(
    (ep) =>
      ep.path.toLowerCase().includes(filter.toLowerCase()) ||
      ep.description.toLowerCase().includes(filter.toLowerCase()) ||
      ep.method.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("apiDocs.pageTitle")}</CardTitle>
          <CardDescription>
            {t("apiDocs.authDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted p-3">
            <div className="flex items-center justify-between">
              <code className="text-sm font-mono">Authorization: Bearer &lt;GATEWAY_API_KEY&gt;</code>
              <CopyButton text={`Authorization: Bearer <YOUR_GATEWAY_API_KEY>`} />
            </div>
          </div>

          <div className="rounded-md bg-muted p-3">
            <div className="text-sm font-mono text-muted-foreground">Base URL</div>
            <div className="flex items-center justify-between">
              <code className="text-sm font-mono">{BASE_URL}</code>
              <CopyButton text={BASE_URL} />
            </div>
          </div>

          <Input
            placeholder={t("apiDocs.searchPlaceholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("apiDocs.endpointListTitle")}</CardTitle>
          <CardDescription>
            {t("apiDocs.endpointCount", { count: filtered.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {filtered.map((ep) => (
              <EndpointItem key={ep.path + ep.method} ep={ep} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
