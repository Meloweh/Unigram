import { useHybridZoomStore } from './useHybridZoomStore'

const { getState } = useHybridZoomStore

function seedModels() {
  const s = getState()
  s.registerModel({ id: 'root', label: 'Root', nodes: [
    { id: 'node-alpha', label: 'Node Alpha', x: 50, y: 50, childModelId: 'alpha-internals' },
  ], connections: [] })
}

function resetStore() {
  useHybridZoomStore.setState({
    stack: [
      {
        modelId: 'root',
        entryNodeId: null,
        snapshot: { progress: 0, nodeProgress: 0, cameraScale: 1, nodeInflation: 0, handoffMode: 'host' as const },
        selectedNodeId: null,
        panOffset: { x: 0, y: 0 },
      },
    ],
    isPaused: false,
    isDragging: false,
    unzipPopup: null,
  })
  seedModels()
}

beforeEach(resetStore)

describe('connection unzip popup', () => {
  it('starts with no popup open', () => {
    expect(getState().unzipPopup).toBeNull()
  })

  it('openUnzip sets popup at level 1 with anchor coords', () => {
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    const popup = getState().unzipPopup
    expect(popup).not.toBeNull()
    expect(popup!.connectionKey).toBe('svc-a->svc-b')
    expect(popup!.level).toBe(1)
    expect(popup!.anchorX).toBe(45)
    expect(popup!.anchorY).toBe(22.5)
  })

  it('unzipDeeper advances level 1→2→3 and caps at 3', () => {
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    expect(getState().unzipPopup!.level).toBe(1)

    getState().unzipDeeper()
    expect(getState().unzipPopup!.level).toBe(2)

    getState().unzipDeeper()
    expect(getState().unzipPopup!.level).toBe(3)

    getState().unzipDeeper()
    expect(getState().unzipPopup!.level).toBe(3) // capped
  })

  it('unzipShallower retreats level 3→2→1→closed', () => {
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    getState().unzipDeeper()
    getState().unzipDeeper()
    expect(getState().unzipPopup!.level).toBe(3)

    getState().unzipShallower()
    expect(getState().unzipPopup!.level).toBe(2)

    getState().unzipShallower()
    expect(getState().unzipPopup!.level).toBe(1)

    getState().unzipShallower()
    expect(getState().unzipPopup).toBeNull() // closed
  })

  it('closeUnzip closes the popup', () => {
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    expect(getState().unzipPopup).not.toBeNull()

    getState().closeUnzip()
    expect(getState().unzipPopup).toBeNull()
  })

  it('selectNode closes the popup', () => {
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    expect(getState().unzipPopup).not.toBeNull()

    getState().selectNode('node-alpha')
    expect(getState().unzipPopup).toBeNull()
  })

  it('zoomIn closes the popup', () => {
    getState().selectNode('node-alpha')
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    expect(getState().unzipPopup).not.toBeNull()

    getState().zoomIn()
    expect(getState().unzipPopup).toBeNull()
  })

  it('unzipShallower with no popup is a no-op', () => {
    expect(getState().unzipPopup).toBeNull()
    getState().unzipShallower()
    expect(getState().unzipPopup).toBeNull()
  })

  it('unzipDeeper with no popup is a no-op', () => {
    expect(getState().unzipPopup).toBeNull()
    getState().unzipDeeper()
    expect(getState().unzipPopup).toBeNull()
  })

  it('opening a second connection replaces the first', () => {
    getState().openUnzip('svc-a->svc-b', 45, 22.5)
    getState().unzipDeeper()
    expect(getState().unzipPopup!.level).toBe(2)

    getState().openUnzip('db->gw', 52, 67)
    expect(getState().unzipPopup!.connectionKey).toBe('db->gw')
    expect(getState().unzipPopup!.level).toBe(1) // resets to L1
  })
})
