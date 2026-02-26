import { useState, useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import {
  MessageSquare,
  FileText,
  RefreshCw,
  Lock,
  Unlock,
  Clock,
} from "lucide-react";

const API = "http://localhost:8787/api";

interface AgentLogData {
  content: string;
  lastModified: string;
}

/* ---------- Markdown with custom component overrides ---------- */
/* All colors use --agent-content-* CSS vars so they auto-adapt
   to the inverted light/dark background in the content area */
const mdComponents = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => (
    <h1 className="text-lg font-bold mb-3 mt-0" style={{ color: "var(--agent-content-fg)" }} {...props} />
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2 className="text-base font-bold mt-5 mb-2 pb-1" style={{ color: "var(--agent-content-fg)", borderBottom: "1px solid var(--agent-border)" }} {...props} />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 className="text-sm font-bold mt-4 mb-1" style={{ color: "var(--agent-content-fg)" }} {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => (
    <p className="text-xs leading-relaxed my-1.5" style={{ color: "var(--agent-content-fg-muted)" }} {...props} />
  ),
  strong: (props: ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold" style={{ color: "var(--agent-content-fg)" }} {...props} />
  ),
  em: (props: ComponentPropsWithoutRef<"em">) => (
    <em className="italic" style={{ color: "var(--agent-content-fg-faint)" }} {...props} />
  ),
  ul: (props: ComponentPropsWithoutRef<"ul">) => (
    <ul className="my-1.5 ml-1 space-y-0.5" {...props} />
  ),
  ol: (props: ComponentPropsWithoutRef<"ol">) => (
    <ol className="my-1.5 ml-1 space-y-0.5 list-decimal list-inside" style={{ color: "var(--agent-content-fg-muted)" }} {...props} />
  ),
  li: (props: ComponentPropsWithoutRef<"li">) => (
    <li className="text-xs leading-relaxed flex gap-1.5" style={{ color: "var(--agent-content-fg-muted)" }}>
      <span className="mt-0.5 shrink-0" style={{ color: "var(--agent-content-fg-faint)" }}>•</span>
      <span>{props.children}</span>
    </li>
  ),
  hr: () => <hr style={{ borderColor: "var(--agent-border)" }} className="my-4" />,
  code: (props: ComponentPropsWithoutRef<"code">) => {
    const isBlock = props.className?.includes("language-");
    if (isBlock) {
      return (
        <code
          className="block text-[11px] p-3 rounded-lg my-2 overflow-x-auto whitespace-pre font-mono"
          style={{ background: "rgba(0,0,0,0.4)", color: "#a5d6a7" }}
          {...props}
        />
      );
    }
    return (
      <code
        className="text-[11px] px-1.5 py-0.5 rounded font-mono"
        style={{ background: "var(--agent-code-bg)", color: "var(--agent-code-fg)" }}
        {...props}
      />
    );
  },
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre className="my-2 rounded-lg overflow-hidden" {...props} />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a className="text-primary hover:underline" {...props} />
  ),
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="pl-3 my-2 text-xs italic" style={{ borderLeft: "2px solid var(--agent-border)", color: "var(--agent-content-fg-faint)" }} {...props} />
  ),
};

const AGENT_AVATARS: Record<string, string> = {
  gemini: "/icons/gemini_profile.jpg",
  claude: "/icons/claude_profile.jpg",
};

function agentNameFor(raw: string): "gemini" | "claude" | null {
  const lower = raw.toLowerCase();
  if (lower.includes("antigravity") || lower.includes("gemini")) return "gemini";
  if (lower.includes("claude") || lower.includes("cool-prism")) return "claude";
  return null;
}

