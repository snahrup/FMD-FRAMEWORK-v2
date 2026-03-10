import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Terminal, FileCode, Search, AlertTriangle, MessageSquare } from "lucide-react";

interface LogEntry {
  type: "tool_call" | "tool_result" | "text" | "error" | "edit";
  content: string;
  timestamp?: number;
  tool?: string;
  file?: string;
}

interface AgentSessionLogProps {
  log: string;
  className?: string;
}

type FilterType = "all" | "edits" | "errors" | "tools";

function parseLog(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];

  // Try to parse as JSON lines first
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "tool_use" || parsed.tool) {
        entries.push({
          type: "tool_call",
          content: `${parsed.tool || parsed.name}: ${JSON.stringify(parsed.input || parsed.params || {}).substring(0, 200)}`,
          tool: parsed.tool || parsed.name,
          file: parsed.input?.file_path || parsed.input?.path || parsed.params?.file_path,
          timestamp: parsed.timestamp,
        });
      } else if (parsed.type === "tool_result") {
        entries.push({
          type: "tool_result",
          content: (parsed.content || parsed.result || "").substring(0, 300),
          timestamp: parsed.timestamp,
        });
      } else if (parsed.type === "error" || parsed.error) {
        entries.push({
          type: "error",
          content: parsed.error || parsed.message || parsed.content || line,
          timestamp: parsed.timestamp,
        });
      } else if (parsed.type === "text" || parsed.content) {
        entries.push({
          type: "text",
          content: (parsed.content || parsed.text || "").substring(0, 500),
          timestamp: parsed.timestamp,
        });
      }
    } catch {
      // Plain text line
      if (line.match(/error|Error|ERROR|FAIL/i)) {
        entries.push({ type: "error", content: line });
      } else if (line.match(/Edit|Write|edit|write/)) {
        entries.push({ type: "edit", content: line });
      } else {
        entries.push({ type: "text", content: line });
      }
    }
  }

  return entries;
}

const FILTER_CONFIG = {
  all: { label: "All", icon: Terminal },
  edits: { label: "Edits", icon: FileCode },
  errors: { label: "Errors", icon: AlertTriangle },
  tools: { label: "Tools", icon: Search },
};

export default function AgentSessionLog({ log, className }: AgentSessionLogProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const entries = useMemo(() => parseLog(log), [log]);

  const filtered = useMemo(() => {
    let result = entries;
    if (filter === "edits") result = result.filter(e => e.type === "edit" || e.tool === "Edit" || e.tool === "Write");
    else if (filter === "errors") result = result.filter(e => e.type === "error");
    else if (filter === "tools") result = result.filter(e => e.type === "tool_call");

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e => e.content.toLowerCase().includes(q) || e.file?.toLowerCase().includes(q));
    }

    return result;
  }, [entries, filter, search]);

  const TYPE_STYLES: Record<string, { icon: typeof Terminal; color: string }> = {
    tool_call: { icon: Terminal, color: "text-[var(--cl-info)]" },
    tool_result: { icon: MessageSquare, color: "text-muted-foreground" },
    text: { icon: MessageSquare, color: "text-foreground" },
    error: { icon: AlertTriangle, color: "text-[var(--cl-error)]" },
    edit: { icon: FileCode, color: "text-[var(--cl-warning)]" },
  };

  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/20 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">Agent Log</h4>
          <span className="text-xs text-muted-foreground">{entries.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          {(Object.entries(FILTER_CONFIG) as [FilterType, typeof FILTER_CONFIG.all][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-[var(--radius)] text-xs font-medium transition-colors",
                filter === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <cfg.icon className="h-3 w-3" />
              {cfg.label}
            </button>
          ))}
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto px-2 py-1 rounded-[var(--radius)] border border-border/30 bg-background text-xs w-36 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Log entries */}
      <div className="max-h-[400px] overflow-y-auto font-mono text-xs">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">No matching entries</div>
        ) : (
          filtered.map((entry, idx) => {
            const style = TYPE_STYLES[entry.type] || TYPE_STYLES.text;
            const Icon = style.icon;
            return (
              <div key={idx} className="flex items-start gap-2 px-3 py-1.5 border-b border-border/10 hover:bg-muted/50">
                <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", style.color)} />
                <span className={cn("break-all leading-relaxed", style.color)}>
                  {entry.file && <span className="text-[var(--cl-warning)] mr-1">[{entry.file}]</span>}
                  {entry.content}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
