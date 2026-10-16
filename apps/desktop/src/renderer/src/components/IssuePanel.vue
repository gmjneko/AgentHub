<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  GroupChatView,
  GroupIssueCommentView,
  GroupIssueStatus,
  GroupIssueView
} from '@agenthub/shared'
import { ApiError, groupChatApi } from '../api'
import type { MentionTarget } from '../types/mentions'
import { extractMentionIds } from '../utils/mentions'

const props = defineProps<{
  group: GroupChatView
  feed?: number
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const STATUS_OPTIONS: Array<{ value: GroupIssueStatus; label: string }> = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'in_review', label: '待验收' },
  { value: 'done', label: '完成' },
  { value: 'blocked', label: '阻塞' },
  { value: 'cancelled', label: '取消' }
]

const issues = ref<GroupIssueView[]>([])
const selected = ref<GroupIssueView | null>(null)
const title = ref('')
const description = ref('')
const createAssignee = ref('orchestrator')
const comment = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const mentionOpen = ref(false)

const mentionTargets = computed<MentionTarget[]>(() => [
  { id: 'orchestrator', label: 'Orchestrator', description: '编排' },
  ...props.group.members.map((member) => ({
    id: member.agentId,
    label: member.name,
    name: member.name,
    description: member.roleInGroup
  }))
])

const filteredTargets = computed(() => {
  const match = comment.value.match(/(^|[\s([{（，。！？、；：,.!?;:])@([^\s@]*)$/u)
  if (!match) return []
  const query = (match[2] ?? '').trim().toLocaleLowerCase()
  return mentionTargets.value
    .filter((target) => !query || target.label.toLocaleLowerCase().includes(query))
    .slice(0, 6)
})

function statusLabel(status: GroupIssueStatus): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status
}

function assigneeKey(issue: GroupIssueView): string {
  return issue.assigneeType === 'agent' && issue.assigneeId ? issue.assigneeId : 'orchestrator'
}

function assigneeLabel(issue: GroupIssueView): string {
  if (issue.assigneeType === 'agent' && issue.assigneeId) {
    return props.group.members.find((member) => member.agentId === issue.assigneeId)?.name ?? '成员'
  }
  return 'Orchestrator'
}

function authorLabel(item: GroupIssueCommentView): string {
  if (item.authorRole === 'user') return '你'
  if (item.authorRole === 'orchestrator') return 'Orchestrator'
  if (item.authorRole === 'system') return '系统'
  return (
    props.group.members.find((member) => member.agentId === item.authorAgentId)?.name ?? 'Agent'
  )
}

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Issue 操作失败'
}

function onStatusChange(event: Event): void {
  void changeStatus((event.target as HTMLSelectElement).value as GroupIssueStatus)
}

async function loadIssues(): Promise<void> {
  const initial = issues.value.length === 0
  if (initial) loading.value = true
  try {
    issues.value = await groupChatApi.listIssues(props.group.id)
    if (selected.value) {
      const fresh = issues.value.find((issue) => issue.id === selected.value?.id)
      if (fresh) selected.value = await groupChatApi.getIssue(props.group.id, fresh.id)
      else selected.value = null
    }
  } catch (err) {
    error.value = messageOf(err)
  } finally {
    loading.value = false
  }
}

async function openIssue(issue: GroupIssueView): Promise<void> {
  error.value = null
  selected.value = await groupChatApi.getIssue(props.group.id, issue.id)
}

async function createIssue(): Promise<void> {
  const nextTitle = title.value.trim()
  if (!nextTitle) return
  saving.value = true
  error.value = null
  try {
    const created = await groupChatApi.createIssue(props.group.id, {
      title: nextTitle,
      description: description.value.trim() || null,
      ...(createAssignee.value === 'orchestrator'
        ? { assigneeType: 'orchestrator' }
        : { assigneeType: 'agent', assigneeId: createAssignee.value })
    })
    title.value = ''
    description.value = ''
    await loadIssues()
    selected.value = created
    emit('changed')
  } catch (err) {
    error.value = messageOf(err)
  } finally {
    saving.value = false
  }
}

async function changeAssignee(value: string): Promise<void> {
  if (!selected.value) return
  error.value = null
  try {
    selected.value = await groupChatApi.updateIssue(props.group.id, selected.value.id, {
      assigneeType: value === 'orchestrator' ? 'orchestrator' : 'agent',
      assigneeId: value === 'orchestrator' ? null : value
    })
    await loadIssues()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err)
  }
}

async function changeStatus(status: GroupIssueStatus): Promise<void> {
  if (!selected.value || selected.value.status === status) return
  error.value = null
  try {
    selected.value = await groupChatApi.updateIssue(props.group.id, selected.value.id, { status })
    await loadIssues()
  } catch (err) {
    error.value = messageOf(err)
  }
}

async function sendComment(): Promise<void> {
  if (!selected.value || !comment.value.trim()) return
  const mentions = extractMentionIds(comment.value, mentionTargets.value)
  saving.value = true
  error.value = null
  try {
    await groupChatApi.addIssueComment(props.group.id, selected.value.id, {
      body: comment.value.trim(),
      ...(mentions.length ? { mentions } : {})
    })
    comment.value = ''
    mentionOpen.value = false
    selected.value = await groupChatApi.getIssue(props.group.id, selected.value.id)
    await loadIssues()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err)
  } finally {
    saving.value = false
  }
}

