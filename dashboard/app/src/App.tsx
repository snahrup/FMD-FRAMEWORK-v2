import { Routes, Route, Navigate } from 'react-router-dom'
import { BackgroundTaskProvider } from '@/contexts/BackgroundTaskContext'
import { PersonaProvider } from '@/contexts/PersonaContext'
import { AppLayout } from '@/components/layout/AppLayout'
import ExecutionMatrix from '@/pages/ExecutionMatrix'
import BusinessOverview from '@/pages/BusinessOverview'
import { BusinessShell } from '@/components/layout/BusinessShell'
// Business Portal pages (lazy-loaded stubs until built)
import { lazy, Suspense } from 'react'
const BusinessAlerts = lazy(() => import('@/pages/business/BusinessAlerts'))
const BusinessSources = lazy(() => import('@/pages/business/BusinessSources'))
const BusinessCatalog = lazy(() => import('@/pages/business/BusinessCatalog'))
const DatasetDetail = lazy(() => import('@/pages/business/DatasetDetail'))
const BusinessRequests = lazy(() => import('@/pages/business/BusinessRequests'))
const BusinessHelp = lazy(() => import('@/pages/business/BusinessHelp'))
// Gold Studio pages (lazy-loaded)
const GoldLedger = lazy(() => import('@/pages/gold/GoldLedger'))
const GoldClusters = lazy(() => import('@/pages/gold/GoldClusters'))
const GoldCanonical = lazy(() => import('@/pages/gold/GoldCanonical'))
const GoldSpecs = lazy(() => import('@/pages/gold/GoldSpecs'))
const GoldValidation = lazy(() => import('@/pages/gold/GoldValidation'))

function BPPage({ children }: { children: React.ReactNode }) {
  return (
    <BusinessShell>
      <Suspense fallback={<div className="p-8 text-sm" style={{ color: "var(--bp-ink-muted)" }}>Loading…</div>}>
        {children}
      </Suspense>
    </BusinessShell>
  )
}
import EngineControl from '@/pages/EngineControl'
import ErrorIntelligence from '@/pages/ErrorIntelligence'
import AdminGateway from '@/pages/AdminGateway'
import FlowExplorer from '@/pages/FlowExplorer'
import SourceManager from '@/pages/SourceManager'
import DataBlender from '@/pages/DataBlender'
import ControlPlane from '@/pages/ControlPlane'
import ExecutionLog from '@/pages/ExecutionLog'
import RecordCounts from '@/pages/RecordCounts'
import Settings from '@/pages/Settings'
import CleansingRuleEditor from '@/pages/CleansingRuleEditor'
import ScdAudit from '@/pages/ScdAudit'
import GoldMlvManager from '@/pages/GoldMlvManager'
import DqScorecard from '@/pages/DqScorecard'
import DataJourney from '@/pages/DataJourney'
import ConfigManager from '@/pages/ConfigManager'
import NotebookConfig from '@/pages/NotebookConfig'
import PipelineRunner from '@/pages/PipelineRunner'
import ValidationChecklist from '@/pages/ValidationChecklist'
import NotebookDebug from '@/pages/NotebookDebug'
import LiveMonitor from '@/pages/LiveMonitor'
import EnvironmentSetup from '@/pages/EnvironmentSetup'
import SqlExplorer from '@/pages/SqlExplorer'
import LoadProgress from '@/pages/LoadProgress'
import DataProfiler from '@/pages/DataProfiler'
import ColumnEvolution from '@/pages/ColumnEvolution'
import DataMicroscope from '@/pages/DataMicroscope'
import SankeyFlow from '@/pages/SankeyFlow'
import TransformationReplay from '@/pages/TransformationReplay'
import ImpactPulse from '@/pages/ImpactPulse'
import TestAudit from '@/pages/TestAudit'
import TestSwarm from '@/pages/TestSwarm'
import MRI from '@/pages/MRI'
import DataLineage from '@/pages/DataLineage'
import DataClassification from '@/pages/DataClassification'
import DataCatalog from '@/pages/DataCatalog'
import ImpactAnalysis from '@/pages/ImpactAnalysis'
import DatabaseExplorer from '@/pages/DatabaseExplorer'
import DataManager from '@/pages/DataManager'
import LoadCenter from '@/pages/LoadCenter'
import LoadMissionControl from '@/pages/LoadMissionControl'

/** Redirect "/" to the Overview page — same landing for both personas */
function HomeLanding() {
  return <Navigate to="/overview" replace />;
}

