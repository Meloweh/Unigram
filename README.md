# Omnigram

> Branch: **`omnigram`** — ground-up rewrite of [Unigram](../../tree/master) targeting **1000–2000 interactive graph nodes at ≥60 FPS**.
>
> The legacy build (`master`) experiences hard FPS cliffs at 200–500 nodes. This rewrite addresses the renderer substrate first, then ports features in priority order.

For agent contributors, start at [AGENTS.md](AGENTS.md). For product intent, see [specification.md](specification.md).

---

## Why a rewrite

The legacy app renders **every node and edge through React/DOM/SVG** while reading from a single Zustand model that is replaced wholesale on every mutation. This stack scales linearly until React's reconciliation cost, the browser's compositor pressure, and per-render `O(N)` memo invalidation collide — measured in practice between 200 and 500 nodes. Adding nodes, edges, or rich content compounds the problem multiplicatively.

Omnigram moves graph rendering off React onto a **PixiJS v8 scene graph**, replaces the unused `motion` dep with hand-tuned rAF, introduces a real **quadtree spatial index**, and switches undo to **structural sharing**. The full performance-cliff analysis is below.

## Stack decision (mass-object rendering)

The single most important decision for this rewrite is the renderer for graph nodes and edges. Below is the alternatives review and the verdict.

### What we actually need to render

- **1000–2000 interactive nodes**, each a textured shape (8 standard + 2 cosmetic shapes), with a label, optional small media (image/video/audio thumb), and selection chrome.
- **~3000–5000 edges** with per-edge stroke style, dash pattern, arrowhead, and a midpoint label.
- **Continuous pan/zoom** — every frame, every visible node and edge transforms together.
- **Per-frame inflation animation** during RMM zoom (one node grows continuously while the camera also zooms).
- **MPD curtain transition** — two scenes briefly compose with a clip mask.
- **Stage 5 effects** — up to a few hundred concurrently-animated nodes.
- **Hit-testing** on irregular polygon shapes (diamond/hexagon/parallelogram/triangle) plus oval/circle.
- **Rich content nodes** (markdown, KaTeX math, video, audio) — but only at the highest LOD where ≤ ~10 are visible at once.

For the 1000–2000-node target, **the bottleneck is not raw triangle throughput** (any GPU renderer can push that). The bottleneck is (a) per-object CPU overhead per frame, (b) batching efficiency so the GPU sees few draw calls, (c) text and rich-content rendering cost, and (d) hit-testing without scanning every node.

### Alternatives compared

