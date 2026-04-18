/**
 * Module-level store for PixiJS layer references.
 *
 * Set by PixiScene on init, read by ModelSceneContent (or any component)
 * to imperatively sync PixiJS Graphics without needing React context nesting.
 */
import type { Container } from 'pixi.js'

let _connectionsLayer: Container | null = null
let _nodesLayer: Container | null = null
let _overlaysLayer: Container | null = null

export const pixiLayers = {
  get connections(): Container | null { return _connectionsLayer },
  get nodes(): Container | null { return _nodesLayer },
  get overlays(): Container | null { return _overlaysLayer },

  set(connections: Container, nodes: Container, overlays: Container) {
    _connectionsLayer = connections
    _nodesLayer = nodes
    _overlaysLayer = overlays
  },

  clear() {
    _connectionsLayer = null
    _nodesLayer = null
    _overlaysLayer = null
  },
}
