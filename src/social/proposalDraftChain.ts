import type { Model } from '../model/types'
import type { GraphProposalStep, TransformProposalEntry } from './forumTypes'
import type { SocialEdgeDraft } from './graphDraft'

export function buildGraphDraftSteps(
  model: Model,
  transforms: readonly TransformProposalEntry[],
  edgeDrafts: readonly SocialEdgeDraft[],
): GraphProposalStep[] {
  const edgeSteps: GraphProposalStep[] = []
  for (const draft of edgeDrafts) {
    const edge = model.edges.get(draft.edgeId)
    if (!edge) continue
    edgeSteps.push({
      action: 'add-edge',
      edgeId: edge.id,
      sourceNodeId: edge.from,
      targetNodeId: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.references && edge.references.length > 0
        ? { references: edge.references.map((ref) => ({ ...ref })) }
        : {}),
      style: {
        kind: edge.kind,
        dash: edge.dash,
        arrowStyle: edge.arrowStyle,
        color: edge.color,
        width: edge.width,
        labelFontSize: edge.labelFontSize,
        cameraTracked: edge.cameraTracked,
      },
    })
  }
  return [
    ...edgeSteps,
    ...(transforms.length > 0 ? [{ action: 'commit-transform' as const, transforms: transforms.map((entry) => ({ ...entry })) }] : []),
  ]
}
