<script setup lang="ts">
import { computed } from 'vue'
import type {
  AgentChatView,
  AgentTodoItem,
  BlackboardArtifact,
  WorkspaceDiffSummary
} from '../api'
import AgentAvatar from './AgentAvatar.vue'
import InspectorSection from './InspectorSection.vue'
import WorkspaceDiffPanel from './WorkspaceDiffPanel.vue'
import { agentModelLabel, vendorLabel } from '../utils/vendor'

const props = defineProps<{
  chat?: AgentChatView | null
  runtime?: {
    phase: 'idle' | 'thinking' | 'tool' | 'streaming' | 'error' | 'done'
    label: string
    detail?: string
    toolName?: string
    todos: AgentTodoItem[]
  }
  artifacts?: BlackboardArtifact[]
  diff?: WorkspaceDiffSummary | null
  diffLoading?: boolean
  diffError?: string | null
  diffCommitting?: boolean
  diffDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh-diff'): void
  (e: 'commit-diff'): void
  (e: 'open-artifact', artifact: BlackboardArtifact): void
}>()

const phaseClasses = computed(() => {
  switch (props.runtime?.phase) {
    case 'thinking':
    case 'streaming':
      return 'bg-primary'
    case 'tool':
      return 'bg-warning'
    case 'error':
      return 'bg-danger'
    case 'done':
      return 'bg-success'
    default:
      return 'bg-surface-border'
  }
})

function todoLabel(status: AgentTodoItem['status']): string {
  const labels: Record<AgentTodoItem['status'], string> = {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Done'
  }
  return labels[status]
}
</script>

<template>
  <aside
    class="z-10 flex h-full flex-shrink-0 flex-col border-l border-surface-border bg-surface"
  >
    <div class="flex-1 overflow-y-auto">
      <InspectorSection title="环境信息" icon="folder">
        <template v-if="chat">
          <div class="mb-4 flex items-center space-x-3">
            <AgentAvatar
              :name="chat.agent.name"
              :avatar="chat.agent.avatar"
              :color="chat.agent.color"
            />
            <div class="min-w-0">
              <div class="truncate text-md font-semibold text-text-main">{{ chat.agent.name }}</div>
              <div class="truncate text-sm text-text-muted">
                {{ vendorLabel(chat.agent.vendor) }} / {{ agentModelLabel(chat.agent) }}
              </div>
            </div>
          </div>

          <div class="mb-4 flex items-center space-x-2.5">
            <span
              class="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              :class="[phaseClasses, runtime?.phase === 'streaming' ? 'animate-pulse-ring' : '']"
            ></span>
            <span class="text-sm font-medium text-text-main">{{ runtime?.label ?? 'Idle' }}</span>
          </div>
          <p v-if="runtime?.toolName" class="mb-2 break-words text-sm text-text-muted">
            {{ runtime.toolName }}
          </p>
          <p v-if="runtime?.detail" class="mb-4 line-clamp-5 break-words text-sm text-text-muted">
            {{ runtime.detail }}
          </p>

          <div class="space-y-3 text-sm">
            <div>
              <div class="mb-1 font-medium text-text-muted">工作目录</div>
              <div class="break-all font-mono text-xs text-text-main">
                {{ chat.workingDirectory }}
              </div>
            </div>
            <div>
              <div class="mb-1 font-medium text-text-muted">会话目录</div>
              <div class="break-all font-mono text-xs text-text-main">
                {{ chat.sessionHomeDirectory }}
              </div>
            </div>
          </div>

          <WorkspaceDiffPanel
            class="mt-4"
            :diff="diff"
            :loading="diffLoading"
            :error="diffError"
            :committing="diffCommitting"
            :disabled="diffDisabled"
            @refresh="emit('refresh-diff')"
            @commit="emit('commit-diff')"
          />
        </template>
        <p v-else class="text-sm text-text-muted">选择一个单聊以查看环境</p>
      </InspectorSection>

      <InspectorSection title="任务清单" icon="checklist">
        <div v-if="!runtime?.todos.length" class="text-sm text-text-muted">暂无任务</div>
        <div v-else class="space-y-2">
          <div
            v-for="(todo, index) in runtime.todos"
            :key="`${todo.text}-${index}`"
            class="flex items-start space-x-2"
          >
            <span
              class="material-symbols-outlined mt-0.5 text-xl"
              :class="
                todo.status === 'completed'
                  ? 'text-success'
                  : todo.status === 'in_progress'
                    ? 'text-primary'
                    : 'text-text-muted'
              "
            >
              {{
                todo.status === 'completed'
                  ? 'check_circle'
                  : todo.status === 'in_progress'
                    ? 'radio_button_checked'
                    : 'radio_button_unchecked'
              }}
            </span>
            <div class="min-w-0">
              <div
                class="break-words text-sm"
                :class="
                  todo.status === 'completed'
                    ? 'text-text-muted line-through'
                    : todo.status === 'in_progress'
                      ? 'font-medium text-text-main'
                      : 'text-text-main'
                "
              >
                {{ todo.text }}
              </div>
              <div class="text-xs text-text-muted">{{ todoLabel(todo.status) }}</div>
            </div>
          </div>
        </div>
      </InspectorSection>

      <InspectorSection title="产物" icon="deployed_code" :default-open="Boolean(artifacts?.length)">
        <p v-if="!artifacts?.length" class="text-sm text-text-muted">暂无产物</p>
        <div v-else class="space-y-1.5">
          <button
            v-for="artifact in artifacts"
            :key="artifact.id"
            type="button"
            class="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
            @click="emit('open-artifact', artifact)"
          >
            <div class="truncate font-mono text-sm text-text-main">{{ artifact.path }}</div>
            <div class="truncate text-xs text-text-muted">
              v{{ artifact.version }} · {{ artifact.status }}
            </div>
          </button>
        </div>
      </InspectorSection>
    </div>
  </aside>
</template>
