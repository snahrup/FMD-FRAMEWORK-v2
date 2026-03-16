import { Routes, Route, Navigate } from 'react-router-dom'
import { BackgroundTaskProvider } from '@/contexts/BackgroundTaskContext'
import { PersonaProvider, usePersona } from '@/contexts/PersonaContext'
import { AppLayout } from '@/components/layout/AppLayout'
import ExecutionMatrix from '@/pages/ExecutionMatrix'
import BusinessOverview from '@/pages/BusinessOverview'
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

/** Redirect "/" to the persona-appropriate landing page */
function HomeLanding() {
  const { isBusiness } = usePersona();
  return <Navigate to={isBusiness ? "/overview" : "/matrix"} replace />;
}

function App() {
  return (
    <PersonaProvider>
    <BackgroundTaskProvider>
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomeLanding />} />
        <Route path="/overview" element={<BusinessOverview />} />
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
        {/* Governance pages */}
        <Route path="/lineage" element={<DataLineage />} />
        <Route path="/classification" element={<DataClassification />} />
        <Route path="/catalog" element={<DataCatalog />} />
        <Route path="/impact" element={<ImpactAnalysis />} />
        <Route path="/db-explorer" element={<DatabaseExplorer />} />
        <Route path="/data-manager" element={<DataManager />} />
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
