import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { SceneRenderer } from '../scene/SceneRenderer'
import { SCENE_H, SCENE_W, type CameraTransform, type ViewportSize } from '../scene/sceneConstants'
import { useOmniStore } from '../model/store'
import type { ConnectionReference, Model, ModelNode } from '../model/types'
import { resolvePalette, type ThemeMode } from '../theme/themes'
import {
  addForumComment,
  createForumTopic,
  getCurrentAccount,
  getForumThread,
  listActiveProposals,
  listForumTopics,
  listSocialScores,
  loginAccount,
  logoutAccount,
  markProposalStatus,
  registerAccount,
  voteForumTopic,
  type AuthUser,
} from '../social/cloudClient'
import {
  diagramForumRef,
  edgeForumRef,
  findEdgeBetween,
  forumRefLabel,
  nodeForumRef,
  proposalActionLabel,
  type ForumComment,
  type ForumRef,
  type ForumThread,
  type ForumTopic,
  type EntitySocialScores,
  type GraphProposal,
  type GraphProposalAction,
  type GraphProposalPayload,
  type TransformProposalEntry,
  type TopicVoteValue,
  type VoteStance,
} from '../social/forumTypes'
import {
  applyAcceptedProposal,
} from '../social/proposalApply'
import {
  getTransformDraftEntries,
  getTransformDraftCount,
  recomputeTransformDraft,
  subscribeTransformDraft,
} from '../social/transformDraft'
import {
  getSocialEdgeDraftCount,
  getSocialEdgeDrafts,
  subscribeSocialEdgeDrafts,
  type SocialEdgeDraft,
} from '../social/graphDraft'

interface SocialForumLayerProps {
  diagramId?: string
  projectTopic?: string
  projectDescription?: string
  themeMode?: ThemeMode
  renderer: SceneRenderer | null
  onHome?: () => void
  onOpenSettings?: () => void
  onOpenChange?: (open: boolean) => void
}

