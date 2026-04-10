// ============================================================================
// Business Help — Glossary + Getting Started for Business Portal.
//
// Design system: Industrial Precision, Light Mode
// All styles use BP CSS custom properties (--bp-*)
// Static content — no API calls
// ============================================================================

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { BusinessIntentHeader } from "@/components/business";
import {
  Search,
  ChevronDown,
  Clock,
  BarChart3,
  MessageSquare,
  Database,
} from "lucide-react";

// ── Glossary Data ──

const GLOSSARY = [
  {
    term: "Table",
    definition:
      "A single database table from a source system. The fundamental unit of data in the platform.",
    technical: "Entity / LandingzoneEntity",
  },
  {
    term: "Source",
    definition:
      "An external database or system that provides data to the platform (e.g., ERP, manufacturing, quality management systems).",
    technical: "DataSource / Namespace",
  },
  {
    term: "Source Files",
    definition:
      "The raw, unmodified copy of data as it was extracted from the source system.",
    technical: "Landing Zone (LZ)",
  },
  {
    term: "Raw Data",
    definition:
      "Data that has been validated and type-checked but not yet transformed or cleaned.",
    technical: "Bronze Layer",
  },
  {
    term: "Clean Data",
    definition:
      "Fully transformed, deduplicated, and business-ready data suitable for reporting.",
    technical: "Silver Layer",
  },
  {
    term: "Analytics Data",
    definition:
      "Pre-built datasets optimized for specific business questions and dashboards.",
    technical: "Gold Layer",
  },
  {
    term: "Data Collection",
    definition:
      "A group of related datasets organized by business domain (e.g., Sales, Inventory, Quality).",
    technical: "Gold Domain",
  },
  {
    term: "Dataset",
    definition:
      "A curated, business-named view of data within a collection, ready for analysis.",
    technical: "Gold Model / Materialized Lakehouse View (MLV)",
  },
  {
    term: "Quality Score",
    definition:
      "A 0-100 rating measuring data completeness, consistency, and timeliness. Gold (90+), Silver (70-89), Bronze (40-69).",
    technical: "Composite quality score from DQ rules",
  },
  {
    term: "Freshness",
    definition:
      "How recently the data was updated from its source. Measured against an expected schedule (SLA).",
    technical: "LastLoadDateTime vs threshold",
  },
  {
    term: "SLA",
    definition:
      "Service Level Agreement \u2014 the promised schedule for data updates. If data isn't refreshed within the SLA window, an alert is raised.",
    technical: "Freshness threshold configuration",
  },
  {
    term: "Domain",
    definition:
      "A business area that owns and is responsible for a set of data (e.g., Manufacturing, Finance, Supply Chain).",
    technical: "Business domain / data stewardship domain",
  },
  {
    term: "Full Load",
    definition:
      "A complete refresh that replaces all existing data with a fresh copy from the source.",
    technical: "Full extraction \u2014 no watermark, truncate + reload",
  },
  {
    term: "Incremental Load",
    definition:
      "A smart update that only transfers data that changed since the last refresh, saving time and resources.",
    technical: "Watermark-based extraction using LastModified or ID column",
  },
  {
    term: "Data Refresh",
    definition:
      "The automated process of pulling updated data from source systems into the platform.",
    technical: "Pipeline run / ETL execution",
  },
];

// ── Guide Data ──

interface GuideItem {
  icon: React.ElementType;
  title: string;
  description: string;
  linkText: string;
  href: string;
}

const GUIDES: GuideItem[] = [
  {
    icon: Clock,
    title: "Check Data Freshness",
    description:
      "Visit the Overview page to see at a glance whether your data is up to date. The freshness percentage shows how many tables are on schedule.",
    linkText: "Go to Overview",
    href: "/overview",
  },
  {
    icon: Search,
    title: "Find a Table",
    description:
      "Use the Catalog to search across all source tables. Filter by source, quality tier, or browse curated Data Collections.",
    linkText: "Open Catalog",
    href: "/catalog-portal",
  },
  {
    icon: BarChart3,
    title: "Understand Data Quality",
    description:
      "Every table has a quality score from 0 to 100. Gold (90+) means excellent. Click any table in the Catalog to see its quality breakdown.",
    linkText: "Browse Catalog",
    href: "/catalog-portal",
  },
  {
    icon: MessageSquare,
    title: "Request New Data",
    description:
      "Need data that isn't available yet? Submit a request and the data team will review it.",
    linkText: "Make a Request",
    href: "/requests",
  },
  {
    icon: Database,
    title: "Check Source Health",
    description:
      "The Sources page shows whether each source system is connected and healthy, with table counts and last refresh times.",
    linkText: "View Sources",
    href: "/sources-portal",
  },
];

// ── Glossary Term Component ──

