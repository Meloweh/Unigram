import { describe, expect, it } from 'vitest'
import {
  computeAgreementRatio,
  diagramForumRef,
  edgeForumRef,
  nodeForumRef,
  parseForumRef,
  proposalActionLabel,
  proposalContainsAction,
  proposalSteps,
  resolveExpiredProposalStatus,
  type ForumComment,
  type GraphProposal,
} from './forumTypes'

describe('forumTypes', () => {
  it('encodes and parses forum references', () => {
    expect(diagramForumRef()).toBe('diagram')
    expect(nodeForumRef('a')).toBe('node:a')
    expect(edgeForumRef('e')).toBe('edge:e')
    expect(parseForumRef('diagram')).toBe('diagram')
    expect(parseForumRef('node:a')).toBe('node:a')
    expect(parseForumRef('edge:e')).toBe('edge:e')
    expect(parseForumRef('bad')).toBeNull()
  })

  it('counts each author latest stanced comment for agreement ratio', () => {
    const comments: Pick<ForumComment, 'author' | 'stance'>[] = [
      { author: 'Ada', stance: 'agree' },
      { author: 'Linus', stance: 'disagree' },
      { author: 'Ada', stance: 'disagree' },
      { author: 'Grace', stance: 'neutral' },
    ]
    expect(computeAgreementRatio(comments)).toBe(0)
    expect(computeAgreementRatio([...comments, { author: 'Grace', stance: 'agree' }])).toBeCloseTo(1 / 3)
    expect(computeAgreementRatio([...comments, { author: 'Ada', stance: 'neutral' }])).toBe(0)
  })

  it('expires proposals using the one-third acceptance threshold', () => {
    const base: Pick<GraphProposal, 'status' | 'expiresAt'> = {
      status: 'pending',
      expiresAt: new Date(1000).toISOString(),
    }
    expect(resolveExpiredProposalStatus(base, 0.32, 2000)).toBe('stale')
    expect(resolveExpiredProposalStatus(base, 1 / 3, 2000)).toBe('accepted')
    expect(resolveExpiredProposalStatus({ ...base, expiresAt: new Date(3000).toISOString() }, 1, 2000)).toBe('pending')
  })

  it('labels proposal actions for badges', () => {
    expect(proposalActionLabel({ action: 'add-node' })).toBe('Add node')
    expect(proposalActionLabel({ action: 'add-node-edge' })).toBe('Add node')
    expect(proposalActionLabel({ action: 'add-rmm' })).toBe('Add RMM')
    expect(proposalActionLabel({ action: 'add-mpd' })).toBe('Add MPD')
    expect(proposalActionLabel({ action: 'rewire-edge' })).toBe('Rewire connection')
    expect(proposalActionLabel({ action: 'commit-transform' })).toBe('Commit transform')
    expect(proposalActionLabel({ action: 'add-reference' })).toBe('Add reference')
    expect(proposalActionLabel({ action: 'chain' })).toBe('Change chain')
  })

  it('flattens legacy single proposals and chained proposals', () => {
    const single = { action: 'add-node' as const, newNodeLabel: 'Solo' }
    const chain = {
      action: 'chain' as const,
      steps: [
        single,
        { action: 'commit-transform' as const, transforms: [] },
      ],
    }
    expect(proposalSteps(single)).toEqual([single])
    expect(proposalSteps(chain)).toEqual(chain.steps)
    expect(proposalContainsAction(chain, 'commit-transform')).toBe(true)
    expect(proposalContainsAction(chain, 'add-edge')).toBe(false)
  })
})
