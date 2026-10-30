<script setup lang="ts">
interface Row { orderId: number, customer: { name: string, tier: string, points?: number } }

const { data, load } = useAntimatter()
const entry = computed(() => data.value.loyalty)
const rows = computed(() => (entry.value?.payload as Row[] | undefined) ?? [])
</script>

<template>
  <AntimatterSkeleton v-if="!entry || entry.status === 'loading'" :rows="4" />
  <AntimatterError v-else-if="entry.status === 'error'" :message="`The customer service did not answer: ${entry.message || 'unreachable'}. Is it running on port 4010?`" @retry="load('loyalty', true)" />
  <div v-else class="card">
    <div class="card-head"><h2>Loyalty members</h2><span class="muted">from the customer service</span></div>
    <div class="list">
      <div v-for="row in rows" :key="row.orderId" class="list-row">
        <AntimatterAvatar :name="row.customer.name" />
        <div class="grow"><strong>{{ row.customer.name }}</strong><div class="muted">Order #{{ row.orderId }}</div></div>
        <span class="muted">{{ Number(row.customer.points || 0).toLocaleString("en-US") }} pts</span>
        <span class="badge" :class="row.customer.tier">{{ row.customer.tier }}</span>
      </div>
    </div>
  </div>
</template>
