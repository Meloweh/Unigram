# AGENTS.md — Omnigram

> **You are working on the `omnigram` branch — a ground-up rewrite of Unigram targeting 1000–2000 interactive graph nodes at ≥60 FPS.**
> Legacy sources have been moved to [src/old/](src/old/) and `server/` and are **OBSOLETE REFERENCE ONLY**. Do not retrofit them. New code lives directly under [src/](src/) (no `src/omni/` subfolder). Read [README.md](README.md) first — it contains the full feature inventory and the staged rebuild roadmap.

## Mission

Rebuild Unigram as **Omnigram**: a recursive-zoom, multi-dimension graph editor where the renderer can sustain ≥60 FPS while drawing 1000+ nodes (target 2000). The legacy app degrades at 200–500 nodes because every node is a React `<article>` with its own subtree, all culling/anchoring is O(N) per store mutation, and undo calls `structuredClone` on the whole model. Omnigram fixes the rendering substrate before adding features.

## Hard Performance Contract

Every change you make must respect these invariants. If a change cannot satisfy them, surface the trade-off explicitly before committing.

1. **Nodes and edges render through a GPU scene graph (PixiJS v8), not React.** React owns the UI shell only (sidebars, modals, toolbars, in-place text editing overlays).
2. **No per-node React component for graph entities.** A scene of 2000 nodes must mount O(1) React components for the canvas, not O(N).
3. **Spatial index is mandatory** for hit-testing, viewport culling, and edge-crossing search. O(N) linear scans on every store mutation are forbidden.
4. **No `structuredClone` of the whole model on edits.** Use structural sharing (Immer-style patches or per-entity records) for undo.
5. **Hot-path mutations (drag, resize, pan, zoom) bypass Zustand subscriptions** and write directly to the renderer; commits to the store happen on gesture end.
6. **Every new feature ships with a benchmark scenario** registered in the bench harness (see `src/bench/` once it exists). If FPS drops below 60 at 1000 nodes, the change is reverted or gated.

## Sequential Build Order (Do Not Skip Ahead)

Implement strictly in this order. Each stage must pass its benchmark before the next begins. Track active work in `manage_todo_list`.

