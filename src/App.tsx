import { useCallback, useState } from 'react'
import { OmnigramApp } from './app/OmnigramApp'
import { SocialHome } from './app/SocialHome'
import { importBundle } from './model/projectBundle'
import { useOmniStore } from './model/store'
import { DEFAULT_GRID, type Model } from './model/types'
import { SCENE_H, SCENE_W } from './scene/sceneConstants'
import {
  base64ToBlob,
  getCloudDiagram,
  getCreativeDiagram,
  type CreativeDiagramSummary,
  type DiagramDetail,
  type DiagramSummary,
} from './social/cloudClient'
import { clearSocialEdgeDrafts } from './social/graphDraft'
import { capturePublicGraphBaseline } from './social/publicGraphDraft'
import { captureTransformBaseline } from './social/transformDraft'
import './App.css'

type Route =
  | { kind: 'home' }
  | { kind: 'diagram'; id: string; title: string; topic?: string; description?: string }
  | { kind: 'creative'; id: string; title: string; sourceDiagramId: string; sourceTitle?: string }

function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' })

  const loadPublicDetail = useCallback(async (detail: DiagramDetail) => {
    const snapshot = await snapshotFromDetail(detail)
    useOmniStore.getState().loadProject(snapshot)
    clearSocialEdgeDrafts()
    capturePublicGraphBaseline(snapshot)
    captureTransformBaseline(snapshot)
    centerCameraOnOldestNode(snapshot)
    setRoute({
      kind: 'diagram',
      id: detail.id,
      title: detail.title,
      topic: detail.topic,
      description: detail.description,
    })
  }, [])

  const openDiagram = useCallback(async (diagram: DiagramSummary) => {
    await loadPublicDetail(await getCloudDiagram(diagram.id))
  }, [loadPublicDetail])

  const openPublicById = useCallback(async (id: string) => {
    await loadPublicDetail(await getCloudDiagram(id))
  }, [loadPublicDetail])

  const openCreativeDiagram = useCallback(async (diagram: CreativeDiagramSummary) => {
    const detail = await getCreativeDiagram(diagram.id)
    const snapshot = await snapshotFromDetail(detail)
    useOmniStore.getState().loadProject(snapshot)
    clearSocialEdgeDrafts()
    captureTransformBaseline(snapshot)
    centerCameraOnOldestNode(snapshot)
    setRoute({
      kind: 'creative',
      id: detail.id,
      title: detail.title,
      sourceDiagramId: detail.sourceDiagramId,
      sourceTitle: detail.sourceTitle,
    })
  }, [])

  if (route.kind === 'home') {
    return <SocialHome onOpenDiagram={openDiagram} onOpenCreativeDiagram={openCreativeDiagram} />
  }

  if (route.kind === 'creative') {
    return (
      <OmnigramApp
        mode="creative"
        creativeDiagramId={route.id}
        sourceDiagramTitle={route.sourceTitle}
        onHome={() => setRoute({ kind: 'home' })}
        onViewGraph={() => openPublicById(route.sourceDiagramId)}
        chrome={{ sidebars: true, devPanel: false, fps: true, toolbar: true }}
      />
    )
  }

  return (
    <OmnigramApp
      cloudDiagramId={route.id}
      cloudDiagramTopic={route.topic}
      cloudDiagramDescription={route.description}
      sourceDiagramTitle={route.title}
      onHome={() => setRoute({ kind: 'home' })}
      onOpenCreativeDiagram={openCreativeDiagram}
      chrome={{ sidebars: false, devPanel: false, fps: true, toolbar: false }}
    />
  )
}

async function snapshotFromDetail(detail: Pick<DiagramDetail, 'title' | 'bundleBase64'>): Promise<{ rootModelId: string; models: Map<string, Model> }> {
  return detail.bundleBase64 ? await importBundle(base64ToBlob(detail.bundleBase64)) : blankProject(detail.title)
}

function blankProject(title: string): { rootModelId: string; models: Map<string, Model> } {
  const root: Model = {
    id: 'root',
    name: title,
    nodes: new Map(),
    edges: new Map(),
    grid: DEFAULT_GRID,
  }
  return { rootModelId: root.id, models: new Map([[root.id, root]]) }
}

function centerCameraOnOldestNode(snapshot: { rootModelId: string; models: Map<string, Model> }) {
  const model = snapshot.models.get(snapshot.rootModelId)
  const oldestNode = model?.nodes.values().next().value
  if (!oldestNode) return
  useOmniStore.getState().setCamera({
    panX: -((oldestNode.x / 100) * SCENE_W),
    panY: -((oldestNode.y / 100) * SCENE_H),
    freeScale: 1,
  })
}

export default App
