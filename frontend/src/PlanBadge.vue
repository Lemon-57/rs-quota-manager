<script setup lang="ts">
import { computed } from 'vue'
import { ZTag } from '@codex-proxy/ui/tag'
const props = defineProps<{ plan: string | null; displayName: string }>()
const key = computed(() => props.plan?.trim().toLowerCase() || 'unknown')
const type = computed(() => key.value === 'team' || key.value === 'business' ? 'success' : key.value === 'plus' ? 'info' : key.value.startsWith('pro') ? 'primary' : 'default')
</script>
<template><ZTag :type="type" size="small" :title="displayName">{{ displayName }}</ZTag></template>
