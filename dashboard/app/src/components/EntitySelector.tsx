import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, XCircle } from "lucide-react";
import type { DigestEntity } from "@/hooks/useEntityDigest";

// ============================================================================
// EntitySelector — Reusable searchable entity dropdown
//
// Mirrors the combobox pattern from DataJourney.tsx (lines 489-583).
// Supports grouped-by-source display, search filtering, clear button,
// and click-outside-to-close.
// ============================================================================

interface EntitySelectorProps {
  entities: DigestEntity[];
  selectedId: string | null;
  onSelect: (entityId: string) => void;
  onClear?: () => void;
  loading?: boolean;
  placeholder?: string;
}

export default function EntitySelector({
  entities,
  selectedId,
  onSelect,
  onClear,
  loading = false,
  placeholder = "Select an entity...",
}: EntitySelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Filtered entity list
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const q = searchQuery.toLowerCase();
    return entities.filter(
      (e) =>
        e.tableName.toLowerCase().includes(q) ||
        e.sourceSchema.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q)
    );
  }, [entities, searchQuery]);

  // Group entities by source
  const groupedEntities = useMemo(() => {
    const groups: Record<string, DigestEntity[]> = {};
    filteredEntities.forEach((e) => {
      const key = e.source || "Unknown";
      (groups[key] ||= []).push(e);
    });
    return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
  }, [filteredEntities]);

  // Find selected entity for display
  const selectedEntity = entities.find((e) => String(e.id) === selectedId);

  const handleSelect = (entityId: string) => {
    onSelect(entityId);
    setDropdownOpen(false);
    setSearchQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchQuery("");
    onClear?.();
  };

  return (
    <div ref={selectorRef} className="relative max-w-2xl">
      {/* Trigger button / search input */}
      <div
        className={`flex items-center border rounded-lg transition-colors cursor-pointer ${
          dropdownOpen
            ? "border-[#B45624] bg-[#FEFDFB]"
            : "border-[rgba(0,0,0,0.08)] bg-[#FEFDFB] hover:border-[rgba(0,0,0,0.14)]"
        }`}
        onClick={() => !dropdownOpen && setDropdownOpen(true)}
      >
        <Search className="w-4 h-4 ml-3 flex-shrink-0" style={{ color: "#A8A29E" }} />
        {dropdownOpen ? (
          <input
            type="text"
            autoFocus
            placeholder={loading ? "Loading entities..." : `Filter ${entities.length} entities...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2.5 bg-transparent text-sm text-[#1C1917] placeholder:text-[#A8A29E] outline-none"
          />
        ) : (
          <div className="w-full px-3 py-2.5 text-sm">
            {selectedEntity ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F4E8DF] text-[#B45624] border border-[#B45624]/20">
                  {selectedEntity.source}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", color: "#1C1917" }}>{selectedEntity.tableName}</span>
              </div>
            ) : (
              <span style={{ color: "#A8A29E" }}>{placeholder}</span>
            )}
          </div>
        )}
        {selectedId && !dropdownOpen && onClear && (
          <button
            onClick={handleClear}
            className="mr-2 text-[#A8A29E] hover:text-[#78716C]"
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
        <ChevronDown
          className={`w-4 h-4 text-[#A8A29E] mr-3 flex-shrink-0 transition-transform ${
            dropdownOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {/* Dropdown list */}
      {dropdownOpen && !loading && (
        <div className="absolute z-[200] mt-1 w-full max-h-[60vh] overflow-y-auto rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#FEFDFB]">
          {Object.entries(groupedEntities).map(([source, items]) => (
            <div key={source}>
              <div className="sticky top-0 px-3 py-2 backdrop-blur-sm flex items-center justify-between" style={{ background: "#F9F7F3", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#B45624]">
                  {source}
                </span>
                <span className="text-[10px] text-[#A8A29E]">{items.length} entities</span>
              </div>
              {items.map((e) => {
                const idStr = String(e.id);
                return (
                  <button
                    key={idStr}
                    onClick={() => handleSelect(idStr)}
                    className={`w-full text-left px-3 py-2 hover:bg-[#F9F7F3] transition-colors flex items-center justify-between gap-2 ${
                      selectedId === idStr ? "bg-[#F4E8DF] border-l-2 border-[#B45624]" : ""
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-sm truncate" style={{ fontFamily: "var(--font-mono)", color: "#1C1917" }}>
                        {e.tableName}
                      </span>
                      {e.sourceSchema !== "dbo" && (
                        <span className="text-[10px] text-[#A8A29E] flex-shrink-0">
                          {e.sourceSchema}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#A8A29E]/60 flex-shrink-0">
                      #{idStr}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {Object.keys(groupedEntities).length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-[#A8A29E]">
              No entities match "{searchQuery}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
