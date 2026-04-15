# Communication Chrome Audit

Date: 2026-04-13

## Scope

This audit focused on the persistent communication layer that was added to help users understand where they are, why a page matters, and what happens next.

The review found that the noise was not random copy sprawl. It came from a small set of shared UI systems that were all trying to solve the same orientation problem at the same time.

## Main Findings

1. `BusinessIntentHeader` was used on 8 page surfaces and exposed the full explanation stack all at once: summary paragraph, three intent pills, cross-links, and a guide trigger.
2. `ExploreWorkbenchHeader` was used on 13 workbench surfaces and repeated the same pattern with summary text, guide content, and metric cards competing for attention.
3. `CompactPageHeader` was used on 6 engineering pages and turned short summaries plus fact cards into a second hero layer before the real content began.
4. `GoldStudioLayout` was used on 7 workflow pages and stacked stage explanation, context cards, activity chips, and the stage rail inside one sticky header region.
5. `BackgroundTaskToast` defaulted to expanded, which meant every active background job occupied a persistent attention block on top of already-verbose pages.

## Design Direction

The communication objective remains valid: every page should still help users orient quickly and understand the next move.

The problem was delivery, not intent.

The revised pattern uses:

- quieter one-line summaries instead of full always-on paragraphs where possible
- a shared disclosure trigger that opens an animated guide panel for deeper explanation
- compact signal chips instead of secondary grids of explainer cards
- reduced sticky-header density in Gold Studio
- a collapsed-by-default task dock for background work

## Shared Changes Applied

1. `IntentGuidePopover` now carries the deeper narrative and links in a calmer animated panel.
2. `BusinessIntentHeader` now keeps one-line orientation visible and moves the heavier explanation stack behind the guide panel.
3. `ExploreWorkbenchHeader` now uses the same disclosure pattern and compresses fact cards into signal chips.
4. `CompactPageHeader` now treats summary copy as a brief, not a second hero block, and compresses its metrics.
5. `GoldContextBar`, `GoldActivityFeed`, and `GoldStageRail` were reduced to lighter-weight, scan-first surfaces.
6. `BackgroundTaskToast` now stays minimized until the user opens it or a failure demands attention.

## Result

The application still communicates continuously, but the communication now behaves like context that can step forward when needed instead of permanent narration competing with the actual tool surface.
