import { useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useInView } from '../hooks/useInView';
import { phases, highlights, type DeployPhase } from '../data/deployment';
import {
  Package, Wrench, Globe, Database, Box, Terminal, Monitor,
  FolderTree, GitBranch, Download, Hammer, FileJson, Settings,
  Server, Shield, Lock, CheckCircle2, Rocket,
  Zap, RotateCcw, ShieldCheck,
} from 'lucide-react';

const iconMap: Record<string, typeof Package> = {
  Package, Wrench, Globe, Database, Box, Terminal, Monitor,
  FolderTree, GitBranch, Download, Hammer, FileJson, Settings,
  Server, Shield, Lock, CheckCircle2,
};

const highlightIcons = [Zap, Rocket, ShieldCheck, RotateCcw, FileJson, Lock];

// ── Curated phases to show as stacking cards (7 is the sweet spot) ──
const FEATURED_PHASES = [
  phases[0],  // Chocolatey
  phases[1],  // Core Tools
  phases[4],  // Python deps
  phases[8],  // Clone repos
  phases[10], // Build
  phases[13], // Windows Services
  phases[15], // IIS Proxy
];

const CARD_HEIGHT = 120;
const STACK_OFFSET = 8;
const SCALE_STEP = 0.025;

export default function DeploymentSection() {
  const { ref: headerRef, inView } = useInView(0.05);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Track scroll within the card scroll area
  const onScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const scrollPerCard = 160;
    const idx = Math.min(
      Math.floor(scrollTop / scrollPerCard),
      FEATURED_PHASES.length - 1
    );
    setActiveIndex(idx);
  }, []);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  return (
    <section id="deployment" ref={headerRef} className="h-screen flex flex-col">
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 min-h-0">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center pt-16 pb-3 flex-shrink-0"
        >
          <span className="badge-terracotta mb-2 inline-block text-[10px]">Server Deployment</span>
          <h2 className="section-heading text-3xl md:text-4xl mb-2">Clone. Run. Done.</h2>
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 max-w-lg mx-auto">
            Everything your server needs — installed, configured, and verified
            with a single script.
          </p>
        </motion.div>

        {/* Main content: left sticky + right stacking cards */}
        <div className="flex-1 flex gap-8 min-h-0 pb-4">
          {/* LEFT PANEL — sticky info */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="w-[380px] flex-shrink-0 flex flex-col justify-between"
          >
            {/* Terminal command */}
            <div>
              <div className="card overflow-hidden mb-4">
                <div className="bg-warmgray-900 dark:bg-black px-4 py-2.5 flex items-center gap-2 border-b border-warmgray-800">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
                  </div>
                  <span className="text-[9px] font-mono text-warmgray-500 ml-2">PowerShell — Administrator</span>
                </div>
                <div className="bg-warmgray-900 dark:bg-black px-4 py-3 font-mono text-[10px] leading-relaxed">
                  <div className="text-warmgray-500">
                    <span className="text-emerald-400">PS&gt;</span>{' '}
                    <span className="text-cream-300">git clone</span>{' '}
                    <span className="text-terracotta-300">your-org/fmd-framework.git</span>
                  </div>
                  <div className="text-warmgray-500 mt-0.5">
                    <span className="text-emerald-400">PS&gt;</span>{' '}
                    <span className="text-cream-300">cd</span>{' '}
                    <span className="text-terracotta-300">fmd-framework/scripts</span>
                  </div>
                  <div className="text-warmgray-500 mt-0.5">
                    <span className="text-emerald-400">PS&gt;</span>{' '}
                    <span className="text-cream-300">.\provision-launcher.ps1</span>
                  </div>
                  <div className="mt-2 text-warmgray-600 text-[9px]">
                    # ~12 min later → fully running dashboard
                  </div>
                </div>
              </div>

              {/* Active phase indicator */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1 bg-cream-300 dark:bg-warmgray-700" />
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-warmgray-400 dark:text-warmgray-500">
                    Phase {FEATURED_PHASES[activeIndex]?.number} of 17
                  </span>
                  <div className="h-px flex-1 bg-cream-300 dark:bg-warmgray-700" />
                </div>
                {/* Progress bar */}
                <div className="h-1 bg-cream-200 dark:bg-warmgray-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-terracotta-400 to-terracotta-500 rounded-full"
                    animate={{ width: `${((activeIndex + 1) / FEATURED_PHASES.length) * 100}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </div>

            {/* Design highlights — compact grid */}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-warmgray-400 dark:text-warmgray-500 mb-2">
                Design Principles
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {highlights.map((h, i) => {
                  const Icon = highlightIcons[i % highlightIcons.length];
                  return (
                    <div
                      key={h.label}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-cream-50 dark:bg-warmgray-800/50 border border-cream-200 dark:border-warmgray-700"
                    >
                      <Icon size={10} className="text-terracotta-400 flex-shrink-0" />
                      <span className="text-[9px] font-medium text-warmgray-600 dark:text-warmgray-300 truncate">
                        {h.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* RIGHT PANEL — stacking cards driven by internal scroll */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 min-w-0 relative"
          >
            {/* Scroll driver — invisible tall content area */}
            <div
              ref={scrollAreaRef}
              className="absolute inset-0 overflow-y-auto scrollbar-thin"
              style={{ zIndex: 2 }}
            >
              {/* Spacer to create scroll distance */}
              <div style={{ height: FEATURED_PHASES.length * 160 + 200 }} />
            </div>

            {/* Stacked cards — visually positioned, pointer-events-none */}
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ zIndex: 1 }}
            >
              <div className="relative w-full max-w-[420px]" style={{ height: CARD_HEIGHT + STACK_OFFSET * FEATURED_PHASES.length }}>
                {FEATURED_PHASES.map((phase, i) => {
                  const Icon = iconMap[phase.icon] || Package;
                  const isActive = i === activeIndex;
                  const isPast = i < activeIndex;
                  const isFuture = i > activeIndex;

                  // Cards above the active one scale down and shift up
                  // Cards below are hidden behind the stack
                  let translateY = 0;
                  let scale = 1;
                  let opacity = 1;
                  let rotate = 0;

                  if (isPast) {
                    // Fly up and shrink — each past card stacks tighter
                    const pastDepth = activeIndex - i;
                    translateY = -pastDepth * (CARD_HEIGHT + 8);
                    scale = 1 - pastDepth * SCALE_STEP;
                    opacity = Math.max(0, 1 - pastDepth * 0.3);
                    rotate = -pastDepth * 0.5;
                  } else if (isFuture) {
                    // Stack below with slight offset + shrink
                    const futureDepth = i - activeIndex;
                    translateY = futureDepth * STACK_OFFSET;
                    scale = 1 - futureDepth * SCALE_STEP;
                    opacity = Math.max(0.3, 1 - futureDepth * 0.15);
                  }

                  return (
                    <div
                      key={phase.number}
                      className="absolute inset-x-0"
                      style={{
                        top: 0,
                        height: CARD_HEIGHT,
                        transform: `translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
                        opacity,
                        zIndex: FEATURED_PHASES.length - Math.abs(i - activeIndex),
                        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                        transformOrigin: 'center top',
                      }}
                    >
                      <div
                        className={`h-full rounded-xl border p-5 flex items-start gap-4 transition-all duration-500 ${
                          isActive
                            ? 'bg-white dark:bg-warmgray-800 border-terracotta-200 dark:border-terracotta-700 shadow-[0_8px_32px_rgba(201,91,58,0.12),0_2px_8px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(201,91,58,0.2),0_2px_8px_rgba(0,0,0,0.3)]'
                            : 'bg-cream-50 dark:bg-warmgray-800/80 border-cream-300 dark:border-warmgray-700 shadow-warm'
                        }`}
                      >
                        {/* Phase number badge */}
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                            isActive
                              ? 'bg-gradient-to-br from-terracotta-400 to-terracotta-600 shadow-[0_4px_12px_rgba(201,91,58,0.3)]'
                              : 'bg-cream-200 dark:bg-warmgray-700 border border-cream-300 dark:border-warmgray-600'
                          }`}
                        >
                          {isActive ? (
                            <Icon size={18} className="text-white" />
                          ) : (
                            <span className="text-xs font-bold text-warmgray-500 dark:text-warmgray-400 font-mono">
                              {phase.number}
                            </span>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors duration-500 ${
                                isActive
                                  ? 'bg-terracotta-50 dark:bg-terracotta-900/30 text-terracotta-500'
                                  : 'bg-cream-100 dark:bg-warmgray-700 text-warmgray-400'
                              }`}
                            >
                              Phase {phase.number}
                            </span>
                            <span className="text-[9px] font-mono text-warmgray-400">{phase.duration}</span>
                          </div>
                          <h3
                            className={`text-sm font-semibold mb-1 transition-colors duration-500 ${
                              isActive
                                ? 'text-warmgray-900 dark:text-cream-100'
                                : 'text-warmgray-600 dark:text-warmgray-400'
                            }`}
                          >
                            {phase.label}
                          </h3>
                          <p
                            className={`text-[10px] leading-relaxed transition-colors duration-500 ${
                              isActive
                                ? 'text-warmgray-500 dark:text-warmgray-400'
                                : 'text-warmgray-400 dark:text-warmgray-500'
                            }`}
                          >
                            {phase.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