| Option | Strengths | Weaknesses for this app | Verdict |
|---|---|---|---|
| **HTML/CSS + DOM (legacy)** | Trivial rich content, accessible, free text | Compositor pressure scales with node count + per-node stacking contexts; per-node React reconciliation; no batching | **Rejected** — root cause of the cliff |
| **SVG only** | Vector-perfect, easy gradient/clip-path | Same DOM-node-per-element scaling problem as HTML; worse compositor cost than canvas | Rejected |
| **Canvas 2D (custom or via [Konva](https://konvajs.org/))** | Simple API, decent for ~500 shapes, easy text | Software-rasterized text/strokes; no batching; per-shape state changes; struggles past ~1000 interactive shapes with rich strokes | Rejected for our target |
| **[Sigma.js](https://www.sigmajs.org/)** / **[Cytoscape.js](https://js.cytoscape.org/)** | Graph-domain primitives built in | Opinionated graph layouts; restricts the unique RMM/MPD UX (continuous zoom into a *child* model embedded in the parent frame); custom shapes and per-edge dash + arrow styling fight the framework | Rejected |
| **[deck.gl](https://deck.gl/)** | Highly batched, GPU-driven | GIS-oriented; visualization-only (no rich interactive editing primitives); huge dep weight; not designed for nested clip masks or scene-graph hierarchies | Rejected |
| **[three.js](https://threejs.org/) (orthographic)** | Mature WebGL/WebGPU, instancing | 3D-first API for a 2D problem; text and 2D shape ergonomics are weak (need MSDF + custom geometry); very capable but more code to reach the same place | Considered, not chosen |
| **[regl](https://github.com/regl-project/regl)** / **raw WebGPU** | Maximum control, minimum overhead | We'd build a 2D scene graph, batcher, text shaper, and culler from scratch — months of work for the same end state | Rejected — cost/benefit |
| **[PixiJS v8](https://pixijs.com/)** (chosen) | 2D-native scene graph; v8 rewrote the batcher (auto-batches up to ~100k Graphics into few draw calls); WebGPU primary with WebGL2 fallback; built-in `Container`, `Graphics`, `Mesh`, `Sprite`, `BitmapText`; `cacheAsTexture` for static subtrees; mature ecosystem; already a dep here | Text rendering of arbitrary fonts needs `BitmapFont` or `HTMLText` (cacheable); custom hit-testing needed for polygon shapes (we already need a quadtree anyway) | **Chosen** |

### Why PixiJS v8 specifically

1. **2D-first API**. `Container`, `Graphics`, `Sprite`, `BitmapText`, `Mesh` map directly onto the legacy concept of "shape + label + selection ring + optional media thumb".
2. **Renderer rewrite in v8**. The new batcher coalesces draw calls aggressively; published benchmarks demonstrate 100k+ animated `Graphics`/sprites at 60 FPS on commodity hardware. Our target of 1000–2000 nodes is **two orders of magnitude below** the renderer's comfortable ceiling — the headroom is what lets us spend cycles on smooth RMM/MPD transitions and stage-5 effects.
3. **WebGPU + WebGL2 fallback** in one API. We get WebGPU's lower CPU overhead where available without code branches.
4. **Already a dependency**. Legacy uses Pixi only for ambient particles ([ParticleOverlay.tsx](src/old/theme/ParticleOverlay.tsx)). Promoting it to the primary renderer adds zero new top-level deps.
5. **`cacheAsTexture`** lets us treat the offscreen rendering of rich content (markdown / KaTeX nodes) as one Pixi `Sprite` per content hash — bypassing Pixi-side text shaping entirely for those nodes.
6. **Explicit lifecycle** (`Container.destroy({ children: true, texture: true })`) — fixes the strongest legacy pain point: the flow-engine cleanup-bag pattern. Effects in Omnigram own a `Container`; stop = one `destroy()` call.

### Hybrid rendering (because not everything belongs on the GPU)

Pure-GPU is the wrong answer for *every* node. The pragmatic split:

| Concern | Renderer | Reason |
|---|---|---|
| Nodes (shape, fill, border, selection ring) | **PixiJS `Graphics` / `Mesh`** | Batched, sub-pixel transforms, GPU-cheap |
| Edges (line, dash, arrowhead, midpoint label) | **PixiJS `Graphics` + `BitmapText`** | All visible per frame; must batch |
| Node labels (single line or short multi-line) | **PixiJS `BitmapText`** with shared atlas | Zero text-shaping per frame |
| Rich content nodes (markdown, KaTeX, image, video) at max LOD | **React/HTML overlay** absolutely positioned, rendered for ≤ ~10 nodes the user is currently focused on | DOM remains the only sane way to host `<video>`/`<iframe>`/contentEditable; cap is enforced by LOD |
| Cosmetic shape paths (chat-bubble, thinking-cloud) | **PixiJS `Graphics` path** built once and reused | One geometry per type, transformed per instance |
| Hit-testing | **Custom quadtree** in `src/spatial/`, with polygon-precise refinement only on the candidate set | O(log N) broad-phase, O(k) narrow-phase |
| MPD curtain | **PixiJS `Mask` / `cacheAsTexture` snapshot** of the outgoing scene | Removes the need for legacy `flushSync` |
| Sidebars, modals, settings panels | **React 19** | UI authoring ergonomics |

This mirrors the architecture used by Figma, Miro, and tldraw: GPU-batched scene graph for the canvas; thin DOM overlay for rich-content nodes the user is actively editing; React only for sidebar UI.

### Headroom check

A back-of-envelope frame budget at 60 FPS = 16.6 ms / frame. A typical mid laptop with WebGL2:

- 2000 `Graphics` containers, each one `drawRect`/`drawPolygon` + `BitmapText` label, all transformed: well inside one batched draw call per material; expected GPU cost < 2 ms.
- 5000 edge `Graphics`: same batching window; expected < 3 ms.
- Quadtree update on a single node move: O(log N), microseconds.
- React reconciliation per frame: zero (no per-node React).
- Total expected frame cost at idle pan/zoom: **< 6 ms**, leaving > 10 ms of headroom for transitions, particles, and stage-5 effects.

This is the published Pixi v8 envelope; we will validate empirically in stage 2's bench harness and record the numbers in [Benchmarks](#benchmarks).

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| `BitmapText` requires a font atlas; arbitrary user fonts are painful | Ship with one well-chosen UI font + KaTeX glyphs; allow per-node `HTMLText` only at high LOD |
| HTML overlay drift from canvas during animation | Anchor overlays to the same world-space coordinate system the renderer uses; update overlay transform in the same rAF tick that draws Pixi |
| WebGPU adoption uneven across browsers/GPUs in 2026 | Pixi v8's transparent WebGL2 fallback covers this with no code change |
| Polygon hit-testing on irregular shapes | Quadtree narrow-phase uses the same `shapeEdgeIntersect` helper already proven in [src/old/scene/edgeAnchoring.ts](src/old/scene/edgeAnchoring.ts) |
| Pixi v8 is a major rewrite of v7 | We are starting fresh; no v7 migration debt |

### Final stack

| Layer | Choice | Reason |
|---|---|---|
| Renderer (graph) | **PixiJS v8** (WebGPU + WebGL2 fallback) | See above |
| UI shell | **React 19** | Sidebars, modals, in-place editors only |
| Rich-content overlay | **React 19** absolutely-positioned, capped by LOD | DOM is the only good host for `<video>`/`contentEditable` |
| State | **Zustand 5** + structural-sharing undo | Cheap selectors; structural sharing avoids `structuredClone` blow-up |
| Spatial index | Custom **quadtree** in `src/spatial/` | No new deps; tailored to our coordinate system |
| Build | **Vite 8** + TypeScript ~6.0 | Unchanged |
| Workers | Vite `?worker` (layout, untangle, anchor recompute) | Already proven in legacy [`workers/`](src/old/workers/) |
| Tests | **Vitest 4** (happy-dom) + **Playwright 1.59** | Already wired; must stay green |
| Project bundle | **JSZip 3** | Schema port from legacy |
| Content | **marked 18** + **DOMPurify 3** + **KaTeX 0.16** | Used only for the few markdown/math content nodes; rendered into a cached texture once per content hash |
| Removed | `motion` | Unused in legacy code |

## Build / Run

```bash
npm install
npm run dev          # Vite dev server
npm test             # Vitest
npm run test:e2e     # Playwright
npm run lint
npm run build
```

## Sequential rebuild plan

The stages below are strictly ordered. Each stage closes with a benchmark before the next begins. Detailed acceptance criteria live in [AGENTS.md](AGENTS.md#sequential-build-order-do-not-skip-ahead).

1. **Graph basics** — Pixi scene + quadtree, node/edge CRUD, pan, free-zoom, select, viewport culling, LOD.
2. **Optimization** — FPS overlay, bench harness, GC-free hot paths, structural-sharing undo.
3. **Extended graph** — Hybrid RMM zoom + child preview, MPD dial + curtain, node dragging, shapes (8 standard + 2 cosmetic).
4. **Graph details** — Naming, settings panels, themes, backgrounds, particle presets, project I/O.
5. **Late stage** — Flow effect DAG + editor, cosmetic always-on animations, recording (MediaRecorder + OBS), text generator.

---

# Legacy feature inventory (parity checklist)

Everything below documents what `master` does today. Each item is a port target for the staged plan above. File references point into the obsolete `src/old/**` tree, which is reference-only on this branch.

## Tech actually used in legacy

| Dep | Role | Centrality |
|---|---|---|
| `react` 19 + `react-dom` | Every node and edge renders as React/DOM/SVG | **Central** (and the root cause of the perf cliff) |
| `vite` 8, `typescript` ~6.0, `@vitejs/plugin-react` | Build + workers + HMR | Central |
| `zustand` 5 | Single store: models, undo/redo, zoom stack, cosmetics ([useHybridZoomStore.ts](src/old/model/useHybridZoomStore.ts), 940 lines) | Central |
| `pixi.js` 8.17 | **Only** used by ambient particle overlay ([ParticleOverlay.tsx](src/old/theme/ParticleOverlay.tsx)) | Peripheral in legacy — central in Omnigram |
| `jszip` 3 | `.unigram` bundle import/export | Central for project I/O |
| `katex` 0.16, `marked` 18, `dompurify` 3 | Math + markdown content nodes | Used in nodes |
| `motion` 12 | **Listed but never imported** (0 grep matches) | Unused — drop |

The old dev-only YouTube downloader/proxy has been excluded from Omnigram to keep the project clear of commercial-use compliance risk. Video parity now targets local file drops and stored blob playback only.

Test stack: Vitest 4 (`happy-dom`), Playwright 1.59 — single E2E smoke at [tests/e2e/smoke.spec.ts](tests/e2e/smoke.spec.ts).

## Graph basics

User-facing: double-click empty space → add node; left-drag node → move; right-click drag node → draw connection; right-click drag empty → box-select; left-drag empty → pan; wheel → zoom (free-zoom when nothing is selected, RMM hybrid-zoom when something is). Selected nodes show 8 resize handles. Standard `Ctrl+Z/Y/C/V`, `Delete`, `Esc`.

Implemented in:
- [PrototypeViewport.tsx](src/old/viewport/PrototypeViewport.tsx) — root component, gesture wiring (1166 lines).
- [useViewportDrag.ts](src/old/viewport/useViewportDrag.ts) — drag, multi-drag, resize, draft connection, selection rect (411 lines).
- [useViewportKeyboard.ts](src/old/viewport/useViewportKeyboard.ts) — keyboard shortcuts (179 lines).
- [viewportDropHandler.ts](src/old/viewport/viewportDropHandler.ts) — sidebar drag-drop, media files (262 lines).
- [useHybridZoomStore.ts](src/old/model/useHybridZoomStore.ts) — `addNode`, `removeNode`, `moveNode(s)`, `addConnection`, `removeConnection`, `updateNodeProps`; undo via `structuredClone` capped at 50 entries.
- [hybridZoom.ts](src/old/scene/hybridZoom.ts) — RMM zoom math (`CAMERA_SCALE_FINAL = 1.8`).

Coordinate model:
- Scene is fixed `1920 × 1080`; node coords are `0–100%` of canvas.
- Pan path writes `el.style.transform` directly inside rAF, then commits delta on pointer-up — bypasses React.
- Wheel zoom: with a selection drives RMM `zoomIn`/`zoomOut`; without, multiplies `freeScale` (clamped 0.2–5×) anchored to cursor.
- Edges anchor via per-side slot allocation in [edgeAnchoring.ts](src/old/scene/edgeAnchoring.ts) (326 lines), with bubble-sort uncrossing per group. Supports rect, oval/circle (elliptical), polygons via `shapeEdgeIntersect`.
- Connection clicks are event-delegated on the parent `<svg>` via `data-conn-key` to avoid one closure per edge.

Hard constraints:
- Snap-to-grid is mandatory (`DEFAULT_GRID_SNAP = 4` percent).
- Hit-testing always converts via `clientToScene`.

## Performance cliff analysis

What legacy already does right (keep these ideas in Omnigram):

1. **Zustand `useShallow` selectors** — viewport re-renders only on relevant slice changes.
2. **Direct DOM writes** for pan transform (rAF) and FPS overlay.
3. **Viewport culling** — `visibleRect` (15-pp buffer) skips off-screen nodes/edges.
4. **LOD tiers** ([sceneConstants.ts](src/old/scene/sceneConstants.ts)): `LOD_FULL = 0.5` → full `<SceneNode>` (813 lines); `LOD_SIMPLE = 0.2` → [SimplifiedNode.tsx](src/old/scene/SimplifiedNode.tsx); `< 0.2` → 8×8 px dot.
5. **`React.memo`** on `SceneNode`, `SimplifiedNode`, `MemoConnection`.
6. **Auto-untangle in a worker** ([autoUntangle.worker.ts](src/old/workers/autoUntangle.worker.ts)).
7. **Batched node creation** (`addNodeBatch`) for benchmark/paste.
8. **Built-in benchmark** ([useBenchmark.ts](src/old/ui/useBenchmark.ts)) — adds 50 nodes / 200 ms; auto-stops below 15 FPS.

Why the legacy build cliffs between 200 and 500 nodes:

1. **Whole-model spread on every mutation** invalidates every `useMemo` keyed on `model.nodes`/`model.connections`. `nodeMap`, `positionMap`, `anchors` all rebuild **per drag tick**. `computeEdgeAnchors` is O(E + per-group bubble sort with `maxPasses = n² + 10`).
2. **No real spatial index** — [spatialIndex.ts](src/old/scene/spatialIndex.ts) is a 5-line `Map<id, Node>` builder. Culling is O(N) per render, **and renders happen on every mutation**.
3. **Every node is a React `<article>`** with its own `useEffect` for size measurement, `useMemo` for content HTML, `useState` for `baseSize`, plus media `<img>/<video>/<audio>` and an SVG overlay for polygon shapes. Reconciliation walks them all.
4. **Forced layout per node** via `measureLabel` reading `scrollWidth`/`scrollHeight` → layout thrashing on bulk operations.
5. **Markdown/KaTeX nodes** mount `dangerouslySetInnerHTML` subtrees (sanitized via DOMPurify) per node.
6. **`structuredClone(model)` on every edit** for undo — multi-MB clone synchronously per label keystroke at 500 nodes.
7. **Connections render in one big `<svg>`** with a `<defs>` block that loops over all connections to dedupe markers (O(E) per render).
8. **Per-node SVG overlays + CSS `clip-path` + drop shadows + gradients** create hundreds of stacking contexts; cosmetic shapes add a second SVG per node.
9. **One rAF loop per cosmetic animated node** ([useCosmeticAnimations.ts](src/old/flow/useCosmeticAnimations.ts)).

The cliff is not one bottleneck — it is a stack of `O(N)`–`O(E²)` operations on every store update, multiplied by React's reconciliation cost over hundreds of memoized components, plus compositor pressure.

## RMM (recursive models) & seamless zoom

User-facing: with a node selected, scrolling in continuously enlarges the node frame **and** zooms the camera; the child diagram is visible inside the parent frame during transition. Scroll-out reverses smoothly. No hard cut.

Files:
- [hybridZoom.ts](src/old/scene/hybridZoom.ts) — `HybridZoomSnapshot = { progress, nodeProgress, cameraScale, nodeInflation, handoffMode }`. `cameraScale = lerp(1, 1.8, progress)`. `handoffMode = 'child'` when `nodeProgress >= 1`. **Math is sound — port directly.**
- [useHybridZoomStore.ts](src/old/model/useHybridZoomStore.ts) — `stack: ZoomStackFrame[]`; `pushModel` on handoff, `zoomOut` pops or steps back.
- [SceneNode.tsx](src/old/scene/SceneNode.tsx) — `nodeW = base + (target - base) * progress`, `target = vpSize.w / CAMERA_SCALE_FINAL`.
- [ChildModelPreview.tsx](src/old/scene/ChildModelPreview.tsx) — static preview of the child model rendered inside the inflating node.
- [modelLoader.ts](src/old/model/modelLoader.ts) — child models lazy-loaded on first appearance of `childModelId`.

Constraint: `zoomIn` is a no-op if `selectedNode.childModelId` is missing.

## MPD (multi-parallel-dimension) dial & curtain

User-facing: when the focused node has multiple `mpdIds`, a horizontal frequency-tuner dial appears at screen bottom. Drag/click ticks switch dimensions with a **vertical curtain wipe**. Twin nodes (same `id` across models) keep their screen position across the swap.

Files:
- [MpdDial.tsx](src/old/mpd/MpdDial.tsx) — wide dial, draggable knob, snap on release, sweep direction.
- [useMpdLogic.ts](src/old/mpd/useMpdLogic.ts) — node-level vs frame-level MPD distinction.
- [useMpdCurtain.ts](src/old/mpd/useMpdCurtain.ts) — orchestrates the curtain; uses `flushSync` to commit the swap mid-frame (**redesign without `flushSync` in Omnigram**).
- [MpdCurtainScene.tsx](src/old/mpd/MpdCurtainScene.tsx) — old-model overlay clipped and slid off screen.
- Particle screenshot is captured so PixiJS doesn't re-init mid-transition.

## Node shapes & cosmetic nodes

8 standard: `rectangle`, `rounded-rect`, `oval`, `circle`, `diamond`, `hexagon`, `parallelogram`, `triangle`. 2 cosmetic: `chat-bubble`, `thinking-cloud` — both have a draggable tip handle (continuous angle + length) and an idle "levitate" animation.

Files:
- Geometry/clip-paths: [SceneNode.tsx](src/old/scene/SceneNode.tsx), [edgeAnchoring.ts](src/old/scene/edgeAnchoring.ts) (`shapeSvgPoints`, `shapeEdgeIntersect`).
- [cosmeticShapes.ts](src/old/scene/cosmeticShapes.ts) — `chatBubblePath`, `thinkingCloudPath`, `thinkingCloudTrail`, `chatBubbleClipPath`.

## Connections

Per-connection: stroke color/width, dash style (`solid`/`dashed`/`dotted`/`dash-dot`), arrowhead (`standard`/`triangle`/`diamond`/`circle`/`none`), midpoint label + font size, type (`default`/`flow`), evidence list (`{title, citation, url}`).

Click a connection → **unzip popup** with 3 levels: study list / citations / URLs. Endpoints "spread apart" perpendicular to the connection during unzip.

Files:
- [ConnectionLine.tsx](src/old/scene/ConnectionLine.tsx) — stroke + flow animation + bow/zipper geometry.
- [edgeAnchoring.ts](src/old/scene/edgeAnchoring.ts) — anchor slot allocation + uncrossing.
- [UnzipPopup.tsx](src/old/ui/UnzipPopup.tsx) — `clip-path` polygon "scroll" reveal.
- [useUnzipAnim.ts](src/old/ui/useUnzipAnim.ts) — open 400 ms / close 250 ms ease-out cubic.

## Naming, settings, content editor, themes

Right sidebar context-routes:
- empty selection → **DiagramSettings**: model name, grid snap, theme, background, particles, grid style ([DiagramSettings.tsx](src/old/ui/DiagramSettings.tsx), 360 lines).
- single node → **NodeSettings** ([NodeSettingsPanel.tsx](src/old/ui/NodeSettingsPanel.tsx), 752 lines): label, shape, colors, dimensions, child-model link, MPD list, locked, hide-during-flow, flow effects, content editor.
- multi-selection → multi-node panel with `(mixed)` placeholders.
- connection → connection settings.

Left sidebar ([LeftSidebar.tsx](src/old/ui/LeftSidebar.tsx)): drag-source palette for shapes, node types (image/gif/audio/video/markdown/math), cosmetics, connection types.

Content authoring:
- [ContentEditor.tsx](src/old/ui/ContentEditor.tsx) — modal with live `marked`/`katex` preview, sanitized via DOMPurify.
- Inline label formatting: [labelFormatting.tsx](src/old/scene/labelFormatting.tsx) + `applyFormatToRange` in [sampleModels.ts](src/old/model/sampleModels.ts). Text-format toolbar operates on `useHybridZoomStore.labelSelection`.

Themes:
- [themes.ts](src/old/theme/themes.ts) — 10 modes: `light`, `dark`, `grey`, `woody`, `frutiger-aero`, `steel`, `sci-fi`, `aqua`, `biology`, `medical`. `applyThemeToDOM` writes CSS custom properties on `:root`; topical themes also set a class.
- [backgrounds.ts](src/old/theme/backgrounds.ts) — gradient / solid / image / pattern.
- [particles.ts](src/old/theme/particles.ts) — preset registry: `fall`, `rise`, `drift`, `wander`, `twinkle`.

## Project I/O — `.unigram` bundle

Toolbar Save → `unigram-project.unigram` (a ZIP). Load accepts `.unigram` / `.zip` / legacy `.json`.

Files:
- [projectIO.ts](src/old/viewport/projectIO.ts) — calls `exportBundle`/`importBundle` and triggers `<a download>`.
- [modelLoader.ts](src/old/model/modelLoader.ts) — JSZip pack/unpack; extracts media into `media/`, keeps `settings.json` (`appThemeMode`, `modelCosmetics`); maintains `urlToModelId`/`modelIdToUrl` and an `inflight` dedupe map.
- [mediaStore.ts](src/old/model/mediaStore.ts) — small (≤10 MB) blobs in a `Map`; large blobs only as object URLs and re-fetched on export.

Models reference each other by relative path on disk (`./alpha-internals.json`) but by ID at runtime; `modelLoader` translates on import/export. Seed bundles in [public/models/](public/models/).

## Animations & flow effect / recording

Each node can carry one or more **flow effects** — small DAG programs orchestrated from a selected starting node. Effect kinds: `move`, `color`, `scale`, `jitter`, `float`, `emerge`, `dismiss`, `spawn` (with preview facades), `spawn-circular`, `play-media`, `audio-clip`, `segment-play`, `text-format`, `text-generator` (typewriter + synthesized sounds), `camera` (pan/zoom/rotate), `break` (visual disintegration), `repeater`, `expand`/`collapse`, `handoff-rmm`/`return-rmm`/`handoff-mpd`, `record` (MediaRecorder or OBS WebSocket), `wait`, plus cosmetic-only `cloud-levitate`/`bubble-levitate`.

Files (legacy flow is ~5 kLOC — **do not port shape-for-shape**, redesign around scene-graph ownership):
- [useFlowEngine.ts](src/old/flow/useFlowEngine.ts) — DAG builder, BFS scheduler, camera override + fadeout, recording, ~15 cleanup ref bags (1223 lines).
- [flowEffectHandlers.ts](src/old/flow/flowEffectHandlers.ts) — per-effect dispatch (769 lines).
- [flowVisualEffects.ts](src/old/flow/flowVisualEffects.ts) — rAF/CSS-transform handlers (1045 lines).
- [FlowEffectEditor.tsx](src/old/flow/FlowEffectEditor.tsx) (1021 lines) + [FlowEffectEditorModal.tsx](src/old/flow/FlowEffectEditorModal.tsx).
- [FlowNodeConfigPanel.tsx](src/old/flow/FlowNodeConfigPanel.tsx) — 1343 lines, single largest file.
- [TextGeneratorConfigPanel.tsx](src/old/flow/TextGeneratorConfigPanel.tsx) + [textGeneratorSounds.ts](src/old/flow/textGeneratorSounds.ts) + [textGeneratorCleanup.ts](src/old/flow/textGeneratorCleanup.ts) — typewriter with 4 oscillator sound presets.
- [obsWebSocket.ts](src/old/flow/obsWebSocket.ts) — OBS WebSocket v5 minimal client (Hello/Identify/SHA-256 auth).
- [useCosmeticAnimations.ts](src/old/flow/useCosmeticAnimations.ts) — autonomous animator for `bubble-levitate`/`cloud-levitate`.
- [flowTypes.ts](src/old/flow/flowTypes.ts) — `FlowTask`, `FlowDAG`, cleanup state shape.

Behavioral notes:
- Spawn effects create real model nodes auto-removed on stop unless they are pre-authored "preview facades" (dashed placeholders linked via `previewOf`).
- Camera tracking uses a separate fadeout ref so residual rotation/zoom unwinds when an override expires.
- Recording defaults to `getDisplayMedia` MediaRecorder; OBS path drives an external OBS instance.
- `useFlowEngine.stopFlowAnimation` is the single canonical cleanup point — it iterates >15 ref bags.

## Particle overlay

[ParticleOverlay.tsx](src/old/theme/ParticleOverlay.tsx) (402 lines) — the **only** PixiJS user in legacy. Owns one `Application`, one `Graphics` per particle; replicates the scene's CSS transform onto the Pixi stage with `uncommittedPanRef` for sub-frame pan compensation. Staggered intro fade over ~150 frames.

In Omnigram the entire scene moves into PixiJS, so the particle overlay merges into the main scene as a Pixi container.

## Tests (legacy)

- Vitest unit tests (env: `happy-dom`): [src/test/setup.ts](src/test/setup.ts) + 9 spec files covering zoom math continuity, store editing actions, undo/redo, MPD switch, unzip popup, model file round-trip, cosmetic shapes, flow effect type schema.
- Playwright: single E2E smoke ([tests/e2e/smoke.spec.ts](tests/e2e/smoke.spec.ts)) — loads `/` and asserts the debug overlay shows "Selection:".

## Triage summary

**Truly central — must exist in Omnigram day one**
- Zustand store + zoom-stack frames.
- Hybrid RMM zoom math.
- Edge anchoring algorithm (incremental, not bubble-sort-per-render).
- Single transformed scene + DOM-direct pan.
- Drag/select/connection authoring.
- Model loader + bundle I/O.

**Keep the idea, rebuild the implementation**
- LOD strategy → enforce inside the Pixi scene graph instead of swapping React components.
- MPD curtain + dial → unique UX, redesign without `flushSync`.
- Auto-untangle worker → architecture is good, port as-is.
- Theme/palette → already isolated; minimal port.
- Project bundle format → schema verbatim.

**Peripheral / drop or defer**
- `motion` dep — drop.
- PixiJS-only-for-particles role — promoted to primary renderer.
- Flow effect system — strongest redesign target; let effects own scene-graph nodes the renderer disposes in one call.
- OBS WebSocket — dev convenience, defer to stage 5.
- Express YouTube proxy — dev only.

## Top performance redesign targets (Omnigram stage 1–2)

1. Pixi v8 scene-graph renderer for nodes & edges (eliminate per-node React reconciliation).
2. Quadtree spatial index for culling, hit-testing, and edge-crossing search.
3. Structural-sharing model + patch-based undo (no `structuredClone`).
4. Move edge-anchor uncrossing off the render path — incremental update on node move only.
5. Render markdown/KaTeX content nodes once into an off-screen texture cached per content hash.

## Benchmarks

Manual gate plus a scripted bench harness (Stage 2) — pick a scenario from the
in-app toolbar (`Bench: pan-h`, `pan-loop`, `zoom-pulse`, `pan-zoom`,
`edge-heavy-2k`, `idle`).
Each run samples per-frame deltas via `requestAnimationFrame` for 3 s and
prints `frames / p50 / p95 / min / max FPS` to the overlay and the console.
The harness lives at [src/bench/harness.ts](src/bench/harness.ts) — every new
feature must register a scenario there.

| Stage | Scenario | Nodes | Edges | Browser | Observed FPS |
|---|---|---:|---:|---|---:|
| 1 | spawn grid, idle pan/zoom | 500 | ~750 | Chrome (60 Hz cap) | 60 (capped) |
| 1 | spawn grid, idle pan/zoom | 1000 | ~1500 | Chrome (60 Hz cap) | 60 (capped) |
| 1 | spawn grid, idle pan/zoom | 2000 | ~3000 | Chrome (60 Hz cap) | 60 (capped) |
| 1 | spawn grid, idle pan/zoom | 2000 | ~3000 | VSCode integrated (uncapped) | 144 |
| 2 | edge-heavy-2k (spatial edge index) | 2000 | ~6000 | _pending manual run_ | _record p50/p95 next_ |

Stage 1 acceptance (≥60 FPS at 2000 nodes) **passed**. Headroom remains for
stages 3–5.

### Stage 2 optimization changes

The optimization pass focused on three documented hot-path costs:

1. **GC-free cull/draw cycle** — the `cullAndDraw` loop in
   [src/scene/SceneRenderer.ts](src/scene/SceneRenderer.ts) used to allocate
   two `Set<string>` and one `string[]` *per frame*. It now reuses three
   pooled scratch buffers and swaps the previous-visible set in place, so the
   steady-state render loop is allocation-free aside from Pixi-internal work.
2. **Drag bypass** — `PointerController` no longer calls
   `useOmniStore.moveNodes` per pointermove. During a drag it writes directly
   to `SceneRenderer.moveNodeDirect`, which mutates the live `ModelNode` and
   updates the quadtree entry. On pointerup a single `commitDrag` transaction
   pushes one undo patch built from the pre-drag baseline. This eliminates
   the per-frame top-level model spread and the resulting full-quadtree
   rebuild that previously fired on every pointer move.
3. **Smart bridge + idempotent quadtree updates** — `bindStoreToRenderer`
   now distinguishes Map-identity swaps (i.e. `loadModel`) from in-place
   mutations. Identity swaps trigger a full `setModel` + quadtree rebuild;
   in-place mutations call the new `syncIncremental` path, which uses
   `Quadtree.update`'s newly-added AABB-equality short-circuit so untouched
   nodes incur zero work. A 2000-node `commitDrag` for a single moved node
   now does ~1 quadtree update + 1999 no-op AABB comparisons instead of
   2000 inserts.

Undo remains patch-based — there is no `structuredClone` of the model in any
new code path. A stress test (5000 add/undo cycles + 1000 sequential adds
with capped undo stack) lives at
[src/model/undo.stress.test.ts](src/model/undo.stress.test.ts).
