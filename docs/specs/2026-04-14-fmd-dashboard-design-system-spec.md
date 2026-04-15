# Design System Specification: Industrial Precision

## 1. Overview & Creative North Star

### The Creative North Star: "Industrial Precision"

The live FMD Framework dashboard does not follow a glossy "control room" aesthetic. The implemented system is a **light-mode operational workbench** built on warm paper neutrals, restrained copper accents, tabular data treatment, and quiet borders. The intent is editorial clarity with manufacturing discipline: complex pipeline state should feel curated, legible, and sober rather than cinematic.

This system breaks the generic dashboard look through:

*   **Warm Paper Foundation:** Large areas sit on a soft paper canvas instead of cold greys or dark chrome.

*   **Borders-Only Structure:** Hierarchy is created with surface shifts and low-opacity borders rather than shadows, glow, or glass cards.

*   **Status Rails & Tonal Semantics:** Health, caution, and failure are signaled through narrow rails, tinted badges, and earthy semantic colors instead of loud alert chrome.

## 2. Colors

The implemented palette is anchored in warm neutrals and industrial accent colors. The dashboard is effectively **light-theme only** in the Business Portal layer; the dark token override mirrors the same light palette.

### Core Palettes

*   **Background & Surfaces:**

    *   **Canvas (`--bp-canvas` `#F4F2ED`):** Primary page and sidebar background.

    *   **Primary Surface (`--bp-surface-1` `#FEFDFB`):** Standard cards, panels, and raised content surfaces.

    *   **Inset Surface (`--bp-surface-inset` `#F9F7F3`):** Search bars, inputs, segmented toggles, and secondary embedded areas.

*   **Accents:**

    *   **Copper (`--bp-copper` `#B45624`):** Primary action color, active navigation rail, key links, and editorial emphasis.

    *   **Copper Hover (`--bp-copper-hover` `#9A4A1F`):** Hover state for links and buttons.

    *   **Copper Soft (`--bp-copper-soft` `rgba(180,86,36,0.10)` / `--bp-copper-light` `#F4E8DF`):** Soft emphasis fills and hero tinting.

*   **Status & Operational Colors:**

    *   **Operational (`--bp-operational` `#3D7C4F`):** Healthy, complete, ready, or stable states.

    *   **Caution (`--bp-caution` `#C27A1A`):** Warnings, queued work, degraded conditions.

    *   **Fault (`--bp-fault` `#B93A2A`):** Failures, blockers, critical exceptions.

    *   **Info (`--bp-info` `#3B82F6`):** Active/in-progress or informational states where blue is needed.

*   **Layer Colors:**

    *   **Landing (`--bp-lz` `#5B8AB5`)**

    *   **Bronze (`--bp-bronze` `#92400E`)**

    *   **Silver (`--bp-silver` `#475569`)**

    *   **Gold (`--bp-gold` `#8B6914`)**

### The Border Rule

The implemented dashboard does **not** follow a no-line rule. Borders are part of the live visual language and are used deliberately at low opacity:

1.  **Primary Border (`--bp-border` `rgba(0,0,0,0.08)`):** Standard card, button, and input outline.

2.  **Subtle Border (`--bp-border-subtle` `rgba(0,0,0,0.04)`):** Panel dividers and row separators.

3.  **Strong Border (`--bp-border-strong` `rgba(0,0,0,0.14)`):** Hover and focus strengthening, never the default resting state.

### The Gradient & Glass Rule

The live app uses gradients selectively and glass almost not at all:

1.  **Hero / emphasis gradients:** Shared page headers and some quality-tier surfaces use soft linear gradients with copper-tinted warm neutrals, for example `linear-gradient(135deg, rgba(180,86,36,0.04) 0%, rgba(250,247,243,0.96) 52%, rgba(255,255,255,0.96) 100%)`.

2.  **Tier badges:** Gold, silver, and bronze quality badges use subtle tonal gradients.

3.  **Glassmorphism is not a system rule:** The only shipped blur treatment is a light `4px` backdrop blur on modal backdrops. Cards, headers, and overlays are not built as high-opacity glass panels.

## 3. Typography

The shipped dashboard uses **Manrope** as the default font family. All Business Portal font roles point to the same family through `--font-family`, and the font can be swapped at runtime via font settings, but the implementation baseline is Manrope.

