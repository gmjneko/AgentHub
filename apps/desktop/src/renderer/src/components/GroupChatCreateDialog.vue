<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  isVendorProviderCompatible,
  type AgentVendor,
  type AgentView,
  type CreateGroupChatPayload,
  type GroupChatMode,
  type GroupChatView,
  type PlatformProviderView,
  type ProjectStatus
} from '@agenthub/shared'
import { ApiError } from '../api'
import { agentApi } from '../api/agents'
import { providerApi } from '../api/providers'
import { groupChatApi } from '../api/group-chats'
import AgentAvatar from './AgentAvatar.vue'
import Modal from './Modal.vue'
import BaseButton from './ui/BaseButton.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'
import ServerDirectoryPicker from './ServerDirectoryPicker.vue'
import { agentModelLabel, vendorLabel } from '../utils/vendor'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', group: GroupChatView): void
}>()

const VENDORS: AgentVendor[] = ['claude', 'codex']
const STATUSES: ProjectStatus[] = ['planning', 'designing', 'development', 'done']

const agents = ref<AgentView[]>([])
const providers = ref<PlatformProviderView[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const form = reactive({
  title: '',
  mode: 'standard' as GroupChatMode,
  leaderAgentId: '',
  memberIds: new Set<string>(),
  orchestratorVendor: 'claude' as AgentVendor,
  orchestratorProviderId: '',
  orchestratorModel: '',
  projectName: '',
  projectGoal: '',
  techStack: '',
  projectStatus: 'planning' as ProjectStatus,
  workspaceDir: ''
})

const submitting = ref(false)
const submitError = ref<string | null>(null)
const workspacePickerOpen = ref(false)

const compatibleProviders = computed(() =>
  providers.value.filter((p) => isVendorProviderCompatible(form.orchestratorVendor, p.type))
)
const selectedProvider = computed(
  () => providers.value.find((p) => p.id === form.orchestratorProviderId) ?? null
)
const visibleError = computed(() => submitError.value ?? loadError.value ?? null)

function vendorForProvider(provider: PlatformProviderView): AgentVendor {
  return provider.type === 'anthropic' ? 'claude' : 'codex'
}

function preferredModel(provider: PlatformProviderView): string {
  return provider.defaultModel ?? provider.modelList[0] ?? ''
}

function defaultProviderForVendor(vendor: AgentVendor): PlatformProviderView | undefined {
  return providers.value.find((p) => p.isDefault && isVendorProviderCompatible(vendor, p.type))
}

function applyDefaultProvider(): void {
  const provider = providers.value.find((p) => p.isDefault)
  if (!provider) return
  form.orchestratorVendor = vendorForProvider(provider)
  form.orchestratorProviderId = provider.id
  form.orchestratorModel = preferredModel(provider)
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const [agentList, providerList] = await Promise.all([agentApi.list(), providerApi.list()])
    agents.value = agentList
    providers.value = providerList
    applyDefaultProvider()
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : '加载 Agent / Provider 失败'
  } finally {
    loading.value = false
  }
}

function reset(): void {
  form.title = ''
  form.mode = 'standard'
  form.leaderAgentId = ''
  form.memberIds = new Set()
  form.orchestratorVendor = 'claude'
  form.orchestratorProviderId = ''
  form.orchestratorModel = ''
  form.projectName = ''
  form.projectGoal = ''
  form.techStack = ''
  form.projectStatus = 'planning'
  form.workspaceDir = ''
  submitError.value = null
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      reset()
      void load()
    }
  }
)

// vendor 变化时，若当前 provider 不再兼容则清空
watch(
  () => form.orchestratorVendor,
  () => {
    if (!compatibleProviders.value.some((p) => p.id === form.orchestratorProviderId)) {
      const provider = defaultProviderForVendor(form.orchestratorVendor)
      form.orchestratorProviderId = provider?.id ?? ''
      form.orchestratorModel = provider ? preferredModel(provider) : ''
    }
  }
)
watch(
  () => form.orchestratorProviderId,
  () => {
    if (!selectedProvider.value?.modelList.includes(form.orchestratorModel)) {
      form.orchestratorModel = selectedProvider.value ? preferredModel(selectedProvider.value) : ''
    }
  }
)

