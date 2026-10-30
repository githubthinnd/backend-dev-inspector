<script setup lang="ts">
defineProps<{ rows: number }>()
</script>

<template>
  <div class="card">
    <div v-for="row in rows" :key="row" class="sk-row"><div class="skeleton" /><div class="skeleton" /><div class="skeleton" /></div>
  </div>
</template>
