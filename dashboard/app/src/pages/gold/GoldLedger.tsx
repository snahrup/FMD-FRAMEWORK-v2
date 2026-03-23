// ============================================================================
// Gold Ledger — Home base of Gold Studio. Specimen list, entity view, import.
//
// Design system: Industrial Precision, Light Mode
// Fonts: Instrument Serif (display), Outfit (body), JetBrains Mono (data)
// All styles use BP CSS custom properties (--bp-*)
// Data: /api/gold-studio/stats, /api/gold-studio/specimens
// ============================================================================

import { useState, useEffect, useMemo, useCallback, useRef, type ChangeEvent } from "react";
import { Upload, Code2, FolderUp, ChevronDown, Search, X, FileSpreadsheet, StickyNote } from "lucide-react";
import { GoldStudioLayout, StatsStrip, GoldLoading, GoldEmpty, GoldNoResults } from "@/components/gold";
import { SpecimenCard } from "@/components/gold/SpecimenCard";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface GoldStats {
  specimens: number;
  tables_extracted: number;
  columns_cataloged: number;
  unresolved_clusters: number;
  canonical_approved: number;
  gold_specs: number;
  certification_rate: number;
}

interface Specimen {
  id: number;
  name: string;
  type: string;
  division: string;
  source_system: string | null;
  steward: string;
  description: string | null;
  job_state: string;
  tags: string | null;
  created_at: string;
  entity_count?: number;
  column_count?: number;
  provenance_phase?: number;
  source_class?: string;
}

interface ExtractedEntity {
  id: number;
  entity_name: string;
  specimen_name?: string;
  source_database: string | null;
  column_count: number;
  provenance: string;
  cluster_id: number | null;
}

interface SpecimenDetail {
  entities: Array<{
    id: number;
    entity_name: string;
    source_database: string | null;
    column_count: number;
    provenance: string;
    cluster_id: number | null;
  }>;
  queries: Array<{
    id: number;
    query_name: string | null;
    query_text: string;
    query_type: string;
    source_database: string | null;
  }>;
}

// ── Modal types ──

type ModalType = "upload" | "paste" | "bulk" | "supporting" | "contextual" | null;

// ── Import Action Button ──

function ImportDropdown({ onSelect }: { onSelect: (type: ModalType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bp-btn-primary inline-flex items-center gap-1.5"
        style={{ fontSize: 13, padding: "6px 14px" }}
      >
        Import
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg py-1 z-20"
          style={{
            background: "var(--bp-surface-1)",
            border: "1px solid var(--bp-border-strong)",
            minWidth: 180,
          }}
        >
          {[
            { type: "upload" as const, icon: Upload, label: "Upload File" },
            { type: "paste" as const, icon: Code2, label: "Paste SQL" },
            { type: "bulk" as const, icon: FolderUp, label: "Bulk Import" },
          ].map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => { setOpen(false); onSelect(item.type); }}
              className="flex items-center gap-2.5 w-full px-4 py-2 text-left transition-colors hover:bg-black/[0.03]"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                color: "var(--bp-ink-primary)",
              }}
            >
              <item.icon size={15} style={{ color: "var(--bp-ink-muted)" }} />
              {item.label}
            </button>
          ))}
          <div style={{ height: 1, background: "var(--bp-border)", margin: "4px 0" }} />
          {[
            { type: "supporting" as const, icon: FileSpreadsheet, label: "Supporting Evidence" },
            { type: "contextual" as const, icon: StickyNote, label: "Contextual Note" },
          ].map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => { setOpen(false); onSelect(item.type); }}
              className="flex items-center gap-2.5 w-full px-4 py-2 text-left transition-colors hover:bg-black/[0.03]"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                color: "var(--bp-ink-primary)",
              }}
            >
              <item.icon size={15} style={{ color: "var(--bp-ink-muted)" }} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Upload File Modal ──

function UploadFileModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const [name, setName] = useState("");
  const [division, setDivision] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [steward, setSteward] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleSubmit = async () => {
    if (!file || !division || !steward) return;
    setSubmitting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name || file.name.replace(/\.[^.]+$/, ""));
      formData.append("division", division);
      if (sourceSystem) formData.append("source_system", sourceSystem);
      formData.append("steward", steward);
      if (description) formData.append("description", description);
      if (tags) formData.append("tags", tags);
      const res = await fetch(`${API}/api/gold-studio/specimens`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      if (created?.id) {
        fetch(`${API}/api/gold-studio/specimens/${created.id}/extract`, { method: "POST" }).catch(() => {});
      }
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Upload File" onClose={onClose}>
      {/* Dropzone */}
      <label
        className="flex flex-col items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-black/[0.02]"
        style={{
          border: "2px dashed var(--bp-border-strong)",
          padding: "32px 20px",
          marginBottom: 16,
        }}
      >
        <Upload size={24} style={{ color: "var(--bp-ink-muted)", marginBottom: 8 }} />
        <span style={{ fontSize: 13, color: "var(--bp-ink-secondary)", marginBottom: 2 }}>
          {file ? file.name : "Drop .rdl, .pbix, or .bim file here"}
        </span>
        <span style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}>
          or click to browse
        </span>
        <input
          type="file"
          accept=".rdl,.pbix,.bim"
          onChange={handleFile}
          className="hidden"
        />
      </label>

      <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", marginBottom: 12, letterSpacing: "0.03em" }}>
        Source class: <strong style={{ color: "var(--bp-ink-secondary)" }}>Structural</strong> — parser-driven extraction
      </div>

      <FormField label="Name" value={name} onChange={setName} placeholder="Auto-filled from filename" />
      <FormField label="Division" value={division} onChange={setDivision} required />
      <FormField label="Source System" value={sourceSystem} onChange={setSourceSystem} />
      <FormField label="Steward" value={steward} onChange={setSteward} required />
      <FormField label="Description" value={description} onChange={setDescription} multiline />
      <FormField label="Tags" value={tags} onChange={setTags} placeholder="Comma-separated" />

      {error && <p style={{ color: "var(--bp-fault-red)", fontSize: 12, marginTop: 8, fontFamily: "var(--bp-font-body)" }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="bp-btn-secondary" style={{ fontSize: 13, padding: "6px 14px" }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!file || !division || !steward || submitting}
          className="bp-btn-primary"
          style={{ fontSize: 13, padding: "6px 14px", opacity: (!file || !division || !steward || submitting) ? 0.5 : 1 }}
        >
          {submitting ? "Uploading..." : "Upload"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Paste SQL Modal ──

function PasteSqlModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const [queryName, setQueryName] = useState("");
  const [queryText, setQueryText] = useState("");
  const [sourceDb, setSourceDb] = useState("");
  const [division, setDivision] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [steward, setSteward] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!queryName || !queryText) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/gold-studio/specimens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: queryName,
          type: "sql",
          query_text: queryText,
          source_database: sourceDb || null,
          division: division || "General",
          source_system: sourceSystem || null,
          steward: steward || "Unknown",
          description: description || null,
          tags: tags || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Auto-trigger extraction so specimen doesn't sit at "queued"
      const created = await res.json();
      if (created?.id) {
        fetch(`${API}/api/gold-studio/specimens/${created.id}/extract`, { method: "POST" }).catch(() => {});
      }
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Paste SQL" onClose={onClose} wide>
      <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", marginBottom: 12, letterSpacing: "0.03em" }}>
        Source class: <strong style={{ color: "var(--bp-ink-secondary)" }}>Structural</strong> — SQL will be parsed for entities
      </div>
      {/* SQL editor area */}
      <div className="mb-4">
        <label
          style={{
            display: "block",
            fontFamily: "var(--bp-font-body)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--bp-ink-secondary)",
            marginBottom: 4,
          }}
        >
          SQL Query *
        </label>
        <textarea
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="SELECT ..."
          className="w-full rounded-md resize-none"
          style={{
            background: "var(--bp-code-block)",
            color: "var(--bp-surface-inset)",
            fontFamily: "var(--bp-font-mono)",
            fontSize: 13,
            lineHeight: 1.5,
            padding: "12px 16px",
            border: "1px solid var(--bp-border)",
            minHeight: 200,
            outline: "none",
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Query Name" value={queryName} onChange={setQueryName} required />
        <FormField label="Source Database" value={sourceDb} onChange={setSourceDb} />
        <FormField label="Division" value={division} onChange={setDivision} />
        <FormField label="Source System" value={sourceSystem} onChange={setSourceSystem} />
        <FormField label="Steward" value={steward} onChange={setSteward} />
        <FormField label="Tags" value={tags} onChange={setTags} placeholder="Comma-separated" />
      </div>
      <FormField label="Description" value={description} onChange={setDescription} multiline />

      {error && <p style={{ color: "var(--bp-fault-red)", fontSize: 12, marginTop: 8, fontFamily: "var(--bp-font-body)" }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="bp-btn-secondary" style={{ fontSize: 13, padding: "6px 14px" }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!queryName || !queryText || submitting}
          className="bp-btn-primary"
          style={{ fontSize: 13, padding: "6px 14px", opacity: (!queryName || !queryText || submitting) ? 0.5 : 1 }}
        >
          {submitting ? "Submitting..." : "Import SQL"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Bulk Import Modal ──

function BulkImportModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [division, setDivision] = useState("");
  const [steward, setSteward] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
  };

  const handleSubmit = async () => {
    if (files.length === 0 || !division || !steward) return;
    setSubmitting(true);
    setError("");
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      formData.append("division", division);
      formData.append("steward", steward);
      const res = await fetch(`${API}/api/gold-studio/specimens/bulk`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Bulk Import" onClose={onClose}>
      <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", marginBottom: 12, letterSpacing: "0.03em" }}>
        Source class: <strong style={{ color: "var(--bp-ink-secondary)" }}>Structural</strong> — parser-driven extraction
      </div>
      <label
        className="flex flex-col items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-black/[0.02]"
        style={{
          border: "2px dashed var(--bp-border-strong)",
          padding: "32px 20px",
          marginBottom: 16,
        }}
      >
        <FolderUp size={24} style={{ color: "var(--bp-ink-muted)", marginBottom: 8 }} />
        <span style={{ fontSize: 13, color: "var(--bp-ink-secondary)" }}>
          {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : "Select multiple files"}
        </span>
        <span style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}>
          .rdl, .pbix, .bim
        </span>
        <input
          type="file"
          accept=".rdl,.pbix,.bim"
          multiple
          onChange={handleFiles}
          className="hidden"
        />
      </label>

      {files.length > 0 && (
        <div
          className="rounded-md mb-4 overflow-y-auto"
          style={{
            background: "var(--bp-surface-inset)",
            border: "1px solid var(--bp-border)",
            maxHeight: 140,
          }}
        >
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-1.5"
              style={{
                borderBottom: i < files.length - 1 ? "1px solid var(--bp-border-subtle)" : "none",
                fontSize: 13,
                color: "var(--bp-ink-primary)",
              }}
            >
              <span className="truncate">{f.name}</span>
              <span
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 11,
                  color: "var(--bp-ink-muted)",
                }}
              >
                {(f.size / 1024).toFixed(0)} KB
              </span>
            </div>
          ))}
        </div>
      )}

      <FormField label="Shared Division" value={division} onChange={setDivision} required />
      <FormField label="Shared Steward" value={steward} onChange={setSteward} required />

      {error && <p style={{ color: "var(--bp-fault-red)", fontSize: 12, marginTop: 8, fontFamily: "var(--bp-font-body)" }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="bp-btn-secondary" style={{ fontSize: 13, padding: "6px 14px" }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={files.length === 0 || !division || !steward || submitting}
          className="bp-btn-primary"
          style={{ fontSize: 13, padding: "6px 14px", opacity: (files.length === 0 || !division || !steward || submitting) ? 0.5 : 1 }}
        >
          {submitting ? "Uploading..." : `Import ${files.length} file${files.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Shared form field ──

function FormField({
  label,
  value,
  onChange,
  placeholder,
  required,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <div className="mb-3">
      <label
        style={{
          display: "block",
          fontFamily: "var(--bp-font-body)",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--bp-ink-secondary)",
          marginBottom: 4,
        }}
      >
        {label}
        {required && <span style={{ color: "var(--bp-fault)" }}> *</span>}
      </label>
      <Tag
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md bp-input"
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          padding: "6px 10px",
          ...(multiline ? { minHeight: 64, resize: "vertical" as const } : {}),
        }}
      />
    </div>
  );
}

// ── Modal shell ──

function ModalShell({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.3)" }}
        aria-hidden="true"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed z-50 rounded-lg overflow-hidden"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: wide ? 640 : 480,
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--bp-surface-1)",
          border: "1px solid var(--bp-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid var(--bp-border)" }}
        >
          <h3
            style={{
              fontFamily: "var(--bp-font-display)",
              fontSize: 16,
              color: "var(--bp-ink-primary)",
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1.5 transition-colors hover:bg-black/5"
            style={{ color: "var(--bp-ink-muted)" }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </>
  );
}

// ── Filter bar ──

function FilterBar({
  search,
  onSearch,
  division,
  onDivision,
  type,
  onType,
  jobState,
  onJobState,
  divisions,
  types,
}: {
  search: string;
  onSearch: (v: string) => void;
  division: string;
  onDivision: (v: string) => void;
  type: string;
  onType: (v: string) => void;
  jobState: string;
  onJobState: (v: string) => void;
  divisions: string[];
  types: string[];
}) {
  const selectStyle = {
    fontFamily: "var(--bp-font-body)",
    fontSize: 13,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--bp-border)",
    background: "var(--bp-surface-1)",
    color: "var(--bp-ink-primary)",
    outline: "none",
    minWidth: 120,
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div
        className="flex items-center gap-2 rounded-md"
        style={{
          border: "1px solid var(--bp-border)",
          background: "var(--bp-surface-1)",
          padding: "5px 10px",
          flex: "1 1 200px",
          maxWidth: 320,
        }}
      >
        <Search size={15} style={{ color: "var(--bp-ink-muted)", flexShrink: 0 }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search specimens..."
          aria-label="Search specimens"
          className="flex-1 bg-transparent outline-none"
          style={{
            fontFamily: "var(--bp-font-body)",
            fontSize: 13,
            color: "var(--bp-ink-primary)",
            border: "none",
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            aria-label="Clear search"
            className="hover:bg-black/5 rounded p-0.5"
          >
            <X size={13} style={{ color: "var(--bp-ink-muted)" }} />
          </button>
        )}
      </div>

      {/* Division */}
      <select value={division} onChange={(e) => onDivision(e.target.value)} style={selectStyle} aria-label="Filter by division">
        <option value="">All Divisions</option>
        {divisions.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {/* Type */}
      <select value={type} onChange={(e) => onType(e.target.value)} style={selectStyle} aria-label="Filter by type">
        <option value="">All Types</option>
        {types.map((t) => (
          <option key={t} value={t}>{t.toUpperCase()}</option>
        ))}
      </select>

      {/* Job State */}
      <select value={jobState} onChange={(e) => onJobState(e.target.value)} style={selectStyle} aria-label="Filter by job state">
        <option value="">All States</option>
        {["queued", "extracting", "schema_discovery", "extracted", "accepted", "parse_warning", "parse_failed", "needs_connection", "schema_pending"].map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
        ))}
      </select>
    </div>
  );
}

// ── Entity flat table (By Entity view) ──

function EntityTable({ entities }: { entities: ExtractedEntity[] }) {
  if (entities.length === 0) {
    return <GoldEmpty noun="extracted entities" />;
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--bp-border)",
                background: "var(--bp-surface-inset)",
              }}
            >
              {["Entity Name", "Specimen", "Source DB", "Columns", "Cluster", "Provenance"].map(
                (h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`py-2.5 px-4 font-medium ${i === 3 ? "text-right" : "text-left"}`}
                    style={{
                      fontFamily: "var(--bp-font-body)",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--bp-ink-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {entities.map((ent) => (
              <tr
                key={ent.id}
                className="transition-colors hover:bg-black/[0.015]"
                style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}
              >
                <td className="py-2.5 px-4" style={{ fontWeight: 500, color: "var(--bp-ink-primary)" }}>
                  {ent.entity_name}
                </td>
                <td className="py-2.5 px-4" style={{ color: "var(--bp-ink-secondary)", fontSize: 12 }}>
                  {ent.specimen_name || "—"}
                </td>
                <td
                  className="py-2.5 px-4"
                  style={{
                    fontFamily: "var(--bp-font-mono)",
                    fontSize: 12,
                    color: "var(--bp-ink-muted)",
                  }}
                >
                  {ent.source_database || "—"}
                </td>
                <td
                  className="py-2.5 px-4 text-right"
                  style={{
                    fontFamily: "var(--bp-font-mono)",
                    fontSize: 12,
                    color: "var(--bp-ink-secondary)",
                  }}
                >
                  {ent.column_count}
                </td>
                <td className="py-2.5 px-4">
                  {ent.cluster_id != null ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                      style={{
                        background: ent.cluster_id > 0 ? "var(--bp-operational-light)" : "var(--bp-caution-light)",
                        color: ent.cluster_id > 0 ? "var(--bp-operational)" : "var(--bp-caution)",
                        fontFamily: "var(--bp-font-mono)",
                        fontSize: 11,
                      }}
                    >
                      {ent.cluster_id > 0 ? "\u2713" : "\u26A0"} C-{Math.abs(ent.cluster_id)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--bp-ink-muted)" }}>—</span>
                  )}
                </td>
                <td
                  className="py-2.5 px-4"
                  style={{
                    fontFamily: "var(--bp-font-mono)",
                    fontSize: 11,
                    color: "var(--bp-ink-muted)",
                  }}
                >
                  {ent.provenance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Supporting Evidence Modal ──

function SupportingEvidenceModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const [name, setName] = useState("");
  const [division, setDivision] = useState("");
  const [steward, setSteward] = useState("");
  const [description, setDescription] = useState("");
  const [relatedReport, setRelatedReport] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); }
  };

  const handleSubmit = async () => {
    if (!file || !division || !steward) return;
    setSubmitting(true); setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name || file.name.replace(/\.[^.]+$/, ""));
      formData.append("division", division);
      formData.append("steward", steward);
      formData.append("source_class", "supporting");
      if (description) formData.append("description", description);
      if (relatedReport) formData.append("related_report", relatedReport);
      const res = await fetch(`${API}/api/gold-studio/specimens`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSubmit();
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <ModalShell title="Supporting Evidence" onClose={onClose}>
      <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", marginBottom: 12, letterSpacing: "0.03em" }}>
        Source class: <strong style={{ color: "var(--bp-caution)" }}>Supporting</strong> — reference material, not parsed
      </div>
      <label className="flex flex-col items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-black/[0.02]"
        style={{ border: "2px dashed var(--bp-border-strong)", padding: "24px 20px", marginBottom: 16 }}>
        <FileSpreadsheet size={24} style={{ color: "var(--bp-ink-muted)", marginBottom: 8 }} />
        <span style={{ fontSize: 13, color: "var(--bp-ink-secondary)", marginBottom: 2 }}>
          {file ? file.name : "Drop Excel, CSV, or mapping file"}
        </span>
        <span style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}>Accepted: .xlsx, .csv, .xls</span>
        <input type="file" accept=".xlsx,.csv,.xls" onChange={handleFile} className="hidden" />
      </label>
      <FormField label="Name" value={name} onChange={setName} placeholder="Auto-filled from filename" />
      <FormField label="Division" value={division} onChange={setDivision} required />
      <FormField label="Steward" value={steward} onChange={setSteward} required />
      <FormField label="Description" value={description} onChange={setDescription} multiline />
      <FormField label="Related Report" value={relatedReport} onChange={setRelatedReport} placeholder="Which report does this support?" />
      {error && <p style={{ color: "var(--bp-fault-red)", fontSize: 12, marginTop: 8, fontFamily: "var(--bp-font-body)" }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="bp-btn-secondary" style={{ fontSize: 13, padding: "6px 14px" }}>Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={!file || !division || !steward || submitting} className="bp-btn-primary"
          style={{ fontSize: 13, padding: "6px 14px", opacity: (!file || !division || !steward || submitting) ? 0.5 : 1 }}>
          {submitting ? "Uploading..." : "Add Evidence"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Contextual Note Modal ──

function ContextualNoteModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const [name, setName] = useState("");
  const [division, setDivision] = useState("");
  const [steward, setSteward] = useState("");
  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); }
  };

  const handleSubmit = async () => {
    if ((!file && !noteText) || !division || !steward) return;
    setSubmitting(true); setError("");
    try {
      const formData = new FormData();
      if (file) formData.append("file", file);
      formData.append("name", name || (file ? file.name.replace(/\.[^.]+$/, "") : "Contextual Note"));
      formData.append("type", file ? "screenshot" : "note");
      formData.append("division", division);
      formData.append("steward", steward);
      formData.append("source_class", "contextual");
      if (noteText) formData.append("description", noteText);
      const res = await fetch(`${API}/api/gold-studio/specimens`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSubmit();
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <ModalShell title="Contextual Note" onClose={onClose}>
      <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", marginBottom: 12, letterSpacing: "0.03em" }}>
        Source class: <strong style={{ color: "var(--bp-ink-muted)" }}>Contextual</strong> — interpretive evidence only
      </div>
      <label className="flex flex-col items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-black/[0.02]"
        style={{ border: "2px dashed var(--bp-border-strong)", padding: "24px 20px", marginBottom: 16 }}>
        <StickyNote size={24} style={{ color: "var(--bp-ink-muted)", marginBottom: 8 }} />
        <span style={{ fontSize: 13, color: "var(--bp-ink-secondary)", marginBottom: 2 }}>
          {file ? file.name : "Drop screenshot or image (optional)"}
        </span>
        <span style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}>Accepted: .png, .jpg, .pdf, .gif</span>
        <input type="file" accept=".png,.jpg,.jpeg,.gif,.pdf" onChange={handleFile} className="hidden" />
      </label>
      <div className="mb-3">
        <label style={{ display: "block", fontFamily: "var(--bp-font-body)", fontSize: 12, fontWeight: 500, color: "var(--bp-ink-secondary)", marginBottom: 4 }}>
          Note / Context *
        </label>
        <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
          placeholder="Describe what this evidence shows, what report it relates to, and any caveats..."
          className="w-full rounded-md" style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, padding: "8px 10px", minHeight: 100, resize: "vertical", border: "1px solid var(--bp-border)", background: "var(--bp-surface-inset)" }} />
      </div>
      <FormField label="Name" value={name} onChange={setName} placeholder="Brief title for this evidence" />
      <FormField label="Division" value={division} onChange={setDivision} required />
      <FormField label="Steward" value={steward} onChange={setSteward} required />
      {error && <p style={{ color: "var(--bp-fault-red)", fontSize: 12, marginTop: 8, fontFamily: "var(--bp-font-body)" }}>{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="bp-btn-secondary" style={{ fontSize: 13, padding: "6px 14px" }}>Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={(!file && !noteText) || !division || !steward || submitting} className="bp-btn-primary"
          style={{ fontSize: 13, padding: "6px 14px", opacity: ((!file && !noteText) || !division || !steward || submitting) ? 0.5 : 1 }}>
          {submitting ? "Saving..." : "Add Note"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Main Component ──

export default function GoldLedger() {
  // Data
  const [stats, setStats] = useState<GoldStats | null>(null);
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [entities, setEntities] = useState<ExtractedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Expanded specimen details cache
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<number, SpecimenDetail>>({});

  // View
  const [view, setView] = useState<"specimen" | "entity">("specimen");

  // Filters
  const [search, setSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [jobStateFilter, setJobStateFilter] = useState("");

  // Modal
  const [modal, setModal] = useState<ModalType>(null);

  // ── Data fetching ──

  const fetchData = useCallback(async () => {
    setFetchError(null);
    try {
      const [statsRes, specRes] = await Promise.all([
        fetch(`${API}/api/gold-studio/stats`),
        fetch(`${API}/api/gold-studio/specimens?limit=200`),
      ]);

      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s);
      }

      if (specRes.ok) {
        const d = await specRes.json();
        setSpecimens(d.items || d || []);
        // Build flat entity list from specimens that include entities
        const allEntities: ExtractedEntity[] = [];
        for (const sp of d.items || d || []) {
          if (sp.entities) {
            for (const ent of sp.entities) {
              allEntities.push({ ...ent, specimen_name: sp.name });
            }
          }
        }
        if (allEntities.length > 0) setEntities(allEntities);
      } else {
        setFetchError(`Failed to load specimens (HTTP ${specRes.status})`);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch entity list for "By Entity" view if not embedded
  useEffect(() => {
    if (view === "entity" && entities.length === 0) {
      fetch(`${API}/api/gold-studio/entities?limit=500`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d) setEntities(d.items || d || []); })
        .catch(() => {});
    }
  }, [view, entities.length]);

  // ── Expand specimen → fetch details ──

  const handleToggle = useCallback(
    (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (!detailsCache[id]) {
        fetch(`${API}/api/gold-studio/specimens/${id}`)
          .then((r) => r.ok ? r.json() : null)
          .then((d) => {
            if (d) {
              setDetailsCache((prev) => ({
                ...prev,
                [id]: { entities: d.entities || [], queries: d.queries || [] },
              }));
            }
          })
          .catch(() => {});
      }
    },
    [expandedId, detailsCache]
  );

  // ── Derived data ──

  const divisions = useMemo(
    () => [...new Set(specimens.map((s) => s.division).filter(Boolean))].sort(),
    [specimens]
  );

  const types = useMemo(
    () => [...new Set(specimens.map((s) => s.type).filter(Boolean))].sort(),
    [specimens]
  );

  const filtered = useMemo(() => {
    return specimens.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !s.name.toLowerCase().includes(q) &&
          !s.steward.toLowerCase().includes(q) &&
          !(s.source_system || "").toLowerCase().includes(q) &&
          !(s.tags || "").toLowerCase().includes(q)
        )
          return false;
      }
      if (divisionFilter && s.division !== divisionFilter) return false;
      if (typeFilter && s.type !== typeFilter) return false;
      if (jobStateFilter && s.job_state !== jobStateFilter) return false;
      return true;
    });
  }, [specimens, search, divisionFilter, typeFilter, jobStateFilter]);

  const filteredEntities = useMemo(() => {
    if (!search) return entities;
    const q = search.toLowerCase();
    return entities.filter(
      (e) =>
        e.entity_name.toLowerCase().includes(q) ||
        (e.specimen_name || "").toLowerCase().includes(q) ||
        (e.source_database || "").toLowerCase().includes(q)
    );
  }, [entities, search]);

  // ── Stats strip items ──

  const statsItems = stats
    ? [
        { label: "Specimens", value: stats.specimens },
        { label: "Tables Extracted", value: stats.tables_extracted },
        { label: "Columns Cataloged", value: stats.columns_cataloged.toLocaleString() },
        { label: "Unresolved Clusters", value: stats.unresolved_clusters, highlight: stats.unresolved_clusters > 0 },
        { label: "Canonical Approved", value: stats.canonical_approved },
        { label: "Gold Specs", value: stats.gold_specs },
        { label: "Certification Rate", value: `${stats.certification_rate}%` },
      ]
    : [
        { label: "Specimens", value: "—" },
        { label: "Tables Extracted", value: "—" },
        { label: "Columns Cataloged", value: "—" },
        { label: "Unresolved Clusters", value: "—" },
        { label: "Canonical Approved", value: "—" },
        { label: "Gold Specs", value: "—" },
        { label: "Certification Rate", value: "—" },
      ];

  // ── Import callback ──

  const handleImportDone = () => {
    setModal(null);
    setLoading(true);
    fetchData();
  };

  return (
    <GoldStudioLayout
      activeTab="ledger"
      actions={<ImportDropdown onSelect={setModal} />}
    >
      {/* Stats */}
      <StatsStrip items={statsItems} />

      {/* Error banner */}
      {fetchError && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 mb-4 flex items-center justify-between"
          style={{
            background: "var(--bp-fault-light)",
            border: "1px solid var(--bp-fault-red)",
            color: "var(--bp-fault-red)",
            fontFamily: "var(--bp-font-body)",
            fontSize: 13,
          }}
        >
          <span>{fetchError}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchData(); }}
            className="bp-btn-secondary"
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Content area */}
      <div style={{ paddingBottom: 40 }}>
        {/* View toggle + filter bar */}
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          {/* View toggle */}
          <div
            className="inline-flex rounded-md overflow-hidden"
            style={{ border: "1px solid var(--bp-border)" }}
          >
            {(["specimen", "entity"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className="px-3 py-1.5 transition-colors"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  fontWeight: 500,
                  background: view === v ? "var(--bp-copper)" : "var(--bp-surface-1)",
                  color: view === v ? "var(--bp-surface-1)" : "var(--bp-ink-secondary)",
                  borderRight: v === "specimen" ? "1px solid var(--bp-border)" : "none",
                }}
              >
                {v === "specimen" ? "By Specimen" : "By Extracted Entity"}
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <FilterBar
            search={search}
            onSearch={setSearch}
            division={divisionFilter}
            onDivision={setDivisionFilter}
            type={typeFilter}
            onType={setTypeFilter}
            jobState={jobStateFilter}
            onJobState={setJobStateFilter}
            divisions={divisions}
            types={types}
          />
        </div>

        {/* Main content */}
        {loading ? (
          <GoldLoading rows={5} label="Loading specimens" />
        ) : view === "specimen" ? (
          filtered.length === 0 ? (
            specimens.length === 0
              ? <GoldEmpty noun="specimens" action={{ label: "Import Your First Specimen", onClick: () => setModal("upload") }} />
              : <GoldNoResults query={search || undefined} />
          ) : (
            <div className="flex flex-col gap-2.5">
              {filtered.map((sp) => {
                const detail = detailsCache[sp.id];
                return (
                  <SpecimenCard
                    key={sp.id}
                    specimen={sp}
                    expanded={expandedId === sp.id}
                    onToggle={() => handleToggle(sp.id)}
                    entities={detail?.entities}
                    queries={detail?.queries}
                  />
                );
              })}

              {/* Result count */}
              <div
                className="text-center mt-2"
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 11,
                  color: "var(--bp-ink-muted)",
                  letterSpacing: "0.03em",
                }}
              >
                {filtered.length} of {specimens.length} specimen{specimens.length !== 1 ? "s" : ""}
              </div>
            </div>
          )
        ) : (
          <EntityTable entities={filteredEntities} />
        )}
      </div>

      {/* Modals */}
      {modal === "upload" && <UploadFileModal onClose={() => setModal(null)} onSubmit={handleImportDone} />}
      {modal === "paste" && <PasteSqlModal onClose={() => setModal(null)} onSubmit={handleImportDone} />}
      {modal === "bulk" && <BulkImportModal onClose={() => setModal(null)} onSubmit={handleImportDone} />}
      {modal === "supporting" && <SupportingEvidenceModal onClose={() => setModal(null)} onSubmit={handleImportDone} />}
      {modal === "contextual" && <ContextualNoteModal onClose={() => setModal(null)} onSubmit={handleImportDone} />}
    </GoldStudioLayout>
  );
}
