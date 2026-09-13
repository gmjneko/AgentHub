import type { BlackboardArtifact, BlackboardDecisionStatus } from '../api'

const HIDDEN_ARTIFACT_DIRS = new Set(['.codex', '.agents', '.claude'])

export function shouldShowBlackboardArtifact(artifact: BlackboardArtifact): boolean {
  return !artifact.path.split(/[\\/]+/).some((segment) => HIDDEN_ARTIFACT_DIRS.has(segment))
}

const DECISION_STATUS_LABELS: Record<BlackboardDecisionStatus, string> = {
  proposed: '提议',
  approved: '已批准',
  superseded: '已替代',
  rejected: '已拒绝'
}

const DECISION_STATUS_TONES: Record<BlackboardDecisionStatus, string> = {
  proposed: 'bg-warning-soft text-warning',
  approved: 'bg-success-soft text-success',
  superseded: 'bg-gray-100 text-gray-500',
  rejected: 'bg-danger-soft text-danger'
}

export function decisionStatusLabel(status: BlackboardDecisionStatus): string {
  return DECISION_STATUS_LABELS[status]
}

export function decisionStatusTone(status: BlackboardDecisionStatus): string {
  return DECISION_STATUS_TONES[status]
}
