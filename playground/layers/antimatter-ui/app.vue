<script setup lang="ts">
import { type ViewId, views } from "@playground/shared/content"

const props = defineProps<{ framework?: string, data?: string }>()
const config = useRuntimeConfig()
const stack = computed(() => ({ framework: props.framework ?? String(config.public.playgroundFramework ?? "Nuxt 3"), data: props.data ?? String(config.public.playgroundData ?? "SQLite") }))

const { view, search, data: loaded, busy, toasts, last, bannerOpen, go, newOrder, dismissBanner } = useAntimatter()
const current = computed(() => views[view.value])
const ordersCount = computed(() => loaded.value.orders?.status === "ready" ? (loaded.value.orders.payload as unknown[]).length : "")

onMounted(() => {
  try { bannerOpen.value = sessionStorage.getItem("antimatter.banner") !== "closed" } catch { /* private mode */ }
  const wanted = location.hash.replace("#/", "") as ViewId
  void go(viewIds.includes(wanted) ? wanted : "orders")
})
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"><AntimatterIcon name="logo" /></span>
        <div><strong>Antimatter</strong><small>Commerce admin</small></div>
      </div>
      <nav class="nav">
        <div class="nav-label">Workspace</div>
        <button v-for="id in viewIds" :key="id" class="nav-item" :class="{ active: view === id }" @click="go(id)">
          <AntimatterIcon :name="id" />{{ views[id].title }}
          <span v-if="id === 'orders' && ordersCount !== ''" class="count">{{ ordersCount }}</span>
        </button>
      </nav>
      <div class="sidebar-foot">
        <div class="env-card">
          <div class="row"><span class="dot" />{{ stack.framework }}</div>
          <p>{{ stack.data }} · local playground</p>
          <a class="btn" style="width: 100%; justify-content: center" href="/__sql-inspector/" target="_blank" rel="noopener"><AntimatterIcon name="external" />Open inspector</a>
        </div>
      </div>
    </aside>

    <div class="content">
      <header class="topbar">
        <div class="grow">
          <div class="crumbs">Antimatter / {{ current.title }}</div>
          <h1 class="page-title">{{ current.title }}</h1>
        </div>
        <label class="search"><AntimatterIcon name="search" /><input v-model="search" type="search" placeholder="Search" aria-label="Search"></label>
        <button class="btn primary" data-action="new-order" :disabled="busy === 'new-order'" @click="newOrder">
          <span v-if="busy === 'new-order'" class="spinner" /><AntimatterIcon v-else name="plus" />New order
        </button>
        <AntimatterAvatar name="Nhu Thin" />
      </header>

      <main class="page">
        <div v-if="bannerOpen" class="banner">
          <AntimatterIcon name="info" />
          <p><strong>Playground.</strong> Everything here calls the real API behind it, so each click is a request you can open in the <a href="/__sql-inspector/" target="_blank" rel="noopener">inspector</a>.</p>
          <button aria-label="Dismiss" @click="dismissBanner">✕</button>
        </div>
        <div class="view-head">
          <span class="pill" :class="current.pill.tone === 'warn' ? '' : current.pill.tone">Inspector: {{ current.pill.text }}</span>
          <p>{{ current.subtitle }}</p>
        </div>
        <AntimatterOrders v-if="view === 'orders'" />
        <AntimatterCustomers v-else-if="view === 'customers'" />
        <AntimatterReports v-else-if="view === 'reports'" />
        <AntimatterLoyalty v-else />
        <AntimatterExplain />
        <div class="footnote"><span>{{ last || "No request yet" }}</span><span>{{ stack.framework }} · {{ stack.data }}</span></div>
      </main>
    </div>
  </div>
  <AntimatterDrawer />
  <div class="toasts">
    <div v-for="item in toasts" :key="item.id" class="toast" :class="{ err: item.kind === 'err' }" :role="item.kind === 'err' ? 'alert' : 'status'">
      <div><strong>{{ item.title }}</strong><span>{{ item.message }}</span></div>
    </div>
  </div>
</template>
