import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  DatabaseZap,
  FlaskConical,
  Microscope,
  Network,
  Orbit,
  Route,
  Columns3,
  History,
  GitCompare,
  Zap,
  Search,
  ArrowDownUp,
} from "lucide-react";
import { LaunchTile } from "@/components/navigation/LaunchTile";
import { useEntityDigest } from "@/hooks/useEntityDigest";
import { getBlockedEntities, getToolReadyEntities } from "@/lib/exploreWorksurface";
import CompactPageHeader from "@/components/layout/CompactPageHeader";

const API = import.meta.env.VITE_API_URL || "";

interface JoinStatusResponse {
  status?: string;
  generatedAt?: string | null;
  summary?: {
    joinCandidates?: number;
  };
}

const coreTools = [
  {
    to: "/catalog",
    icon: BookOpen,
    eyebrow: "Find the right asset",
    title: "Data Catalog",
    summary: "See where a staged asset belongs, what sits closest to it, and which relationships are contextual versus evidence-backed.",
    ctaLabel: "Open atlas",
    accent: "var(--bp-copper)",
    features: ["Relationship atlas", "AI documentation", "Evidence provenance"],
  },
  {
    to: "/lineage",
    icon: Network,
    eyebrow: "Follow the chain",
    title: "Data Lineage",
    summary: "Trace one entity through the managed path, spot the contract shift, and jump straight into the next diagnostic move.",
    ctaLabel: "Open lineage",
    accent: "var(--bp-operational)",
    features: ["Focused path", "Blast radius", "Column drift"],
  },
  {
    to: "/profile",
    icon: Microscope,
    eyebrow: "Validate the table",
    title: "Data Profiler",
    summary: "Inspect completeness, uniqueness, null hotspots, and likely keys before deciding whether the table is fit for use.",
    ctaLabel: "Open profiler",
    accent: "var(--bp-silver)",
    features: ["Shape check", "Null density", "Key clues"],
  },
  {
    to: "/blender",
    icon: FlaskConical,
    eyebrow: "Test the relationship",
    title: "Data Blender",
    summary: "Profile a table, explore blend candidates, and preview whether a relationship is worth operationalizing.",
    ctaLabel: "Open blender",
    accent: "var(--bp-copper-hover)",
    features: ["Blend suggestions", "Preview output", "Join validation"],
  },
  {
    to: "/sql-explorer",
    icon: DatabaseZap,
    eyebrow: "Inspect the source",
    title: "SQL Explorer",
    summary: "Browse source and lakehouse objects, inspect structure, and stage the next tables into the managed pipeline.",
    ctaLabel: "Open explorer",
    accent: "var(--bp-ink-primary)",
    features: ["Source schema", "Stage for load", "Jump downstream"],
  },
];

const deepDiveTools = [
  { to: "/journey", label: "Data Journey", note: "Follow one entity across process steps.", icon: Route },
  { to: "/load-progress", label: "Load Progress", note: "See per-entity movement through medallion stages.", icon: ArrowDownUp },
  { to: "/columns", label: "Column Evolution", note: "Compare how the contract changed over time.", icon: Columns3 },
  { to: "/replay", label: "Transformation Replay", note: "Reconstruct a row-level transformation path.", icon: History },
  { to: "/sankey", label: "Sankey Flow", note: "Visualize high-level directional movement.", icon: GitCompare },
  { to: "/pulse", label: "Impact Pulse", note: "See what downstream surfaces feel the blast radius.", icon: Zap },
];

