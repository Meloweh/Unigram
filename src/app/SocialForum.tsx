import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { SceneRenderer } from '../scene/SceneRenderer'
import { SCENE_H, SCENE_W, type CameraTransform, type ViewportSize } from '../scene/sceneConstants'
import { useOmniStore } from '../model/store'
import type { Model, ModelNode } from '../model/types'
import {
  addForumComment,
  createForumTopic,
  getCurrentAccount,
  getForumThread,
  listActiveProposals,
  listForumTopics,
  loginAccount,
  logoutAccount,
  markProposalStatus,
  registerAccount,
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
  type GraphProposal,
  type GraphProposalAction,
  type GraphProposalPayload,
  type VoteStance,
} from '../social/forumTypes'
import {
  applyAcceptedProposal,
} from '../social/proposalApply'

interface SocialForumLayerProps {
  diagramId?: string
  projectTopic?: string
  projectDescription?: string
  renderer: SceneRenderer | null
}

export function SocialForumLayer({
  diagramId,
  projectTopic,
  projectDescription,
  renderer,
}: SocialForumLayerProps) {
  const [open, setOpen] = useState(false)
  const [forumRef, setForumRef] = useState<ForumRef>(diagramForumRef())
  const [topics, setTopics] = useState<ForumTopic[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [thread, setThread] = useState<ForumThread | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [proposals, setProposals] = useState<GraphProposal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const applyingRef = useRef(new Set<string>())
  const cameraBeforeForumRef = useRef<CameraTransform | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const postAfterAuthRef = useRef(false)
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

  useEffect(() => {
    void getCurrentAccount().then(setCurrentUser).catch(() => setCurrentUser(null))
  }, [])

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
        } catch (err) {
          console.warn('Proposal apply status update failed:', err)
        } finally {
          applyingRef.current.delete(proposal.id)
        }
      })()
    }
  }, [diagramId, proposals, refreshProposals, refreshTopics, open, revision])

  const selectForum = useCallback((next: ForumRef) => {
    setForumRef(next)
    setThreadId(null)
    setThread(null)
  }, [])

  if (!diagramId) return null

  const openForum = () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
    cameraBeforeForumRef.current = { ...useOmniStore.getState().camera }
    setClosing(false)
    const selectedRef = forumRefFromGraphSelection(model)
    if (selectedRef) setForumRef(selectedRef)
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
    if (!currentUser) {
      postAfterAuthRef.current = true
      setAuthOpen(true)
      return
    }
    setPostOpen(true)
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="social-forum-rail"
          onClick={openForum}
          aria-label="Open forum"
        >
          Forum
        </button>
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
                  }}
                />
              </>
            ) : (
              <>
                <header className="social-forum-header">
                  <div>
                    <h2>{model.name || 'Untitled graph'}</h2>
                    <p>Forum · {forumTitlePart(forumRef, model, projectTopic)}</p>
                  </div>
                  <div className="social-forum-actions">
                    <button type="button" className="social-account-button" onClick={() => setAuthOpen(true)}>
                      {currentUser ? currentUser.username : 'Log in'}
                    </button>
                    {currentUser && (
                      <button
                        type="button"
                        className="social-account-button"
                        onClick={() => void logoutAccount().then(() => setCurrentUser(null))}
                      >
                        Log out
                      </button>
                    )}
                    <button type="button" className="social-forum-post" onClick={openPost}>
                      Post
                    </button>
                  </div>
                </header>
                <div className="social-forum-top">
                  <ForumSelector
                    key={forumRef}
                    model={model}
                    forumRef={forumRef}
                    projectTopic={projectTopic}
                    projectDescription={projectDescription}
                    onSelect={selectForum}
                  />
                  <MiniDiagramPreview model={model} forumRef={forumRef} proposals={proposals} />
                </div>
                <main className="social-forum-body">
                  {error && <div className="social-forum-error">{error}</div>}
                  <TopicList
                    topics={topics}
                    loading={loading}
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
          onClose={() => setPostOpen(false)}
          onCreated={(topic) => {
            setPostOpen(false)
            selectForum(topic.forumRef)
            setThreadId(topic.id)
            setThread({ topic, comments: [] })
            setTopics([topic])
            void refreshProposals()
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
    </>
  )
}

function ForumSelector({
  model,
  forumRef,
  projectTopic,
  projectDescription,
  onSelect,
}: {
  model: Model
  forumRef: ForumRef
  projectTopic?: string
  projectDescription?: string
  onSelect: (ref: ForumRef) => void
}) {
  const nodeListId = useId()
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
  const selectedEdge = edges.find((edge) => edge.id === edgeId) ?? edges[0]

  useEffect(() => {
    if (!source) return
    if (mode === 'none') {
      const nextRef = nodeForumRef(source.id)
      useOmniStore.getState().select(source.id)
      if (nextRef !== forumRef) onSelect(nextRef)
      return
    }
    if (mode === 'arrow' && target && selectedEdge) {
      const nextRef = edgeForumRef(selectedEdge.id)
      useOmniStore.getState().selectMany([source.id, target.id], [selectedEdge.id])
      if (nextRef !== forumRef) onSelect(nextRef)
    }
  }, [source, target, mode, selectedEdge, forumRef, onSelect])

  return (
    <div className="social-ref-panel">
      <div className="social-ref-selector" aria-label="Forum reference selector">
        <input
          aria-label="Source"
          list={nodeListId}
          value={sourceValue}
          onChange={(e) => setSourceValue(e.target.value)}
          placeholder="source"
        />
        <select
          aria-label="Connection selector"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value === 'arrow' ? 'arrow' : 'none')
            setEdgeId('')
            if (e.target.value !== 'arrow') setTargetValue('')
          }}
        >
          <option value="none">no connection</option>
          <option value="arrow">→</option>
        </select>
        <input
          aria-label="Target"
          list={nodeListId}
          value={targetValue}
          onChange={(e) => {
            setTargetValue(e.target.value)
            setEdgeId('')
          }}
          placeholder="target"
          disabled={mode === 'none'}
        />
        {edges.length > 1 && (
          <select aria-label="Connection disambiguation" value={selectedEdge?.id ?? ''} onChange={(e) => setEdgeId(e.target.value)}>
            {edges.map((edge, index) => (
              <option key={edge.id} value={edge.id}>
                {edge.label || `Connection ${index + 1}`}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => onSelect(diagramForumRef())}>
          Diagram
        </button>
        <datalist id={nodeListId}>
          {nodes.map((node) => (
            <option key={node.id} value={nodeLabel(node)} />
          ))}
        </datalist>
      </div>
      <p className="social-forum-description">
        {projectDescription?.trim() || `${projectTopic?.trim() || 'Diagram'} discussion for ${model.name || 'this graph'}.`}
      </p>
    </div>
  )
}

function MiniDiagramPreview({
  model,
  forumRef,
  proposals,
}: {
  model: Model
  forumRef: ForumRef
  proposals: GraphProposal[]
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
    const renderer = new SceneRenderer({ preview: true })
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
  }, [ready, model, forumRef, proposals, selectedNodes, selectedEdges])

  return (
    <div className="social-mini-preview" aria-label="Mini diagram view">
      <div ref={hostRef} className="social-mini-render" role="img" aria-label="Selected diagram reference" />
    </div>
  )
}

function TopicList({
  topics,
  loading,
  onOpen,
}: {
  topics: ForumTopic[]
  loading: boolean
  onOpen: (topic: ForumTopic) => void
}) {
  if (loading) return <div className="social-forum-empty">Loading forum...</div>
  if (topics.length === 0) return <div className="social-forum-empty">No posts yet.</div>
  return (
    <div className="social-topic-list">
      {topics.map((topic) => (
        <button key={topic.id} type="button" className="social-topic" onClick={() => onOpen(topic)}>
          <span>
            <strong>{topic.title}</strong>
            <small>{topic.description}</small>
            <em>{topic.views} views · {topic.commentCount} comments</em>
          </span>
          <span className="social-topic-side">
            {topic.proposal && <b>{proposalActionLabel(topic.proposal)}</b>}
            {topic.proposal && <i>{Math.round(topic.agreementRatio * 100)}%</i>}
          </span>
        </button>
      ))}
    </div>
  )
}

function ThreadView({
  diagramId,
  thread,
  currentUser,
  onLoginRequired,
  onBack,
  onChanged,
}: {
  diagramId: string
  thread: ForumThread
  currentUser: AuthUser | null
  onLoginRequired: () => void
  onBack: () => void
  onChanged: () => Promise<void>
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
        <h3>{thread.topic.title}</h3>
        {thread.topic.proposal && <span>{proposalActionLabel(thread.topic.proposal)} · {Math.round(thread.topic.agreementRatio * 100)}% agreement</span>}
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
  onClose,
  onCreated,
}: {
  diagramId: string
  forumRef: ForumRef
  model: Model
  currentUser: AuthUser | null
  onClose: () => void
  onCreated: (topic: ForumTopic) => void
}) {
  const nodeListId = useId()
  const initialProposal = proposalDraftFromForumRef(model, forumRefFromGraphSelection(model) ?? forumRef)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [proposalEnabled, setProposalEnabled] = useState(false)
  const [action, setAction] = useState<GraphProposalAction>(initialProposal.action)
  const [sourceValue, setSourceValue] = useState(initialProposal.sourceValue)
  const [targetValue, setTargetValue] = useState(initialProposal.targetValue)
  const [newTargetValue, setNewTargetValue] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nodes = useMemo(() => sortedNodes(model), [model])
  const isGraphEmpty = nodes.length === 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!currentUser) {
      setError('Log in before posting')
      return
    }
    try {
      const proposal = proposalEnabled
        ? buildProposalPayload({
          action,
          model,
          nodes,
          sourceValue,
          targetValue,
          newTargetValue,
          newLabel,
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
            <select aria-label="Suggested action" value={action} onChange={(e) => setAction(e.target.value as GraphProposalAction)}>
              {isGraphEmpty ? (
                <option value="add-node">Add Node</option>
              ) : (
                <>
                  <option value="add-node">Add Node</option>
                  <option value="add-node-edge">Add node and connection</option>
                  <option value="add-edge">Add connection</option>
                  <option value="remove-edge">Remove connection</option>
                  <option value="remove-node">Remove node</option>
                  <option value="rename-node">Rename node</option>
                  <option value="rename-edge">Rename connection</option>
                  <option value="rewire-edge">Rewire connection</option>
                </>
              )}
            </select>
            {action !== 'add-node' && (
              <div className="social-ref-selector compact">
                <input list={nodeListId} value={sourceValue} onChange={(e) => setSourceValue(e.target.value)} placeholder="source" aria-label="Proposal source node" />
                <span className="social-action-icon" aria-label={proposalActionLabel({ action })} title={proposalActionLabel({ action })}>
                  {proposalActionIcon(action)}
                </span>
                <input
                  {...(action === 'add-node-edge' ? {} : { list: nodeListId })}
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder={action === 'add-node-edge' ? 'new target' : 'target'}
                  aria-label="Proposal target node"
                  disabled={action === 'remove-node' || action === 'rename-node'}
                />
              </div>
            )}
            {(action === 'add-node' || action === 'rename-node' || action === 'rename-edge') && (
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="new name" aria-label="New name" />
            )}
            {action === 'rewire-edge' && (
              <input list={nodeListId} value={newTargetValue} onChange={(e) => setNewTargetValue(e.target.value)} placeholder="new target" aria-label="New target node" />
            )}
            <datalist id={nodeListId}>
              {nodes.map((node) => (
                <option key={node.id} value={nodeLabel(node)} />
              ))}
            </datalist>
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
    setBusy(true)
    try {
      const result = mode === 'login'
        ? await loginAccount(username, password)
        : await registerAccount(username, password)
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

function buildProposalPayload(input: {
  action: GraphProposalAction
  model: Model
  nodes: ModelNode[]
  sourceValue: string
  targetValue: string
  newTargetValue: string
  newLabel: string
}): GraphProposalPayload {
  const source = resolveNodeInput(input.sourceValue, input.nodes)
  const target = resolveNodeInput(input.targetValue, input.nodes)
  const nextTarget = resolveNodeInput(input.newTargetValue, input.nodes)
  const edge = source && target ? findEdgeBetween(input.model, source.id, target.id) : null
  const cleanLabel = input.newLabel.trim()
  switch (input.action) {
    case 'add-node':
      if (!cleanLabel) throw new Error('Name the new node')
      return { action: input.action, newNodeLabel: cleanLabel }
    case 'add-node-edge':
      if (!source) throw new Error('Choose an existing source node')
      if (!input.targetValue.trim()) throw new Error('Name the new target node')
      return { action: input.action, sourceNodeId: source.id, newNodeLabel: input.targetValue.trim() }
    case 'add-edge':
      if (!source || !target) throw new Error('Choose source and target nodes')
      return { action: input.action, sourceNodeId: source.id, targetNodeId: target.id }
    case 'remove-edge':
      if (!edge) throw new Error('Choose an existing connection')
      return { action: input.action, edgeId: edge.id }
    case 'remove-node':
      if (!source) throw new Error('Choose the node to remove')
      return { action: input.action, nodeId: source.id }
    case 'rename-node':
      if (!source) throw new Error('Choose the node to rename')
      if (!cleanLabel) throw new Error('Enter the new node name')
      return { action: input.action, nodeId: source.id, nextLabel: cleanLabel }
    case 'rename-edge':
      if (!edge) throw new Error('Choose an existing connection')
      if (!cleanLabel) throw new Error('Enter the new connection name')
      return { action: input.action, edgeId: edge.id, nextLabel: cleanLabel }
    case 'rewire-edge':
      if (!edge) throw new Error('Choose an existing connection')
      if (!nextTarget) throw new Error('Choose the new target node')
      return { action: input.action, edgeId: edge.id, nextTargetNodeId: nextTarget.id }
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
  const edgeId = store.selectedEdgeIds.values().next().value as string | undefined
  if (edgeId && model.edges.has(edgeId)) return edgeForumRef(edgeId)
  const nodeId = store.selectedIds.values().next().value as string | undefined
  if (nodeId && model.nodes.has(nodeId)) return nodeForumRef(nodeId)
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
    case 'remove-edge': return '✕'
    case 'remove-node': return '−'
    case 'rename-node': return 'Aa'
    case 'rename-edge': return 'Aa'
    case 'rewire-edge': return '↪'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
