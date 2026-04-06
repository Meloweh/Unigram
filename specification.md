# Unigram Specification (Revised)

Version: 0.1 (Execution Draft)
Date: 2026-04-06
Status: Draft for user clarification and approval

## 1. Purpose

Unigram is a browser-based, animation-heavy, interactive diagram application for managing complex systems through recursive zooming and alternate model dimensions.

The product combines:
1. Recursive-C4-like model drill-down
2. Mandelbrot-like continuous zoom behavior
3. Multi-Parallel-Dimension (MPD) traversal per node
4. Dynamic connection routing and connection-detail unzip views
5. Full graph editing through both direct UI and CLI commands

Primary goal: preserve context while navigating deep complexity without hard scene switches.

## 2. Platform and Technology Baseline

Confirmed baseline stack:
1. React + TypeScript + Vite
2. PixiJS (GPU-accelerated 2D rendering)
3. Motion One (transition orchestration)
4. Zustand (state management and finite state machines)
5. Vitest + Playwright (test layers)

Licensing direction:
1. Commercially free dependencies only
2. Keep optional dependencies low to reduce maintenance and deprecation risk

## 3. Core Domain Model

## 3.1 Definitions

1. Project: Top-level container for all models and references
2. RMM: Recursive model attached to a node and navigated via zoom
3. MPD: Alternative model dimension for a focused node
4. Node: Graph element with id, name, geometry, optional attached RMMs/MPDs
5. Connection: Directed edge with optional study evidence metadata
6. Connection Evidence Levels:
   - Level 1: study/paper list
   - Level 2: user-specified most significant citation per study
   - Level 3: URL per study

Evidence authoring rule:
1. Study evidence is manually appended by the user.
2. For each study entry, user provides title, citation, and URL.

## 3.2 Identity and References

1. Each RMM has a unique ID
2. Each MPD has a unique ID
3. Node references to RMM/MPD are by ID
4. Same-name nodes may be associated across models for traversal

## 4. Interaction and View Rules

## 4.1 Camera and Navigation

1. Pan and zoom behavior should feel like Google Maps/Miro/draw.io
2. Desktop and mobile behavior parity is required
3. If no entity is hovered, zoom target is chosen by nearest eligible entity to viewport center
4. If entity is hovered or selected, that entity is zoom target priority

## 4.2 Recursive Node Zoom (Seamless Requirement)

This is a hard requirement:
1. No visible jump cut between parent and child model views
2. Parent and child must share a unified world-space transform hierarchy
3. Child model can be interacted with while still inside the parent frame
4. Transition from framed child to full-screen child must be perceptually continuous
5. Dominance handoff is an internal ownership switch, not a visual transform jump. Default handoff should occur when child model reaches about 100 percent of its canonical view scale in the current camera context.
6. Optional early handoff around 70 percent is allowed only as an optimization mode and only if visual continuity remains mathematically identical (no apparent zoom skip).

Hybrid transition model (accepted design direction):
1. Zooming into a selected node is a hybrid of camera zoom and node inflation, not camera zoom alone.
2. Each inward zoom increment applies:
   - A small camera zoom toward the selected node center
   - A small inflation of the selected node frame
3. If user input pauses, transition state is preserved (no deflation or snap-back).
4. During pause, the user may pan and inspect context while the inflated/partially transitioned state remains active.
5. When inward zoom resumes, camera realigns toward the selected node and continues the same transition curve.
6. If the selected node frame grows beyond viewport bounds, ownership handoff can execute immediately, provided no visual discontinuity is introduced.
7. Zoom-out reverses the same hybrid curve continuously.

Interpretation note:
A hard jump is replaced by seamless continuity, with fading or chrome removal allowed only if continuity is preserved. The user should perceive one uninterrupted zoom curve; handoff timing must never introduce a perceived cut.

## 4.3 Connection Unzip Zoom

1. Zooming into a connection opens a popup expanding from connection geometry
2. Popup depth is capped at three levels:
   - Level 1: study names
   - Level 2: most significant citation per study
   - Level 3: URL display
3. Popup must remain visually recognizable as a popup (not full scene takeover)
4. If another dominant zoom action starts (for example node zoom), popup closes cleanly

## 4.4 MPD Dial Behavior

