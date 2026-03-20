import { useState, useEffect, useRef, useCallback } from 'react';
import { Rocket, StopCircle, Loader2, XCircle, TestTube } from 'lucide-react';
import type {
  DeployConfig,
  DeployState,
  PhaseState,
  PhaseItem,
  LogEntry,
  DeployStatus,
} from './types';
import PreDeploymentPanel from './PreDeploymentPanel';
import PhaseProgressTracker from './PhaseProgressTracker';
import LiveLogPanel from './LiveLogPanel';
import PostDeploymentSummary from './PostDeploymentSummary';
import ResumeBanner from './ResumeBanner';

const API = '/api';

type UIState = 'idle' | 'configuring' | 'running' | 'completed' | 'failed' | 'cancelled';

export default function DeploymentManager() {
  const [uiState, setUIState] = useState<UIState>('idle');
  const [phases, setPhases] = useState<PhaseState[]>([]);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<DeployState['result']>({});
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(false);
  const [resumeInfo, setResumeInfo] = useState<{ lastPhase: number; total: number } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Check for existing deploy state on mount
  useEffect(() => {
    fetch(`${API}/deploy/state`)
      .then((r) => r.json())
      .then((state: DeployState) => {
        if (state.status === 'running') {
          // Reconnect to running deployment
          setUIState('running');
          setPhases(state.phases);
          setCurrentPhase(state.phase);
          setLogs(state.logs);
          setIsDryRun(state.config_used?.dryRun || false);
          connectSSE();
        } else if (state.status === 'completed' || state.status === 'failed') {
          // Show last result
          if (state.result && Object.keys(state.result).length > 0) {
            setResult(state.result);
            setPhases(state.phases);
          }
          // Check for resume-able state via .deploy_state.json
          const completed = state.phases.filter((p) => p.status === 'completed').length;
          const total = state.phases.length;
          if (state.status === 'failed' && completed > 0 && completed < total) {
            setResumeInfo({ lastPhase: completed, total });
          }
        }
      })
      .catch(() => {
        // Server not running — that's OK
      });

    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API}/deploy/stream`);
    eventSourceRef.current = es;

    es.addEventListener('phase_start', (e) => {
      const data = JSON.parse(e.data);
      setCurrentPhase(data.phase);
      setPhases((prev) =>
        prev.map((p) =>
          p.num === data.phase ? { ...p, status: 'running' } : p
        )
      );
    });

    es.addEventListener('phase_complete', (e) => {
      const data = JSON.parse(e.data);
      setPhases((prev) =>
        prev.map((p) =>
          p.num === data.phase
            ? { ...p, status: 'completed', elapsed: data.elapsed }
            : p
        )
      );
    });

    es.addEventListener('phase_failed', (e) => {
      const data = JSON.parse(e.data);
      setPhases((prev) =>
        prev.map((p) =>
          p.num === data.phase
            ? { ...p, status: 'failed', elapsed: data.elapsed }
            : p
        )
      );
    });

    es.addEventListener('phase_skip', (e) => {
      const data = JSON.parse(e.data);
      setPhases((prev) =>
        prev.map((p) =>
          p.num === data.phase ? { ...p, status: 'skipped' } : p
        )
      );
    });

    es.addEventListener('item_status', (e) => {
      const data = JSON.parse(e.data);
      const item: PhaseItem = { message: data.message, status: data.status };
      setPhases((prev) =>
        prev.map((p) =>
          p.num === data.phase
            ? { ...p, items: [...p.items, item] }
            : p
        )
      );
    });

    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      setLogs((prev) => {
        const next = [...prev, data];
        return next.length > 2000 ? next.slice(-1000) : next;
      });
    });

    es.addEventListener('deploy_complete', (e) => {
      const data = JSON.parse(e.data);
      if (data.cancelled) {
        setUIState('cancelled');
      } else if (data.success) {
        setUIState('completed');
        setResult(data.result || {});
      } else {
        setUIState('failed');
        setError(data.error || 'Deployment failed');
      }
      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = () => {
      // Connection lost — could be server restart
      // Don't immediately set error — SSE reconnects automatically
    };
  }, []);

  const handleStart = async (config: DeployConfig) => {
    setError(null);
    setLogs([]);
    setPhases([]);
    setResult({});
    setResumeInfo(null);
    setIsDryRun(config.dryRun);
    setUIState('running');

    try {
      const resp = await fetch(`${API}/deploy/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || 'Failed to start deployment');
        setUIState('failed');
        return;
      }
      // Give the backend a moment to initialize phases
      setTimeout(() => connectSSE(), 200);
    } catch (err) {
      setError(String(err));
      setUIState('failed');
    }
  };

  const handleResume = () => {
    handleStart({
      env: 'all',
      dryRun: false,
      resume: true,
      skipPhases: [],
      startPhase: 1,
      capacityId: '',
      capacityName: '',
      manualConnections: {},
    });
  };

  const handleCancel = async () => {
    try {
      await fetch(`${API}/deploy/cancel`, { method: 'POST' });
    } catch {
      // best-effort
    }
  };

  const handleReset = () => {
    setUIState('idle');
    setPhases([]);
    setLogs([]);
    setResult({});
    setError(null);
    setResumeInfo(null);
    setCurrentPhase(0);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Rocket className="w-5 h-5" style={{ color: 'var(--bp-copper)' }} />
        <div className="flex-1">
          <h2 style={{ fontFamily: 'var(--bp-font-body)', fontSize: '18px', fontWeight: 600, color: 'var(--bp-ink-primary)' }}>
            Deployment Manager
          </h2>
          <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Full greenfield deployment of the FMD Framework to Microsoft Fabric.
          </p>
        </div>
        {uiState === 'running' && (
          <button
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors cursor-pointer"
            style={{ background: 'var(--bp-fault-light)', color: 'var(--bp-fault)', border: '1px solid var(--bp-fault)' }}
          >
            <StopCircle className="w-3 h-3" />
            Cancel
          </button>
        )}
        {isDryRun && uiState === 'running' && (
          <span className="text-[9px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5" style={{ color: 'var(--bp-copper)', background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
            <TestTube className="w-2.5 h-2.5 inline mr-0.5" />
            Dry Run
          </span>
        )}
      </div>

      {/* Resume banner */}
      {resumeInfo && uiState === 'idle' && (
        <ResumeBanner
          lastPhase={resumeInfo.lastPhase}
          totalPhases={resumeInfo.total}
          onResume={handleResume}
          onStartFresh={() => {
            setResumeInfo(null);
            setUIState('configuring');
          }}
        />
      )}

      {/* State machine views */}
      {(uiState === 'idle' || uiState === 'configuring') && !resumeInfo && (
        <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
          <PreDeploymentPanel onStart={handleStart} />
        </div>
      )}

      {uiState === 'running' && (
        <div className="space-y-4">
          <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <PhaseProgressTracker phases={phases} currentPhase={currentPhase} />
          </div>
          <LiveLogPanel logs={logs} />
        </div>
      )}

      {uiState === 'completed' && (
        <div className="space-y-4">
          <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-operational)', background: 'var(--bp-surface-1)' }}>
            <PostDeploymentSummary result={result} dryRun={isDryRun} />
          </div>
          <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <PhaseProgressTracker phases={phases} currentPhase={0} />
          </div>
          <LiveLogPanel logs={logs} />
          <div className="flex justify-center">
            <button
              onClick={handleReset}
              className="text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--bp-ink-tertiary)' }}
            >
              Start New Deployment
            </button>
          </div>
        </div>
      )}

      {uiState === 'failed' && (
        <div className="space-y-4">
          <div className="rounded-lg px-5 py-4" style={{ border: '1px solid var(--bp-fault)', background: 'var(--bp-fault-light)' }}>
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--bp-fault)' }} />
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-fault)' }}>
                  Deployment Failed
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-tertiary)' }}>
                  {error || 'An error occurred during deployment.'}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <PhaseProgressTracker phases={phases} currentPhase={0} />
          </div>
          <LiveLogPanel logs={logs} />
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleResume}
              className="text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--bp-caution)' }}
            >
              Resume from Last Phase
            </button>
            <span style={{ color: 'var(--bp-ink-muted)', opacity: 0.3 }}>|</span>
            <button
              onClick={handleReset}
              className="text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--bp-ink-tertiary)' }}
            >
              Start Fresh
            </button>
          </div>
        </div>
      )}

      {uiState === 'cancelled' && (
        <div className="space-y-4">
          <div className="rounded-lg px-5 py-4" style={{ border: '1px solid var(--bp-caution)', background: 'var(--bp-caution-light)' }}>
            <div className="flex items-center gap-3">
              <StopCircle className="w-5 h-5" style={{ color: 'var(--bp-caution)' }} />
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-caution)' }}>
                  Deployment Cancelled
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-tertiary)' }}>
                  The deployment was stopped. Completed phases are preserved.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <PhaseProgressTracker phases={phases} currentPhase={0} />
          </div>
          <LiveLogPanel logs={logs} />
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleResume}
              className="text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--bp-caution)' }}
            >
              Resume
            </button>
            <span style={{ color: 'var(--bp-ink-muted)', opacity: 0.3 }}>|</span>
            <button
              onClick={handleReset}
              className="text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--bp-ink-tertiary)' }}
            >
              Start Fresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
