<script setup lang="ts">
defineProps<{ message?: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="card">
    <div class="error-state">
      <strong>Something went wrong</strong>
      <span>{{ message || "The request failed." }}</span>
      <button class="btn" data-action="retry" @click="$emit('retry')">Try again</button>
    </div>
  </div>
</template>
