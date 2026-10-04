export type GroupIssueStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled'

export type GroupIssueAssigneeType = 'agent' | 'orchestrator'
export type GroupIssueAuthorRole = 'user' | 'agent' | 'orchestrator' | 'system'

export interface GroupIssueAssignee {
  type: GroupIssueAssigneeType
  id: string | null
}

export interface GroupIssueCommentView {
  id: string
  issueId: string
  groupChatId: string
  authorRole: GroupIssueAuthorRole
  authorAgentId: string | null
  authorUserId: string | null
  body: string
  mentions: string[]
  runId: string | null
  createdAt: string
}

export interface GroupIssueView {
  id: string
  groupChatId: string
  title: string
  description: string | null
  status: GroupIssueStatus
  assigneeType: GroupIssueAssigneeType | null
  assigneeId: string | null
  blockedReason: string | null
  lastRunId: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
  comments: GroupIssueCommentView[]
  activeRunId: string | null
}

export interface CreateGroupIssuePayload {
  title: string
  description?: string | null
  assigneeType?: GroupIssueAssigneeType
  assigneeId?: string
}

export interface UpdateGroupIssuePayload {
  title?: string
  description?: string | null
  assigneeType?: GroupIssueAssigneeType | null
  assigneeId?: string | null
  status?: GroupIssueStatus
  blockedReason?: string | null
}

export interface CreateGroupIssueCommentPayload {
  body: string
  mentions?: string[]
}

export type GroupIssueAction =
  | { type: 'comment_issue'; body: string; mentions?: string[] }
  | { type: 'assign_issue'; assigneeType: GroupIssueAssigneeType; assigneeId?: string | null }
  | { type: 'transition_issue'; status: Exclude<GroupIssueStatus, 'done' | 'cancelled'>; reason?: string }
  | { type: 'request_user'; body: string }

