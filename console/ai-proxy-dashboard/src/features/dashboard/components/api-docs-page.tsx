import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Copy, Check } from "lucide-react"

interface Endpoint {
  method: string
  path: string
  description: string
  auth: boolean
}

const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/v1/health", description: "健康检查", auth: false },
  { method: "GET", path: "/api/v1/providers", description: "获取所有渠道", auth: true },
  { method: "GET", path: "/api/v1/providers/:channelName", description: "获取单个渠道详情", auth: true },
  { method: "POST", path: "/api/v1/providers", description: "创建渠道", auth: true },
  { method: "PATCH", path: "/api/v1/providers/:channelName", description: "更新渠道", auth: true },
  { method: "DELETE", path: "/api/v1/providers/:channelName", description: "删除渠道", auth: true },
  { method: "PATCH", path: "/api/v1/providers/:channelName/enabled", description: "启用/禁用渠道", auth: true },
  { method: "GET", path: "/api/v1/requests", description: "获取请求日志列表", auth: true },
  { method: "GET", path: "/api/v1/requests/:requestId", description: "获取单个请求详情", auth: true },
  { method: "GET", path: "/api/v1/stats", description: "获取统计数据", auth: true },
  { method: "GET", path: "/api/v1/keys", description: "获取所有 API Keys", auth: true },
  { method: "GET", path: "/api/v1/keys/:id", description: "获取单个 API Key", auth: true },
  { method: "POST", path: "/api/v1/keys", description: "创建 API Key", auth: true },
  { method: "PATCH", path: "/api/v1/keys/:id", description: "重命名 API Key", auth: true },
  { method: "DELETE", path: "/api/v1/keys/:id", description: "删除 API Key", auth: true },
  { method: "PATCH", path: "/api/v1/keys/:id/allowed-models", description: "设置 API Key 允许模型", auth: true },
  { method: "GET", path: "/api/v1/aliases", description: "获取所有模型别名", auth: true },
  { method: "POST", path: "/api/v1/aliases", description: "创建模型别名", auth: true },
  { method: "PATCH", path: "/api/v1/aliases/:id", description: "更新模型别名", auth: true },
  { method: "PATCH", path: "/api/v1/aliases/:id/enabled", description: "启用/禁用模型别名", auth: true },
  { method: "DELETE", path: "/api/v1/aliases/:id", description: "删除模型别名", auth: true },
]

const BASE_URL = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : ""

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-blue-500/10 text-blue-500 hover:bg-blue-500/10",
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

export function ApiDocsPage() {
  const [filter, setFilter] = useState("")

  const filtered = ENDPOINTS.filter(
    (ep) =>
      ep.path.toLowerCase().includes(filter.toLowerCase()) ||
      ep.description.toLowerCase().includes(filter.toLowerCase()) ||
      ep.method.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>OpenAPI 文档</CardTitle>
          <CardDescription>
            使用 Bearer Token 认证，Token 与 GATEWAY_API_KEY 相同
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
            placeholder="搜索端点..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>端点列表</CardTitle>
          <CardDescription>
            共 {filtered.length} 个端点
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {filtered.map((ep) => (
              <div
                key={ep.path + ep.method}
                className="flex items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <MethodBadge method={ep.method} />
                <code className="flex-1 text-sm font-mono">{ep.path}</code>
                <span className="text-sm text-muted-foreground">{ep.description}</span>
                {ep.auth && <Badge variant="outline" className="text-xs">需认证</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