| Stage | Scope | Acceptance |
|---|---|---|
| **1. Graph basics** | Pixi scene + quadtree, create/delete/move nodes, create/delete edges, pan, free-zoom, click-select, viewport culling, LOD (full / simplified / dot) | 2000 simple nodes + ~3000 edges, ≥60 FPS panning & zooming on a mid laptop |
| **2. Optimization pass** | FPS overlay, scripted bench harness (replaces legacy [useBenchmark.ts](src/old/ui/useBenchmark.ts)), GC-free hot paths, structural-sharing undo | Documented bench numbers in [README.md](README.md#benchmarks) |
| **3. Extended graph** | Hybrid recursive-model (RMM) zoom with child-model preview, MPD dial + curtain transition, node dragging (single + multi), 8 standard shapes + 2 cosmetic shapes | ≥60 FPS during zoom transition; curtain transition ≤16 ms/frame |
| **4. Graph details** | Node naming + inline label editing, node/connection settings panels, themes, backgrounds, particle presets, project bundle I/O (`.unigram` zip) | Round-trip parity with legacy bundles in [public/models/](public/models/) |
| **5. Late stage** | Flow effect DAG + editor, cosmetic always-on animations, recording (MediaRecorder + OBS), text generator with synthesized audio | Effects animate without dropping below 60 FPS at 500 visible nodes |

Do not merge unrelated stages. Do not start stage N+1 until stage N's bench passes.

## Stack (Confirmed)

- **Renderer:** [PixiJS v8](https://pixijs.com/) (WebGPU primary, WebGL2 fallback) for **all** graph nodes and edges. Full justification and alternatives reviewed in [README.md §Stack decision](README.md#stack-decision-mass-object-rendering).
- **UI shell:** React 19 — sidebars, modals, in-place text editing overlays. React **never** renders inside the canvas.
- **State:** Zustand 5 with patch-based undo (no `structuredClone`).
- **Spatial index:** custom quadtree in `src/spatial/` (no rbush dep — keep deps low per [specification.md §2](specification.md#2-platform-and-technology-baseline)).
- **Workers:** Vite-native `?worker` imports for layout, untangle, and anchor recompute.
- **Tests:** Vitest 4 (`happy-dom`) + Playwright 1.59 — both are already wired and **must** be kept green.
- **Drop:** `motion` (unused in legacy — see README inventory). Do not add new top-level deps without explicit approval.

## Workspace Layout

New code lives directly under [src/](src/). Legacy code is parked under [src/old/](src/old/) and is reference-only — **do not import from `src/old/` into new code**. Suggested subdivision:

```
src/
  app/          React shell (App.tsx wires here once stage 1 is usable)
  scene/        PixiJS renderer, scene graph, LOD, culling
  spatial/      Quadtree, hit-testing
  model/        Domain types, store, structural-sharing undo
  viewport/     Pan, zoom, gesture handlers (pointer/wheel/touch)
  zoom/         Hybrid RMM zoom math + state machine
  mpd/          Dial + curtain
  ui/           Sidebars, panels, modals (React)
  flow/         (Stage 5) effect DAG engine + editor
  bench/        Benchmark harness + scenarios
  workers/      ?worker entry points
  old/          Legacy reference (delete in one commit after stage 4 reaches parity)
```

## Build / Test / Run

- `npm run dev` — Vite dev server.
- `npm test` — Vitest (run before any commit touching `src/omni/`).
- `npm run test:e2e` — Playwright (run before any commit touching renderer or viewport).
- `npm run lint` — ESLint flat config in [eslint.config.js](eslint.config.js).
- `npm run build` — `tsc -b && vite build`.

## Conventions That Differ From Common Practice

- **Scene units are percentages of a fixed `1920×1080` virtual canvas**, not pixels (legacy `SCENE_W`/`SCENE_H` in [src/old/scene/sceneConstants.ts](src/old/scene/sceneConstants.ts) — keep this contract). Always go through a `clientToScene` helper; never assume CSS pixels.
- **The model is loaded lazily by parent/sibling/children of the active focus region** (see [specification.md §6](specification.md#6-data-and-persistence)). Do not eager-load the full project graph.
- **Undo/redo includes model mutations only** — never camera/zoom state ([specification.md §4.7](specification.md#47-undoredo-scope)).
- **Snap-to-grid is on by default** (`DEFAULT_GRID_SNAP = 4` percent in legacy store). Preserve this.

## Pitfalls That Cost the Legacy Build Performance

When porting any feature, do not repeat these. They are documented in [README.md §Performance cliff analysis](README.md#performance-cliff-analysis).

- Spreading the whole model on every mutation (`{ ...model, nodes: model.nodes.map(...) }`) — invalidates every `useMemo`.
- Bubble-sorting edge anchors on every render with `maxPasses = n*n + 10`.
- A `spatialIndex.ts` that is actually just a `Map<id, Node>` — provides no spatial query.
- `structuredClone(model)` per edit for undo.
- Per-node SVG overlays + CSS `clip-path` + drop shadows + gradients (compositor pressure).
- One rAF loop per cosmetic animated node.
- Markdown/KaTeX content nodes mounting `dangerouslySetInnerHTML` subtrees per node.

## Style

- TypeScript: strict mode (already on). No `any` in new code without `// FIXME:` and a reason.
- Imports: workspace-relative `@/...` once a path alias is added; until then, relative paths are fine. **Never import from `src/old/`.**
- React components: function components + hooks. **No new class components, no new HOCs.**
- Files: one default export per file when the file's name matches the export; otherwise named exports only.
- Tests: every PR adds or updates tests in the same change ([specification.md §9](specification.md#9-test-strategy-requirement-execution-policy)).

## Memory & Notes

- Specification of intent: [specification.md](specification.md). Treat it as the product contract; flag any drift in the PR description.
- Feature inventory (legacy parity checklist): [README.md](README.md).
- Legacy reference files (read-only mental model — do not import from new code):
  - [src/old/scene/hybridZoom.ts](src/old/scene/hybridZoom.ts) — RMM math is correct, port directly.
  - [src/old/scene/edgeAnchoring.ts](src/old/scene/edgeAnchoring.ts) — algorithm is sound, replace the `O(n²)` bubble sort with one incremental update per moved node.
  - [src/old/model/modelLoader.ts](src/old/model/modelLoader.ts) — bundle format is stable, port the schema verbatim.
  - [src/old/mpd/useMpdCurtain.ts](src/old/mpd/useMpdCurtain.ts) — curtain UX, redesign without `flushSync`.
  - [src/old/flow/useFlowEngine.ts](src/old/flow/useFlowEngine.ts) — **do not port shape-for-shape**; the cleanup-bag pattern is what makes it brittle. In Omnigram, effects own scene-graph nodes the renderer can dispose in one call.
