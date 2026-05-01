import type { Model, ModelNode, NodeShape, MediaNodeType, CosmeticType } from '../model/sampleModels'
import { snapToGrid } from '../model/useHybridZoomStore'
import { storeMediaBlob } from '../model/mediaStore'

/** Detect the media node type from a MIME type */
export function mimeToMediaType(mime: string): MediaNodeType | null {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return null
}

export function handleDragOver(e: React.DragEvent) {
  if (
    e.dataTransfer.types.includes('application/unigram-shape') ||
    e.dataTransfer.types.includes('application/unigram-media-type') ||
    e.dataTransfer.types.includes('application/unigram-cosmetic-type') ||
    e.dataTransfer.types.includes('Files')
  ) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

export interface DropHandlerDeps {
  model: Model
  frameModelId: string
  addNode: (modelId: string, node: Partial<ModelNode>) => void
  selectNode: (nodeId: string) => void
  updateNodeProps: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  clientToScene: (clientX: number, clientY: number) => { x: number; y: number }
  setEditingNodeId: (id: string | null) => void
  setEditingContentNodeId: (id: string | null) => void
  endDrag: () => void
  lastPointer: React.MutableRefObject<{ x: number; y: number } | null>
}

export function handleDrop(e: React.DragEvent, deps: DropHandlerDeps) {
  const {
    model, frameModelId, addNode, selectNode, updateNodeProps,
    clientToScene, setEditingNodeId, setEditingContentNodeId, endDrag, lastPointer,
  } = deps

  // 1) Shape from sidebar
  const shapeId = e.dataTransfer.getData('application/unigram-shape')
  if (shapeId) {
    e.preventDefault()
    endDrag()
    lastPointer.current = null
    const pos = clientToScene(e.clientX, e.clientY)
    const snappedX = snapToGrid(pos.x)
    const snappedY = snapToGrid(pos.y)
    const newId = `node-${Date.now()}`
    addNode(frameModelId, {
      id: newId, label: '', x: snappedX, y: snappedY,
      shape: shapeId as NodeShape,
    })
    selectNode(newId)
    setEditingNodeId(newId)
    return
  }

  // 2) Media type node from sidebar (empty media node)
  const mediaTypeId = e.dataTransfer.getData('application/unigram-media-type')
  if (mediaTypeId) {
    e.preventDefault()
    endDrag()
    lastPointer.current = null
    const pos = clientToScene(e.clientX, e.clientY)
    const snappedX = snapToGrid(pos.x)
    const snappedY = snapToGrid(pos.y)
    const newId = `node-${Date.now()}`
    const defaultSizes: Record<string, { w: number; h: number }> = {
      image: { w: 160, h: 120 },
      gif: { w: 160, h: 120 },
      audio: { w: 200, h: 80 },
      video: { w: 200, h: 140 },
      markdown: { w: 240, h: 60 },
      math: { w: 200, h: 60 },
    }
    const sz = defaultSizes[mediaTypeId] ?? { w: 160, h: 120 }
    const isContentType = mediaTypeId === 'markdown' || mediaTypeId === 'math'
    addNode(frameModelId, {
      id: newId, label: isContentType ? (mediaTypeId === 'markdown' ? 'Markdown' : 'Math') : '', x: snappedX, y: snappedY,
      shape: 'rounded-rect',
      mediaType: mediaTypeId as MediaNodeType,
      nodeWidth: sz.w, nodeHeight: sz.h,
      ...(isContentType ? { contentSource: '', contentCollapsed: true } : {}),
    })
    selectNode(newId)
    if (isContentType) {
      setEditingContentNodeId(newId)
    }
    return
  }

  // 2b) Cosmetic node from sidebar
  const cosmeticTypeId = e.dataTransfer.getData('application/unigram-cosmetic-type')
  if (cosmeticTypeId) {
    e.preventDefault()
    endDrag()
    lastPointer.current = null
    const pos = clientToScene(e.clientX, e.clientY)
    const snappedX = snapToGrid(pos.x)
    const snappedY = snapToGrid(pos.y)
    const newId = `node-${Date.now()}`
    addNode(frameModelId, {
      id: newId, label: '', x: snappedX, y: snappedY,
      shape: 'rounded-rect',
      cosmeticType: cosmeticTypeId as CosmeticType,
      tipAngle: Math.PI * 0.75,
      nodeWidth: 180, nodeHeight: 100,
    })
    selectNode(newId)
    setEditingNodeId(newId)
    return
  }

  // 3) File drop from OS — either onto empty scene or onto existing media node
  const files = e.dataTransfer.files
  if (files.length > 0) {
    const file = files[0]
    const mType = mimeToMediaType(file.type)
    if (!mType) return
    e.preventDefault()
    endDrag()
    lastPointer.current = null

    // Check if dropped on an existing media node
    const target = e.target as HTMLElement
    const hostNode = target.closest('.host-node')
    const hostNodeId = hostNode?.getAttribute('data-node-id')
    const existingNode = hostNodeId
      ? model.nodes.find((n) => n.id === hostNodeId && n.mediaType)
      : undefined

    const blobUrl = storeMediaBlob(file)
    if (existingNode) {
      // Image dropped on an audio node → set as cover image instead of replacing media
      if (existingNode.mediaType === 'audio' && (mType === 'image' || mType === 'gif')) {
        updateNodeProps(frameModelId, existingNode.id, {
          audioCoverSrc: blobUrl,
        })
        const img = new Image()
        img.onload = () => {
          const maxW = 400, maxH = 400
          let w = img.naturalWidth, h = img.naturalHeight + 40 // extra height for audio controls
          if (w > maxW || h > maxH) {
            const ratio = Math.min(maxW / w, maxH / h)
            w = Math.round(w * ratio)
            h = Math.round(h * ratio)
          }
          w = Math.max(w, 100)
          h = Math.max(h, 80)
          updateNodeProps(frameModelId, existingNode.id, {
            nodeWidth: w, nodeHeight: h,
          })
        }
        img.src = blobUrl
      } else {
        // Drop onto existing media node — replace its media and auto-size for images/gifs/video
        updateNodeProps(frameModelId, existingNode.id, {
          mediaSrc: blobUrl,
          mediaFileName: file.name,
        })
        if (mType === 'image' || mType === 'gif') {
          const img = new Image()
          img.onload = () => {
            const maxW = 400, maxH = 400
            let w = img.naturalWidth, h = img.naturalHeight
            if (w > maxW || h > maxH) {
              const ratio = Math.min(maxW / w, maxH / h)
              w = Math.round(w * ratio)
              h = Math.round(h * ratio)
            }
            w = Math.max(w, 60)
            h = Math.max(h, 40)
            updateNodeProps(frameModelId, existingNode.id, {
              nodeWidth: w, nodeHeight: h,
            })
          }
          img.src = blobUrl
        } else if (mType === 'video') {
          const vid = document.createElement('video')
          vid.onloadedmetadata = () => {
            const maxW = 400, maxH = 400
            let w = vid.videoWidth, h = vid.videoHeight
            if (w > maxW || h > maxH) {
              const ratio = Math.min(maxW / w, maxH / h)
              w = Math.round(w * ratio)
              h = Math.round(h * ratio)
            }
            w = Math.max(w, 100)
            h = Math.max(h, 80)
            updateNodeProps(frameModelId, existingNode.id, {
              nodeWidth: w, nodeHeight: h,
            })
          }
          vid.src = blobUrl
        }
      }
    } else {
      // Drop onto empty scene — create a new media node
      const pos = clientToScene(e.clientX, e.clientY)
      const snappedX = snapToGrid(pos.x)
      const snappedY = snapToGrid(pos.y)
      const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const defaultSizes: Record<string, { w: number; h: number }> = {
        image: { w: 160, h: 120 },
        gif: { w: 160, h: 120 },
        audio: { w: 200, h: 80 },
        video: { w: 200, h: 140 },
        markdown: { w: 240, h: 60 },
        math: { w: 200, h: 60 },
      }
      const sz = defaultSizes[mType] ?? { w: 160, h: 120 }
      addNode(frameModelId, {
        id: newId, label: '', x: snappedX, y: snappedY,
        shape: 'rounded-rect',
        mediaType: mType,
        mediaSrc: blobUrl,
        mediaFileName: file.name,
        nodeWidth: sz.w, nodeHeight: sz.h,
      })
      selectNode(newId)
      // Auto-size to image/video natural dimensions
      if (mType === 'image' || mType === 'gif') {
        const img = new Image()
        img.onload = () => {
          const maxW = 400, maxH = 400
          let w = img.naturalWidth, h = img.naturalHeight
          if (w > maxW || h > maxH) {
            const ratio = Math.min(maxW / w, maxH / h)
            w = Math.round(w * ratio)
            h = Math.round(h * ratio)
          }
          w = Math.max(w, 60)
          h = Math.max(h, 40)
          updateNodeProps(frameModelId, newId, { nodeWidth: w, nodeHeight: h })
        }
        img.src = blobUrl
      } else if (mType === 'video') {
        const vid = document.createElement('video')
        vid.onloadedmetadata = () => {
          const maxW = 400, maxH = 400
          let w = vid.videoWidth, h = vid.videoHeight
          if (w > maxW || h > maxH) {
            const ratio = Math.min(maxW / w, maxH / h)
            w = Math.round(w * ratio)
            h = Math.round(h * ratio)
          }
          w = Math.max(w, 100)
          h = Math.max(h, 80)
          updateNodeProps(frameModelId, newId, { nodeWidth: w, nodeHeight: h })
        }
        vid.src = blobUrl
      }
    }
    return
  }
}