/** Replaces agent header lines with avatar-marker syntax, strips To:/Message: prefixes */
function cleanAgentContent(raw: string): string {
  return raw
    .replace(/\*\*\[([^\]]+)\]\*\*\s*-?\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/g,
      (_m, name, _y, mo, d, t) => {
        const agent = agentNameFor(name) || "claude";
        return `<!--AGENT:${agent}:${parseInt(mo)}/${parseInt(d)} ${t}-->`;
      })
    .replace(/^\*\*To:\*\*.*$/gm, "")
    .replace(/^\*\*Message:\*\*\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Renders an agent avatar + timestamp header — no text label, just the image */
function AgentHeader({ agent, time }: { agent: string; time: string }) {
  const src = AGENT_AVATARS[agent] || AGENT_AVATARS.claude;
  const label = agent === "gemini" ? "Gemini" : "Claude";
  return (
    <div className="flex items-center gap-3 mt-5 mb-2">
      <img
        src={src}
        alt={label}
        className="w-14 h-14 rounded-full object-cover"
        style={{ boxShadow: "0 0 0 2px var(--agent-border)" }}
      />
      <span className="text-[10px]" style={{ color: "var(--agent-content-fg-faint)" }}>{time}</span>
    </div>
  );
}

function StyledMarkdown({ content }: { content: string }) {
  const cleaned = cleanAgentContent(content);
  const parts = cleaned.split(/(<!--AGENT:\w+:\d+\/\d+\s+\d+:\d+-->)/);

  return (
    <div className="space-y-0">
      {parts.map((part, i) => {
        const match = part.match(/<!--AGENT:(\w+):(.+?)-->/);
        if (match) {
          return <AgentHeader key={i} agent={match[1]} time={match[2]} />;
        }
        if (!part.trim()) return null;
        return <Markdown key={i} components={mdComponents}>{part}</Markdown>;
      })}
    </div>
  );
}

/* ---------- File Lock Badge ---------- */
function FileLockBadge({ content }: { content: string }) {
  const lines = content.split("\n");
  const locks: { file: string; agent: string }[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.includes("Active File Locks")) inSection = true;
    else if (inSection && line.startsWith("## ")) break;
    else if (inSection && line.startsWith("- ") && !line.includes("None")) {
      const raw = line.replace(/^-\s*/, "").replace(/`/g, "").trim();
      const lockMatch = raw.match(/^(.+?)\s*\(locked by\s+(.+?)\)$/i);
      if (lockMatch) {
        locks.push({ file: lockMatch[1].trim(), agent: lockMatch[2].trim() });
      } else {
        locks.push({ file: raw, agent: "unknown" });
      }
    }
  }

  if (locks.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80 bg-emerald-400/5 border border-emerald-400/10 rounded-md px-2 py-1">
        <Unlock className="w-3 h-3" />
        No file locks active
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {locks.map((lock, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[10px] text-amber-400/80 bg-amber-400/5 border border-amber-400/10 rounded-md px-2 py-1">
          <Lock className="w-3 h-3 shrink-0" />
          <span className="font-mono truncate">{lock.file}</span>
          <span className="text-amber-400/50 shrink-0">by {lock.agent}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Panel component ---------- */
function LogPanel({
  title,
  icon: Icon,
  data,
  loading,
  error,
}: {
  title: string;
  icon: typeof FileText;
  data: AgentLogData | null;
  loading: boolean;
  error: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-border/50 bg-card/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {data?.lastModified && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {data.lastModified}
          </span>
        )}
      </div>

      {/* Content — inverted background for contrast */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 rounded-b-xl"
        style={{
          background: "var(--agent-content-bg)",
          maxHeight: "calc(100vh - 280px)",
        }}
      >
        {loading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-4 h-4 text-primary animate-spin" />
            <span className="text-xs ml-2" style={{ color: "var(--agent-content-fg-faint)" }}>Loading...</span>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg p-3">
            {error}
          </div>
        )}
        {data && !loading && <StyledMarkdown content={data.content} />}
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */
export default function AgentCollaboration() {
  const [sharedLog, setSharedLog] = useState<AgentLogData | null>(null);
  const [bulletin, setBulletin] = useState<AgentLogData | null>(null);
  const [logLoading, setLogLoading] = useState(true);
  const [bulletinLoading, setBulletinLoading] = useState(true);
  const [logError, setLogError] = useState<string | null>(null);
  const [bulletinError, setBulletinError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API}/settings/agent-log`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setSharedLog(data.sharedLog);
      setBulletin(data.bulletin);
      setLogError(null);
      setBulletinError(null);
    } catch (e: any) {
      setLogError(e.message || "Failed to fetch");
      setBulletinError(e.message || "Failed to fetch");
    } finally {
      setLogLoading(false);
      setBulletinLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">Agent Collaboration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time view of shared logs and bulletin board between AI agents
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sharedLog && <FileLockBadge content={sharedLog.content} />}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md border transition-colors cursor-pointer ${
              autoRefresh
                ? "text-primary bg-primary/5 border-primary/20"
                : "text-muted-foreground bg-card/50 border-border/50"
            }`}
          >
            <RefreshCw
              className={`w-3 h-3 ${autoRefresh ? "animate-spin" : ""}`}
              style={autoRefresh ? { animationDuration: "3s" } : undefined}
            />
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md border border-border/50 hover:border-border transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-2 gap-4" style={{ height: "calc(100vh - 220px)" }}>
        <LogPanel
          title="Bulletin Board"
          icon={MessageSquare}
          data={bulletin}
          loading={bulletinLoading}
          error={bulletinError}
        />
        <LogPanel
          title="Shared Agent Log"
          icon={FileText}
          data={sharedLog}
          loading={logLoading}
          error={logError}
        />
      </div>
    </div>
  );
}
