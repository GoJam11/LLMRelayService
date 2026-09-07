import { useState } from "react"
import {
  Check,
  CheckCircle,
  Copy,
  LayoutGrid,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react"

import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  TestStatusButton,
  TableRowActions,
  StatusBadge,
  FilterCard,
  ConfirmDialog,
  DateRangePicker,
  type TestResultData,
} from "@/components/patterns"
import type { DateRangeValue } from "@/features/dashboard/types"

export function DesignShowcasePage() {
  // Interactive test button demo state
  const [interactiveResult, setInteractiveResult] = useState<TestResultData | "loading" | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [demoDateRange, setDemoDateRange] = useState<DateRangeValue>({ preset: "24h" })

  const simulateTest = (mode: "ok" | "error") => {
    setInteractiveResult("loading")
    setTimeout(() => {
      if (mode === "ok") {
        setInteractiveResult({
          status: "ok",
          message: "API 握手成功，服务响应正常",
          latencyMs: 142,
          statusCode: 200,
        })
      } else {
        setInteractiveResult({
          status: "error",
          message: "HTTP 502 Bad Gateway: Upstream provider timed out",
          latencyMs: 2450,
          statusCode: 502,
        })
      }
    }, 900)
  }

  const handleDeleteConfirm = async () => {
    setDeleteLoading(true)
    await new Promise((r) => setTimeout(r, 800))
    setDeleteLoading(false)
    setDeleteDialogOpen(false)
  }

  const handleCopyHash = () => {
    navigator.clipboard.writeText(window.location.origin + window.location.pathname + "#/design")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Standalone Page Header */}
      <PageHeader
        icon={Palette}
        title="设计系统与组件模式规范"
        description="Console 控制台全站视觉与交互基准展厅。封装业务复合组件，消除不同页面样式与交互差异。"
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopyHash}
            >
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "已复制页面链接" : "分享规范链接"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setInteractiveResult(null)}
            >
              <RefreshCw data-icon="inline-start" />
              重置演示状态
            </Button>
          </>
        }
      />

      <Tabs defaultValue="patterns" className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="patterns" className="text-xs">
            核心复合组件 (L2 Patterns)
          </TabsTrigger>
          <TabsTrigger value="buttons" className="text-xs">
            按钮交互准则 (Buttons)
          </TabsTrigger>
          <TabsTrigger value="tables" className="text-xs">
            数据表格与操作列 (Tables)
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs">
            状态徽章与反馈 (Status Badges)
          </TabsTrigger>
          <TabsTrigger value="filters" className="text-xs">
            筛选器与弹窗 (Filters & Dialogs)
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: 核心复合组件 */}
        <TabsContent value="patterns" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Pattern: TestStatusButton */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" />
                  TestStatusButton (统一 3 态测试按钮)
                </CardTitle>
                <CardDescription>
                  收敛全站测试通道/别名/模型的按钮逻辑。内置 loading 态、成功绿标 + 耗时浮层、失败红标 + 错误信息浮层。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded border border-border/50 bg-muted/20 p-4">
                  <div>
                    <span className="text-[11px] text-muted-foreground block mb-1">空闲态 (Idle)</span>
                    <TestStatusButton onTest={() => simulateTest("ok")} />
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block mb-1">执行中 (Loading)</span>
                    <TestStatusButton result="loading" onTest={() => {}} />
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block mb-1">成功态 (Hover 查看延迟)</span>
                    <TestStatusButton
                      result={{ status: "ok", latencyMs: 128, message: "连通性测试通过" }}
                      onTest={() => simulateTest("ok")}
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block mb-1">失败态 (Hover 查看原因)</span>
                    <TestStatusButton
                      result={{ status: "error", latencyMs: 3100, message: "连接超时: 408 Request Timeout" }}
                      onTest={() => simulateTest("error")}
                    />
                  </div>
                </div>

                {/* 交互演练区 */}
                <div className="border border-border/70 p-3 space-y-2 bg-card">
                  <div className="text-xs font-medium flex items-center justify-between">
                    <span>交互式体验沙盒：</span>
                    <div className="flex gap-2">
                      <Button size="xs" variant="outline" onClick={() => simulateTest("ok")}>
                        触发测试 (成功)
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => simulateTest("error")}>
                        触发测试 (失败)
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-xs text-muted-foreground">当前组件渲染：</span>
                    <TestStatusButton
                      result={interactiveResult}
                      onTest={() => simulateTest("ok")}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pattern: TableRowActions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                  TableRowActions (统一表格操作列)
                </CardTitle>
                <CardDescription>
                  强制统一表格右侧操作组的排列顺序（测试 → 编辑 → 业务动作 → 删除）、边距（gap-1）与对齐。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded border border-border/50 bg-muted/20 p-4 space-y-3">
                  <span className="text-[11px] text-muted-foreground block">标准单行操作按钮组合：</span>
                  <div className="flex justify-end p-2 bg-card border border-border">
                    <TableRowActions>
                      <TableRowActions.Test
                        result={{ status: "ok", latencyMs: 89 }}
                        onTest={() => {}}
                      />
                      <TableRowActions.Edit onClick={() => {}} />
                      <TableRowActions.Delete onClick={() => setDeleteDialogOpen(true)} />
                    </TableRowActions>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">使用规范：</p>
                  <p>• 必须包裹在 `TableCell className="text-right"` 内。</p>
                  <p>• 禁止在表格操作列使用纯图标按钮（无文字），必须图文并茂。</p>
                  <p>• 删除操作使用红色 ghost 风格，并在执行前拉起二次确认。</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: 按钮交互准则 */}
        <TabsContent value="buttons" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">按钮层级与规格矩阵</CardTitle>
              <CardDescription>
                所有按钮必须使用 shadcn/ui 的 Button 组件，内置 `--radius: 0` 保持干练利落风格。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* 页面级主次操作 */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    1. 页面级主操作区 (CardHeader 右侧或 PageHeader 右侧) — 统一使用 size="sm"
                  </h4>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm">
                      <Plus data-icon="inline-start" />
                      新建别名
                    </Button>
                    <Button size="sm" variant="outline">
                      <RefreshCw data-icon="inline-start" />
                      刷新列表
                    </Button>
                    <Button size="sm" variant="secondary">
                      导出配置
                    </Button>
                    <Button size="sm" variant="destructive">
                      批量删除
                    </Button>
                  </div>
                </div>

                {/* 行内操作 */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    2. 列表与表格行内操作 (Table Row Actions) — 统一使用 size="xs"
                  </h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs" variant="outline">
                      <Pencil data-icon="inline-start" />
                      编辑
                    </Button>
                    <Button size="xs" variant="outline">
                      <Wifi data-icon="inline-start" />
                      测试
                    </Button>
                    <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 data-icon="inline-start" />
                      删除
                    </Button>
                    <Button size="xs" variant="ghost">
                      <RefreshCw data-icon="inline-start" />
                      同步
                    </Button>
                  </div>
                </div>

                {/* 必须遵守与反模式 */}
                <div className="grid gap-4 sm:grid-cols-2 pt-2">
                  <div className="border border-green-500/30 bg-green-500/5 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-green-700 dark:text-green-400 mb-2">
                      <CheckCircle className="h-4 w-4" />
                      推荐做法 (Best Practices)
                    </div>
                    <ul className="text-xs space-y-1 text-muted-foreground list-disc list-inside">
                      <li>按钮图标统一加上 `data-icon="inline-start"`</li>
                      <li>表格内所有操作统一为 `size="xs"`</li>
                      <li>操作文字使用统一中英文命名（新建、编辑、删除、测试）</li>
                    </ul>
                  </div>

                  <div className="border border-destructive/30 bg-destructive/5 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-destructive mb-2">
                      <XCircle className="h-4 w-4" />
                      严格禁止的反模式 (Anti-Patterns)
                    </div>
                    <ul className="text-xs space-y-1 text-muted-foreground list-disc list-inside">
                      <li>禁止在表格中使用裸原生 `&lt;button&gt;` 标签</li>
                      <li>禁止在表格操作列使用只有图标无文字的 `size="icon"`</li>
                      <li>禁止使用 HTML 原生 `title` 属性替代 Tooltip</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: 表格与操作列 */}
        <TabsContent value="tables" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">标准数据表格设计示范</CardTitle>
              <CardDescription>
                全表单元格字体尺寸严格统一为 text-xs（12px）；标识符采用 monospace 等宽字体；右侧操作列右对齐。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="uppercase tracking-wider text-xs text-muted-foreground">渠道名称</TableHead>
                    <TableHead className="uppercase tracking-wider text-xs text-muted-foreground">基地址 / 别名</TableHead>
                    <TableHead className="uppercase tracking-wider text-xs text-muted-foreground">协议类型</TableHead>
                    <TableHead className="uppercase tracking-wider text-xs text-muted-foreground">运行状态</TableHead>
                    <TableHead className="uppercase tracking-wider text-xs text-muted-foreground">上下文限制</TableHead>
                    <TableHead className="text-right uppercase tracking-wider text-xs text-muted-foreground">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-xs">Anthropic Official</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">https://api.anthropic.com</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs">anthropic</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant="success" mode="dot" pulse>健康连通</StatusBadge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">200,000</TableCell>
                    <TableCell className="text-right">
                      <TableRowActions>
                        <TableRowActions.Test
                          result={{ status: "ok", latencyMs: 142 }}
                          onTest={() => simulateTest("ok")}
                        />
                        <TableRowActions.Edit onClick={() => {}} />
                        <TableRowActions.Delete onClick={() => setDeleteDialogOpen(true)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>

                  <TableRow>
                    <TableCell className="font-medium text-xs">OpenAI Tier 5</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">https://api.openai.com/v1</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs">openai</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant="warning" mode="dot">高延迟告警</StatusBadge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">128,000</TableCell>
                    <TableCell className="text-right">
                      <TableRowActions>
                        <TableRowActions.Test
                          result={{ status: "error", latencyMs: 2980, message: "Gateway Timeout" }}
                          onTest={() => simulateTest("error")}
                        />
                        <TableRowActions.Edit onClick={() => {}} />
                        <TableRowActions.Delete onClick={() => setDeleteDialogOpen(true)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>

                  <TableRow className="opacity-50">
                    <TableCell className="font-medium text-xs">DeepSeek Local (已停用)</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">http://127.0.0.1:11434</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs">openai</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant="muted" mode="dot">已禁用</StatusBadge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">64,000</TableCell>
                    <TableCell className="text-right">
                      <TableRowActions>
                        <TableRowActions.Test onTest={() => simulateTest("ok")} />
                        <TableRowActions.Edit onClick={() => {}} />
                        <TableRowActions.Delete onClick={() => setDeleteDialogOpen(true)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: 状态徽章 */}
        <TabsContent value="status" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dot 点状指示器 (StatusBadge mode="dot")</CardTitle>
                <CardDescription>用于表格、列表行内紧凑显示健康度、连通性或启停状态。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-4 items-center p-3 border border-border/60 bg-muted/20">
                  <StatusBadge variant="success" mode="dot" pulse>健康连通 (Success + Pulse)</StatusBadge>
                  <StatusBadge variant="warning" mode="dot">降级响应 (Warning)</StatusBadge>
                  <StatusBadge variant="destructive" mode="dot">服务异常 (Destructive)</StatusBadge>
                  <StatusBadge variant="muted" mode="dot">未启用 (Muted)</StatusBadge>
                  <StatusBadge variant="info" mode="dot">正在初始化 (Info)</StatusBadge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Badge 徽章模式 (StatusBadge mode="badge")</CardTitle>
                <CardDescription>用于详情面板、统计卡片或重点标示的模型状态。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-3 items-center p-3 border border-border/60 bg-muted/20">
                  <StatusBadge variant="success" pulse>ACTIVE</StatusBadge>
                  <StatusBadge variant="warning">DEGRADED</StatusBadge>
                  <StatusBadge variant="destructive">UNAVAILABLE</StatusBadge>
                  <StatusBadge variant="muted">DISABLED</StatusBadge>
                  <StatusBadge variant="info">DIRECT ONLY</StatusBadge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 5: 筛选卡片与通用弹窗 */}
        <TabsContent value="filters" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">FilterCard 标准筛选器容器</CardTitle>
              <CardDescription>
                统一各页面的筛选区域外壳。禁止在 Card 内部再套一层多余的 rounded-xl 背景框。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterCard
                title="数据筛选示范"
                onReset={() => {}}
                actions={<Badge variant="outline">3 条过滤规则生效</Badge>}
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">模型搜索</label>
                  <Input placeholder="输入模型名称或别名..." className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">所属渠道</label>
                  <Input placeholder="全部渠道" className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">协议模式</label>
                  <Input placeholder="全部协议" className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">状态筛选</label>
                  <Input placeholder="全部状态" className="h-8 text-xs" />
                </div>
              </FilterCard>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ConfirmDialog 二次确认标准弹窗</CardTitle>
              <CardDescription>
                规范全站危险操作的二次确认弹窗：固定 max-w-md 宽度、取消在左、破坏性动作在右，带 Loading 反馈。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 data-icon="inline-start" />
                打开删除确认弹窗
              </Button>

              <ConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="确认删除该渠道配置？"
                description="删除后将无法通过此渠道路由请求，且该操作不可撤销。所有绑定该渠道的别名将自动切换至备选渠道。"
                confirmText="确认删除"
                loading={deleteLoading}
                onConfirm={handleDeleteConfirm}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">DateRangePicker 日期时间范围选择器</CardTitle>
              <CardDescription>
                支持自然快捷预设（过去 1h、24h、72h、7d、30d、今天、昨天、本月）与自定义精确起止时间输入，遵循 `--radius: 0` 风格。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <DateRangePicker value={demoDateRange} onChange={setDemoDateRange} />
                <div className="text-xs font-mono bg-muted/30 border border-border px-3 py-1.5">
                  当前值: {JSON.stringify(demoDateRange)}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
