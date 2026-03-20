import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from '../hooks/useInView';
import { Database, Upload, Layers, Sparkles, BarChart3, ArrowRight } from 'lucide-react';

/** Known source systems — update this list when sources change */
const KNOWN_SOURCES = ['MES', 'ETQ', 'M3 Cloud', 'M3 ERP'] as const;

interface JourneyStep {
  icon: typeof Database;
  layer: string;
  title: string;
  description: string;
  techDetail: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const journeySteps: JourneyStep[] = [
  {
    icon: Database,
    layer: 'SOURCE',
    title: 'On-Prem SQL Server',
    description:
      `Data lives in production SQL Server databases on-premises. ${KNOWN_SOURCES.join(', ')} — 4,777+ tables across ${KNOWN_SOURCES.length} systems.`,
    techDetail:
      'Engine v3 connects via pyodbc through VPN. Builds a SELECT query based on metadata (full table or incremental WHERE clause using watermark column). Reads in 500K-row chunks via Polars DataFrames.',
    color: '#7A756B',
    bgColor: 'bg-warmgray-50',
    borderColor: 'border-warmgray-300',
  },
  {
    icon: Upload,
    layer: 'LANDING ZONE',
    title: 'Raw Parquet in OneLake',
    description:
      'Extracted data is converted to Snappy-compressed Parquet and uploaded directly to OneLake via the Azure Data Lake Storage SDK.',
    techDetail:
      'File path: {Namespace}/{Schema}_{Table}/{timestamp}.parquet. 8 concurrent workers extract and upload in parallel. Each file is a complete snapshot (full) or delta (incremental).',
    color: '#C75B3A',
    bgColor: 'bg-terracotta-50',
    borderColor: 'border-terracotta-200',
  },
  {
    icon: Layers,
    layer: 'BRONZE',
    title: 'Schema-Enforced Tables',
    description:
      'Spark notebooks read raw Parquet, enforce data types, deduplicate records, and create structured SQL tables in the Bronze lakehouse.',
    techDetail:
      'NB_FMD_LOAD_LANDING_BRONZE runs per entity via ForEach. Creates Bronze schemas matching source. Adds audit columns (_LoadTimestamp, _BatchId). Primary keys discovered by Load Optimization Engine.',
    color: '#CD7F32',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  {
    icon: Sparkles,
    layer: 'SILVER',
    title: 'Business-Ready Data',
    description:
      'Business logic is applied: conformed dimensions, SCD Type 2 tracking, incremental merge operations. Data is clean, typed, and ready for analysis.',
    techDetail:
      'NB_FMD_LOAD_BRONZE_SILVER runs per entity. MERGE operations on Silver tables. Calls sp_UpsertEntityStatus after each entity to update the Entity Digest for real-time dashboard monitoring.',
    color: '#8B99A8',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
  },
  {
    icon: BarChart3,
    layer: 'GOLD',
    title: 'Analytics & Power BI',
    description:
      'Dimensional models and Materialized Lakehouse Views (MLVs) serve Power BI semantic models. Cross-domain joins, calendar dimensions, and business KPIs.',
    techDetail:
      'NB_LOAD_GOLD creates star schema fact/dimension tables. MLV semantic layers make data available to Power BI without Import mode. Shortcuts enable cross-workspace access.',
    color: '#D4AF37',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-100',
  },
];

function StepRow({ step, index, isSelected, onClick }: { step: JourneyStep; index: number; isSelected: boolean; onClick: () => void }) {
  const Icon = step.icon;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all duration-200 ${
        isSelected
          ? `${step.bgColor} dark:bg-warmgray-700 border ${step.borderColor} dark:border-warmgray-600`
          : 'hover:bg-cream-50 dark:hover:bg-warmgray-800/50 border border-transparent'
      }`}
    >
      {/* Step number + icon */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: step.color + '20', color: step.color }}>
          {index + 1}
        </div>
        <div className={`w-8 h-8 rounded-lg ${step.bgColor} dark:bg-warmgray-700 border ${step.borderColor} dark:border-warmgray-600 flex items-center justify-center`}>
          <Icon size={16} style={{ color: step.color }} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[9px] font-semibold tracking-widest uppercase" style={{ color: step.color }}>{step.layer}</span>
        <h4 className={`text-xs font-semibold truncate ${isSelected ? 'text-warmgray-900 dark:text-cream-100' : 'text-warmgray-700 dark:text-cream-300'}`}>
          {step.title}
        </h4>
      </div>
    </button>
  );
}

function StepDetail({ step }: { step: JourneyStep }) {
  const Icon = step.icon;

  return (
    <motion.div
      key={step.layer}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-12 h-12 rounded-xl ${step.bgColor} dark:bg-warmgray-700 border ${step.borderColor} dark:border-warmgray-600 flex items-center justify-center flex-shrink-0`}>
          <Icon size={24} style={{ color: step.color }} />
        </div>
        <div>
          <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: step.color }}>{step.layer}</span>
          <h3 className="text-lg font-semibold text-warmgray-900 dark:text-cream-100" style={{ fontFamily: "'Playfair Display', serif" }}>
            {step.title}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-warmgray-600 dark:text-warmgray-300 leading-relaxed mb-5">{step.description}</p>

      {/* Technical details */}
      <div className="mt-auto bg-cream-50 dark:bg-warmgray-800/50 border border-cream-300 dark:border-warmgray-700 rounded-xl p-4">
        <h4 className="text-[10px] font-semibold text-warmgray-500 dark:text-warmgray-400 uppercase tracking-widest mb-2">Technical Details</h4>
        <p className="text-xs text-warmgray-500 dark:text-warmgray-400 leading-relaxed">{step.techDetail}</p>
      </div>
    </motion.div>
  );
}

