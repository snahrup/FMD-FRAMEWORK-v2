import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";
import { ClusterCard } from "@/components/gold/ClusterCard";
import type { ClusterData, ClusterMember } from "@/components/gold/ClusterCard";

const meta = {
  title: "Gold Studio/Cluster Card",
  component: ClusterCard,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ClusterCard>;

export default meta;
type Story = StoryObj<typeof ClusterCard>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const resolve = action("onResolve");
const confirmGrouping = action("onConfirmGrouping");
const labelChange = action("onLabelChange");
const dismiss = action("onDismiss");

/* ------------------------------------------------------------------ */
/*  1. UnresolvedHighConfidence                                        */
/*     3 MES members, 87% confidence, Production division              */
/* ------------------------------------------------------------------ */

const highConfCluster: ClusterData = {
  id: 1,
  label: null,
  dominant_name: "MHDISH",
  confidence: 87,
  confidence_breakdown: JSON.stringify({ name_similarity: 30, column_overlap: 35, data_pattern: 22 }),
  status: "unresolved",
  resolution: null,
  division: "Production",
  member_count: 3,
};

const highConfMembers: ClusterMember[] = [
  { id: 101, entity_name: "MHDISH", specimen_name: "Production_Yield_Report", source_system: "MES", column_count: 42, match_type: "87% overlap" },
  { id: 102, entity_name: "MHDISL", specimen_name: "Production_Yield_Report", source_system: "MES", column_count: 38, match_type: "87% overlap" },
  { id: 103, entity_name: "MHDISZ", specimen_name: "Production_Yield_Report", source_system: "MES", column_count: 35, match_type: "87% overlap" },
];

export const UnresolvedHighConfidence: Story = {
  args: {
    cluster: highConfCluster,
    members: highConfMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  2. UnresolvedLowConfidence                                         */
/*     2 M3 ERP members, 42% confidence, Sales division                */
/* ------------------------------------------------------------------ */

const lowConfCluster: ClusterData = {
  id: 2,
  label: null,
  dominant_name: "OISTAT",
  confidence: 42,
  confidence_breakdown: JSON.stringify({ name_similarity: 15, column_overlap: 18, data_pattern: 9 }),
  status: "unresolved",
  resolution: null,
  division: "Sales",
  member_count: 2,
};

const lowConfMembers: ClusterMember[] = [
  { id: 201, entity_name: "OISTAT", specimen_name: "Sales_Dashboard_v3", source_system: "M3 ERP", column_count: 67, match_type: "42% overlap" },
  { id: 202, entity_name: "OOLINE", specimen_name: "Sales_Dashboard_v3", source_system: "M3 ERP", column_count: 31, match_type: "42% overlap" },
];

export const UnresolvedLowConfidence: Story = {
  args: {
    cluster: lowConfCluster,
    members: lowConfMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  3. CrossSourceCluster                                              */
/*     3 members from M3 ERP, MES, ETQ — triggers cross-source badge  */
/* ------------------------------------------------------------------ */

const crossSourceCluster: ClusterData = {
  id: 3,
  label: null,
  dominant_name: "MITMAS",
  confidence: 71,
  confidence_breakdown: JSON.stringify({ name_similarity: 22, column_overlap: 28, data_pattern: 21 }),
  status: "unresolved",
  resolution: null,
  division: "Enterprise Core",
  member_count: 3,
};

const crossSourceMembers: ClusterMember[] = [
  { id: 301, entity_name: "MITMAS", specimen_name: "Item_Master_Report", source_system: "M3 ERP", column_count: 89, match_type: "71% overlap" },
  { id: 302, entity_name: "MITMAH", specimen_name: "Production_BOM_Extract", source_system: "MES", column_count: 74, match_type: "71% overlap" },
  { id: 303, entity_name: "MITBAL", specimen_name: "QC_Item_Validation", source_system: "ETQ", column_count: 52, match_type: "71% overlap" },
];

export const CrossSourceCluster: Story = {
  args: {
    cluster: crossSourceCluster,
    members: crossSourceMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  4. Resolved                                                        */
/*     status "resolved", 95% confidence, 2 members                    */
/* ------------------------------------------------------------------ */

const resolvedCluster: ClusterData = {
  id: 4,
  label: "Customer Master",
  dominant_name: "OCUSMA",
  confidence: 95,
  confidence_breakdown: JSON.stringify({ name_similarity: 38, column_overlap: 37, data_pattern: 20 }),
  status: "resolved",
  resolution: "Confirmed as Customer Master — merged OCUSMA variants",
  division: "Sales",
  member_count: 2,
};

const resolvedMembers: ClusterMember[] = [
  { id: 401, entity_name: "OCUSMA", specimen_name: "Customer_Analytics_Model", source_system: "M3 ERP", column_count: 67, match_type: "exact" },
  { id: 402, entity_name: "OCUSAD", specimen_name: "Customer_Analytics_Model", source_system: "M3 ERP", column_count: 54, match_type: "95% overlap" },
];

export const Resolved: Story = {
  args: {
    cluster: resolvedCluster,
    members: resolvedMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  5. Dismissed                                                       */
/*     status "dismissed", naming coincidence                          */
/* ------------------------------------------------------------------ */

const dismissedCluster: ClusterData = {
  id: 5,
  label: null,
  dominant_name: "MWOHED",
  confidence: 33,
  confidence_breakdown: JSON.stringify({ name_similarity: 12, column_overlap: 14, data_pattern: 7 }),
  status: "dismissed",
  resolution: "Not a real cluster — naming coincidence between Production and QC tables",
  division: "Production",
  member_count: 2,
};

const dismissedMembers: ClusterMember[] = [
  { id: 501, entity_name: "MWOHED", specimen_name: "Production_WO_Report", source_system: "MES", column_count: 45, match_type: "33% overlap" },
  { id: 502, entity_name: "MWOMAT", specimen_name: "QC_Materials_Check", source_system: "ETQ", column_count: 38, match_type: "33% overlap" },
];

export const Dismissed: Story = {
  args: {
    cluster: dismissedCluster,
    members: dismissedMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  6. PendingSteward                                                  */
/*     status "pending_steward", 3 members, 65% confidence             */
/* ------------------------------------------------------------------ */

const pendingStewardCluster: ClusterData = {
  id: 6,
  label: "Awaiting SME review",
  dominant_name: "CIDMAS",
  confidence: 65,
  confidence_breakdown: JSON.stringify({ name_similarity: 20, column_overlap: 25, data_pattern: 20 }),
  status: "pending_steward",
  resolution: null,
  division: "Finance",
  member_count: 3,
};

const pendingStewardMembers: ClusterMember[] = [
  { id: 601, entity_name: "CIDMAS", specimen_name: "Finance_AP_Dashboard", source_system: "M3 ERP", column_count: 56, match_type: "65% overlap" },
  { id: 602, entity_name: "CIDVEN", specimen_name: "Finance_AP_Dashboard", source_system: "M3 ERP", column_count: 48, match_type: "65% overlap" },
  { id: 603, entity_name: "FGLEDG", specimen_name: "Finance_GL_Report", source_system: "M3 ERP", column_count: 72, match_type: "65% overlap" },
];

export const PendingSteward: Story = {
  args: {
    cluster: pendingStewardCluster,
    members: pendingStewardMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  7. ReReview                                                        */
/*     status "re_review", flagged after schema change                 */
/* ------------------------------------------------------------------ */

const reReviewCluster: ClusterData = {
  id: 7,
  label: "Flagged after schema change",
  dominant_name: "MPLINE",
  confidence: 58,
  confidence_breakdown: JSON.stringify({ name_similarity: 18, column_overlap: 22, data_pattern: 18 }),
  status: "re_review",
  resolution: null,
  division: "Production",
  member_count: 2,
};

const reReviewMembers: ClusterMember[] = [
  { id: 701, entity_name: "MPLINE", specimen_name: "Production_Line_Analysis", source_system: "MES", column_count: 34, match_type: "58% overlap" },
  { id: 702, entity_name: "MPLIND", specimen_name: "Production_Line_Analysis", source_system: "MES", column_count: 29, match_type: "58% overlap" },
];

export const ReReview: Story = {
  args: {
    cluster: reReviewCluster,
    members: reReviewMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  8. WithLabel                                                       */
/*     Unresolved with user-assigned label                             */
/* ------------------------------------------------------------------ */

const withLabelCluster: ClusterData = {
  id: 8,
  label: "Customer Master Candidates",
  dominant_name: "OCUSMA",
  confidence: 78,
  confidence_breakdown: JSON.stringify({ name_similarity: 28, column_overlap: 30, data_pattern: 20 }),
  status: "unresolved",
  resolution: null,
  division: "Sales",
  member_count: 3,
};

const withLabelMembers: ClusterMember[] = [
  { id: 801, entity_name: "OCUSMA", specimen_name: "Customer_360_Model", source_system: "M3 ERP", column_count: 67, match_type: "exact" },
  { id: 802, entity_name: "OCUSAD", specimen_name: "Customer_360_Model", source_system: "M3 ERP", column_count: 54, match_type: "78% overlap" },
  { id: 803, entity_name: "OCUSEX", specimen_name: "Customer_360_Model", source_system: "M3 ERP", column_count: 41, match_type: "78% overlap" },
];

export const WithLabel: Story = {
  args: {
    cluster: withLabelCluster,
    members: withLabelMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  9. SingleMember                                                    */
/*     Edge case — only 1 member in the cluster                        */
/* ------------------------------------------------------------------ */

const singleMemberCluster: ClusterData = {
  id: 9,
  label: null,
  dominant_name: "MPDWCT",
  confidence: 100,
  confidence_breakdown: JSON.stringify({ name_similarity: 40, column_overlap: 40, data_pattern: 20 }),
  status: "unresolved",
  resolution: null,
  division: "Production",
  member_count: 1,
};

const singleMemberMembers: ClusterMember[] = [
  { id: 901, entity_name: "MPDWCT", specimen_name: "Downtime_Tracking_Report", source_system: "MES", column_count: 28, match_type: "exact" },
];

export const SingleMember: Story = {
  args: {
    cluster: singleMemberCluster,
    members: singleMemberMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};

/* ------------------------------------------------------------------ */
/*  10. ManyMembers                                                    */
/*      6 members, cross-source, 55% confidence                       */
/* ------------------------------------------------------------------ */

const manyMembersCluster: ClusterData = {
  id: 10,
  label: null,
  dominant_name: "OOLINE",
  confidence: 55,
  confidence_breakdown: JSON.stringify({ name_similarity: 16, column_overlap: 22, data_pattern: 17 }),
  status: "unresolved",
  resolution: null,
  division: "Enterprise Core",
  member_count: 6,
};

const manyMembersMembers: ClusterMember[] = [
  { id: 1001, entity_name: "OOLINE", specimen_name: "Sales_Order_Report", source_system: "M3 ERP", column_count: 31, match_type: "55% overlap" },
  { id: 1002, entity_name: "OOHEAD", specimen_name: "Sales_Order_Report", source_system: "M3 ERP", column_count: 48, match_type: "55% overlap" },
  { id: 1003, entity_name: "MWOHED", specimen_name: "Production_WO_Extract", source_system: "MES", column_count: 45, match_type: "55% overlap" },
  { id: 1004, entity_name: "MWOMAT", specimen_name: "Production_WO_Extract", source_system: "MES", column_count: 38, match_type: "55% overlap" },
  { id: 1005, entity_name: "MITBAL", specimen_name: "QC_Inventory_Validation", source_system: "ETQ", column_count: 52, match_type: "55% overlap" },
  { id: 1006, entity_name: "MGLINE", specimen_name: "Formulation_Ingredients", source_system: "OPTIVA", column_count: 36, match_type: "55% overlap" },
];

export const ManyMembers: Story = {
  args: {
    cluster: manyMembersCluster,
    members: manyMembersMembers,
    onResolve: resolve,
    onConfirmGrouping: confirmGrouping,
    onLabelChange: labelChange,
    onDismiss: dismiss,
  },
};
