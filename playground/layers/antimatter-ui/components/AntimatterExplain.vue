<script setup lang="ts">
import { views } from "@playground/shared/content"

const { view } = useAntimatter()
const steps = computed(() => {
  const { explain } = views[view.value]
  return [
    { n: 1, title: "What you are doing", text: explain.doing },
    { n: 2, title: "What the server runs", text: explain.server },
    { n: 3, title: "What to look for in the inspector", text: explain.look }
  ]
})
</script>

<template>
  <div class="card explain">
    <div class="card-head">
      <h2>Behind this screen</h2>
      <a class="btn" href="/__sql-inspector/" target="_blank" rel="noopener"><AntimatterIcon name="external" />Open the inspector</a>
    </div>
    <div class="steps">
      <div v-for="step in steps" :key="step.n" class="step">
        <span class="step-n">{{ step.n }}</span>
        <div><strong>{{ step.title }}</strong><p>{{ step.text }}</p></div>
      </div>
    </div>
  </div>
</template>