1. Dial appears only when focused node has more than one available MPD path
2. Dial is placed at bottom of screen and behaves like a parking-disc rotational selector
3. Release snaps to nearest MPD option
4. Transition is fade-based:
   - Non-selected entities dim
   - Selected node remains visually dominant
5. MPD traversal is reference-jump based only (no direct cross-MPD rendered edges)

## 4.5 Selection Flow Animation

When node N is selected:
1. Animate outgoing/incoming connection highlights
2. Then animate connected nodes
3. Continue breadth-like propagation while avoiding infinite loops
4. Default pulse duration per highlight moment: 0.5 seconds (configurable)

## 4.6 Editing Interactions

1. Create node:
   - Desktop: double-click
   - Mobile: double-tap
2. Temporary unnamed nodes are deleted if naming not completed
3. Create connection:
   - Desktop: right-click drag from source node to target node
   - Mobile: long-press drag
4. Node selection:
   - Desktop: click node to select, click empty space to deselect
   - Mobile: tap node to select, tap empty space to deselect
5. Node dragging:
   - Desktop: left drag
   - Mobile: select first, then drag
6. Node pinning available from snackbar when node is selected

## 4.7 Undo/Redo Scope

1. Undo/redo history includes model mutations only.
2. Camera/view transitions (pan, zoom position, temporary transition states) are not part of undo history.
3. Undo/redo queue is filtered to the currently open model context.

## 5. Layout and Routing

## 5.1 Routing Expectations

1. Connections should avoid crossing node bodies
2. Arrowheads must orient dynamically to final segment angle
3. Arrow endpoint should remain angle-aware around node perimeter

## 5.2 Routing Deadlock Fallback (Confirmed)

If geometry is too congested and no obstacle-free path is found:
1. Draw dashed straight fallback line
2. Log diagnostic detail to CLI console
3. No auto-repositioning
4. User resolves by repositioning nodes

## 5.3 Layout Optimization

1. Auto-optimization mode for crossing reduction is manual-only
2. Triggered by explicit user action (UI or CLI)

## 6. Data and Persistence

Confirmed strategy:
1. Multi-file JSON by model ID
2. Models reference each other via IDs
3. Runtime loads only direct parent, siblings, and children in active focus region

Deferred note:
Graph size is treated as unbounded conceptually. Chunk-loading/performance scaling strategy remains a tracked later todo for practical limits.

## 7. CLI Scope

## 7.1 MVP CLI Commands (Confirmed)

1. Node CRUD
2. Connection CRUD
3. Attach RMM/MPD references
4. Add study/citation evidence data
5. Undo/redo

## 7.2 Post-MVP CLI Candidates

1. Graph optimize command
2. Save/load convenience commands
3. Pin/unpin commands
4. Advanced analytics and traversal commands

## 8. Non-Functional Requirements

1. Smooth transitions are product-critical, not optional polish
2. Mobile and desktop interaction parity is required
3. Architecture must support recursive depth without hard-coded level caps
4. Tests are mandatory per implementation task
5. Manual user review gate required before task is marked done

## 9. Test Strategy Requirement (Execution Policy)

For every implementation task:
1. Add unit tests where logic exists
2. Add integration/UI/E2E tests where interaction behavior exists
3. Run tests and debug locally before requesting user review
4. After user confirmation, mark task complete in task tracking

## 10. Milestone Plan (Granular, Architecture-Sensitive)

## Milestone M0: Specification and Contracts

1. Finalize this document with user clarifications
2. Define event/state machine contracts for zoom, MPD, unzip
3. Define JSON schemas and ID/reference invariants
4. Define acceptance criteria for continuity and animation

Deliverable: approved spec and contracts, no unresolved blocker ambiguities

## Milestone M1: Hard Prototype Kernel

Priority objective: prove hardest interactions early.

1. Implement seamless recursive node zoom (continuous world-space hierarchy)
2. Implement connection unzip popup with three detail levels
3. Implement MPD dial and fade transitions
4. Implement target arbitration (hovered vs nearest-to-center)
5. Implement baseline selection-flow animation

Tests:
1. Zoom state transition tests
2. Continuity assertion tests (no discrete camera jump events)
3. MPD snap and fade timing tests
4. Connection unzip depth and close-condition tests

Deliverable: interactive prototype proving core visual thesis

## Milestone M2: Editing and Graph Mechanics

