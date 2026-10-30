<script setup lang="ts">
defineProps<{ name: string, size?: "sm" | "lg" }>()
</script>

<template>
  <span class="avatar" :class="size" :style="{ '--avatar': hue(name) }" aria-hidden="true">{{ initials(name) }}</span>
</template>
