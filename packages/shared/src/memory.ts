/**
 * Layered memory shared by every session of a user.
 * Long-term memory follows the user. Workspace memory follows a workspace directory.
 */

export type LayeredMemoryLayer = 'long_term' | 'workspace'

export type LongTermMemoryType = 'preference' | 'code_style'
export type WorkspaceMemoryType = 'convention' | 'decision'
export type LayeredMemoryType = LongTermMemoryType | WorkspaceMemoryType

export type LayeredMemorySourceType = 'user' | 'agent' | 'blackboard'
export type LayeredMemoryStatus = 'active' | 'stale' | 'deprecated'

export interface LayeredMemoryItem {
  id: string
  layer: LayeredMemoryLayer
  type: LayeredMemoryType
  /** Canonical workspace path. Null for long-term memory. */
  workspaceKey: string | null
  content: string
  sourceType: LayeredMemorySourceType
  sourceRef: string | null
  status: LayeredMemoryStatus
  createdAt: string
  lastUsedAt: string | null
}

export interface CreateLayeredMemoryPayload {
  layer: LayeredMemoryLayer
  type: LayeredMemoryType
  content: string
  /** Required when layer is workspace. Server resolves it to a workspace key. */
  workspaceDir?: string | null
}

export interface ListLayeredMemoryQuery {
  layer?: LayeredMemoryLayer
  workspaceDir?: string
}
