/**
 * Omnigram app shell — stage 1.
 *
 * Mounts the PixiJS renderer once into a host div, wires the store ↔ renderer
 * bridge, attaches pointer/wheel/keyboard controllers, and exposes a
 * "Spawn 2000" dev button to load the bench scene.
 *
 * React renders only the chrome: the FPS overlay and toolbar buttons. The
 * canvas itself is a single div whose children are managed by Pixi.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { SceneRenderer } from '../scene/SceneRenderer'
import { bindStoreToRenderer } from './sceneBridge'
import { PointerController } from '../viewport/PointerController'
import { WheelController } from '../viewport/WheelController'
import { KeyboardController } from '../viewport/KeyboardController'
import { useOmniStore } from '../model/store'
import { exportBundle, importBundle, type ProjectSnapshot } from '../model/projectBundle'
import { spawnGrid, spawnNested } from '../bench/spawnGrid'
import { runScenario, listScenarios, type BenchResult } from '../bench/harness'
import { ALL_THEME_OPTIONS, applyThemeToDOM, resolvePalette } from '../theme/themes'
import { GRADIENT_PRESETS, PATTERN_PRESETS, resolveBackground } from '../theme/backgrounds'
import type { ThemeMode, BackgroundConfig, BackgroundType } from '../theme/types'
import { FpsOverlay } from './FpsOverlay'
import { LeftSidebar, DRAG_MIME_SHAPE, DRAG_MIME_MEDIA } from '../ui/LeftSidebar'
import { RightSidebar } from '../ui/RightSidebar'
import { EditorToolbar } from '../ui/EditorToolbar'
import { ConnectionReferencePopup } from '../ui/ConnectionReferencePopup'
import { RichNodeOverlay } from '../ui/RichNodeOverlay'
import { MpdDial } from '../mpd/MpdDial'
import { resolveMpdOptions, switchMpdDimension } from '../mpd/externalMpdRuntime'
import { clientToScene, SCENE_H, SCENE_W } from '../scene/sceneConstants'
import type { GridSettings, Model, ModelNode, NodeShape } from '../model/types'
import { DEFAULT_GRID, DEFAULT_NODE } from '../model/types'
import { cosmeticNodeDefaults, isCosmeticShape } from '../scene/cosmeticGeometry'
import { defaultCosmeticEffect } from '../flow/cosmeticEffects'
import {
  blobToBase64,
  base64ToBlob,
  createCreativeCopy,
  deleteCreativeDiagram,
  createForumTopic,
  getCloudDiagram,
  getUserPreferences,
  getCurrentAccount,
  listCreativeCopies,
  listDevVerificationMessages,
  loginAccount,
  registerAccount,
  resendVerificationEmail,
  AuthRequiredError,
  saveCloudDiagram,
  saveCreativeDiagram,
  saveUserPreferences,
  verifyEmail,
  type CreativeDiagramSummary,
  type DevVerificationMessage,
} from '../social/cloudClient'
import { SocialForumLayer } from './SocialForum'
import { recomputeTransformDraft } from '../social/transformDraft'
import type { SocialUserPreferences } from '../social/forumTypes'
import { diffProjectsToProposalSteps, projectWithoutPublicGraphDrafts } from '../social/publicGraphDraft'
import type { GraphProposalStep } from '../social/forumTypes'
import { changeGroupsForSteps } from '../social/proposalDisplay'
import type { Patch } from '../model/undo'

interface OmnigramAppProps {
  cloudDiagramId?: string
  cloudDiagramTopic?: string
  cloudDiagramDescription?: string
  creativeDiagramId?: string
  sourceDiagramId?: string
  sourceDiagramTitle?: string
  creativeSourceContentHash?: string
  creativeSourceCurrentContentHash?: string
  creativeSourceBaseBundleBase64?: string
  mode?: 'public' | 'creative'
  onHome?: () => void
  onViewGraph?: () => void | Promise<void>
  onOpenCreativeDiagram?: (diagram: CreativeDiagramSummary) => Promise<void>
  chrome?: {
    sidebars?: boolean
    devPanel?: boolean
    fps?: boolean
    toolbar?: boolean
  }
}

export function OmnigramApp({
  cloudDiagramId,
  cloudDiagramTopic,
  cloudDiagramDescription,
  creativeDiagramId,
  sourceDiagramId,
  sourceDiagramTitle,
  creativeSourceContentHash,
  creativeSourceCurrentContentHash,
  creativeSourceBaseBundleBase64,
  mode = 'public',
  onHome,
  onViewGraph,
  onOpenCreativeDiagram,
  chrome,
}: OmnigramAppProps = {}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [renderer, setRenderer] = useState<SceneRenderer | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [forumOpen, setForumOpen] = useState(false)
  const [creativeLeaving, setCreativeLeaving] = useState(false)
  const isCreative = mode === 'creative'
  const [preferences, setPreferences] = useState<SocialUserPreferences>(() => loadLocalPreferences())
  const [creativeSync, setCreativeSync] = useState({
    sourceContentHash: creativeSourceContentHash,
    sourceCurrentContentHash: creativeSourceCurrentContentHash,
    sourceBaseBundleBase64: creativeSourceBaseBundleBase64,
  })
  const [creativeApplySteps, setCreativeApplySteps] = useState<GraphProposalStep[] | null>(null)
  const [creativeStatus, setCreativeStatus] = useState<string | null>(null)
  const [creativeStatusLeaving, setCreativeStatusLeaving] = useState(false)
  const graphMounted = isCreative || !forumOpen
  const showSidebars = isCreative ? true : (chrome?.sidebars ?? false)
  const showPublicSidebars = !isCreative && graphMounted
  const showDevPanel = isCreative ? (chrome?.devPanel ?? false) : (chrome?.devPanel ?? true)
  const showFps = chrome?.fps ?? true
  const showToolbar = isCreative ? true : (chrome?.toolbar ?? true)
  const pickMode = useSyncExternalStore(
    useOmniStore.subscribe,
    () => useOmniStore.getState().pickMode,
    () => null,
  )
  const storeRevision = useSyncExternalStore(
    useOmniStore.subscribe,
    () => useOmniStore.getState().rev,
    () => 0,
  )
  const themeMode: ThemeMode = preferences.themeMode ?? 'light-dark'
  const background = preferences.background
  const [creativeChangeCount, setCreativeChangeCount] = useState(0)
  const creativeHasChanges = creativeChangeCount > 0
  const creativeSourceIsCurrent = Boolean(
    isCreative &&
    creativeSync.sourceContentHash &&
    creativeSync.sourceContentHash === creativeSync.sourceCurrentContentHash,
  )
  const creativeSourceIsStale = Boolean(
    isCreative &&
    creativeSync.sourceContentHash &&
    creativeSync.sourceCurrentContentHash &&
    creativeSync.sourceContentHash !== creativeSync.sourceCurrentContentHash,
  )
  const creativeHasSyncMetadata = Boolean(
    isCreative &&
    creativeSync.sourceContentHash &&
    creativeSync.sourceCurrentContentHash &&
    creativeSync.sourceBaseBundleBase64,
  )
  const applyToMainTitle = !isCreative
    ? undefined
    : !creativeHasSyncMetadata
      ? 'This creative copy is missing source sync metadata.'
      : creativeSourceIsStale
        ? 'Pull & Merge before applying to the main graph.'
        : !creativeHasChanges
          ? 'No creative changes to apply.'
          : 'Create a main graph proposal from this creative copy.'
  const pullMergeTitle = !isCreative
    ? undefined
    : !creativeHasSyncMetadata
      ? 'This creative copy is missing source sync metadata.'
      : creativeSourceIsCurrent
        ? 'No public graph changes to pull.'
        : 'Pull public graph changes into this creative copy.'
  useEffect(() => {
    setCreativeSync({
      sourceContentHash: creativeSourceContentHash,
      sourceCurrentContentHash: creativeSourceCurrentContentHash,
      sourceBaseBundleBase64: creativeSourceBaseBundleBase64,
    })
  }, [creativeSourceContentHash, creativeSourceCurrentContentHash, creativeSourceBaseBundleBase64, creativeDiagramId])

  useEffect(() => {
    if (!isCreative || !creativeSync.sourceBaseBundleBase64) {
      setCreativeChangeCount(0)
      return
    }
    let disposed = false
    void importBundle(base64ToBlob(creativeSync.sourceBaseBundleBase64))
      .then((base) => {
        if (!disposed) setCreativeChangeCount(diffProjectsToProposalSteps(base, currentProjectSnapshot()).length)
      })
      .catch(() => {
        if (!disposed) setCreativeChangeCount(0)
      })
    return () => {
      disposed = true
    }
  }, [isCreative, creativeSync.sourceBaseBundleBase64, creativeDiagramId, storeRevision])
  const handleReturnToGraph = () => {
    if (!onViewGraph || creativeLeaving) return
    setCreativeLeaving(true)
    window.setTimeout(() => {
      Promise.resolve(onViewGraph()).catch((err: unknown) => {
        console.warn('Return to public graph failed:', err)
        setCreativeLeaving(false)
      })
    }, 240)
  }

  useEffect(() => {
    setCreativeLeaving(false)
  }, [creativeDiagramId, isCreative])

  useEffect(() => {
    if (!creativeStatus) {
      setCreativeStatusLeaving(false)
      return
    }
    setCreativeStatusLeaving(false)
    const fadeTimer = window.setTimeout(() => setCreativeStatusLeaving(true), 3200)
    const clearTimer = window.setTimeout(() => setCreativeStatus(null), 3900)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(clearTimer)
    }
  }, [creativeStatus])

  const applyCreativeToMain = async () => {
    if (!creativeDiagramId || !sourceDiagramId) return
    setCreativeStatus(null)
    if ((creativeSync.sourceContentHash ?? '') !== (creativeSync.sourceCurrentContentHash ?? '')) {
      setCreativeStatus('Pull & Merge before applying to the main graph.')
      return
    }
    if (!creativeSync.sourceBaseBundleBase64) {
      setCreativeStatus('This creative copy is missing its public base snapshot.')
      return
    }
    try {
      const base = await importBundle(base64ToBlob(creativeSync.sourceBaseBundleBase64))
      const steps = diffProjectsToProposalSteps(base, currentProjectSnapshot())
      if (steps.length === 0) {
        setCreativeStatus('No creative changes to apply.')
        return
      }
      setCreativeApplySteps(steps)
    } catch (err) {
      setCreativeStatus(err instanceof Error ? err.message : 'Could not prepare creative changes.')
    }
  }

  const pullAndMergeCreative = async () => {
    if (!creativeDiagramId || !sourceDiagramId) return
    setCreativeStatus(null)
    try {
      const source = await getCloudDiagram(sourceDiagramId)
      const latestBase64 = source.bundleBase64
      const sourceHash = source.contentHash
      if (!latestBase64) {
        setCreativeStatus('The public graph has no saved bundle to pull.')
        return
      }
      if (!sourceHash) {
        setCreativeStatus('The public graph is missing content hash metadata.')
        return
      }
      setCreativeSync((current) => ({ ...current, sourceCurrentContentHash: sourceHash }))
      if (creativeSync.sourceContentHash === sourceHash && creativeSync.sourceBaseBundleBase64) {
        setCreativeStatus('This creative copy is already based on the latest public graph.')
        return
      }
      if (!creativeSync.sourceBaseBundleBase64) {
        setCreativeStatus('This creative copy is missing its public base snapshot, so Pull & Merge cannot safely determine incoming changes.')
        return
      }
      const latest = await importBundle(base64ToBlob(latestBase64))
      const previousBase = await importBundle(base64ToBlob(creativeSync.sourceBaseBundleBase64))
      const merged = mergePublicIntoCreative(previousBase, latest, currentProjectSnapshot())
      applyProjectRootAsUndoable(merged)
      const bundleBase64 = await blobToBase64(await exportBundle(merged))
      await saveCreativeDiagram(creativeDiagramId, {
        title: useOmniStore.getState().model.name || 'Untitled creative graph',
        bundleBase64,
        sourceContentHash: sourceHash,
        sourceBaseBundleBase64: latestBase64,
      })
      setCreativeSync({
        sourceContentHash: sourceHash,
        sourceCurrentContentHash: sourceHash,
        sourceBaseBundleBase64: latestBase64,
      })
      setCreativeStatus('Pulled public changes into this creative copy.')
    } catch (err) {
      setCreativeStatus(err instanceof Error ? err.message : 'Pull & Merge failed.')
    }
  }

  useEffect(() => {
    let disposed = false
    const load = () => void getUserPreferences().then((remote) => {
      if (disposed || !remote) return
      setPreferences((current) => ({ ...current, ...remote }))
      storeLocalPreferences(remote)
    }).catch(() => undefined)
    load()
    window.addEventListener('omnigram-auth-changed', load)
    return () => {
      disposed = true
      window.removeEventListener('omnigram-auth-changed', load)
    }
  }, [])

  const updatePreferences = useCallback((patch: SocialUserPreferences) => {
    setPreferences((current) => {
      const next = { ...current, ...patch }
      storeLocalPreferences(next)
      void saveUserPreferences(next).catch(() => undefined)
      return next
    })
  }, [])

  useEffect(() => {
    const handleThemeRequest = (event: Event) => {
      const themeMode = (event as CustomEvent<{ themeMode?: ThemeMode }>).detail?.themeMode
      if (!themeMode) return
      updatePreferences({ themeMode })
    }
    window.addEventListener('omnigram-theme-mode-request', handleThemeRequest)
    return () => window.removeEventListener('omnigram-theme-mode-request', handleThemeRequest)
  }, [updatePreferences])

  // Apply theme palette to documentElement CSS vars + topical body class.
  useEffect(() => {
    applyThemeToDOM(resolvePalette(themeMode))
    document.documentElement.dataset.theme = themeMode
    return () => {
      delete document.documentElement.dataset.theme
    }
  }, [themeMode])

  // Push the resolved palette into the renderer so default-coloured nodes
  // recolour with the theme. Per-node user-chosen colours are preserved.
  useEffect(() => {
    if (!renderer) return
    const p = resolvePalette(themeMode)
    const labelHex = p.nodeLabel.startsWith('#') ? p.nodeLabel : '#132949'
    const labelNum = parseInt(labelHex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
    renderer.setThemePalette({ cell: p.nodeCell, membrane: p.nodeMembrane, label: labelNum })
    if (isCreative && useOmniStore.getState().model.cosmetics?.themeMode !== themeMode) {
      useOmniStore.getState().setCosmetics({ themeMode })
    }
  }, [isCreative, renderer, themeMode])

  useEffect(() => {
    if (!graphMounted) return
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const r = new SceneRenderer({ socialDecorations: !isCreative })
    let unsubBridge: (() => void) | null = null
    let pointer: PointerController | null = null
    let wheel: WheelController | null = null
    let keyboard: KeyboardController | null = null
    void r.init(host).then(() => {
      if (disposed) {
        r.destroy()
        return
      }
      unsubBridge = bindStoreToRenderer(r)
      wheel = new WheelController(host, r)
      keyboard = new KeyboardController({ allowNodeDelete: true, editorHotkeys: true })
      pointer = new PointerController(host, r, { socialDrafts: !isCreative })
      setRenderer(r)
    }).catch((err: unknown) => {
      // Test/headless environments without WebGL: skip silently.
      console.warn('SceneRenderer.init failed:', err)
    })
    return () => {
      disposed = true
      pointer?.destroy()
      wheel?.destroy()
      keyboard?.destroy()
      unsubBridge?.()
      r.destroy()
      setRenderer(null)
    }
  }, [graphMounted, isCreative])

  useCloudAutosave(isCreative ? undefined : cloudDiagramId)
  useCreativeAutosave(isCreative ? creativeDiagramId : undefined)

  return (
    <div
      className={[
        'omnigram-shell',
        isCreative ? 'creative-enter' : '',
        isCreative && creativeLeaving ? 'creative-leave' : '',
      ].filter(Boolean).join(' ')}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        // Theme palette `viewportBg` is the diagram's resting backdrop. An
        // explicit `BackgroundLayer` (gradient/solid/pattern/image) renders
        // on top via the next sibling div.
        background: resolvePalette(themeMode).viewportBg,
      }}
    >
      <BackgroundLayer config={background} />
      {graphMounted && (
        <div
          ref={hostRef}
        style={{
          position: 'absolute',
          inset: 0,
          touchAction: 'none',
          cursor: pickMode === 'link-node' ? 'crosshair' : undefined,
        }}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(DRAG_MIME_SHAPE) ||
            e.dataTransfer.types.includes(DRAG_MIME_MEDIA) ||
            e.dataTransfer.types.includes('Files')
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={async (e) => {
          const shape = e.dataTransfer.getData(DRAG_MIME_SHAPE) as NodeShape | ''
          const files = e.dataTransfer.files
          if (!renderer) return
          if (!shape && files.length === 0) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const cam = renderer.getCamera()
          const vp = renderer.getViewport()
          const { x, y } = clientToScene(
            e.clientX - rect.left,
            e.clientY - rect.top,
            cam,
            vp,
          )
          const store = useOmniStore.getState()
          const grid = store.model.grid
          const step = grid?.snap ? Math.max(0, grid.sizePercent) : 0
          const place = (w: number, h: number) => ({
            x: step > 0 ? Math.round((x - w / 2) / step) * step + w / 2 : x,
            y: step > 0 ? Math.round((y - h / 2) / step) * step + h / 2 : y,
          })

          if (files.length > 0) {
            const file = files[0]
            const mediaType = mimeToMediaType(file.type)
            if (!mediaType) return
            const { storeMediaBlob } = await import('../media/mediaStore')
            const src = await storeMediaBlob(file)
            const hitId = renderer.pickNode(x, y)
            const hitNode = hitId ? store.model.nodes.get(hitId) : undefined
            if (hitNode?.mediaType) {
              if (hitNode.mediaType === 'audio' && (mediaType === 'image' || mediaType === 'gif')) {
                store.updateNode(hitNode.id, { audioCoverSrc: src })
              } else {
                store.updateNode(hitNode.id, { mediaType, mediaSrc: src, mediaFileName: file.name })
                scheduleMediaAutosize(hitNode.id, mediaType, src)
              }
              store.select(hitNode.id)
              return
            }

            const size = defaultMediaSize(mediaType)
            const pos = place(size.w, size.h)
            const id = store.addNode({
              x: pos.x,
              y: pos.y,
              w: size.w,
              h: size.h,
              shape: 'rounded-rect',
              label: mediaType === 'markdown' ? 'Markdown' : mediaType === 'math' ? 'Math' : '',
              mediaType,
              mediaSrc: src,
              mediaFileName: file.name,
            })
            store.select(id)
            scheduleMediaAutosize(id, mediaType, src)
            return
          }

          // If a media kind was attached during dragstart, propagate it so
          // the inspector's Media dropdown shows the correct selection on
          // first focus (instead of "— none —").
          const mediaRaw = e.dataTransfer.getData(DRAG_MIME_MEDIA)
          const mediaType =
            mediaRaw === '' ? undefined : (mediaRaw as NonNullable<import('../model/types').ModelNode['mediaType']>)
          const nodeShape: NodeShape = shape || DEFAULT_NODE.shape
          const cosmeticShape = isCosmeticShape(nodeShape) ? nodeShape : null
          const cosmeticDefaults = cosmeticShape ? cosmeticNodeDefaults(cosmeticShape) : null
          const size = mediaType
            ? defaultMediaSize(mediaType)
            : cosmeticDefaults
              ? { w: cosmeticDefaults.w, h: cosmeticDefaults.h }
              : { w: DEFAULT_NODE.w, h: DEFAULT_NODE.h }
          const pos = place(size.w, size.h)
          const id = store.addNode({
            x: pos.x,
            y: pos.y,
            w: size.w,
            h: size.h,
            ...(cosmeticDefaults
              ? { ...cosmeticDefaults, flowEffects: [defaultCosmeticEffect(cosmeticShape!)] }
              : { shape: nodeShape }),
            label: mediaType === 'markdown' ? 'Markdown' : mediaType === 'math' ? 'Math' : '',
            ...(mediaType ? {
              mediaType,
              ...(mediaType === 'markdown' || mediaType === 'math'
                ? { contentSource: '', contentCollapsed: true }
                : {}),
            } : {}),
          })
          store.select(id)
        }}
        />
      )}
      {onHome && !isCreative && (
        <>
          <button
            type="button"
            className="social-home-button"
            onClick={onHome}
            aria-label="Back to diagram search"
            title="Back to diagram search"
          >
            <span className="social-home-icon" aria-hidden />
          </button>
          <button
            type="button"
            className="social-settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Graph settings"
            title="Graph settings"
          >
            <span className="social-settings-icon" aria-hidden />
          </button>
        </>
      )}
      {showFps && <FpsOverlay renderer={renderer} />}
      {graphMounted && showToolbar && (
        <EditorToolbar
          renderer={renderer}
          onHome={isCreative ? undefined : onHome}
          onApplyToMainGraph={isCreative ? () => void applyCreativeToMain() : undefined}
          applyToMainDisabled={!creativeSourceIsCurrent || !creativeSync.sourceBaseBundleBase64 || !creativeHasChanges}
          applyToMainTitle={applyToMainTitle}
          onPullMerge={isCreative ? () => void pullAndMergeCreative() : undefined}
          pullMergeDisabled={!sourceDiagramId || !creativeSourceIsStale || !creativeSync.sourceBaseBundleBase64}
          pullMergeTitle={pullMergeTitle}
        />
      )}
      {graphMounted && showDevPanel && <DevPanel renderer={renderer} />}
      {graphMounted && isCreative && (
        <CreativeModeControls
          onHome={onHome}
          onViewGraph={handleReturnToGraph}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {graphMounted && showSidebars && (
        <LeftSidebar
          variant={isCreative ? 'creative' : 'public'}
          initialCollapsed={!isCreative}
        />
      )}
      {graphMounted && showSidebars && (
        <RightSidebar
          renderer={renderer}
          variant={isCreative ? 'default' : 'public'}
          initialCollapsed={!isCreative}
          diagramId={cloudDiagramId}
        />
      )}
      {showPublicSidebars && !showSidebars && (
        <>
          <LeftSidebar variant="public" initialCollapsed />
          <RightSidebar renderer={renderer} variant="public" initialCollapsed diagramId={cloudDiagramId} />
        </>
      )}
      {graphMounted && <ConnectionReferencePopup renderer={renderer} />}
      {graphMounted && <RichNodeOverlay renderer={renderer} />}
      {graphMounted && <MpdDialOverlay renderer={renderer} />}
      {graphMounted && <NodeLabelEditor renderer={renderer} hostRef={hostRef} />}
      {!isCreative && (
        <SocialForumLayer
          diagramId={cloudDiagramId}
          projectTopic={cloudDiagramTopic}
          projectDescription={cloudDiagramDescription}
          themeMode={themeMode}
          renderer={graphMounted ? renderer : null}
          onHome={onHome}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenChange={setForumOpen}
        />
      )}
      {!isCreative && graphMounted && cloudDiagramId && onOpenCreativeDiagram && (
        <CreativeModeRail
          sourceDiagramId={cloudDiagramId}
          sourceTitle={sourceDiagramTitle ?? useOmniStore.getState().model.name}
          onOpenCreativeDiagram={onOpenCreativeDiagram}
        />
      )}
      {settingsOpen && (
        <GraphSettingsDialog
          preferences={preferences}
          onPreferencesChange={updatePreferences}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {creativeStatus && isCreative && (
        <div className={`creative-mode-status ${creativeStatusLeaving ? 'is-leaving' : ''}`} role="status">
          {creativeStatus}
        </div>
      )}
      {creativeApplySteps && sourceDiagramId && (
        <CreativeApplyModal
          diagramId={sourceDiagramId}
          sourceTitle={sourceDiagramTitle}
          steps={creativeApplySteps}
          onClose={() => setCreativeApplySteps(null)}
          onCreated={() => {
            setCreativeApplySteps(null)
            setCreativeStatus('Main graph proposal created.')
          }}
        />
      )}
      {graphMounted && pickMode === 'link-node' && <PickModeBanner />}
    </div>
  )
}

function mimeToMediaType(mime: string): ModelNode['mediaType'] | null {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return null
}

function CreativeApplyModal({
  diagramId,
  sourceTitle,
  steps,
  onClose,
  onCreated,
}: {
  diagramId: string
  sourceTitle?: string
  steps: GraphProposalStep[]
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState(`Apply creative changes${sourceTitle ? ` to ${sourceTitle}` : ''}`)
  const [description, setDescription] = useState('Changes prepared from Creative Mode.')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const groups = changeGroupsForSteps(steps, useOmniStore.getState().model, useOmniStore.getState().models)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createForumTopic(diagramId, {
        forumRef: 'diagram',
        title,
        description,
        proposal: steps.length === 1 ? steps[0] : { action: 'chain', steps },
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create main graph proposal')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="social-modal-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <form className="social-post-modal" onSubmit={(event) => void submit(event)} aria-label="Apply creative changes">
        <header>
          <h3>Apply to main graph</h3>
        </header>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <ol className="creative-apply-change-list">
          {groups.map((group, index) => (
            <li key={`${group.id}-${index}`}>{index + 1}. {group.title}</li>
          ))}
        </ol>
        {error && <div className="social-forum-error">{error}</div>}
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>Post proposal</button>
        </footer>
      </form>
    </div>
  )
}

function mergePublicIntoCreative(
  previousPublic: ProjectSnapshot,
  latestPublic: ProjectSnapshot,
  creative: ProjectSnapshot,
): ProjectSnapshot {
  const rootId = creative.rootModelId
  const previousRoot = previousPublic.models.get(previousPublic.rootModelId)
  const latestRoot = latestPublic.models.get(latestPublic.rootModelId)
  const creativeRoot = creative.models.get(rootId)
  if (!previousRoot || !latestRoot || !creativeRoot) return creative
  const nodes = mergeEntityMap(previousRoot.nodes, latestRoot.nodes, creativeRoot.nodes)
  const edges = mergeEntityMap(previousRoot.edges, latestRoot.edges, creativeRoot.edges)
  const crossLinks = sameJson(previousRoot.crossLinks ?? [], latestRoot.crossLinks ?? [])
    ? creativeRoot.crossLinks
    : latestRoot.crossLinks?.map((link) => ({ ...link, from: { ...link.from }, to: { ...link.to } }))
  const root: Model = { ...creativeRoot, nodes, edges, ...(crossLinks ? { crossLinks } : {}) }
  const models = new Map(creative.models)
  models.set(rootId, root)
  for (const [id, model] of latestPublic.models) {
    if (id === latestPublic.rootModelId) continue
    const previous = previousPublic.models.get(id)
    if (!previous || !sameJson(previous, model)) models.set(id, cloneModel(model))
  }
  return { rootModelId: rootId, models }
}

function mergeEntityMap<T extends { id: string }>(
  previous: ReadonlyMap<string, T>,
  latest: ReadonlyMap<string, T>,
  creative: ReadonlyMap<string, T>,
): Map<string, T> {
  const merged = new Map<string, T>()
  const ids = new Set([...previous.keys(), ...latest.keys(), ...creative.keys()])
  for (const id of ids) {
    const before = previous.get(id)
    const pub = latest.get(id)
    const own = creative.get(id)
    if (!pub && before) continue
    if (pub && (!before || !sameJson(before, pub))) {
      merged.set(id, cloneEntity(pub))
      continue
    }
    if (own) merged.set(id, cloneEntity(own))
  }
  return merged
}

function applyProjectRootAsUndoable(nextProject: ProjectSnapshot): void {
  const beforeProject = currentProjectSnapshot()
  if (!nextProject.models.has(nextProject.rootModelId)) return
  useOmniStore.getState().applyTransaction(diffProjectPatches(beforeProject, nextProject))
}

function diffProjectPatches(beforeProject: ProjectSnapshot, afterProject: ProjectSnapshot): Patch[] {
  const beforeRoot = beforeProject.models.get(beforeProject.rootModelId)
  const afterRoot = afterProject.models.get(afterProject.rootModelId)
  if (!beforeRoot || !afterRoot) return []
  const patches = diffRootPatches(beforeRoot, afterRoot)
  for (const [id, model] of beforeProject.models) {
    if (id === beforeProject.rootModelId) continue
    if (!afterProject.models.has(id)) patches.push({ kind: 'model', op: 'remove', model })
  }
  for (const [id, model] of afterProject.models) {
    if (id === afterProject.rootModelId) continue
    const previous = beforeProject.models.get(id)
    if (!previous) patches.push({ kind: 'model', op: 'add', model })
    else if (!sameJson(previous, model)) patches.push({ kind: 'model', op: 'update', id, before: previous, after: model })
  }
  return patches
}

function diffRootPatches(before: Model, after: Model): Patch[] {
  const patches: Patch[] = []
  for (const [id, edge] of before.edges) if (!after.edges.has(id)) patches.push({ kind: 'edge', op: 'remove', edge })
  for (const [id, node] of before.nodes) if (!after.nodes.has(id)) patches.push({ kind: 'node', op: 'remove', node })
  for (const [id, node] of after.nodes) {
    const previous = before.nodes.get(id)
    if (!previous) patches.push({ kind: 'node', op: 'add', node })
    else if (!sameJson(previous, node)) patches.push({ kind: 'node', op: 'update', id, before: previous, after: node })
  }
  for (const [id, edge] of after.edges) {
    const previous = before.edges.get(id)
    if (!previous) patches.push({ kind: 'edge', op: 'add', edge })
    else if (!sameJson(previous, edge)) patches.push({ kind: 'edge', op: 'update', id, before: previous, after: edge })
  }
  return patches
}

function cloneModel(model: Model): Model {
  return {
    ...model,
    nodes: new Map([...model.nodes].map(([id, node]) => [id, cloneEntity(node)])),
    edges: new Map([...model.edges].map(([id, edge]) => [id, cloneEntity(edge)])),
    crossLinks: model.crossLinks?.map((link) => ({ ...link, from: { ...link.from }, to: { ...link.to } })),
  }
}

function cloneEntity<T>(entity: T): T {
  return JSON.parse(JSON.stringify(entity)) as T
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function defaultMediaSize(mediaType: NonNullable<ModelNode['mediaType']>): { w: number; h: number } {
  switch (mediaType) {
    case 'audio': return pxSize(200, 80)
    case 'video': return pxSize(200, 140)
    case 'markdown': return pxSize(240, 60)
    case 'math': return pxSize(200, 60)
    case 'image':
    case 'gif':
      return pxSize(160, 120)
  }
}

function pxSize(w: number, h: number): { w: number; h: number } {
  return { w: (w / SCENE_W) * 100, h: (h / SCENE_H) * 100 }
}

function scheduleMediaAutosize(
  nodeId: string,
  mediaType: NonNullable<ModelNode['mediaType']>,
  src: string,
): void {
  if (mediaType === 'image' || mediaType === 'gif') {
    const img = new Image()
    img.onload = () => fitMediaNode(nodeId, img.naturalWidth, img.naturalHeight, 60, 40)
    img.src = src
  } else if (mediaType === 'video') {
    const video = document.createElement('video')
    video.onloadedmetadata = () => fitMediaNode(nodeId, video.videoWidth, video.videoHeight, 100, 80)
    video.src = src
  }
}

function fitMediaNode(nodeId: string, naturalW: number, naturalH: number, minW: number, minH: number): void {
  if (naturalW <= 0 || naturalH <= 0) return
  const maxW = 400
  const maxH = 400
  const ratio = Math.min(1, maxW / naturalW, maxH / naturalH)
  const w = Math.max(minW, Math.round(naturalW * ratio))
  const h = Math.max(minH, Math.round(naturalH * ratio))
  useOmniStore.getState().updateNode(nodeId, pxSize(w, h))
}

function useCloudAutosave(diagramId: string | undefined): void {
  useEffect(() => {
    if (!diagramId) return
    let timer = 0
    let saving = false
    let pending = false
    let lastSavedRev = -1
    let disposed = false

    const flush = async () => {
      if (disposed) return
      if (saving) {
        pending = true
        return
      }
      const state = useOmniStore.getState()
      const rev = state.rev
      if (rev === lastSavedRev) return
      saving = true
      pending = false
      try {
        const models = new Map(state.models)
        models.set(state.model.id, state.model)
        const snapshot = { rootModelId: state.model.id, models }
        recomputeTransformDraft(snapshot)
        const blob = await exportBundle(projectWithoutPublicGraphDrafts(snapshot))
        await saveCloudDiagram(diagramId, {
          title: state.model.name || 'Untitled diagram',
          bundleBase64: await blobToBase64(blob),
        })
        lastSavedRev = rev
      } catch (err) {
        if (isAutosaveAuthPause(err)) {
          lastSavedRev = rev
          return
        }
        console.error('Autosave failed:', err)
      } finally {
        saving = false
        if (!disposed && (pending || useOmniStore.getState().rev !== lastSavedRev)) schedule()
      }
    }

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void flush(), 800)
    }

    const unsubscribe = useOmniStore.subscribe((state) => {
      if (state.rev !== lastSavedRev) schedule()
    })
    schedule()

    return () => {
      disposed = true
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [diagramId])
}

function isAutosaveAuthPause(err: unknown): boolean {
  if (err instanceof AuthRequiredError) return true
  if (!(err instanceof Error)) return false
  return err.message === 'Login required' || err.message === 'Verify your email to continue'
}

function useCreativeAutosave(diagramId: string | undefined): void {
  useEffect(() => {
    if (!diagramId) return
    let timer = 0
    let saving = false
    let pending = false
    let lastSavedRev = -1
    let disposed = false

    const flush = async () => {
      if (disposed) return
      if (saving) {
        pending = true
        return
      }
      const state = useOmniStore.getState()
      const rev = state.rev
      if (rev === lastSavedRev) return
      saving = true
      pending = false
      try {
        const blob = await exportBundle(currentProjectSnapshot())
        await saveCreativeDiagram(diagramId, {
          title: state.model.name || 'Untitled creative graph',
          bundleBase64: await blobToBase64(blob),
        })
        lastSavedRev = rev
      } catch (err) {
        console.error('Creative autosave failed:', err)
      } finally {
        saving = false
        if (!disposed && (pending || useOmniStore.getState().rev !== lastSavedRev)) schedule()
      }
    }

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void flush(), 800)
    }

    const unsubscribe = useOmniStore.subscribe((state) => {
      if (state.rev !== lastSavedRev) schedule()
    })
    schedule()

    return () => {
      disposed = true
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [diagramId])
}

function currentProjectSnapshot() {
  const state = useOmniStore.getState()
  const models = new Map(state.models)
  models.set(state.model.id, state.model)
  return { rootModelId: state.model.id, models }
}

function CreativeModeRail({
  sourceDiagramId,
  sourceTitle,
  onOpenCreativeDiagram,
}: {
  sourceDiagramId: string
  sourceTitle: string
  onOpenCreativeDiagram: (diagram: CreativeDiagramSummary) => Promise<void>
}) {
  const [chooserOpen, setChooserOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [copies, setCopies] = useState<CreativeDiagramSummary[]>([])
  const [copyTitle, setCopyTitle] = useState(`${sourceTitle || 'Graph'} creative copy`)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openChooser = async () => {
    setError(null)
    setLoading(true)
    try {
      const account = await getCurrentAccount()
      if (!account || !account.emailVerified) {
        setAuthOpen(true)
        return
      }
      setCopies(await listCreativeCopies(sourceDiagramId))
      setCopyTitle(`${sourceTitle || 'Graph'} creative copy`)
      setChooserOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creative Mode failed')
    } finally {
      setLoading(false)
    }
  }

  const createCopy = async (event: FormEvent) => {
    event.preventDefault()
    const title = copyTitle.trim()
    if (!title) {
      setError('Creative copy name is required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const snapshot = currentProjectSnapshot()
      recomputeTransformDraft(snapshot)
      const publicSnapshot = projectWithoutPublicGraphDrafts(snapshot)
      const bundleBase64 = await blobToBase64(await exportBundle(publicSnapshot))
      const copy = await createCreativeCopy(sourceDiagramId, { title, bundleBase64 })
      await onOpenCreativeDiagram(copy)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create creative copy')
    } finally {
      setLoading(false)
    }
  }

  const openCopy = async (copy: CreativeDiagramSummary) => {
    setLoading(true)
    setError(null)
    try {
      await onOpenCreativeDiagram(copy)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open creative copy')
      setLoading(false)
    }
  }

  const removeCopy = async (copy: CreativeDiagramSummary) => {
    if (!window.confirm(`Remove creative copy "${copy.title}"?`)) return
    setLoading(true)
    setError(null)
    try {
      await deleteCreativeDiagram(copy.id)
      setCopies((current) => current.filter((item) => item.id !== copy.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove creative copy')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="editor-mode-rail"
        onClick={() => void openChooser()}
        disabled={loading}
        aria-label="Open Creative Mode"
      >
        Creative Mode
      </button>
      {error && !chooserOpen && <div className="creative-mode-error">{error}</div>}
      {authOpen && (
        <CreativeAuthDialog
          onClose={() => setAuthOpen(false)}
          onAuthenticated={async () => {
            setAuthOpen(false)
            await openChooser()
          }}
        />
      )}
      {chooserOpen && (
        <div className="social-modal-backdrop" role="presentation">
          <section className="creative-copy-modal" role="dialog" aria-label="Choose creative copy">
            <header>
              <div>
                <h3>Creative Mode</h3>
                <p>{sourceTitle || 'Untitled graph'}</p>
              </div>
              <button type="button" onClick={() => setChooserOpen(false)} disabled={loading}>
                Close
              </button>
            </header>
            {error && <div className="social-forum-error">{error}</div>}
            <div className="creative-copy-list">
              {copies.length === 0 ? (
                <p className="creative-copy-empty">No private copies yet.</p>
              ) : copies.map((copy) => (
                <div key={copy.id} className="creative-copy-row">
                  <button
                    type="button"
                    onClick={() => void openCopy(copy)}
                    disabled={loading}
                    className="creative-copy-open"
                  >
                    <strong>{copy.title}</strong>
                    <span>updated {formatCreativeDate(copy.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeCopy(copy)}
                    disabled={loading}
                    className="creative-copy-remove"
                    aria-label="Remove creative copy"
                    title="Remove creative copy"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <form className="creative-copy-create" onSubmit={(event) => void createCopy(event)}>
              <label>
                New creative copy
                <input
                  value={copyTitle}
                  onChange={(e) => setCopyTitle(e.target.value)}
                  disabled={loading}
                />
              </label>
              <button type="submit" disabled={loading}>Create and open</button>
            </form>
          </section>
        </div>
      )}
    </>
  )
}

function CreativeAuthDialog({
  onClose,
  onAuthenticated,
}: {
  onClose: () => void
  onAuthenticated: () => Promise<void>
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login')
  const [login, setLogin] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [devMessages, setDevMessages] = useState<DevVerificationMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadDevInbox = async () => {
    setDevMessages(await listDevVerificationMessages())
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (mode === 'verify') {
        const user = await verifyEmail(verificationCode)
        if (!user.emailVerified) throw new Error('Email is still unverified')
        await onAuthenticated()
      } else {
        const result = mode === 'login'
          ? await loginAccount(login, password)
          : await registerAccount(username, email, password)
        if (!result.user.emailVerified) {
          setMode('verify')
          await loadDevInbox()
          return
        }
        await onAuthenticated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="social-modal-backdrop" role="presentation">
      <form className="creative-auth-modal" role="dialog" aria-label="Creative Mode login" onSubmit={(event) => void submit(event)}>
        <header>
          <h3>{mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Verify email'}</h3>
          <button type="button" onClick={onClose} disabled={loading}>Close</button>
        </header>
        <p>Creative Mode saves private graph copies under your verified profile.</p>
        {error && <div className="social-forum-error">{error}</div>}
        {mode === 'login' && (
          <>
            <label>
              Username or email
              <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </>
        )}
        {mode === 'register' && (
          <>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        {mode === 'verify' && (
          <>
            <label>
              Verification code
              <input value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} autoComplete="one-time-code" />
            </label>
            <div className="social-auth-dev-inbox">
              <button type="button" onClick={() => void loadDevInbox()}>Refresh dev inbox</button>
              <button
                type="button"
                onClick={() => {
                  void resendVerificationEmail()
                    .then(() => loadDevInbox())
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not resend verification'))
                }}
              >
                Resend
              </button>
              {devMessages.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  className="social-auth-dev-message"
                  onClick={() => {
                    if (message.code) setVerificationCode(message.code)
                  }}
                >
                  <strong>{message.username}</strong>
                  {message.code && <code>{message.code}</code>}
                </button>
              ))}
            </div>
          </>
        )}
        <button type="submit" disabled={loading}>{mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Verify email'}</button>
        <button
          type="button"
          className="creative-auth-switch"
          onClick={() => setMode((current) => current === 'login' ? 'register' : 'login')}
          disabled={loading}
        >
          {mode === 'login' ? 'Create an account' : 'I already have an account'}
        </button>
      </form>
    </div>
  )
}

function CreativeModeControls({
  onHome,
  onViewGraph,
  onOpenSettings,
}: {
  onHome?: () => void
  onViewGraph?: () => void
  onOpenSettings: () => void
}) {
  return (
    <div className="creative-mode-controls" aria-label="Creative Mode navigation">
      {onHome && (
        <button
          type="button"
          className="creative-home-button"
          onClick={onHome}
          aria-label="Back to diagram search"
          title="Back to diagram search"
        >
          <span className="social-home-icon" aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="creative-settings-button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
      >
        <span className="social-settings-icon" aria-hidden />
      </button>
      {onViewGraph && (
        <button type="button" className="creative-return-rail" onClick={onViewGraph}>
          Return
        </button>
      )}
    </div>
  )
}

function formatCreativeDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function GraphSettingsDialog({
  preferences,
  onPreferencesChange,
  onClose,
}: {
  preferences: SocialUserPreferences
  onPreferencesChange: (patch: SocialUserPreferences) => void
  onClose: () => void
}) {
  useSyncExternalStore(
    useOmniStore.subscribe,
    () => useOmniStore.getState().rev,
    () => 0,
  )
  const grid = useOmniStore.getState().model.grid ?? DEFAULT_GRID
  const themeMode = preferences.themeMode ?? 'light-dark'
  const background = preferences.background ?? defaultBackgroundForType('gradient')
  const updateGrid = (patch: Partial<GridSettings>) => useOmniStore.getState().setGrid(patch)
  const updateBackground = (next: BackgroundConfig) => onPreferencesChange({ background: next })
  const updateTheme = (next: ThemeMode) => onPreferencesChange({ themeMode: next })
  const backgroundType = background.type === 'image' ? 'gradient' : background.type

  return (
    <div className="social-modal-backdrop" role="presentation">
      <section className="social-settings-modal" role="dialog" aria-label="Graph settings">
        <header>
          <h3>Settings</h3>
          <button type="button" onClick={onClose} aria-label="Close settings">Close</button>
        </header>
        <div className="social-settings-group">
          <h4>Appearance</h4>
          <label>
            Theme preset
            <select
              value={themeMode}
              onChange={(e) => updateTheme(e.target.value as ThemeMode)}
            >
              <optgroup label="Base">
                {ALL_THEME_OPTIONS.filter((option) => option.group === 'base').map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </optgroup>
              <optgroup label="Topical">
                {ALL_THEME_OPTIONS.filter((option) => option.group === 'topical').map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            Background style
            <select
              value={backgroundType}
              onChange={(e) => updateBackground(defaultBackgroundForType(e.target.value as BackgroundType))}
            >
              <option value="gradient">Gradient</option>
              <option value="pattern">Pattern</option>
              <option value="solid">Solid color</option>
            </select>
          </label>
          {backgroundType === 'gradient' && (
            <label>
              Gradient preset
              <select
                value={presetIdForBackground(background, GRADIENT_PRESETS)}
                onChange={(e) => {
                  const preset = GRADIENT_PRESETS.find((item) => item.id === e.target.value)
                  if (preset) updateBackground({ type: 'gradient', value: preset.value })
                }}
              >
                {presetIdForBackground(background, GRADIENT_PRESETS) === 'custom' && (
                  <option value="custom">Custom</option>
                )}
                {GRADIENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
            </label>
          )}
          {backgroundType === 'pattern' && (
            <label>
              Pattern preset
              <select
                value={presetIdForBackground(background, PATTERN_PRESETS)}
                onChange={(e) => {
                  const preset = PATTERN_PRESETS.find((item) => item.id === e.target.value)
                  if (preset) updateBackground({ type: 'pattern', value: preset.value })
                }}
              >
                {presetIdForBackground(background, PATTERN_PRESETS) === 'custom' && (
                  <option value="custom">Custom</option>
                )}
                {PATTERN_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
            </label>
          )}
          {backgroundType === 'solid' && (
            <label>
              Background color
              <input
                type="color"
                value={colorInputValue(background.value)}
                onChange={(e) => updateBackground({ type: 'solid', value: e.target.value })}
              />
            </label>
          )}
          <div className="social-settings-preview" style={resolveBackground(background)} aria-hidden />
        </div>
        <div className="social-settings-group">
          <h4>Grid</h4>
          <label className="social-settings-check">
            <input
              type="checkbox"
              checked={grid.enabled}
              onChange={(e) => updateGrid({ enabled: e.target.checked })}
            />
            Show grid
          </label>
          <label className="social-settings-check">
            <input
              type="checkbox"
              checked={grid.snap}
              onChange={(e) => updateGrid({ snap: e.target.checked })}
            />
            Snap to grid
          </label>
          <label>
            Grid size %
            <input
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={grid.sizePercent}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next)) updateGrid({ sizePercent: next })
              }}
            />
          </label>
          <label>
            Grid appearance
            <select
              value={grid.appearance ?? DEFAULT_GRID.appearance}
              onChange={(e) =>
                updateGrid({ appearance: e.target.value as NonNullable<GridSettings['appearance']> })
              }
            >
              <option value="lines">Lines</option>
              <option value="dots">Dots</option>
              <option value="tile">Tile</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  )
}

function defaultBackgroundForType(type: BackgroundType): BackgroundConfig {
  if (type === 'pattern') {
    const preset = PATTERN_PRESETS[0]
    return { type: 'pattern', value: preset?.value ?? '' }
  }
  if (type === 'solid') return { type: 'solid', value: '#e8eef6' }
  const preset = GRADIENT_PRESETS[0]
  return {
    type: 'gradient',
    value: preset?.value ?? 'radial-gradient(circle at 30% 20%, #f5f9ff, #dfebf8)',
  }
}

function presetIdForBackground(
  background: BackgroundConfig,
  presets: readonly { id: string; value: string }[],
): string {
  return presets.find((preset) => preset.value === background.value)?.id ?? 'custom'
}

function colorInputValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#e8eef6'
}

const SOCIAL_PREFS_KEY = 'omnigram-social-preferences'

function loadLocalPreferences(): SocialUserPreferences {
  try {
    const raw = window.localStorage.getItem(SOCIAL_PREFS_KEY)
    return raw ? JSON.parse(raw) as SocialUserPreferences : {}
  } catch {
    return {}
  }
}

function storeLocalPreferences(preferences: SocialUserPreferences): void {
  try {
    window.localStorage.setItem(SOCIAL_PREFS_KEY, JSON.stringify(preferences))
  } catch {
    /* localStorage can be unavailable */
  }
}

