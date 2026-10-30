<script setup lang="ts">
const { drawer, busy, addItem } = useAntimatter()
const close = () => { drawer.value = null }
</script>

<template>
  <div class="scrim" :class="{ open: drawer }" @click="close" />
  <aside class="drawer" :class="{ open: drawer }" :aria-hidden="!drawer" @keydown.esc="close">
    <template v-if="drawer">
      <div class="drawer-head">
        <AntimatterAvatar :name="drawer.customerName" />
        <div><h2>Order #{{ drawer.id }}</h2><span class="muted">{{ drawer.customerName }}</span></div>
        <button class="x" aria-label="Close" @click="close">×</button>
      </div>
      <div class="drawer-body">
        <dl class="kv">
          <dt>Status</dt><dd><span class="badge" :class="drawer.status">{{ drawer.status }}</span></dd>
          <dt>Total</dt><dd>{{ money(drawer.totalCents) }}</dd>
          <dt>Customer #</dt><dd class="mono">{{ drawer.customerId }}</dd>
        </dl>
        <div class="banner"><AntimatterIcon name="info" /><p>Adding an item for an order that does not exist fails in the database. Try it and look at the error in the inspector.</p></div>
      </div>
      <div class="drawer-foot">
        <button class="btn danger" data-action="add-item" :disabled="busy === 'add-item'" @click="addItem"><span v-if="busy === 'add-item'" class="spinner" />Add gift item</button>
        <button class="btn" @click="close">Close</button>
      </div>
    </template>
  </aside>
</template>
