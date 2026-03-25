import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Loader2,
  AlertTriangle,
  Layers,
  Hash,
  ToggleLeft,
  ToggleRight,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import EntitySelector from "@/components/EntitySelector";

// ============================================================================
// TYPES
// ============================================================================

const API = import.meta.env.VITE_API_URL || "";

interface ParamSchema {
  type: "text" | "select" | "number" | "json";
  options?: string[];
  placeholder?: string;
}

interface RuleTypeInfo {
  description: string;
  params: Record<string, ParamSchema>;
}

interface CleansingRule {
  id: number;
  entityId: number;
  columnName: string;
  ruleType: string;
  parameters: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SummaryData {
  totalRules: number;
  activeRules: number;
  entitiesWithRules: number;
  topRuleTypes: { ruleType: string; count: number }[];
}

interface RuleFormData {
  columnName: string;
  ruleType: string;
  parameters: Record<string, unknown>;
  priority: number;
  isActive: boolean;
}

const EMPTY_FORM: RuleFormData = {
  columnName: "",
  ruleType: "",
  parameters: {},
  priority: 0,
  isActive: true,
};

// ============================================================================
// INLINE STYLES (scoped CSS-in-JS for animations)
// ============================================================================

const injectStyles = (() => {
  let injected = false;
  return () => {
    if (injected) return;
    injected = true;
    const style = document.createElement("style");
    style.textContent = `
      @keyframes cre-fadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes cre-slideInRight {
        from { opacity: 0; transform: translateX(12px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes cre-shimmer {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
      .cre-fade-in {
        animation: cre-fadeIn 0.3s var(--ease-claude, ease-out) both;
      }
      .cre-slide-right {
        animation: cre-slideInRight 0.3s var(--ease-claude, ease-out) both;
      }
      .cre-shimmer {
        animation: cre-shimmer 2.4s ease-in-out infinite;
      }
      .cre-field:focus {
        border-color: var(--bp-copper) !important;
        outline: none;
      }
      .cre-inactive-overlay {
        position: relative;
      }
      .cre-inactive-overlay::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background: repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 6px,
          rgba(0,0,0,0.025) 6px,
          rgba(0,0,0,0.025) 7px
        );
      }
    `;
    document.head.appendChild(style);
  };
})();

// ============================================================================
// API HELPERS
// ============================================================================

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const body = await resp.text();
    let msg = `HTTP ${resp.status}`;
    try {
      const parsed = JSON.parse(body);
      msg = parsed.error || parsed.detail || msg;
    } catch { /* use default */ }
    throw new Error(msg);
  }
  return resp.json();
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CleansingRuleEditor() {
  // Inject animation styles once
  useEffect(() => { injectStyles(); }, []);

  // -- Entity digest --
  const { allEntities, loading: digestLoading } = useEntityDigest();

  // Filter to entities with Silver layer active
  const silverEntities = useMemo(
    () => allEntities.filter((e) => e.silverId !== null),
    [allEntities],
  );

  // -- State --
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [rules, setRules] = useState<CleansingRule[]>([]);
  const [ruleTypes, setRuleTypes] = useState<Record<string, RuleTypeInfo>>({});
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RuleFormData>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // -- Load rule types + summary on mount --
  useEffect(() => {
    fetchJSON<Record<string, RuleTypeInfo>>(`${API}/api/cleansing/functions`)
      .then(setRuleTypes)
      .catch(() => {});
    fetchJSON<SummaryData>(`${API}/api/cleansing/summary`)
      .then(setSummary)
      .catch(() => {});
  }, []);

  // -- Load rules when entity changes --
  const loadRules = useCallback(async (entityId: string) => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const data = await fetchJSON<CleansingRule[]>(
        `${API}/api/cleansing/rules?entity_id=${entityId}`,
      );
      setRules(data);
    } catch (e: unknown) {
      setRulesError(e instanceof Error ? e.message : "Failed to load rules");
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedEntityId) {
      loadRules(selectedEntityId);
    } else {
      setRules([]);
    }
  }, [selectedEntityId, loadRules]);

  // Refresh summary after mutations
  const refreshSummary = useCallback(() => {
    fetchJSON<SummaryData>(`${API}/api/cleansing/summary`)
      .then(setSummary)
      .catch(() => {});
  }, []);

  // -- Selected entity info --
  const selectedEntity: DigestEntity | undefined = useMemo(
    () => silverEntities.find((e) => String(e.id) === selectedEntityId),
    [silverEntities, selectedEntityId],
  );

  // -- Form handlers --
  const openNewRuleForm = () => {
    setEditingRuleId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
    setSaveError(null);
  };

  const openEditForm = (rule: CleansingRule) => {
    setEditingRuleId(rule.id);
    setForm({
      columnName: rule.columnName,
      ruleType: rule.ruleType,
      parameters: { ...rule.parameters },
      priority: rule.priority,
      isActive: rule.isActive,
    });
    setShowForm(true);
    setSaveError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingRuleId(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!selectedEntityId) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editingRuleId !== null) {
        await fetchJSON(`${API}/api/cleansing/rules/${editingRuleId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            column_name: form.columnName,
            rule_type: form.ruleType,
            parameters: form.parameters,
            priority: form.priority,
            is_active: form.isActive,
          }),
        });
      } else {
        await fetchJSON(`${API}/api/cleansing/rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_id: parseInt(selectedEntityId),
            column_name: form.columnName,
            rule_type: form.ruleType,
            parameters: form.parameters,
            priority: form.priority,
          }),
        });
      }
      closeForm();
      loadRules(selectedEntityId);
      refreshSummary();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: number) => {
    if (!selectedEntityId) return;
    try {
      await fetchJSON(`${API}/api/cleansing/rules/${ruleId}`, {
        method: "DELETE",
      });
      loadRules(selectedEntityId);
      refreshSummary();
    } catch {
      // silent — rule card will remain
    }
  };

  const handleToggleActive = async (rule: CleansingRule) => {
    try {
      await fetchJSON(`${API}/api/cleansing/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !rule.isActive }),
      });
      if (selectedEntityId) loadRules(selectedEntityId);
      refreshSummary();
    } catch {
      // silent
    }
  };

  // -- JSON preview --
  const jsonPreview = useMemo(() => {
    const activeRules = rules.filter((r) => r.isActive);
    return JSON.stringify(
      activeRules.map((r) => ({
        column: r.columnName,
        function: r.ruleType,
        params: r.parameters,
      })),
      null,
      2,
    );
  }, [rules]);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(jsonPreview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // -- Param schema for selected rule type --
  const activeParamSchema = ruleTypes[form.ruleType]?.params || {};

  // Reset parameters when rule type changes
  const handleRuleTypeChange = (newType: string) => {
    const schema = ruleTypes[newType]?.params || {};
    const defaults: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(schema)) {
      if (spec.type === "select" && spec.options?.length) {
        defaults[key] = spec.options[0];
      } else if (spec.type === "number") {
        defaults[key] = "";
      } else if (spec.type === "json") {
        defaults[key] = "{}";
      } else {
        defaults[key] = "";
      }
    }
    setForm((prev) => ({ ...prev, ruleType: newType, parameters: defaults }));
  };

  const updateParam = (key: string, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      parameters: { ...prev.parameters, [key]: value },
    }));
  };

  // -- JSON with line numbers --
  const jsonLines = useMemo(() => jsonPreview.split("\n"), [jsonPreview]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6 px-8 py-8 max-w-[1400px] mx-auto cre-fade-in">
      {/* -- Header -- */}
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" style={{ color: "var(--bp-copper)" }} />
          <h1
            style={{
              fontFamily: "var(--bp-font-display)",
              fontSize: 32,
              color: "var(--bp-ink-primary)",
            }}
            className="font-semibold tracking-tight"
          >
            Cleansing Rule Editor
          </h1>
          <span
            className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
            style={{
              background: "var(--bp-copper-light)",
              color: "var(--bp-copper)",
              border: "1px solid rgba(180,86,36,0.15)",
            }}
          >
            Labs
          </span>
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
          Configure JSON cleansing rules applied during Bronze &rarr; Silver
          transformation
        </p>
      </div>

      {/* -- Summary Strip: Workbench Gauge Panel -- */}
      {summary && (
        <div
          className="flex items-center gap-3 rounded-lg overflow-hidden"
          style={{
            background: "var(--bp-surface-1)",
            border: "1px solid var(--bp-border)",
          }}
        >
          <SummaryKPI
            label="Total Rules"
            value={summary.totalRules}
            railColor="var(--bp-copper)"
          />
          <SummaryKPI
            label="Active"
            value={summary.activeRules}
            railColor="var(--bp-operational)"
          />
          <SummaryKPI
            label="Entities with Rules"
            value={summary.entitiesWithRules}
            railColor="var(--bp-ink-muted)"
          />
          {summary.topRuleTypes.length > 0 && (
            <div className="flex items-center gap-2 ml-auto pr-5">
              <span
                className="text-[10px] uppercase tracking-wider font-medium"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                Top type:
              </span>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  background: "var(--bp-copper-light)",
                  color: "var(--bp-copper)",
                  border: "1px solid rgba(180,86,36,0.12)",
                }}
              >
                {summary.topRuleTypes[0].ruleType}
              </span>
            </div>
          )}
        </div>
      )}

      {/* -- Entity Selector -- */}
      <div>
        <label
          className="text-xs font-medium uppercase tracking-wider mb-2 block"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          Select Silver Entity
        </label>
        <EntitySelector
          entities={silverEntities}
          selectedId={selectedEntityId}
          onSelect={setSelectedEntityId}
          onClear={() => {
            setSelectedEntityId(null);
            setRules([]);
            closeForm();
          }}
          loading={digestLoading}
          placeholder="Search Silver entities..."
        />
      </div>

      {/* -- No entity selected -- */}
      {!selectedEntityId && (
        <div
          className="flex flex-col items-center justify-center py-20 text-center rounded-lg"
          style={{
            background: "var(--bp-surface-1)",
            border: "1px solid var(--bp-border)",
          }}
        >
          <Layers
            className="w-10 h-10 mb-4"
            style={{ color: "var(--bp-ink-muted)" }}
          />
          <p
            className="text-sm font-medium mb-1"
            style={{ color: "var(--bp-ink-secondary)" }}
          >
            No entity selected
          </p>
          <p className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
            Choose a Silver entity above to view and manage its cleansing rules
          </p>
        </div>
      )}

      {/* -- Rules section -- */}
      {selectedEntityId && (
        <div className="space-y-4">
          {/* Entity info + Add button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {selectedEntity && (
                <>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: "var(--bp-copper-light)",
                      color: "var(--bp-copper)",
                      border: "1px solid rgba(180,86,36,0.15)",
                    }}
                  >
                    {selectedEntity.source}
                  </span>
                  <span
                    className="text-sm font-mono"
                    style={{ color: "var(--bp-ink-primary)" }}
                  >
                    {selectedEntity.sourceSchema}.{selectedEntity.tableName}
                  </span>
                </>
              )}
              <span
                className="text-xs"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                {rules.length} rule{rules.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              onClick={openNewRuleForm}
              disabled={showForm}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                showForm
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:opacity-90 cursor-pointer",
              )}
              style={{
                background: "var(--bp-copper)",
                color: "white",
              }}
              aria-label="Add new cleansing rule"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Rule
            </button>
          </div>

          {/* Loading */}
          {rulesLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2
                className="w-5 h-5 animate-spin"
                style={{ color: "var(--bp-copper)" }}
              />
              <span
                className="ml-2 text-sm"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                Loading rules...
              </span>
            </div>
          )}

          {/* Error */}
          {rulesError && (
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm"
              style={{
                background: "rgba(185,58,42,0.06)",
                color: "var(--bp-fault)",
                borderLeft: "3px solid var(--bp-fault)",
                border: "1px solid rgba(185,58,42,0.15)",
              }}
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {rulesError}
            </div>
          )}

          {/* Rule Editor Form */}
          {showForm && (
            <RuleForm
              form={form}
              setForm={setForm}
              ruleTypes={ruleTypes}
              activeParamSchema={activeParamSchema}
              onRuleTypeChange={handleRuleTypeChange}
              onUpdateParam={updateParam}
              onSave={handleSave}
              onCancel={closeForm}
              saving={saving}
              saveError={saveError}
              isEditing={editingRuleId !== null}
            />
          )}

          {/* Empty State */}
          {!rulesLoading && !rulesError && rules.length === 0 && !showForm && (
            <div
              className="flex flex-col items-center justify-center py-16 text-center rounded-lg"
              style={{
                background: "var(--bp-surface-1)",
                border: "1px dashed var(--bp-border)",
              }}
            >
              <Sparkles
                className="w-8 h-8 mb-3 cre-shimmer"
                style={{ color: "var(--bp-ink-muted)" }}
              />
              <p
                className="text-sm font-medium mb-1"
                style={{ color: "var(--bp-ink-secondary)" }}
              >
                No cleansing rules yet
              </p>
              <p
                className="text-xs mb-4"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                Add your first rule to clean this entity during Bronze &rarr;
                Silver transformation
              </p>
              <button
                onClick={openNewRuleForm}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium hover:opacity-90 transition-colors cursor-pointer"
                style={{ background: "var(--bp-copper)", color: "white" }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add First Rule
              </button>
            </div>
          )}

          {/* Rule List */}
          {!rulesLoading &&
            rules.length > 0 && (
              <div className="space-y-2">
                {rules.map((rule, idx) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    ruleTypes={ruleTypes}
                    onEdit={() => openEditForm(rule)}
                    onDelete={() => handleDelete(rule.id)}
                    onToggle={() => handleToggleActive(rule)}
                    isEditing={editingRuleId === rule.id}
                    staggerIndex={idx}
                  />
                ))}
              </div>
            )}

          {/* JSON Preview */}
          {rules.length > 0 && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--bp-border)" }}
            >
              <button
                onClick={() => setJsonExpanded(!jsonExpanded)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:opacity-80"
                style={{ background: "var(--bp-surface-1)" }}
                aria-expanded={jsonExpanded}
                aria-controls="json-preview-content"
              >
                <div className="flex items-center gap-2">
                  {jsonExpanded ? (
                    <ChevronDown
                      className="w-3.5 h-3.5"
                      style={{ color: "var(--bp-ink-muted)" }}
                    />
                  ) : (
                    <ChevronRight
                      className="w-3.5 h-3.5"
                      style={{ color: "var(--bp-ink-muted)" }}
                    />
                  )}
                  <Code2
                    className="w-3.5 h-3.5"
                    style={{ color: "var(--bp-copper)" }}
                  />
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--bp-ink-secondary)" }}
                  >
                    JSON Preview
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--bp-ink-muted)" }}
                  >
                    (active rules as notebook input)
                  </span>
                </div>
                {jsonExpanded && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyJson();
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium hover:opacity-80 transition-colors"
                    style={{
                      background: "rgba(255,255,255,0.12)",
                      color: "#E0DDD6",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                    aria-label="Copy JSON to clipboard"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copy
                      </>
                    )}
                  </button>
                )}
              </button>
              {jsonExpanded && (
                <div
                  id="json-preview-content"
                  className="overflow-x-auto"
                  style={{
                    background: "var(--bp-code-block)",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <table
                    className="w-full text-xs"
                    style={{ fontFamily: "var(--bp-font-mono)" }}
                  >
                    <tbody>
                      {jsonLines.map((line, i) => (
                        <tr key={i}>
                          <td
                            className="select-none text-right pr-4 pl-4 py-0"
                            style={{
                              color: "rgba(224,221,214,0.25)",
                              width: "3rem",
                              userSelect: "none",
                              verticalAlign: "top",
                              lineHeight: "1.6",
                            }}
                          >
                            {i + 1}
                          </td>
                          <td
                            className="pr-4 py-0"
                            style={{
                              color: "#E0DDD6",
                              whiteSpace: "pre",
                              lineHeight: "1.6",
                            }}
                          >
                            {line}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ height: 8 }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SummaryKPI({
  label,
  value,
  railColor,
}: {
  label: string;
  value: number;
  railColor: string;
}) {
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3"
      style={{
        borderLeft: `3px solid ${railColor}`,
      }}
    >
      <span
        className="text-lg font-semibold tabular-nums"
        style={{ color: "var(--bp-ink-primary)" }}
      >
        {value}
      </span>
      <span
        className="text-[10px] uppercase tracking-wider font-medium"
        style={{ color: "var(--bp-ink-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

function RuleCard({
  rule,
  ruleTypes,
  onEdit,
  onDelete,
  onToggle,
  isEditing,
  staggerIndex,
}: {
  rule: CleansingRule;
  ruleTypes: Record<string, RuleTypeInfo>;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  isEditing: boolean;
  staggerIndex: number;
}) {
  const typeInfo = ruleTypes[rule.ruleType];
  const paramEntries = Object.entries(rule.parameters).filter(
    ([, v]) => v !== "" && v !== null && v !== undefined,
  );

  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden transition-all",
        !rule.isActive && "cre-inactive-overlay",
        isEditing && "ring-2 ring-[var(--bp-copper)]/30",
      )}
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
        opacity: rule.isActive ? 1 : 0.55,
        animation: `cre-fadeIn 0.3s var(--ease-claude, ease-out) ${staggerIndex * 40}ms both`,
      }}
    >
      <div className="flex">
        {/* Status rail */}
        <div
          className="flex-shrink-0"
          style={{
            width: 3,
            background: rule.isActive ? "var(--bp-operational)" : "var(--bp-border-strong)",
          }}
        />

        <div className="flex-1 min-w-0 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1.5">
              {/* Row 1: column + rule type + priority */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-sm font-medium"
                  style={{
                    color: "var(--bp-ink-primary)",
                    fontFamily: "var(--bp-font-mono)",
                  }}
                >
                  {rule.columnName}
                </span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{
                    background: "var(--bp-copper-light)",
                    color: "var(--bp-copper)",
                    border: "1px solid rgba(180,86,36,0.18)",
                    fontSize: 10,
                  }}
                >
                  {rule.ruleType}
                </span>
                {typeInfo && (
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--bp-ink-muted)" }}
                  >
                    {typeInfo.description}
                  </span>
                )}
                <div className="flex items-center gap-1.5 ml-auto">
                  {/* Priority badge */}
                  <span
                    className="inline-flex items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
                    style={{
                      width: 20,
                      height: 20,
                      background: "var(--bp-copper)",
                      color: "white",
                      lineHeight: 1,
                    }}
                  >
                    {rule.priority}
                  </span>
                </div>
              </div>

              {/* Row 2: parameters */}
              {paramEntries.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  {paramEntries.map(([key, val]) => (
                    <div key={key} className="flex items-center gap-1">
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: "var(--bp-ink-muted)" }}
                      >
                        {key}:
                      </span>
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded"
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          background: "var(--bp-surface-inset)",
                          color: "var(--bp-ink-secondary)",
                        }}
                      >
                        {typeof val === "object"
                          ? JSON.stringify(val)
                          : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={onToggle}
                className="p-1.5 rounded hover:bg-black/5 transition-colors"
                aria-label={rule.isActive ? "Deactivate rule" : "Activate rule"}
                title={rule.isActive ? "Active" : "Inactive"}
              >
                {rule.isActive ? (
                  <ToggleRight
                    className="w-4 h-4"
                    style={{ color: "var(--bp-copper)" }}
                  />
                ) : (
                  <ToggleLeft
                    className="w-4 h-4"
                    style={{ color: "var(--bp-ink-muted)" }}
                  />
                )}
              </button>
              <button
                onClick={onEdit}
                className="p-1.5 rounded hover:bg-black/5 transition-colors"
                aria-label="Edit rule"
              >
                <Pencil
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--bp-ink-muted)" }}
                />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-black/5 transition-colors"
                aria-label="Delete rule"
              >
                <Trash2
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--bp-fault)" }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleForm({
  form,
  setForm,
  ruleTypes,
  activeParamSchema,
  onRuleTypeChange,
  onUpdateParam,
  onSave,
  onCancel,
  saving,
  saveError,
  isEditing,
}: {
  form: RuleFormData;
  setForm: React.Dispatch<React.SetStateAction<RuleFormData>>;
  ruleTypes: Record<string, RuleTypeInfo>;
  activeParamSchema: Record<string, ParamSchema>;
  onRuleTypeChange: (type: string) => void;
  onUpdateParam: (key: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
  isEditing: boolean;
}) {
  const canSave =
    form.columnName.trim() !== "" && form.ruleType !== "" && !saving;

  return (
    <div
      className="rounded-lg overflow-hidden cre-slide-right"
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
      }}
    >
      <div className="flex">
        {/* Copper status rail */}
        <div
          className="flex-shrink-0"
          style={{
            width: 3,
            background: "var(--bp-copper)",
          }}
        />

        <div
          className="flex-1 px-5 py-4 space-y-4"
          style={{ background: "var(--bp-surface-inset)" }}
        >
          <div className="flex items-center justify-between">
            <h3
              className="font-semibold"
              style={{
                fontFamily: "var(--bp-font-display)",
                fontSize: 18,
                color: "var(--bp-ink-primary)",
              }}
            >
              {isEditing ? "Edit Rule" : "New Rule"}
            </h3>
            <button
              onClick={onCancel}
              className="p-1 rounded hover:bg-black/5 transition-colors"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" style={{ color: "var(--bp-ink-muted)" }} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Column Name */}
            <FormField label="Column Name">
              <input
                type="text"
                value={form.columnName}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, columnName: e.target.value }))
                }
                placeholder="e.g. MMITDS or * for entity-level"
                className="cre-field w-full px-3 py-2 rounded-md text-sm bg-transparent"
                style={{
                  border: "1px solid var(--bp-border)",
                  color: "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-mono)",
                }}
              />
            </FormField>

            {/* Rule Type */}
            <FormField label="Rule Type">
              <select
                value={form.ruleType}
                onChange={(e) => onRuleTypeChange(e.target.value)}
                className="cre-field w-full px-3 py-2 rounded-md text-sm bg-transparent cursor-pointer appearance-none"
                style={{
                  border: "1px solid var(--bp-border)",
                  color: form.ruleType
                    ? "var(--bp-ink-primary)"
                    : "var(--bp-ink-muted)",
                }}
                aria-label="Select rule type"
              >
                <option value="">Select type...</option>
                {Object.entries(ruleTypes).map(([key, info]) => (
                  <option key={key} value={key}>
                    {key} — {info.description}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Priority */}
            <FormField label="Priority">
              <input
                type="number"
                value={form.priority}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    priority: parseInt(e.target.value) || 0,
                  }))
                }
                className="cre-field w-full px-3 py-2 rounded-md text-sm bg-transparent"
                style={{
                  border: "1px solid var(--bp-border)",
                  color: "var(--bp-ink-primary)",
                }}
                min={0}
              />
            </FormField>

            {/* Active */}
            <FormField label="Active">
              <button
                onClick={() =>
                  setForm((prev) => ({ ...prev, isActive: !prev.isActive }))
                }
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full"
                style={{
                  border: "1px solid var(--bp-border)",
                  color: "var(--bp-ink-primary)",
                }}
                type="button"
              >
                {form.isActive ? (
                  <ToggleRight
                    className="w-4 h-4"
                    style={{ color: "var(--bp-copper)" }}
                  />
                ) : (
                  <ToggleLeft
                    className="w-4 h-4"
                    style={{ color: "var(--bp-ink-muted)" }}
                  />
                )}
                {form.isActive ? "Yes" : "No"}
              </button>
            </FormField>
          </div>

          {/* Dynamic Parameter Fields */}
          {Object.keys(activeParamSchema).length > 0 && (
            <div>
              <div
                className="flex items-center gap-3 mb-3 pt-1"
                style={{ borderTop: "1px solid var(--bp-border-subtle)" }}
              >
                <span
                  className="text-[9px] font-bold uppercase tracking-[0.12em] pt-3"
                  style={{ color: "var(--bp-ink-muted)" }}
                >
                  Parameters
                </span>
                <div
                  className="flex-1 mt-3"
                  style={{
                    height: 1,
                    background: "var(--bp-border-subtle)",
                  }}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(activeParamSchema).map(([key, spec]) => (
                  <FormField key={key} label={key}>
                    {spec.type === "select" ? (
                      <select
                        value={String(form.parameters[key] ?? "")}
                        onChange={(e) => onUpdateParam(key, e.target.value)}
                        className="cre-field w-full px-3 py-2 rounded-md text-sm bg-transparent cursor-pointer appearance-none"
                        style={{
                          border: "1px solid var(--bp-border)",
                          color: "var(--bp-ink-primary)",
                        }}
                        aria-label={`Parameter: ${key}`}
                      >
                        {spec.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : spec.type === "number" ? (
                      <input
                        type="number"
                        value={String(form.parameters[key] ?? "")}
                        onChange={(e) =>
                          onUpdateParam(
                            key,
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder={spec.placeholder}
                        className="cre-field w-full px-3 py-2 rounded-md text-sm bg-transparent"
                        style={{
                          border: "1px solid var(--bp-border)",
                          color: "var(--bp-ink-primary)",
                        }}
                      />
                    ) : spec.type === "json" ? (
                      <textarea
                        value={
                          typeof form.parameters[key] === "string"
                            ? (form.parameters[key] as string)
                            : JSON.stringify(form.parameters[key] ?? {}, null, 2)
                        }
                        onChange={(e) => {
                          try {
                            onUpdateParam(key, JSON.parse(e.target.value));
                          } catch {
                            onUpdateParam(key, e.target.value);
                          }
                        }}
                        rows={3}
                        placeholder='{"key": "value"}'
                        className="cre-field w-full px-3 py-2 rounded-md text-xs bg-transparent resize-y"
                        style={{
                          border: "1px solid var(--bp-border)",
                          color: "var(--bp-ink-primary)",
                          fontFamily: "var(--bp-font-mono)",
                        }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(form.parameters[key] ?? "")}
                        onChange={(e) => onUpdateParam(key, e.target.value)}
                        placeholder={spec.placeholder}
                        className="cre-field w-full px-3 py-2 rounded-md text-sm bg-transparent"
                        style={{
                          border: "1px solid var(--bp-border)",
                          color: "var(--bp-ink-primary)",
                        }}
                      />
                    )}
                  </FormField>
                ))}
              </div>
            </div>
          )}

          {/* Save error */}
          {saveError && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded text-xs"
              style={{
                background: "rgba(185,58,42,0.06)",
                color: "var(--bp-fault)",
                borderLeft: "3px solid var(--bp-fault)",
                border: "1px solid rgba(185,58,42,0.15)",
              }}
              role="alert"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onSave}
              disabled={!canSave}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors",
                canSave
                  ? "hover:opacity-90 cursor-pointer"
                  : "opacity-50 cursor-not-allowed",
              )}
              style={{ background: "var(--bp-copper)", color: "white" }}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {isEditing ? "Update Rule" : "Create Rule"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-md text-xs font-medium transition-colors hover:bg-black/5"
              style={{ color: "var(--bp-ink-secondary)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="text-[10px] font-medium uppercase tracking-wider mb-1 block"
        style={{ color: "var(--bp-ink-muted)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
