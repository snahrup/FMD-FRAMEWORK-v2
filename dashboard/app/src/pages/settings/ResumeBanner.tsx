import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface Props {
  lastPhase: number;
  totalPhases: number;
  onResume: () => void;
  onStartFresh: () => void;
}

export default function ResumeBanner({ lastPhase, totalPhases, onResume, onStartFresh }: Props) {
  return (
    <div className="rounded-lg px-5 py-4" style={{ border: '1px solid var(--bp-caution)', background: 'var(--bp-caution-light)' }}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--bp-caution)' }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
            Interrupted Deployment Detected
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            A previous deployment completed {lastPhase} of {totalPhases} phases.
            You can resume from Phase {lastPhase + 1} or start a fresh deployment.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onResume}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors cursor-pointer"
              style={{ background: 'var(--bp-caution-light)', color: 'var(--bp-caution)', border: '1px solid var(--bp-caution)' }}
            >
              <RotateCcw className="w-3 h-3" />
              Resume from Phase {lastPhase + 1}
            </button>
            <button
              onClick={onStartFresh}
              className="bp-btn-ghost inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Start Fresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
