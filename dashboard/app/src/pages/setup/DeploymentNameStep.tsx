import { Input } from "@/components/ui/input";
import { Cpu, Database, FileCode2, FolderOpen, Server, Workflow } from "lucide-react";
import { FabricDropdown } from "./components/FabricDropdown";
import type { DeploymentResourceNames, FabricCapacity } from "./types";

interface DeploymentNameStepProps {
  value: DeploymentResourceNames;
  onChange: (value: DeploymentResourceNames) => void;
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: "var(--bp-ink-tertiary)" }}>
        {label}
      </span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NameSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl p-4" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function DeploymentNameStep({ value, onChange }: DeploymentNameStepProps) {
  const update = (patch: Partial<DeploymentResourceNames>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <NameSection icon={<Cpu className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />} title="Profile and capacity">
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Profile name" value={value.displayName} onChange={(displayName) => update({ displayName })} />
          <TextField label="Profile key" value={value.profileKey} onChange={(profileKey) => update({ profileKey })} />
          <div className="md:col-span-2">
            <FabricDropdown
              label="Fabric Capacity"
              endpoint={`/deployments/capacities?authMode=${encodeURIComponent(value.authMode)}`}
              responseKey="capacities"
              value={value.capacityId ? { id: value.capacityId, displayName: value.capacityDisplayName } : null}
              onChange={(entity) => {
                const capacity = entity as FabricCapacity | null;
                update({
                  capacityId: capacity?.id || "",
                  capacityDisplayName: capacity?.displayName || "",
                });
              }}
              subtitle="Target capacity assigned to created or reused workspaces"
            />
          </div>
        </div>
      </NameSection>

      <NameSection icon={<FolderOpen className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />} title="Workspaces">
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Data dev workspace" value={value.workspaces.data_dev} onChange={(data_dev) => update({ workspaces: { ...value.workspaces, data_dev } })} />
          <TextField label="Code dev workspace" value={value.workspaces.code_dev} onChange={(code_dev) => update({ workspaces: { ...value.workspaces, code_dev } })} />
          <TextField label="Config workspace" value={value.workspaces.config} onChange={(config) => update({ workspaces: { ...value.workspaces, config } })} />
          <TextField label="Data prod workspace" value={value.workspaces.data_prod} onChange={(data_prod) => update({ workspaces: { ...value.workspaces, data_prod } })} />
          <TextField label="Code prod workspace" value={value.workspaces.code_prod} onChange={(code_prod) => update({ workspaces: { ...value.workspaces, code_prod } })} />
        </div>
      </NameSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <NameSection icon={<Database className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />} title="Lakehouses">
          <div className="grid gap-3">
            <TextField label="Landing lakehouse" value={value.lakehouses.landing} onChange={(landing) => update({ lakehouses: { ...value.lakehouses, landing } })} />
            <TextField label="Bronze lakehouse" value={value.lakehouses.bronze} onChange={(bronze) => update({ lakehouses: { ...value.lakehouses, bronze } })} />
            <TextField label="Silver lakehouse" value={value.lakehouses.silver} onChange={(silver) => update({ lakehouses: { ...value.lakehouses, silver } })} />
          </div>
        </NameSection>

        <NameSection icon={<Server className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />} title="SQL database">
          <TextField label="Metadata database" value={value.database.metadata} onChange={(metadata) => update({ database: { metadata } })} />
        </NameSection>
      </div>

      <NameSection icon={<FileCode2 className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />} title="Fabric item names">
        <div className="grid gap-3 md:grid-cols-3">
          <TextField label="Landing to Bronze notebook" value={value.items.landingBronzeNotebook} onChange={(landingBronzeNotebook) => update({ items: { ...value.items, landingBronzeNotebook } })} />
          <TextField label="Bronze to Silver notebook" value={value.items.bronzeSilverNotebook} onChange={(bronzeSilverNotebook) => update({ items: { ...value.items, bronzeSilverNotebook } })} />
          <label className="space-y-1.5">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: "var(--bp-ink-tertiary)" }}>
              <Workflow className="h-3 w-3" />
              Copy SQL pipeline
            </span>
            <Input value={value.items.copySqlPipeline} onChange={(event) => update({ items: { ...value.items, copySqlPipeline: event.target.value } })} />
          </label>
        </div>
      </NameSection>
    </div>
  );
}
