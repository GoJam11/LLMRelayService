import { useState } from "react"
import { ChevronRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface JsonViewerProps {
  data: unknown
  defaultExpanded?: boolean
  className?: string
}

export function JsonViewer({ data, defaultExpanded = false, className }: JsonViewerProps) {
  return (
    <div className={cn("font-mono text-xs", className)}>
      <JsonNode data={data} defaultExpanded={defaultExpanded} />
    </div>
  )
}

function JsonNode({ data, defaultExpanded = false, depth = 0 }: { data: unknown; defaultExpanded?: boolean; depth?: number }) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (data === null) {
    return <span className="text-muted-foreground">null</span>
  }

  if (data === undefined) {
    return <span className="text-muted-foreground">undefined</span>
  }

  if (typeof data === "boolean") {
    return <span className="text-blue-600 dark:text-blue-400">{String(data)}</span>
  }

  if (typeof data === "number") {
    return <span className="text-purple-600 dark:text-purple-400">{data}</span>
  }

  if (typeof data === "string") {
    return <span className="text-green-600 dark:text-green-400 break-all">"{data}"</span>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-muted-foreground">[]</span>
    }

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center hover:bg-accent rounded px-1 -ml-1"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span className="text-muted-foreground">[{data.length}]</span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-border/50 pl-2">
            {data.map((item, i) => (
              <div key={i} className="py-0.5">
                <span className="text-muted-foreground">{i}: </span>
                <JsonNode data={item} defaultExpanded={depth < 1} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (typeof data === "object") {
    const entries = Object.entries(data)
    if (entries.length === 0) {
      return <span className="text-muted-foreground">{"{}"}</span>
    }

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center hover:bg-accent rounded px-1 -ml-1"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span className="text-muted-foreground">{`{${entries.length}}`}</span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-border/50 pl-2">
            {entries.map(([key, value]) => (
              <div key={key} className="py-0.5">
                <span className="text-orange-600 dark:text-orange-400">"{key}"</span>
                <span className="text-muted-foreground">: </span>
                <JsonNode data={value} defaultExpanded={depth < 1} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return <span className="text-muted-foreground">{String(data)}</span>
}