function insertMention(target: MentionTarget): void {
  const current = comment.value
  const match = current.match(/(^|[\s([{（，。！？、；：,.!?;:])@([^\s@]*)$/u)
  const next = match
    ? `${current.slice(0, current.length - (match[2]?.length ?? 0) - 1)}@${target.label} `
    : `${current}${current && !/\s$/.test(current) ? ' ' : ''}@${target.label} `
  comment.value = next
  mentionOpen.value = false
}

watch(
  () => props.group.id,
  () => {
    selected.value = null
    void loadIssues()
  },
  { immediate: true }
)

watch(
  () => props.feed,
  () => void loadIssues()
)

watch(filteredTargets, (targets) => {
  mentionOpen.value = targets.length > 0
})
</script>

<template>
  <div class="space-y-3">
    <p v-if="error" class="rounded bg-danger-soft px-2 py-1 text-xs text-danger">{{ error }}</p>
    <div class="space-y-2">
      <input
        v-model="title"
        class="w-full rounded border border-surface-border px-2 py-1 text-sm"
        placeholder="新 Issue 标题"
        @keyup.enter="createIssue"
      />
      <textarea
        v-model="description"
        rows="2"
        class="w-full resize-none rounded border border-surface-border px-2 py-1 text-xs"
        placeholder="描述，可选"
      />
      <div class="flex gap-2">
        <select
          v-model="createAssignee"
          class="min-w-0 flex-1 rounded border border-surface-border px-2 py-1 text-xs"
        >
          <option value="orchestrator">负责人：Orchestrator</option>
          <option v-for="member in group.members" :key="member.agentId" :value="member.agentId">
            负责人：{{ member.name }}
          </option>
        </select>
        <button
          type="button"
          class="rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50"
          :disabled="saving || !title.trim()"
          @click="createIssue"
        >
          创建
        </button>
      </div>
    </div>

    <p v-if="loading" class="text-sm text-text-muted">Issue 加载中…</p>
    <p v-else-if="issues.length === 0" class="text-sm text-text-muted">暂无 Issue</p>
    <div v-else class="space-y-2">
      <button
        v-for="issue in issues"
        :key="issue.id"
        type="button"
        class="block w-full rounded border px-2 py-2 text-left"
        :class="
          selected?.id === issue.id ? 'border-primary bg-primary-soft/40' : 'border-surface-border'
        "
        @click="openIssue(issue)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 truncate text-sm font-medium text-text-main">{{ issue.title }}</div>
          <span class="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">
            {{ statusLabel(issue.status) }}
          </span>
        </div>
        <div class="mt-1 text-xs text-text-muted">
          {{ assigneeLabel(issue) }} · {{ issue.comments.length }} 条评论
          <span v-if="issue.activeRunId"> · 运行中</span>
        </div>
      </button>
    </div>

    <div v-if="selected" class="rounded border border-primary/30 bg-primary-soft/30 p-2">
      <div class="text-sm font-semibold text-text-main">{{ selected.title }}</div>
      <p v-if="selected.description" class="mt-1 whitespace-pre-wrap text-xs text-text-muted">
        {{ selected.description }}
      </p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <select
          class="rounded border border-surface-border bg-white px-2 py-1 text-xs"
          :value="assigneeKey(selected)"
          @change="changeAssignee(($event.target as HTMLSelectElement).value)"
        >
          <option value="orchestrator">Orchestrator</option>
          <option v-for="member in group.members" :key="member.agentId" :value="member.agentId">
            {{ member.name }}
          </option>
        </select>
        <select
          class="rounded border border-surface-border bg-white px-2 py-1 text-xs"
          :value="selected.status"
          @change="onStatusChange"
        >
          <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <p v-if="selected.blockedReason" class="mt-2 text-xs text-danger">
        {{ selected.blockedReason }}
      </p>
      <div class="mt-2 max-h-48 space-y-2 overflow-y-auto">
        <div v-for="item in selected.comments" :key="item.id" class="rounded bg-white px-2 py-1.5">
          <div class="text-[10px] font-medium text-text-muted">{{ authorLabel(item) }}</div>
          <p class="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-text-main">{{ item.body }}</p>
        </div>
      </div>
      <div class="relative mt-2">
        <div
          v-if="mentionOpen"
          class="absolute bottom-full z-10 mb-1 max-h-32 w-full overflow-y-auto rounded border border-surface-border bg-white shadow"
        >
          <button
            v-for="target in filteredTargets"
            :key="target.id"
            type="button"
            class="block w-full px-2 py-1 text-left text-xs hover:bg-surface-hover"
            @mousedown.prevent="insertMention(target)"
          >
            @{{ target.label }}
          </button>
        </div>
        <div class="flex gap-1.5">
          <input
            v-model="comment"
            class="min-w-0 flex-1 rounded border border-surface-border px-2 py-1 text-xs"
            placeholder="评论，用 @名称 唤醒成员"
            @keyup.enter="sendComment"
          />
          <button
            type="button"
            class="rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50"
            :disabled="saving || !comment.trim()"
            @click="sendComment"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
