import type { ExternalMpdLink, ExternalRmmLink } from './types'

export function normalizeExternalMpdLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function externalMpdId(diagramId: string, nodeLabel: string): string {
  return `external:${diagramId}:${normalizeExternalMpdLabel(nodeLabel)}`
}

export function externalRmmId(diagramId: string, nodeLabel: string): string {
  return `external-rmm:${diagramId}:${normalizeExternalMpdLabel(nodeLabel)}`
}

export function completeExternalMpdLink(link: Omit<ExternalMpdLink, 'id'> & { id?: string }): ExternalMpdLink {
  return {
    ...link,
    id: link.id ?? externalMpdId(link.diagramId, link.nodeLabel),
  }
}

export function completeExternalRmmLink(link: Omit<ExternalRmmLink, 'id'> & { id?: string }): ExternalRmmLink {
  return {
    ...link,
    id: link.id ?? externalRmmId(link.diagramId, link.nodeLabel),
  }
}

export function isExternalMpdId(value: string): boolean {
  return value.startsWith('external:')
}

export function isExternalRmmId(value: string): boolean {
  return value.startsWith('external-rmm:')
}
