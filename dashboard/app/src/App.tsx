import { Routes, Route } from 'react-router-dom'
import { BackgroundTaskProvider } from '@/contexts/BackgroundTaskContext'
import { AppLayout } from '@/components/layout/AppLayout'
import ExecutionMatrix from '@/pages/ExecutionMatrix'
import EngineControl from '@/pages/EngineControl'
import PipelineMonitor from '@/pages/PipelineMonitor'
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

function App() {
  return (
    <BackgroundTaskProvider>
    <AppLayout>
      <Routes>
        <Route path="/" element={<ExecutionMatrix />} />
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
        {/* Labs pages — always routed, nav visibility controlled by feature flags */}
        <Route path="/labs/cleansing" element={<CleansingRuleEditor />} />
        <Route path="/labs/scd-audit" element={<ScdAudit />} />
        <Route path="/labs/gold-mlv" element={<GoldMlvManager />} />
        <Route path="/labs/dq-scorecard" element={<DqScorecard />} />
      </Routes>
    </AppLayout>
    </BackgroundTaskProvider>
  )
}

export default App
