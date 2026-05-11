import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { SceneRenderer } from '../scene/SceneRenderer'
import { clientToScene, SCENE_H, SCENE_W, type CameraTransform, type ViewportSize } from '../scene/sceneConstants'
import { useOmniStore } from '../model/store'
import { DEFAULT_EDGE, DEFAULT_NODE, type Connection, type ConnectionReference, type Model, type ModelNode, type Project } from '../model/types'
import { resolvePalette, type ThemeMode } from '../theme/themes'
import {
  addForumComment,
  createForumTopic,
  getCurrentAccount,
  getForumThread,
  listActiveProposals,
  listForumTopics,
  listSocialScores,
  listDevVerificationMessages,
  loginAccount,
  logoutAccount,
  logoutAllAccounts,
  markProposalStatus,
  registerAccount,
  resendVerificationEmail,
  saveCloudDiagram,
  verifyEmail,
  voteForumTopic,
  updateForumTopic,
  deleteForumTopic,
  changePassword,
  blobToBase64,
  type AuthUser,
  type DevVerificationMessage,
} from '../social/cloudClient'
import {
  diagramForumRef,
  edgeForumRef,
  findEdgeBetween,
  forumRefLabel,
  nodeForumRef,
  proposalActionLabel,
  proposalContainsAction,
  proposalSteps,
  type ForumComment,
  type EntityPatch,
  type ForumRef,
  type ForumThread,
  type ForumTopic,
  type EntitySocialScores,
  type GraphProposal,
  type GraphProposalAction,
  type GraphProposalPayload,
  type GraphProposalStep,
  type TransformProposalEntry,
  type TopicVoteValue,
  type VoteStance,
} from '../social/forumTypes'
import {
  applyAcceptedProposal,
  previewModelForProposal,
  previewProjectForProposal,
} from '../social/proposalApply'
import {
  capturePublicGraphBaseline,
  getPublicGraphDraftCount,
  getPublicGraphDraftSteps,
  restorePublicGraphBaseline,
} from '../social/publicGraphDraft'
import { EffectGraphDiffPreview } from '../social/EffectGraphDiffPreview'
import { changeGroupsForSteps, type ChangeDetail, type ChangeGroup, type FlowPreviewData } from '../social/proposalDisplay'
import { clearActiveProposalLocks, setActiveProposalLocks } from '../social/activeProposalLocks'
import { exportBundle } from '../model/projectBundle'
import { RichNodeOverlay } from '../ui/RichNodeOverlay'

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
  const [postInitialSteps, setPostInitialSteps] = useState<GraphProposalStep[]>([])
  const [postFromGraphDraft, setPostFromGraphDraft] = useState(false)
  const [proposalPreview, setProposalPreview] = useState<GraphProposal | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false)
  const [proposals, setProposals] = useState<GraphProposal[]>([])
  const [serverSocialScores, setServerSocialScores] = useState<EntitySocialScores>({ nodeScores: {}, edgeScores: {} })
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
  const draftSnapshot = currentProjectSnapshot()
  const publicDraftSteps = getPublicGraphDraftSteps(draftSnapshot)
  const transformDraft = publicDraftSteps.flatMap((step) => step.action === 'commit-transform' ? step.transforms : [])
  const hasActiveTransformProposal = proposals.some(isActiveTransformProposal)

  useEffect(() => {
    void getCurrentAccount().then(setCurrentUser).catch(() => setCurrentUser(null))
  }, [])
  void revision

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
    setActiveProposalLocks(proposals, model)
    return () => {
      renderer.setGraphProposals([])
      clearActiveProposalLocks()
    }
  }, [renderer, proposals, model])

  useEffect(() => {
    void refreshSocialScores()
  }, [refreshSocialScores, proposals])

  useEffect(() => {
    if (!renderer) return
    renderer.setSocialScores(serverSocialScores)
  }, [renderer, serverSocialScores])

  useEffect(() => {
    if (!diagramId) return
    for (const proposal of proposals) {
      if (proposal.status !== 'accepted' || applyingRef.current.has(proposal.id)) continue
      applyingRef.current.add(proposal.id)
      void (async () => {
        try {
          const hadPublicDrafts = getPublicGraphDraftCount(currentProjectSnapshot()) > 0
          const baselineBeforeApply = hadPublicDrafts ? restorePublicGraphBaseline() : null
          const result = applyAcceptedProposal(proposal)
          if (result.status === 'applied') {
            if (hadPublicDrafts && baselineBeforeApply) {
              const nextBaseline = previewProjectForProposal(baselineBeforeApply, proposal)
              if (nextBaseline) {
                await saveAcceptedProposalSnapshot(diagramId, nextBaseline)
                capturePublicGraphBaseline(nextBaseline)
              } else {
                throw new Error('Accepted proposal could not be projected onto the public baseline')
              }
            } else {
              const nextBaseline = currentProjectSnapshot()
              await saveAcceptedProposalSnapshot(diagramId, nextBaseline)
              capturePublicGraphBaseline(nextBaseline)
            }
          }
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
          console.warn('Proposal apply/save failed:', err)
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
    setPostInitialSteps([])
    setPostFromGraphDraft(false)
    if (!currentUser) {
      postAfterAuthRef.current = true
      setAuthOpen(true)
      return
    }
    setPostOpen(true)
  }

  const openTransformPost = () => {
    const steps = getPublicGraphDraftSteps(currentProjectSnapshot())
    if (steps.length === 0) {
      setError('No graph changes are ready to submit.')
      return
    }
    if (steps.some((step) => step.action === 'commit-transform') && hasActiveTransformProposal) {
      setError('A layout change proposal is already active for this graph.')
      return
    }
    setPostInitialAction(null)
    setPostInitialSteps(steps)
    setPostFromGraphDraft(true)
    if (!currentUser) {
      postAfterAuthRef.current = true
      setAuthOpen(true)
      return
    }
    setPostOpen(true)
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
          {publicDraftSteps.length > 0 && (
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
        </>
      )}
      {open && (
        <>
          <button
            type="button"
            className={`social-forum-collapse ${closing ? 'closing' : 'open'}`}
            onClick={closeForum}
            aria-label="View graph"
          >
            View Graph
          </button>
          <section className={`social-forum-curtain ${closing ? 'closing' : 'open'}`} aria-label="Diagram forum">
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
                  onPreview={(proposal) => setProposalPreview(proposal)}
                  onUpdated={(topic) => {
                    setThread((current) => current ? { ...current, topic } : current)
                    setTopics((current) => current.map((item) => item.id === topic.id ? topic : item))
                  }}
                  onDeleted={(topic) => {
                    setThreadId(null)
                    setThread(null)
                    setTopics((current) => current.filter((item) => item.id !== topic.id))
                    void refreshProposals()
                    void refreshSocialScores()
                  }}
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
                            <small>
                              {currentUser.reputation} reputation · {currentUser.emailVerified ? 'verified' : 'email unverified'}
                            </small>
                            {!currentUser.emailVerified && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setAuthOpen(true)
                                  setAccountMenuOpen(false)
                                }}
                              >
                                Verify email
                              </button>
                            )}
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
                  <MiniDiagramPreview model={model} forumRef={forumRef} proposals={[]} themeMode={themeMode} />
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
                    diagramId={diagramId}
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
                    onUpdated={(topic) => {
                      setTopics((current) => current.map((item) => item.id === topic.id ? topic : item))
                    }}
                    onDeleted={(topic) => {
                      setTopics((current) => current.filter((item) => item.id !== topic.id))
                      if (threadId === topic.id) {
                        setThreadId(null)
                        setThread(null)
                      }
                      void refreshProposals()
                      void refreshSocialScores()
                    }}
                  />
                </main>
              </>
            )}
          </section>
        </>
      )}
      {postOpen && (
        <PostModal
          diagramId={diagramId}
          forumRef={forumRef}
          model={model}
          currentUser={currentUser}
          initialAction={postInitialAction}
          initialSteps={postInitialSteps}
          transformDraft={transformDraft}
          hasActiveTransformProposal={hasActiveTransformProposal}
          onClose={() => setPostOpen(false)}
          onCreated={(topic) => {
            if (postFromGraphDraft) restoreGraphDraftBaseline()
            setPostOpen(false)
            setPostInitialAction(null)
            setPostInitialSteps([])
            setPostFromGraphDraft(false)
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
          currentUser={currentUser}
          onClose={() => {
            postAfterAuthRef.current = false
            setAuthOpen(false)
          }}
          onAuthed={(user) => {
            setCurrentUser(user)
            if (!user.emailVerified) {
              setAuthOpen(true)
              return
            }
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
          onUserChanged={setCurrentUser}
          onClose={() => setProfileSettingsOpen(false)}
        />
      )}
      {proposalPreview && (
        <ProposalPreviewOverlay
          model={model}
          proposal={proposalPreview}
          themeMode={themeMode}
          onClose={() => setProposalPreview(null)}
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
  const sourceSuggestions = target ? connectedSourcesForTarget(model, nodes, target.id) : nodes
  const targetSuggestions = source ? connectedTargetsForSource(model, nodes, source.id) : nodes
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
        nodes={sourceSuggestions}
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
        nodes={targetSuggestions}
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
  previewIds,
  value,
  onChange,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
}: {
  nodes: ModelNode[]
  previewIds?: ReadonlySet<string>
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  'aria-label': string
}) {
  const [open, setOpen] = useState(false)
  const query = value.trim().toLowerCase()
  const recognized = useMemo(() => resolveNodeInput(value, nodes), [nodes, value])
  const suggestions = useMemo(() => {
    const ranked = query
      ? nodes.filter((node) => nodeLabel(node).toLowerCase().includes(query) || node.id.toLowerCase().includes(query))
      : nodes
    return ranked.slice(0, 8)
  }, [nodes, query])
  const inputClass = [
    recognized ? 'is-known' : '',
    recognized && previewIds?.has(recognized.id) ? 'is-preview' : '',
  ].filter(Boolean).join(' ')
  const recognizedLabel = recognized ? nodeLabel(recognized) : ''

  return (
    <span className={`social-node-suggest ${inputClass}`}>
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
      {recognized && (
        <span className="social-node-recognition-pill" aria-hidden>
          {recognizedLabel}
        </span>
      )}
      {open && !disabled && suggestions.length > 0 && (
        <span className="social-node-suggest-menu" role="listbox">
          {suggestions.map((node) => (
            <button
              key={node.id}
              type="button"
              role="option"
              className={previewIds?.has(node.id) ? 'is-preview' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(nodeLabel(node))
                setOpen(false)
              }}
            >
              <strong>{nodeLabel(node)}</strong>
              <small>{previewIds?.has(node.id) ? 'Queued preview item' : node.id}</small>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function TopicList({
  diagramId,
  topics,
  loading,
  currentUser,
  onLoginRequired,
  onVote,
  onOpen,
  onUpdated,
  onDeleted,
}: {
  diagramId: string
  topics: ForumTopic[]
  loading: boolean
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onVote: (topic: ForumTopic, vote: TopicVoteValue | null) => Promise<void>
  onOpen: (topic: ForumTopic) => void
  onUpdated: (topic: ForumTopic) => void
  onDeleted: (topic: ForumTopic) => void
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
              {topic.proposal && <ProposalStatusBadge proposal={topic.proposal} />}
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
          <TopicAuthorControls
            diagramId={diagramId}
            topic={topic}
            currentUser={currentUser}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
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

function TopicAuthorControls({
  diagramId,
  topic,
  currentUser,
  onUpdated,
  onDeleted,
}: {
  diagramId: string
  topic: ForumTopic
  currentUser: AuthUser | null
  onUpdated: (topic: ForumTopic) => void
  onDeleted: (topic: ForumTopic) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(topic.title)
  const [description, setDescription] = useState(topic.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canMutate = canCurrentUserMutateTopic(topic, currentUser)
  useEffect(() => {
    if (!editing) {
      setTitle(topic.title)
      setDescription(topic.description)
    }
  }, [editing, topic.title, topic.description])
  if (!canMutate) return null
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await updateForumTopic(diagramId, topic.id, { title, description })
      setEditing(false)
      onUpdated(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post update failed')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.confirm('Delete this post?')) return
    setBusy(true)
    setError(null)
    try {
      await deleteForumTopic(diagramId, topic.id)
      onDeleted(topic)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post deletion failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="social-topic-author-controls" onClick={(event) => event.stopPropagation()}>
      {editing ? (
        <form onSubmit={(event) => void save(event)}>
          <input aria-label="Post title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea aria-label="Post description" value={description} onChange={(event) => setDescription(event.target.value)} />
          <span>
            <button type="submit" disabled={busy}>Save</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </span>
        </form>
      ) : (
        <span>
          <button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" disabled={busy} onClick={() => void remove()}>Delete</button>
        </span>
      )}
      {error && <small className="social-forum-error">{error}</small>}
    </div>
  )
}

function canCurrentUserMutateTopic(topic: ForumTopic, currentUser: AuthUser | null): boolean {
  if (!currentUser || topic.author.toLowerCase() !== currentUser.username.toLowerCase()) return false
  return !topic.proposal || topic.proposal.status === 'pending'
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
  onUpdated,
  onDeleted,
}: {
  diagramId: string
  thread: ForumThread
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onBack: () => void
  onChanged: () => Promise<void>
  onVote: (topic: ForumTopic, vote: TopicVoteValue | null) => Promise<void>
  onPreview: (proposal: GraphProposal) => void
  onUpdated: (topic: ForumTopic) => void
  onDeleted: (topic: ForumTopic) => void
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
          {thread.topic.proposal && (
            <button
              type="button"
              className="social-preview-button"
              onClick={() => onPreview(thread.topic.proposal!)}
            >
              Preview
            </button>
          )}
          <TopicAuthorControls
            diagramId={diagramId}
            topic={thread.topic}
            currentUser={currentUser}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
          />
        </div>
        {thread.topic.proposal && (
          <div className="social-thread-topic-head">
            <span>{proposalActionLabel(thread.topic.proposal)}</span>
            <ProposalStatusBadge proposal={thread.topic.proposal} />
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

interface PostModalSessionDraft {
  title: string
  description: string
  action: GraphProposalAction
  changeEditorOpen: boolean
  sourceValue: string
  targetValue: string
  newTargetValue: string
  newLabel: string
  referenceTitle: string
  referenceCitation: string
  referenceUrl: string
  referencesText: string
  chainSteps: GraphProposalStep[]
}

let postModalSessionStash: { key: string; draft: PostModalSessionDraft } | null = null

function postModalStashKey(
  diagramId: string,
  initialAction?: GraphProposalAction | null,
  initialSteps?: GraphProposalStep[],
): string {
  const stepsKey = initialSteps?.length
    ? initialSteps.map((step) => `${step.action}:${'nodeId' in step ? step.nodeId ?? '' : ''}:${'edgeId' in step ? step.edgeId ?? '' : ''}`).join(',')
    : ''
  return `${diagramId}|${initialAction ?? ''}|${stepsKey}`
}

function PostModal({
  diagramId,
  forumRef,
  model,
  currentUser,
  initialAction,
  initialSteps,
  transformDraft,
  hasActiveTransformProposal,
  onClose,
  onCreated,
}: {
  diagramId: string
  forumRef: ForumRef
  model: Model
  currentUser: AuthUser | null
  initialAction?: GraphProposalAction | null
  initialSteps?: GraphProposalStep[]
  transformDraft?: TransformProposalEntry[]
  hasActiveTransformProposal?: boolean
  onClose: () => void
  onCreated: (topic: ForumTopic) => void
}) {
  const stashKey = postModalStashKey(diagramId, initialAction, initialSteps)
  const stashedDraft = postModalSessionStash?.key === stashKey ? postModalSessionStash.draft : null
  const nodes = useMemo(() => sortedNodes(model), [model])
  const isGraphEmpty = nodes.length === 0
  const initialProposal = proposalDraftFromForumRef(model, forumRefFromGraphSelection(model) ?? forumRef)
  const [title, setTitle] = useState(stashedDraft?.title ?? '')
  const [description, setDescription] = useState(stashedDraft?.description ?? '')
  const [action, setAction] = useState<GraphProposalAction>(stashedDraft?.action ?? initialAction ?? (isGraphEmpty ? 'add-node' : initialProposal.action))
  const [changeEditorOpen, setChangeEditorOpen] = useState(stashedDraft?.changeEditorOpen ?? ((initialSteps?.length ?? 0) === 0))
  const [sourceValue, setSourceValue] = useState(stashedDraft?.sourceValue ?? initialProposal.sourceValue)
  const [targetValue, setTargetValue] = useState(stashedDraft?.targetValue ?? initialProposal.targetValue)
  const [newTargetValue, setNewTargetValue] = useState(stashedDraft?.newTargetValue ?? '')
  const [newLabel, setNewLabel] = useState(stashedDraft?.newLabel ?? '')
  const [referenceTitle, setReferenceTitle] = useState(stashedDraft?.referenceTitle ?? '')
  const [referenceCitation, setReferenceCitation] = useState(stashedDraft?.referenceCitation ?? '')
  const [referenceUrl, setReferenceUrl] = useState(stashedDraft?.referenceUrl ?? '')
  const [referencesText, setReferencesText] = useState(stashedDraft?.referencesText ?? '')
  const [chainSteps, setChainSteps] = useState<GraphProposalStep[]>(() => stashedDraft?.chainSteps ?? initialSteps ?? [])
  const [error, setError] = useState<string | null>(null)
  const [flowPreview, setFlowPreview] = useState<FlowPreviewData | null>(null)
  const activeAction: GraphProposalAction = action
  const draftTransforms = transformDraft ?? []
  const dimensionAction = activeAction === 'add-rmm' || activeAction === 'add-mpd'
  const sourceOnlyAction = dimensionAction ||
    activeAction === 'update-node-settings' ||
    activeAction === 'update-node-media' ||
    activeAction === 'update-flow-effects'
  const workingModel = useMemo(() => projectModelForChain(model, chainSteps), [model, chainSteps])
  const workingNodes = useMemo(() => sortedNodes(workingModel), [workingModel])
  const queuedNodeIds = useMemo(() => queuedNodeIdSet(chainSteps), [chainSteps])
  const chainGroups = useMemo(
    () => changeGroupsForSteps(chainSteps, workingModel, useOmniStore.getState().models),
    [chainSteps, workingModel],
  )

  useEffect(() => {
    if (activeAction !== 'modify-references') return
    setReferencesText(referenceLinesForSelection(workingModel, workingNodes, sourceValue, targetValue))
  }, [activeAction, workingModel, workingNodes, sourceValue, targetValue])

  const buildCurrentStep = (): GraphProposalStep => {
    const proposal = buildProposalPayload({
      action: activeAction,
      model: workingModel,
      nodes: workingNodes,
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
    if (proposal.action === 'chain') throw new Error('Nested chains are not supported')
    return proposal
  }

  const appendCurrentStep = () => {
    setError(null)
    try {
      const step = withQueuedIds(buildCurrentStep(), chainSteps, model)
      setChainSteps((current) => [...current, step])
      clearStepFormForNext(step)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add change')
    }
  }

  const clearStepFormForNext = (step: GraphProposalStep) => {
    if (step.action === 'add-node' || step.action === 'add-node-edge' || step.action === 'add-rmm' || step.action === 'add-mpd') {
      setNewLabel('')
      if (step.action === 'add-node-edge') setTargetValue('')
    }
    if (step.action === 'add-reference') {
      setReferenceTitle('')
      setReferenceCitation('')
      setReferenceUrl('')
    }
  }

  const editStep = (step: GraphProposalStep, index: number) => {
    setAction(step.action)
    setChangeEditorOpen(true)
    hydrateStepForm(step, workingModel, workingNodes, setSourceValue, setTargetValue, setNewTargetValue, setNewLabel, setReferenceTitle, setReferenceCitation, setReferenceUrl, setReferencesText)
    setChainSteps((current) => current.filter((_, i) => i !== index))
  }

  const draftSnapshot = (): PostModalSessionDraft => ({
    title,
    description,
    action: activeAction,
    changeEditorOpen,
    sourceValue,
    targetValue,
    newTargetValue,
    newLabel,
    referenceTitle,
    referenceCitation,
    referenceUrl,
    referencesText,
    chainSteps,
  })

  const stashAndClose = () => {
    postModalSessionStash = { key: stashKey, draft: draftSnapshot() }
    onClose()
  }

  const cancelAndClose = () => {
    if (postModalSessionStash?.key === stashKey) postModalSessionStash = null
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!currentUser) {
      setError('Log in before posting')
      return
    }
    if (!currentUser.emailVerified) {
      setError('Verify your email before posting')
      return
    }
    try {
      const plannedSteps = chainSteps.length > 0 ? chainSteps : []
      if ((activeAction === 'commit-transform' || plannedSteps.some((step) => step.action === 'commit-transform')) && hasActiveTransformProposal) {
        throw new Error('A layout change proposal is already active for this graph.')
      }
      const proposal = chainSteps.length > 0
        ? chainSteps.length === 1 ? chainSteps[0] : { action: 'chain' as const, steps: chainSteps }
        : undefined
      const topic = await createForumTopic(diagramId, {
        forumRef,
        title,
        description,
        ...(proposal ? { proposal } : {}),
      })
      if (postModalSessionStash?.key === stashKey) postModalSessionStash = null
      onCreated(topic)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed')
    }
  }

  return (
    <div
      className="social-modal-backdrop"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) stashAndClose()
      }}
    >
      <form className="social-post-modal" onSubmit={(e) => void submit(e)} aria-label="Create forum post">
        <header>
          <h3>New post</h3>
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
        <div className="social-chain-builder">
          {chainSteps.length > 0 && (
            <ol aria-label="Suggested change chain">
              {chainSteps.map((step, index) => (
                <PostChangeRow
                  key={`${step.action}-${index}`}
                  index={index}
                  group={chainGroups[index]}
                  onPreviewFlow={setFlowPreview}
                  onEdit={() => editStep(step, index)}
                  onMoveUp={() => setChainSteps((current) => moveChainStep(current, index, index - 1))}
                  onMoveDown={() => setChainSteps((current) => moveChainStep(current, index, index + 1))}
                  onRemove={() => setChainSteps((current) => current.filter((_, i) => i !== index))}
                  canMoveUp={index > 0}
                  canMoveDown={index < chainSteps.length - 1}
                />
              ))}
            </ol>
          )}
          {changeEditorOpen && (
            <div className="social-proposal-fields">
              <select
                className="social-action-select-badge"
                aria-label="Suggested action"
                value={activeAction}
                onChange={(e) => {
                  const next = e.target.value as GraphProposalAction
                  setAction(next)
                  if (next === 'modify-references') {
                    setReferencesText(referenceLinesForSelection(workingModel, workingNodes, sourceValue, targetValue))
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
                    <option value="update-node-settings">Update node settings</option>
                    <option value="update-node-media">Update node media</option>
                    <option value="update-flow-effects">Update flow effects</option>
                    <option value="update-edge-settings">Update connection settings</option>
                    {!hasActiveTransformProposal && (draftTransforms.length > 0 || activeAction === 'commit-transform') && (
                      <option value="commit-transform">Commit transform</option>
                    )}
                    <option value="remove-edge">Remove connection</option>
                    <option value="remove-node">Remove node</option>
                    <option value="rename-node">Rename node</option>
                    <option value="rename-edge">Rename connection</option>
                    <option value="add-reference">Add reference</option>
                    <option value="modify-references">Modify references</option>
                    <option value="rewire-edge">Rewire connection</option>
                  </>
                )}
              </select>
              {activeAction !== 'add-node' && activeAction !== 'commit-transform' && (
                <div className="social-ref-selector compact">
                  <NodeSuggestInput
                    nodes={workingNodes}
                    previewIds={queuedNodeIds}
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
                      placeholder={dimensionAction ? 'dimension' : 'node'}
                      aria-label={dimensionAction ? 'Dimension target' : 'Node settings target'}
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
                      nodes={workingNodes}
                      previewIds={queuedNodeIds}
                      value={targetValue}
                      onChange={setTargetValue}
                      placeholder="target"
                      aria-label="Proposal target node"
                      disabled={activeAction === 'remove-node' || activeAction === 'rename-node'}
                    />
                  )}
                </div>
              )}
              {(activeAction === 'add-node' || activeAction === 'rename-node' || activeAction === 'rename-edge' || dimensionAction) && (
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={dimensionAction ? 'dimension name' : 'new name'}
                  aria-label={dimensionAction ? 'Dimension name' : 'New name'}
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
                  nodes={workingNodes}
                  previewIds={queuedNodeIds}
                  value={newTargetValue}
                  onChange={setNewTargetValue}
                  placeholder="new target"
                  aria-label="New target node"
                />
              )}
              {activeAction === 'commit-transform' && (
                <p className="social-transform-summary">
                  {draftTransforms.length} layout {draftTransforms.length === 1 ? 'change is' : 'changes are'} ready for preview and voting.
                </p>
              )}
              <div className="social-proposal-field-actions">
                <button type="button" onClick={appendCurrentStep}>Apply change</button>
                <button type="button" onClick={() => setChangeEditorOpen(false)}>Cancel edit</button>
              </div>
            </div>
          )}
        </div>
        {error && <div className="social-forum-error">{error}</div>}
        <footer>
          <button type="button" onClick={cancelAndClose}>Cancel</button>
          <button type="submit">Post</button>
        </footer>
      </form>
      {flowPreview && (
        <EffectGraphDiffPreview
          preview={flowPreview}
          model={workingModel}
          onClose={() => setFlowPreview(null)}
        />
      )}
    </div>
  )
}

export function AuthModal({
  currentUser,
  onClose,
  onAuthed,
}: {
  currentUser: AuthUser | null
  onClose: () => void
  onAuthed: (user: AuthUser) => void
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>(() => currentUser && !currentUser.emailVerified ? 'verify' : 'login')
  const [login, setLogin] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [devMessages, setDevMessages] = useState<DevVerificationMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadDevInbox = async () => {
    setError(null)
    try {
      setDevMessages(await listDevVerificationMessages())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dev inbox')
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const validation = validateAuthInput(mode, mode === 'login' ? login : username, email, password, verificationCode)
    if (validation) {
      setError(validation)
      return
    }
    setBusy(true)
    try {
      if (mode === 'verify') {
        const user = await verifyEmail(verificationCode)
        onAuthed(user)
      } else {
        const result = mode === 'login'
          ? await loginAccount(login.trim(), password)
          : await registerAccount(username.trim(), email.trim(), password)
        onAuthed(result.user)
        if (!result.user.emailVerified) {
          setMode('verify')
          await loadDevInbox()
        }
      }
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
          <h3>{mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Verify email'}</h3>
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
          {(currentUser || mode === 'verify') && (
            <button
              type="button"
              className={mode === 'verify' ? 'active' : ''}
              onClick={() => {
                setMode('verify')
                setError(null)
                void loadDevInbox()
              }}
            >
              Verify
            </button>
          )}
        </div>
        {mode === 'login' && (
          <>
            <label>
              Username or email
              <input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
          </>
        )}
        {mode === 'register' && (
          <>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>
            <p className="social-auth-hint">Usernames use 3-24 letters, numbers, underscores, or dashes. Passwords need at least 8 characters.</p>
          </>
        )}
        {mode === 'verify' && (
          <>
            <p className="social-auth-hint">
              Enter the verification code sent to your email. In local dev, use the inbox below.
            </p>
            <label>
              Verification code
              <input
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div className="social-auth-dev-inbox">
              <button type="button" onClick={() => void loadDevInbox()}>Refresh dev inbox</button>
              <button
                type="button"
                onClick={() => {
                  void resendVerificationEmail()
                    .then(onAuthed)
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
                  <span>{message.to}</span>
                  {message.code && <code>{message.code}</code>}
                </button>
              ))}
            </div>
          </>
        )}
        {error && <div className="social-forum-error">{error}</div>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>
            {busy ? 'Working...' : mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Verify email'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function PostChangeRow({
  index,
  group,
  onPreviewFlow,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp,
  canMoveDown,
}: {
  index: number
  group: ChangeGroup
  onPreviewFlow?: (preview: FlowPreviewData) => void
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  return (
    <li className="social-chain-change">
      <details open={group.defaultExpanded}>
        <summary>
          <span>{index + 1}. {group.title}</span>
          <div className="social-chain-actions" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={onEdit}>Edit</button>
            <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move change up">↑</button>
            <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move change down">↓</button>
            <button type="button" onClick={onRemove}>Remove</button>
          </div>
        </summary>
        {group.details.length > 0 && <ChangeDetailList details={group.details} onPreviewFlow={onPreviewFlow} />}
      </details>
    </li>
  )
}

function ChangeDetailList({
  details,
  onPreviewFlow,
}: {
  details: readonly ChangeDetail[]
  onPreviewFlow?: (preview: FlowPreviewData) => void
}) {
  return (
    <dl className="social-change-details">
      {details.map((detail) => (
        <div key={detail.id} className="social-change-detail">
          <dt>{detail.label}</dt>
          <dd>
            {detail.before != null && detail.after != null ? (
              <span><del>{detail.before || 'none'}</del> <b>→</b> <ins>{detail.after || 'none'}</ins></span>
            ) : (
              <span>{detail.after ?? detail.before ?? ''}</span>
            )}
            {detail.lines && detail.lines.length > 0 && (
              <ul>
                {detail.lines.map((line, index) => <li key={`${detail.id}-${index}`}>{line}</li>)}
              </ul>
            )}
            {detail.flowPreview && onPreviewFlow && (
              <button
                type="button"
                className="social-change-flow-preview"
                onClick={() => {
                  if (detail.flowPreview) onPreviewFlow(detail.flowPreview)
                }}
              >
                Effect Graph Preview
              </button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ProfileSettingsModal({
  user,
  onUserChanged,
  onClose,
}: {
  user: AuthUser
  onUserChanged: (user: AuthUser | null) => void
  onClose: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const next = await changePassword(currentPassword, nextPassword)
      onUserChanged(next)
      setCurrentPassword('')
      setNextPassword('')
      setMessage('Password updated.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Password update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="social-modal-backdrop" role="presentation">
      <section className="social-profile-modal" role="dialog" aria-label="Profile settings">
        <header>
          <h3>Profile settings</h3>
          <button type="button" onClick={onClose} aria-label="Close profile settings">Close</button>
        </header>
        <div className="social-profile-summary">
          <strong>{user.username}</strong>
          <span>{user.email} · {user.emailVerified ? 'verified' : 'unverified'}</span>
          <span>{user.reputation} reputation</span>
        </div>
        <form onSubmit={(event) => void submitPassword(event)}>
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button type="submit" disabled={busy || !user.emailVerified}>Change password</button>
        </form>
        <button
          type="button"
          onClick={() => {
            void logoutAllAccounts().then(() => {
              onUserChanged(null)
              onClose()
            }).catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Logout failed'))
          }}
        >
          Log out everywhere
        </button>
        {message && <div className="social-forum-error">{message}</div>}
      </section>
    </div>
  )
}

function ProposalPreviewOverlay({
  model,
  proposal,
  themeMode,
  onClose,
}: {
  model: Model
  proposal: GraphProposal
  themeMode: ThemeMode
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const [previewRenderer, setPreviewRenderer] = useState<SceneRenderer | null>(null)
  const steps = useMemo(() => proposalSteps(proposal.payload), [proposal.payload])
  const transforms = useMemo(() => steps.flatMap((step) => step.action === 'commit-transform' ? step.transforms : []), [steps])
  const previewModel = useMemo(
    () => previewModelForProposal(model, useOmniStore.getState().models, proposal) ?? model,
    [model, proposal],
  )
  const changeGroups = useMemo(
    () => changeGroupsForSteps(steps, previewModel, useOmniStore.getState().models),
    [previewModel, steps],
  )
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => changeGroups[0]?.id ?? '')
  const [flowPreview, setFlowPreview] = useState<FlowPreviewData | null>(null)
  const selectedGroup = changeGroups.find((group) => group.id === selectedGroupId) ?? changeGroups[0]

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const renderer = new SceneRenderer({ preview: true, forceFullLod: true, socialDecorations: false })
    rendererRef.current = renderer
    setPreviewRenderer(renderer)
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
      renderer.setGraphProposals([])
      renderer.setTransformPreview(transforms)
      renderer.setCamera(miniCameraForBounds(sceneBounds([...previewModel.nodes.values()]), renderer.getViewport()))
    }).catch((err: unknown) => {
      console.warn('Proposal preview failed:', err)
    })
    return () => {
      disposed = true
      rendererRef.current = null
      setPreviewRenderer(null)
      renderer.destroy()
    }
  }, [previewModel, proposal, themeMode, transforms])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    applyPreviewSelection(renderer, selectedGroup)
  }, [selectedGroup])

  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const host = hostRef.current
    if (!renderer || !host) return
    const rect = host.getBoundingClientRect()
    const camera = renderer.getCamera()
    const viewport = renderer.getViewport()
    const scene = clientToScene(event.clientX - rect.left, event.clientY - rect.top, camera, viewport)
    const nodeId = renderer.pickNode(scene.x, scene.y)
    const edgeId = nodeId ? null : renderer.pickEdge(scene.x, scene.y)
    const picked = nodeId
      ? changeGroups.find((group) => groupTargetsId(group, 'node', nodeId))
      : edgeId
        ? changeGroups.find((group) => groupTargetsId(group, 'edge', edgeId))
        : null
    if (picked) setSelectedGroupId(picked.id)
  }

  return (
    <div className="social-transform-preview" role="dialog" aria-label="Proposal preview">
      <header>
        <button type="button" className="social-thread-back" onClick={onClose}>Back</button>
        <div>
          <h3>Change preview</h3>
          <p>{steps.length} proposed {steps.length === 1 ? 'change' : 'changes'}</p>
        </div>
      </header>
      <div className="social-transform-preview-body">
        <div ref={hostRef} className="social-transform-preview-render" onPointerDown={handlePreviewPointerDown}>
          <RichNodeOverlay renderer={previewRenderer} />
        </div>
        <aside className="social-transform-preview-inspector" aria-label="Change inspector">
          <h4>Changes</h4>
          <ol>
            {changeGroups.map((group, index) => (
              <li key={group.id}>
                <button
                  type="button"
                  className={group.id === selectedGroup?.id ? 'active' : ''}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  {index + 1}. {group.title}
                </button>
              </li>
            ))}
          </ol>
          {selectedGroup && (
            <section className="social-transform-preview-detail">
              <h5>{selectedGroup.title}</h5>
              {selectedGroup.details.length > 0 ? (
                <ChangeDetailList details={selectedGroup.details} onPreviewFlow={setFlowPreview} />
              ) : (
                <p>No extra details for this change.</p>
              )}
            </section>
          )}
        </aside>
      </div>
      {flowPreview && (
        <EffectGraphDiffPreview
          preview={flowPreview}
          model={previewModel}
          onClose={() => setFlowPreview(null)}
        />
      )}
    </div>
  )
}

function applyPreviewSelection(renderer: SceneRenderer, group: ChangeGroup | undefined): void {
  const target = group?.target
  if (!target) {
    renderer.setSelection(new Set())
    renderer.setEdgeSelection(new Set())
    return
  }
  if (target.kind === 'edge') {
    renderer.setSelection(new Set())
    renderer.setEdgeSelection(new Set([target.id]))
    return
  }
  renderer.setSelection(new Set([target.id]))
  renderer.setEdgeSelection(new Set())
}

function groupTargetsId(group: ChangeGroup, kind: 'node' | 'edge', id: string): boolean {
  if (group.target?.kind === kind && group.target.id === id) return true
  return group.details.some((detail) => detail.target?.kind === kind && detail.target.id === id)
}

function validateAuthInput(
  mode: 'login' | 'register' | 'verify',
  usernameOrLogin: string,
  email: string,
  password: string,
  verificationCode: string,
): string | null {
  if (mode === 'verify') {
    if (!verificationCode.trim()) return 'Enter a verification code.'
    return null
  }
  const cleanUsername = usernameOrLogin.trim()
  if (!cleanUsername) return mode === 'login' ? 'Enter a username or email.' : 'Enter a username.'
  if (!password) return 'Enter a password.'
  if (mode !== 'register') return null
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(cleanUsername)) {
    return 'Use 3-24 letters, numbers, underscores, or dashes for the username.'
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.'
  if (password.length < 8) return 'Use a password with at least 8 characters.'
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
    case 'update-node-settings':
      if (!source) throw new Error('Choose a node to update')
      return { action: input.action, nodeId: source.id, after: nodeSettingsPatch(source) }
    case 'update-node-media':
      if (!source) throw new Error('Choose a media/content node to update')
      return { action: input.action, nodeId: source.id, after: nodeMediaPatch(source) }
    case 'update-flow-effects':
      if (!source) throw new Error('Choose a node with flow effects to update')
      return {
        action: input.action,
        nodeId: source.id,
        after: nodeFlowPatch(source),
        ...(input.model.crossLinks ? { crossLinksAfter: input.model.crossLinks } : {}),
      }
    case 'update-edge-settings':
      if (!edge) throw new Error('Choose an existing connection')
      return { action: input.action, edgeId: edge.id, after: edgeSettingsPatch(edge) }
    case 'chain':
      throw new Error('Add chain entries before posting')
  }
}

function nodeSettingsPatch(node: ModelNode): EntityPatch<ModelNode> {
  return pickEntityPatch(node, [
    'shape',
    'cosmeticType',
    'cellColor',
    'membraneColor',
    'membraneVisible',
    'tip',
    'tipAngle',
    'tipLength',
    'locked',
    'hideDuringFlow',
    'cameraTracked',
    'textFormats',
    'previewOf',
    'extra',
  ])
}

function nodeMediaPatch(node: ModelNode): EntityPatch<ModelNode> {
  return pickEntityPatch(node, [
    'mediaType',
    'mediaSrc',
    'mediaFileName',
    'audioCoverSrc',
    'contentSource',
    'contentCollapsed',
    'contentFontSize',
  ])
}

function nodeFlowPatch(node: ModelNode): EntityPatch<ModelNode> {
  return pickEntityPatch(node, ['flowEffects', 'linkedNodeIds'])
}

function edgeSettingsPatch(edge: Connection): EntityPatch<Connection> {
  return pickEntityPatch(edge, [
    'kind',
    'dash',
    'arrowStyle',
    'color',
    'width',
    'labelFontSize',
    'cameraTracked',
    'dependsOnSpawn',
    'hideDuringFlow',
    'extra',
  ])
}

function pickEntityPatch<T extends object>(entity: T, keys: readonly (keyof T)[]): EntityPatch<T> {
  const patch: Record<string, unknown> = {}
  const record = entity as Record<string, unknown>
  for (const key of keys) patch[String(key)] = record[String(key)] ?? null
  return patch as EntityPatch<T>
}

function restoreGraphDraftBaseline(): void {
  const baseline = restorePublicGraphBaseline()
  if (baseline) useOmniStore.getState().loadProject(baseline)
}

async function saveAcceptedProposalSnapshot(diagramId: string, snapshot: Project): Promise<void> {
  const model = snapshot.models.get(snapshot.rootModelId)
  const bundleBase64 = await blobToBase64(await exportBundle(snapshot))
  await saveCloudDiagram(diagramId, {
    title: model?.name || 'Untitled diagram',
    bundleBase64,
  })
}

function currentProjectSnapshot() {
  const state = useOmniStore.getState()
  const models = new Map(state.models)
  models.set(state.model.id, state.model)
  return { rootModelId: state.model.id, models }
}

function moveChainStep(steps: GraphProposalStep[], from: number, to: number): GraphProposalStep[] {
  if (to < 0 || to >= steps.length) return steps
  const next = [...steps]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function hydrateStepForm(
  step: GraphProposalStep,
  model: Model,
  nodes: ModelNode[],
  setSourceValue: (value: string) => void,
  setTargetValue: (value: string) => void,
  setNewTargetValue: (value: string) => void,
  setNewLabel: (value: string) => void,
  setReferenceTitle: (value: string) => void,
  setReferenceCitation: (value: string) => void,
  setReferenceUrl: (value: string) => void,
  setReferencesText: (value: string) => void,
): void {
  const nodeName = (id: string) => {
    const node = model.nodes.get(id)
    return node ? nodeLabel(node) : id
  }
  const edge = 'edgeId' in step && step.edgeId ? model.edges.get(step.edgeId) : null
  switch (step.action) {
    case 'add-node':
      setSourceValue('')
      setTargetValue('')
      setNewLabel(step.newNodeLabel)
      break
    case 'add-node-edge':
      setSourceValue(nodeName(step.sourceNodeId))
      setTargetValue(step.newNodeLabel)
      setNewLabel('')
      break
    case 'add-edge':
      setSourceValue(nodeName(step.sourceNodeId))
      setTargetValue(nodeName(step.targetNodeId))
      setNewLabel(step.label ?? '')
      setReferencesText(step.references ? referenceLines(step.references) : '')
      break
    case 'add-rmm':
    case 'add-mpd':
      setSourceValue(nodeName(step.nodeId))
      setTargetValue('')
      setNewLabel(step.name)
      break
    case 'update-node-settings':
    case 'update-node-media':
    case 'update-flow-effects':
      setSourceValue(nodeName(step.nodeId))
      setTargetValue('')
      setNewLabel('')
      break
    case 'remove-node':
    case 'rename-node':
      setSourceValue(nodeName(step.nodeId))
      setTargetValue('')
      setNewLabel(step.action === 'rename-node' ? step.nextLabel : '')
      break
    case 'remove-edge':
    case 'rename-edge':
    case 'add-reference':
    case 'modify-references':
    case 'update-edge-settings':
    case 'rewire-edge':
      if (edge) {
        setSourceValue(nodeName(edge.from))
        setTargetValue(nodeName(edge.to))
      }
      if (step.action === 'rename-edge') setNewLabel(step.nextLabel)
      if (step.action === 'add-reference') {
        setReferenceTitle(step.reference.title)
        setReferenceCitation(step.reference.citation)
        setReferenceUrl(step.reference.url)
      }
      if (step.action === 'modify-references') setReferencesText(referenceLines(step.references))
      if (step.action === 'rewire-edge') setNewTargetValue(nodeName(step.nextTargetNodeId))
      break
    case 'commit-transform':
      void nodes
      break
  }
}

function projectModelForChain(model: Model, steps: GraphProposalStep[]): Model {
  const projected: Model = {
    ...model,
    nodes: new Map(model.nodes),
    edges: new Map(model.edges),
  }
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    switch (step.action) {
      case 'add-node': {
        const nodeId = step.nodeId ?? `queued_node_${index + 1}`
        if (!projected.nodes.has(nodeId)) {
          projected.nodes.set(nodeId, {
            ...DEFAULT_NODE,
            ...(step.node ?? {}),
            id: nodeId,
            label: step.node ? step.node.label : step.newNodeLabel,
            x: step.geometry?.x ?? 50 + index * 3,
            y: step.geometry?.y ?? 50,
            w: step.geometry?.w ?? DEFAULT_NODE.w,
            h: step.geometry?.h ?? DEFAULT_NODE.h,
            shape: step.shape ?? DEFAULT_NODE.shape,
            extra: { queuedPreview: true },
          })
        }
        break
      }
      case 'add-node-edge': {
        const source = projected.nodes.get(step.sourceNodeId)
        const nodeId = step.nodeId ?? `queued_node_${index + 1}`
        if (!projected.nodes.has(nodeId)) {
          projected.nodes.set(nodeId, {
            ...DEFAULT_NODE,
            ...(step.node ?? {}),
            id: nodeId,
            label: step.node ? step.node.label : step.newNodeLabel,
            x: step.geometry?.x ?? (source ? source.x + Math.max(8, source.w + 3) : 50 + index * 3),
            y: step.geometry?.y ?? source?.y ?? 50,
            w: step.geometry?.w ?? DEFAULT_NODE.w,
            h: step.geometry?.h ?? DEFAULT_NODE.h,
            shape: step.shape ?? DEFAULT_NODE.shape,
            extra: { queuedPreview: true },
          })
        }
        const target = projected.nodes.get(nodeId)
        const edgeId = step.edgeId ?? `queued_edge_${index + 1}`
        if (source && target && !projected.edges.has(edgeId)) {
          projected.edges.set(edgeId, { ...DEFAULT_EDGE, ...(step.edge ?? {}), id: edgeId, from: source.id, to: target.id, extra: { ...(step.edge?.extra ?? {}), queuedPreview: true } })
        }
        break
      }
      case 'add-edge': {
        const source = projected.nodes.get(step.sourceNodeId)
        const target = projected.nodes.get(step.targetNodeId)
        const edgeId = step.edgeId ?? `queued_edge_${index + 1}`
        if (source && target && !projected.edges.has(edgeId)) {
          projected.edges.set(edgeId, {
            ...DEFAULT_EDGE,
            ...(step.edge ?? {}),
            ...(step.style ?? {}),
            id: edgeId,
            from: source.id,
            to: target.id,
            ...(step.label ? { label: step.label } : {}),
            ...(step.references ? { references: step.references } : {}),
            extra: { ...(step.edge?.extra ?? {}), queuedPreview: true },
          })
        }
        break
      }
      case 'remove-node': {
        projected.nodes.delete(step.nodeId)
        for (const edge of [...projected.edges.values()]) {
          if (edge.from === step.nodeId || edge.to === step.nodeId) projected.edges.delete(edge.id)
        }
        break
      }
      case 'remove-edge':
        projected.edges.delete(step.edgeId)
        break
      case 'rename-node': {
        const node = projected.nodes.get(step.nodeId)
        if (node) projected.nodes.set(node.id, { ...node, label: step.nextLabel })
        break
      }
      case 'rename-edge': {
        const edge = projected.edges.get(step.edgeId)
        if (edge) projected.edges.set(edge.id, { ...edge, label: step.nextLabel })
        break
      }
      case 'rewire-edge': {
        const edge = projected.edges.get(step.edgeId)
        if (edge && projected.nodes.has(step.nextTargetNodeId)) projected.edges.set(edge.id, { ...edge, to: step.nextTargetNodeId })
        break
      }
      case 'add-reference': {
        const edge = projected.edges.get(step.edgeId)
        if (edge) projected.edges.set(edge.id, { ...edge, references: [...(edge.references ?? []), step.reference] })
        break
      }
      case 'modify-references': {
        const edge = projected.edges.get(step.edgeId)
        if (edge) projected.edges.set(edge.id, { ...edge, references: step.references.length > 0 ? step.references : undefined })
        break
      }
      case 'commit-transform':
        for (const transform of step.transforms) {
          const node = projected.nodes.get(transform.nodeId)
          if (node) projected.nodes.set(node.id, { ...node, ...transform.to })
        }
        break
      case 'update-node-settings':
      case 'update-node-media':
      case 'update-flow-effects': {
        const node = projected.nodes.get(step.nodeId)
        if (node) projected.nodes.set(node.id, { ...applyEntityPatch(node, step.after), id: node.id, label: node.label })
        if (step.action === 'update-flow-effects' && step.crossLinksAfter) projected.crossLinks = step.crossLinksAfter
        break
      }
      case 'update-edge-settings': {
        const edge = projected.edges.get(step.edgeId)
        if (edge) projected.edges.set(edge.id, { ...applyEntityPatch(edge, step.after), id: edge.id, from: edge.from, to: edge.to })
        break
      }
      case 'add-rmm':
      case 'add-mpd':
        break
    }
  }
  return projected
}

function applyEntityPatch<T extends object>(entity: T, patch: EntityPatch<T>): T {
  const next: Record<string, unknown> = { ...(entity as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next as T
}

function withQueuedIds(step: GraphProposalStep, currentSteps: GraphProposalStep[], model: Model): GraphProposalStep {
  const nodeIds = new Set(model.nodes.keys())
  const edgeIds = new Set(model.edges.keys())
  collectQueuedIds(currentSteps, nodeIds, edgeIds)
  switch (step.action) {
    case 'add-node':
      return step.nodeId ? step : { ...step, nodeId: uniqueQueuedId('queued_node', step.newNodeLabel, nodeIds) }
    case 'add-node-edge':
      return {
        ...step,
        nodeId: step.nodeId ?? uniqueQueuedId('queued_node', step.newNodeLabel, nodeIds),
        edgeId: step.edgeId ?? uniqueQueuedId('queued_edge', `${step.sourceNodeId}_${step.newNodeLabel}`, edgeIds),
      }
    case 'add-edge':
      return step.edgeId ? step : { ...step, edgeId: uniqueQueuedId('queued_edge', `${step.sourceNodeId}_${step.targetNodeId}`, edgeIds) }
    default:
      return step
  }
}

function collectQueuedIds(steps: GraphProposalStep[], nodeIds: Set<string>, edgeIds: Set<string>): void {
  for (const step of steps) {
    if ((step.action === 'add-node' || step.action === 'add-node-edge') && step.nodeId) nodeIds.add(step.nodeId)
    if ((step.action === 'add-node-edge' || step.action === 'add-edge') && step.edgeId) edgeIds.add(step.edgeId)
  }
}

function queuedNodeIdSet(steps: GraphProposalStep[]): Set<string> {
  const ids = new Set<string>()
  for (const step of steps) {
    if ((step.action === 'add-node' || step.action === 'add-node-edge') && step.nodeId) ids.add(step.nodeId)
  }
  return ids
}

function uniqueQueuedId(prefix: 'queued_node' | 'queued_edge', label: string, used: Set<string>): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'item'
  let id = `${prefix}_${slug}`
  let suffix = 2
  while (used.has(id)) {
    id = `${prefix}_${slug}_${suffix}`
    suffix++
  }
  used.add(id)
  return id
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

function connectedTargetsForSource(model: Model, nodes: ModelNode[], sourceId: string): ModelNode[] {
  const targetIds = new Set<string>()
  for (const edge of model.edges.values()) {
    if (edge.from === sourceId) targetIds.add(edge.to)
  }
  return nodes.filter((node) => targetIds.has(node.id))
}

function connectedSourcesForTarget(model: Model, nodes: ModelNode[], targetId: string): ModelNode[] {
  const sourceIds = new Set<string>()
  for (const edge of model.edges.values()) {
    if (edge.to === targetId) sourceIds.add(edge.from)
  }
  return nodes.filter((node) => sourceIds.has(node.id))
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

function referenceLines(references: ConnectionReference[]): string {
  return references.map(formatReferenceLine).join('\n')
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
    case 'update-node-settings': return 'N'
    case 'update-node-media': return 'M'
    case 'update-flow-effects': return 'FX'
    case 'update-edge-settings': return 'E'
    case 'rewire-edge': return '↪'
    case 'commit-transform': return '⇧'
    case 'chain': return '⛓'
  }
}

function ProposalStatusBadge({ proposal }: { proposal: GraphProposal }) {
  const status = proposalDisplayStatus(proposal)
  return (
    <i className={`social-proposal-status-badge ${status.className}`}>
      {status.label}
    </i>
  )
}

function proposalDisplayStatus(proposal: GraphProposal): { label: 'Pending' | 'Accepted' | 'Rejected'; className: string } {
  switch (proposal.status) {
    case 'accepted':
    case 'applied':
      return { label: 'Accepted', className: 'accepted' }
    case 'stale':
    case 'blocked':
      return { label: 'Rejected', className: 'rejected' }
    case 'pending':
    default:
      return { label: 'Pending', className: 'pending' }
  }
}

function isActiveTransformProposal(proposal: GraphProposal): boolean {
  return proposalContainsAction(proposal.payload, 'commit-transform') && (proposal.status === 'pending' || proposal.status === 'accepted')
}

function rendererThemeFor(mode: ThemeMode): Parameters<SceneRenderer['setThemePalette']>[0] {
  const palette = resolvePalette(mode)
  const labelHex = palette.nodeLabel.startsWith('#') ? palette.nodeLabel : '#132949'
  const label = parseInt(labelHex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return { cell: palette.nodeCell, membrane: palette.nodeMembrane, label }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
