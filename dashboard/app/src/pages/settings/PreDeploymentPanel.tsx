import { useState } from 'react';
import {
  Rocket,
  Server,
  TestTube,
  SkipForward,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { DeployConfig } from './types';
import { PHASE_DEFS } from './types';

interface Props {
  onStart: (config: DeployConfig) => void;
  disabled?: boolean;
}

export default function PreDeploymentPanel({ onStart, disabled }: Props) {
  const [env, setEnv] = useState<'dev' | 'prod' | 'all'>('all');
  const [dryRun, setDryRun] = useState(false);
  const [capacityId, setCapacityId] = useState('');
  const [capacityName, setCapacityName] = useState('');
  const [skipPhases, setSkipPhases] = useState<number[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualConnections, setManualConnections] = useState<Record<string, string>>({
    CON_FMD_FABRIC_SQL: '',
    CON_FMD_FABRIC_NOTEBOOKS: '',
    CON_FMD_ADF_PIPELINES: '',
  });

  const toggleSkipPhase = (num: number) => {
    setSkipPhases((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    );
  };

  const handleStart = () => {
    const config: DeployConfig = {
      env,
      dryRun,
      resume: false,
      skipPhases,
      startPhase: 1,
      capacityId,
      capacityName,
      manualConnections: Object.fromEntries(
        Object.entries(manualConnections).filter(([, v]) => v.trim())
      ),
    };
    onStart(config);
  };

  return (
    <div className="space-y-5">
      {/* Environment + Dry Run row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
            Environment
          </label>
          <div className="flex gap-1.5">
            {(['dev', 'prod', 'all'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer"
                style={{
                  background: env === e ? 'var(--bp-copper-light)' : 'var(--bp-surface-1)',
                  color: env === e ? 'var(--bp-copper)' : 'var(--bp-ink-tertiary)',
                  border: env === e ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                  fontFamily: 'var(--bp-font-body)',
                }}
              >
                {e.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
            Mode
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() => setDryRun(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer"
              style={{
                background: !dryRun ? 'var(--bp-operational-light)' : 'var(--bp-surface-1)',
                color: !dryRun ? 'var(--bp-operational)' : 'var(--bp-ink-tertiary)',
                border: !dryRun ? '1px solid var(--bp-operational)' : '1px solid var(--bp-border)',
                fontFamily: 'var(--bp-font-body)',
              }}
            >
              <Rocket className="w-3 h-3" />
              Deploy
            </button>
            <button
              onClick={() => setDryRun(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer"
              style={{
                background: dryRun ? 'var(--bp-copper-light)' : 'var(--bp-surface-1)',
                color: dryRun ? 'var(--bp-copper)' : 'var(--bp-ink-tertiary)',
                border: dryRun ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                fontFamily: 'var(--bp-font-body)',
              }}
            >
              <TestTube className="w-3 h-3" />
              Dry Run
            </button>
          </div>
        </div>
      </div>

      {/* Capacity */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
            Capacity ID <span style={{ color: 'var(--bp-ink-muted)' }}>(optional)</span>
          </label>
          <input
            type="text"
            value={capacityId}
            onChange={(e) => setCapacityId(e.target.value)}
            placeholder="Auto-detect"
            className="w-full px-3 py-1.5 text-xs rounded-md focus:ring-1"
            style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
            Capacity Name <span style={{ color: 'var(--bp-ink-muted)' }}>(optional)</span>
          </label>
          <input
            type="text"
            value={capacityName}
            onChange={(e) => setCapacityName(e.target.value)}
            placeholder="Match by name"
            className="w-full px-3 py-1.5 text-xs rounded-md focus:ring-1"
            style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
          />
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
        style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}
      >
        {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced Options
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-4" style={{ borderLeft: '2px solid var(--bp-border)' }}>
          {/* Skip Phases */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
              <SkipForward className="w-3 h-3 inline mr-1" />
              Skip Phases
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {PHASE_DEFS.map((p) => (
                <button
                  key={p.num}
                  onClick={() => toggleSkipPhase(p.num)}
                  className="text-left px-2 py-1 text-[10px] rounded transition-colors cursor-pointer"
                  style={{
                    background: skipPhases.includes(p.num) ? 'var(--bp-fault-light)' : 'var(--bp-surface-1)',
                    color: skipPhases.includes(p.num) ? 'var(--bp-fault)' : 'var(--bp-ink-tertiary)',
                    border: skipPhases.includes(p.num) ? '1px solid var(--bp-fault)' : '1px solid var(--bp-border)',
                    textDecoration: skipPhases.includes(p.num) ? 'line-through' : 'none',
                    fontFamily: 'var(--bp-font-body)',
                  }}
                >
                  {p.num}. {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Manual Connection GUIDs */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
              <Server className="w-3 h-3 inline mr-1" />
              Manual Connection GUIDs
            </label>
            <p className="text-[10px] mb-2" style={{ color: 'var(--bp-ink-muted)' }}>
              Pre-fill GUIDs for connections that can't be auto-created (Phase 4 won't prompt).
            </p>
            {Object.entries(manualConnections).map(([name, value]) => (
              <div key={name} className="flex gap-2 mb-1.5">
                <span className="text-[10px] w-48 py-1 truncate flex-shrink-0" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
                  {name}
                </span>
                <input
                  type="text"
                  value={value}
                  onChange={(e) =>
                    setManualConnections((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  placeholder="GUID or leave empty to skip"
                  className="flex-1 px-2 py-1 text-[10px] rounded"
                  style={{ fontFamily: 'var(--bp-font-mono)', border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-primary)' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Start Button */}
      <button
        onClick={handleStart}
        disabled={disabled}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          dryRun ? '' : 'bp-btn-primary'
        }`}
        style={dryRun ? {
          background: 'var(--bp-copper-light)',
          color: 'var(--bp-copper)',
          border: '1px solid var(--bp-copper)',
          fontFamily: 'var(--bp-font-body)',
        } : { fontFamily: 'var(--bp-font-body)' }}
      >
        {dryRun ? (
          <>
            <TestTube className="w-4 h-4" />
            Preview Deployment ({env.toUpperCase()})
          </>
        ) : (
          <>
            <Rocket className="w-4 h-4" />
            Start Deployment ({env.toUpperCase()})
          </>
        )}
      </button>

      {dryRun && (
        <p className="text-[10px] text-center -mt-2" style={{ color: 'var(--bp-copper)' }}>
          Dry run mode — no resources will be created or modified
        </p>
      )}
    </div>
  );
}
