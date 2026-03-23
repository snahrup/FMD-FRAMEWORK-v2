import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricCapacity } from "../types";
import { Cpu } from "lucide-react";

interface CapacityStepProps {
  value: FabricCapacity | null;
  onChange: (cap: FabricCapacity | null) => void;
}

export function CapacityStep({ value, onChange }: CapacityStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4" style={{ color: 'var(--bp-copper)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>Select Fabric Capacity</h3>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
        Choose the Fabric capacity that will host your FMD workspaces. Only active capacities are shown.
        Capacities are provisioned in Azure — if you don't see yours, check the Azure portal.
      </p>

      <FabricDropdown
        label="Fabric Capacity"
        endpoint="/setup/capacities"
        responseKey="capacities"
        value={value}
        onChange={(e) => onChange(e as FabricCapacity | null)}
        subtitle="All workspaces will be assigned to this capacity"
      />

      {value && (
        <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span style={{ color: 'var(--bp-ink-tertiary)' }}>Capacity:</span>{" "}
              <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{value.displayName}</span>
            </div>
            <div>
              <span style={{ color: 'var(--bp-ink-tertiary)' }}>SKU:</span>{" "}
              <span style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>{(value as FabricCapacity).sku || "—"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
