import type { Meta, StoryObj } from "@storybook/react";
import { SpecimenCard } from "@/components/gold/SpecimenCard";

const meta = {
  title: "Gold Studio/Specimen Card",
  component: SpecimenCard,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpecimenCard>;

export default meta;
type Story = StoryObj<typeof SpecimenCard>;

const noop = () => {};

// ─────────────────────────────────────────────────────
// Structural specimens — full provenance lifecycle
// ─────────────────────────────────────────────────────

export const StructuralQueued: Story = {
  args: {
    specimen: {
      id: 1,
      name: "SalesReport_Monthly",
      type: "rdl",
      division: "Sales",
      source_system: "M3 ERP",
      steward: "S. Nahrup",
      description: "Monthly sales summary",
      job_state: "queued",
      tags: "sales,monthly",
      created_at: "2026-03-18T10:00:00Z",
      provenance_phase: 1,
      source_class: "structural",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const StructuralExtracting: Story = {
  args: {
    specimen: {
      id: 2,
      name: "Finance_Dashboard_v3",
      type: "pbix",
      division: "Finance",
      source_system: "ETQ",
      steward: "J. Chen",
      description: null,
      job_state: "extracting",
      tags: null,
      created_at: "2026-03-18T11:00:00Z",
      provenance_phase: 1,
      source_class: "structural",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const StructuralExtracted: Story = {
  args: {
    specimen: {
      id: 3,
      name: "Production_Yield_Report",
      type: "rdl",
      division: "Production",
      source_system: "MES",
      steward: "S. Nahrup",
      description: "Yield analysis by line",
      job_state: "extracted",
      tags: "production,yield",
      created_at: "2026-03-15T09:00:00Z",
      entity_count: 12,
      column_count: 87,
      provenance_phase: 2,
      source_class: "structural",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const StructuralParseWarning: Story = {
  args: {
    specimen: {
      id: 4,
      name: "QC_Inspection_Query",
      type: "sql",
      division: "Quality",
      source_system: "ETQ",
      steward: "M. Park",
      description: "Quality inspection aggregation",
      job_state: "parse_warning",
      tags: "quality",
      created_at: "2026-03-14T14:00:00Z",
      entity_count: 3,
      column_count: 21,
      provenance_phase: 2,
      source_class: "structural",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const StructuralParseFailed: Story = {
  args: {
    specimen: {
      id: 5,
      name: "Legacy_Inventory_Dashboard",
      type: "pbix",
      division: "Enterprise Core",
      source_system: "M3 Cloud",
      steward: "S. Nahrup",
      description: "Deprecated inventory view",
      job_state: "parse_failed",
      tags: null,
      created_at: "2026-03-13T08:00:00Z",
      provenance_phase: 1,
      source_class: "structural",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const StructuralNeedsConnection: Story = {
  args: {
    specimen: {
      id: 6,
      name: "Customer_Tabular_Model",
      type: "bim",
      division: "Sales",
      source_system: null,
      steward: "S. Nahrup",
      description: "Tabular model for customer analytics",
      job_state: "needs_connection",
      tags: "customer,tabular",
      created_at: "2026-03-12T16:00:00Z",
      source_class: "structural",
    },
    expanded: false,
    onToggle: noop,
  },
};

// ─────────────────────────────────────────────────────
// Supporting specimens — flat badge, no provenance
// ─────────────────────────────────────────────────────

export const SupportingExcel: Story = {
  args: {
    specimen: {
      id: 7,
      name: "Field_Mapping_Sheet_Sales",
      type: "excel",
      division: "Sales",
      source_system: "M3 ERP",
      steward: "S. Nahrup",
      description: "Column mapping between legacy and new schema",
      job_state: "accepted",
      tags: "mapping,sales",
      created_at: "2026-03-17T10:00:00Z",
      source_class: "supporting",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const SupportingCSV: Story = {
  args: {
    specimen: {
      id: 8,
      name: "Data_Dictionary_Production",
      type: "csv",
      division: "Production",
      source_system: null,
      steward: "M. Park",
      description: "Standard field definitions",
      job_state: "accepted",
      tags: "dictionary",
      created_at: "2026-03-16T09:00:00Z",
      source_class: "supporting",
    },
    expanded: false,
    onToggle: noop,
  },
};

// ─────────────────────────────────────────────────────
// Contextual specimens — flat badge, no provenance
// ─────────────────────────────────────────────────────

export const ContextualScreenshot: Story = {
  args: {
    specimen: {
      id: 9,
      name: "Sales_Dashboard_Screenshot_Current",
      type: "screenshot",
      division: "Sales",
      source_system: null,
      steward: "S. Nahrup",
      description: "Current state of the monthly sales dashboard for recreation reference",
      job_state: "accepted",
      tags: "screenshot,sales",
      created_at: "2026-03-18T15:00:00Z",
      source_class: "contextual",
    },
    expanded: false,
    onToggle: noop,
  },
};

export const ContextualNote: Story = {
  args: {
    specimen: {
      id: 10,
      name: "Finance_KPI_Requirements",
      type: "note",
      division: "Finance",
      source_system: null,
      steward: "J. Chen",
      description: "Stakeholder requirements for KPI recreation",
      job_state: "accepted",
      tags: "requirements,finance",
      created_at: "2026-03-17T14:00:00Z",
      source_class: "contextual",
    },
    expanded: false,
    onToggle: noop,
  },
};

// ─────────────────────────────────────────────────────
// Expanded states — tables & queries tabs
// ─────────────────────────────────────────────────────

export const ExpandedTablesTab: Story = {
  args: {
    specimen: {
      id: 3,
      name: "Production_Yield_Report",
      type: "rdl",
      division: "Production",
      source_system: "MES",
      steward: "S. Nahrup",
      description: "Yield analysis by line",
      job_state: "extracted",
      tags: "production,yield",
      created_at: "2026-03-15T09:00:00Z",
      entity_count: 12,
      column_count: 87,
      provenance_phase: 2,
      source_class: "structural",
    },
    expanded: true,
    onToggle: noop,
    entities: [
      { id: 1, entity_name: "OISTAT", source_database: "m3fdbprd", column_count: 42, provenance: "extracted", cluster_id: 3 },
      { id: 2, entity_name: "OOLINE", source_database: "m3fdbprd", column_count: 31, provenance: "extracted", cluster_id: 3 },
      { id: 3, entity_name: "OCUSMA", source_database: "m3fdbprd", column_count: 67, provenance: "clustered", cluster_id: null },
      { id: 4, entity_name: "MITMAS", source_database: "m3fdbprd", column_count: 89, provenance: "imported", cluster_id: null },
    ],
  },
};

export const ExpandedQueriesTab: Story = {
  args: {
    specimen: {
      id: 4,
      name: "QC_Inspection_Query",
      type: "sql",
      division: "Quality",
      source_system: "ETQ",
      steward: "M. Park",
      description: "Quality inspection aggregation",
      job_state: "extracted",
      tags: "quality",
      created_at: "2026-03-14T14:00:00Z",
      entity_count: 3,
      column_count: 21,
      provenance_phase: 2,
      source_class: "structural",
    },
    expanded: true,
    onToggle: noop,
    queries: [
      {
        id: 1,
        query_name: "GetInspectionResults",
        query_text:
          "SELECT i.InspectionID, i.PartNumber, i.Result,\n       i.InspectedDate, i.Inspector\nFROM QC_Inspections i\nJOIN Parts p ON i.PartNumber = p.PartNumber\nWHERE i.InspectedDate >= DATEADD(month, -3, GETDATE())\nORDER BY i.InspectedDate DESC",
        query_type: "select",
        source_database: "ETQStagingPRD",
      },
      {
        id: 2,
        query_name: "DefectSummary",
        query_text:
          "SELECT DefectType, COUNT(*) AS DefectCount,\n       AVG(Severity) AS AvgSeverity\nFROM QC_Defects\nGROUP BY DefectType\nHAVING COUNT(*) > 5",
        query_type: "select",
        source_database: "ETQStagingPRD",
      },
    ],
  },
};
