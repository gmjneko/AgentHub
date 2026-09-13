<script setup lang="ts">
import { computed } from 'vue'
import type { TextMessage } from '../../api'
import { formatTime } from '../../utils/format'
import { renderMarkdown } from '../../utils/markdown'
import AttachmentList from './AttachmentList.vue'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: TextMessage }>()

const isSelf = (): boolean =>
  props.message.sender.role === 'user' && props.message.sender.id === 'me'

const renderedHtml = computed(() => renderMarkdown(props.message.text))
</script>

<template>
  <div v-if="isSelf()" class="flex justify-end space-x-3">
    <div class="flex max-w-[72%] flex-col items-end">
      <div
        class="whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-md font-medium text-white shadow-sm"
      >
        <div
          v-if="message.replyTo"
          class="mb-2 rounded-md border-l-2 border-white/60 bg-white/15 px-2.5 py-1.5 text-sm leading-[18px]"
        >
          <div class="font-semibold opacity-90">回复 {{ message.replyTo.senderName }}</div>
          <div class="line-clamp-2 break-words opacity-80">{{ message.replyTo.excerpt }}</div>
        </div>
        <span v-text="message.text"></span>
        <AttachmentList :attachments="message.attachments" inverse />
      </div>
      <span class="mt-1 text-xs text-text-muted">{{ formatTime(message.timestamp) }}</span>
    </div>
    <SenderAvatar :sender="message.sender" />
  </div>
  <div v-else class="flex items-start space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="min-w-0 flex-1 space-y-2">
      <div class="text-xs text-text-muted">
        {{ message.sender.name }} · {{ formatTime(message.timestamp) }}
      </div>
      <div
        v-if="message.replyTo"
        class="border-l-2 border-primary/50 pl-3 text-sm leading-5 text-text-muted"
      >
        <div class="font-medium text-text-main">回复 {{ message.replyTo.senderName }}</div>
        <div class="line-clamp-2 break-words">{{ message.replyTo.excerpt }}</div>
      </div>
      <div class="markdown-body text-md font-medium text-text-main" v-html="renderedHtml"></div>
      <AttachmentList :attachments="message.attachments" />
    </div>
  </div>
</template>
