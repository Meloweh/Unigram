import { useCallback, useState } from 'react'
import { OmnigramApp } from './app/OmnigramApp'
import { SocialHome } from './app/SocialHome'
import { importBundle } from './model/projectBundle'
import { useOmniStore } from './model/store'
import type { Model } from './model/types'
import { base64ToBlob, getCloudDiagram, type DiagramSummary } from './social/cloudClient'
import './App.css'

type Route =
  | { kind: 'home' }
  | { kind: 'diagram'; id: string; title: string }

function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' })

  const openDiagram = useCallback(async (diagram: DiagramSummary) => {
    const detail = await getCloudDiagram(diagram.id)
    if (detail.bundleBase64) {
      const snapshot = await importBundle(base64ToBlob(detail.bundleBase64))
      useOmniStore.getState().loadProject(snapshot)
    } else {
      useOmniStore.getState().loadProject(blankProject(detail.title))
    }
    setRoute({ kind: 'diagram', id: detail.id, title: detail.title })
  }, [])

  if (route.kind === 'home') return <SocialHome onOpenDiagram={openDiagram} />

  return (
    <OmnigramApp
      cloudDiagramId={route.id}
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

export default App
