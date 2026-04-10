import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import type { DigestEntity } from "@/hooks/useEntityDigest";
import { formatTimestamp } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { BrainCircuit, FileSearch, Orbit, ScrollText, Sparkles, WandSparkles } from "lucide-react";

export type CatalogAnalystPromptMode = "overview" | "relationship_story" | "metadata_draft";

export interface CatalogAnalystEvidence {
  id: string;
  kind: string;
  label: string;
  detail: string;
  provenance: {
    type: string;
    sourceRef: string;
    fields: string[];
    layer?: string;
  };
}

export interface CatalogAnalystClaim {
  id: string;
  label: string;
  text: string;
  evidenceIds: string[];
}

export interface CatalogAnalystAction {
  label: string;
  reason: string;
  evidenceIds: string[];
}

export interface CatalogAnalystWarning {
  text: string;
  evidenceIds: string[];
}

export interface CatalogAnalystResponse {
  status: string;
  mode: string;
  promptMode: CatalogAnalystPromptMode;
  generatedAt: string;
  target: {
    entityId: number;
    source: string;
    table: string;
  };
  answer: {
    headline: string;
    claims: CatalogAnalystClaim[];
    metadataDraft: {
      description: string;
      tags: string[];
      evidenceIds: string[];
    };
    actions: CatalogAnalystAction[];
    warnings: CatalogAnalystWarning[];
  };
  evidence: CatalogAnalystEvidence[];
}

interface CatalogAnalystPanelProps {
  selected: DigestEntity | null;
  analysis: CatalogAnalystResponse | null;
  busy: boolean;
  error: string | null;
  activeMode: CatalogAnalystPromptMode;
  onAnalyze: (mode: CatalogAnalystPromptMode) => void;
}

