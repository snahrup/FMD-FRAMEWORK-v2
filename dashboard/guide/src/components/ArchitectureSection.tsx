import { useState, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from '../hooks/useInView';
import { architectureNodes, type ArchNode } from '../data/architecture';
import {
  Database, Workflow, HardDrive, FileCode, LayoutDashboard, Cpu, Server,
} from 'lucide-react';
import { ThemeContext } from '../App';

const nodeTypeConfig: Record<string, { icon: typeof Database; bg: string; border: string; text: string }> = {
  source: { icon: Server, bg: 'bg-warmgray-50', border: 'border-warmgray-300', text: 'text-warmgray-600' },
  engine: { icon: Cpu, bg: 'bg-terracotta-50', border: 'border-terracotta-300', text: 'text-terracotta-600' },
  pipeline: { icon: Workflow, bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-600' },
  lakehouse: { icon: HardDrive, bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-600' },
  notebook: { icon: FileCode, bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-600' },
  database: { icon: Database, bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-600' },
  dashboard: { icon: LayoutDashboard, bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-600' },
};

const layoutRows: { label: string; nodeIds: string[] }[] = [
  { label: 'Data Sources', nodeIds: ['mes', 'etq', 'm3c', 'm3erp'] },
  { label: 'Orchestration', nodeIds: ['engine', 'pipelines', 'notebooks'] },
  { label: 'Medallion Layers', nodeIds: ['lz', 'bronze', 'silver', 'gold'] },
  { label: 'Intelligence', nodeIds: ['sqldb', 'dashboard'] },
];

function NodeChip({ node, isSelected, onClick }: { node: ArchNode; isSelected: boolean; onClick: () => void }) {
  const config = nodeTypeConfig[node.type] || nodeTypeConfig.source;
  const Icon = config.icon;

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
        isSelected
          ? 'card ring-2 ring-terracotta-400 shadow-warm-md'
          : 'card'
      }`}
    >
      <div className={`w-7 h-7 rounded-md ${config.bg} dark:bg-warmgray-700 border ${config.border} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
        <Icon size={14} className={config.text} />
      </div>
      <div className="min-w-0">
        <h4 className="text-xs font-semibold text-warmgray-800 dark:text-cream-200 truncate">{node.label}</h4>
        <p className="text-[10px] text-warmgray-400 truncate">{node.description}</p>
      </div>
    </motion.button>
  );
}

function DetailPanel({ node }: { node: ArchNode }) {
  const config = nodeTypeConfig[node.type] || nodeTypeConfig.source;
  const Icon = config.icon;

  return (
    <motion.div
      key={node.id}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl ${config.bg} dark:bg-warmgray-700 border ${config.border} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
          <Icon size={20} className={config.text} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-warmgray-900 dark:text-cream-100">{node.label}</h3>
          <p className="text-xs text-warmgray-500 dark:text-warmgray-400">{node.description}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {node.details.map((d, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-terracotta-300 mt-1.5 flex-shrink-0" />
            <span className="text-xs text-warmgray-600 dark:text-warmgray-300 leading-snug">{d}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function ArchitectureSection() {
  const { ref, inView } = useInView(0.1);
  const [selectedNode, setSelectedNode] = useState<ArchNode | null>(null);

  return (
    <section id="architecture" ref={ref} className="h-screen flex flex-col">
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 min-h-0">
        {/* Compact header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center pt-20 pb-4 flex-shrink-0"
        >
          <span className="badge-terracotta mb-2 inline-block text-[10px]">System Architecture</span>
          <h2 className="section-heading text-3xl md:text-4xl mb-2">How it all connects</h2>
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 max-w-lg mx-auto">
            Click any component to explore its role. Data flows from on-prem sources
            through a complete medallion architecture.
          </p>
        </motion.div>

        {/* Split: nodes left + detail/diagram right */}
        <div className="flex-1 flex gap-4 min-h-0 pb-6">
          {/* LEFT: node grid */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="w-[340px] flex-shrink-0 overflow-y-auto pr-1 scrollbar-thin space-y-4"
          >
            {layoutRows.map((row, rowIdx) => (
              <div key={row.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-medium text-warmgray-400 dark:text-warmgray-500 uppercase tracking-widest">
                    {row.label}
                  </span>
                  <div className="flex-1 h-px bg-cream-300 dark:bg-warmgray-700" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {row.nodeIds.map((id) => {
                    const node = architectureNodes.find((n) => n.id === id);
                    if (!node) return null;
                    return (
                      <NodeChip
                        key={id}
                        node={node}
                        isSelected={selectedNode?.id === id}
                        onClick={() => setSelectedNode(selectedNode?.id === id ? null : node)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>

          {/* RIGHT: detail + diagram */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 flex flex-col min-w-0 min-h-0 gap-4"
          >
            {/* Detail panel */}
            <div className="card p-5 flex-shrink-0 min-h-[140px]">
              <AnimatePresence mode="wait">
                {selectedNode ? (
                  <DetailPanel key={selectedNode.id} node={selectedNode} />
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-center h-full text-sm text-warmgray-400 dark:text-warmgray-500"
                  >
                    Click a component on the left to see details
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* SVG Diagram */}
            <div className="card p-4 flex-1 min-h-0 flex flex-col">
              <h3 className="text-[10px] font-semibold text-warmgray-500 dark:text-warmgray-400 uppercase tracking-widest mb-2 flex-shrink-0">
                Data Flow Architecture
              </h3>
              <div className="flex-1 min-h-0 flex items-center">
                <SvgDiagram />
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function SvgDiagram() {
  const { dark } = useContext(ThemeContext);
  const cardFill = dark ? '#2E2B27' : '#FAF9F7';
  const cardStroke = dark ? '#4A4640' : '#E0DBD3';
  const innerFill = dark ? '#3A3733' : 'white';
  const textFill = dark ? '#B3ADA3' : '#4A4640';

  return (
    <svg viewBox="0 0 1000 300" className="w-full" style={{ maxHeight: '100%' }}>
      {/* Source cluster */}
      <g>
        <rect x="20" y="80" width="120" height="140" rx="12" fill={cardFill} stroke={cardStroke} strokeWidth="1.5" />
        <text x="80" y="110" textAnchor="middle" fill="#7A756B" fontSize="11" fontWeight="600">SOURCES</text>
        {['MES', 'ETQ', 'M3C', 'M3 ERP'].map((s, i) => (
          <g key={s}>
            <rect x="35" y={122 + i * 22} width="90" height="18" rx="4" fill={innerFill} stroke={cardStroke} strokeWidth="1" />
            <text x="80" y={134 + i * 22} textAnchor="middle" fill={textFill} fontSize="9">{s}</text>
          </g>
        ))}
      </g>

      {/* Engine */}
      <rect x="200" y="110" width="110" height="80" rx="12" fill={dark ? '#3A2520' : '#FDF2EE'} stroke="#E8A08C" strokeWidth="1.5" />
      <text x="255" y="145" textAnchor="middle" fill="#C75B3A" fontSize="11" fontWeight="600">Engine v3</text>
      <text x="255" y="165" textAnchor="middle" fill="#C75B3A" fontSize="9" opacity="0.7">REST Orchestrator</text>

      {/* Landing Zone */}
      <rect x="370" y="110" width="110" height="80" rx="12" fill={dark ? '#3A2520' : '#FDF2EE'} stroke="#D97757" strokeWidth="1.5" />
      <text x="425" y="145" textAnchor="middle" fill="#C75B3A" fontSize="11" fontWeight="600">Landing Zone</text>
      <text x="425" y="165" textAnchor="middle" fill="#C75B3A" fontSize="9" opacity="0.7">Raw Parquet</text>

      {/* Bronze */}
      <rect x="540" y="110" width="110" height="80" rx="12" fill={dark ? '#2E2815' : '#FFF8F0'} stroke="#CD7F32" strokeWidth="1.5" />
      <text x="595" y="145" textAnchor="middle" fill="#B5712D" fontSize="11" fontWeight="600">Bronze</text>
      <text x="595" y="165" textAnchor="middle" fill="#B5712D" fontSize="9" opacity="0.7">Validated</text>

      {/* Silver */}
      <rect x="710" y="110" width="110" height="80" rx="12" fill={dark ? '#252830' : '#F5F7FA'} stroke="#8B99A8" strokeWidth="1.5" />
      <text x="765" y="145" textAnchor="middle" fill="#6B7B8D" fontSize="11" fontWeight="600">Silver</text>
      <text x="765" y="165" textAnchor="middle" fill="#6B7B8D" fontSize="9" opacity="0.7">Business-Ready</text>

      {/* Gold */}
      <rect x="880" y="110" width="100" height="80" rx="12" fill={dark ? '#2E2A15' : '#FFFBF0'} stroke="#D4AF37" strokeWidth="1.5" />
      <text x="930" y="145" textAnchor="middle" fill="#B8960F" fontSize="11" fontWeight="600">Gold</text>
      <text x="930" y="165" textAnchor="middle" fill="#B8960F" fontSize="9" opacity="0.7">Analytics</text>

      {/* SQL Metadata DB */}
      <rect x="370" y="30" width="280" height="50" rx="10" fill={dark ? '#2E2A15' : '#FFF9EB'} stroke="#E8C547" strokeWidth="1.5" />
      <text x="510" y="55" textAnchor="middle" fill="#8B7310" fontSize="11" fontWeight="600">SQL Metadata Database</text>
      <text x="510" y="70" textAnchor="middle" fill="#8B7310" fontSize="9" opacity="0.7">Entity Registry · Audit Logs · Config</text>

      {/* Dashboard */}
      <rect x="370" y="220" width="280" height="50" rx="10" fill={dark ? '#2E2025' : '#FFF0F0'} stroke="#E8A0A0" strokeWidth="1.5" />
      <text x="510" y="245" textAnchor="middle" fill="#A05050" fontSize="11" fontWeight="600">Operations Dashboard</text>
      <text x="510" y="260" textAnchor="middle" fill="#A05050" fontSize="9" opacity="0.7">27 Pages · 90+ API Endpoints</text>

      {/* Arrows — flow lines */}
      <line x1="140" y1="150" x2="200" y2="150" stroke="#C75B3A" strokeWidth="1.5" className="flow-line" />
      <line x1="310" y1="150" x2="370" y2="150" stroke="#C75B3A" strokeWidth="1.5" className="flow-line" style={{ animationDelay: '0.3s' }} />
      <line x1="480" y1="150" x2="540" y2="150" stroke="#CD7F32" strokeWidth="1.5" className="flow-line" style={{ animationDelay: '0.6s' }} />
      <line x1="650" y1="150" x2="710" y2="150" stroke="#8B99A8" strokeWidth="1.5" className="flow-line" style={{ animationDelay: '0.9s' }} />
      <line x1="820" y1="150" x2="880" y2="150" stroke="#D4AF37" strokeWidth="1.5" className="flow-line" style={{ animationDelay: '1.2s' }} />

      {/* Vertical arrows to SQL DB */}
      <line x1="510" y1="80" x2="510" y2="110" stroke="#E8C547" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />

      {/* Vertical arrows to Dashboard */}
      <line x1="510" y1="190" x2="510" y2="220" stroke="#E8A0A0" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />

      {/* Arrow tips */}
      {[200, 370, 540, 710, 880].map((x, i) => (
        <polygon
          key={i}
          points={`${x - 5},${145} ${x},${150} ${x - 5},${155}`}
          fill={['#C75B3A', '#C75B3A', '#CD7F32', '#8B99A8', '#D4AF37'][i]}
        />
      ))}
    </svg>
  );
}
