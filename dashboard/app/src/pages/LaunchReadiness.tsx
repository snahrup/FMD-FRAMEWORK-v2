import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  GitBranch,
  PlayCircle,
  Route,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";
import CompactPageHeader from "@/components/layout/CompactPageHeader";

type GateTone = "done" | "action" | "blocked";

interface Gate {
  label: string;
  tone: GateTone;
  summary: string;
  owner: string;
}

interface Step {
  label: string;
  detail: string;
  link?: string;
  linkLabel?: string;
}

const ROADMAP_PATH =
  "C:\\Users\\snahrup\\CascadeProjects\\FMD_FRAMEWORK\\docs\\superpowers\\plans\\2026-04-25-fmd-launch-readiness-roadmap.md";
const RUNBOOK_PATH =
  "C:\\Users\\snahrup\\CascadeProjects\\FMD_FRAMEWORK\\docs\\REAL_LOAD_SMOKE_RUNBOOK.md";
const SMOKE_COMMAND =
  "cd C:\\Users\\snahrup\\CascadeProjects\\FMD_FRAMEWORK && pwsh .\\scripts\\run_real_smoke_load.ps1";

const launchGates: Gate[] = [
  {
    label: "Run truth",
    tone: "done",
    summary: "Mission Control now separates dry-run metadata from real physical-load evidence.",
    owner: "Built",
  },
  {
    label: "Artifact evidence",
    tone: "done",
    summary: "Real-load receipts can prove Landing files, Bronze Delta logs, and Silver Delta logs.",
    owner: "Built",
  },
  {
    label: "Real smoke proof",
    tone: "action",
    summary: "A fresh PowerShell run must execute against real local/Fabric paths and produce a receipt.",
    owner: "Operator",
  },
  {
    label: "Source onboarding",
    tone: "action",
    summary: "The wizard now launches a scoped real engine run, but still needs a real source-onboarding smoke receipt.",
    owner: "Needs proof",
  },
  {
    label: "Fabric mirrored pipelines",
    tone: "blocked",
    summary: "Canvas can request Fabric execution, but true Fabric pipeline creation/sync is not launch-grade yet.",
    owner: "Future build",
  },
];

const handoffSteps: Step[] = [
  {
    label: "1. Add or inspect a source",
    detail: "Source Manager is the expected entry point for connections, tables, load configuration, and active scope.",
    link: "/sources",
    linkLabel: "Open Source Manager",
  },
  {
    label: "2. Build or choose the pipeline path",
    detail: "Canvas Builder should compile the source through Landing Zone, Bronze, Silver, and quality gates.",
    link: "/canvas",
    linkLabel: "Open Canvas Builder",
  },
  {
    label: "3. Launch the run",
    detail: "The operator starts a pipeline from the canvas or Load Center, then follows the run in Mission Control.",
    link: "/load-center",
    linkLabel: "Open Load Center",
  },
  {
    label: "4. Verify physical output",
    detail: "Mission Control must show a real receipt with files, Delta logs, task counts, and no dry-run-only claims.",
    link: "/load-mission-control",
    linkLabel: "Open Mission Control",
  },
];

const evidenceModel = [
  "engine_runs contains the terminal run record and mode.",
  "engine_task_log records each layer task for Landing, Bronze, and Silver.",
  "Landing output must resolve to a physical parquet file.",
  "Bronze and Silver output must resolve to Delta folders with _delta_log.",
  ".runs\\real-smoke\\<run-id>\\receipt.json becomes the operator-facing proof package.",
];

function toneStyle(tone: GateTone): CSSProperties {
  if (tone === "done") {
    return {
      borderColor: "color-mix(in srgb, var(--bp-operational) 28%, var(--bp-border))",
      background: "color-mix(in srgb, var(--bp-operational) 7%, #ffffff)",
      color: "var(--bp-operational)",
    };
  }
  if (tone === "blocked") {
    return {
      borderColor: "color-mix(in srgb, var(--bp-fault) 24%, var(--bp-border))",
      background: "color-mix(in srgb, var(--bp-fault) 6%, #ffffff)",
      color: "var(--bp-fault)",
    };
  }
  return {
    borderColor: "color-mix(in srgb, var(--bp-caution) 28%, var(--bp-border))",
    background: "color-mix(in srgb, var(--bp-caution) 7%, #ffffff)",
    color: "var(--bp-caution)",
  };
}

function GateIcon({ tone }: { tone: GateTone }) {
  if (tone === "done") return <CheckCircle2 className="h-4 w-4" />;
  if (tone === "blocked") return <AlertTriangle className="h-4 w-4" />;
  return <PlayCircle className="h-4 w-4" />;
}

function Section({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "var(--bp-copper)" }}
          >
            {eyebrow}
          </p>
          <h2
            className="text-2xl font-semibold"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}
          >
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PathCopy({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: "var(--bp-surface-inset)",
        border: "1px solid var(--bp-border)",
      }}
    >
      <p
        className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: "var(--bp-ink-muted)" }}
      >
        {label}
      </p>
      <code
        className="block overflow-x-auto whitespace-nowrap text-xs"
        style={{ color: "var(--bp-ink-secondary)", fontFamily: "var(--bp-font-mono)" }}
      >
        {value}
      </code>
    </div>
  );
}

