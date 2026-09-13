<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { UserView } from '@agenthub/shared'
import { avatarTextColor } from '../utils/avatar'
import { formatTime } from '../utils/format'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  archiveWorkspaceSession,
  deleteWorkspaceSession,
  pinWorkspaceSession,
  requestCreateChat,
  requestCreateGroup,
  selectWorkspaceSession,
  setSidebarWidth,
  setWorkspaceNav,
  workspaceState,
  type WorkspaceNavKey,
  type WorkspaceSessionItem
} from '../stores/workspace'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import GroupAvatar from './GroupAvatar.vue'
import UserMenu from './UserMenu.vue'
import BaseSkeleton from './ui/BaseSkeleton.vue'

defineProps<{ user: UserView | null }>()

const MIN_MAIN_WIDTH = 420
const MIN_INSPECTOR_WIDTH = 260

const createMenuOpen = ref(false)
const groupsOpen = ref(true)
const agentsOpen = ref(true)
const chatMenuOpen = ref(false)
const chatMenuX = ref(0)
const chatMenuY = ref(0)
const chatMenuTarget = ref<WorkspaceSessionItem | null>(null)
const resizing = ref(false)

let dragStartX = 0
let dragStartWidth = 0
let previousBodyCursor = ''
let previousBodyUserSelect = ''

const groupSessions = computed(() =>
  workspaceState.sessions.filter((session) => session.kind === 'group')
)
const agentSessions = computed(() =>
  workspaceState.sessions.filter((session) => session.kind === 'agent')
)

const chatMenuItems = computed<MenuItem[]>(() => {
  const chat = chatMenuTarget.value
  return [
    {
      id: 'toggle-pin',
      label: chat?.pinned ? '取消置顶' : '置顶',
      icon: chat?.pinned ? 'keep_off' : 'keep'
    },
    {
      id: 'toggle-archive',
      label: chat?.archived ? '取消归档' : '归档',
      icon: chat?.archived ? 'unarchive' : 'archive'
    },
    { id: 'delete', label: '删除', icon: 'delete' }
  ]
})

function maxSidebarWidth(): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - MIN_MAIN_WIDTH - MIN_INSPECTOR_WIDTH)
  )
}

function clampSidebarWidth(value: number): number {
  return Math.min(Math.max(value, SIDEBAR_MIN_WIDTH), maxSidebarWidth())
}

function normalizeSidebarWidth(): void {
  const next = clampSidebarWidth(workspaceState.sidebarWidth)
  if (next !== workspaceState.sidebarWidth) setSidebarWidth(next)
}

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  resizing.value = true
  dragStartX = event.clientX
  dragStartWidth = workspaceState.sidebarWidth
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize, { once: true })
}

function onResizeMove(event: PointerEvent): void {
  if (!resizing.value) return
  setSidebarWidth(clampSidebarWidth(dragStartWidth + event.clientX - dragStartX))
}

function stopResize(): void {
  if (!resizing.value) return
  resizing.value = false
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
  window.removeEventListener('pointermove', onResizeMove)
  setSidebarWidth(clampSidebarWidth(workspaceState.sidebarWidth))
}

function onCreateChat(): void {
  createMenuOpen.value = false
  requestCreateChat()
}

function onCreateGroupChat(): void {
  createMenuOpen.value = false
  requestCreateGroup()
}

function openChatMenu(event: MouseEvent, chat: WorkspaceSessionItem): void {
  event.preventDefault()
  createMenuOpen.value = false
  chatMenuTarget.value = chat
  chatMenuX.value = event.clientX
  chatMenuY.value = event.clientY
  chatMenuOpen.value = true
}

function closeChatMenu(): void {
  chatMenuOpen.value = false
  chatMenuTarget.value = null
}

function onChatMenuSelect(id: string): void {
  const chat = chatMenuTarget.value
  if (!chat) return
  if (id === 'toggle-pin') pinWorkspaceSession(chat)
  else if (id === 'toggle-archive') archiveWorkspaceSession(chat)
  else if (id === 'delete') deleteWorkspaceSession(chat)
}

function go(nav: WorkspaceNavKey): void {
  setWorkspaceNav(nav)
}

function onGlobalMouseDown(event: MouseEvent): void {
  if (!createMenuOpen.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-create-chat-menu]')) return
  createMenuOpen.value = false
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    createMenuOpen.value = false
    closeChatMenu()
  }
}