export default function ExploreHub() {
  const { allEntities, loading } = useEntityDigest();
  const [joinStatus, setJoinStatus] = useState<JoinStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API}/api/join-discovery/status`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data) setJoinStatus(data);
      })
      .catch(() => {
        if (!cancelled) setJoinStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toolReadyEntities = useMemo(() => getToolReadyEntities(allEntities), [allEntities]);
  const blockedEntities = useMemo(() => getBlockedEntities(allEntities), [allEntities]);
  const trustedCount = useMemo(
    () => toolReadyEntities.filter((entity) => (entity.qualityScore || 0) >= 80 || entity.qualityTier === "silver").length,
    [toolReadyEntities],
  );
  const sourceCount = useMemo(() => new Set(allEntities.map((entity) => entity.source)).size, [allEntities]);

  return (
    <div className="bp-page-shell-wide space-y-6">
      <CompactPageHeader
        eyebrow="Explore"
        title="Explore Hub"
        summary="Choose the investigative surface that matches the question instead of making each tool page teach the full system from scratch."
        meta={loading ? "Building tool inventory..." : `${toolReadyEntities.length.toLocaleString("en-US")} tool-ready assets across ${sourceCount.toLocaleString("en-US")} sources`}
        guideItems={[
          {
            label: "What This Page Is",
            value: "Investigation routing layer",
            detail: "Explore Hub is the decision point for analysis work. It should tell operators which tool fits the question before they spend time in the wrong workspace.",
          },
          {
            label: "Why It Matters",
            value: "Less tool thrash",
            detail: "Catalog, Lineage, Profiler, Blender, and SQL Explorer solve different jobs. This page reduces bouncing by making that distinction visible up front.",
          },
          {
            label: "What Happens Next",
            value: "Start broad, then narrow",
            detail: "Move into a core workspace first, then branch into the deeper specialist tools only when the first answer shows where the trail continues.",
          },
        ]}
        guideLinks={[
          { label: "Open Overview", to: "/overview" },
          { label: "Open Load Center", to: "/load-center" },
          { label: "Open Data Estate", to: "/estate" },
        ]}
        facts={[
          {
            label: "Tool-Ready",
            value: toolReadyEntities.length.toLocaleString("en-US"),
            detail: "Assets that have completed the managed path and can fully participate in Explore tools.",
            tone: "positive",
          },
          {
            label: "Blocked",
            value: blockedEntities.length.toLocaleString("en-US"),
            detail: "Assets that should go to Load Center before they appear in investigative workspaces.",
            tone: blockedEntities.length > 0 ? "warning" : "neutral",
          },
          {
            label: "Trusted",
            value: trustedCount.toLocaleString("en-US"),
            detail: "Higher-confidence assets worth operator focus first.",
            tone: trustedCount > 0 ? "accent" : "neutral",
          },
          {
            label: "Graph Evidence",
            value: joinStatus?.status === "ready" ? "Staged" : "Context",
            detail: joinStatus?.status === "ready"
              ? `${(joinStatus.summary?.joinCandidates || 0).toLocaleString("en-US")} candidate relationships are staged from lakehouse-backed analysis.`
              : "Relationship views are still using staged context clues until the evidence map is rebuilt.",
            tone: joinStatus?.status === "ready" ? "positive" : "accent",
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/overview"
              className="inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold transition-transform hover:-translate-y-0.5"
              style={{
                textDecoration: "none",
                color: "var(--bp-ink-secondary)",
                border: "1px solid rgba(120,113,108,0.1)",
                background: "rgba(255,255,255,0.72)",
              }}
            >
              Overview
            </Link>
            {blockedEntities.length > 0 ? (
              <Link
                to="/load-center"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-transform hover:-translate-y-0.5"
                style={{
                  textDecoration: "none",
                  color: "var(--bp-copper)",
                  border: "1px solid rgba(180,86,36,0.16)",
                  background: "rgba(180,86,36,0.08)",
                }}
              >
                <Orbit size={12} />
                Load Center
              </Link>
            ) : null}
          </div>
        }
      />

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {[
          {
            label: "Need to find the right asset?",
            value: "Start with Catalog",
            detail: "Use the atlas when the question is about proximity, trust, ownership, or candidate relationships.",
          },
          {
            label: "Need to understand the break?",
            value: "Start with Lineage",
            detail: "Use the focused path when the question is where the chain stops, changes, or impacts downstream work.",
          },
          {
            label: "Need to judge data quality fast?",
            value: "Start with Profiler",
            detail: "Use the table workbench when the question is whether the structure is fit for joins, modeling, or release.",
          },
        ].map((item, index) => (
          <div
            key={item.label}
            className="rounded-[20px] p-4 gs-stagger-card"
            style={{
              "--i": Math.min(index, 2),
              border: "1px solid rgba(120,113,108,0.12)",
              background: "rgba(255,255,255,0.88)",
            } as CSSProperties}
          >
            <div
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--bp-ink-tertiary)",
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 18,
                lineHeight: 1.12,
                color: "var(--bp-ink-primary)",
                fontFamily: "var(--bp-font-display)",
              }}
            >
              {item.value}
            </div>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--bp-ink-secondary)",
              }}
            >
              {item.detail}
            </p>
          </div>
        ))}
      </div>

      <div>
        <div
          style={{
            fontFamily: "var(--bp-font-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--bp-copper)",
            marginBottom: 12,
          }}
        >
          Core workspaces
        </div>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
        >
          {coreTools.map((tool, index) => (
            <div key={tool.to} className="gs-stagger-card" style={{ "--i": Math.min(index, 4) } as CSSProperties}>
              <LaunchTile
                {...tool}
                statLabel={tool.to === "/catalog"
                  ? "Tool-ready"
                  : tool.to === "/lineage"
                    ? "Blocked"
                    : tool.to === "/profile"
                      ? "Trusted"
                      : tool.to === "/blender"
                        ? "Blend scope"
                        : "Sources"}
                statValue={tool.to === "/catalog"
                  ? toolReadyEntities.length.toLocaleString("en-US")
                  : tool.to === "/lineage"
                    ? blockedEntities.length.toLocaleString("en-US")
                    : tool.to === "/profile"
                      ? trustedCount.toLocaleString("en-US")
                      : tool.to === "/blender"
                        ? `${Math.min(toolReadyEntities.length, 180).toLocaleString("en-US")} ready`
                        : sourceCount.toLocaleString("en-US")}
              />
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-[24px] p-5"
        style={{
          border: "1px solid rgba(120,113,108,0.12)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(246,244,240,0.96) 100%)",
        }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--bp-ink-tertiary)",
              }}
            >
              Deep-dive tools
            </div>
            <h2
              style={{
                margin: "8px 0 0",
                fontSize: 22,
                lineHeight: 1.08,
                color: "var(--bp-ink-primary)",
                fontFamily: "var(--bp-font-display)",
              }}
            >
              Use these when the core workspaces tell you where to dig deeper
            </h2>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-2" style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(120,113,108,0.08)" }}>
            <Search size={14} style={{ color: "var(--bp-copper)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-secondary)" }}>
              Start in a core tool, then branch out only when needed
            </span>
          </div>
        </div>

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 18 }}
        >
          {deepDiveTools.map((tool, index) => (
            <Link
              key={tool.to}
              to={tool.to}
              className="block rounded-[18px] p-4 transition-transform duration-200 hover:-translate-y-0.5 gs-stagger-card"
              style={{
                "--i": Math.min(index, 5),
                textDecoration: "none",
                border: "1px solid rgba(120,113,108,0.1)",
                background: "rgba(255,255,255,0.78)",
              } as CSSProperties}
            >
              <div className="flex items-center gap-2">
                <tool.icon size={15} style={{ color: "var(--bp-copper)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                  {tool.label}
                </span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--bp-ink-secondary)" }}>
                {tool.note}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
