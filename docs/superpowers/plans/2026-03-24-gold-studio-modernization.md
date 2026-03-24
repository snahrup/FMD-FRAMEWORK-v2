# Gold Studio UI/UX Modernization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate all 6 Gold Studio pages to match LoadMissionControl's premium UX — tiered KPIs, staggered entrance animations, table row status rails, animated tabs, and backdrop blur modals.

**Architecture:** Shared-first approach. Build animation keyframes and utility classes in index.css, then apply per-page. No new components — tiered KPIs built inline per page. No functional changes.

**Tech Stack:** React, TypeScript, CSS custom properties (BP tokens), existing Tailwind utilities

**Spec:** `docs/superpowers/specs/2026-03-24-gold-studio-modernization.md`

---

### Task 1: Shared Animation Keyframes + Utility Classes

**Files:**
- Modify: `dashboard/app/src/index.css` (append after existing `@keyframes` block around line 600)

- [ ] **Step 1: Add Gold Studio animation keyframes to index.css**

Append after the existing `@keyframes bp-skeleton-shimmer` block (~line 602):

```css
/* ── Gold Studio Modernization Animations ── */
@keyframes gsSlideInUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes gsSlideInDown {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes gsFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes gsScaleIn {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes gsFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

/* Utility classes */
.gs-page-enter {
  animation: gsSlideInUp 400ms var(--ease-claude) both;
}
.gs-stagger-card {
  animation: gsSlideInUp 300ms var(--ease-claude) both;
  animation-delay: calc(var(--i, 0) * 40ms);
}
.gs-stagger-row {
  animation: gsFadeIn 200ms var(--ease-claude) both;
  animation-delay: calc(var(--i, 0) * 20ms);
}
.gs-hero-enter {
  animation: gsSlideInDown 300ms var(--ease-claude) both;
  animation-delay: calc(var(--i, 0) * 80ms);
}
.gs-modal-enter {
  animation: gsScaleIn 250ms var(--ease-claude) both;
}
.gs-float {
  animation: gsFloat 3s ease-in-out infinite;
}
.gs-modal-backdrop {
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* Row hover elevation (borders-only per system.md) */
.gs-row-hover {
  transition: transform 150ms var(--ease-claude), border-color 150ms var(--ease-claude);
}
.gs-row-hover:hover {
  transform: translateY(-1px);
  border-color: var(--bp-border-strong) !important;
}
```

- [ ] **Step 2: Verify CSS compiles**

Run: `cd dashboard/app && npx vite build --mode development 2>&1 | head -20`
Expected: No CSS parse errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/index.css
git commit -m "feat(ui): add Gold Studio shared animation keyframes and utility classes