1. Node create/name/delete lifecycle
2. Node drag/select/deselect/pin
3. Connection create and edit flows
4. Undo/redo command pipeline
5. Manual-only layout optimization command

Tests:
1. Interaction gesture tests desktop/mobile
2. Command and undo/redo tests
3. Connection creation/path update tests

Deliverable: usable editor core

## Milestone M3: Routing and Data Runtime

1. Obstacle-aware route generation
2. Dynamic arrowhead orientation
3. Deadlock fallback rendering and diagnostics
4. Multi-file JSON persistence implementation
5. Runtime load/unload policy for parent/sibling/children

Tests:
1. Route solver tests including deadlock cases
2. Persistence integrity tests
3. Load/unload memory policy tests

Deliverable: scalable runtime behavior and robust routing

## Milestone M4: CLI and Association Intelligence

1. CLI popup and parser
2. CLI mutation execution and validation
3. Node-name autocomplete and cross-model association
4. MPD availability behavior for associated nodes

Tests:
1. CLI parser/executor tests
2. Association resolution tests
3. Regression tests across UI + CLI mutation parity

Deliverable: dual input system (UI + CLI) with association intelligence

## Milestone M5: Product Hardening and Release Prep

1. Performance profiling and bottleneck elimination
2. Cross-device test matrix execution
3. License inventory generation with commercial-use status
4. UX polish and animation quality tuning

Tests:
1. Playwright E2E flows
2. Performance benchmark scenarios
3. Stability/regression suite

Deliverable: release-ready baseline

## 11. Ambiguity Register (Resolved)

All ambiguity items A1-A8 are resolved by user confirmation.

### A1. Zoom continuity metric

Question: How do we objectively validate seamlessness?
Suggested default: use hybrid continuity validation. During node entry, both camera scale and node frame scale evolve as continuous monotonic functions over input steps, with no transform reset event and no frame-scale discontinuity at handoff. Add a test that verifies handoff occurs without discontinuity even when user pauses and resumes zoom.
Status: Confirmed.

### A2. Zoom occupancy threshold exactness

Question: Should handoff default to 100 percent canonical child-view scale, with optional early handoff around 70 percent as optimization mode?
Suggested default: yes. Use 100 percent canonical-scale handoff as default behavior. Keep 70 percent early-handoff behind a feature flag for performance tuning only.
Status: Confirmed.

### A3. Evidence ranking source

Question: How is most significant citation chosen?
Decision: user manually appends study/paper evidence and manually specifies citation with title and URL.
Status: Confirmed.

### A4. Mobile long-press timing

Question: Exact long-press duration for connection creation/select behavior?
Suggested default: 350 milliseconds for select hold, 500 milliseconds for drag-create connection intent.
Status: Confirmed.

### A5. Conflict policy for same-name associations

Question: If many nodes share identical names across models, which one is preferred in jump lists?
Decision: sort by closest relation in traversal graph, then no guaranteed secondary order for now.
Status: Confirmed.

### A6. Undo scope for animated transitions

Question: Are view-only transitions (camera zoom position) part of undo stack?
Decision: undo stack includes model mutations only. Undo/redo queue is filtered by currently open model context.
Status: Confirmed.

### A7. Connection popup overlap behavior

Question: If multiple connections are near center and no selection exists, which popup can open on zoom intent?
Suggested default: single active popup only; pick closest eligible connection center to viewport center.
Status: Confirmed.

### A8. CLI error surface

Question: Should CLI errors appear only in console panel or also transient UI toast?
Suggested default: both (CLI panel full detail, snackbar concise summary).
Status: Confirmed.

## 12. Immediate Next-Step Requests to User

No open ambiguity blockers remain. Next step is implementation kickoff (M0 technical setup).

## 13. Task List for Active Development Tracking

Task completion policy:
1. Implement task
2. Add tests
3. Run tests and debug
4. Request manual user review
5. Mark complete only after user confirmation

## Phase M0 active tasks

1. Finalize specification.md using your answers for A1-A8 (completed)
2. Produce initial architecture skeleton in codebase (completed)
3. Add baseline test setup (Vitest + Playwright) (completed)
4. Start M1 Prototype A seamless zoom implementation (implemented, pending user confirmation)

## 14. Scope Notes

1. This revised specification supersedes ambiguous language from specification.txt for implementation planning.
2. specification.txt remains as source ideation history.
3. This document is the executable implementation contract after user clarification pass.