function toggleMember(id: string): void {
  const next = new Set(form.memberIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  form.memberIds = next
  if (!next.has(form.leaderAgentId)) {
    form.leaderAgentId = form.mode === 'agent_team' ? ([...next][0] ?? '') : ''
  } else if (form.mode === 'agent_team' && !form.leaderAgentId && next.size > 0) {
    form.leaderAgentId = [...next][0] ?? ''
  }
}

function setMode(mode: GroupChatMode): void {
  form.mode = mode
  if (mode === 'agent_team') {
    if (!form.memberIds.has(form.leaderAgentId)) {
      form.leaderAgentId = [...form.memberIds][0] ?? ''
    }
  } else {
    form.leaderAgentId = ''
  }
}

function buildPayload(): CreateGroupChatPayload | string {
  if (!form.title.trim()) return '请填写群标题'
  if (form.memberIds.size === 0) return '请至少选择一个成员 Agent'
  if (form.mode !== 'agent_team') {
    if (!form.orchestratorProviderId) return '请为 Orchestrator 选择 Provider'
    if (!form.orchestratorModel.trim()) return '请为 Orchestrator 选择模型'
  } else if (!form.leaderAgentId || !form.memberIds.has(form.leaderAgentId)) {
    return '请指定一名成员作为队长'
  }
  if (!form.projectName.trim()) return '请填写项目名'

  return {
    title: form.title.trim(),
    memberAgentIds: [...form.memberIds],
    mode: form.mode,
    ...(form.mode === 'agent_team'
      ? { leaderAgentId: form.leaderAgentId }
      : {
          orchestrator: {
            vendor: form.orchestratorVendor,
            model: form.orchestratorModel.trim(),
            providerId: form.orchestratorProviderId
          }
        }),
    projectMeta: {
      name: form.projectName.trim(),
      goal: form.projectGoal.trim() || null,
      techStack: form.techStack
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      status: form.projectStatus
    },
    ...(form.workspaceDir.trim() ? { workspaceDir: form.workspaceDir.trim() } : {})
  }
}

async function onSubmit(): Promise<void> {
  const payload = buildPayload()
  if (typeof payload === 'string') {
    submitError.value = payload
    return
  }
  submitError.value = null
  submitting.value = true
  try {
    const group = await groupChatApi.create(payload)
    emit('created', group)
    emit('close')
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}

function chooseWorkspaceDirectory(): void {
  workspacePickerOpen.value = true
}

function closeWorkspacePicker(): void {
  workspacePickerOpen.value = false
}

function onWorkspacePicked(paths: string[]): void {
  form.workspaceDir = paths[0] ?? form.workspaceDir
}
</script>

<template>
  <Modal :open="open" title="创建群聊" :width="600" @close="emit('close')">
    <div class="space-y-4">
      <p v-if="loading" class="text-sm text-text-muted">正在加载 Agent / Provider...</p>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">群标题</label>
        <BaseInput v-model="form.title" type="text" placeholder="如：时区计算器小组" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">协作方式</label>
        <div class="grid grid-cols-3 gap-2">
            <button
            type="button"
            class="rounded-md border px-3 py-2 text-left transition-colors"
            :class="
              form.mode === 'standard'
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-surface-border text-text-main hover:bg-surface-hover'
            "
            @click="setMode('standard')"
          >
            <span class="block text-sm font-medium">普通群聊</span>
            <span class="mt-0.5 block text-xs text-text-muted">Orchestrator 拆任务并验收</span>
            </button>
            <button
              type="button"
              class="rounded-md border px-3 py-2 text-left"
              :class="form.mode === 'issues' ? 'border-primary bg-primary-soft' : 'border-border'"
              @click="setMode('issues')"
            >
              <div class="font-medium">Issues</div>
              <div class="text-xs text-text-muted">按 Issue、评论和 @ 协作</div>
            </button>
          <button
            type="button"
            class="rounded-md border px-3 py-2 text-left transition-colors"
            :class="
              form.mode === 'agent_team'
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-surface-border text-text-main hover:bg-surface-hover'
            "
            @click="setMode('agent_team')"
          >
            <span class="block text-sm font-medium">Agent Team</span>
            <span class="mt-0.5 block text-xs text-text-muted">队长和队员在群里直接讨论</span>
          </button>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          成员 Agent
          <span class="font-normal text-text-muted">（多选）</span>
        </label>
        <p v-if="!loading && agents.length === 0" class="text-sm text-text-muted">
          还没有可用 Agent，请先在「Agent 管理」中创建。
        </p>
        <div
          v-else
          class="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-surface-border p-2"
        >
          <button
            v-for="agent in agents"
            :key="agent.id"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors"
            :class="
              form.memberIds.has(agent.id)
                ? 'bg-primary-soft text-primary'
                : 'hover:bg-surface-hover text-text-main'
            "
            @click="toggleMember(agent.id)"
          >
            <span
              class="material-symbols-outlined text-xl"
              :class="form.memberIds.has(agent.id) ? 'text-primary' : 'text-text-muted'"
            >
              {{ form.memberIds.has(agent.id) ? 'check_box' : 'check_box_outline_blank' }}
            </span>
            <AgentAvatar :name="agent.name" :avatar="agent.avatar" :color="agent.color" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-base font-medium">{{ agent.name }}</span>
              <span class="block truncate text-xs text-text-muted">
                {{ vendorLabel(agent.vendor) }} / {{ agentModelLabel(agent) }}
              </span>
            </span>
            <span
              v-if="form.mode === 'agent_team' && form.memberIds.has(agent.id)"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
              :class="
                form.leaderAgentId === agent.id
                  ? 'bg-primary text-white'
                  : 'bg-white text-text-muted'
              "
              @click.stop="form.leaderAgentId = agent.id"
            >
              {{ form.leaderAgentId === agent.id ? '队长' : '设为队长' }}
            </span>
          </button>
        </div>
      </div>

      <div v-if="form.mode !== 'agent_team'" class="rounded-md bg-surface-hover p-3">
        <div class="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-main">
          <span class="material-symbols-outlined text-xl text-accent">hub</span>
          Orchestrator（独立编排者）
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="mb-1 block text-xs text-text-muted">Vendor</label>
            <BaseSelect v-model="form.orchestratorVendor">
              <option v-for="v in VENDORS" :key="v" :value="v">{{ vendorLabel(v) }}</option>
            </BaseSelect>
          </div>
          <div>
            <label class="mb-1 block text-xs text-text-muted">Provider</label>
            <BaseSelect v-model="form.orchestratorProviderId">
              <option value="" disabled>请选择</option>
              <option v-for="p in compatibleProviders" :key="p.id" :value="p.id">
                {{ p.platformName }}
              </option>
            </BaseSelect>
          </div>
          <div>
            <label class="mb-1 block text-xs text-text-muted">Model</label>
            <BaseSelect
              v-if="(selectedProvider?.modelList ?? []).length > 0"
              v-model="form.orchestratorModel"
            >
              <option value="" disabled>请选择</option>
              <option v-for="m in selectedProvider?.modelList ?? []" :key="m" :value="m">
                {{ m }}
              </option>
            </BaseSelect>
            <BaseInput
              v-else
              v-model="form.orchestratorModel"
              mono
              type="text"
              :disabled="!selectedProvider"
              placeholder="输入模型名"
            />
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">项目名</label>
          <BaseInput v-model="form.projectName" type="text" placeholder="如：时区计算器" />
        </div>
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">阶段</label>
          <BaseSelect v-model="form.projectStatus">
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </BaseSelect>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          项目目标 <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <BaseTextarea v-model="form.projectGoal" rows="2" placeholder="一句话描述项目总目标" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          技术栈 <span class="font-normal text-text-muted">（可选，逗号分隔）</span>
        </label>
        <BaseInput v-model="form.techStack" type="text" placeholder="React, Vite, TailwindCSS" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          共享工作区目录 <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <div class="flex gap-2">
          <BaseInput
            v-model="form.workspaceDir"
            class="min-w-0 flex-1"
            mono
            type="text"
            placeholder="留空时后端自动分配并 git init"
          />
          <BaseButton
            class="shrink-0 whitespace-nowrap"
            variant="secondary"
            size="lg"
            @click="chooseWorkspaceDirectory"
          >
            <span class="material-symbols-outlined text-xl">folder_open</span>
            选择目录
          </BaseButton>
        </div>
      </div>

      <p v-if="visibleError" class="text-sm text-danger">{{ visibleError }}</p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">取消</BaseButton>
      <BaseButton :disabled="submitting || loading" @click="onSubmit">
        {{ submitting ? '创建中...' : '创建' }}
      </BaseButton>
    </template>
  </Modal>

  <ServerDirectoryPicker
    :open="workspacePickerOpen"
    title="选择服务器共享工作区"
    mode="single"
    preferred-kind="agent_workspace"
    :initial-path="form.workspaceDir"
    @confirm="onWorkspacePicked"
    @close="closeWorkspacePicker"
  />
</template>