function EvidenceChips({
  evidenceIds,
  activeId,
  onSelect,
}: {
  evidenceIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {evidenceIds.map((id) => (
        <button
          key={id}
          type="button"
          className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
            activeId === id ? "border-[rgba(180,86,36,0.26)] bg-[rgba(180,86,36,0.10)] text-[var(--bp-copper)]" : "border-[rgba(91,84,76,0.12)] bg-[rgba(255,255,255,0.92)] text-[var(--bp-ink-secondary)]",
          )}
          onClick={() => onSelect(id)}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

export function CatalogAnalystPanel({
  selected,
  analysis,
  busy,
  error,
  activeMode,
  onAnalyze,
}: CatalogAnalystPanelProps) {
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);

  const evidenceById = useMemo(
    () => new Map((analysis?.evidence || []).map((item) => [item.id, item])),
    [analysis?.evidence],
  );

  const modes: { id: CatalogAnalystPromptMode; label: string; icon: typeof Sparkles }[] = [
    { id: "overview", label: "Explain asset", icon: Sparkles },
    { id: "relationship_story", label: "Explain neighbors", icon: Orbit },
    { id: "metadata_draft", label: "Draft metadata", icon: ScrollText },
  ];

  const highlighted = activeEvidenceId ? evidenceById.get(activeEvidenceId) : null;

  return (
    <section
      className="rounded-[24px] border"
      style={{
        borderColor: "rgba(91,84,76,0.12)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(244,242,237,0.98) 100%)",
      }}
    >
      <div className="border-b px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
              <BrainCircuit className="h-3.5 w-3.5" />
              AI-native catalog analyst
            </div>
            <h3 className="mt-3 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
              Every statement must cite its source
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
              The analyst drafts explanations and documentation from staged graph evidence plus IP context. Every output below maps back to a provenance ledger.
            </p>
          </div>
          {analysis?.generatedAt ? (
            <div className="rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
              {analysis.mode === "claude_code_cli" ? "Claude Code" : "Fallback"} · {formatTimestamp(analysis.generatedAt, { relative: true })}
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <Button
                key={mode.id}
                variant={activeMode === mode.id ? "default" : "outline"}
                size="sm"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => onAnalyze(mode.id)}
                disabled={!selected || busy}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" />
                {mode.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="p-4">
        {!selected ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
              <FileSearch className="h-7 w-7 gs-float" />
            </div>
            <div>
              <div className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                Select an asset first
              </div>
              <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                Once an asset is focused, the analyst can explain what it appears to be, why its neighbors matter, and draft metadata with traceable evidence.
              </p>
            </div>
          </div>
        ) : busy ? (
          <div className="space-y-3 py-2">
            <div className="rounded-[18px] border px-4 py-4" style={{ borderColor: "rgba(180,86,36,0.14)", background: "rgba(180,86,36,0.05)" }}>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--bp-copper)" }}>
                <WandSparkles className="h-4 w-4 animate-pulse" />
                Building a grounded analyst read for {selected.businessName || selected.tableName}
              </div>
              <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                The response is being constrained to staged evidence and IP context. Nothing is returned without a traceable ledger entry.
              </p>
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-[18px] border"
                style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.74)" }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[20px] border px-4 py-4 text-sm" style={{ borderColor: "rgba(185,58,42,0.22)", background: "rgba(185,58,42,0.06)", color: "var(--bp-fault)" }}>
            {error}
          </div>
        ) : analysis ? (
          <div className="space-y-4">
            <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: "rgba(180,86,36,0.16)", background: "rgba(255,255,255,0.88)" }}>
              <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                Analyst read
              </div>
              <h4 className="mt-2 text-lg" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                {analysis.answer.headline}
              </h4>
              <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                {analysis.mode === "claude_code_cli"
                  ? "Generated through the current Claude Code backend path, constrained to the staged evidence ledger below."
                  : "Claude was unavailable, so the system fell back to deterministic synthesis using the same evidence ledger below."}
              </p>
            </div>

            {analysis.answer.claims.map((claim, index) => (
              <div
                key={claim.id}
                className="rounded-[20px] border px-4 py-4 gs-stagger-card"
                style={{
                  "--i": Math.min(index, 15),
                  borderColor: "rgba(91,84,76,0.10)",
                  background: "rgba(255,255,255,0.88)",
                } as CSSProperties}
              >
                <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  {claim.label}
                </div>
                <p className="mt-2 text-sm" style={{ color: "var(--bp-ink-primary)", lineHeight: 1.7 }}>
                  {claim.text}
                </p>
                <EvidenceChips evidenceIds={claim.evidenceIds} activeId={activeEvidenceId} onSelect={setActiveEvidenceId} />
              </div>
            ))}

            <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
              <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                Draft metadata
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--bp-ink-primary)", lineHeight: 1.7 }}>
                {analysis.answer.metadataDraft.description}
              </p>
              {analysis.answer.metadataDraft.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {analysis.answer.metadataDraft.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full px-2.5 py-1 text-[10px]"
                      style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <EvidenceChips evidenceIds={analysis.answer.metadataDraft.evidenceIds} activeId={activeEvidenceId} onSelect={setActiveEvidenceId} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
                <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  Recommended actions
                </div>
                <div className="mt-3 space-y-3">
                  {analysis.answer.actions.map((action) => (
                    <div key={action.label} className="rounded-[16px] border px-3 py-3" style={{ borderColor: "rgba(180,86,36,0.12)", background: "rgba(180,86,36,0.04)" }}>
                      <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{action.label}</div>
                      <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>{action.reason}</p>
                      <EvidenceChips evidenceIds={action.evidenceIds} activeId={activeEvidenceId} onSelect={setActiveEvidenceId} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
                <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  Warnings
                </div>
                <div className="mt-3 space-y-3">
                  {analysis.answer.warnings.length > 0 ? analysis.answer.warnings.map((warning) => (
                    <div key={warning.text} className="rounded-[16px] border px-3 py-3" style={{ borderColor: "rgba(185,58,42,0.16)", background: "rgba(185,58,42,0.04)" }}>
                      <p className="text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>{warning.text}</p>
                      <EvidenceChips evidenceIds={warning.evidenceIds} activeId={activeEvidenceId} onSelect={setActiveEvidenceId} />
                    </div>
                  )) : (
                    <p className="text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                      No extra caution flags were necessary for this read.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                    Provenance ledger
                  </div>
                  <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                    Every AI statement above references one or more ledger entries here.
                  </p>
                </div>
                {highlighted ? (
                  <div className="rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
                    Focused: {highlighted.id}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 space-y-2.5">
                {analysis.evidence.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full rounded-[18px] border px-3 py-3 text-left transition-colors"
                    style={{
                      borderColor: activeEvidenceId === item.id ? "rgba(180,86,36,0.20)" : "rgba(91,84,76,0.10)",
                      background: activeEvidenceId === item.id ? "rgba(180,86,36,0.06)" : "rgba(255,255,255,0.92)",
                    }}
                    onClick={() => setActiveEvidenceId(item.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
                            {item.id}
                          </span>
                          <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                            {item.label}
                          </div>
                        </div>
                        <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                          {item.detail}
                        </p>
                      </div>
                      <span className="rounded-full px-2 py-1 text-[10px]" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
                        {item.kind.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div style={{ color: "var(--bp-ink-secondary)" }}>
                        <span style={{ color: "var(--bp-ink-tertiary)" }}>Source</span>
                        <div className="mt-1 break-all" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>
                          {item.provenance.sourceRef}
                        </div>
                      </div>
                      <div style={{ color: "var(--bp-ink-secondary)" }}>
                        <span style={{ color: "var(--bp-ink-tertiary)" }}>Fields</span>
                        <div className="mt-1 break-all" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>
                          {item.provenance.fields.join(", ") || "n/a"}
                          {item.provenance.layer ? ` · ${item.provenance.layer}` : ""}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", color: "var(--bp-ink-secondary)" }}>
            Select one of the analyst lenses above to generate a grounded read for {selected.businessName || selected.tableName}.
          </div>
        )}
      </div>
    </section>
  );
}
