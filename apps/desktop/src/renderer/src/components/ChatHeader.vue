<script setup lang="ts">
import type { ChatDetail } from '../api'

defineProps<{ detail: ChatDetail | null }>()
</script>

<template>
  <header
    class="flex h-12 flex-shrink-0 items-center justify-between border-b border-surface-border/80 bg-background/80 px-6 backdrop-blur-[2px]"
  >
    <div class="min-w-0">
      <div class="flex min-w-0 items-center gap-2">
        <h1 class="truncate text-md font-semibold tracking-tight text-text-main">
          {{ detail?.title ?? '工作台' }}
        </h1>
        <span
          v-if="detail?.status"
          class="flex-shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success"
        >
          {{ detail.status }}
        </span>
      </div>
    </div>
    <div v-if="detail" class="flex-shrink-0 text-xs text-text-muted">
      {{ detail.agentCount }} {{ detail.agentCount === 1 ? 'Agent' : 'Agents' }}
    </div>
  </header>
</template>
