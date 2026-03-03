import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from '../hooks/useInView';
import { dashboardPages, pageGroups, type DashboardPage } from '../data/pages';
import {
  Grid3X3, Cog, Sparkles, Radio, Gauge, Activity, ScrollText, Play,
  Cable, FlaskConical, Route, GitBranch, Hash, Database, BarChart3,
  ShieldCheck, Wrench, Server, Settings, Layers3, ClipboardCheck,
  ExternalLink, CheckCircle2, ArrowRight,
} from 'lucide-react';

const iconMap: Record<string, typeof Grid3X3> = {
  Grid3X3, Cog, Sparkles, Radio, Gauge, Activity, ScrollText, Play,
  Cable, FlaskConical, Route, GitBranch, Hash, Database, BarChart3,
  ShieldCheck, Wrench, Server, Settings, Layers3, ClipboardCheck,
};

const groupColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  operations: { bg: 'bg-terracotta-50', border: 'border-terracotta-200', text: 'text-terracotta-600', dot: 'bg-terracotta-400' },
  data: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', dot: 'bg-blue-400' },
  admin: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', dot: 'bg-amber-400' },
  labs: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-600', dot: 'bg-violet-400' },
};

function PageRow({ page, isSelected, onClick }: { page: DashboardPage; isSelected: boolean; onClick: () => void }) {
  const Icon = iconMap[page.icon] || Grid3X3;
  const colors = groupColors[page.group];

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group ${
        isSelected
          ? `${colors.bg} dark:bg-warmgray-700 border ${colors.border} dark:border-warmgray-600`
          : 'hover:bg-cream-50 dark:hover:bg-warmgray-800/50 border border-transparent'
      }`}
    >
      <div className={`w-7 h-7 rounded-md ${colors.bg} dark:bg-warmgray-700 border ${colors.border} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
        <Icon size={14} className={colors.text} />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className={`text-xs font-semibold truncate transition-colors ${
          isSelected ? 'text-warmgray-900 dark:text-cream-100' : 'text-warmgray-700 dark:text-cream-300'
        }`}>{page.name}</h4>
        <p className="text-[10px] text-warmgray-400 dark:text-warmgray-500 truncate">{page.tagline}</p>
      </div>
      <ExternalLink size={10} className={`flex-shrink-0 transition-opacity ${
        isSelected ? 'opacity-60 text-warmgray-400' : 'opacity-0 group-hover:opacity-40 text-warmgray-300'
      }`} />
    </button>
  );
}