Author: Steve Nahrup"
```

---

### Task 2: GoldStudioLayout — Tab Bar Upgrade + Page Enter Animation

**Files:**
- Modify: `dashboard/app/src/components/gold/GoldStudioLayout.tsx:130-144` (tab nav rendering)
- Modify: `dashboard/app/src/components/gold/GoldStudioLayout.tsx:148` (page content wrapper)

- [ ] **Step 1: Upgrade tab bar rendering**

In `GoldStudioLayout.tsx`, replace the tab nav section (lines 130-144):

```tsx
{/* Tab strip — upgraded with LMC treatment */}
<nav className="flex px-6 gap-1" style={{ borderBottom: "1px solid var(--bp-border)" }}>
  {TABS.map((tab) => {
    const isActive = tab.id === activeTab || location.pathname === tab.path;
    return (
      <Link
        key={tab.id} to={tab.path}
        className={cn("pb-2.5 px-3 text-center transition-all relative", isActive ? "text-[var(--bp-copper)]" : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]")}
        style={{ ...bf, fontWeight: isActive ? 700 : 500, fontSize: 14 }}
      >
        {tab.label}
        {isActive && <span className="absolute bottom-0 left-0 right-0" style={{ height: 2.5, background: "var(--bp-copper)", borderRadius: "1.5px 1.5px 0 0", transition: "all 200ms var(--ease-claude)" }} />}
      </Link>
    );
  })}
</nav>
```

Key changes: fontSize 13→14, fontWeight conditional 500/700, underline height 2→2.5px, pb-2→pb-2.5, px-2.5→px-3.

- [ ] **Step 2: Add page enter animation to content wrapper**

Change line 148 from:
```tsx
<div className="px-6 pt-4">{children}</div>
```
to:
```tsx
<div className="gs-page-enter px-6 pt-4">{children}</div>
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/components/gold/GoldStudioLayout.tsx
git commit -m "feat(ui): upgrade Gold Studio tab bar — larger type, bold active, animated underline

Author: Steve Nahrup"
```

---

### Task 3: GoldClusters — Tiered KPIs, Stagger, Tab Upgrade, Modal, Info Banner

**Files:**
- Modify: `dashboard/app/src/pages/gold/GoldClusters.tsx`

- [ ] **Step 1: Replace StatsStrip with tiered KPI layout**

Replace the `{stats && (<StatsStrip ... />)}` block (lines 349-363) with a two-tier inline KPI:

```tsx
{stats && (
  <div style={{ borderBottom: "1px solid var(--bp-border)", padding: "12px 0 14px" }}>
    {/* Tier 1: Hero metrics */}
    <div className="flex items-end gap-8 mb-2">
      {[
        { label: "Unresolved", value: stats.unresolved, color: stats.unresolved > 0 ? "var(--bp-fault-red)" : "var(--bp-ink-primary)", i: 0 },
        { label: "Total Clusters", value: stats.total_clusters, color: "var(--bp-ink-primary)", i: 1 },
        { label: "Avg Confidence", value: `${stats.avg_confidence}%`, color: "var(--bp-copper)", i: 2 },
      ].map((m) => (
        <div key={m.label} className="gs-hero-enter" style={{ "--i": m.i } as React.CSSProperties}>
          <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
          <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1, color: m.color }}>{m.value}</div>
        </div>
      ))}
    </div>
    {/* Tier 2: Supporting */}
    <div className="flex items-center gap-5">
      {[
        { label: "Resolved", value: stats.resolved },
        { label: "Not Clustered", value: stats.not_clustered, onClick: () => setActiveTab("unclustered") },
      ].map((m, i) => (
        <div key={m.label} className="gs-stagger-row flex items-center gap-1.5" style={{ "--i": i } as React.CSSProperties}
          {...(m.onClick ? { onClick: m.onClick, role: "button", tabIndex: 0, style: { "--i": i, cursor: "pointer" } as React.CSSProperties } : {})}>
          <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
          <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>{m.value}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Replace maturity notice with info banner**

Replace the inline `<p>` (line 366-368) with:

```tsx
<div className="flex items-center gap-2 rounded-md px-3 py-2 mt-2" style={{ background: "var(--bp-caution-light)", border: "1px solid color-mix(in srgb, var(--bp-caution-amber) 20%, transparent)" }}>
  <span style={{ color: "var(--bp-caution-amber)", fontSize: 14 }}>{"\u26A0"}</span>
  <span style={{ fontFamily: "var(--bp-font-body)", fontSize: 11, color: "var(--bp-ink-secondary)", letterSpacing: "0.01em" }}>
    Clustering uses exact name matching within each division. Confidence is fixed at 80%. Fuzzy and schema-aware matching are planned.
  </span>
</div>
```

- [ ] **Step 3: Add stagger animation to ClusterCards**

In the cluster list rendering (line 528-538), wrap each `<ClusterCard>` with stagger. Change:

```tsx
{filtered.map((c) => (
  <ClusterCard ...
```

to:

```tsx
{filtered.map((c, i) => (
  <div key={c.cluster.id} className="gs-stagger-card" style={{ "--i": Math.min(i, 15) } as React.CSSProperties}>
    <ClusterCard ...
```

(Close the wrapping div after `</ClusterCard>`)

- [ ] **Step 4: Add stagger + alternating + rail to unclustered table rows**

In the unclustered table body (lines 564-613), update each `<tr>`:

```tsx
<tr
  key={e.id}
  className="gs-stagger-row gs-row-hover"
  style={{
    "--i": Math.min(i, 15),
    fontFamily: "var(--bp-font-body)",
    color: "var(--bp-ink-primary)",
    borderTop: "1px solid var(--bp-border)",
    background: i % 2 === 1 ? "var(--bp-surface-inset)" : undefined,
    position: "relative",
  } as React.CSSProperties}
>
  {/* Status rail */}
  <td style={{ width: 3, padding: 0, background: "var(--bp-copper)", borderTop: "none" }} />
  ...remaining tds...
```

Add matching `<th>` for the rail column in `<thead>`: `<th style={{ width: 3, padding: 0 }} />` as the first header cell.

- [ ] **Step 5: Upgrade tab switcher**

Update the tab switcher (lines 481-514) — change fontSize 13→14, fontWeight conditional 500/700:

```tsx
style={{
  fontFamily: "var(--bp-font-body)",
  fontWeight: activeTab === tab.id ? 700 : 500,
  fontSize: 14,
  color: activeTab === tab.id ? "var(--bp-copper)" : "var(--bp-ink-muted)",
}}
```

And underline height from 2→2.5:
```tsx
style={{ height: 2.5, background: "var(--bp-copper)", borderRadius: "1.5px 1.5px 0 0" }}
```

- [ ] **Step 6: Upgrade dismiss modal with backdrop blur + scale entrance**

Update the dismiss modal backdrop (line 634):
```tsx
className="fixed inset-0 z-50 flex items-center justify-center gs-modal-backdrop"
style={{ background: "rgba(0,0,0,0.3)" }}
```

Update the modal panel (line 639), add `gs-modal-enter` class:
```tsx
className="gs-modal-enter rounded-lg p-5 w-full max-w-md"
style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border-strong, var(--bp-border))" }}
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldClusters.tsx
git commit -m "feat(ui): modernize GoldClusters — tiered KPIs, stagger cards, tab upgrade, modal blur

Author: Steve Nahrup"
```

---

### Task 4: GoldSpecs — Row Stagger, Alternating Rows, SQL Highlight

**Files:**
- Modify: `dashboard/app/src/pages/gold/GoldSpecs.tsx`

- [ ] **Step 1: Add stagger animation to spec rows**

In the filtered.map rendering (lines 222-254), add stagger to each button row:

```tsx
{filtered.map((s, i) => {
  const badge = VALIDATION_BADGE[s.validation_status] ?? VALIDATION_BADGE.pending;
  return (
    <button key={s.id} type="button" onClick={() => openDetail(s.id)}
      aria-label={`Open spec: ${s.name}`}
      className="gs-stagger-row gs-row-hover w-full text-left flex items-center rounded-lg transition-colors hover:bg-black/[0.03] bp-row-interactive relative overflow-hidden"
      style={{
        "--i": Math.min(i, 15),
        background: i % 2 === 1 ? "var(--bp-surface-inset)" : "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
      } as React.CSSProperties}>
```

- [ ] **Step 2: Add alternating backgrounds to ColumnsTab**

In the ColumnsTab component (lines 376-403), update each `<tr>`:

```tsx
{columns.map((c, i) => (
  <tr key={c.name} className={c.included ? "" : "opacity-50"} style={{ borderBottom: "1px solid var(--bp-border)", background: i % 2 === 1 ? "var(--bp-surface-inset)" : undefined }}>
```

- [ ] **Step 3: Add line hover highlight to SQL tab**

In the SqlTab code block (lines 363-369), add hover background to each line div:

```tsx
{lines.map((l, i) => (
  <div key={i} className="flex transition-colors hover:bg-white/[0.04]" style={{ borderRadius: 2 }}>
```

- [ ] **Step 4: Replace StatsStrip with tiered KPIs**

Replace the `<StatsStrip>` call (lines 184-190) with:

```tsx
<div style={{ borderBottom: "1px solid var(--bp-border)", padding: "12px 6px 14px" }}>
  <div className="flex items-end gap-8 mb-2">
    {[
      { label: "Ready to Deploy", value: stats.ready, color: "var(--bp-operational-green)", i: 0 },
      { label: "Total Specs", value: stats.total, color: "var(--bp-ink-primary)", i: 1 },
      { label: "Pending", value: stats.pending, color: stats.pending > 0 ? "var(--bp-caution-amber)" : "var(--bp-ink-primary)", i: 2 },
    ].map((m) => (
      <div key={m.label} className="gs-hero-enter" style={{ "--i": m.i } as React.CSSProperties}>
        <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
        <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1, color: m.color }}>{m.value}</div>
      </div>
    ))}
  </div>
  <div className="flex items-center gap-5">
    {[
      { label: "Needs Reval.", value: stats.needs_reval },
      { label: "Deprecated", value: stats.deprecated },
    ].map((m, i) => (
      <div key={m.label} className="gs-stagger-row flex items-center gap-1.5" style={{ "--i": i } as React.CSSProperties}>
        <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
        <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>{m.value}</span>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldSpecs.tsx
git commit -m "feat(ui): modernize GoldSpecs — tiered KPIs, row stagger, alternating rows, SQL hover

Author: Steve Nahrup"
```

---

### Task 5: GoldValidation — Tiered KPIs, Row Stagger, Tab Upgrade, Modal Blur

**Files:**
- Modify: `dashboard/app/src/pages/gold/GoldValidation.tsx`

- [ ] **Step 1: Replace StatsStrip with tiered KPIs**

Replace `<StatsStrip items={strip} />` (line 408) with inline tiered layout:

```tsx
<div style={{ borderBottom: "1px solid var(--bp-border)", padding: "12px 0 14px" }}>
  <div className="flex items-end gap-8 mb-2">
    {[
      { label: "Validated", value: stats?.specs_validated ?? 0, color: "var(--bp-operational-green)", i: 0 },
      { label: "Pending", value: pendingCount > 0 ? pendingCount : 0, color: pendingCount > 0 ? "var(--bp-caution-amber)" : "var(--bp-ink-primary)", i: 1 },
      { label: "Certified", value: stats?.catalog_certified ?? 0, color: "var(--bp-copper)", i: 2 },
    ].map((m) => (
      <div key={m.label} className="gs-hero-enter" style={{ "--i": m.i } as React.CSSProperties}>
        <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
        <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1, color: m.color }}>{m.value}</div>
      </div>
    ))}
  </div>
  <div className="flex items-center gap-5">
    {[
      { label: "Cataloged", value: stats?.catalog_published ?? 0 },
      { label: "Total Specs", value: stats?.gold_specs ?? 0 },
    ].map((m, i) => (
      <div key={m.label} className="gs-stagger-row flex items-center gap-1.5" style={{ "--i": i } as React.CSSProperties}>
        <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
        <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>{m.value}</span>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 2: Upgrade sub-tab switcher**

Update the tab bar (lines 410-417) — fontSize 13→14, fontWeight conditional:

```tsx
style={{ ...bf, fontWeight: activeTab === t ? 700 : 500, fontSize: 14, color: activeTab === t ? "var(--bp-copper)" : "var(--bp-ink-muted)" }}
```

Underline height 2→2.5:
```tsx
style={{ height: 2.5, background: "var(--bp-copper)", borderRadius: "1.5px 1.5px 0 0" }}
```

- [ ] **Step 3: Add stagger + alternating + rail to validation table rows**

In the specs.map (lines 427-437), add stagger and alternating backgrounds:

```tsx
{specs.map((s, i) => {
  const c = SPEC_STATUS_CFG[s.status] ?? SPEC_STATUS_CFG.draft;
  return (
    <tr key={s.id}
      className="gs-stagger-row cursor-pointer hover:bg-black/[0.02] transition-colors bp-row-interactive"
      style={{ "--i": Math.min(i, 15), background: i % 2 === 1 ? "var(--bp-surface-inset)" : undefined } as React.CSSProperties}
      onClick={() => openSpec(s)}>
      <td style={{ ...td, width: 3, padding: 0, background: c.color, borderBottom: "1px solid var(--bp-border)" }} />
      <td style={{ ...td, fontWeight: 500 }}>{s.name ?? s.target_name}</td>
      ...
```

Add `<th style={{ width: 3, padding: 0 }} />` as first header cell.

Apply same pattern to catalog table rows (lines 453-468) and report coverage table rows (lines 516-530).

- [ ] **Step 4: Add entrance animation to coverage progress bar**

In the progress bar section (lines 497-508), add transition from 0:

```tsx
<div style={{ width: `${pctCovered}%`, background: "var(--bp-operational-green)", transition: "width 600ms var(--ease-claude)" }} />
<div style={{ width: `${pctPartial}%`, background: "var(--bp-caution-amber)", transition: "width 600ms var(--ease-claude) 200ms" }} />
```

- [ ] **Step 5: Upgrade Modal component with backdrop blur + scale entrance**

Update the Modal component (lines 152-158):

Backdrop:
```tsx
className="fixed inset-0 z-[60] flex items-center justify-center gs-modal-backdrop"
style={{ background: "rgba(0,0,0,0.3)" }}
```

Panel:
```tsx
className="gs-modal-enter rounded-lg w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto"
style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border-strong, var(--bp-border))" }}
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldValidation.tsx
git commit -m "feat(ui): modernize GoldValidation — tiered KPIs, row stagger, tab upgrade, modal blur

Author: Steve Nahrup"
```

---

### Task 6: GoldLedger — Tiered KPIs, Stagger Cards, Modal Upgrade

**Files:**
- Modify: `dashboard/app/src/pages/gold/GoldLedger.tsx`

- [ ] **Step 1: Replace StatsStrip with tiered KPIs**

Replace the `<StatsStrip>` usage with inline tiered layout. Hero metrics: Specimens, Tables Extracted, Columns Cataloged. Supporting: Unresolved Clusters, Canonical Approved, Gold Specs, Certification Rate.

Use same pattern as Task 3 (gs-hero-enter at 36px for heroes, gs-stagger-row at 18px for supporting).

- [ ] **Step 2: Add stagger to SpecimenCard rendering**

In the specimen list rendering, wrap each `<SpecimenCard>` with stagger:

```tsx
<div className="gs-stagger-card" style={{ "--i": Math.min(index, 15) } as React.CSSProperties}>
  <SpecimenCard ... />
</div>
```

- [ ] **Step 3: Upgrade ModalShell with backdrop blur + scale entrance**

In the ModalShell component, update:

Backdrop div: add `gs-modal-backdrop` class, change background to `rgba(0,0,0,0.3)`

Dialog panel: add `gs-modal-enter` class, change border to `var(--bp-border-strong, var(--bp-border))`

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldLedger.tsx
git commit -m "feat(ui): modernize GoldLedger — tiered KPIs, stagger cards, modal blur

Author: Steve Nahrup"
```

---

### Task 7: GoldCanonical — Row Stagger, ReactFlow Polish, Page Enter

**Files:**
- Modify: `dashboard/app/src/pages/gold/GoldCanonical.tsx`

- [ ] **Step 1: Replace StatsStrip with tiered KPIs**

Build inline tiered KPIs. Hero: Canonical Approved (`stats.canonical_approved`), Total Entities (`stats.canonical_total`), Domains (`domains.length`). Supporting: Specimens, Clusters, Gold Specs.

Same pattern as other tasks.

- [ ] **Step 2: Add stagger + alternating to DomainGrid table rows**

In the DomainGrid component, update the entity table rows (lines 475-491):

```tsx
{items.map((e, i) => {
  const sc = STATUS_CFG[e.status];
  return (
    <tr key={e.id}
      className="gs-stagger-row cursor-pointer transition-colors hover:bg-black/[0.02] bp-row-interactive"
      style={{ "--i": Math.min(i, 15), borderBottom: "1px solid var(--bp-border)", background: i % 2 === 1 ? "var(--bp-surface-inset)" : undefined } as React.CSSProperties}
      onClick={() => onSelect(e.id)}>
```

- [ ] **Step 3: Polish ReactFlow node styling**

In the RelationshipMap component, update fact node styles (line 536):
```tsx
style: { width: 280, background: "var(--bp-surface-1)", border: "2px solid var(--bp-copper)", borderRadius: 8, padding: 12, cursor: "pointer", fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-primary)", fontWeight: 500 },
```

This is already using BP tokens — verify. Update dimension nodes (line 547) to use `var(--bp-surface-1)` background and `var(--bp-border)` for border color instead of hardcoded values.

- [ ] **Step 4: Add crossfade on view switch**

Wrap the grid/map views in a container with a CSS transition:

```tsx
<div style={{ animation: "gsFadeIn 200ms var(--ease-claude) both" }} key={view}>
  {view === "grid" ? <DomainGrid ... /> : <RelationshipMap ... />}
</div>
```

Using the `key={view}` prop forces React to re-mount on view change, triggering the animation.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldCanonical.tsx
git commit -m "feat(ui): modernize GoldCanonical — tiered KPIs, row stagger, ReactFlow polish, crossfade

Author: Steve Nahrup"
```

---

### Task 8: GoldMlvManager — Wire Status Rails, Detail Animation, Empty State Float

**Files:**
- Modify: `dashboard/app/src/pages/GoldMlvManager.tsx`

- [ ] **Step 1: Wire STATUS_RAIL_COLORS into table rows**

The `STATUS_RAIL_COLORS` record (lines 76-82) is defined but never rendered on table rows. In the MlvRow component (referenced at line 522), add a 3px left-edge rail cell as the first `<td>`:

```tsx
<td style={{ width: 3, padding: 0, background: STATUS_RAIL_COLORS[item.status] ?? "var(--bp-ink-muted)" }} />
```

- [ ] **Step 2: Add stagger + alternating to table rows**

In the items.map rendering (lines 517-535), add stagger:

```tsx
<MlvRow
  key={item.id}
  item={item}
  ...
  index={idx}
  isOddRow={idx % 2 === 1}
  staggerDelay={Math.min(idx, 15)}
/>
```

In MlvRow's `<tr>`, add:
```tsx
className="gs-stagger-row"
style={{ "--i": staggerDelay, background: isOddRow ? "var(--bp-surface-inset)" : undefined } as React.CSSProperties}
```

- [ ] **Step 3: Add entrance animation on expanded detail row**

When a row expands to show detail, add animation:
```tsx
<tr className="gs-stagger-row" style={{ "--i": 0, background: "var(--bp-surface-inset)" } as React.CSSProperties}>
  <td colSpan={8} className="px-4 py-4">
    {detailLoading ? <Loader2 ... /> : detail && <DetailPanel ... />}
  </td>
</tr>
```

- [ ] **Step 4: Add hover elevation to DomainCards**

In the DomainCard component (lines 159-210), add `gs-row-hover` class:

```tsx
className="gs-stagger-card gs-row-hover rounded-lg text-left transition-all relative overflow-hidden"
```

- [ ] **Step 5: Add gsFloat to empty state icon**

In the empty state (lines 477-493), add float animation:

```tsx
<div className="gs-float w-14 h-14 rounded-2xl flex items-center justify-center mb-5" ...>
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/src/pages/GoldMlvManager.tsx
git commit -m "feat(ui): modernize GoldMlvManager — wire status rails, stagger rows, float empty state

Author: Steve Nahrup"
```

---

### Task 9: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compilation**

Run: `cd dashboard/app && npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 2: Run Vite build**

Run: `cd dashboard/app && npx vite build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 3: Final commit if any fixes needed**

Fix any TypeScript or build errors, then commit fixes.