export default function DataJourneySection() {
  const { ref, inView } = useInView(0.05);
  const [selectedStep, setSelectedStep] = useState<number>(0);

  return (
    <section id="journey" ref={ref} className="h-screen flex flex-col bg-gradient-to-b from-cream-100 to-cream-50 dark:from-[#1E1D1A] dark:to-warmgray-900 transition-colors duration-500">
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-6 min-h-0">
        {/* Compact header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center pt-20 pb-4 flex-shrink-0"
        >
          <span className="badge-terracotta mb-2 inline-block text-[10px]">The Data Journey</span>
          <h2 className="section-heading text-3xl md:text-4xl mb-2">From source to insight</h2>
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 max-w-lg mx-auto">
            Every table follows the same path. Register once, and the framework handles
            extraction, validation, transformation, and modeling.
          </p>
        </motion.div>

        {/* Split panel */}
        <div className="flex-1 flex gap-4 min-h-0 pb-6">
          {/* LEFT: step list + flow diagram */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="w-[340px] flex-shrink-0 flex flex-col min-h-0"
          >
            {/* Steps */}
            <div className="space-y-1 mb-4">
              {journeySteps.map((step, i) => (
                <StepRow
                  key={step.layer}
                  step={step}
                  index={i}
                  isSelected={selectedStep === i}
                  onClick={() => setSelectedStep(i)}
                />
              ))}
            </div>

            {/* Mini flow visual */}
            <div className="flex items-center gap-1 px-3 mt-auto">
              {journeySteps.map((step, i) => (
                <div key={step.layer} className="flex items-center gap-1 flex-1">
                  <button
                    onClick={() => setSelectedStep(i)}
                    className={`w-full h-2 rounded-full transition-all duration-300 cursor-pointer ${
                      selectedStep === i ? 'h-3 shadow-sm' : 'opacity-50'
                    }`}
                    style={{ backgroundColor: step.color }}
                  />
                  {i < journeySteps.length - 1 && (
                    <ArrowRight size={10} className="text-warmgray-300 dark:text-warmgray-600 flex-shrink-0" />
                  )}
                </div>
              ))}
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
                <StepDetail key={selectedStep} step={journeySteps[selectedStep]} />
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
