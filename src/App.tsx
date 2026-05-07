import { useCallback, useState } from 'react'
import { OmnigramApp } from './app/OmnigramApp'
import { SocialHome } from './app/SocialHome'
import { importBundle } from './model/projectBundle'
import { useOmniStore } from './model/store'
import type { Model } from './model/types'
import { SCENE_H, SCENE_W } from './scene/sceneConstants'
import { base64ToBlob, getCloudDiagram, type DiagramSummary } from './social/cloudClient'
import './App.css'

type Route =
  | { kind: 'home' }
  | { kind: 'diagram'; id: string; title: string; topic?: string; description?: string }

function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' })

  const openDiagram = useCallback(async (diagram: DiagramSummary) => {
    const detail = await getCloudDiagram(diagram.id)
    let snapshot: { rootModelId: string; models: Map<string, Model> }
    if (detail.bundleBase64) {
      snapshot = await importBundle(base64ToBlob(detail.bundleBase64))
    } else {
      snapshot = blankProject(detail.title)
    }
    useOmniStore.getState().loadProject(snapshot)
    centerCameraOnOldestNode(snapshot)
    setRoute({
      kind: 'diagram',
      id: detail.id,
      title: detail.title,
      topic: detail.topic,
      description: detail.description,
    })
  }, [])

  if (route.kind === 'home') return <SocialHome onOpenDiagram={openDiagram} />

  return (
    <OmnigramApp
      cloudDiagramId={route.id}
      cloudDiagramTopic={route.topic}
      cloudDiagramDescription={route.description}
      onHome={() => setRoute({ kind: 'home' })}
      chrome={{ sidebars: false, devPanel: false, fps: true, toolbar: false }}
    />
  )
}

function blankProject(title: string): { rootModelId: string; models: Map<string, Model> } {
  const root: Model = {
    id: 'root',
    name: title,
    nodes: new Map(),
    edges: new Map(),
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
