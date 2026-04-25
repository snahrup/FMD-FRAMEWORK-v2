import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircuitBoard,
  Clock3,
  Database,
  Factory,
  FileStack,
  Gauge,
  GitBranch,
  History,
  Layers3,
  MonitorDot,
  PlayCircle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Table2,
  Workflow,
  Wrench,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

type LayerKey = "source" | "landing" | "bronze" | "silver" | "gold";
type AudienceMode = "business" | "operator";

interface LayerStory {
  key: LayerKey;
  label: string;
  short: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  plain: string;
  dataShape: string;
  fmdWork: string[];
  proof: string[];
  demoLine: string;
}

interface ControlStep {
  title: string;
  owner: string;
  summary: string;
  detail: string;
  icon: LucideIcon;
}

const layers: LayerStory[] = [
  {
    key: "source",
    label: "Sources",
    short: "Operational systems",
    icon: Factory,
    color: "#334155",
    bg: "#F1F5F9",
    plain: "The data starts in the systems IP Corp already runs: ERP, MES, ETQ, SQL Server, files, and future source types.",
    dataShape: "Tables, views, files, schemas, source watermarks, connection metadata.",
    fmdWork: [
      "Reads active source/entity metadata from the FMD control plane.",
      "Resolves the exact entities selected in the dashboard.",
      "Protects against accidentally widening a scoped launch into all entities.",
    ],
    proof: ["Selected source names", "Resolved entity IDs", "Connection metadata", "Load type"],
    demoLine: "We start with business-selected sources, not a hardcoded script.",
  },
  {
    key: "landing",
    label: "Landing",
    short: "Raw copy",
    icon: FileStack,
    color: "#0B8CC2",
    bg: "#E3EDF5",
    plain: "Landing is the loading dock. FMD copies the source data as-is so we have a raw, replayable record before transformations change anything.",
    dataShape: "Raw extract files in the landing lakehouse, partitioned and named by source/entity/run.",
    fmdWork: [
      "Extracts source rows using the configured connector.",
      "Writes raw files to OneLake/Fabric landing storage.",
      "Records rows, bytes, errors, and timing for the run.",
    ],
    proof: ["Raw files exist", "Rows read", "Rows written", "Run ID", "Extraction errors"],
    demoLine: "Nothing gets cleaned yet. This is preservation and traceability.",
  },
  {
    key: "bronze",
    label: "Bronze",
    short: "Structured tables",
    icon: Table2,
    color: "#4B658A",
    bg: "#E8EEF5",
    plain: "Bronze turns raw landing files into structured Delta-style tables so the lakehouse can query them consistently.",
    dataShape: "Typed, queryable tables with source-aligned columns and load metadata.",
    fmdWork: [
      "Converts raw landing files into table format.",
      "Applies standard metadata columns and load bookkeeping.",
      "Only runs for entities that successfully landed when scoped by the runtime.",
    ],
    proof: ["Bronze table", "Schema", "Primary keys", "Successful upstream landing"],
    demoLine: "Bronze is where raw data becomes usable infrastructure.",
  },
  {
    key: "silver",
    label: "Silver",
    short: "Clean business data",
    icon: ShieldCheck,
    color: "#475569",
    bg: "#E2E8F0",
    plain: "Silver is the trusted operational layer. This is where validation, normalization, and business rules make data safe for analytics.",
    dataShape: "Cleaned, conformed, validated tables with business-friendly structure.",
    fmdWork: [
      "Runs transformations after Bronze succeeds.",
      "Applies cleansing, validation, and incremental merge behavior where configured.",
      "Marks failures at the layer/entity level instead of hiding them in one giant log.",
    ],
    proof: ["Validation status", "Clean table", "Failed entities", "Business rule errors"],
    demoLine: "Silver is the point where we can explain whether data is trustworthy.",
  },
  {
    key: "gold",
    label: "Gold",
    short: "Curated reporting",
    icon: Sparkles,
    color: "#8B6914",
    bg: "#F5E6C8",
    plain: "Gold is the consumption layer: curated datasets, canonical models, KPIs, and reporting structures for decision makers.",
    dataShape: "Dimensional models, canonical business entities, Power BI-ready datasets.",
    fmdWork: [
      "Uses governed Silver outputs as inputs.",
      "Shapes data around reporting and domain concepts.",
      "Publishes business-facing models once upstream quality is acceptable.",
    ],
    proof: ["Gold spec", "Canonical model", "Release gate", "Report-ready dataset"],
    demoLine: "Gold is where data stops being plumbing and becomes business value.",
  },
];

