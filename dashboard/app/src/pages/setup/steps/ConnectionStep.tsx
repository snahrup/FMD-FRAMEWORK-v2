import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricConnection, EnvironmentConfig } from "../types";
import { Cable } from "lucide-react";

const CONNECTION_FIELDS: {
  key: string;
  label: string;
  description: string;
  canCreate: boolean;
}[] = [
  { key: "CON_FMD_FABRIC_SQL", label: "Fabric SQL Connection", description: "Connection to the metadata SQL database", canCreate: false },
  { key: "CON_FMD_FABRIC_PIPELINES", label: "Fabric Pipelines Connection", description: "Service Principal connection for pipeline orchestration", canCreate: false },
  { key: "CON_FMD_ADF_PIPELINES", label: "ADF Pipelines Connection", description: "Azure Data Factory connection (optional)", canCreate: false },
  { key: "CON_FMD_FABRIC_NOTEBOOKS", label: "Fabric Notebooks Connection", description: "Connection for notebook execution", canCreate: false },
];

interface ConnectionStepProps {
  connections: Record<string, FabricConnection | null>;
  onChange: (key: string, value: FabricConnection | null) => void;
}

export function ConnectionStep({ connections, onChange }: ConnectionStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Cable className="h-4 w-4" style={{ color: 'var(--bp-copper)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>Select Connections</h3>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
        Map existing Fabric connections to their FMD roles. Connections are created in the Fabric
        portal — select the matching one from the dropdown.
      </p>

      <div className="space-y-3">
        {CONNECTION_FIELDS.map((field) => (
          <div key={field.key} className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <FabricDropdown
              label={field.label}
              endpoint="/fabric/connections"
              responseKey="connections"
              value={connections[field.key] || null}
              onChange={(e) => onChange(field.key, e as FabricConnection | null)}
              canCreate={field.canCreate}
              subtitle={field.description}
            />
          </div>
        ))}
      </div>

      <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)' }}>
        <p className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>
          Connections use Service Principal authentication. Create them in the Fabric portal
          under Settings → Manage connections and gateways, then select them here.
        </p>
      </div>
    </div>
  );
}
