import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FabricEntity } from "../types";

const API = "/api";

interface FabricDropdownProps {
  label: string;
  /** API path to fetch dropdown options (e.g., "/setup/capacities") */
  endpoint: string;
  /** Key in the response JSON that contains the array (e.g., "capacities", "items") */
  responseKey: string;
  /** Currently selected entity */
  value: FabricEntity | null;
  /** Called when user selects an entity */
  onChange: (entity: FabricEntity | null) => void;
  /** Show "Create New" option */
  canCreate?: boolean;
  /** API path for creation POST (e.g., "/setup/create-workspace") */
  createEndpoint?: string;
  /** Extra fields to include in the create payload */
  createPayload?: Record<string, string>;
  /** Default name for "Create New" (naming convention) */
  defaultCreateName?: string;
  /** Disable the dropdown (e.g., parent dependency not met) */
  disabled?: boolean;
  /** Message to show when disabled */
  disabledMessage?: string;
  /** Subtitle text (shown below the dropdown) */
  subtitle?: string;
}

export function FabricDropdown({
  label,
  endpoint,
  responseKey,
  value,
  onChange,
  canCreate = false,
  createEndpoint,
  createPayload = {},
  defaultCreateName = "",
  disabled = false,
  disabledMessage,
  subtitle,
}: FabricDropdownProps) {
  const [options, setOptions] = useState<FabricEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState(defaultCreateName);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchOptions = useCallback(async () => {
    if (!endpoint || disabled) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API}${endpoint}`);
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      const items: FabricEntity[] = data[responseKey] || data.items || [];
      setOptions(items);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, responseKey, disabled]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__create__") {
      setShowCreate(true);
      setCreateName(defaultCreateName);
      setCreateError(null);
      return;
    }
    if (!val) {
      onChange(null);
      return;
    }
    const entity = options.find((o) => o.id === val);
    if (entity) onChange(entity);
  };

  const handleCreate = async () => {
    if (!createEndpoint || !createName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const resp = await fetch(`${API}${createEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: createName.trim(), ...createPayload }),
      });
      const data = await resp.json();
      if (data.error) {
        setCreateError(data.error);
        return;
      }
      // Refresh options and select the new entity
      setShowCreate(false);
      await fetchOptions();
      onChange({ id: data.id, displayName: data.displayName || createName.trim() });
    } catch (ex) {
      setCreateError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setCreating(false);
    }
  };

  if (disabled) {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <div className="h-9 rounded-md border border-border/50 bg-muted flex items-center px-3">
          <span className="text-xs text-muted-foreground/60 italic">
            {disabledMessage || "Complete previous step first"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <button
          onClick={fetchOptions}
          disabled={loading}
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={fetchOptions}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="relative">
          <select
            value={value?.id || ""}
            onChange={handleSelect}
            disabled={loading}
            className={cn(
              "w-full h-9 rounded-md border border-border bg-background px-3 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              !value && "text-muted-foreground",
            )}
          >
            <option value="">
              {loading ? "Loading..." : "-- Select --"}
            </option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.displayName}
              </option>
            ))}
            {canCreate && createEndpoint && (
              <option value="__create__">+ Create New</option>
            )}
          </select>
          {loading && (
            <Loader2 className="absolute right-8 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {value && (
        <p className="text-[10px] font-mono text-muted-foreground/50 truncate" title={value.id}>
          {value.id}
        </p>
      )}

      {subtitle && !value && (
        <p className="text-[10px] text-muted-foreground/50">{subtitle}</p>
      )}

      {/* Inline create form */}
      {showCreate && (
        <div className="rounded-md border border-dashed border-border/60 bg-muted p-3 space-y-2">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            New {label}
          </label>
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Display name"
            className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          {createError && (
            <p className="text-xs text-destructive">{createError}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
