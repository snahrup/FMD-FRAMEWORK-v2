import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricCapacity, FabricEntity } from "../types";
import { Cpu } from "lucide-react";

interface CapacityStepProps {
  value: FabricCapacity | null;
  onChange: (cap: FabricCapacity | null) => void;
}

export function CapacityStep({ value, onChange }: CapacityStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold">Select Fabric Capacity</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
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
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Capacity:</span>{" "}
              <span className="font-medium text-foreground">{value.displayName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">SKU:</span>{" "}
              <span className="font-mono text-foreground">{(value as FabricCapacity).sku || "—"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
