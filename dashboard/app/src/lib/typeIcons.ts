import {
  Type,
  Hash,
  Calendar,
  CircleDot,
  ToggleLeft,
  Binary,
  Fingerprint,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

// ── Canonical Data Type → Icon/Color Mapping ──
// Extracted from ColumnEvolution, DataProfiler, DataMicroscope.
// Import this instead of defining TYPE_ICON_MAP per page.

export interface TypeIconConfig {
  icon: LucideIcon;
  label: string;
  color: string;      // Tailwind text-* class
  bg: string;          // Tailwind bg-* class
  hex: string;         // Raw hex for Recharts/SVG
}

const STRING_CFG:  TypeIconConfig = { icon: Type,        label: "String",    color: "text-blue-400",    bg: "bg-blue-500/10",    hex: "#3b82f6" };
const INT_CFG:     TypeIconConfig = { icon: Hash,        label: "Integer",   color: "text-emerald-400", bg: "bg-emerald-500/10", hex: "#10b981" };
const DECIMAL_CFG: TypeIconConfig = { icon: CircleDot,   label: "Decimal",   color: "text-orange-400",  bg: "bg-orange-500/10",  hex: "#f97316" };
const DATE_CFG:    TypeIconConfig = { icon: Calendar,    label: "DateTime",  color: "text-purple-400",  bg: "bg-purple-500/10",  hex: "#a855f7" };
const BOOL_CFG:    TypeIconConfig = { icon: ToggleLeft,  label: "Boolean",   color: "text-pink-400",    bg: "bg-pink-500/10",    hex: "#ec4899" };
const BINARY_CFG:  TypeIconConfig = { icon: Binary,      label: "Binary",    color: "text-gray-400",    bg: "bg-gray-500/10",    hex: "#64748b" };
const GUID_CFG:    TypeIconConfig = { icon: Fingerprint, label: "GUID",      color: "text-violet-400",  bg: "bg-violet-500/10",  hex: "#8b5cf6" };

const FALLBACK: TypeIconConfig = { icon: HelpCircle, label: "Unknown", color: "text-slate-400", bg: "bg-slate-500/10", hex: "#94a3b8" };

export const TYPE_ICON_MAP: Record<string, TypeIconConfig> = {
  // String types
  string:    STRING_CFG,
  varchar:   STRING_CFG,
  nvarchar:  { ...STRING_CFG, label: "NVarchar" },
  char:      { ...STRING_CFG, label: "Char" },
  nchar:     { ...STRING_CFG, label: "NChar" },
  text:      { ...STRING_CFG, label: "Text" },
  ntext:     { ...STRING_CFG, label: "NText" },
  xml:       { ...STRING_CFG, label: "XML" },

  // Integer types
  int:       INT_CFG,
  bigint:    { ...INT_CFG, label: "BigInt" },
  smallint:  { ...INT_CFG, label: "SmallInt" },
  tinyint:   { ...INT_CFG, label: "TinyInt" },
  long:      { ...INT_CFG, label: "Long" },
  short:     { ...INT_CFG, label: "Short" },

  // Decimal/float types
  decimal:   DECIMAL_CFG,
  numeric:   { ...DECIMAL_CFG, label: "Numeric" },
  float:     { ...DECIMAL_CFG, label: "Float" },
  double:    { ...DECIMAL_CFG, label: "Double" },
  real:      { ...DECIMAL_CFG, label: "Real" },
  money:     { ...DECIMAL_CFG, label: "Money" },
  smallmoney:{ ...DECIMAL_CFG, label: "SmallMoney" },

  // DateTime types
  datetime:  DATE_CFG,
  datetime2: { ...DATE_CFG, label: "DateTime2" },
  datetimeoffset: { ...DATE_CFG, label: "DateTimeOffset" },
  date:      { ...DATE_CFG, label: "Date" },
  time:      { ...DATE_CFG, label: "Time" },
  timestamp: { ...DATE_CFG, label: "Timestamp" },
  smalldatetime: { ...DATE_CFG, label: "SmallDateTime" },

  // Boolean
  bit:       BOOL_CFG,
  boolean:   BOOL_CFG,

  // Binary
  binary:    BINARY_CFG,
  varbinary: { ...BINARY_CFG, label: "VarBinary" },
  image:     { ...BINARY_CFG, label: "Image" },
  rowversion:{ ...BINARY_CFG, label: "RowVersion" },

  // Identifiers
  uniqueidentifier: GUID_CFG,
  guid:      GUID_CFG,
};

/** Resolve a SQL/Spark type name to its icon config. Case-insensitive, strips size suffixes. */
export function resolveTypeIcon(rawType: string | null | undefined): TypeIconConfig {
  if (!rawType) return FALLBACK;
  // Normalize: lowercase, strip parens/size (e.g., "nvarchar(255)" → "nvarchar")
  const key = rawType.toLowerCase().replace(/\(.*\)/, "").trim();
  return TYPE_ICON_MAP[key] ?? FALLBACK;
}

/** Group data types by category for summary displays. */
export const TYPE_CATEGORIES = [
  { ...STRING_CFG,  key: "string",  types: ["string","varchar","nvarchar","char","nchar","text","ntext","xml"] },
  { ...INT_CFG,     key: "integer", types: ["int","bigint","smallint","tinyint","long","short"] },
  { ...DECIMAL_CFG, key: "decimal", types: ["decimal","numeric","float","double","real","money","smallmoney"] },
  { ...DATE_CFG,    key: "date",    types: ["datetime","datetime2","datetimeoffset","date","time","timestamp","smalldatetime"] },
  { ...BOOL_CFG,    key: "boolean", types: ["bit","boolean"] },
  { ...BINARY_CFG,  key: "binary",  types: ["binary","varbinary","image","rowversion"] },
  { ...GUID_CFG,    key: "guid",    types: ["uniqueidentifier","guid"] },
] as const;
