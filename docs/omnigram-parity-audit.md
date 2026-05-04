# Omnigram Parity Audit

Updated: 2026-05-04

## Scope

This audit tracks desktop Unigram parity for the current `omnigram` branch. Legacy code in `src/old/**` remains reference-only; Omnigram code must stay on the Pixi renderer plus React chrome architecture and preserve the current corner-aware grid snapping behavior.

The URL video downloader is intentionally excluded from Omnigram because it may create commercial-use compliance risk. Video parity is limited to local file drops, `.unigram` media blobs, and playable in-app overlays.

## Matrix

| Area | Legacy behavior | Omnigram status | Remaining work |
|---|---|---|---|
| Graph editing | Create/delete/move, box-select, copy/paste, undo/redo, resize handles, edge creation. | Core editor exists; resize handles restored with current snap semantics; temporary unnamed nodes are deleted when naming is cancelled or left empty. | Broaden E2E coverage around resize, rename cancel, multi-select, paste, and locked-node edge cases. |
| Grid snapping | Default snap-to-grid with top-left/corner alignment in legacy feel. | Preserve current Omnigram mechanic exactly: placement/drag/resize snap node corner to grid. | Add regression coverage any time pointer math changes. |
| Media/content | Image/gif/audio/video nodes; markdown/math preview; local media visible immediately. | Rich DOM overlays are capped at 10 focused/high-LOD nodes; video/audio controls, image/gif previews, and sanitized markdown/math previews render over Pixi nodes. Video file drop stores a blob and plays immediately. | Add deeper UI tests for overlay cap, content scrolling, and media bundle hydration. |
| Video URL | Legacy had a local downloader flow. | Excluded for compliance. No `/api/youtube`, `yt-dlp`, Express, or CORS proxy remains in the active project. | None unless a legally safe external integration is explicitly approved later. |
| RMM/MPD | Recursive zoom handoff, child preview, MPD dial/curtain. | Core RMM/MPD exists and registry updates are preserved during active model changes. | More parity smoke around dimension rename/selection preservation and curtain frame timing. |
| Connections | Dash styles, arrow styles, labels, evidence/reference popup, selected connection split/reveal. | Popup supports three disclosure levels; selected edges visually split open; legacy `triangle` and `circle` arrow styles are supported. Evidence/reference fields import as first-class references. | Refine exact legacy popup animation timing and add tests for all reference levels. |
| Panels/chrome | Sidebars, bottom toolbar, debug/FPS overlay. | Side panels are close; FPS/debug overlay moved outside the left sidebar footprint. | Recheck bottom toolbar spacing/action ordering against Unigram screenshots. |
| Themes/backgrounds/particles | Theme/background/particle registries persisted per model. | Registries and bundle round-trips exist; particles stay renderer-owned. | Compare every preset visually against legacy and add missing presets only if they do not hurt frame budgets. |
| Flow effects | Effect DAG, always-play loops, play cascade glow, selection halo. | Existing halo and flow glow visuals are preserved; connection flow hide fields are preserved/migrated. | Exercise all graph node effects; verify selection halo and play glow respect effect overrides without visual downgrade. |
| Recording | Canvas/OBS recording through flow effects. | Recording helpers remain; downloads are unrelated to video URL acquisition. | More browser coverage for MediaRecorder support/fallbacks. |
| Bundle I/O | `.unigram` zip round-trip with models, media, cosmetics, references. | Bundle schema now persists `crossLinks`; legacy fields such as text formats, membrane visibility, preview refs, references/evidence, and connection flow visibility are preserved. | Add compatibility fixtures from `public/models/**` and record migration expectations. |
| Performance contracts | 1000-2000 nodes, O(1) React canvas, spatial index for hot paths, no full-model clone undo. | Edge culling/picking now uses a dedicated spatial index; LOD uses composed effective scale. | Audit texture/video object URL lifetime, render texture cleanup, always-play flow cleanup, MPD curtain texture disposal, and particle cleanup. |

## Current Implementation Notes

- Rich media overlays are React chrome, not per-node canvas DOM. The cap keeps the graph canvas O(1) with respect to total node count.
- Edge spatial indexing is rebuilt on store sync and updated through incident edge lists during renderer-direct node moves/resizes.
- Selection halo and flow glow were not simplified for optimization.
- The current debug overlay is intentionally offset from the expanded left sidebar so bench numbers remain visible during normal editing.

## Test Targets

- Unit: bundle cross-link round-trip, legacy evidence/reference migration, legacy arrow styles, resize math, snap regression, edge index query coverage.
- UI/component: rich overlay rendering, connection popup disclosure levels, media inspector, toolbar/debug placement.
- E2E: local video drop/playback visibility, resize handles, temporary-name cancellation, connection reveal popup, RMM/MPD smoke.
- Performance: existing bench scenarios plus media-rich, connection-heavy, and flow-glow scenarios; record results in `README.md#benchmarks`.