onMounted(() => {
  normalizeSidebarWidth()
  window.addEventListener('resize', normalizeSidebarWidth)
  window.addEventListener('mousedown', onGlobalMouseDown, true)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', normalizeSidebarWidth)
  window.removeEventListener('mousedown', onGlobalMouseDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', onResizeMove)
})
</script>

<template>
  <aside
    class="relative z-20 flex h-full flex-shrink-0 flex-col border-r border-surface-border bg-surface"
    :style="{ width: `${workspaceState.sidebarWidth}px` }"
  >
    <div class="flex items-center gap-3 px-3.5 pb-1 pt-3.5">
      <UserMenu :user="user" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-md font-semibold tracking-tight text-text-main">AgentHub</div>
        <div class="truncate text-xs text-text-muted">
          {{ user?.nickname?.trim() || user?.account || '工作台' }}
        </div>
      </div>
    </div>

    <div class="px-3 pt-3">
      <div class="relative" data-create-chat-menu>
        <button
          type="button"
          class="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-text-main text-sm font-medium text-white transition-colors hover:bg-gray-600"
          @click="createMenuOpen = !createMenuOpen"
        >
          <span class="material-symbols-outlined text-xl">add</span>
          新建
        </button>
        <Transition name="pop">
          <div
            v-if="createMenuOpen"
            class="absolute left-0 right-0 top-11 z-30 rounded-md border border-gray-150 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-md font-medium text-text-main transition-colors hover:bg-surface-hover"
              @click="onCreateChat"
            >
              <span class="material-symbols-outlined text-2xl">chat</span>
              <span>创建单聊</span>
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-md font-medium text-text-main transition-colors hover:bg-surface-hover"
              @click="onCreateGroupChat"
            >
              <span class="material-symbols-outlined text-2xl">groups</span>
              <span>创建群聊</span>
            </button>
          </div>
        </Transition>
      </div>

      <div class="relative mt-2.5">
        <span
          class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-2xl text-text-muted"
        >
          search
        </span>
        <input
          class="h-8 w-full rounded border border-transparent bg-surface-hover pl-8 pr-3 text-md leading-none transition-all placeholder:text-text-muted focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="搜索会话"
          type="text"
          :value="workspaceState.searchQuery"
          @input="workspaceState.searchQuery = ($event.target as HTMLInputElement).value"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
      <div v-if="workspaceState.sessionsLoading" class="space-y-4 px-1">
        <div v-for="section in 2" :key="section" class="space-y-1.5">
          <BaseSkeleton class="ml-2 h-3 w-12" />
          <div v-for="i in 3" :key="i" class="flex items-center gap-2.5 px-2 py-1.5">
            <BaseSkeleton class="h-7 w-7 flex-shrink-0" />
            <BaseSkeleton class="h-3 flex-1" />
          </div>
        </div>
      </div>

      <template v-else>
        <section class="mb-3">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-muted"
            @click="groupsOpen = !groupsOpen"
          >
            <span
              class="material-symbols-outlined text-lg transition-transform duration-150"
              :class="groupsOpen ? 'rotate-90' : ''"
            >
              chevron_right
            </span>
            群聊
            <span class="ml-auto font-medium normal-case tracking-normal">{{
              groupSessions.length
            }}</span>
          </button>
          <div v-if="groupsOpen" class="mt-0.5">
            <p
              v-if="groupSessions.length === 0"
              class="px-2.5 py-2 text-sm text-text-muted"
            >
              还没有群聊
            </p>
            <button
              v-for="chat in groupSessions"
              :key="chat.id"
              type="button"
              class="mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors"
              :class="[
                chat.id === workspaceState.activeSessionKey && workspaceState.nav === 'workspace'
                  ? 'bg-surface-active text-primary'
                  : 'text-text-main hover:bg-surface-hover',
                chat.archived ? 'opacity-70' : ''
              ]"
              @click="selectWorkspaceSession(chat.id)"
              @contextmenu="openChatMenu($event, chat)"
            >
              <div class="relative flex-shrink-0">
                <GroupAvatar :members="chat.groupMembers ?? []" :title="chat.title" size="sm" />
                <span
                  v-if="chat.running"
                  class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500"
                  title="正在运行"
                />
              </div>
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-1">
                  <span class="truncate text-md font-medium">{{ chat.title }}</span>
                  <span
                    v-if="chat.pinned"
                    class="material-symbols-outlined flex-shrink-0 text-base text-primary"
                    >keep</span
                  >
                </span>
                <span class="mt-0.5 block truncate text-xs text-text-muted">{{
                  chat.preview
                }}</span>
              </span>
            </button>
          </div>
        </section>

        <section>
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-muted"
            @click="agentsOpen = !agentsOpen"
          >
            <span
              class="material-symbols-outlined text-lg transition-transform duration-150"
              :class="agentsOpen ? 'rotate-90' : ''"
            >
              chevron_right
            </span>
            单聊
            <span class="ml-auto font-medium normal-case tracking-normal">{{
              agentSessions.length
            }}</span>
          </button>
          <div v-if="agentsOpen" class="mt-0.5">
            <p
              v-if="agentSessions.length === 0"
              class="px-2.5 py-2 text-sm text-text-muted"
            >
              还没有单聊
            </p>
            <button
              v-for="chat in agentSessions"
              :key="chat.id"
              type="button"
              class="mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors"
              :class="[
                chat.id === workspaceState.activeSessionKey && workspaceState.nav === 'workspace'
                  ? 'bg-surface-active text-primary'
                  : 'text-text-main hover:bg-surface-hover',
                chat.archived ? 'opacity-70' : ''
              ]"
              @click="selectWorkspaceSession(chat.id)"
              @contextmenu="openChatMenu($event, chat)"
            >
              <div class="relative flex-shrink-0">
                <div
                  class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md"
                  :class="
                    chat.avatar.avatarDataUrl
                      ? ''
                      : chat.avatar.kind === 'initials'
                        ? 'bg-primary/10 text-primary text-sm font-semibold'
                        : 'bg-surface-hover text-text-muted'
                  "
                  :style="
                    !chat.avatar.avatarDataUrl &&
                    chat.avatar.kind === 'initials' &&
                    chat.avatar.color
                      ? {
                          backgroundColor: chat.avatar.color,
                          color: avatarTextColor(chat.avatar.color)
                        }
                      : undefined
                  "
                >
                  <img
                    v-if="chat.avatar.avatarDataUrl"
                    :src="chat.avatar.avatarDataUrl"
                    :alt="chat.title"
                    class="h-full w-full object-cover"
                  />
                  <span v-else-if="chat.avatar.kind === 'initials'">{{ chat.avatar.text }}</span>
                  <span v-else class="material-symbols-outlined text-2xl">{{
                    chat.avatar.icon
                  }}</span>
                </div>
                <span
                  v-if="chat.running"
                  class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500"
                  title="正在运行"
                />
              </div>
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-1">
                  <span class="truncate text-md font-medium">{{ chat.title }}</span>
                  <span
                    v-if="chat.archived"
                    class="flex-shrink-0 rounded bg-gray-150 px-1 py-0.5 text-[10px] font-medium leading-none text-text-muted"
                    >归档</span
                  >
                  <span
                    v-if="chat.pinned"
                    class="material-symbols-outlined flex-shrink-0 text-base text-primary"
                    >keep</span
                  >
                </span>
                <span class="mt-0.5 block truncate text-xs text-text-muted">
                  {{ chat.preview
                  }}<template v-if="chat.updatedAt"> · {{ formatTime(chat.updatedAt) }}</template>
                </span>
              </span>
            </button>
          </div>
        </section>

      </template>
    </div>

    <div class="mt-auto border-t border-surface-border p-2">
      <button
        type="button"
        class="mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-md transition-colors"
        :class="
          workspaceState.nav === 'agents'
            ? 'bg-surface-active text-primary'
            : 'text-text-main hover:bg-surface-hover'
        "
        @click="go('agents')"
      >
        <span class="material-symbols-outlined text-2xl">smart_toy</span>
        Agents
      </button>
      <button
        type="button"
        class="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-md transition-colors"
        :class="
          workspaceState.nav === 'settings'
            ? 'bg-surface-active text-primary'
            : 'text-text-main hover:bg-surface-hover'
        "
        @click="go('settings')"
      >
        <span class="material-symbols-outlined text-2xl">settings</span>
        设置
      </button>
    </div>

    <div
      class="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize bg-transparent"
      role="separator"
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      @pointerdown="startResize"
      @dragstart.prevent
    ></div>

    <ContextMenu
      :open="chatMenuOpen"
      :x="chatMenuX"
      :y="chatMenuY"
      :items="chatMenuItems"
      @close="closeChatMenu"
      @select="onChatMenuSelect"
    />
  </aside>
</template>
