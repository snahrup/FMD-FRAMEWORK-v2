import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from '../hooks/useInView';
import { scenarios, type Scenario, type ScenarioStep } from '../data/scenarios';
import {
  AlertTriangle, GitCompare, Clock, Plus, XCircle, CalendarClock, Server,
  ExternalLink, ChevronRight,
} from 'lucide-react';

const iconMap: Record<string, typeof AlertTriangle> = {
  AlertTriangle, GitCompare, Clock, Plus, XCircle, CalendarClock, Server,
};

const severityColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600', dot: 'bg-red-400' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', dot: 'bg-amber-400' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', dot: 'bg-blue-400' },
};

function ScenarioRow({ scenario, isSelected, onClick }: { scenario: Scenario; isSelected: boolean; onClick: () => void }) {
  const Icon = iconMap[scenario.icon] || AlertTriangle;
  const colors = severityColors[scenario.severity];

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all duration-200 ${
        isSelected
          ? `${colors.bg} dark:bg-warmgray-700 border ${colors.border} dark:border-warmgray-600`
          : 'hover:bg-cream-50 dark:hover:bg-warmgray-800/50 border border-transparent'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg ${colors.bg} dark:bg-warmgray-700 border ${colors.border} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
        <Icon size={14} className={colors.text} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[8px] font-semibold uppercase tracking-wider ${colors.text} ${colors.bg} dark:bg-transparent px-1.5 py-0.5 rounded`}>
            {scenario.severity}
          </span>
        </div>
        <h4 className={`text-xs font-semibold truncate ${isSelected ? 'text-warmgray-900 dark:text-cream-100' : 'text-warmgray-700 dark:text-cream-300'}`}>
          {scenario.trigger}
        </h4>
      </div>
      <ChevronRight size={12} className={`flex-shrink-0 transition-transform ${isSelected ? 'text-warmgray-500 rotate-0' : 'text-warmgray-300 -rotate-0'}`} />
    </button>
  );
}

function StepItem({ step, index }: { step: ScenarioStep; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="flex gap-3"
    >
      {/* Step number */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-6 h-6 rounded-full bg-terracotta-50 dark:bg-terracotta-900/30 border border-terracotta-200 dark:border-terracotta-700 flex items-center justify-center">
          <span className="text-[10px] font-bold text-terracotta-500">{index + 1}</span>
        </div>
        <div className="flex-1 w-px bg-cream-300 dark:bg-warmgray-700 mt-1" />
      </div>

      {/* Step content */}
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-xs font-semibold text-warmgray-800 dark:text-cream-200">{step.action}</h4>
          {step.page && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cream-200 dark:bg-warmgray-700 text-warmgray-500 dark:text-warmgray-300 border border-cream-300 dark:border-warmgray-600 text-[9px]">
              {step.page}
              <ExternalLink size={7} />
            </span>
          )}
        </div>
        <p className="text-[10px] text-warmgray-500 dark:text-warmgray-400 leading-relaxed">{step.detail}</p>
      </div>
    </motion.div>
  );
}

function ScenarioDetail({ scenario }: { scenario: Scenario }) {
  const Icon = iconMap[scenario.icon] || AlertTriangle;
  const colors = severityColors[scenario.severity];

  return (
    <motion.div
      key={scenario.id}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl ${colors.bg} dark:bg-warmgray-700 border ${colors.border} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
          <Icon size={20} className={colors.text} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
              {scenario.severity}
            </span>
          </div>
          <h3 className="text-base font-semibold text-warmgray-900 dark:text-cream-100">{scenario.trigger}</h3>
        </div>
      </div>

      {/* Symptoms */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {scenario.symptoms.map((s, i) => (
          <span key={i} className="text-[10px] text-warmgray-400 dark:text-warmgray-500 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-warmgray-300 dark:bg-warmgray-600" />
            {s}
          </span>
        ))}
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <h4 className="text-[10px] font-semibold text-warmgray-500 dark:text-warmgray-400 uppercase tracking-widest mb-3">
          Step-by-step resolution
        </h4>
        <div>
          {scenario.steps.map((step, i) => (
            <StepItem key={i} step={step} index={i} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function EmptyScenario() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-warmgray-700 border border-amber-200 dark:border-warmgray-600 flex items-center justify-center mb-3">
        <AlertTriangle size={22} className="text-amber-400" />
      </div>
      <h3 className="text-sm font-semibold text-warmgray-500 dark:text-warmgray-400 mb-1">Select a scenario</h3>
      <p className="text-xs text-warmgray-400 dark:text-warmgray-500 max-w-[220px]">
        Choose a troubleshooting scenario on the left to see step-by-step resolution.
      </p>
    </div>
  );
}

export default function ScenarioSection() {
  const { ref, inView } = useInView(0.05);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);

  return (
    <section id="scenarios" ref={ref} className="h-screen flex flex-col">
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 min-h-0">
        {/* Compact header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center pt-20 pb-4 flex-shrink-0"
        >
          <span className="badge-terracotta mb-2 inline-block text-[10px]">Scenario Playbook</span>
          <h2 className="section-heading text-3xl md:text-4xl mb-2">When things happen</h2>
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 max-w-lg mx-auto">
            Interactive troubleshooting guides. Click any scenario to see step-by-step
            resolution — which page to check and what to do next.
          </p>
        </motion.div>

        {/* Split panel */}
        <div className="flex-1 flex gap-4 min-h-0 pb-6">
          {/* LEFT: scenario list */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="w-[340px] flex-shrink-0 overflow-y-auto scrollbar-thin space-y-1"
          >
            {scenarios.map((scenario) => (
              <ScenarioRow
                key={scenario.id}
                scenario={scenario}
                isSelected={selectedScenario?.id === scenario.id}
                onClick={() => setSelectedScenario(scenario)}
              />
            ))}
          </motion.div>

          {/* RIGHT: detail panel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 min-w-0"
          >
            <div className="card h-full p-6 overflow-y-auto">
              <AnimatePresence mode="wait">
                {selectedScenario ? (
                  <ScenarioDetail key={selectedScenario.id} scenario={selectedScenario} />
                ) : (
                  <EmptyScenario />
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
