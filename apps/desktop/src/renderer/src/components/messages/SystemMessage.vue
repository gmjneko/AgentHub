<script setup lang="ts">
import type { SystemMessage } from '../../api'

defineProps<{ message: SystemMessage }>()
</script>

<template>
  <div class="flex justify-center">
    <span class="rounded-full bg-white/80 px-3 py-1 text-sm text-text-muted">
      {{ message.text }}
    </span>
  </div>
</template>
