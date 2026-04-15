import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Database,
  FolderOpen,
  Link2,
  HardDrive,
  Clock,
} from 'lucide-react';
import type { DeployResult } from './types';

interface Props {
  result: Partial<DeployResult>;
  dryRun?: boolean;
}

const WORKSPACE_LABELS: Record<string, string> = {
  data_dev: 'DATA (Dev)',
  code_dev: 'CODE (Dev)',
  data_prod: 'DATA (Prod)',
  code_prod: 'CODE (Prod)',
  config: 'CONFIG',
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded transition-colors cursor-pointer"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3 h-3" style={{ color: 'var(--bp-operational)' }} />
      ) : (
        <Copy className="w-3 h-3" style={{ color: 'var(--bp-ink-muted)' }} />
      )}
    </button>
  );
}

function SummarySection({
  icon: Icon,
  title,
  entries,
}: {
  icon: React.ComponentType<{ className?: string; style?: CSSProperties }>;
  title: string;
  entries: { label: string; value: string }[];
}) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--bp-border-subtle)', background: 'var(--bp-surface-1)' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: 'var(--bp-ink-muted)' }} />
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
          {title}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>{entries.length}</span>
      </div>
      <div>
        {entries.map(({ label, value }, i) => (
          <div key={label} className="flex items-center px-3 py-1.5 gap-3" style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--bp-border-subtle)' : 'none' }}>
            <span className="text-[11px] flex-shrink-0 w-36 truncate" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
              {label}
            </span>
            <span className="text-[10px] flex-1 truncate" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-secondary)', fontFeatureSettings: '"tnum"' }}>
              {value}
            </span>
            <CopyButton value={value} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PostDeploymentSummary({ result, dryRun }: Props) {
  const wsEntries = Object.entries(result.workspace_ids || {}).map(([key, id]) => ({
    label: WORKSPACE_LABELS[key] || key,
    value: id,
  }));

  const connEntries = Object.entries(result.connection_ids || {}).map(([name, id]) => ({
    label: name.replace('CON_FMD_', ''),
    value: id,
  }));

  const lhEntries = Object.entries(result.lakehouse_ids || {}).map(([key, id]) => ({
    label: key.split(':').pop() || key,
    value: id,
  }));

  const sqlDb = result.sql_db || {};
  const sqlEntries = [
    sqlDb.id && { label: 'Database ID', value: sqlDb.id },
    sqlDb.server && { label: 'Server', value: sqlDb.server },
    sqlDb.database && { label: 'Database Name', value: sqlDb.database },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--bp-operational)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
          {dryRun ? 'Dry Run Complete' : 'Deployment Complete'}
        </h3>
        {result.elapsed != null && (
          <span className="ml-auto flex items-center gap-1 text-xs" style={{ color: 'var(--bp-ink-muted)' }}>
            <Clock className="w-3 h-3" />
            {result.elapsed.toFixed(1)}s
          </span>
        )}
      </div>

      {dryRun && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ color: 'var(--bp-copper)', background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
          This was a dry run — no resources were created. Run without --dry-run to deploy.
        </div>
      )}

      {/* Stats bar */}
      <div className="flex gap-4 text-[10px]" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontFeatureSettings: '"tnum"' }}>
        <span>{result.item_count ?? 0} items deployed</span>
        <span>{result.mapping_count ?? 0} ID mappings</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3">
        <SummarySection icon={FolderOpen} title="Workspaces" entries={wsEntries} />
        <SummarySection icon={Link2} title="Connections" entries={connEntries} />
        <SummarySection icon={HardDrive} title="Lakehouses" entries={lhEntries} />
        <SummarySection icon={Database} title="SQL Database" entries={sqlEntries} />
      </div>
    </div>
  );
}
