<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    icon: string
    defaultOpen?: boolean
  }>(),
  {
    defaultOpen: true
  }
)

const open = ref(props.defaultOpen)
</script>

<template>
  <section class="border-b border-surface-border last:border-b-0">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
      @click="open = !open"
    >
      <span class="material-symbols-outlined text-xl text-text-muted">{{ icon }}</span>
      <span class="flex-1 text-sm font-semibold text-text-main">{{ title }}</span>
      <span
        class="material-symbols-outlined text-xl text-text-muted transition-transform duration-150"
        :class="open ? 'rotate-180' : ''"
      >
        expand_more
      </span>
    </button>
    <div v-if="open" class="px-4 pb-4">
      <slot />
    </div>
  </section>
</template>
