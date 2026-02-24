import { Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import PipelineMonitor from '@/pages/PipelineMonitor'
import ErrorIntelligence from '@/pages/ErrorIntelligence'
import AdminGovernance from '@/pages/AdminGovernance'
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

function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<PipelineMonitor />} />
        <Route path="/control" element={<ControlPlane />} />
        <Route path="/logs" element={<ExecutionLog />} />
        <Route path="/errors" element={<ErrorIntelligence />} />
        <Route path="/admin" element={<AdminGovernance />} />
        <Route path="/flow" element={<FlowExplorer />} />
        <Route path="/sources" element={<SourceManager />} />
        <Route path="/blender" element={<DataBlender />} />
        <Route path="/counts" element={<RecordCounts />} />
        <Route path="/journey" element={<DataJourney />} />
        <Route path="/settings" element={<Settings />} />
        {/* Labs pages — always routed, nav visibility controlled by feature flags */}
        <Route path="/labs/cleansing" element={<CleansingRuleEditor />} />
        <Route path="/labs/scd-audit" element={<ScdAudit />} />
        <Route path="/labs/gold-mlv" element={<GoldMlvManager />} />
        <Route path="/labs/dq-scorecard" element={<DqScorecard />} />
      </Routes>
    </AppLayout>
  )
}

export default App