/**
 * Diagram background layer. Sits below the canvas and renders solid /
 * gradient / pattern / image backgrounds via plain CSS — no GPU cost.
 */
function BackgroundLayer({ config }: { config: BackgroundConfig | undefined }) {
  if (!config) return null
  const style = resolveBackground(config)
  // Image backgrounds need an extra <img>-style layer for fit + opacity + blur.
  if (config.type === 'image') {
    return (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${config.value})`,
          backgroundSize: config.fit === 'contain' ? 'contain' : config.fit === 'tile' ? 'auto' : 'cover',
          backgroundRepeat: config.fit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center center',
          opacity: config.opacity ?? 1,
          filter: config.blur ? `blur(${config.blur}px)` : undefined,
          pointerEvents: 'none',
        }}
      />
    )
  }
  return (
    <div
      aria-hidden
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}
    />
  )
}

function DevPanel({ renderer }: { renderer: SceneRenderer | null }) {
  const [bench, setBench] = useState<BenchResult | null>(null)
  const [running, setRunning] = useState(false)
  const runBench = async (scenario: string) => {
    if (!renderer || running) return
    setRunning(true)
    setBench(null)
    try {
      const result = await runScenario(scenario, renderer, { durationMs: 3000 })
      setBench(result)
      console.table(result)
    } finally {
      setRunning(false)
    }
  }
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 9,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 500 }))}>
          Spawn 500
        </button>
        <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 1000 }))}>
          Spawn 1000
        </button>
        <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 2000 }))}>
          Spawn 2000
        </button>
        <button
          onClick={() =>
            useOmniStore
              .getState()
              .loadModel(spawnGrid({ count: 100, spacingPercent: 9, mixedShapes: true }))
          }
        >
          Shapes demo
        </button>
        <button
          onClick={() => {
            const { root, children } = spawnNested()
            const store = useOmniStore.getState()
            for (const c of children) store.registerModel(c)
            store.loadModel(root)
          }}
          title="RMM demo: select a parent node and scroll up to zoom into its child model"
        >
          Spawn Nested
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {listScenarios().map((s) => (
          <button key={s} disabled={!renderer || running} onClick={() => void runBench(s)}>
            Bench: {s}
          </button>
        ))}
      </div>
      {bench && (
        <div
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: '#cfe',
            padding: '6px 10px',
            font: '11px monospace',
            borderRadius: 4,
            whiteSpace: 'pre',
          }}
        >
          {`${bench.scenario}  frames=${bench.frames}  fps p50=${bench.fpsP50} p95=${bench.fpsP95}  ms p50=${bench.frameMsP50} p95=${bench.frameMsP95} max=${bench.frameMsMax}`}
        </div>
      )}
    </div>
  )
}

function MpdDialOverlay({ renderer }: { renderer: SceneRenderer | null }) {
  // Re-render on rev/selection changes.
  useSyncExternalStore(
    (cb) => useOmniStore.subscribe(cb),
    () => useOmniStore.getState().rev * 65537 + useOmniStore.getState().selRev,
    () => 0,
  )
  const state = useOmniStore.getState()
  if (!renderer) return null
  // Dial appears only when exactly one node is selected and that node has
  // ≥2 MPD dimensions to choose from.
  if (state.selectedIds.size !== 1) return null
  const sourceId = state.selectedIds.values().next().value as string
  const sourceNode = state.model.nodes.get(sourceId)
  const dims = sourceNode?.mpdDimensions
  if (!sourceNode || !dims || dims.length < 2) return null
  const options = resolveMpdOptions(sourceNode, state.models)
  if (options.length < 2) return null
  const activeIndex = Math.max(0, options.findIndex((o) => o.id === state.model.id))

  const handleSelect = (idx: number, direction: 'left' | 'right') => {
    const option = options[idx]
    if (!option) return
    void switchMpdDimension(
      sourceId,
      option,
      direction,
      {
        begin: () => renderer.beginMpdCurtain(),
        play: (dir, duration) => renderer.playMpdCurtain(dir, duration),
      },
      500,
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 12,
      }}
    >
      <MpdDial options={options} activeIndex={activeIndex} onSelect={handleSelect} />
    </div>
  )
}

/**
 * In-place label editor: a `<textarea>` overlay sized + positioned to match
 * the focused node's screen rect. Mounted only when `editingNodeId` is set
 * (double-click on a node). Commits on blur or Enter (without Shift);
 * cancels on Escape.
 */
function NodeLabelEditor({
  renderer,
  hostRef,
}: {
  renderer: SceneRenderer | null
  hostRef: React.RefObject<HTMLDivElement | null>
}) {
  // Subscribe to editing/rev/selection so we re-render when state changes.
  useSyncExternalStore(
    (cb) => useOmniStore.subscribe(cb),
    () => {
      const s = useOmniStore.getState()
      return s.rev * 65537 + s.selRev
    },
    () => 0,
  )
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const editingId = useOmniStore.getState().editingNodeId
  const node = editingId ? useOmniStore.getState().model.nodes.get(editingId) : null
  const [draft, setDraft] = useState('')

  // Reset draft when target changes.
  useEffect(() => {
    if (node) {
      setDraft(node.label)
      // Defer focus so the overlay is mounted first.
      requestAnimationFrame(() => {
        const el = taRef.current
        if (el) {
          el.focus()
          el.select()
        }
      })
    }
    // We only want to seed the draft when the editing target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  if (!renderer || !editingId || !node) return null

  const cam = renderer.getCamera()
  const vp = renderer.getViewport()
  const s = cam.freeScale
  const cx = vp.width / 2 + (cam.panX + (node.x / 100) * SCENE_W) * s
  const cy = vp.height / 2 + (cam.panY + (node.y / 100) * SCENE_H) * s
  const w = (node.w / 100) * SCENE_W * s
  const h = (node.h / 100) * SCENE_H * s

  const commit = () => {
    const trimmed = draft
    const isTemporary = node.extra?.temporaryName === true
    if (isTemporary && trimmed.trim().length === 0) {
      useOmniStore.getState().removeNodes([editingId])
    } else if (trimmed !== node.label || isTemporary) {
      const nextExtra = isTemporary
        ? dropTemporaryName(node.extra)
        : node.extra
      useOmniStore.getState().updateNode(editingId, { label: trimmed, extra: nextExtra })
    }
    useOmniStore.getState().setEditingNode(null)
  }
  const cancel = () => {
    if (node.extra?.temporaryName === true) {
      useOmniStore.getState().removeNodes([editingId])
    }
    useOmniStore.getState().setEditingNode(null)
  }

  // Position is relative to the host div (the renderer canvas parent).
  const hostRect = hostRef.current?.getBoundingClientRect()
  const left = (hostRect?.left ?? 0) + cx - w / 2
  const top = (hostRect?.top ?? 0) + cy - h / 2

  return (
    <textarea
      ref={taRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        }
      }}
      style={{
        position: 'fixed',
        left,
        top,
        width: w,
        height: h,
        margin: 0,
        padding: 4,
        boxSizing: 'border-box',
        border: '2px solid #4aa3ff',
        borderRadius: 4,
        background: '#fff',
        color: '#223046',
        fontFamily: 'sans-serif',
        fontSize: Math.max(10, Math.min(28, h * 0.4)),
        textAlign: 'center',
        resize: 'none',
        zIndex: 100,
        outline: 'none',
      }}
    />
  )
}

function dropTemporaryName(extra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!extra || extra.temporaryName !== true) return extra
  const { temporaryName, ...rest } = extra
  void temporaryName
  return Object.keys(rest).length > 0 ? rest : undefined
}

/**
 * Floating banner shown while the canvas is in `pickMode === 'link-node'`.
 * Surfaces the link source's label and a Cancel button so the user can
 * abort the pick. Sits at the top centre of the viewport so it doesn't
 * occlude either sidebar.
 */
function PickModeBanner() {
  const sourceLabel = useSyncExternalStore(
    useOmniStore.subscribe,
    () => {
      const s = useOmniStore.getState()
      const id = s.selectedIds.size === 1 ? (s.selectedIds.values().next().value as string) : null
      const n = id ? s.model.nodes.get(id) : null
      return n?.label || n?.id || ''
    },
    () => '',
  )
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--ug-primary, #4aa3ff)',
        color: '#fff',
        padding: '8px 14px',
        borderRadius: 6,
        font: '600 14px system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      <span>
        Click a node to link
        {sourceLabel ? ` to "${sourceLabel}"` : ''}…
      </span>
      <button
        type="button"
        onClick={() => useOmniStore.getState().setPickMode(null)}
        style={{
          background: 'rgba(255,255,255,0.18)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 4,
          padding: '3px 10px',
          font: '600 13px system-ui, sans-serif',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  )
}