export function SocialForumLayer({
  diagramId,
  projectTopic,
  projectDescription,
  themeMode = 'light-dark',
  renderer,
  onHome,
  onOpenSettings,
  onOpenChange,
}: SocialForumLayerProps) {
  const [open, setOpen] = useState(false)
  const [forumRef, setForumRef] = useState<ForumRef>(diagramForumRef())
  const [topics, setTopics] = useState<ForumTopic[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [thread, setThread] = useState<ForumThread | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const [postInitialAction, setPostInitialAction] = useState<GraphProposalAction | null>(null)
  const [postEdgeDraft, setPostEdgeDraft] = useState<SocialEdgeDraft | null>(null)
  const [transformPreview, setTransformPreview] = useState<TransformProposalEntry[] | null>(null)
  const [referencePreview, setReferencePreview] = useState<GraphProposal | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false)
  const [proposals, setProposals] = useState<GraphProposal[]>([])
  const [serverSocialScores, setServerSocialScores] = useState<EntitySocialScores>({ nodeScores: {}, edgeScores: {} })
  const [debugSocialScores, setDebugSocialScores] = useState<EntitySocialScores>({ nodeScores: {}, edgeScores: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const applyingRef = useRef(new Set<string>())
  const cameraBeforeForumRef = useRef<CameraTransform | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const postAfterAuthRef = useRef(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const [closing, setClosing] = useState(false)
  const revision = useSyncExternalStore(
    useOmniStore.subscribe,
    () => {
      const s = useOmniStore.getState()
      return s.rev * 65537 + s.selRev
    },
    () => 0,
  )
  const model = useOmniStore.getState().model
  const transformDraftCount = useSyncExternalStore(
    subscribeTransformDraft,
    () => getTransformDraftCount(useOmniStore.getState().model.id),
    () => 0,
  )
  const edgeDraftCount = useSyncExternalStore(
    subscribeSocialEdgeDrafts,
    getSocialEdgeDraftCount,
    () => 0,
  )
  const transformDraft = getTransformDraftEntries(model.id)
  const edgeDrafts = getSocialEdgeDrafts()
  const hasActiveTransformProposal = proposals.some(isActiveTransformProposal)
  void transformDraftCount
  void edgeDraftCount

  useEffect(() => {
    void getCurrentAccount().then(setCurrentUser).catch(() => setCurrentUser(null))
  }, [])

  useEffect(() => {
    const state = useOmniStore.getState()
    const models = new Map(state.models)
    models.set(state.model.id, state.model)
    recomputeTransformDraft({ rootModelId: state.model.id, models })
  }, [revision])

  useEffect(() => {
    if (!currentUser) setAccountMenuOpen(false)
  }, [currentUser])

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (accountMenuRef.current?.contains(target)) return
      setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [accountMenuOpen])

  useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const refreshTopics = useCallback(async () => {
    if (!diagramId) return
    setLoading(true)
    setError(null)
    try {
      setTopics(await listForumTopics(diagramId, forumRef))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Forum topics failed')
    } finally {
      setLoading(false)
    }
  }, [diagramId, forumRef])

  const refreshThread = useCallback(async () => {
    if (!diagramId || !threadId) {
      setThread(null)
      return
    }
    setError(null)
    try {
      setThread(await getForumThread(diagramId, threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Forum thread failed')
    }
  }, [diagramId, threadId])

  const refreshProposals = useCallback(async () => {
    if (!diagramId) return
    try {
      setProposals(await listActiveProposals(diagramId))
    } catch (err) {
      console.warn('Proposal refresh failed:', err)
    }
  }, [diagramId])

  const refreshSocialScores = useCallback(async () => {
    if (!diagramId) return
    try {
      setServerSocialScores(await listSocialScores(diagramId))
    } catch (err) {
      console.warn('Social score refresh failed:', err)
    }
  }, [diagramId])

  useEffect(() => {
    if (!open) return
    void refreshTopics()
  }, [open, refreshTopics])

  useEffect(() => {
    if (!open) return
    void refreshThread()
  }, [open, refreshThread])

  useEffect(() => {
    if (!diagramId) return
    void refreshProposals()
    const id = window.setInterval(() => void refreshProposals(), 5000)
    return () => window.clearInterval(id)
  }, [diagramId, refreshProposals])

  useEffect(() => {
    if (!renderer) return
    renderer.setGraphProposals(proposals)
    return () => renderer.setGraphProposals([])
  }, [renderer, proposals])

  useEffect(() => {
    void refreshSocialScores()
  }, [refreshSocialScores, proposals])

  useEffect(() => {
    if (!renderer) return
    renderer.setSocialScores(mergeSocialScores(serverSocialScores, debugSocialScores))
  }, [debugSocialScores, renderer, serverSocialScores])

  useEffect(() => {
    if (!diagramId) return
    for (const proposal of proposals) {
      if (proposal.status !== 'accepted' || applyingRef.current.has(proposal.id)) continue
      applyingRef.current.add(proposal.id)
      void (async () => {
        const result = applyAcceptedProposal(proposal)
        try {
          await markProposalStatus(
            diagramId,
            proposal.id,
            result.status,
            result.status === 'blocked' ? result.reason : undefined,
          )
          await refreshProposals()
          if (open) await refreshTopics()
          await refreshSocialScores()
        } catch (err) {
          console.warn('Proposal apply status update failed:', err)
        } finally {
          applyingRef.current.delete(proposal.id)
        }
      })()
    }
  }, [diagramId, proposals, refreshProposals, refreshTopics, refreshSocialScores, open, revision])

  const selectForum = useCallback((next: ForumRef) => {
    setForumRef(next)
    setThreadId(null)
    setThread(null)
    const nodes = selectedNodesForForum(model, next)
    const edges = selectedEdgesForForum(model, next)
    if (next === 'diagram') useOmniStore.getState().clearSelection()
    else useOmniStore.getState().selectMany(nodes, edges)
  }, [model])

  if (!diagramId) return null

  const openForum = () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
    cameraBeforeForumRef.current = { ...useOmniStore.getState().camera }
    setClosing(false)
    const selectedRef = forumRefFromGraphSelection(model)
    setForumRef(selectedRef ?? diagramForumRef())
    setOpen(true)
  }

  const closeForum = () => {
    const camera = cameraBeforeForumRef.current
    if (camera) useOmniStore.getState().setCamera(camera)
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
      closeTimerRef.current = null
    }, 260)
  }

  const openPost = () => {
    setPostInitialAction(null)
    setPostEdgeDraft(null)
    if (!currentUser) {
      postAfterAuthRef.current = true
      setAuthOpen(true)
      return
    }
    setPostOpen(true)
  }

  const openTransformPost = () => {
    const edgeDraft = edgeDrafts[0] ?? null
    if (!edgeDraft && hasActiveTransformProposal) {
      setError('A layout change proposal is already active for this graph.')
      return
    }
    setPostEdgeDraft(edgeDraft)
    setPostInitialAction(edgeDraft ? 'add-edge' : 'commit-transform')
    if (!currentUser) {
      postAfterAuthRef.current = true
      setAuthOpen(true)
      return
    }
    setPostOpen(true)
  }

  const applyDebugScore = (delta: number) => {
    const store = useOmniStore.getState()
    setDebugSocialScores((current) => {
      const nodeScores = { ...current.nodeScores }
      const edgeScores = { ...current.edgeScores }
      const nodeVotes = { ...(current.nodeVotes ?? {}) }
      const edgeVotes = { ...(current.edgeVotes ?? {}) }
      const addVote = (target: NonNullable<EntitySocialScores['nodeVotes']>, id: string) => {
        const currentVotes = target[id] ?? { positive: 0, negative: 0 }
        target[id] = delta >= 0
          ? { ...currentVotes, positive: currentVotes.positive + Math.max(1, Math.round(delta / 4)) }
          : { ...currentVotes, negative: currentVotes.negative + Math.max(1, Math.round(Math.abs(delta) / 4)) }
      }
      for (const id of store.selectedIds) nodeScores[id] = (nodeScores[id] ?? 0) + delta
      for (const id of store.selectedEdgeIds) edgeScores[id] = (edgeScores[id] ?? 0) + delta
      for (const id of store.selectedIds) addVote(nodeVotes, id)
      for (const id of store.selectedEdgeIds) addVote(edgeVotes, id)
      return { nodeScores, edgeScores, nodeVotes, edgeVotes }
    })
  }

  const activeForumTitle = forumTitlePart(forumRef, model, projectTopic)
  const topicCountLabel = `${topics.length} ${topics.length === 1 ? 'post' : 'posts'}`

  return (
    <>
      {!open && (
        <>
          <button
            type="button"
            className="social-forum-rail"
            onClick={openForum}
            aria-label="Open forum"
          >
            Forum
          </button>
          {(edgeDrafts.length > 0 || (transformDraft.length > 0 && !hasActiveTransformProposal)) && (
            <button
              type="button"
              className="social-transform-submit-button"
              onClick={openTransformPost}
              aria-label="Submit layout changes"
              title="Submit layout changes"
            >
              <span aria-hidden>⇧</span>
            </button>
          )}
          <div className="social-score-debug" aria-label="Debug social score controls">
            <button type="button" onClick={() => applyDebugScore(4)} title="Sample positive vote">+</button>
            <button type="button" onClick={() => applyDebugScore(-4)} title="Sample negative vote">−</button>
          </div>
        </>
      )}
      {open && (
        <section className={`social-forum-curtain ${closing ? 'closing' : 'open'}`} aria-label="Diagram forum">
          <button
            type="button"
            className="social-forum-collapse"
            onClick={closeForum}
            aria-label="View graph"
          >
            View Graph
          </button>
            {thread ? (
              <>
                {error && <div className="social-forum-error">{error}</div>}
                <ThreadView
                  diagramId={diagramId}
                  thread={thread}
                  currentUser={currentUser}
                  onLoginRequired={() => setAuthOpen(true)}
                  onBack={() => {
                    setThreadId(null)
                    setThread(null)
                    void refreshTopics()
                  }}
                  onChanged={async () => {
                    await refreshThread()
                    await refreshTopics()
                    await refreshSocialScores()
                  }}
                  onVote={async (topic, vote) => {
                    const next = await voteForumTopic(diagramId, topic.id, vote)
                    setThread((current) => current ? { ...current, topic: next } : current)
                    await refreshTopics()
                    await refreshSocialScores()
                  }}
                  onPreview={(transforms) => {
                    setTransformPreview(transforms)
                  }}
                  onReferencePreview={(proposal) => setReferencePreview(proposal)}
                />
              </>
            ) : (
              <>
                <header className="social-forum-header">
                  <div className="social-forum-brand">
                    <span className="social-forum-logo" aria-hidden>O</span>
                    <div>
                      <h2>{model.name || 'Untitled graph'}</h2>
                      <p>Forum · {activeForumTitle}</p>
                    </div>
                  </div>
                  <ForumSelector
                    key={forumRef}
                    model={model}
                    forumRef={forumRef}
                    onSelect={selectForum}
                  />
                  <div className="social-forum-actions">
                    {currentUser ? (
                      <div className="social-account-menu" ref={accountMenuRef}>
                        <button
                          type="button"
                          className="social-account-button"
                          aria-haspopup="menu"
                          aria-expanded={accountMenuOpen}
                          onClick={() => setAccountMenuOpen((value) => !value)}
                        >
                          {currentUser.username}
                        </button>
                        {accountMenuOpen && (
                          <div className="social-account-popover" role="menu">
                            <p>{currentUser.username}</p>
                            <small>{currentUser.reputation} reputation</small>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setProfileSettingsOpen(true)
                                setAccountMenuOpen(false)
                              }}
                            >
                              Profile settings
                            </button>
                            {onOpenSettings && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  onOpenSettings()
                                  setAccountMenuOpen(false)
                                }}
                              >
                                Settings
                              </button>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                void logoutAccount().then(() => {
                                  setCurrentUser(null)
                                  setAccountMenuOpen(false)
                                  onHome?.()
                                })
                              }}
                            >
                              Log out
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="social-account-button"
                        onClick={() => setAuthOpen(true)}
                      >
                        Log in
                      </button>
                    )}
                  </div>
                </header>
                <div className="social-forum-top">
                  <p className="social-forum-description">
                    {projectDescription?.trim() || `${projectTopic?.trim() || 'Diagram'} discussion for ${model.name || 'this graph'}.`}
                  </p>
                  <MiniDiagramPreview model={model} forumRef={forumRef} proposals={proposals} themeMode={themeMode} />
                </div>
                <main className="social-forum-body">
                  <div className="social-body-head">
                    <div>
                      <span>{topicCountLabel}</span>
                    </div>
                    <button type="button" className="social-forum-post" onClick={openPost}>
                      Post
                    </button>
                  </div>
                  {error && <div className="social-forum-error">{error}</div>}
                  <TopicList
                    topics={topics}
                    loading={loading}
                    currentUser={currentUser}
                    onLoginRequired={() => setAuthOpen(true)}
                    onVote={async (topic, vote) => {
                      await voteForumTopic(diagramId, topic.id, vote)
                      await refreshTopics()
                      await refreshSocialScores()
                    }}
                    onOpen={(topic) => setThreadId(topic.id)}
                  />
                </main>
              </>
            )}
        </section>
      )}
      {postOpen && (
        <PostModal
          diagramId={diagramId}
          forumRef={forumRef}
          model={model}
          currentUser={currentUser}
          initialAction={postInitialAction}
          transformDraft={transformDraft}
          edgeDraft={postEdgeDraft}
          hasActiveTransformProposal={hasActiveTransformProposal}
          onClose={() => setPostOpen(false)}
          onCreated={(topic) => {
            setPostOpen(false)
            setPostInitialAction(null)
            setPostEdgeDraft(null)
            selectForum(topic.forumRef)
            setThreadId(topic.id)
            setThread({ topic, comments: [] })
            setTopics((current) => [topic, ...current.filter((item) => item.id !== topic.id)])
            void refreshProposals()
            void refreshSocialScores()
          }}
        />
      )}
      {authOpen && (
        <AuthModal
          onClose={() => {
            postAfterAuthRef.current = false
            setAuthOpen(false)
          }}
          onAuthed={(user) => {
            setCurrentUser(user)
            setAuthOpen(false)
            if (postAfterAuthRef.current) {
              postAfterAuthRef.current = false
              setPostOpen(true)
            }
          }}
        />
      )}
      {profileSettingsOpen && currentUser && (
        <ProfileSettingsModal
          user={currentUser}
          onClose={() => setProfileSettingsOpen(false)}
        />
      )}
      {transformPreview && (
        <TransformPreviewOverlay
          model={model}
          transforms={transformPreview}
          themeMode={themeMode}
          onClose={() => setTransformPreview(null)}
        />
      )}
      {referencePreview && (
        <ReferencePreviewOverlay
          model={model}
          proposal={referencePreview}
          onClose={() => setReferencePreview(null)}
        />
      )}
    </>
  )
}

