<script setup lang="ts">
const { data: scenarios } = await useFetch<Array<{ id: string, path: string, title: string, expect: string }>>("/api/scenarios")
</script>

<template>
  <main style="font: 16px/1.5 system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem">
    <h1>nuxt3-prisma</h1>
    <p>Open a scenario, then look at it in the inspector (the floating <strong>SQL</strong> button, or the link).</p>
    <a href="/__sql-inspector/">Open the inspector &rarr;</a>
    <ul>
      <li v-for="scenario in scenarios" :key="scenario.id" style="margin: 0.8rem 0">
        <a :href="scenario.path"><strong>{{ scenario.title }}</strong></a><br>
        <small style="color: #666">{{ scenario.expect }}</small>
      </li>
    </ul>
  </main>
</template>