function LaunchReadiness() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bp-canvas)" }}>
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 px-6 py-6 lg:px-8">
        <CompactPageHeader
          eyebrow="Launch readiness"
          title="Handoff status and operating path"
          summary="This page is the operator-facing bridge between the roadmap, source onboarding, real-load verification, Dagster execution, and the final handoff checklist."
          meta="Not handoff-certified until the real smoke receipt and source onboarding loop pass end-to-end."
          facts={[
            { label: "Roadmap", value: "Visible", tone: "positive" },
            { label: "Real smoke", value: "Needs run", tone: "warning" },
            { label: "Handoff", value: "Not certified", tone: "warning" },
          ]}
        />

        <Section eyebrow="Current truth" title="What is actually proven right now">
          <div className="grid gap-3 lg:grid-cols-5">
            {launchGates.map((gate) => (
              <article
                key={gate.label}
                className="rounded-2xl p-4"
                style={{
                  border: "1px solid var(--bp-border)",
                  background: "var(--bp-surface-1)",
                }}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
                    style={toneStyle(gate.tone)}
                  >
                    <GateIcon tone={gate.tone} />
                    {gate.owner}
                  </span>
                </div>
                <h3 className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                  {gate.label}
                </h3>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--bp-ink-secondary)" }}>
                  {gate.summary}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <Section eyebrow="Operator path" title="How a source should move through the system">
            <div className="space-y-3">
              {handoffSteps.map((step) => (
                <div
                  key={step.label}
                  className="group flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center md:justify-between"
                  style={{
                    background: "var(--bp-surface-1)",
                    border: "1px solid var(--bp-border)",
                  }}
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                      {step.label}
                    </h3>
                    <p className="mt-1 text-sm leading-6" style={{ color: "var(--bp-ink-secondary)" }}>
                      {step.detail}
                    </p>
                  </div>
                  {step.link ? (
                    <Link
                      to={step.link}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform group-hover:translate-x-0.5"
                      style={{
                        border: "1px solid var(--bp-border)",
                        color: "var(--bp-copper)",
                        background: "var(--bp-surface-1)",
                      }}
                    >
                      {step.linkLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>

          <Section eyebrow="Evidence package" title="What proves the run was real">
            <div
              className="rounded-2xl p-5"
              style={{
                background: "var(--bp-surface-1)",
                border: "1px solid var(--bp-border)",
              }}
            >
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ background: "var(--bp-copper-light)", color: "var(--bp-copper)" }}
                >
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                    Receipt-first validation
                  </h3>
                  <p className="text-sm" style={{ color: "var(--bp-ink-tertiary)" }}>
                    No screenshot-only success criteria.
                  </p>
                </div>
              </div>
              <ul className="space-y-3">
                {evidenceModel.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6" style={{ color: "var(--bp-ink-secondary)" }}>
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" style={{ color: "var(--bp-operational)" }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        </div>

        <Section
          eyebrow="Next certification step"
          title="Run the real smoke test from a fresh PowerShell"
          action={
            <Link
              to="/load-mission-control"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
              style={{
                background: "var(--bp-copper)",
                color: "white",
                border: "1px solid var(--bp-copper)",
              }}
            >
              <Route className="h-4 w-4" />
              Review Mission Control
            </Link>
          }
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <PathCopy label="Command" value={SMOKE_COMMAND} />
            </div>
            <div
              className="rounded-2xl p-4"
              style={{
                background: "color-mix(in srgb, var(--bp-caution) 6%, #ffffff)",
                border: "1px solid color-mix(in srgb, var(--bp-caution) 24%, var(--bp-border))",
              }}
            >
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--bp-caution)" }}>
                <Terminal className="h-4 w-4" />
                Why this matters
              </div>
              <p className="text-sm leading-6" style={{ color: "var(--bp-ink-secondary)" }}>
                The current Codex process inherited the old socket failure, but a fresh terminal can run Python networking.
                This command is the handoff gate for proving real local/Fabric load behavior.
              </p>
            </div>
          </div>
        </Section>

        <Section eyebrow="Handoff map" title="What IP Corp should own after launch">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                icon: Database,
                title: "Sources",
                detail: "Add, activate, profile, and retire sources without editing code.",
              },
              {
                icon: GitBranch,
                title: "Pipeline designs",
                detail: "Use canvas templates for Landing, Bronze, Silver, and quality gates.",
              },
              {
                icon: ClipboardCheck,
                title: "Verification",
                detail: "Use receipts and Mission Control to prove where the data landed.",
              },
              {
                icon: Wrench,
                title: "Operations",
                detail: "Run smoke tests, inspect failures, and know when Fabric credentials or VPN are required.",
              },
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-2xl p-5"
                style={{
                  background: "var(--bp-surface-1)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                <item.icon className="mb-5 h-5 w-5" style={{ color: "var(--bp-copper)" }} />
                <h3 className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--bp-ink-secondary)" }}>
                  {item.detail}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Section eyebrow="Reference files" title="Where the deeper plan lives">
          <div className="grid gap-4 lg:grid-cols-2">
            <PathCopy label="Launch roadmap" value={ROADMAP_PATH} />
            <PathCopy label="Real-load runbook" value={RUNBOOK_PATH} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/orchestration-story"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
              style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
            >
              <FileText className="h-4 w-4" />
              Demo story
            </Link>
            <Link
              to="/dagster"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
              style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
            >
              <Route className="h-4 w-4" />
              Dagster control room
            </Link>
          </div>
        </Section>
      </div>
    </div>
  );
}

export default LaunchReadiness;
