import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface Props {
  lastPhase: number;
  totalPhases: number;
  onResume: () => void;
  onStartFresh: () => void;
}

export default function ResumeBanner({ lastPhase, totalPhases, onResume, onStartFresh }: Props) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Interrupted Deployment Detected
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            A previous deployment completed {lastPhase} of {totalPhases} phases.
            You can resume from Phase {lastPhase + 1} or start a fresh deployment.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onResume}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Resume from Phase {lastPhase + 1}
            </button>
            <button
              onClick={onStartFresh}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-card text-muted-foreground hover:text-foreground border border-border transition-colors cursor-pointer"
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
