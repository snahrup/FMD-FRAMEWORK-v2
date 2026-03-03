import { motion } from 'framer-motion';
import { useInView } from '../hooks/useInView';
import { useCountUp } from '../hooks/useCountUp';
import { stats, capabilities, limitations, benefits, type Stat } from '../data/capabilities';
import {
  Database, TrendingUp, Layers, Radio, RefreshCw, Brain, Cable, Zap,
  ArrowRight, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { useState } from 'react';

const iconMap: Record<string, typeof Database> = {
  Database, TrendingUp, Layers, Radio, RefreshCw, Brain, Cable, Zap,
};

function StatCard({ stat }: { stat: Stat }) {
  const { ref, inView } = useInView(0.3);
  const count = useCountUp(stat.value, 2000, inView);

  return (
    <div ref={ref} className="text-center">
      <div className="text-2xl font-bold text-warmgray-900 dark:text-cream-100 font-mono tabular-nums">
        {stat.prefix}
        {count.toLocaleString()}
        {stat.suffix && <span className="text-terracotta-400">{stat.suffix}</span>}
      </div>
      <div className="text-xs font-medium text-warmgray-600 dark:text-warmgray-300 mt-0.5">{stat.label}</div>
      <div className="text-[10px] text-warmgray-400 dark:text-warmgray-500">{stat.description}</div>
    </div>
  );
}

export default function CapabilitiesSection() {
  const { ref, inView } = useInView(0.05);
  const [activeTab, setActiveTab] = useState<'capabilities' | 'before-after' | 'limitations'>('capabilities');

  return (
    <section id="capabilities" ref={ref} className="h-screen flex flex-col">
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 min-h-0">
        {/* Compact header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center pt-20 pb-3 flex-shrink-0"
        >
          <span className="badge-terracotta mb-2 inline-block text-[10px]">Scale & Capabilities</span>
          <h2 className="section-heading text-3xl md:text-4xl mb-2">Built for enterprise scale</h2>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="card p-4 mb-4 flex-shrink-0"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} stat={stat} />
            ))}
          </div>
        </motion.div>

        {/* Tab switcher */}
        <div className="flex justify-center gap-2 mb-3 flex-shrink-0">
          {[
            { key: 'capabilities' as const, label: 'Key Capabilities' },
            { key: 'before-after' as const, label: 'Before & After' },
            { key: 'limitations' as const, label: 'Known Limitations' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-medium transition-all duration-300 ${
                activeTab === tab.key
                  ? 'bg-terracotta-500 text-white shadow-warm'
                  : 'bg-white dark:bg-warmgray-800 text-warmgray-500 hover:text-warmgray-700 dark:hover:text-warmgray-300 border border-cream-300 dark:border-warmgray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-6 scrollbar-thin">
          {activeTab === 'capabilities' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              {capabilities.map((cap, i) => {
                const Icon = iconMap[cap.icon] || Database;
                return (
                  <motion.div
                    key={cap.title}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                    className="card p-4 flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-terracotta-50 dark:bg-warmgray-700 border border-terracotta-200 dark:border-warmgray-600 flex items-center justify-center flex-shrink-0">
                      <Icon size={16} className="text-terracotta-500" />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-warmgray-800 dark:text-cream-200 mb-0.5">{cap.title}</h3>
                      <p className="text-[10px] text-warmgray-500 dark:text-warmgray-400 leading-relaxed">{cap.description}</p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {activeTab === 'before-after' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="space-y-2"
            >
              {benefits.map((b, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="card p-3"
                >
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4">
                    <div className="flex-1 flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[8px] text-red-400 font-bold">-</span>
                      </div>
                      <span className="text-xs text-warmgray-500 dark:text-warmgray-400 line-through decoration-warmgray-300">{b.before}</span>
                    </div>
                    <ArrowRight size={12} className="text-terracotta-300 flex-shrink-0 hidden md:block" />
                    <div className="flex-1 flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-warmgray-700 dark:text-cream-200 font-medium">{b.after}</span>
                    </div>
                    <div className="badge-terracotta text-[9px] flex-shrink-0">{b.impact}</div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {activeTab === 'limitations' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              {limitations.map((lim, i) => (
                <motion.div
                  key={lim.title}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="card p-4 border-l-2 border-l-amber-300"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-xs font-semibold text-warmgray-700 dark:text-cream-300 mb-0.5">{lim.title}</h3>
                      <p className="text-[10px] text-warmgray-500 dark:text-warmgray-400 leading-relaxed">{lim.description}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}