const controlSteps: ControlStep[] = [
  {
    title: "User starts in FMD Dashboard",
    owner: "Business-facing UI",
    summary: "Sources, layers, and scope are selected in language the team understands.",
    detail: "The dashboard remains the primary experience. Users do not need to know Dagster exists.",
    icon: MonitorDot,
  },
  {
    title: "Dashboard posts /api/engine/start",
    owner: "FMD API",
    summary: "The same launch contract is preserved so the frontend does not need a rewrite.",
    detail: "The API builds a run request with layers, entity IDs, source filters, and trigger metadata.",
    icon: PlayCircle,
  },
  {
    title: "Dagster bridge chooses orchestration path",
    owner: "Bridge adapter",
    summary: "If Dagster mode is enabled, the request is converted into Dagster run config.",
    detail: "On VSC-Fabric we use the local subprocess launch path to run the Dagster job with the existing FMD framework path.",
    icon: GitBranch,
  },
  {
    title: "Dagster runs the medallion graph",
    owner: "Control plane",
    summary: "Landing -> Bronze -> Silver becomes a visible, debuggable graph.",
    detail: "Dagster gives the operator run history, layer-level logs, and a better failure surface.",
    icon: Workflow,
  },
  {
    title: "FMD engine still performs data work",
    owner: "FMD data plane",
    summary: "The existing LoadOrchestrator executes source/Fabric/lakehouse logic.",
    detail: "Dagster wraps the run. It does not replace the Fabric-specific business logic yet.",
    icon: Wrench,
  },
];

const dagsterGives = [
  "Visible orchestration graph",
  "Cleaner layer-level failures",
  "Run metadata and tags",
  "Path to retries and schedules",
  "OSS-portable control plane",
];

const dagsterDoesNot = [
  "Replace FMD source connectors",
  "Magically fix Fabric permissions",
  "Own business transformations yet",
  "Prove every source until real runs pass",
  "Become the daily user UI",
];

const sourceChips = ["MES", "M3 ERP", "ETQ", "SQL Server", "Files", "Future APIs"];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function currentLayerIndex(key: LayerKey) {
  return layers.findIndex((layer) => layer.key === key);
}

function LayerNode({
  layer,
  active,
  reached,
  onSelect,
  index,
}: {
  layer: LayerStory;
  active: boolean;
  reached: boolean;
  onSelect: () => void;
  index: number;
}) {
  const Icon = layer.icon;
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      className={cx("os-layer-node", active && "is-active", reached && "is-reached")}
      style={{ "--layer": layer.color, "--layer-bg": layer.bg, "--i": index } as React.CSSProperties}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 + index * 0.06, duration: 0.42, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <span className="os-node-halo" />
      <span className="os-node-icon">
        <Icon size={22} />
      </span>
      <span className="os-node-copy">
        <span>{layer.label}</span>
        <small>{layer.short}</small>
      </span>
    </motion.button>
  );
}

function ControlRail({ activeLayer }: { activeLayer: LayerStory }) {
  return (
    <section className="os-card os-control-rail">
      <div className="os-section-kicker">What Dagster changes</div>
      <h2>FMD stays the user experience. Dagster becomes the operator-grade run shell.</h2>
      <div className="os-control-steps">
        {controlSteps.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.title}
              className="os-control-step"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.18 + index * 0.055, duration: 0.35 }}
            >
              <div className="os-control-dot">
                <Icon size={16} />
              </div>
              <div>
                <div className="os-control-title">{step.title}</div>
                <div className="os-control-owner">{step.owner}</div>
                <p>{step.summary}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="os-operator-note">
        <CircuitBoard size={18} />
        <span>
          During a real run, Dagster shows the graph and layer logs while FMD records entity-level results back in
          the dashboard. Current focus: <strong>{activeLayer.label}</strong>.
        </span>
      </div>
    </section>
  );
}