function GlossaryItem({
  term,
  definition,
  technical,
}: {
  term: string;
  definition: string;
  technical: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg px-5 py-4"
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border-subtle)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div
            className="text-[14px] font-semibold mb-1"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
          >
            {term}
          </div>
          <div
            className="text-[13px] leading-relaxed"
            style={{ color: "var(--bp-ink-secondary)", fontFamily: "var(--bp-font-body)" }}
          >
            {definition}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 mt-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors"
          style={{
            color: "var(--bp-ink-tertiary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--bp-font-body)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bp-copper)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bp-ink-tertiary)")}
        >
          Technical
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </button>
      </div>

      {expanded && (
        <div
          className="mt-3 rounded-lg px-3 py-2"
          style={{ background: "var(--bp-surface-inset)" }}
        >
          <span
            className="bp-mono text-[12px]"
            style={{ color: "var(--bp-ink-secondary)" }}
          >
            {technical}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Guide Card Component ──

function GuideCard({ guide }: { guide: GuideItem }) {
  const Icon = guide.icon;
  return (
    <div className="bp-card p-5">
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 mt-0.5"
          style={{ color: "var(--bp-copper)" }}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[14px] font-semibold mb-1.5"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
          >
            {guide.title}
          </div>
          <div
            className="text-[13px] leading-relaxed mb-3"
            style={{ color: "var(--bp-ink-secondary)", fontFamily: "var(--bp-font-body)" }}
          >
            {guide.description}
          </div>
          <Link to={guide.href} className="bp-link text-[13px] inline-flex items-center gap-1">
            {guide.linkText} <span aria-hidden="true">{"\u2192"}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function BusinessHelp() {
  const [search, setSearch] = useState("");

  const filteredGlossary = useMemo(() => {
    if (!search.trim()) return GLOSSARY;
    const q = search.toLowerCase();
    return GLOSSARY.filter(
      (item) =>
        item.term.toLowerCase().includes(q) ||
        item.definition.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="p-8 max-w-[1280px]">
      <BusinessIntentHeader
        title="Help"
        meta={`${filteredGlossary.length.toLocaleString()} terms visible`}
        summary="This page explains the platform in plain language for a zero-context business user. It translates technical terms, points people to the right starting routes, and reduces the need for side-channel explanation."
        items={[
          {
            label: "What This Page Is",
            value: "Glossary and guided orientation",
            detail: "Use this page to understand the language of the platform and to find the right workspace before asking someone else what a term means.",
          },
          {
            label: "Why It Matters",
            value: "Shared language reduces friction",
            detail: "If users cannot decode terms like source, collection, quality score, or gold layer, they will avoid the product or misread what they are seeing.",
          },
          {
            label: "What Happens Next",
            value: "Translate first, then navigate with confidence",
            detail: "Read the glossary, use the getting-started guides on the right, and then move into overview, catalog, requests, or sources with a clearer mental model.",
          },
        ]}
        links={[
          { label: "Open Overview", to: "/overview" },
          { label: "Open Catalog", to: "/catalog-portal" },
          { label: "Open Requests", to: "/requests" },
        ]}
      />

      {/* Two-column layout */}
      <div className="grid gap-8" style={{ gridTemplateColumns: "3fr 2fr" }}>
        {/* ── Left: Glossary ── */}
        <div>
          <h2
            className="bp-display text-[24px] mb-4"
            style={{ color: "var(--bp-ink-primary)" }}
          >
            Glossary
          </h2>

          {/* Search */}
          <div
            className="flex items-center gap-2 rounded-lg px-4 mb-5"
            style={{
              background: "var(--bp-surface-inset)",
              height: "48px",
            }}
          >
            <Search
              className="h-4 w-4 shrink-0"
              style={{ color: "var(--bp-ink-muted)" }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search terms..."
              className="w-full bg-transparent outline-none text-[14px]"
              style={{
                color: "var(--bp-ink-primary)",
                fontFamily: "var(--bp-font-body)",
              }}
            />
          </div>

          {/* Term list */}
          {filteredGlossary.length === 0 ? (
            <div
              className="px-5 py-12 text-center text-[14px] rounded-lg"
              style={{
                color: "var(--bp-ink-muted)",
                background: "var(--bp-surface-1)",
                border: "1px solid var(--bp-border-subtle)",
              }}
            >
              No matching terms
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredGlossary.map((item) => (
                <GlossaryItem
                  key={item.term}
                  term={item.term}
                  definition={item.definition}
                  technical={item.technical}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Getting Started ── */}
        <div>
          <h2
            className="bp-display text-[24px] mb-4"
            style={{ color: "var(--bp-ink-primary)" }}
          >
            Getting Started
          </h2>

          <div className="flex flex-col gap-4">
            {GUIDES.map((guide) => (
              <GuideCard key={guide.title} guide={guide} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