function DetailPanel({ page }: { page: DashboardPage }) {
  const Icon = iconMap[page.icon] || Grid3X3;
  const colors = groupColors[page.group];
  const groupLabel = pageGroups.find((g) => g.key === page.group)?.label || page.group;

  return (
    <motion.div
      key={page.route}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start gap-4 mb-5">
        <div className={`w-12 h-12 rounded-xl ${colors.bg} dark:bg-warmgray-700 border ${colors.border} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
          <Icon size={24} className={colors.text} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${colors.text}`}>{groupLabel}</span>
            <span className="text-warmgray-300 dark:text-warmgray-600 text-xs">·</span>
            <span className="text-[10px] text-warmgray-400 dark:text-warmgray-500 font-mono">{page.route}</span>
          </div>
          <h2 className="text-lg font-serif font-semibold text-warmgray-900 dark:text-cream-100" style={{ fontFamily: "'Playfair Display', serif" }}>
            {page.name}
          </h2>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-warmgray-600 dark:text-warmgray-300 leading-relaxed mb-5">{page.description}</p>

      {/* Key Features */}
      <div className="mb-5">
        <h3 className="text-[10px] font-semibold text-warmgray-500 dark:text-warmgray-400 uppercase tracking-widest mb-2.5">Key Features</h3>
        <div className="grid grid-cols-1 gap-1.5">
          {page.keyFeatures.map((f, i) => (
            <div key={i} className="flex items-start gap-2">
              <CheckCircle2 size={12} className={`${colors.text} flex-shrink-0 mt-0.5`} />
              <span className="text-xs text-warmgray-600 dark:text-warmgray-300 leading-snug">{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Connected To */}
      <div className="mb-5">
        <h3 className="text-[10px] font-semibold text-warmgray-500 dark:text-warmgray-400 uppercase tracking-widest mb-2">Connected To</h3>
        <div className="flex flex-wrap gap-1.5">
          {page.connectedTo.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cream-200 dark:bg-warmgray-700 text-warmgray-600 dark:text-warmgray-300 border border-cream-300 dark:border-warmgray-600 text-[10px]">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Why It Matters */}
      <div className="mt-auto bg-terracotta-50 dark:bg-terracotta-900/20 border border-terracotta-100 dark:border-terracotta-800 rounded-xl p-4">
        <h3 className="text-[10px] font-semibold text-terracotta-600 dark:text-terracotta-400 uppercase tracking-widest mb-1.5">Why It Matters</h3>
        <p className="text-xs text-terracotta-700 dark:text-terracotta-300 leading-relaxed">{page.whyItMatters}</p>
      </div>
    </motion.div>
  );
}

function EmptyDetail() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-cream-200 dark:bg-warmgray-700 border border-cream-300 dark:border-warmgray-600 flex items-center justify-center mb-4">
        <ArrowRight size={24} className="text-warmgray-300 dark:text-warmgray-500" />
      </div>
      <h3 className="text-sm font-semibold text-warmgray-500 dark:text-warmgray-400 mb-1">Select a page</h3>
      <p className="text-xs text-warmgray-400 dark:text-warmgray-500 max-w-[200px]">
        Click any page on the left to see what it does, its features, and why it matters.
      </p>
    </div>
  );
}

export default function DashboardPagesSection() {
  const { ref, inView } = useInView(0.05);
  const [selectedPage, setSelectedPage] = useState<DashboardPage | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('all');

  const filteredPages = activeGroup === 'all'
    ? dashboardPages
    : dashboardPages.filter((p) => p.group === activeGroup);

  return (
    <section id="pages" ref={ref} className="h-screen flex flex-col bg-gradient-to-b from-cream-50 to-cream-100 dark:from-warmgray-900 dark:to-[#1E1D1A] transition-colors duration-500">
      {/* Section header — compact */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6 }}
        className="text-center pt-20 pb-4 px-6 flex-shrink-0"
      >
        <span className="badge-terracotta mb-2 inline-block text-[10px]">The Dashboard</span>
        <h2 className="section-heading text-3xl md:text-4xl mb-2">27 pages, one mission</h2>
        <p className="text-sm text-warmgray-500 dark:text-warmgray-400 max-w-lg mx-auto">
          Every page serves a specific purpose. Click any page to see what it does,
          what data it shows, and why it matters.
        </p>
      </motion.div>

      {/* Split panel */}
      <div className="flex-1 flex gap-4 px-6 pb-6 min-h-0 max-w-7xl mx-auto w-full">
        {/* LEFT: filters + page list */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="w-[340px] flex-shrink-0 flex flex-col min-h-0"
        >
          {/* Group filter pills */}
          <div className="flex flex-wrap gap-1.5 mb-3 flex-shrink-0">
            <button
              onClick={() => setActiveGroup('all')}
              className={`px-3 py-1.5 rounded-full text-[10px] font-medium transition-all duration-300 ${
                activeGroup === 'all'
                  ? 'bg-warmgray-800 dark:bg-cream-200 text-white dark:text-warmgray-900'
                  : 'bg-white dark:bg-warmgray-800 text-warmgray-500 border border-cream-300 dark:border-warmgray-600 hover:border-cream-400'
              }`}
            >
              All ({dashboardPages.length})
            </button>
            {pageGroups.map((g) => {
              const count = dashboardPages.filter((p) => p.group === g.key).length;
              const colors = groupColors[g.key];
              return (
                <button
                  key={g.key}
                  onClick={() => setActiveGroup(g.key)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-medium transition-all duration-300 ${
                    activeGroup === g.key
                      ? `${colors.bg} ${colors.text} border ${colors.border}`
                      : 'bg-white dark:bg-warmgray-800 text-warmgray-500 border border-cream-300 dark:border-warmgray-600 hover:border-cream-400'
                  }`}
                >
                  {g.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Scrollable page list */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-0.5 pr-1 scrollbar-thin">
            <AnimatePresence mode="popLayout">
              {filteredPages.map((page, i) => (
                <motion.div
                  key={page.route}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, delay: i * 0.02 }}
                >
                  <PageRow
                    page={page}
                    isSelected={selectedPage?.route === page.route}
                    onClick={() => setSelectedPage(page)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
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
              {selectedPage ? (
                <DetailPanel key={selectedPage.route} page={selectedPage} />
              ) : (
                <EmptyDetail />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
