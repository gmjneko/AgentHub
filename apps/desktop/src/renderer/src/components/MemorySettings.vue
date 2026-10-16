<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { LayeredMemoryItem, LayeredMemoryType } from '@agenthub/shared'
import { ApiError, memoryApi } from '../api'

const longTerm = ref<LayeredMemoryItem[]>([])
const workspace = ref<LayeredMemoryItem[]>([])
const workspaceDir = ref('')
const loadedWorkspaceDir = ref('')
const longTermType = ref<Extract<LayeredMemoryType, 'preference' | 'code_style'>>('preference')
const workspaceType = ref<Extract<LayeredMemoryType, 'convention' | 'decision'>>('convention')
const longTermContent = ref('')
const workspaceContent = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const typeLabel: Record<LayeredMemoryType, string> = {
  preference: '偏好',
  code_style: '代码风格',
  convention: '约定',
  decision: '决策'
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

async function loadLongTerm(): Promise<void> {
  longTerm.value = await memoryApi.list({ layer: 'long_term' })
}

async function loadWorkspace(): Promise<void> {
  const dir = workspaceDir.value.trim()
  if (!dir) {
    workspace.value = []
    loadedWorkspaceDir.value = ''
    return
  }
  try {
    workspace.value = await memoryApi.list({ layer: 'workspace', workspaceDir: dir })
    loadedWorkspaceDir.value = dir
    error.value = null
  } catch (err) {
    error.value = messageOf(err, '工作区记忆加载失败')
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    await loadLongTerm()
    if (workspaceDir.value.trim()) await loadWorkspace()
  } catch (err) {
    error.value = messageOf(err, '记忆加载失败')
  } finally {
    loading.value = false
  }
}

async function addLongTerm(): Promise<void> {
  const content = longTermContent.value.trim()
  if (!content) return
  saving.value = true
  error.value = null
  try {
    await memoryApi.create({ layer: 'long_term', type: longTermType.value, content })
    longTermContent.value = ''
    await loadLongTerm()
  } catch (err) {
    error.value = messageOf(err, '保存失败')
  } finally {
    saving.value = false
  }
}

async function addWorkspace(): Promise<void> {
  const content = workspaceContent.value.trim()
  const dir = workspaceDir.value.trim()
  if (!content || !dir) return
  saving.value = true
  error.value = null
  try {
    await memoryApi.create({
      layer: 'workspace',
      type: workspaceType.value,
      content,
      workspaceDir: dir
    })
    workspaceContent.value = ''
    await loadWorkspace()
  } catch (err) {
    error.value = messageOf(err, '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(id: string, layer: 'long_term' | 'workspace'): Promise<void> {
  error.value = null
  try {
    await memoryApi.remove(id)
    if (layer === 'long_term') await loadLongTerm()
    else await loadWorkspace()
  } catch (err) {
    error.value = messageOf(err, '删除失败')
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="min-w-0 flex-1 overflow-y-auto px-8 py-6">
    <header class="mb-6">
      <h2 class="text-xl font-semibold text-text-main">记忆</h2>
      <p class="mt-1 text-sm text-text-muted">
        长期记忆跟随你的所有会话。工作区记忆只在同一个目录里的后续会话复用。
      </p>
    </header>

    <p v-if="error" class="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
      {{ error }}
    </p>
    <p v-if="loading" class="text-sm text-text-muted">加载中…</p>

    <section class="mb-8 rounded-xl border border-surface-border bg-surface p-5">
      <h3 class="text-md font-semibold text-text-main">长期记忆</h3>
      <p class="mt-1 text-sm text-text-muted">用户偏好和代码风格。</p>
      <div class="mt-4 flex flex-col gap-2 sm:flex-row">
        <select
          v-model="longTermType"
          class="rounded-md border border-surface-border bg-white px-2 py-2 text-sm"
        >
          <option value="preference">偏好</option>
          <option value="code_style">代码风格</option>
        </select>
        <input
          v-model="longTermContent"
          class="min-w-0 flex-1 rounded-md border border-surface-border px-3 py-2 text-sm"
          placeholder="例如：回复使用中文，代码缩进 2 个空格"
          @keyup.enter="addLongTerm"
        />
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
          :disabled="saving || !longTermContent.trim()"
          @click="addLongTerm"
        >
          添加
        </button>
      </div>
      <ul class="mt-4 space-y-2">
        <li v-if="longTerm.length === 0" class="text-sm text-text-muted">还没有长期记忆</li>
        <li
          v-for="item in longTerm"
          :key="item.id"
          class="flex items-start justify-between gap-3 rounded-md border border-surface-border px-3 py-2"
        >
          <div class="min-w-0">
            <div class="text-xs text-text-muted">{{ typeLabel[item.type] }}</div>
            <p class="mt-0.5 whitespace-pre-wrap text-sm text-text-main">{{ item.content }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 text-xs text-danger"
            @click="remove(item.id, 'long_term')"
          >
            删除
          </button>
        </li>
      </ul>
    </section>

    <section class="rounded-xl border border-surface-border bg-surface p-5">
      <h3 class="text-md font-semibold text-text-main">工作区记忆</h3>
      <p class="mt-1 text-sm text-text-muted">约定和任务决策，按工作区目录区分。</p>
      <div class="mt-4 flex gap-2">
        <input
          v-model="workspaceDir"
          class="min-w-0 flex-1 rounded-md border border-surface-border px-3 py-2 font-mono text-sm"
          placeholder="工作区目录"
          @keyup.enter="loadWorkspace"
        />
        <button
          type="button"
          class="rounded-md border border-surface-border px-3 py-2 text-sm"
          @click="loadWorkspace"
        >
          加载
        </button>
      </div>
      <div class="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          v-model="workspaceType"
          class="rounded-md border border-surface-border bg-white px-2 py-2 text-sm"
        >
          <option value="convention">约定</option>
          <option value="decision">决策</option>
        </select>
        <input
          v-model="workspaceContent"
          class="min-w-0 flex-1 rounded-md border border-surface-border px-3 py-2 text-sm"
          placeholder="例如：时间统一用 UTC 存储"
          @keyup.enter="addWorkspace"
        />
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
          :disabled="saving || !workspaceContent.trim() || !workspaceDir.trim()"
          @click="addWorkspace"
        >
          添加
        </button>
      </div>
      <p v-if="loadedWorkspaceDir" class="mt-3 truncate font-mono text-xs text-text-muted">
        {{ loadedWorkspaceDir }}
      </p>
      <ul class="mt-4 space-y-2">
        <li v-if="!loadedWorkspaceDir" class="text-sm text-text-muted">先加载一个工作区目录</li>
        <li v-else-if="workspace.length === 0" class="text-sm text-text-muted">
          这个工作区还没有记忆
        </li>
        <li
          v-for="item in workspace"
          :key="item.id"
          class="flex items-start justify-between gap-3 rounded-md border border-surface-border px-3 py-2"
        >
          <div class="min-w-0">
            <div class="text-xs text-text-muted">{{ typeLabel[item.type] }}</div>
            <p class="mt-0.5 whitespace-pre-wrap text-sm text-text-main">{{ item.content }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 text-xs text-danger"
            @click="remove(item.id, 'workspace')"
          >
            删除
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
