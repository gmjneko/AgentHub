<script setup lang="ts">
import { onMounted } from 'vue'
import { authState, initAuth, isAuthenticated } from './stores/auth'
import { workspaceState } from './stores/workspace'
import WorkspaceSidebar from './components/WorkspaceSidebar.vue'
import AuthView from './views/AuthView.vue'
import ChatView from './views/ChatView.vue'
import AgentsView from './views/AgentsView.vue'
import SettingsView from './views/SettingsView.vue'

onMounted(initAuth)
</script>

<template>
  <div class="flex h-full w-full bg-background">
    <template v-if="!authState.ready">
      <div class="flex flex-1 items-center justify-center text-base text-text-muted">正在加载…</div>
    </template>

    <AuthView v-else-if="!isAuthenticated()" />

    <template v-else>
      <WorkspaceSidebar :user="authState.user" />
      <ChatView v-show="workspaceState.nav === 'workspace'" />
      <AgentsView v-show="workspaceState.nav === 'agents'" />
      <SettingsView v-show="workspaceState.nav === 'settings'" />
    </template>
  </div>
</template>
