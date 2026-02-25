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
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Environment
          </label>
          <div className="flex gap-1.5">
            {(['dev', 'prod', 'all'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                  env === e
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {e.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Mode
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() => setDryRun(false)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                !dryRun
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              <Rocket className="w-3 h-3" />
              Deploy
            </button>
            <button
              onClick={() => setDryRun(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                dryRun
                  ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
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
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Capacity ID <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <input
            type="text"
            value={capacityId}
            onChange={(e) => setCapacityId(e.target.value)}
            placeholder="Auto-detect"
            className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Capacity Name <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <input
            type="text"
            value={capacityName}
            onChange={(e) => setCapacityName(e.target.value)}
            placeholder="Match by name"
            className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
          />
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced Options
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-4 border-l-2 border-border/50">
          {/* Skip Phases */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              <SkipForward className="w-3 h-3 inline mr-1" />
              Skip Phases
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {PHASE_DEFS.map((p) => (
                <button
                  key={p.num}
                  onClick={() => toggleSkipPhase(p.num)}
                  className={`text-left px-2 py-1 text-[10px] rounded border transition-colors cursor-pointer ${
                    skipPhases.includes(p.num)
                      ? 'bg-red-500/10 text-red-400 border-red-500/20 line-through'
                      : 'bg-card text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {p.num}. {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Manual Connection GUIDs */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              <Server className="w-3 h-3 inline mr-1" />
              Manual Connection GUIDs
            </label>
            <p className="text-[10px] text-muted-foreground/60 mb-2">
              Pre-fill GUIDs for connections that can't be auto-created (Phase 4 won't prompt).
            </p>
            {Object.entries(manualConnections).map(([name, value]) => (
              <div key={name} className="flex gap-2 mb-1.5">
                <span className="text-[10px] text-muted-foreground w-48 py-1 truncate flex-shrink-0">
                  {name}
                </span>
                <input
                  type="text"
                  value={value}
                  onChange={(e) =>
                    setManualConnections((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  placeholder="GUID or leave empty to skip"
                  className="flex-1 px-2 py-1 text-[10px] font-mono rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/40"
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
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
          dryRun
            ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30 hover:bg-sky-500/25'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
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
        <p className="text-[10px] text-sky-400/60 text-center -mt-2">
          Dry run mode — no resources will be created or modified
        </p>
      )}
    </div>
  );
}
