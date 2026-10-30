<script setup lang="ts">
interface Row { id: number, status: string, totalCents: number, customer: { name: string, country: string } }

const { data, search, load } = useAntimatter()
const entry = computed(() => data.value.customers)
const shown = computed(() => ((entry.value?.payload as Row[] | undefined) ?? []).filter(row => !search.value || row.customer.name.toLowerCase().includes(search.value.toLowerCase())))
</script>

<template>
  <AntimatterSkeleton v-if="!entry || entry.status === 'loading'" :rows="6" />
  <AntimatterError v-else-if="entry.status === 'error'" :message="entry.message" @retry="load('customers', true)" />
  <div v-else-if="!shown.length" class="card"><div class="empty"><strong>No customers match "{{ search }}"</strong></div></div>
  <div v-else class="grid">
    <div v-for="row in shown" :key="row.id" class="card tile">
      <div class="top">
        <AntimatterAvatar :name="row.customer.name" size="lg" />
        <div><strong>{{ row.customer.name }}</strong><div class="muted">{{ FLAGS[row.customer.country] }} {{ COUNTRIES[row.customer.country] || row.customer.country }}</div></div>
      </div>
      <div class="meta">
        <div><div class="muted">Order #{{ row.id }}</div><span class="badge" :class="row.status">{{ row.status }}</span></div>
        <div class="amount">{{ money(row.totalCents) }}</div>
      </div>
    </div>
  </div>
</template>