| Role | Token | Size | Weight | Intent |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | `--bp-font-display` / `.bp-display` | `24px` mobile, `32px` desktop utility; shared page header title commonly `28px` | `400` | Page titles, hero treatments, large numeric moments |
| **Headline** | `text-h1` / shared header title pattern | `20px` mobile, `28px` desktop | `400-600` | Route-level titles and major section leads |
| **Title** | panel/card heading treatment | `13px-14px` | `600` | Card headers, table group titles, operational sections |
| **Body** | `text-body` / `--bp-font-body` | `15px` mobile, `16px` desktop utility; shared summaries commonly `12px-13px` | `400-500` | Descriptions, metadata, helper text, general UI copy |
| **Label** | compact metadata pattern | `10px-12px` | `600` | Uppercase eyebrow labels, nav group headers, fact labels, status captions |
| **Data / Mono** | `.bp-mono` / `--bp-font-mono` | usually `11px-16px` | `400-700` | Tabular counts, run IDs, timestamps, numeric KPI values |

**Editorial Contrast:** The live hierarchy relies on pairing `10px-11px` uppercase labels with `22px-32px` tabular numbers or `28px` shared page titles. The contrast comes from spacing, case, and numeric scale, not from switching to serif or true monospace families.

## 4. Elevation & Depth

The dashboard avoids shadow-based SaaS depth. The implemented system is **borders-only + tonal layering**.

*   **The Layering Principle:**

    *   Base canvas: `--bp-canvas` (`#F4F2ED`)

    *   Main content surface: `--bp-surface-1` (`#FEFDFB`)

    *   Embedded/inset surface: `--bp-surface-inset` (`#F9F7F3`)

    *   Cards and input wells are distinguished primarily through these surface shifts plus low-opacity borders.

*   **Ambient Shadows:** Shared BP shadows are explicitly `none`. Hover states strengthen border color or add small translate animations; they do not introduce blur shadows.

*   **The Border Escalation Rule:** The "ghost border" is not a fallback in the live system, it is the default structure. Cards rest at `rgba(0,0,0,0.08)` and escalate to `rgba(0,0,0,0.14)` on hover or emphasis.

## 5. Components

### Pill Buttons & Chips

*   **Primary Button:** The base shared primary button (`.bp-btn-primary`) is a compact rounded rectangle, not a pill. It uses `--bp-copper` background, white text, `14px` size, `600` weight, `8px 20px` padding, and a `6px` radius.

*   **Secondary Button:** Secondary controls use `--bp-surface-1`, `--bp-ink-primary`, a `1px` `--bp-border` outline, `13px` text, and `6px` radius.

*   **Header Facts / Inline Action Pills:** Fully rounded pills do exist, but they are page-level inline elements for facts, filters, and micro-actions rather than the default system button shape.

*   **Badges / Chips:** Standard badges use `4px` radius, `11px` text, `600` weight, semantic tinted fills, and matching low-opacity borders.

### Data Visualization

*   **Status Rails:** The signature system marker is a `3px` left-edge rail on cards. Operational rails are green, caution rails are amber, and fault rails are red with a subtle pulse animation.

*   **Source Indicators:** Source markers use an `8px` circular dot (`.bp-source-dot`) rather than a boxed token.

*   **Charts & Layer Color:** Charts and pipeline visuals pull from copper, blue, green, bronze, silver, and gold tokens. Layer storytelling is color-coded directly through the medallion palette instead of a generic chart set.

*   **Numeric Alignment:** KPI values, counts, timestamps, and record totals use tabular numeric settings via `.bp-mono`.

### Cards & Lists

*   **Radius:** Standard cards use `8px`, inset controls use `6px`, and badges use `4px`. The live app does not use oversized editorial radii like `1rem` or `2rem` as a shared default.

*   **Card Structure:** Cards are `--bp-surface-1` with `1px solid var(--bp-border)` and no shadow.

*   **Panel Headers:** Internal card headers use `16px 20px` padding with a `1px solid var(--bp-border-subtle)` divider.

*   **Lists and Rows:** The live system does use traditional separators. Lists are commonly split with `border-bottom: 1px solid var(--bp-border-subtle)` and may strengthen border color on hover.

## 6. Do’s and Don’ts

### Do

*   **DO** use the warm paper stack: `--bp-canvas`, `--bp-surface-1`, and `--bp-surface-inset`.

*   **DO** use copper as the main interaction accent and the left rail as the main active-state marker.

*   **DO** use low-opacity borders as the primary separation mechanism.

*   **DO** use `Manrope` consistently across display, body, and data contexts, while enabling tabular numerics for data-heavy UI.

*   **DO** keep motion subtle and short: slide/fade/scale transitions live mostly in the `150ms-400ms` range.

### Don't

*   **DON'T** add drop shadows to cards, modals, or hover states as a primary depth mechanism.

*   **DON'T** reintroduce a mixed serif / sans / mono identity unless the font system is being intentionally redesigned end-to-end.

*   **DON'T** swap the warm copper-and-paper palette for cool, saturated "network operations center" blues and blacks.

*   **DON'T** use heavy opaque borders or black dividers; stay inside the existing `0.04-0.14` opacity border range.

*   **DON'T** treat glassmorphism as a dashboard-wide rule; the shipped system is flat, bordered, and light.