function ForumSelector({
  model,
  forumRef,
  onSelect,
}: {
  model: Model
  forumRef: ForumRef
  onSelect: (ref: ForumRef) => void
}) {
  const initialDraft = selectorDraftFromRef(model, forumRef)
  const [sourceValue, setSourceValue] = useState(initialDraft.sourceValue)
  const [targetValue, setTargetValue] = useState(initialDraft.targetValue)
  const [mode, setMode] = useState<'none' | 'arrow'>(initialDraft.mode)
  const [edgeId, setEdgeId] = useState(initialDraft.edgeId)
  const nodes = useMemo(() => sortedNodes(model), [model])
  const source = resolveNodeInput(sourceValue, nodes)
  const target = resolveNodeInput(targetValue, nodes)
  const edges = source && target
    ? [...model.edges.values()].filter((edge) => edge.from === source.id && edge.to === target.id)
    : []
  const selectedEdge = mode === 'arrow' ? edges.find((edge) => edge.id === edgeId) ?? edges[0] : null
  const sourceText = sourceValue.trim()
  const targetText = targetValue.trim()

  useEffect(() => {
    if (!sourceText && !targetText && mode === 'none') {
      const nextRef = diagramForumRef()
      if (forumRef !== nextRef) {
        useOmniStore.getState().clearSelection()
        onSelect(nextRef)
      }
      return
    }
    if (!source) return
    if (!targetText) {
      const nextRef = nodeForumRef(source.id)
      useOmniStore.getState().select(source.id)
      if (nextRef !== forumRef) onSelect(nextRef)
      return
    }
    if (mode === 'arrow' && target && selectedEdge) {
      const nextRef = edgeForumRef(selectedEdge.id)
      useOmniStore.getState().selectMany([source.id, target.id], [selectedEdge.id])
      if (nextRef !== forumRef) onSelect(nextRef)
      return
    }
    if (target) {
      useOmniStore.getState().selectMany([source.id, target.id], [])
      const nextRef = diagramForumRef()
      if (nextRef !== forumRef) onSelect(nextRef)
    }
  }, [sourceText, targetText, source, target, mode, selectedEdge, forumRef, onSelect])

  return (
    <div className="social-ref-selector" aria-label="Forum reference selector">
      <NodeSuggestInput
        aria-label="Source"
        nodes={nodes}
        value={sourceValue}
        onChange={(value) => {
          setSourceValue(value)
          if (targetValue.trim()) setMode('arrow')
        }}
        placeholder="source"
      />
      <span
        aria-label="Connection selector"
        className="social-ref-action-select"
        title="Connection selector"
        role="img"
      >
        →
      </span>
      <NodeSuggestInput
        aria-label="Target"
        nodes={nodes}
        value={targetValue}
        onChange={(value) => {
          setTargetValue(value)
          setMode(value.trim() ? 'arrow' : 'none')
          setEdgeId('')
        }}
        placeholder="target"
      />
      {mode === 'arrow' && edges.length > 1 && (
        <select
          className="social-edge-disambiguation"
          aria-label="Connection disambiguation"
          value={selectedEdge?.id ?? ''}
          onChange={(e) => setEdgeId(e.target.value)}
        >
          {edges.map((edge, index) => (
            <option key={edge.id} value={edge.id}>
              {edge.label || `Connection ${index + 1}`}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function MiniDiagramPreview({
  model,
  forumRef,
  proposals,
  themeMode,
}: {
  model: Model
  forumRef: ForumRef
  proposals: GraphProposal[]
  themeMode: ThemeMode
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const [ready, setReady] = useState(false)
  const selectedNodes = useMemo(() => selectedNodesForForum(model, forumRef), [model, forumRef])
  const selectedEdges = useMemo(() => selectedEdgesForForum(model, forumRef), [model, forumRef])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const renderer = new SceneRenderer({ preview: true, forceFullLod: true, hideEditHandles: true, socialDecorations: false })
    rendererRef.current = renderer
    void renderer.init(host).then(() => {
      if (disposed) {
        renderer.destroy()
        return
      }
      setReady(true)
    }).catch((err: unknown) => {
      console.warn('Mini diagram renderer failed:', err)
    })
    return () => {
      disposed = true
      rendererRef.current = null
      setReady(false)
      renderer.destroy()
    }
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !ready) return
    renderer.setThemePalette(rendererThemeFor(themeMode))
    renderer.setModel({
      nodes: model.nodes,
      edges: model.edges,
      grid: model.grid,
      crossLinks: model.crossLinks,
    })
    renderer.setSelection(selectedNodes)
    renderer.setEdgeSelection(selectedEdges)
    renderer.setGraphProposals(proposals)
    renderer.setCamera(miniCameraForBounds(miniFocusBounds(model, forumRef), renderer.getViewport()))
    return () => renderer.setGraphProposals([])
  }, [ready, model, forumRef, proposals, selectedNodes, selectedEdges, themeMode])

  return (
    <div className="social-mini-preview" aria-label="Mini diagram view">
      <div ref={hostRef} className="social-mini-render" role="img" aria-label="Selected diagram reference" />
    </div>
  )
}

function NodeSuggestInput({
  nodes,
  value,
  onChange,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
}: {
  nodes: ModelNode[]
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  'aria-label': string
}) {
  const [open, setOpen] = useState(false)
  const query = value.trim().toLowerCase()
  const suggestions = useMemo(() => {
    const ranked = query
      ? nodes.filter((node) => nodeLabel(node).toLowerCase().includes(query) || node.id.toLowerCase().includes(query))
      : nodes
    return ranked.slice(0, 8)
  }, [nodes, query])

  return (
    <span className="social-node-suggest">
      <input
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 80)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && !disabled && suggestions.length > 0 && (
        <span className="social-node-suggest-menu" role="listbox">
          {suggestions.map((node) => (
            <button
              key={node.id}
              type="button"
              role="option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(nodeLabel(node))
                setOpen(false)
              }}
            >
              <strong>{nodeLabel(node)}</strong>
              <small>{node.id}</small>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function TopicList({
  topics,
  loading,
  currentUser,
  onLoginRequired,
  onVote,
  onOpen,
}: {
  topics: ForumTopic[]
  loading: boolean
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onVote: (topic: ForumTopic, vote: TopicVoteValue | null) => Promise<void>
  onOpen: (topic: ForumTopic) => void
}) {
  if (loading) return <div className="social-forum-empty">Loading forum...</div>
  if (topics.length === 0) return <div className="social-forum-empty">No posts yet.</div>
  return (
    <div className="social-topic-list">
      {topics.map((topic) => (
        <article key={topic.id} className="social-topic">
          <button type="button" className="social-topic-main" onClick={() => onOpen(topic)}>
            <span className="social-topic-head">
              <span>{topic.proposal ? proposalActionLabel(topic.proposal) : 'Discussion'}</span>
              {topic.proposal && isConcludedProposal(topic.proposal) && (
                <i className="social-concluded-badge">Concluded</i>
              )}
              <b>{topic.proposal ? `${Math.round(topic.agreementRatio * 100)}% agreement` : `${topic.commentCount} comments`}</b>
            </span>
            <span className="social-topic-content">
              <strong>{topic.title}</strong>
              <small>{topic.description}</small>
              <em>{topic.views} views · {topic.commentCount} comments · {topic.score} score</em>
            </span>
          </button>
          <TopicVoteControls
            topic={topic}
            currentUser={currentUser}
            onLoginRequired={onLoginRequired}
            onVote={onVote}
            variant="thread"
          />
        </article>
      ))}
    </div>
  )
}

function TopicVoteControls({
  topic,
  currentUser,
  onLoginRequired,
  onVote,
  variant = 'list',
}: {
  topic: ForumTopic
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onVote: (topic: ForumTopic, vote: TopicVoteValue | null) => Promise<void>
  variant?: 'list' | 'thread'
}) {
  const [busy, setBusy] = useState(false)
  const ownPost = currentUser?.username.toLowerCase() === topic.author.toLowerCase()
  const cast = async (vote: TopicVoteValue) => {
    if (!currentUser) {
      onLoginRequired()
      return
    }
    if (ownPost) return
    setBusy(true)
    try {
      await onVote(topic, topic.viewerVote === vote ? null : vote)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className={`social-topic-votes ${variant === 'thread' ? 'social-thread-votes' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={topic.viewerVote === 'like' ? 'active' : ''}
        disabled={busy || ownPost}
        aria-label="Like post"
        onClick={() => void cast('like')}
      >
        ▲
      </button>
      <span>{topic.score}</span>
      <button
        type="button"
        className={topic.viewerVote === 'dislike' ? 'active' : ''}
        disabled={busy || ownPost}
        aria-label="Dislike post"
        onClick={() => void cast('dislike')}
      >
        ▼
      </button>
    </span>
  )
}

function ThreadView({
  diagramId,
  thread,
  currentUser,
  onLoginRequired,
  onBack,
  onChanged,
  onVote,
  onPreview,
  onReferencePreview,
}: {
  diagramId: string
  thread: ForumThread
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onBack: () => void
  onChanged: () => Promise<void>
  onVote: (topic: ForumTopic, vote: TopicVoteValue | null) => Promise<void>
  onPreview: (transforms: TransformProposalEntry[]) => void
  onReferencePreview: (proposal: GraphProposal) => void
}) {
  const [replyTo, setReplyTo] = useState<ForumComment | null>(null)
  const commentsByParent = useMemo(() => {
    const commentIds = new Set(thread.comments.map((comment) => comment.id))
    const grouped = new Map<string, ForumComment[]>()
    for (const comment of thread.comments) {
      const parentKey = comment.parentId && commentIds.has(comment.parentId) ? comment.parentId : 'root'
      const list = grouped.get(parentKey) ?? []
      list.push(comment)
      grouped.set(parentKey, list)
    }
    return grouped
  }, [thread.comments])

  const renderComment = (comment: ForumComment) => {
    const replies = commentsByParent.get(comment.id) ?? []
    return (
      <div key={comment.id} className="social-comment-branch">
        <article className="social-comment">
          <div>
            <strong>{comment.author}</strong>
            <span>{comment.stance}</span>
          </div>
          <p>{comment.body}</p>
          <button type="button" onClick={() => setReplyTo(comment)}>Reply</button>
          {replyTo?.id === comment.id && (
            <div className="social-comment-inline-reply">
              <CommentForm
                diagramId={diagramId}
                topicId={thread.topic.id}
                replyTo={comment}
                currentUser={currentUser}
                onLoginRequired={onLoginRequired}
                onCancelReply={() => setReplyTo(null)}
                onCreated={async () => {
                  setReplyTo(null)
                  await onChanged()
                }}
              />
            </div>
          )}
        </article>
        {replies.length > 0 && (
          <div className="social-comment-children">
            {replies.map(renderComment)}
          </div>
        )}
      </div>
    )
  }
  const transformProposalPayload = thread.topic.proposal?.payload.action === 'commit-transform'
    ? thread.topic.proposal.payload
    : null
  const referenceProposal = thread.topic.proposal && (
    thread.topic.proposal.payload.action === 'add-reference' ||
    thread.topic.proposal.payload.action === 'modify-references'
  )
    ? thread.topic.proposal
    : null

  return (
    <article className="social-thread">
      <button type="button" className="social-thread-back" onClick={onBack}>
        Back to forum
      </button>
      <header>
        <div className="social-thread-head-row">
          <TopicVoteControls
            topic={thread.topic}
            currentUser={currentUser}
            onLoginRequired={onLoginRequired}
            onVote={onVote}
          />
          {transformProposalPayload && (
            <button
              type="button"
              className="social-preview-button"
              onClick={() => onPreview(transformProposalPayload.transforms)}
            >
              Preview
            </button>
          )}
          {referenceProposal && (
            <button
              type="button"
              className="social-preview-button"
              onClick={() => onReferencePreview(referenceProposal)}
            >
              Preview
            </button>
          )}
        </div>
        {thread.topic.proposal && (
          <div className="social-thread-topic-head">
            <span>{proposalActionLabel(thread.topic.proposal)}</span>
            {isConcludedProposal(thread.topic.proposal) && (
              <i className="social-concluded-badge">Concluded</i>
            )}
            <b>{Math.round(thread.topic.agreementRatio * 100)}% agreement</b>
          </div>
        )}
        <h3>{thread.topic.title}</h3>
        <p>{thread.topic.description}</p>
      </header>
      <CommentForm
        diagramId={diagramId}
        topicId={thread.topic.id}
        replyTo={null}
        currentUser={currentUser}
        onLoginRequired={onLoginRequired}
        onCancelReply={() => undefined}
        onCreated={async () => {
          await onChanged()
        }}
      />
      <div className="social-comments">
        {(commentsByParent.get('root') ?? []).map(renderComment)}
      </div>
    </article>
  )
}

function CommentForm({
  diagramId,
  topicId,
  replyTo,
  currentUser,
  onLoginRequired,
  onCancelReply,
  onCreated,
}: {
  diagramId: string
  topicId: string
  replyTo: ForumComment | null
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onCancelReply: () => void
  onCreated: () => Promise<void>
}) {
  const [body, setBody] = useState('')
  const [stance, setStance] = useState<VoteStance>('neutral')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!currentUser) {
      onLoginRequired()
      return
    }
    try {
      await addForumComment(diagramId, topicId, {
        body,
        stance,
        ...(replyTo ? { parentId: replyTo.id } : {}),
      })
      setBody('')
      setStance('neutral')
      await onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comment failed')
    }
  }

  return (
    <form className="social-comment-form" onSubmit={(e) => void submit(e)}>
      {replyTo && (
        <div className="social-replying">
          Replying to {replyTo.author}
          <button type="button" onClick={onCancelReply}>Cancel</button>
        </div>
      )}
      <textarea
        aria-label="Comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Join the discussion"
      />
      <div>
        <select aria-label="Vote stance" value={stance} onChange={(e) => setStance(e.target.value as VoteStance)}>
          <option value="neutral">Neutral</option>
          <option value="agree">Agree</option>
          <option value="disagree">Disagree</option>
        </select>
        <button type="submit">{currentUser ? 'Comment' : 'Log in to comment'}</button>
      </div>
      {error && <span className="social-forum-error">{error}</span>}
    </form>
  )
}

function PostModal({
  diagramId,
  forumRef,
  model,
  currentUser,
  initialAction,
  transformDraft,
  edgeDraft,
  hasActiveTransformProposal,
  onClose,
  onCreated,
}: {
  diagramId: string
  forumRef: ForumRef
  model: Model
  currentUser: AuthUser | null
  initialAction?: GraphProposalAction | null
  transformDraft?: TransformProposalEntry[]
  edgeDraft?: SocialEdgeDraft | null
  hasActiveTransformProposal?: boolean
  onClose: () => void
  onCreated: (topic: ForumTopic) => void
}) {
  const nodes = useMemo(() => sortedNodes(model), [model])
  const isGraphEmpty = nodes.length === 0
  const initialProposal = proposalDraftFromForumRef(model, forumRefFromGraphSelection(model) ?? forumRef)
  const edgeDraftSource = edgeDraft ? model.nodes.get(edgeDraft.from) : null
  const edgeDraftTarget = edgeDraft ? model.nodes.get(edgeDraft.to) : null
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [proposalEnabled, setProposalEnabled] = useState(initialAction === 'commit-transform' || Boolean(edgeDraft))
  const [action, setAction] = useState<GraphProposalAction>(initialAction ?? (isGraphEmpty ? 'add-node' : initialProposal.action))
  const [sourceValue, setSourceValue] = useState(edgeDraftSource ? nodeLabel(edgeDraftSource) : initialProposal.sourceValue)
  const [targetValue, setTargetValue] = useState(edgeDraftTarget ? nodeLabel(edgeDraftTarget) : initialProposal.targetValue)
  const [newTargetValue, setNewTargetValue] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [referenceTitle, setReferenceTitle] = useState('')
  const [referenceCitation, setReferenceCitation] = useState('')
  const [referenceUrl, setReferenceUrl] = useState('')
  const [referencesText, setReferencesText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const activeAction: GraphProposalAction = action
  const draftTransforms = transformDraft ?? []
  const sourceOnlyAction = activeAction === 'add-rmm' || activeAction === 'add-mpd'

  useEffect(() => {
    if (activeAction !== 'modify-references') return
    setReferencesText(referenceLinesForSelection(model, nodes, sourceValue, targetValue))
  }, [activeAction, model, nodes, sourceValue, targetValue])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!currentUser) {
      setError('Log in before posting')
      return
    }
    try {
      if (activeAction === 'commit-transform' && hasActiveTransformProposal) {
        throw new Error('A layout change proposal is already active for this graph.')
      }
      const proposal = proposalEnabled
        ? buildProposalPayload({
          action: activeAction,
          model,
          nodes,
          sourceValue,
          targetValue,
          newTargetValue,
          newLabel,
          transformDraft: draftTransforms,
          referenceTitle,
          referenceCitation,
          referenceUrl,
          referencesText,
        })
        : undefined
      const topic = await createForumTopic(diagramId, {
        forumRef,
        title,
        description,
        ...(proposal ? { proposal } : {}),
      })
      onCreated(topic)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed')
    }
  }

  return (
    <div className="social-modal-backdrop" role="presentation">
      <form className="social-post-modal" onSubmit={(e) => void submit(e)} aria-label="Create forum post">
        <header>
          <h3>New post</h3>
          <button type="button" onClick={onClose} aria-label="Close post dialog">Close</button>
        </header>
        <p className="social-post-author">Posting as {currentUser?.username ?? 'not logged in'}</p>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="social-check-row">
          <input
            type="checkbox"
            checked={proposalEnabled}
            onChange={(e) => setProposalEnabled(e.target.checked)}
          />
          Suggest diagram change
        </label>
        {proposalEnabled && (
          <div className="social-proposal-fields">
            <select
              aria-label="Suggested action"
              value={activeAction}
              onChange={(e) => {
                const next = e.target.value as GraphProposalAction
                setAction(next)
                if (next === 'modify-references') {
                  setReferencesText(referenceLinesForSelection(model, nodes, sourceValue, targetValue))
                }
              }}
            >
              {isGraphEmpty ? (
                <option value="add-node">Add Node</option>
              ) : (
                <>
                  <option value="add-node">Add Node</option>
                  <option value="add-node-edge">Add node and connection</option>
                  <option value="add-edge">Add connection</option>
                  <option value="add-rmm">Add RMM</option>
                  <option value="add-mpd">Add MPD</option>
                  <option value="remove-edge">Remove connection</option>
                  <option value="remove-node">Remove node</option>
                  <option value="rename-node">Rename node</option>
                  <option value="rename-edge">Rename connection</option>
                  <option value="add-reference">Add reference</option>
                  <option value="modify-references">Modify references</option>
                  <option value="rewire-edge">Rewire connection</option>
                  {!hasActiveTransformProposal && (draftTransforms.length > 0 || activeAction === 'commit-transform') && (
                    <option value="commit-transform">Commit transform</option>
                  )}
                </>
              )}
            </select>
            {activeAction === 'commit-transform' && (
              <p className="social-transform-summary">
                {draftTransforms.length} layout {draftTransforms.length === 1 ? 'change is' : 'changes are'} ready for preview and voting.
              </p>
            )}
            {activeAction !== 'add-node' && activeAction !== 'commit-transform' && (
              <div className="social-ref-selector compact">
                <NodeSuggestInput
                  nodes={nodes}
                  value={sourceValue}
                  onChange={setSourceValue}
                  placeholder="source"
                  aria-label="Proposal source node"
                />
                <span className="social-action-icon" aria-label={proposalActionLabel({ action: activeAction })} title={proposalActionLabel({ action: activeAction })}>
                  {proposalActionIcon(activeAction)}
                </span>
                {sourceOnlyAction ? (
                  <input
                    value=""
                    readOnly
                    placeholder="dimension"
                    aria-label="Dimension target"
                    className="social-ref-disabled"
                  />
                ) : activeAction === 'add-node-edge' ? (
                  <input
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    placeholder="new target"
                    aria-label="Proposal target node"
                  />
                ) : (
                  <NodeSuggestInput
                    nodes={nodes}
                    value={targetValue}
                    onChange={setTargetValue}
                    placeholder="target"
                    aria-label="Proposal target node"
                    disabled={activeAction === 'remove-node' || activeAction === 'rename-node'}
                  />
                )}
              </div>
            )}
            {(activeAction === 'add-node' || activeAction === 'rename-node' || activeAction === 'rename-edge' || sourceOnlyAction) && (
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={sourceOnlyAction ? 'dimension name' : 'new name'}
                aria-label={sourceOnlyAction ? 'Dimension name' : 'New name'}
              />
            )}
            {activeAction === 'add-edge' && (
              <div className="social-reference-fields">
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="connection label (optional)"
                  aria-label="Connection label"
                />
                <textarea
                  value={referencesText}
                  onChange={(e) => setReferencesText(e.target.value)}
                  placeholder="Optional references: Title | Citation | URL"
                  aria-label="Connection references"
                />
              </div>
            )}
            {activeAction === 'add-reference' && (
              <div className="social-reference-fields">
                <input value={referenceTitle} onChange={(e) => setReferenceTitle(e.target.value)} placeholder="reference title" aria-label="Reference title" />
                <input value={referenceCitation} onChange={(e) => setReferenceCitation(e.target.value)} placeholder="citation" aria-label="Reference citation" />
                <input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="url" aria-label="Reference URL" />
              </div>
            )}
            {activeAction === 'modify-references' && (
              <textarea
                value={referencesText}
                onChange={(e) => setReferencesText(e.target.value)}
                placeholder="Title | Citation | URL"
                aria-label="Reference list"
              />
            )}
            {activeAction === 'rewire-edge' && (
              <NodeSuggestInput
                nodes={nodes}
                value={newTargetValue}
                onChange={setNewTargetValue}
                placeholder="new target"
                aria-label="New target node"
              />
            )}
          </div>
        )}
        {error && <div className="social-forum-error">{error}</div>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Post</button>
        </footer>
      </form>
    </div>
  )
}

function AuthModal({
  onClose,
  onAuthed,
}: {
  onClose: () => void
  onAuthed: (user: AuthUser) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const validation = validateAuthInput(mode, username, password)
    if (validation) {
      setError(validation)
      return
    }
    setBusy(true)
    try {
      const cleanUsername = username.trim()
      const result = mode === 'login'
        ? await loginAccount(cleanUsername, password)
        : await registerAccount(cleanUsername, password)
      onAuthed(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="social-modal-backdrop" role="presentation">
      <form className="social-auth-modal" onSubmit={(e) => void submit(e)} aria-label="Account login">
        <header>
          <h3>{mode === 'login' ? 'Log in' : 'Create account'}</h3>
          <button type="button" onClick={onClose} aria-label="Close account dialog">Close</button>
        </header>
        <div className="social-auth-tabs" role="tablist" aria-label="Account mode">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login')
              setError(null)
            }}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register')
              setError(null)
            }}
          >
            Register
          </button>
        </div>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'register' && (
          <p className="social-auth-hint">Usernames use 3-24 letters, numbers, underscores, or dashes. Passwords need at least 6 characters.</p>
        )}
        {error && <div className="social-forum-error">{error}</div>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>
            {busy ? 'Working...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function ProfileSettingsModal({
  user,
  onClose,
}: {
  user: AuthUser
  onClose: () => void
}) {
  return (
    <div className="social-modal-backdrop" role="presentation">
      <section className="social-profile-modal" role="dialog" aria-label="Profile settings">
        <header>
          <h3>Profile settings</h3>
          <button type="button" onClick={onClose} aria-label="Close profile settings">Close</button>
        </header>
        <div className="social-profile-summary">
          <strong>{user.username}</strong>
          <span>{user.reputation} reputation</span>
        </div>
        <p>Profile appearance and account controls will live here. Theme and background preferences are already saved to this account through Settings.</p>
      </section>
    </div>
  )
}

function TransformPreviewOverlay({
  model,
  transforms,
  themeMode,
  onClose,
}: {
  model: Model
  transforms: TransformProposalEntry[]
  themeMode: ThemeMode
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const renderer = new SceneRenderer({ preview: true, forceFullLod: true, socialDecorations: false })
    const previewModel = modelWithTransforms(model, transforms)
    void renderer.init(host).then(() => {
      if (disposed) {
        renderer.destroy()
        return
      }
      renderer.setThemePalette(rendererThemeFor(themeMode))
      renderer.setModel({
        nodes: previewModel.nodes,
        edges: previewModel.edges,
        grid: previewModel.grid,
        crossLinks: previewModel.crossLinks,
      })
      renderer.setTransformPreview(transforms)
      renderer.setCamera(miniCameraForBounds(sceneBounds([...previewModel.nodes.values()]), renderer.getViewport()))
    }).catch((err: unknown) => {
      console.warn('Transform preview failed:', err)
    })
    return () => {
      disposed = true
      renderer.destroy()
    }
  }, [model, transforms, themeMode])

  return (
    <div className="social-transform-preview" role="dialog" aria-label="Transform proposal preview">
      <header>
        <button type="button" className="social-thread-back" onClick={onClose}>Back</button>
        <div>
          <h3>Layout preview</h3>
          <p>{transforms.length} changed {transforms.length === 1 ? 'node' : 'nodes'}</p>
        </div>
      </header>
      <div ref={hostRef} className="social-transform-preview-render" />
    </div>
  )
}

function modelWithTransforms(model: Model, transforms: TransformProposalEntry[]): Model {
  const nodes = new Map(model.nodes)
  for (const transform of transforms) {
    const node = nodes.get(transform.nodeId)
    if (node) nodes.set(node.id, { ...node, ...transform.to })
  }
  return { ...model, nodes }
}

function ReferencePreviewOverlay({
  model,
  proposal,
  onClose,
}: {
  model: Model
  proposal: GraphProposal
  onClose: () => void
}) {
  const payload = proposal.payload
  if (payload.action !== 'add-reference' && payload.action !== 'modify-references') return null
  const edge = model.edges.get(payload.edgeId)
  const current = edge?.references ?? []
  const proposed = payload.action === 'add-reference'
    ? [...current, payload.reference]
    : payload.references
  return (
    <div className="social-modal-backdrop" role="presentation">
      <section className="social-reference-preview-modal" role="dialog" aria-label="Reference proposal preview">
        <header>
          <h3>Reference preview</h3>
          <button type="button" onClick={onClose} aria-label="Close reference preview">Close</button>
        </header>
        <div className="social-reference-preview-grid">
          <ReferenceListPreview title="Current" references={current} />
          <ReferenceListPreview title="Proposed" references={proposed} />
        </div>
      </section>
    </div>
  )
}

function ReferenceListPreview({
  title,
  references,
}: {
  title: string
  references: ConnectionReference[]
}) {
  return (
    <div className="social-reference-preview-list">
      <h4>{title}</h4>
      {references.length === 0 ? (
        <p>No references</p>
      ) : references.map((ref, index) => (
        <article key={`${ref.title}-${index}`}>
          <strong>{ref.title}</strong>
          {ref.citation && <span>{ref.citation}</span>}
          {ref.url && <small>{ref.url}</small>}
        </article>
      ))}
    </div>
  )
}

function validateAuthInput(mode: 'login' | 'register', username: string, password: string): string | null {
  const cleanUsername = username.trim()
  if (!cleanUsername) return 'Enter a username.'
  if (!password) return 'Enter a password.'
  if (mode !== 'register') return null
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(cleanUsername)) {
    return 'Use 3-24 letters, numbers, underscores, or dashes for the username.'
  }
  if (password.length < 6) return 'Use a password with at least 6 characters.'
  return null
}

function buildProposalPayload(input: {
  action: GraphProposalAction
  model: Model
  nodes: ModelNode[]
  sourceValue: string
  targetValue: string
  newTargetValue: string
  newLabel: string
  transformDraft: TransformProposalEntry[]
  referenceTitle: string
  referenceCitation: string
  referenceUrl: string
  referencesText: string
}): GraphProposalPayload {
  const source = resolveNodeInput(input.sourceValue, input.nodes)
  const target = resolveNodeInput(input.targetValue, input.nodes)
  const nextTarget = resolveNodeInput(input.newTargetValue, input.nodes)
  const edge = source && target ? findEdgeBetween(input.model, source.id, target.id) : null
  const cleanLabel = input.newLabel.trim()
  switch (input.action) {
    case 'add-node':
      if (!cleanLabel) throw new Error('Name the new node')
      if (nodeLabelExists(input.model, cleanLabel)) throw new Error('A node with that name already exists')
      return { action: input.action, newNodeLabel: cleanLabel }
    case 'add-node-edge':
      if (!source) throw new Error('Choose an existing source node')
      if (!input.targetValue.trim()) throw new Error('Name the new target node')
      if (nodeLabelExists(input.model, input.targetValue.trim())) throw new Error('A node with that name already exists')
      return { action: input.action, sourceNodeId: source.id, newNodeLabel: input.targetValue.trim() }
    case 'add-edge':
      if (!source || !target) throw new Error('Choose source and target nodes')
      return {
        action: input.action,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        ...(cleanLabel ? { label: cleanLabel } : {}),
        ...(input.referencesText.trim() ? { references: parseReferenceLines(input.referencesText) } : {}),
      }
    case 'add-rmm':
      if (!source) throw new Error('Choose a node for the RMM dimension')
      if (!cleanLabel) throw new Error('Name the RMM dimension')
      return { action: input.action, nodeId: source.id, name: cleanLabel }
    case 'add-mpd':
      if (!source) throw new Error('Choose a node for the MPD dimension')
      if (!cleanLabel) throw new Error('Name the MPD dimension')
      return { action: input.action, nodeId: source.id, name: cleanLabel }
    case 'remove-edge':
      if (!edge) throw new Error('Choose an existing connection')
      return { action: input.action, edgeId: edge.id }
    case 'remove-node':
      if (!source) throw new Error('Choose the node to remove')
      return { action: input.action, nodeId: source.id }
    case 'rename-node':
      if (!source) throw new Error('Choose the node to rename')
      if (!cleanLabel) throw new Error('Enter the new node name')
      if (nodeLabelExists(input.model, cleanLabel, source.id)) throw new Error('A node with that name already exists')
      return { action: input.action, nodeId: source.id, nextLabel: cleanLabel }
    case 'rename-edge':
      if (!edge) throw new Error('Choose an existing connection')
      if (!cleanLabel) throw new Error('Enter the new connection name')
      return { action: input.action, edgeId: edge.id, nextLabel: cleanLabel }
    case 'rewire-edge':
      if (!edge) throw new Error('Choose an existing connection')
      if (!nextTarget) throw new Error('Choose the new target node')
      return { action: input.action, edgeId: edge.id, nextTargetNodeId: nextTarget.id }
    case 'commit-transform':
      if (input.transformDraft.length === 0) throw new Error('No layout changes are ready to submit')
      return { action: input.action, transforms: input.transformDraft }
    case 'add-reference':
      if (!edge) throw new Error('Choose an existing connection')
      if (!input.referenceTitle.trim()) throw new Error('Enter a reference title')
      return {
        action: input.action,
        edgeId: edge.id,
        reference: {
          title: input.referenceTitle.trim(),
          citation: input.referenceCitation.trim(),
          url: input.referenceUrl.trim(),
        },
      }
    case 'modify-references':
      if (!edge) throw new Error('Choose an existing connection')
      return { action: input.action, edgeId: edge.id, references: parseReferenceLines(input.referencesText) }
  }
}

function selectedNodesForForum(model: Model, ref: ForumRef): Set<string> {
  if (ref.startsWith('node:')) return new Set([ref.slice('node:'.length)])
  if (ref.startsWith('edge:')) {
    const edge = model.edges.get(ref.slice('edge:'.length))
    return edge ? new Set([edge.from, edge.to]) : new Set()
  }
  return new Set(useOmniStore.getState().selectedIds)
}

function selectedEdgesForForum(model: Model, ref: ForumRef): Set<string> {
  if (ref.startsWith('edge:')) return new Set([ref.slice('edge:'.length)])
  void model
  return new Set(useOmniStore.getState().selectedEdgeIds)
}

function forumRefFromGraphSelection(model: Model): ForumRef | null {
  const store = useOmniStore.getState()
  if (store.selectedEdgeIds.size === 1) {
    const edgeId = store.selectedEdgeIds.values().next().value as string | undefined
    if (edgeId && model.edges.has(edgeId)) return edgeForumRef(edgeId)
  }
  if (store.selectedIds.size === 1) {
    const nodeId = store.selectedIds.values().next().value as string | undefined
    if (nodeId && model.nodes.has(nodeId)) return nodeForumRef(nodeId)
  }
  return null
}

function forumTitlePart(ref: ForumRef, model: Model, projectTopic?: string): string {
  if (ref === 'diagram') return projectTopic?.trim() || 'Diagram forum'
  return forumRefLabel(ref, model)
}

function selectorDraftFromRef(model: Model, ref: ForumRef): {
  sourceValue: string
  targetValue: string
  mode: 'none' | 'arrow'
  edgeId: string
} {
  if (ref.startsWith('node:')) {
    const node = model.nodes.get(ref.slice('node:'.length))
    return { sourceValue: node ? nodeLabel(node) : '', targetValue: '', mode: 'none', edgeId: '' }
  }
  if (ref.startsWith('edge:')) {
    const edge = model.edges.get(ref.slice('edge:'.length))
    const source = edge ? model.nodes.get(edge.from) : null
    const target = edge ? model.nodes.get(edge.to) : null
    return {
      sourceValue: source ? nodeLabel(source) : '',
      targetValue: target ? nodeLabel(target) : '',
      mode: 'arrow',
      edgeId: edge?.id ?? '',
    }
  }
  const selected = [...useOmniStore.getState().selectedIds]
    .map((id) => model.nodes.get(id))
    .filter((node): node is ModelNode => Boolean(node))
  if (selected.length >= 2) {
    return {
      sourceValue: nodeLabel(selected[0]),
      targetValue: nodeLabel(selected[1]),
      mode: 'none',
      edgeId: '',
    }
  }
  if (selected.length === 1) {
    return { sourceValue: nodeLabel(selected[0]), targetValue: '', mode: 'none', edgeId: '' }
  }
  return { sourceValue: '', targetValue: '', mode: 'none', edgeId: '' }
}

function proposalDraftFromForumRef(model: Model, ref: ForumRef): {
  action: GraphProposalAction
  sourceValue: string
  targetValue: string
} {
  if (model.nodes.size === 0) return { action: 'add-node', sourceValue: '', targetValue: '' }
  if (ref.startsWith('edge:')) {
    const edge = model.edges.get(ref.slice('edge:'.length))
    const source = edge ? model.nodes.get(edge.from) : null
    const target = edge ? model.nodes.get(edge.to) : null
    return {
      action: 'rename-edge',
      sourceValue: source ? nodeLabel(source) : '',
      targetValue: target ? nodeLabel(target) : '',
    }
  }
  if (ref.startsWith('node:')) {
    const node = model.nodes.get(ref.slice('node:'.length))
    return { action: 'add-node-edge', sourceValue: node ? nodeLabel(node) : '', targetValue: '' }
  }
  const selected = forumRefFromGraphSelection(model)
  return selected ? proposalDraftFromForumRef(model, selected) : { action: 'add-node-edge', sourceValue: '', targetValue: '' }
}

function sortedNodes(model: Model): ModelNode[] {
  return [...model.nodes.values()].sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)))
}

function nodeLabel(node: ModelNode): string {
  return node.label.trim() || node.id
}

function resolveNodeInput(value: string, nodes: ModelNode[]): ModelNode | null {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  return nodes.find((node) => nodeLabel(node).toLowerCase() === trimmed || node.id.toLowerCase() === trimmed) ?? null
}

function nodeLabelExists(model: Model, label: string, exceptId?: string): boolean {
  const needle = label.trim().toLowerCase()
  if (!needle) return false
  for (const node of model.nodes.values()) {
    if (node.id === exceptId) continue
    if (node.label.trim().toLowerCase() === needle) return true
  }
  return false
}

function formatReferenceLine(ref: ConnectionReference): string {
  return [ref.title, ref.citation, ref.url].map((part) => part.replace(/\|/g, '/')).join(' | ')
}

function parseReferenceLines(value: string): ConnectionReference[] {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title = '', citation = '', url = ''] = line.split('|').map((part) => part.trim())
      return { title, citation, url }
    })
    .filter((ref) => ref.title.length > 0)
}

function referenceLinesForSelection(
  model: Model,
  nodes: ModelNode[],
  sourceValue: string,
  targetValue: string,
): string {
  const source = resolveNodeInput(sourceValue, nodes)
  const target = resolveNodeInput(targetValue, nodes)
  const edge = source && target ? findEdgeBetween(model, source.id, target.id) : null
  return (edge?.references ?? []).map(formatReferenceLine).join('\n')
}

interface SceneBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function sceneBounds(nodes: ModelNode[]): SceneBounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.w / 2)
    minY = Math.min(minY, node.y - node.h / 2)
    maxX = Math.max(maxX, node.x + node.w / 2)
    maxY = Math.max(maxY, node.y + node.h / 2)
  }
  if (maxX - minX < 12) {
    minX -= 6
    maxX += 6
  }
  if (maxY - minY < 10) {
    minY -= 5
    maxY += 5
  }
  return {
    minX: clamp(minX - 4, -50, 150),
    minY: clamp(minY - 4, -50, 150),
    maxX: clamp(maxX + 4, -50, 150),
    maxY: clamp(maxY + 4, -50, 150),
  }
}

function miniFocusBounds(model: Model, ref: ForumRef): SceneBounds {
  if (ref.startsWith('node:')) {
    const node = model.nodes.get(ref.slice('node:'.length))
    if (node) return sceneBounds([node])
  }
  if (ref.startsWith('edge:')) {
    const edge = model.edges.get(ref.slice('edge:'.length))
    const from = edge ? model.nodes.get(edge.from) : null
    const to = edge ? model.nodes.get(edge.to) : null
    if (from && to) return sceneBounds([from, to])
  }
  return sceneBounds([...model.nodes.values()])
}

function miniCameraForBounds(bounds: SceneBounds, viewport: ViewportSize) {
  const width = viewport.width > 0 ? viewport.width : 360
  const height = viewport.height > 0 ? viewport.height : 128
  const boundsW = Math.max(1, ((bounds.maxX - bounds.minX) / 100) * SCENE_W)
  const boundsH = Math.max(1, ((bounds.maxY - bounds.minY) / 100) * SCENE_H)
  const scale = clamp(Math.min((width * 0.82) / boundsW, (height * 0.76) / boundsH), 0.04, 1.7)
  const centerX = ((bounds.minX + bounds.maxX) / 2 / 100) * SCENE_W
  const centerY = ((bounds.minY + bounds.maxY) / 2 / 100) * SCENE_H
  return { panX: -centerX, panY: -centerY, freeScale: scale }
}

function proposalActionIcon(action: GraphProposalAction): string {
  switch (action) {
    case 'add-node': return '+'
    case 'add-node-edge': return '→'
    case 'add-edge': return '→'
    case 'add-rmm': return 'RMM'
    case 'add-mpd': return 'MPD'
    case 'remove-edge': return '✕'
    case 'remove-node': return '−'
    case 'rename-node': return 'Aa'
    case 'rename-edge': return 'Aa'
    case 'add-reference': return 'R+'
    case 'modify-references': return 'R'
    case 'rewire-edge': return '↪'
    case 'commit-transform': return '⇧'
  }
}

function isConcludedProposal(proposal: GraphProposal): boolean {
  return proposal.status === 'applied' || proposal.status === 'blocked' || proposal.status === 'stale'
}

function isActiveTransformProposal(proposal: GraphProposal): boolean {
  return proposal.payload.action === 'commit-transform' && (proposal.status === 'pending' || proposal.status === 'accepted')
}

function mergeSocialScores(base: EntitySocialScores, debug: EntitySocialScores): EntitySocialScores {
  return {
    nodeScores: mergeScoreMap(base.nodeScores, debug.nodeScores),
    edgeScores: mergeScoreMap(base.edgeScores, debug.edgeScores),
    nodeVotes: mergeVoteMap(base.nodeVotes, debug.nodeVotes),
    edgeVotes: mergeVoteMap(base.edgeVotes, debug.edgeVotes),
  }
}

function rendererThemeFor(mode: ThemeMode): Parameters<SceneRenderer['setThemePalette']>[0] {
  const palette = resolvePalette(mode)
  const labelHex = palette.nodeLabel.startsWith('#') ? palette.nodeLabel : '#132949'
  const label = parseInt(labelHex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return { cell: palette.nodeCell, membrane: palette.nodeMembrane, label }
}

function mergeScoreMap(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const next = { ...a }
  for (const [id, score] of Object.entries(b)) next[id] = (next[id] ?? 0) + score
  return next
}

function mergeVoteMap(
  a: EntitySocialScores['nodeVotes'],
  b: EntitySocialScores['nodeVotes'],
): NonNullable<EntitySocialScores['nodeVotes']> {
  const next: NonNullable<EntitySocialScores['nodeVotes']> = { ...(a ?? {}) }
  for (const [id, votes] of Object.entries(b ?? {})) {
    const current = next[id] ?? { positive: 0, negative: 0 }
    next[id] = {
      positive: current.positive + votes.positive,
      negative: current.negative + votes.negative,
    }
  }
  return next
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
