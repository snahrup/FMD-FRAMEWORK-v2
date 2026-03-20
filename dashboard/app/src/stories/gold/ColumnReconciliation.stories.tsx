import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";
import { ColumnReconciliation } from "@/components/gold/ColumnReconciliation";

const meta = {
  title: "Gold Studio/Column Reconciliation",
  component: ColumnReconciliation,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 900, margin: "0 auto", height: 600 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ColumnReconciliation>;

export default meta;
type Story = StoryObj<typeof ColumnReconciliation>;

// ─────────────────────────────────────────────────────
// 1. TwoMembersFewColumns — Basic 2-member reconciliation
// ─────────────────────────────────────────────────────

export const TwoMembersFewColumns: Story = {
  args: {
    clusterId: 101,
    members: [
      { id: 1, entity_name: "OISTAT" },
      { id: 2, entity_name: "OOLINE" },
    ],
    columns: [
      {
        column_name: "CONO",
        data_type: "int",
        presence: { 1: true, 2: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "ORNO",
        data_type: "varchar(15)",
        presence: { 1: true, 2: true },
        decision: "include",
        key_designation: "pk",
      },
      {
        column_name: "ORST",
        data_type: "varchar(2)",
        presence: { 1: true, 2: false },
        decision: "review",
        key_designation: null,
        source_expression: { 1: "TRIM(ORST)" },
      },
      {
        column_name: "CUCD",
        data_type: "varchar(3)",
        presence: { 1: true, 2: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "ORQA",
        data_type: "decimal(17,6)",
        presence: { 1: false, 2: true },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "RGDT",
        data_type: "datetime2",
        presence: { 1: true, 2: true },
        decision: "include",
        key_designation: null,
        source_expression: { 1: "CAST(RGDT AS datetime2)", 2: "CAST(RGDT AS datetime2)" },
      },
      {
        column_name: "LMDT",
        data_type: "datetime2",
        presence: { 1: true, 2: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "RESP",
        data_type: "varchar(10)",
        presence: { 1: true, 2: false },
        decision: "review",
        key_designation: null,
      },
    ],
    onSave: action("onSave"),
  },
};

// ─────────────────────────────────────────────────────
// 2. ThreeMembersFullMatrix — 3-member, 15 columns
// ─────────────────────────────────────────────────────

export const ThreeMembersFullMatrix: Story = {
  args: {
    clusterId: 202,
    members: [
      { id: 10, entity_name: "MITMAS" },
      { id: 11, entity_name: "MITBAL" },
      { id: 12, entity_name: "MITFAC" },
    ],
    columns: [
      {
        column_name: "CONO",
        data_type: "int",
        presence: { 10: true, 11: true, 12: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "ITNO",
        data_type: "varchar(15)",
        presence: { 10: true, 11: true, 12: true },
        decision: "include",
        key_designation: "pk",
      },
      {
        column_name: "WHLO",
        data_type: "varchar(3)",
        presence: { 10: false, 11: true, 12: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "FACI",
        data_type: "varchar(3)",
        presence: { 10: false, 11: false, 12: true },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "STAT",
        data_type: "varchar(2)",
        presence: { 10: true, 11: true, 12: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "ITDS",
        data_type: "varchar(30)",
        presence: { 10: true, 11: false, 12: false },
        decision: "review",
        key_designation: null,
        source_expression: { 10: "TRIM(ITDS)" },
      },
      {
        column_name: "ITTY",
        data_type: "varchar(3)",
        presence: { 10: true, 11: false, 12: false },
        decision: "exclude",
        key_designation: null,
      },
      {
        column_name: "STQT",
        data_type: "decimal(17,6)",
        presence: { 10: false, 11: true, 12: false },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "ALQT",
        data_type: "decimal(17,6)",
        presence: { 10: false, 11: true, 12: false },
        decision: "exclude",
        key_designation: null,
      },
      {
        column_name: "PLCD",
        data_type: "int",
        presence: { 10: false, 11: false, 12: true },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "ORQT",
        data_type: "decimal(17,6)",
        presence: { 10: false, 11: true, 12: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "RGDT",
        data_type: "datetime2",
        presence: { 10: true, 11: true, 12: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "LMDT",
        data_type: "datetime2",
        presence: { 10: true, 11: true, 12: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "CHID",
        data_type: "varchar(10)",
        presence: { 10: true, 11: true, 12: true },
        decision: "exclude",
        key_designation: null,
      },
      {
        column_name: "CHNO",
        data_type: "int",
        presence: { 10: true, 11: true, 12: true },
        decision: "exclude",
        key_designation: null,
      },
    ],
    onSave: action("onSave"),
  },
};

// ─────────────────────────────────────────────────────
// 3. AllColumnsResolved — No "review" items remaining
// ─────────────────────────────────────────────────────

export const AllColumnsResolved: Story = {
  args: {
    clusterId: 303,
    members: [
      { id: 20, entity_name: "OEHEAD" },
      { id: 21, entity_name: "OELINE" },
    ],
    columns: [
      {
        column_name: "CONO",
        data_type: "int",
        presence: { 20: true, 21: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "ORNO",
        data_type: "varchar(15)",
        presence: { 20: true, 21: true },
        decision: "include",
        key_designation: "pk",
      },
      {
        column_name: "DESSION",
        data_type: "varchar(10)",
        presence: { 20: true, 21: false },
        decision: "exclude",
        key_designation: null,
      },
      {
        column_name: "CUCD",
        data_type: "varchar(3)",
        presence: { 20: true, 21: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "LMDT",
        data_type: "datetime2",
        presence: { 20: true, 21: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "CHID",
        data_type: "varchar(10)",
        presence: { 20: true, 21: true },
        decision: "exclude",
        key_designation: null,
      },
    ],
    onSave: action("onSave"),
  },
};

// ─────────────────────────────────────────────────────
// 4. PKConflict — Two PKs trigger a warning
// ─────────────────────────────────────────────────────

export const PKConflict: Story = {
  args: {
    clusterId: 404,
    members: [
      { id: 30, entity_name: "MPHEAD" },
      { id: 31, entity_name: "MPLINE" },
    ],
    columns: [
      {
        column_name: "CONO",
        data_type: "int",
        presence: { 30: true, 31: true },
        decision: "include",
        key_designation: "pk",
      },
      {
        column_name: "DESSION",
        data_type: "varchar(10)",
        presence: { 30: true, 31: true },
        decision: "include",
        key_designation: "pk",
      },
      {
        column_name: "PRNO",
        data_type: "varchar(15)",
        presence: { 30: true, 31: true },
        decision: "include",
        key_designation: "bk",
      },
      {
        column_name: "WHLO",
        data_type: "varchar(3)",
        presence: { 30: true, 31: false },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "ORQA",
        data_type: "decimal(17,6)",
        presence: { 30: false, 31: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "STAT",
        data_type: "varchar(2)",
        presence: { 30: true, 31: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "RGDT",
        data_type: "datetime2",
        presence: { 30: true, 31: true },
        decision: "include",
        key_designation: null,
      },
      {
        column_name: "LMDT",
        data_type: "datetime2",
        presence: { 30: true, 31: true },
        decision: "exclude",
        key_designation: null,
      },
    ],
    onSave: action("onSave"),
  },
};

// ─────────────────────────────────────────────────────
// 5. ManyColumns — 25-column stress test
// ─────────────────────────────────────────────────────

export const ManyColumns: Story = {
  args: {
    clusterId: 505,
    members: [
      { id: 40, entity_name: "MHDISH" },
      { id: 41, entity_name: "MDISCH" },
    ],
    columns: [
      { column_name: "CONO", data_type: "int", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "DESSION", data_type: "varchar(10)", presence: { 40: true, 41: true }, decision: "include", key_designation: "pk" },
      { column_name: "WHLO", data_type: "varchar(3)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "ITNO", data_type: "varchar(15)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "FACI", data_type: "varchar(3)", presence: { 40: true, 41: false }, decision: "review", key_designation: null },
      { column_name: "ORQA", data_type: "decimal(17,6)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "ORQT", data_type: "decimal(17,6)", presence: { 40: false, 41: true }, decision: "review", key_designation: null },
      { column_name: "STAT", data_type: "varchar(2)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "RESP", data_type: "varchar(10)", presence: { 40: true, 41: false }, decision: "exclude", key_designation: null },
      { column_name: "CUCD", data_type: "varchar(3)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "CUAM", data_type: "decimal(17,2)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "PRNO", data_type: "varchar(15)", presence: { 40: true, 41: false }, decision: "review", key_designation: null },
      { column_name: "BANO", data_type: "varchar(20)", presence: { 40: false, 41: true }, decision: "review", key_designation: null },
      { column_name: "PLDT", data_type: "datetime2", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "RGDT", data_type: "datetime2", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "LMDT", data_type: "datetime2", presence: { 40: true, 41: true }, decision: "exclude", key_designation: null },
      { column_name: "CHID", data_type: "varchar(10)", presence: { 40: true, 41: true }, decision: "exclude", key_designation: null },
      { column_name: "CHNO", data_type: "int", presence: { 40: true, 41: true }, decision: "exclude", key_designation: null },
      { column_name: "SUNO", data_type: "varchar(10)", presence: { 40: true, 41: false }, decision: "review", key_designation: null },
      { column_name: "REPN", data_type: "varchar(10)", presence: { 40: false, 41: true }, decision: "review", key_designation: null },
      { column_name: "TEDL", data_type: "decimal(17,6)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "GRWE", data_type: "decimal(17,6)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "NEWE", data_type: "decimal(17,6)", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
      { column_name: "VOL3", data_type: "decimal(17,6)", presence: { 40: true, 41: false }, decision: "exclude", key_designation: null },
      { column_name: "PRIO", data_type: "int", presence: { 40: true, 41: true }, decision: "include", key_designation: null },
    ],
    onSave: action("onSave"),
  },
};

// ─────────────────────────────────────────────────────
// 6. WithSourceExpressions — SQL expressions per member
// ─────────────────────────────────────────────────────

export const WithSourceExpressions: Story = {
  args: {
    clusterId: 606,
    members: [
      { id: 50, entity_name: "OOLINE" },
      { id: 51, entity_name: "OOHEAD" },
      { id: 52, entity_name: "OOADDR" },
    ],
    columns: [
      {
        column_name: "CONO",
        data_type: "int",
        presence: { 50: true, 51: true, 52: true },
        decision: "include",
        key_designation: null,
        source_expression: { 50: "CONO", 51: "CONO", 52: "CONO" },
      },
      {
        column_name: "ORNO",
        data_type: "varchar(15)",
        presence: { 50: true, 51: true, 52: true },
        decision: "include",
        key_designation: "pk",
        source_expression: { 50: "TRIM(ORNO)", 51: "TRIM(ORNO)", 52: "TRIM(ORNO)" },
      },
      {
        column_name: "ITNO",
        data_type: "varchar(15)",
        presence: { 50: true, 51: false, 52: false },
        decision: "review",
        key_designation: null,
        source_expression: { 50: "TRIM(ITNO)" },
      },
      {
        column_name: "WHLO",
        data_type: "varchar(3)",
        presence: { 50: true, 51: true, 52: false },
        decision: "include",
        key_designation: null,
        source_expression: { 50: "COALESCE(WHLO, 'DEFAULT')", 51: "COALESCE(WHLO, 'DEFAULT')" },
      },
      {
        column_name: "CUCD",
        data_type: "varchar(3)",
        presence: { 50: true, 51: true, 52: true },
        decision: "include",
        key_designation: null,
        source_expression: { 50: "UPPER(CUCD)", 51: "UPPER(CUCD)", 52: "UPPER(CUCD)" },
      },
      {
        column_name: "ORQA",
        data_type: "decimal(17,6)",
        presence: { 50: true, 51: false, 52: false },
        decision: "include",
        key_designation: null,
        source_expression: { 50: "CAST(ORQA AS decimal(17,6))" },
      },
      {
        column_name: "RGDT",
        data_type: "datetime2",
        presence: { 50: true, 51: true, 52: true },
        decision: "include",
        key_designation: null,
        source_expression: {
          50: "CAST(RGDT AS datetime2)",
          51: "CAST(RGDT AS datetime2)",
          52: "CAST(RGDT AS datetime2)",
        },
      },
      {
        column_name: "LMDT",
        data_type: "datetime2",
        presence: { 50: true, 51: true, 52: true },
        decision: "include",
        key_designation: null,
        source_expression: {
          50: "CAST(LMDT AS datetime2)",
          51: "CAST(LMDT AS datetime2)",
          52: "DATEADD(hour, -5, CAST(LMDT AS datetime2))",
        },
      },
      {
        column_name: "OAAD",
        data_type: "varchar(40)",
        presence: { 50: false, 51: false, 52: true },
        decision: "review",
        key_designation: null,
        source_expression: { 52: "RTRIM(LTRIM(OAAD))" },
      },
      {
        column_name: "DLDT",
        data_type: "datetime2",
        presence: { 50: true, 51: true, 52: false },
        decision: "include",
        key_designation: null,
        source_expression: { 50: "CAST(DLDT AS datetime2)", 51: "CAST(DLDT AS datetime2)" },
      },
    ],
    onSave: action("onSave"),
  },
};

// ─────────────────────────────────────────────────────
// 7. AllReviewState — Everything needs steward attention
// ─────────────────────────────────────────────────────

export const AllReviewState: Story = {
  args: {
    clusterId: 707,
    members: [
      { id: 60, entity_name: "CIDMAS" },
      { id: 61, entity_name: "CIDADR" },
    ],
    columns: [
      {
        column_name: "CONO",
        data_type: "int",
        presence: { 60: true, 61: true },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "CUNO",
        data_type: "varchar(10)",
        presence: { 60: true, 61: true },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "CUNM",
        data_type: "varchar(36)",
        presence: { 60: true, 61: false },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "CUTP",
        data_type: "int",
        presence: { 60: true, 61: false },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "ADR1",
        data_type: "varchar(36)",
        presence: { 60: false, 61: true },
        decision: "review",
        key_designation: null,
      },
      {
        column_name: "PONO",
        data_type: "varchar(16)",
        presence: { 60: false, 61: true },
        decision: "review",
        key_designation: null,
      },
    ],
    onSave: action("onSave"),
  },
};
