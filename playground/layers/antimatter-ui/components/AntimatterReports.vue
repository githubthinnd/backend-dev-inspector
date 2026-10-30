<script setup lang="ts">
const { runs, running, runReport } = useAntimatter()
const lastRun = computed(() => runs.value[0])
const rows = (count: number) => Number(count).toLocaleString("en-US")
</script>

<template>
  <div class="report">
    <div class="card">
      <div class="card-head"><h2>Revenue by period</h2><span class="pill err">Heavy query</span></div>
      <div class="report-body">
        <p class="muted" style="margin: 0">Scans the whole order history and aggregates it. It is slow on purpose: the inspector flags any statement over 100 ms.</p>
        <div class="meter" :class="{ busy: running }"><i :style="!running && lastRun ? 'width:100%' : ''" /></div>
        <div class="stat-line">
          <span class="muted">{{ lastRun ? "Last run" : "Ready" }}</span>
          <strong>{{ running ? "Running…" : lastRun ? `${rows(lastRun.rows)} rows in ${lastRun.ms} ms` : "—" }}</strong>
        </div>
        <div>
          <button class="btn primary" data-action="run-report" :disabled="running" @click="runReport">
            <template v-if="running"><span class="spinner" />Running</template>
            <template v-else><AntimatterIcon name="play" />Run report</template>
          </button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Recent runs</h2></div>
      <div class="list">
        <div v-for="(run, index) in runs" :key="index" class="list-row">
          <span class="mono muted">Run {{ runs.length - index }}</span>
          <span class="grow">{{ rows(run.rows) }} rows scanned</span>
          <strong class="mono">{{ run.ms }} ms</strong>
        </div>
        <div v-if="!runs.length" class="empty"><strong>No runs yet</strong><span>Run the report to see how long it takes.</span></div>
      </div>
    </div>
  </div>
</template>