function LayerDetail({ layer, mode }: { layer: LayerStory; mode: AudienceMode }) {
  const Icon = layer.icon;
  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={`${layer.key}-${mode}`}
        className="os-card os-layer-detail"
        style={{ "--layer": layer.color, "--layer-bg": layer.bg } as React.CSSProperties}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.985 }}
        transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="os-detail-header">
          <div className="os-detail-icon">
            <Icon size={30} />
          </div>
          <div>
            <div className="os-section-kicker">Layer briefing</div>
            <h2>{layer.label}: {layer.short}</h2>
          </div>
        </div>
        <p className="os-detail-plain">{mode === "business" ? layer.plain : layer.dataShape}</p>
        <div className="os-detail-grid">
          <div>
            <h3>{mode === "business" ? "What happens here" : "What FMD executes"}</h3>
            <ul>
              {layer.fmdWork.map((item) => (
                <li key={item}><CheckCircle2 size={15} />{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>How we prove it</h3>
            <ul>
              {layer.proof.map((item) => (
                <li key={item}><Gauge size={15} />{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="os-demo-line">
          <Zap size={17} />
          <span>{layer.demoLine}</span>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}

function DataPacket({ activeIndex }: { activeIndex: number }) {
  const left = `${8 + activeIndex * 21}%`;
  return (
    <motion.div
      className="os-data-packet"
      animate={{ left }}
      transition={{ type: "spring", stiffness: 95, damping: 18 }}
    >
      <span />
      <small>entity payload</small>
    </motion.div>
  );
}

export default function OrchestrationStory() {
  const [activeLayer, setActiveLayer] = useState<LayerKey>("landing");
  const [mode, setMode] = useState<AudienceMode>("business");
  const [showTruth, setShowTruth] = useState(false);

  const active = useMemo(() => layers.find((layer) => layer.key === activeLayer) ?? layers[1], [activeLayer]);
  const activeIndex = currentLayerIndex(activeLayer);

  return (
    <div className="os-page">
      <style>{`
        .os-page {
          --os-ink: var(--bp-ink-primary);
          --os-muted: var(--bp-ink-tertiary);
          --os-faint: var(--bp-ink-muted);
          --os-card: rgba(255, 255, 255, 0.94);
          --os-line: rgba(49, 81, 122, 0.14);
          min-height: 100vh;
          padding: 28px;
          color: var(--os-ink);
          background:
            radial-gradient(circle at 84% 10%, rgba(11, 140, 194, 0.10), transparent 24%),
            linear-gradient(180deg, #FFFFFF 0%, #F7F9FB 100%);
          position: relative;
          overflow: hidden;
        }
        .os-page::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(49, 81, 122, 0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(49, 81, 122, 0.055) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: radial-gradient(circle at 45% 22%, #000 0%, transparent 72%);
          pointer-events: none;
        }
        .os-page > * { position: relative; z-index: 1; }
        .os-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
          gap: 24px;
          align-items: stretch;
          max-width: 1580px;
          margin: 0 auto 22px;
        }
        .os-hero-main {
          border: 1px solid var(--os-line);
          background: linear-gradient(140deg, rgba(255,255,255,0.98), rgba(247,249,251,0.86));
          border-radius: 28px;
          padding: 32px;
          overflow: hidden;
        }
        .os-kicker, .os-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--bp-copper);
          font-size: 11px;
          font-weight: 750;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .os-kicker::before, .os-section-kicker::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 99px;
          background: var(--bp-copper);
          outline: 5px solid var(--bp-copper-soft);
        }
        .os-hero h1 {
          margin: 18px 0 0;
          max-width: 920px;
          font-family: var(--font-greeting);
          font-size: clamp(44px, 6vw, 92px);
          line-height: 0.92;
          letter-spacing: -0.055em;
          font-weight: 520;
        }
        .os-hero h1 span {
          color: var(--bp-copper);
        }
        .os-hero-copy {
          max-width: 780px;
          margin-top: 22px;
          color: var(--bp-ink-secondary);
          font-size: 17px;
          line-height: 1.65;
        }
        .os-mode-switch {
          display: inline-flex;
          margin-top: 26px;
          padding: 4px;
          border: 1px solid var(--os-line);
          background: rgba(255,255,255,0.48);
          border-radius: 999px;
        }
        .os-mode-switch button {
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: var(--bp-ink-tertiary);
          padding: 10px 16px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 180ms var(--ease-claude);
        }
        .os-mode-switch button.is-active {
          background: var(--bp-ink-primary);
          color: white;
        }
        .os-hero-side {
          border: 1px solid rgba(49, 81, 122, 0.22);
          border-radius: 28px;
          padding: 24px;
          background: #34383B;
          color: #FFFFFF;
          overflow: hidden;
        }
        .os-hero-side h2 {
          margin: 12px 0 10px;
          font-size: 23px;
          line-height: 1.1;
          letter-spacing: -0.03em;
        }
        .os-hero-side p {
          color: rgba(255,255,255,0.72);
          font-size: 14px;
          line-height: 1.55;
        }
        .os-split-list {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 18px;
        }
        .os-mini-panel {
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 18px;
          padding: 14px;
          background: rgba(255,255,255,0.055);
        }
        .os-mini-panel strong {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          margin-bottom: 10px;
        }
        .os-mini-panel ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 7px;
        }
        .os-mini-panel li {
          font-size: 11px;
          color: rgba(255,255,255,0.72);
          line-height: 1.35;
        }
        .os-card {
          border: 1px solid var(--os-line);
          border-radius: 24px;
          background: var(--os-card);
          backdrop-filter: blur(14px);
        }
        .os-stage {
          max-width: 1580px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 410px;
          gap: 22px;
        }
        .os-flow-card {
          padding: 24px;
          overflow: hidden;
        }
        .os-flow-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 22px;
        }
        .os-flow-header h2, .os-control-rail h2, .os-layer-detail h2 {
          margin: 8px 0 0;
          font-size: 28px;
          line-height: 1.05;
          letter-spacing: -0.04em;
        }
        .os-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        .os-chips span {
          border: 1px solid var(--os-line);
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(255,255,255,0.50);
          font-size: 11px;
          font-weight: 700;
          color: var(--bp-ink-secondary);
        }
        .os-flow-line {
          position: relative;
          display: grid;
          grid-template-columns: repeat(5, minmax(120px, 1fr));
          gap: 14px;
          padding: 34px 4px 28px;
        }
        .os-flow-line::before {
          content: "";
          position: absolute;
          left: 6%;
          right: 6%;
          top: 75px;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(49,81,122,0.22), transparent);
        }
        .os-data-packet {
          position: absolute;
          top: 61px;
          transform: translateX(-50%);
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 10px;
          border-radius: 999px;
          background: #34383B;
          color: #FFFFFF;
          font-size: 10px;
          font-weight: 700;
          border: 1px solid rgba(255,255,255,0.16);
          pointer-events: none;
        }
        .os-data-packet span {
          width: 8px;
          height: 8px;
          border-radius: 99px;
          background: var(--bp-copper);
          animation: osPulse 1.6s ease-in-out infinite;
        }
        .os-layer-node {
          position: relative;
          min-height: 156px;
          border: 1px solid rgba(49,81,122,0.14);
          border-radius: 22px;
          background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(247,249,251,0.84));
          color: var(--os-ink);
          padding: 18px;
          text-align: left;
          cursor: pointer;
          overflow: hidden;
          transition: transform 180ms var(--ease-claude), border-color 180ms var(--ease-claude), background 180ms var(--ease-claude);
        }
        .os-layer-node:hover {
          transform: translateY(-3px);
          border-color: color-mix(in srgb, var(--layer) 38%, transparent);
        }
        .os-layer-node.is-active {
          background: linear-gradient(160deg, color-mix(in srgb, var(--layer-bg) 82%, white), rgba(255,255,255,0.70));
          border-color: color-mix(in srgb, var(--layer) 48%, transparent);
        }
        .os-node-halo {
          position: absolute;
          width: 120px;
          height: 120px;
          right: -42px;
          top: -42px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--layer) 18%, transparent);
        }
        .os-node-icon {
          position: relative;
          width: 48px;
          height: 48px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          background: var(--layer-bg);
          color: var(--layer);
          border: 1px solid color-mix(in srgb, var(--layer) 20%, transparent);
        }
        .os-node-copy {
          position: absolute;
          left: 18px;
          right: 18px;
          bottom: 18px;
          display: grid;
          gap: 5px;
        }
        .os-node-copy span {
          font-size: 20px;
          font-weight: 760;
          letter-spacing: -0.035em;
        }
        .os-node-copy small {
          color: var(--bp-ink-tertiary);
          font-size: 12px;
          font-weight: 650;
        }
        .os-detail-row {
          display: grid;
          grid-template-columns: minmax(0, 0.92fr) minmax(340px, 0.62fr);
          gap: 22px;
          margin-top: 22px;
        }
        .os-layer-detail {
          padding: 24px;
          border-color: color-mix(in srgb, var(--layer) 25%, transparent);
          background: linear-gradient(140deg, rgba(255,255,255,0.98), color-mix(in srgb, var(--layer-bg) 38%, rgba(247,249,251,0.92)));
        }
        .os-detail-header {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .os-detail-icon {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          display: grid;
          place-items: center;
          background: var(--layer-bg);
          color: var(--layer);
        }
        .os-detail-plain {
          margin: 20px 0 0;
          max-width: 880px;
          color: var(--bp-ink-secondary);
          font-size: 16px;
          line-height: 1.7;
        }
        .os-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-top: 22px;
        }
        .os-detail-grid > div {
          border: 1px solid rgba(49,81,122,0.12);
          border-radius: 18px;
          background: rgba(255,255,255,0.54);
          padding: 16px;
        }
        .os-detail-grid h3 {
          margin: 0 0 12px;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--bp-ink-tertiary);
        }
        .os-detail-grid ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 10px;
        }
        .os-detail-grid li {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          color: var(--bp-ink-secondary);
          font-size: 13px;
          line-height: 1.45;
        }
        .os-detail-grid li svg {
          flex: 0 0 auto;
          color: var(--layer);
          margin-top: 2px;
        }
        .os-demo-line {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 18px;
          border-radius: 16px;
          padding: 14px 16px;
          background: #34383B;
          color: #FFFFFF;
          font-size: 14px;
          font-weight: 700;
        }
        .os-control-rail {
          padding: 24px;
        }
        .os-control-steps {
          margin-top: 22px;
          display: grid;
          gap: 14px;
        }
        .os-control-step {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          gap: 12px;
        }
        .os-control-dot {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          color: var(--bp-copper);
          background: var(--bp-copper-soft);
          border: 1px solid rgba(11,140,194,0.20);
        }
        .os-control-title {
          font-size: 14px;
          font-weight: 780;
          letter-spacing: -0.015em;
        }
        .os-control-owner {
          margin-top: 1px;
          font-size: 10px;
          color: var(--bp-copper);
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .os-control-step p {
          margin: 5px 0 0;
          color: var(--bp-ink-tertiary);
          font-size: 12px;
          line-height: 1.45;
        }
        .os-operator-note {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-top: 20px;
          padding: 14px;
          border-radius: 16px;
          background: var(--bp-surface-inset);
          color: var(--bp-ink-secondary);
          font-size: 12px;
          line-height: 1.45;
        }
        .os-operator-note svg {
          color: var(--bp-copper);
          flex: 0 0 auto;
        }
        .os-bottom-grid {
          max-width: 1580px;
          margin: 22px auto 0;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 16px;
        }
        .os-brief-card {
          padding: 18px;
        }
        .os-brief-card h3 {
          margin: 10px 0 8px;
          font-size: 17px;
          letter-spacing: -0.02em;
        }
        .os-brief-card p {
          margin: 0;
          color: var(--bp-ink-tertiary);
          font-size: 13px;
          line-height: 1.55;
        }
        .os-truth-toggle {
          border: 1px solid var(--os-line);
          background: rgba(255,255,255,0.56);
          border-radius: 18px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .os-truth-toggle button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid rgba(11,140,194,0.24);
          background: var(--bp-copper);
          color: white;
          border-radius: 999px;
          padding: 10px 14px;
          font-weight: 800;
          cursor: pointer;
        }
        .os-truth-panel {
          border-radius: 16px;
          background: rgba(52,56,59,0.96);
          color: #FFFFFF;
          padding: 14px;
          font-size: 13px;
          line-height: 1.5;
        }
        .os-demo-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 16px;
          border: 1px solid rgba(11,140,194,0.22);
          background: var(--bp-copper-light);
          color: var(--bp-copper);
          border-radius: 999px;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 800;
          text-decoration: none;
        }
        @keyframes osPulse {
          0%, 100% { transform: scale(1); opacity: 0.72; }
          50% { transform: scale(1.45); opacity: 1; }
        }
        @media (max-width: 1220px) {
          .os-hero, .os-stage, .os-detail-row, .os-bottom-grid {
            grid-template-columns: 1fr;
          }
          .os-flow-line {
            grid-template-columns: 1fr;
          }
          .os-flow-line::before, .os-data-packet {
            display: none;
          }
          .os-layer-node {
            min-height: 116px;
          }
          .os-node-copy {
            left: 86px;
            top: 28px;
            bottom: auto;
          }
        }
        @media (max-width: 760px) {
          .os-page {
            padding: 14px;
          }
          .os-hero-main, .os-hero-side, .os-flow-card, .os-layer-detail, .os-control-rail {
            border-radius: 18px;
            padding: 18px;
          }
          .os-detail-grid, .os-split-list {
            grid-template-columns: 1fr;
          }
          .os-flow-header {
            align-items: flex-start;
            flex-direction: column;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .os-page *, .os-page *::before, .os-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="os-hero">
        <motion.div
          className="os-hero-main"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="os-kicker">Demo explainer</div>
          <h1>
            How FMD uses <span>Dagster</span> without hiding the data journey.
          </h1>
          <p className="os-hero-copy">
            The dashboard remains the business cockpit. Dagster becomes the orchestration control plane behind it,
            and the existing FMD engine still performs the source, Fabric, and lakehouse work.
          </p>
          <div className="os-mode-switch" aria-label="Audience mode">
            <button className={cx(mode === "business" && "is-active")} onClick={() => setMode("business")}>
              Business explanation
            </button>
            <button className={cx(mode === "operator" && "is-active")} onClick={() => setMode("operator")}>
              Operator explanation
            </button>
          </div>
        </motion.div>

        <motion.aside
          className="os-hero-side"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.48 }}
        >
          <div className="os-kicker">Reality check</div>
          <h2>Dagster is the run shell. FMD is still the data plane.</h2>
          <p>
            This distinction is the key demo message: Dagster improves how the pipeline is launched, observed,
            retried, and explained. It does not erase the metadata-driven FMD framework.
          </p>
          <div className="os-split-list">
            <div className="os-mini-panel">
              <strong><CheckCircle2 size={15} /> Gives us</strong>
              <ul>{dagsterGives.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="os-mini-panel">
              <strong><XCircle size={15} /> Does not yet</strong>
              <ul>{dagsterDoesNot.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        </motion.aside>
      </section>

      <section className="os-stage">
        <div>
          <section className="os-card os-flow-card">
            <div className="os-flow-header">
              <div>
                <div className="os-section-kicker">Medallion flow</div>
                <h2>Click a layer to explain exactly what happens to the data.</h2>
              </div>
              <div className="os-chips">
                {sourceChips.map((chip) => <span key={chip}>{chip}</span>)}
              </div>
            </div>
            <div className="os-flow-line">
              <DataPacket activeIndex={activeIndex} />
              {layers.map((layer, index) => (
                <LayerNode
                  key={layer.key}
                  layer={layer}
                  active={layer.key === activeLayer}
                  reached={index <= activeIndex}
                  index={index}
                  onSelect={() => setActiveLayer(layer.key)}
                />
              ))}
            </div>
          </section>

          <div className="os-detail-row">
            <LayerDetail layer={active} mode={mode} />
            <section className="os-card os-brief-card">
              <h3>Demo takeaway</h3>
              <p>
                A user launches from FMD. The API keeps the same contract, but routes the run through Dagster when
                Dagster mode is enabled. Dagster shows the medallion graph and run logs. Each Dagster layer delegates
                back to FMD, which performs the actual source extraction, Fabric writes, and layer processing.
              </p>
              <a className="os-demo-link" href="/replay?demo=1">
                <History size={15} />
                Open transformation replay
              </a>
              <div className="os-truth-toggle" style={{ marginTop: 16 }}>
                <button type="button" onClick={() => setShowTruth((v) => !v)}>
                  {showTruth ? <RefreshCcw size={16} /> : <Clock3 size={16} />}
                  {showTruth ? "Hide caveat" : "Show honest caveat"}
                </button>
                <AnimatePresence>
                  {showTruth && (
                    <motion.div
                      className="os-truth-panel"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      Structural wiring is in place. Full confidence requires one real Fabric run that proves selected
                      sources write Landing, Bronze, Silver, and dashboard status cleanly end-to-end.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>
        </div>

        <ControlRail activeLayer={active} />
      </section>

      <section className="os-bottom-grid">
        <motion.div className="os-card os-brief-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
          <Boxes color="var(--bp-copper)" />
          <h3>For business users</h3>
          <p>Use FMD Dashboard. Pick sources, layers, and scope. See business-facing status and validation results.</p>
        </motion.div>
        <motion.div className="os-card os-brief-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.31 }}>
          <Workflow color="var(--bp-copper)" />
          <h3>For operators</h3>
          <p>Use Dagster UI when a run needs investigation: graph view, layer logs, run history, and failure boundary.</p>
        </motion.div>
        <motion.div className="os-card os-brief-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
          <Layers3 color="var(--bp-copper)" />
          <h3>For the architecture</h3>
          <p>Keep FMD as the data plane while gradually moving orchestration responsibility into Dagster OSS code.</p>
        </motion.div>
      </section>
    </div>
  );
}