function App() {
  return (
    <PersonaProvider>
    <BackgroundTaskProvider>
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomeLanding />} />
        {/* Business Portal routes */}
        <Route path="/overview" element={<div className="bp-shell min-h-full"><BusinessOverview /></div>} />
        <Route path="/alerts" element={<BPPage><BusinessAlerts /></BPPage>} />
        <Route path="/sources-portal" element={<BPPage><BusinessSources /></BPPage>} />
        <Route path="/catalog-portal" element={<BPPage><BusinessCatalog /></BPPage>} />
        <Route path="/catalog-portal/:id" element={<BPPage><DatasetDetail /></BPPage>} />
        <Route path="/requests" element={<BPPage><BusinessRequests /></BPPage>} />
        <Route path="/help" element={<BPPage><BusinessHelp /></BPPage>} />
        {/* Engineering Console routes */}
        <Route path="/matrix" element={<ExecutionMatrix />} />
        <Route path="/engine" element={<EngineControl />} />
        <Route path="/control" element={<ControlPlane />} />
        <Route path="/logs" element={<ExecutionLog />} />
        <Route path="/errors" element={<ErrorIntelligence />} />
        <Route path="/admin" element={<AdminGateway />} />
        <Route path="/flow" element={<FlowExplorer />} />
        <Route path="/sources" element={<SourceManager />} />
        <Route path="/blender" element={<DataBlender />} />
        <Route path="/counts" element={<RecordCounts />} />
        <Route path="/journey" element={<DataJourney />} />
        <Route path="/config" element={<ConfigManager />} />
        <Route path="/notebook-config" element={<NotebookConfig />} />
        <Route path="/runner" element={<PipelineRunner />} />
        <Route path="/validation" element={<ValidationChecklist />} />
        <Route path="/notebook-debug" element={<NotebookDebug />} />
        <Route path="/live" element={<LiveMonitor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/setup" element={<EnvironmentSetup />} />
        <Route path="/sql-explorer" element={<SqlExplorer />} />
        <Route path="/load-progress" element={<LoadProgress />} />
        <Route path="/profile" element={<DataProfiler />} />
        <Route path="/columns" element={<ColumnEvolution />} />
        <Route path="/microscope" element={<DataMicroscope />} />
        <Route path="/sankey" element={<SankeyFlow />} />
        <Route path="/replay" element={<TransformationReplay />} />
        <Route path="/pulse" element={<ImpactPulse />} />
        <Route path="/test-audit" element={<TestAudit />} />
        <Route path="/test-swarm" element={<TestSwarm />} />
        <Route path="/mri" element={<MRI />} />
        {/* Gold Studio pages */}
        <Route path="/gold" element={<Navigate to="/gold/ledger" replace />} />
        <Route path="/gold/ledger" element={<Suspense fallback={<div className="p-8" style={{ color: "var(--bp-ink-muted)" }}>Loading…</div>}><GoldLedger /></Suspense>} />
        <Route path="/gold/clusters" element={<Suspense fallback={<div className="p-8" style={{ color: "var(--bp-ink-muted)" }}>Loading…</div>}><GoldClusters /></Suspense>} />
        <Route path="/gold/canonical" element={<Suspense fallback={<div className="p-8" style={{ color: "var(--bp-ink-muted)" }}>Loading…</div>}><GoldCanonical /></Suspense>} />
        <Route path="/gold/specs" element={<Suspense fallback={<div className="p-8" style={{ color: "var(--bp-ink-muted)" }}>Loading…</div>}><GoldSpecs /></Suspense>} />
        <Route path="/gold/validation" element={<Suspense fallback={<div className="p-8" style={{ color: "var(--bp-ink-muted)" }}>Loading…</div>}><GoldValidation /></Suspense>} />
        {/* Governance pages */}
        <Route path="/lineage" element={<DataLineage />} />
        <Route path="/classification" element={<DataClassification />} />
        <Route path="/catalog" element={<DataCatalog />} />
        <Route path="/impact" element={<ImpactAnalysis />} />
        <Route path="/db-explorer" element={<DatabaseExplorer />} />
        <Route path="/data-manager" element={<DataManager />} />
        <Route path="/load-center" element={<LoadCenter />} />
        <Route path="/load-mission-control" element={<LoadMissionControl />} />
        {/* Labs pages — always routed, nav visibility controlled by feature flags */}
        <Route path="/labs/cleansing" element={<CleansingRuleEditor />} />
        <Route path="/labs/scd-audit" element={<ScdAudit />} />
        <Route path="/labs/gold-mlv" element={<GoldMlvManager />} />
        <Route path="/labs/dq-scorecard" element={<DqScorecard />} />
      </Routes>
    </AppLayout>
    </BackgroundTaskProvider>
    </PersonaProvider>
  )
}

export default App
