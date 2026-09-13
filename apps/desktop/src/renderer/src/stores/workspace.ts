import { reactive } from 'vue'
import type { ChatSummary, GroupMemberView } from '../api'

export type WorkspaceNavKey = 'workspace' | 'agents' | 'settings'

export type WorkspaceSessionItem = ChatSummary & {
  pinned: boolean
  archived: boolean
  running?: boolean
  updatedAt?: string
  groupMembers?: GroupMemberView[]
}

export const SIDEBAR_WIDTH_STORAGE_KEY = 'agenthub:chat-list-width'
export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_DEFAULT_WIDTH = 280
export const SIDEBAR_MAX_WIDTH = 420

export interface WorkspaceSessionHandlers {
  select: (key: string) => void
  pin: (session: WorkspaceSessionItem) => void
  archive: (session: WorkspaceSessionItem) => void
  delete: (session: WorkspaceSessionItem) => void
}

interface WorkspaceState {
  nav: WorkspaceNavKey
  sessions: WorkspaceSessionItem[]
  sessionsLoading: boolean
  activeSessionKey: string | null
  searchQuery: string
  sidebarWidth: number
  createChatSignal: number
  createGroupSignal: number
}

function readStoredWidth(): number {
  try {
    const raw = globalThis.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    const value = raw ? Number(raw) : Number.NaN
    return Number.isFinite(value) ? value : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

export const workspaceState = reactive<WorkspaceState>({
  nav: 'workspace',
  sessions: [],
  sessionsLoading: false,
  activeSessionKey: null,
  searchQuery: '',
  sidebarWidth: readStoredWidth(),
  createChatSignal: 0,
  createGroupSignal: 0
})

let sessionHandlers: WorkspaceSessionHandlers | null = null

export function registerWorkspaceHandlers(handlers: WorkspaceSessionHandlers | null): void {
  sessionHandlers = handlers
}

export function resetWorkspaceState(): void {
  workspaceState.nav = 'workspace'
  workspaceState.sessions = []
  workspaceState.sessionsLoading = false
  workspaceState.activeSessionKey = null
  workspaceState.searchQuery = ''
  workspaceState.createChatSignal = 0
  workspaceState.createGroupSignal = 0
  sessionHandlers = null
}

export function setWorkspaceNav(nav: WorkspaceNavKey): void {
  workspaceState.nav = nav
}

export function setWorkspaceSessions(
  sessions: WorkspaceSessionItem[],
  loading: boolean
): void {
  workspaceState.sessions = sessions
  workspaceState.sessionsLoading = loading
}

export function setActiveSessionKey(key: string | null): void {
  workspaceState.activeSessionKey = key
}

export function setSidebarWidth(width: number): void {
  workspaceState.sidebarWidth = width
  try {
    globalThis.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    /* storage may be unavailable */
  }
}

export function requestCreateChat(): void {
  workspaceState.nav = 'workspace'
  workspaceState.createChatSignal += 1
}

export function requestCreateGroup(): void {
  workspaceState.nav = 'workspace'
  workspaceState.createGroupSignal += 1
}

export function selectWorkspaceSession(key: string): void {
  workspaceState.nav = 'workspace'
  if (sessionHandlers) sessionHandlers.select(key)
  else workspaceState.activeSessionKey = key
}

export function pinWorkspaceSession(session: WorkspaceSessionItem): void {
  sessionHandlers?.pin(session)
}

export function archiveWorkspaceSession(session: WorkspaceSessionItem): void {
  sessionHandlers?.archive(session)
}

export function deleteWorkspaceSession(session: WorkspaceSessionItem): void {
  sessionHandlers?.delete(session)
}
