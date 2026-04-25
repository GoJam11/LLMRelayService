---
name: ai-proxy-dashboard-design-guide
description: >
  UI design guide for the ai-proxy-dashboard (console/ai-proxy-dashboard) frontend.
  Use this skill whenever making UI changes to the dashboard to ensure visual consistency
  across pages. Covers button styles, action patterns, table layouts, and shadcn/ui conventions.
---

# AI Proxy Dashboard Design Guide

This guide governs UI decisions in `console/ai-proxy-dashboard/`. Always apply these patterns
when adding or modifying components.

---

## Button Conventions

### Primary Page-Level Actions (CardHeader right side)
Use `size="sm"` with default (primary) variant. Include icon + text.

```tsx
<Button type="button" size="sm" onClick={openCreate}>
  <Plus />
  新建别名
</Button>
```

### Secondary Page-Level Actions (alongside primary, e.g. Refresh, Test All)
Use `size="sm" variant="outline"`. Include icon + text.

```tsx
<Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
  <RefreshCw className={loading ? "animate-spin" : ""} />
  刷新
</Button>
```

### Inline Row Actions (inside table cells, next to items in a list)
Use `size="xs"`. **Always include both icon AND text label — never icon-only.**

| Action type | Variant | Example |
|---|---|---|
| Edit/primary inline | `variant="outline"` | `<Button size="xs" variant="outline"><Pencil data-icon="inline-start" />编辑</Button>` |
| Delete/destructive inline | `variant="ghost" className="text-destructive hover:text-destructive"` | `<Button size="xs" variant="ghost" className="text-destructive ..."><Trash2 data-icon="inline-start" />删除</Button>` |
| Test/connectivity inline | `variant="outline"` | `<Button size="xs" variant="outline"><Wifi data-icon="inline-start" />测试</Button>` |
| Neutral/secondary inline | `variant="ghost"` | `<Button size="xs" variant="ghost"><RefreshCw data-icon="inline-start" />刷新</Button>` |

### Icon Placement
Use `data-icon="inline-start"` on Lucide icons inside buttons (not `className="h-3.5 w-3.5"`):

```tsx
// Correct
<Wifi data-icon="inline-start" />

// Wrong
<Wifi className="h-3.5 w-3.5" />
```

### Forbidden Patterns
- **No icon-only buttons** in table rows or card sections. `size="icon"` is only acceptable in pagination UI components.
- No bare `<button>` elements for actions (use `<Button>` from shadcn/ui), except for toggle/reveal inline controls (e.g. show/hide password).

---

## Test Button States

The test button in table rows follows a 3-state pattern:

```tsx
{(() => {
  const result = testResults.get(item.id)
  if (result === "loading") {
    return (
      <Button type="button" variant="outline" size="xs" disabled>
        <Loader2 data-icon="inline-start" className="animate-spin" />
        测试中
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
              className={result.status === "ok"
                ? "text-green-600 border-green-500/50 hover:text-green-700"
                : "text-destructive border-destructive/50 hover:text-destructive"}
              onClick={() => handleTest(item)}
            >
              {result.status === "ok" ? <CheckCircle data-icon="inline-start" /> : <XCircle data-icon="inline-start" />}
              测试
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">{result.message}</p>
            {result.latencyMs != null && <p className="text-xs text-muted-foreground">{result.latencyMs}ms</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return (
    <Button type="button" variant="outline" size="xs" onClick={() => handleTest(item)}>
      <Wifi data-icon="inline-start" />
      测试
    </Button>
  )
})()}
```

---

## Page Layout

### Page Header (outside any Card)
Every page uses the `<PageHeader>` component (`@/components/ui/page-header`) as a standalone header row above all cards.

```tsx
import { PageHeader } from "@/components/ui/page-header"

<PageHeader
  icon={PageIcon}       // Lucide icon component
  title="Page Title"    // string or ReactNode
  description={t("page.description")}  // optional string or ReactNode
  actions={
    <>
      <Button size="sm" variant="outline">刷新</Button>
      <Button size="sm">新建</Button>
    </>
  }
/>
```

**Do NOT hand-write the header layout inline.** Always use `<PageHeader>`.

Icon assignments per page:
| Page | Icon |
|---|---|
| Dashboard | `Activity` |
| Usage | `BarChart3` |
| Logs | `ScrollText` |
| Providers | `Server` |
| Routes | `GitFork` |
| Keys | `KeyRound` |
| Models | `BookOpen` |

### Filter Panel (for pages with filters)
If a page has filter controls, place them in a separate Card below the header.
**Do NOT add inner styled containers** (e.g. `rounded-xl border bg-secondary/10`) inside the Card — the Card itself is the container.

```tsx
<Card>
  <CardContent className="pt-6">
    <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
      <ListFilter className="h-4 w-4 text-muted-foreground" />
      筛选
    </div>
    <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* Combobox fields */}
    </FieldGroup>
  </CardContent>
</Card>
```

### Sub-Card Headers (inside content cards)
Use standard `<CardHeader>` / `<CardTitle>` / `<CardDescription>` for section cards below the page header.

### Table action column
- Always right-aligned: `<TableCell className="text-right">`
- Actions grouped: `<div className="flex justify-end gap-1">`
- Order: Test → Edit → Delete

---

## Table Design
- Header: `<TableHeader>` with `uppercase tracking-wider text-xs text-muted-foreground` class pattern
- Disabled/inactive rows: wrap `<TableRow>` with `className={!item.enabled ? "opacity-50" : ""}`
- **Cell font size**: all cells in the same table should use the same font size (`text-xs`, 12px) for consistency. Do not mix `text-sm` and `text-xs` within one table.
- Mono content (IDs, model names, aliases): `className="font-mono text-xs"` or `className="font-mono text-xs font-medium"`
- Secondary data: `className="text-xs text-muted-foreground"`

---

## Typography & Labels
- Use Chinese labels for UI elements (`编辑`, `删除`, `测试`, `刷新`, `新建`)
- English only for technical identifiers rendered from data (model names, channel names, etc.)
- Consistent labeling across same-purpose buttons across all pages

---

## Card/Container conventions
- **Border radius**: The design system uses `--radius: 0` — all components render with sharp/square corners. Do not add `rounded-lg`, `rounded-md`, or any non-zero border radius to containers, cards, or wrappers.
- Main content blocks: `<Card>` with `<CardHeader>` / `<CardContent>`
- Dialogs: `sm:max-w-<size>` (not bare `max-w-<size>`) to override shadcn default `sm:max-w-sm`
- Tooltip: use `@/components/ui/tooltip`, never native HTML `title` attribute

---

## Form Dialogs
- Field layout: use `<Field>`, `<FieldLabel>`, `<FieldGroup>` from `@/components/ui/field`
- Section separator: `<FieldSeparator>` for logical grouping
- Auth/credential fields: no description text under the label; use `placeholder` instead

---

## Adding New Components
Run `bunx shadcn@latest add <component>` to install new shadcn/ui components.
Import from `@/components/ui/<name>`.
