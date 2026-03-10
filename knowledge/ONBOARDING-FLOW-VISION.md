# Source Onboarding Flow — The Only Flow That Matters

> **Author**: Steve Nahrup
> **Date**: 2026-03-10
> **Priority**: CRITICAL — This is the product vision. Everything else serves this.

---

## The Problem

The framework currently exposes implementation details that no one after Steve will understand: "activation," "Bronze entities," "Silver flags," "load optimization," "watermark columns," "incremental vs full load." These are engine internals. The end user should never see them, never think about them, never need to know they exist.

If the person operating this framework needs to know what "activated" means, or why Bronze must complete before Silver starts, or what a watermark column is — **the framework has failed.**

---

## The Only User Flow

### What the user sees:

1. **"I want to load a source into the architecture."**
2. They open the wizard.
3. They select/configure a source connection (SQL Server, etc.).
4. They see their tables listed.
5. They click "Import" (or select tables and click Import).
6. They watch a progress view as tables move through stages: **Discovering → Importing → Optimizing → Complete**.
7. Done. Every table is loaded, optimized, and ready for Gold/reporting.

### What happens behind the scenes (invisible to user):

**Step 1 — Registration & Activation (instant, all-at-once)**
- Every selected table is registered as a LandingzoneEntity
- Bronze and Silver entities are auto-created and **immediately activated** for ALL layers
- The correct order is enforced internally: LZ → Bronze → Silver
- The user never sees "LandingzoneEntity," "BronzeLayerEntity," or "SilverLayerEntity" — they see "tables"

**Step 2 — Load Optimization Analysis (runs once, first import only)**
- For every table: discover primary keys, watermark columns (datetime/rowversion/identity), row counts
- Determine incremental load strategy: which column to use as watermark, what type of load
- Store the optimization results permanently in metadata
- **This analysis happens exactly ONE time per table — on first import**
- After this, every subsequent load is incremental automatically
- The user sees "Optimizing..." in the progress view, nothing more

**Step 3 — Initial Full Load (runs once, first import only)**
- Landing Zone: Full copy of every table from source → LZ lakehouse
- Bronze: Full processing from LZ → Bronze lakehouse (schema standardization, dedup, type casting)
- Silver: Full processing from Bronze → Silver lakehouse (business logic, joins, cleansing)
- Each layer waits for the previous layer to complete before starting
- The user sees tables moving through "Importing..." with a progress bar

**Step 4 — Ongoing Incremental Loads (every subsequent run)**
- Watermark-based incremental loads — only new/changed rows since last load
- The framework handles this automatically using the optimization results from Step 2
- No user intervention, no configuration, no "activation"
- Scheduled or on-demand via the dashboard

---

## Design Principles

1. **Zero internal vocabulary exposed.** No "activation," "entity," "watermark," "landing zone" in the UI. Use "tables," "import," "sources," "stages."

2. **One action, full pipeline.** Clicking "Import" triggers the ENTIRE chain: register → activate all layers → optimize → load LZ → load Bronze → load Silver. Not separate steps.

3. **First load is special, invisibly.** The first import does full analysis + full load. Every subsequent run is incremental. The user doesn't choose this — it just happens.

4. **Correct ordering is the framework's job.** Bronze waits for LZ. Silver waits for Bronze. The user never sequences anything. No entity should ever be "active" for a layer that hasn't received data from the previous layer.

5. **The wizard is the only entry point.** No one should ever need to run scripts, call stored procedures, or manually activate entities. If they do, the framework is incomplete.

6. **Progress is visible, internals are not.** Show "Importing table X... (142 of 596)" — not "Executing PL_FMD_LOAD_LANDING_BRONZE ForEach batch 3/15."

---

## What This Means for Current Architecture

### Must Fix
- **The 1,458 "invalid activations" are a symptom.** Silver was activated before Bronze completed because the activation step is decoupled from the load step. These must be a single atomic operation.
- **`deploy_from_scratch.py` Phase 13 (entity registration) must cascade through ALL layers AND trigger initial load** — not just register and hope someone runs the pipelines later.
- **Load optimization (Phase 14) must be part of the import flow**, not a separate VPN-dependent step.

### Must Build
- **Source Import Wizard** — the UI that replaces all manual scripting
- **Orchestrated Import Pipeline** — a single API call that does register → activate → optimize → load (all layers, correct order)
- **Progress tracking** — real-time status visible in dashboard as import progresses

### Must Kill
- Any UI or documentation that exposes "activation" as a user-facing concept
- Any workflow that requires manual sequencing of LZ → Bronze → Silver
- Any process that activates a layer before the previous layer has data

---

## The Test

> Can someone who has never seen this framework before load a new SQL Server source into the architecture using only the dashboard wizard, with zero knowledge of medallion architecture, entity activation, or load optimization?

If yes: the framework works.
If no: it's not done yet.
