"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, opts = {}) => {
  if (n == null || isNaN(n)) return "—";
  const v = Number(n);
  const s = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: opts.cents === false ? 0 : 2, maximumFractionDigits: opts.cents === false ? 0 : 2 });
  return (v < 0 ? "−" : "") + s;
};
const iso = (d) => d.toISOString().slice(0, 10);
const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const prettyDate = (s, withYear = false) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
const weekday = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const state = { tab: "overview", start: null, end: null, account: "", merchant: null, kind: "", categories: [] };

async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message || body.detail || r.statusText), { status: r.status, body });
  return body;
}
function qs(extra = {}) {
  const p = new URLSearchParams({ start: state.start, end: state.end, ...extra });
  if (state.account) p.set("account", state.account);
  for (const [k, v] of [...p]) if (v === "" || v == null) p.delete(k);
  return p.toString();
}
// toast("Saved.") or toast("Marked…", { action: "Undo", onAction: fn }) — an action keeps it up longer.
function toast(msg, opts = {}) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${opts.action ? ` <button class="toast-act">${esc(opts.action)}</button>` : ""}`;
  t.hidden = false;
  if (opts.action) t.querySelector(".toast-act").onclick = () => { t.hidden = true; opts.onAction(); };
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), opts.action ? 8000 : 2600);
}
// Put a charge back to how Ledger categorized it (undoes "not a purchase").
async function restorePurchase(id, after) {
  await api(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_transfer: null }) });
  toast("Counted as a purchase again.");
  after && after();
}
// A button that needs a second click within a few seconds: protects against slips.
function armOrRun(btn, armedText, run) {
  if (btn.dataset.armed) { clearTimeout(btn._t); delete btn.dataset.armed; return run(); }
  btn.dataset.armed = "1"; btn._orig = btn._orig || btn.textContent;
  btn.textContent = armedText; btn.classList.add("armed");
  btn._t = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn._orig; btn.classList.remove("armed"); }, 4000);
}


/* ---------------- icons ---------------- */
// Simple line icons for categories (24×24, drawn with the current text color).
const CAT_ICONS = {
  "Shopping": "M6 8h12l-1 12H7L6 8z M9 8a3 3 0 0 1 6 0",
  "Groceries": "M3 4h2l2.4 11h10.2l2-8H6.3 M9 20h.01 M17 20h.01",
  "Dining": "M7 3v18 M4.5 3v5a2.5 2.5 0 0 0 5 0V3 M17 21V3c-2.5 1-3.5 4-3.5 8h3.5",
  "Rent": "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5",
  "Gas": "M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15 M4 20h11 M8 8h3 M14 10h2l2 2v5.5a1.5 1.5 0 0 0 3 0V9l-3-3",
  "Travel": "M3 11l18-7-7 18-2.5-8.5z M11.5 13.5L21 4",
  "Transport": "M5 16v-5l2-5h10l2 5v5 M3 16h18 M7 16v3 M17 16v3 M8 13h.01 M16 13h.01",
  "Subscriptions": "M20 11a8 8 0 0 0-14.6-4.5 M4 4v4h4 M4 13a8 8 0 0 0 14.6 4.5 M20 20v-4h-4",
  "Utilities": "M13 3L5 13h6l-1 8 8-10h-6z",
  "Health": "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  "Fitness": "M4 9v6 M7.5 6.5v11 M16.5 6.5v11 M20 9v6 M7.5 12h9",
  "Fees & interest": "M6 18L18 6 M7.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z M16.5 15a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  "Transfer": "M4 8h15l-3.5-3.5 M20 16H5l3.5 3.5",
  "Transfers out": "M4 8h15l-3.5-3.5 M20 16H5l3.5 3.5",
  "Transfers in": "M4 8h15l-3.5-3.5 M20 16H5l3.5 3.5",
  "Venmo payments": "M4 8h15l-3.5-3.5 M20 16H5l3.5 3.5",
  "Cash & withdrawals": "M3 7h18v10H3z M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z M6 10v4 M18 10v4",
  "Shipping & selling": "M3 8l9-4 9 4v8l-9 4-9-4z M3 8l9 4 9-4 M12 12v8",
  "Education": "M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13",
  "Student loans": "M2 9l10-5 10 5-10 5z M6 11v5c3 2.5 9 2.5 12 0v-5 M22 9v5",
  "eBay sales": "M3 12V4h8l10 10-8 8z M7.5 7.5h.01",
  "Marketplace sales": "M3 12V4h8l10 10-8 8z M7.5 7.5h.01",
  "Paycheck": "M3 8h18v12H3z M8 8V5h8v3 M3 13h18",
  "Interest": "M6 18L18 6 M7.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z M16.5 15a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  "Other income": "M12 4v11 M7 10l5 5 5-5 M4 20h16",
  "Refund": "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  "Rewards": "M4 11h16v9H4z M3 7h18v4H3z M12 7v13 M12 7c-1.5-3-5-3.5-5-1s3 1 5 1c2 0 5 1.5 5-1s-3.5-2-5 1",
  "Entertainment": "M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z M9 6v12",
  "Other": "M6 12h.01 M12 12h.01 M18 12h.01",
  "Shared bills": "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M9.5 15a1.5 1.5 0 1 0 0-.01 M14.5 15a1.5 1.5 0 1 0 0-.01",
  "Crypto": "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M9.5 8h4a2 2 0 0 1 0 4h-4z M9.5 12h4.5a2 2 0 0 1 0 4H9.5z M9.5 8v8 M11 6.5V8 M11 16v1.5",
  "Loan payment": "M2 9l10-5 10 5-10 5z M6 11v5c3 2.5 9 2.5 12 0v-5",
  "Auto & DMV": "M5 16v-5l2-5h10l2 5v5 M3 16h18 M7 16v3 M17 16v3 M8 13h.01 M16 13h.01",
  "_bank": "M3 10l9-6 9 6 M5 10v8 M9.7 10v8 M14.3 10v8 M19 10v8 M3 20.5h18",
  "_card": "M3 6h18v12H3z M3 10h18 M7 15h4",
};
// One soft hue per category so they're easy to tell apart at a glance.
const CAT_HUES = {
  "Shopping": 28, "Groceries": 95, "Dining": 12, "Rent": 210, "Gas": 45, "Travel": 195, "Transport": 230,
  "Subscriptions": 265, "Utilities": 52, "Health": 350, "Fitness": 160, "Fees & interest": 0,
  "Transfer": 200, "Transfers out": 200, "Transfers in": 150, "Venmo payments": 205, "Cash & withdrawals": 120,
  "Shipping & selling": 35, "Education": 280, "Student loans": 140, "eBay sales": 140, "Marketplace sales": 140,
  "Paycheck": 140, "Interest": 140, "Other income": 140, "Refund": 150, "Rewards": 320, "Crypto": 38, "Shared bills": 195, "Loan payment": 140, "Auto & DMV": 215, "Entertainment": 300, "Other": 40, "_bank": 160, "_card": 220,
};
function catSvg(cat) {
  const d = CAT_ICONS[cat] || CAT_ICONS.Other;
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
// A logo if we know the merchant's website; the category icon underneath until (unless) it loads.
function iconHTML({ domain, category, size = "" }) {
  const hue = CAT_HUES[category] ?? 40;
  const img = domain
    ? `<img src="/api/icon/${encodeURIComponent(domain)}" alt="" width="24" height="24" loading="lazy" onload="this.parentNode.classList.add('has-logo')" onerror="this.remove()">`
    : "";
  return `<span class="ic ${size}" style="--h:${hue}"><span class="ic-cat">${catSvg(category)}</span>${img}</span>`;
}
// Card balances: negative = owed, positive = a credit balance (the card owes you).
const owedOf = (a) => -(a.balance || 0);

/* ---------------- period ---------------- */
function setPeriod(kind) {
  const today = new Date();
  let s, e = today;
  if (kind === "this_month") s = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (kind === "last_month") { s = new Date(today.getFullYear(), today.getMonth() - 1, 1); e = new Date(today.getFullYear(), today.getMonth(), 0); }
  else if (kind === "30d") s = new Date(today - 29 * 864e5);
  else if (kind === "90d") s = new Date(today - 89 * 864e5);
  else if (kind === "ytd") s = new Date(today.getFullYear(), 0, 1);
  if (kind === "custom") {
    $("#custom-range").hidden = false;
    state.start = $("#start").value || state.start; state.end = $("#end").value || state.end;
  } else {
    $("#custom-range").hidden = true;
    state.start = localISO(s); state.end = localISO(e);
    $("#start").value = state.start; $("#end").value = state.end;
  }
}
function periodLabel() {
  const sameYear = state.start.slice(0, 4) === state.end.slice(0, 4);
  return `${prettyDate(state.start, !sameYear)} – ${prettyDate(state.end, true)}`;
}

/* ---------------- tabs ---------------- */
function showTab(name) {
  state.tab = name;
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  $(`.tabs [data-tab=${name}]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  location.hash = name;
  refresh();
}

function refresh() {
  loadBills();
  if (state.tab === "overview") loadOverview();
  else if (state.tab === "purchases") loadMerchants();
  else if (state.tab === "activity") loadActivity();
  else if (state.tab === "accounts") loadAccounts();
}

/* ---------------- overview ---------------- */
async function loadOverview() {
  const d = await api("/api/summary?" + qs());
  renderSyncState(d);
  $("#s-spend").textContent = fmt(d.spend);
  const delta = d.spend - d.previous_spend;
  $("#s-spend-sub").innerHTML = d.previous_spend
    ? `<span class="${delta > 0 ? "neg" : "pos"}">${delta > 0 ? "▲" : "▼"} ${fmt(Math.abs(delta), { cents: false })}</span> vs previous period`
    : `${d.purchase_count} purchases`;
  $("#s-income").textContent = fmt(d.income);
  $("#s-income-sub").textContent = d.refunds ? `+ ${fmt(d.refunds)} in refunds` : "";
  $("#s-net").textContent = fmt(d.net);
  $("#s-net").className = "value " + (d.net >= 0 ? "pos" : "neg");
  $("#s-cash").textContent = fmt(d.balances.cash);
  $("#s-owed").textContent = fmt(d.balances.credit_owed);
  $("#s-owed-sub").textContent = d.balances.utilization != null ? `${Math.round(d.balances.utilization * 100)}% of limits` : `paid ${fmt(d.card_payments, { cents: false })} this period`;
  $("#range-label").textContent = periodLabel();

  renderDailyChart(d.series);

  const maxC = Math.max(1, ...d.categories.map((c) => c.total));
  $("#cat-list").innerHTML = d.categories.length ? d.categories.slice(0, 9).map((c) => `
    <div class="row with-ic">${iconHTML({ category: c.category, size: "sm" })}<div class="name">${esc(c.category)}</div><div class="amt">${fmt(c.total)}</div>
    <div class="track"><div class="fill" style="width:${(c.total / maxC) * 100}%"></div></div></div>`).join("") : `<div class="empty">No spending in this period.</div>`;

  const maxM = Math.max(1, ...d.top_merchants.map((m) => m.total));
  $("#top-merchants").innerHTML = d.top_merchants.length ? d.top_merchants.map((m) => `
    <div class="row with-ic" data-merchant="${esc(m.merchant)}">${iconHTML({ domain: m.domain, category: m.category, size: "sm" })}<div class="name">${esc(m.merchant)} <span class="meta">· ${m.charges} charge${m.charges === 1 ? "" : "s"}</span></div>
    <div class="amt">${fmt(m.total)}</div><div class="track"><div class="fill" style="width:${(m.total / maxM) * 100}%"></div></div></div>`).join("") : `<div class="empty">Nothing yet.</div>`;
  $$("#top-merchants .row").forEach((r) => r.addEventListener("click", () => { state.merchant = r.dataset.merchant; showTab("purchases"); }));

  const acc = await api("/api/accounts");
  const cards = sortAccounts(acc.accounts.filter((a) => a.kind === "credit" && !a.hidden && !a.closed));
  $("#card-strip").innerHTML = cards.length ? cards.map((a) => {
    const days = a.next_due ? Math.round((new Date(a.next_due + "T12:00:00") - new Date()) / 864e5) : null;
    const owed = owedOf(a);
    return `<div class="mini-card">${iconHTML({ domain: a.domain, category: "_card" })}<div><div class="t">${esc(a.label)}</div><div class="o">${esc(a.org_name || "")}</div></div>
      <div><div class="b ${owed < 0 ? "pos" : ""}">${fmt(owed)}</div>${owed < 0 ? '<div class="due">credit balance</div>' : ""}
      <div class="due ${days != null && days <= 5 ? "soon" : ""}">${a.next_due ? `due ${prettyDate(a.next_due)}${days <= 5 ? ` · ${days === 0 ? "today" : days + "d"}` : ""}` : "set due date"}</div></div></div>`;
  }).join("") : `<div class="empty">No cards connected yet.</div>`;
}

function renderDailyChart(series) {
  const el = $("#chart-daily");
  if (!series.length) { el.innerHTML = ""; return; }
  const W = Math.max(320, el.clientWidth || 760), H = 220, P = { l: 48, r: 8, t: 10, b: 24 };
  const max = Math.max(10, ...series.map((s) => s.spend));
  const nice = niceMax(max);
  const bw = (W - P.l - P.r) / series.length;
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / nice);
  let g = "";
  for (let i = 0; i <= 3; i++) {
    const v = (nice / 3) * i, yy = y(v);
    g += `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${P.l - 6}" y="${yy + 4}" text-anchor="end">${fmt(v, { cents: false })}</text>`;
  }
  const step = Math.max(1, Math.ceil(series.length / Math.max(3, Math.floor(W / 90))));
  series.forEach((s, i) => {
    const w = Math.max(1, Math.min(28, bw * 0.7)), x = P.l + i * bw + (bw - w) / 2;
    if (s.spend > 0) g += `<rect class="bar" x="${x}" y="${y(s.spend)}" width="${w}" height="${H - P.b - y(s.spend)}" rx="2"><title>${weekday(s.date)}: ${fmt(s.spend)} spent${s.income ? `, ${fmt(s.income)} in` : ""}</title></rect>`;
    if (s.income > 0) g += `<circle class="inc" cx="${x + w / 2}" cy="${H - P.b - 4}" r="3"><title>${weekday(s.date)}: ${fmt(s.income)} in</title></circle>`;
    if (i % step === 0) g += `<text class="axis" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${prettyDate(s.date)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily spending">${g}</svg>`;
}
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 3, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* ---------------- purchases ---------------- */
async function loadMerchants() {
  const list = await api("/api/merchants?" + qs({ q: $("#m-search").value.trim(), category: $("#m-category").value }));
  const max = Math.max(1, ...list.map((m) => m.total));
  const total = list.reduce((a, m) => a + m.total, 0);
  $("#m-count").textContent = `${list.length} merchants · ${fmt(total)} · ${periodLabel()}`;
  $("#merchant-list").innerHTML = list.length ? list.map((m) => `
    <div class="m ${m.merchant === state.merchant ? "selected" : ""}" data-merchant="${esc(m.merchant)}">
      ${iconHTML({ domain: m.domain, category: m.category, size: "lg avatar" })}
      <div class="mn">${esc(m.merchant)}</div>
      <div class="mt">${fmt(m.total)}</div>
      <div class="ms">${esc(m.category || "")} · ${m.charges} charge${m.charges === 1 ? "" : "s"}${m.refunds ? ` · ${m.refunds} refund${m.refunds === 1 ? "" : "s"}` : ""} · last ${prettyDate(m.last_date)}</div>
      <div class="ms" style="text-align:right">${esc(shortAccounts(m.accounts))}</div>
      <div class="mbar"><span style="width:${(Math.max(0, m.total) / max) * 100}%"></span></div>
    </div>`).join("") : `<div class="empty">No purchases match.</div>`;
  $$("#merchant-list .m").forEach((r) => r.addEventListener("click", () => openMerchant(r.dataset.merchant)));
  if (state.merchant) openMerchant(state.merchant, false);
}
const initials = (s) => s.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
// "BANANAS, BANANAS, OTC" -> "2× Bananas, OTC"
function itemsText(memo) {
  const counts = new Map();
  for (const raw of memo.split(",").map((x) => x.trim()).filter(Boolean)) counts.set(raw, (counts.get(raw) || 0) + 1);
  const nice = (w) => w.length <= 3 ? w : w.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return [...counts].map(([k, n]) => (n > 1 ? `${n}× ` : "") + nice(k)).join(", ");
}
// A receipt attached to a charge: what was bought, and the email it came from.
function receiptHTML(rc) {
  const items = rc.items || [];
  const rows = items.map((it) => `<li><span>${it.quantity && it.quantity !== 1 ? `${it.quantity}× ` : ""}${esc(it.name)}</span>${it.price != null ? `<span>${fmt(it.price)}</span>` : ""}</li>`).join("");
  return `<div class="receipt rc">
    ${rc.summary ? `<div class="rc-sum">${esc(rc.summary)}</div>` : ""}
    ${rows ? `<ul class="rc-items">${rows}</ul>` : `<div class="muted">Receipt total ${fmt(rc.total)}${rc.source === "basic" ? " · items will be listed once the Mac's AI reads it" : ""}</div>`}
    <div class="rc-foot">${rc.order_number ? `<span class="muted">Order ${esc(rc.order_number)}</span>` : "<span></span>"}
      <span>${String(rc.email_id).startsWith("amazon") ? `<span class="muted">From your Amazon order history</span>`
        : `<button class="link" data-email="${esc(rc.email_id)}">Show receipt email</button>`}
      · <button class="link" data-wrong="${esc(rc.email_id)}">Wrong receipt?</button></span></div>
    <pre class="rc-email" hidden></pre>
  </div>`;
}
// "Wrong receipt?" and "Find it": detach a wrong match (with Undo), then offer nearby receipts to pick from.
async function showReceiptOptions(charge) {
  const box = charge.querySelector(".rc-pick");
  box.hidden = false; box.innerHTML = `<div class="muted">Looking for receipts near this date…</div>`;
  let opts = [];
  try { opts = await api(`/api/transactions/${encodeURIComponent(charge.dataset.id)}/receipt-options`); } catch {}
  box.innerHTML = (opts.length ? `<div class="muted">Is it one of these?</div>` + opts.map((o) => `
      <div class="pick-row"><span><strong>${esc(o.merchant || "Receipt")}</strong> ${fmt(o.total)} · ${prettyDate(o.order_date.slice(0, 10))}
        <span class="muted">${esc(o.summary || "")}</span></span><button class="ghost small" data-pick="${esc(o.email_id)}">This one</button></div>`).join("")
    : `<div class="muted">No unattached receipts near this date.</div>`) + `<button class="link" data-pick-close>Close</button>`;
  box.querySelector("[data-pick-close]").onclick = (ev) => { ev.stopPropagation(); box.hidden = true; };
  box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    try {
      await api(`/api/receipts/${encodeURIComponent(b.dataset.pick)}/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txn_id: charge.dataset.id }) });
      toast("Receipt attached."); openMerchant(state.merchant, false);
    } catch (e) { toast(e.message); }
  }));
}
function wireReceiptFixes(root) {
  root.querySelectorAll("[data-wrong]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const eid = b.dataset.wrong, charge = b.closest(".charge");
    try {
      const r = await api(`/api/receipts/${encodeURIComponent(eid)}/wrong`, { method: "POST" });
      b.closest(".rc").outerHTML = `<div class="receipt">Receipt removed from this charge.</div>`;
      toast("Receipt removed. It won't be matched to this charge again.", { action: "Undo", onAction: async () => {
        await api(`/api/receipts/${encodeURIComponent(eid)}/unwrong`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txn_id: r.txn_id }) });
        openMerchant(state.merchant, false);
      } });
      if (charge) showReceiptOptions(charge);
    } catch (e) { toast(e.message); }
  }));
  root.querySelectorAll("[data-attach]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation(); showReceiptOptions(b.closest(".charge"));
  }));
}
const receiptLine = (rc) => rc && (rc.summary || (rc.items || []).map((i) => i.name).slice(0, 4).join(", "));
function wireReceiptButtons(root) {
  root.querySelectorAll("[data-email]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const pre = b.closest(".rc").querySelector(".rc-email");
    if (!pre.hidden) { pre.hidden = true; b.textContent = "Show receipt email"; return; }
    if (!pre.textContent) {
      const e = await api(`/api/email/${encodeURIComponent(b.dataset.email)}`);
      pre.textContent = `${e.subject}\nFrom: ${e.sender} · ${e.received}\n\n${e.body.replace(/\(?https?:\/\/\S+\)?/g, "").replace(/\n\s*\n+/g, "\n")}`;
    }
    pre.hidden = false; b.textContent = "Hide receipt email";
  }));
}
const shortAccounts = (s) => (s || "").split(",").map((x) => x.replace(/\s*\(\.\.\.\d+\)/, "").trim()).join(", ");

async function openMerchant(name, scroll = true) {
  state.merchant = name;
  $$("#merchant-list .m").forEach((r) => r.classList.toggle("selected", r.dataset.merchant === name));
  const rows = await api(`/api/merchant?` + qs({ name }));
  $(".split").classList.add("open");
  const d = $("#detail"); d.hidden = false;
  const charges = rows.filter((r) => r.amount < 0), refunds = rows.filter((r) => r.amount > 0);
  const net = -rows.reduce((a, r) => a + r.amount, 0);
  $("#d-name").textContent = name;
  $("#d-icon").innerHTML = iconHTML({ domain: rows[0]?.domain, category: rows[0]?.category, size: "xl" });
  $("#d-category").textContent = rows[0]?.category || "";
  $("#d-meta").textContent = `${charges.length} charge${charges.length === 1 ? "" : "s"}${refunds.length ? `, ${refunds.length} refund${refunds.length === 1 ? "" : "s"}` : ""} · ${periodLabel()}`;
  $("#d-total").textContent = fmt(net);
  $("#d-charges").innerHTML = rows.map((r) => `
    <div class="charge" data-id="${esc(r.id)}">
      <div class="line">
        <div class="date">${weekday(r.date)}${r.pending ? '<span class="pill">pending</span>' : ""}${r.amount > 0 ? '<span class="pill refund">refund</span>' : ""}</div>
        <div class="amt ${r.amount > 0 ? "pos" : ""}">${r.amount > 0 ? "+" : ""}${fmt(Math.abs(r.amount))}</div>
        <div class="acct">${esc(r.account_label)}</div><div></div>
      </div>
      <div class="more">
        <div><span class="k">Bank description:</span> ${esc(r.description)}</div>
        ${r.receipt ? receiptHTML(r.receipt)
          : r.memo ? `<div class="receipt items"><span class="k">Items:</span> ${esc(itemsText(r.memo))}</div>`
          : `<div class="receipt">No receipt found for this charge. <button class="link" data-attach>Find it</button></div>`}
        <div class="rc-pick" hidden></div>
        <div class="actions">
          <button data-act="transfer">Not a purchase (payment/transfer)</button>
        </div>
      </div>
    </div>`).join("");
  $$("#d-charges .charge .line").forEach((l) => l.addEventListener("click", () => l.parentElement.classList.toggle("open")));
  wireReceiptButtons($("#d-charges"));
  wireReceiptFixes($("#d-charges"));
  $$("#d-charges [data-act=transfer]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    armOrRun(b, "Sure? Click again: it won't count as spending", async () => {
      const id = b.closest(".charge").dataset.id;
      await api(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_transfer: true }) });
      loadMerchants();
      toast("Marked as not a purchase.", { action: "Undo", onAction: () => restorePurchase(id, loadMerchants) });
    });
  }));
  $("#d-rename").value = name;
  $("#d-cat").innerHTML = state.categories.map((c) => `<option ${c === rows[0]?.category ? "selected" : ""}>${esc(c)}</option>`).join("");
  $("#d-save").onclick = async () => {
    const first = rows[0]; if (!first) return;
    const body = { merchant: $("#d-rename").value.trim() || null, category: $("#d-cat").value };
    await api(`/api/transactions/${encodeURIComponent(first.id)}?apply_to_merchant=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    state.merchant = body.merchant || name;
    toast("Saved. Future charges from this merchant keep the change.");
    await loadCategories();
    loadMerchants();
  };
  if (scroll && window.innerWidth < 1100) d.scrollIntoView({ behavior: "smooth" });
}
function closeMerchant() {
  state.merchant = null;
  $("#detail").hidden = true;
  $(".split").classList.remove("open");
  $$("#merchant-list .m").forEach((r) => r.classList.remove("selected"));
}

/* ---------------- activity ---------------- */
async function loadActivity() {
  const rows = await api("/api/transactions?" + qs({ q: $("#a-search").value.trim(), kind: state.kind }));
  const inSum = rows.filter((r) => r.amount > 0 && !r.is_transfer && r.account_kind !== "credit" && !["Shared bills", "Refund"].includes(r.category)).reduce((a, r) => a + r.amount, 0);
  const refundLike = (r) => ["Shared bills", "Refund"].includes(r.category);
  const outSum = rows.filter((r) => !r.is_transfer && (r.amount < 0 || r.account_kind === "credit" || refundLike(r))).reduce((a, r) => a - r.amount, 0);
  $("#a-count").textContent = `${rows.length} transactions · in ${fmt(inSum)} · spent ${fmt(outSum)}`;
  let html = "", last = null;
  for (const r of rows) {
    if (r.date !== last) { html += `<tr class="day"><td colspan="4">${weekday(r.date)}</td></tr>`; last = r.date; }
    const cls = r.is_transfer ? "transfer" : "";
    const amtCls = r.is_transfer ? "" : r.amount > 0 ? "pos" : "";
    const undo = r.manual_transfer === 1 && r.amount < 0
      ? `<div class="desc">You marked this as not a purchase · <button class="link" data-restore="${esc(r.id)}">Count as purchase</button></div>` : "";
    html += `<tr class="${cls}"><td><div class="tx-m">${iconHTML({ domain: r.domain, category: r.category, size: "sm" })}<div><div>${esc(r.merchant)}${r.pending ? '<span class="pill">pending</span>' : ""}</div>${undo}<div class="desc">${esc(r.description)}</div>${r.receipt ? `<div class="desc items">🧾 ${esc(receiptLine(r.receipt) || "Receipt " + fmt(r.receipt.total))}</div>` : r.memo ? `<div class="desc items">${esc(itemsText(r.memo))}</div>` : ""}</div></div></td>
      <td class="hide-sm">${esc(r.category)}</td><td class="hide-sm muted">${esc(r.account_label)}</td>
      <td class="num ${amtCls}">${r.amount > 0 ? "+" : ""}${fmt(r.amount).replace("−", "−")}</td></tr>`;
  }
  $("#a-rows").innerHTML = html || `<tr><td colspan="4" class="empty">No transactions.</td></tr>`;
  $$("#a-rows [data-restore]").forEach((b) => b.addEventListener("click", () => restorePurchase(b.dataset.restore, loadActivity)));
}

/* ---------------- accounts ---------------- */
// Which bank an account belongs to, for grouping (the card's issuer, not the store brand on it).
const ISSUER_ORDER = ["Chase", "Capital One", "Discover", "Synchrony"];
function issuerOf(a) {
  const d = (a.domain || "") + " " + (a.org_name || "");
  if (/chase/i.test(d)) return "Chase";
  if (/capitalone|capital one/i.test(d)) return "Capital One";
  if (/discover/i.test(d)) return "Discover";
  if (/onepay|synchrony|syf/i.test(d)) return "Synchrony";
  return a.org_name || "Other";
}
const issuerRank = (name) => { const i = ISSUER_ORDER.indexOf(name); return i < 0 ? 99 : i; };
function sortAccounts(list) {
  const tucked = (a) => (a.hidden || a.closed ? 1 : 0);
  return [...list].sort((x, y) =>
    tucked(x) - tucked(y) || issuerRank(issuerOf(x)) - issuerRank(issuerOf(y)) || issuerOf(x).localeCompare(issuerOf(y)) ||
    (x.position ?? 999) - (y.position ?? 999) || x.label.localeCompare(y.label));
}
const SHOW_HIDDEN_KEY = "ledger.showHiddenAccounts";
function showHidden() { try { return localStorage.getItem(SHOW_HIDDEN_KEY) === "1"; } catch { return false; } }

function accountCardHTML(a, now) {
  const isCredit = a.kind === "credit";
  const owed = isCredit ? owedOf(a) : null;
  const bal = a.closed ? 0 : isCredit ? owed : a.balance;
  const util = isCredit && a.credit_limit ? Math.max(0, owed) / a.credit_limit : null;
  const ageDays = a.balance_date ? (now - a.balance_date) / 86400 : null;
  const asof = a.balance_date ? new Date(a.balance_date * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
  const tags = [a.closed ? "closed" : "", a.hidden ? "hidden" : ""].filter(Boolean).join(" · ");
  return `<div class="acard ${a.hidden || a.closed ? "dim" : ""}" data-id="${esc(a.id)}">
    <div class="top-row"><div class="acct-id">${iconHTML({ domain: a.domain, category: isCredit ? "_card" : "_bank", size: "lg" })}<div><div class="org">${isCredit ? "credit card" : esc(a.org_name || "") + " · " + esc(a.kind)}${tags ? " · " + tags : ""}</div><div class="nm">${esc(a.label)}</div></div></div>
      <div style="text-align:right"><div class="bal ${isCredit && owed < 0 ? "pos" : ""}">${fmt(bal)}</div><div class="muted">${isCredit ? (owed < 0 ? "credit balance" : "owed") : a.available_balance != null && a.available_balance !== a.balance ? fmt(a.available_balance) + " available" : "balance"}</div></div></div>
    ${util != null ? `<div><div class="util ${util > 0.3 ? "high" : ""}"><span style="width:${Math.min(100, util * 100)}%"></span></div>
      <div class="muted" style="margin-top:4px">${Math.round(util * 100)}% of ${fmt(a.credit_limit, { cents: false })} limit · ${fmt(a.credit_limit - owed, { cents: false })} available</div></div>` : ""}
    ${(a.rewards || []).map((r) => `<div class="reward-note ${r.applied ? "done" : ""}">${r.applied
        ? `✓ ${fmt(r.amount)} rewards credit applied ${prettyDate(r.applied)}`
        : `${fmt(r.amount)} rewards credit on the way${r.points ? ` (${r.points.toLocaleString()} points)` : ""}${r.expected ? ` · by ${prettyDate(r.expected)}` : ""}`}</div>`).join("")}
    ${trendHTML(a, isCredit)}
    <div style="display:flex;justify-content:space-between;gap:8px">
      <span class="asof ${ageDays != null && ageDays > 3 && !a.closed ? "stale" : ""}">${a.id.startsWith("stmt:") ? "From statements, last" : "Updated"} ${asof}${ageDays != null && ageDays > 3 && !a.closed && !a.id.startsWith("stmt:") ? " (stale)" : ""}</span>
      ${billChip(a)}</div>
    ${a.error ? `<div class="banner" style="margin:0">${esc(a.error)}</div>` : ""}
    <details><summary>Edit details</summary>
      <div class="edit">
        <label>Nickname<input name="nickname" value="${esc(a.nickname || "")}" placeholder="${esc(a.name)}"></label>
        <label>Type<select name="kind">${["checking", "savings", "credit", "other"].map((k) => `<option ${k === a.kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>
        <label>Payment due day<input name="due_day" type="number" min="1" max="31" value="${a.due_day ?? ""}" placeholder="e.g. 15"></label>
        <label>Credit limit<input name="credit_limit" type="number" min="0" step="100" value="${a.credit_limit ?? ""}"></label>
        <label>Order within ${esc(issuerOf(a))}<input name="position" type="number" min="1" max="99" value="${a.position ?? ""}" placeholder="1 = top"></label>
        <span></span>
        <label class="check"><input name="closed" type="checkbox" ${a.closed ? "checked" : ""}> Account is closed (keep its history, count balance as $0)</label>
        <label class="check"><input name="hidden" type="checkbox" ${a.hidden ? "checked" : ""}> Hide this account and its transactions</label>
        <button data-save>Save</button>
      </div>
    </details>
  </div>`;
}

async function loadAccounts() {
  if (!BILLS.length) await loadBills();
  const { accounts, totals } = await api(`/api/accounts?${new URLSearchParams({ start: state.start, end: state.end })}`);
  $("#acc-cash").textContent = fmt(totals.cash);
  $("#acc-owed").textContent = fmt(totals.credit_owed);
  $("#acc-util").textContent = totals.utilization != null ? Math.round(totals.utilization * 100) + "%" : "—";
  $("#acc-util-sub").textContent = totals.utilization != null ? "owed ÷ total credit limits" : "add credit limits below";
  const now = Date.now() / 1000;
  const reveal = showHidden();
  const tucked = accounts.filter((a) => a.hidden || a.closed);
  const shown = sortAccounts(accounts.filter((a) => reveal || !(a.hidden || a.closed)));
  const banks = shown.filter((a) => a.kind !== "credit");
  const cards = shown.filter((a) => a.kind === "credit");

  // Credit cards: one column per bank, cards stacked inside it.
  const groups = [];
  for (const a of cards) {
    const name = issuerOf(a);
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, domain: a.domain, list: [] }));
    g.list.push(a);
  }
  const groupOwed = (g) => g.list.reduce((t, a) => t + (a.closed ? 0 : owedOf(a)), 0);

  $("#account-cards").innerHTML = accounts.length ? `
    ${banks.length ? `<div class="acct-section">
      <div class="acct-head"><h3>Bank accounts</h3><span class="muted">${fmt(totals.cash)}</span></div>
      <div class="bank-row">${banks.map((a) => accountCardHTML(a, now)).join("")}</div>
    </div>` : ""}
    ${banks.length && cards.length ? `<hr class="acct-divider">` : ""}
    ${cards.length ? `<div class="acct-section">
      <div class="acct-head"><h3>Credit cards</h3><span class="muted">${fmt(totals.credit_owed)} owed</span></div>
      <div class="issuer-cols">${groups.map((g) => `
        <div class="issuer-col">
          <div class="issuer-head">${iconHTML({ domain: g.domain, category: "_card", size: "sm" })}<span class="issuer-name">${esc(g.name)}</span>
            <span class="muted">${g.list.length > 1 ? fmt(groupOwed(g)) : ""}</span></div>
          ${g.list.map((a) => accountCardHTML(a, now)).join("")}
        </div>`).join("")}
      </div>
    </div>` : ""}
    <hr class="acct-divider">
    <div class="acct-section" id="bills-section">${billsSectionHTML()}</div>
    ${tucked.length ? `<div class="acct-toggle"><button class="ghost" id="toggle-hidden">${reveal ? "Hide" : "Show"} hidden &amp; closed accounts (${tucked.length})</button></div>` : ""}
  ` : `<div class="empty">No accounts yet. Run <code>finance setup</code> in Terminal.</div>`;

  wireSparkHover($("#account-cards"));
  wireBillsSection($("#bills-section"));
  $("#toggle-hidden")?.addEventListener("click", () => {
    try { localStorage.setItem(SHOW_HIDDEN_KEY, reveal ? "0" : "1"); } catch {}
    loadAccounts();
  });
  $$("#account-cards [data-save]").forEach((b) => b.addEventListener("click", async (ev) => {
    const card = ev.target.closest(".acard");
    const val = (n) => card.querySelector(`[name=${n}]`);
    const body = {
      nickname: val("nickname").value.trim(),
      kind: val("kind").value,
      due_day: val("due_day").value ? Number(val("due_day").value) : "",
      credit_limit: val("credit_limit").value ? Number(val("credit_limit").value) : "",
      position: val("position").value ? Number(val("position").value) : "",
      hidden: val("hidden").checked ? 1 : 0,
      closed: val("closed").checked ? 1 : 0,
    };
    try {
      await api(`/api/accounts/${encodeURIComponent(card.dataset.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast("Saved."); loadAccounts(); loadAccountFilter();
    } catch (e) { toast(e.message); }
  }));
}
// Balance over the selected period. Cards plot what you owe, so "up" means more debt.
function trendHTML(a, isCredit) {
  const t = a.trend;
  if (!t || t.points.length < 2) return `<div class="spark empty-spark muted">No balance history for this period</div>`;
  const val = (b) => (isCredit ? -b : b);
  const pts = t.points.map((p) => ({ date: p.date, v: val(p.balance) }));
  const ch = val(t.end) - val(t.start);
  const good = isCredit ? ch < 0 : ch > 0;
  const flat = Math.abs(ch) < 0.005;
  const arrow = flat ? "" : ch > 0 ? "▲" : "▼";
  const what = isCredit ? (flat ? "no change in balance" : ch > 0 ? "more owed" : "less owed") : flat ? "no change" : "";
  const late = t.from > state.start ? ` (data starts ${prettyDate(t.from)})` : ` since ${prettyDate(t.from)}`;
  return `<div class="trend">
    <div class="trend-row"><span class="chg ${flat ? "" : good ? "good" : "bad"}">${arrow} ${fmt(Math.abs(ch))} ${what}</span><span class="muted">${late}</span></div>
    <div class="spark" data-points='${esc(JSON.stringify(pts))}'>${sparkSvg(pts.map((p) => p.v))}<span class="spark-dot" hidden></span></div>
    <div class="spark-read muted">${fmt(pts[0].v)} → ${fmt(pts[pts.length - 1].v)}</div>
  </div>`;
}
function sparkSvg(vals) {
  const W = 300, H = 56;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const y = (v) => H - 5 - ((v - min) / span) * (H - 10);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path class="area" d="M0,${H} L${pts.join(" L")} L${W},${H} Z"/>
    <line class="base" x1="0" x2="${W}" y1="${y(vals[0]).toFixed(1)}" y2="${y(vals[0]).toFixed(1)}"/>
    <path d="M${pts.join(" L")}"/></svg>`;
}
// Hover a graph to read the balance on that day.
function wireSparkHover(root) {
  root.querySelectorAll(".spark[data-points]").forEach((el) => {
    const pts = JSON.parse(el.dataset.points);
    const read = el.parentNode.querySelector(".spark-read");
    const dot = el.querySelector(".spark-dot");
    const resting = read.textContent;
    const vals = pts.map((p) => p.v), min = Math.min(...vals), span = Math.max(...vals) - min || 1;
    el.addEventListener("mousemove", (ev) => {
      const r = el.getBoundingClientRect();
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (pts.length - 1))));
      read.textContent = `${prettyDate(pts[i].date)}: ${fmt(pts[i].v)}`;
      dot.hidden = false;
      dot.style.left = `${(i / (pts.length - 1)) * 100}%`;
      dot.style.top = `${((56 - 5 - ((pts[i].v - min) / span) * 46) / 56) * 100}%`;
    });
    el.addEventListener("mouseleave", () => { read.textContent = resting; dot.hidden = true; });
  });
}

function sparkline(h) {
  if (!h || h.length < 2) return "";
  const W = 300, H = 44, vals = h.map((x) => x.balance);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - 4 - ((v - min) / span) * (H - 8)}`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="M${pts.join(" L")}"/></svg>`;
}

/* ---------------- payment reminders ---------------- */
let BILLS = [];
const billByAccount = (id) => BILLS.find((b) => b.account_id === id);
function dueWhen(b) {
  const d = b.days_left;
  if (d < 0) return `was due ${prettyDate(b.due_date)}`;
  return d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`;
}
function paidVia(b) {
  const src = { bank: "bank", email: "email", manual: "you" };
  const last = b.payments[b.payments.length - 1];
  return last ? `${fmt(b.paid)} · ${last.source === "manual" ? "marked by you" : "via " + src[last.source]} ${prettyDate(last.date)}` : "";
}
async function loadBills() {
  try { BILLS = await api("/api/reminders"); } catch { BILLS = []; }
  const el = $("#bills");
  const urgent = BILLS.filter((b) => b.status === "overdue" || b.status === "due_soon");
  const recentPaid = BILLS.filter((b) => b.status === "paid" && b.days_left >= -3 && b.days_left <= 7);
  if (!urgent.length && !recentPaid.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = urgent.map((b) => `
    <div class="bill ${b.status}" data-acct="${esc(b.account_id)}">
      <span class="bill-dot"></span>
      <div class="bill-main"><strong>${esc(b.label)}</strong> ${dueWhen(b)}
        <span class="muted">· ${billAmountText(b)}${b.min_due ? ` · ${fmt(b.min_due)} minimum` : ""}${b.paid ? ` · ${fmt(b.paid)} paid so far` : ""}</span>
        ${b.bank_window?.length ? `<div class="bill-sub">${bankWindowText(b)}${b.note ? " · " + esc(b.note) : ""}</div>` : b.note ? `<div class="bill-sub">${esc(b.note)}</div>` : ""}</div>
      <div class="bill-act">
        <button class="ghost small" data-markpaid>Mark as paid</button>
        <span class="markpaid-form" hidden><input type="number" step="0.01" min="0.01" placeholder="Amount" value="${b.remaining > 0 ? b.remaining.toFixed(2) : ""}"><button class="small" data-confirm>Save</button></span>
      </div>
    </div>`).join("") + (recentPaid.length ? `<div class="bill paid-row"><span class="paid-title">✓ Paid</span>${recentPaid.map((b) => `<span class="paid-item">${esc(b.label)} <span class="muted">${paidVia(b)}</span>${manualUndo(b)}</span>`).join("")}</div>` : "");
  wireBillActions(el);
}
function billAmountText(b) {
  if (b.amount_due == null) return "";
  if (b.kind === "bill") return fmt(b.amount_due) + (b.amount_is_typical ? " usual" : "");
  return fmt(b.amount_due) + (b.amount_is_statement ? " statement balance" : " current balance");
}
const shortDay = (iso) => new Date(iso + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
function bankWindowText(b) {
  const w = b.bank_window || [];
  if (!w.length) return "";
  const today = localISO(new Date());
  const left = w.filter((d) => d >= today).length;
  const span = w.length > 1 ? `${shortDay(w[0])} – ${shortDay(w[w.length - 1])}` : shortDay(w[0]);
  return `Bank days: ${span}${w.includes(today) ? ` · ${left === 1 ? "today is the last one" : left + " left, including today"}` : ""}`;
}
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

/* Bills that aren't cards: rent, utilities. */
function billsSectionHTML() {
  const list = BILLS.filter((b) => b.kind === "bill").sort((a, b) => (a.due_day || 99) - (b.due_day || 99));
  const card = (b) => {
    const chip = b.status === "needs_due_day" ? `<span class="chip soon">Set the due day</span>`
      : b.status === "paid" ? `<span class="chip paid" title="${esc(paidVia(b))}">✓ Paid · ${prettyDate(b.due_date)}</span>`
      : `<span class="chip ${b.status === "overdue" ? "overdue" : b.status === "due_soon" ? "soon" : ""}">${b.status === "overdue" ? "Overdue · " + prettyDate(b.due_date) : "Due " + prettyDate(b.due_date)}</span>`;
    return `<div class="acard bill-card" data-payee="${b.payee_id}" data-acct="${esc(b.account_id)}">
      <div class="top-row"><div class="acct-id">${iconHTML({ domain: billDomain(b.label), category: b.category || "Utilities", size: "lg" })}
        <div><div class="org">${b.due_day ? `due the ${ordinal(b.due_day)}` : "bill"}${b.bank_days ? ` · ${b.bank_days} bank days ahead` : ""}</div><div class="nm">${esc(b.label)}</div></div></div>
        <div style="text-align:right"><div class="bal">${b.amount_due != null ? fmt(b.amount_due) : "—"}</div><div class="muted">${b.from_bill && !b.amount_is_typical ? "from your bill" : b.amount_is_typical ? "usual amount" : b.amount_due != null ? "amount" : "no payments found yet"}</div></div></div>
      ${b.bank_window?.length && b.status !== "paid" ? `<div class="muted">${bankWindowText(b)}</div>` : ""}
      ${b.note ? `<div class="muted">${esc(b.note)}</div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span class="muted">${b.payments.length ? "Last: " + paidVia(b) : ""}</span>${chip}</div>
      <details ${b.status === "needs_due_day" ? "open" : ""}><summary>Edit bill</summary>${billFormHTML(b)}</details>
    </div>`;
  };
  return `<div class="acct-head"><h3>Bills</h3><span class="muted">rent, utilities and other bills you pay yourself</span></div>
    <div class="bank-row">${list.map(card).join("")}
      <div class="acard bill-card add-bill"><details><summary>+ Add a bill</summary>${billFormHTML(null)}</details></div>
    </div>`;
}
function billDomain(name) {
  const n = (name || "").toLowerCase();
  if (/duke/.test(n)) return "duke-energy.com";
  if (/spectrum/.test(n)) return "spectrum.com";
  return null;
}
function billFormHTML(b) {
  const v = (k) => (b && b[k] != null ? esc(String(b[k])) : "");
  return `<div class="edit bill-form">
    <label>Name<input type="text" name="name" value="${v("label")}" placeholder="e.g. Duke Energy"></label>
    <label>Due day of month<input name="due_day" type="number" min="1" max="31" value="${v("due_day")}" placeholder="e.g. 15"></label>
    <label>Amount<input name="amount" type="number" min="0" step="0.01" value="${b && !b.from_bill && !b.amount_is_typical && b.amount_due != null ? b.amount_due : ""}" placeholder="blank = what you usually pay"></label>
    <label>Bank days ahead<input name="bank_days" type="number" min="0" max="10" value="${b && b.bank_days ? b.bank_days : ""}" placeholder="0 = normal reminders"></label>
    <label>Next bill due (if it moves)<input name="next_due" type="date" value="${b && b.from_bill ? b.due_date : ""}"></label>
    <label>Next bill amount<input name="next_amount" type="number" min="0" step="0.01" value="${b && b.from_bill && !b.amount_is_typical && b.amount_due != null ? b.amount_due : ""}" placeholder="from the bill"></label>
    <label>Payment shows up as<input type="text" name="match" value="${v("match")}" placeholder="words in the bank description"></label>
    <label>Note<input type="text" name="note" value="${v("note")}" placeholder="e.g. cashier's check at the bank"></label>
    <div class="form-actions">${b ? `<button class="ghost small" data-remove>Remove</button>` : "<span></span>"}<button data-save-bill>${b ? "Save" : "Add bill"}</button></div>
  </div>`;
}
function wireBillsSection(root) {
  if (!root) return;
  wireBillActions(root);
  root.querySelectorAll("[data-save-bill]").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest(".bill-card");
    const f = (n) => card.querySelector(`[name=${n}]`).value.trim();
    const body = { name: f("name"), due_day: f("due_day") ? Number(f("due_day")) : "", amount: f("amount") ? Number(f("amount")) : "",
      bank_days: f("bank_days") ? Number(f("bank_days")) : 0, match: f("match"), note: f("note"),
      next_due: f("next_due"), next_amount: f("next_amount") ? Number(f("next_amount")) : "" };
    if (!body.name) return toast("Give the bill a name.");
    const id = card.dataset.payee;
    if (!id && !body.match) delete body.match;   // the server matches on the name
    try {
      await api(id ? `/api/payees/${id}` : "/api/payees", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast(id ? "Saved." : "Bill added."); BILLS = []; refresh();
    } catch (e) { toast(e.message); }
  }));
  root.querySelectorAll("[data-remove]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!btn.dataset.armed) { btn.dataset.armed = "1"; btn.textContent = "Click again to remove"; return; }
    const id = btn.closest(".bill-card").dataset.payee;
    try { await api(`/api/payees/${id}`, { method: "DELETE" }); toast("Bill removed."); BILLS = []; refresh(); }
    catch (e) { toast(e.message); }
  }));
}

function manualUndo(b) {
  const m = [...b.payments].reverse().find((p) => p.source === "manual");
  return m ? ` <button class="link" data-undo="${esc(m.id)}">undo</button>` : "";
}
function wireBillActions(root) {
  root.querySelectorAll("[data-markpaid]").forEach((btn) => btn.addEventListener("click", () => {
    const f = btn.parentNode.querySelector(".markpaid-form");
    f.hidden = !f.hidden; btn.hidden = !f.hidden ? true : false;
    f.querySelector("input").focus();
  }));
  root.querySelectorAll("[data-confirm]").forEach((btn) => btn.addEventListener("click", async () => {
    const acct = btn.closest("[data-acct]").dataset.acct;
    const v = btn.parentNode.querySelector("input").value;
    try {
      await api(`/api/reminders/${encodeURIComponent(acct)}/paid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: v ? Number(v) : null }) });
      toast("Marked as paid. It will match up when the payment posts.");
      refresh();
    } catch (e) { toast(e.message); }
  }));
  root.querySelectorAll("[data-undo]").forEach((btn) => btn.addEventListener("click", async () => {
    try { await api(`/api/reminders/confirmations/${encodeURIComponent(btn.dataset.undo)}`, { method: "DELETE" }); refresh(); }
    catch (e) { toast(e.message); }
  }));
}
function billChip(a) {
  const b = billByAccount(a.id);
  if (!b || b.status === "nothing_due") return a.next_due && !a.closed ? `<span class="muted">Due ${prettyDate(a.next_due)}</span>` : "";
  if (b.status === "paid") return `<span class="chip paid" title="${esc(paidVia(b))}">✓ Paid · ${prettyDate(b.due_date)}</span>`;
  const cls = b.status === "overdue" ? "overdue" : b.status === "due_soon" ? "soon" : "";
  return `<span class="chip ${cls}">${b.status === "overdue" ? "Overdue" : "Due " + prettyDate(b.due_date)}${b.min_due ? ` · ${fmt(b.min_due)} min` : ""}</span>`;
}

/* ---------------- sync ---------------- */
function renderSyncState(d) {
  const btn = $("#sync-btn"), label = $("#sync-label");
  btn.classList.remove("stale", "error");
  const ls = d.last_sync;
  if (d.demo) { label.textContent = "Demo data"; btn.classList.add("stale"); }
  else if (!d.connected && !ls) { label.textContent = "Not connected"; btn.classList.add("error"); }
  else if (ls) {
    const when = new Date(ls.started * 1000);
    const mins = (Date.now() - when) / 60000;
    label.textContent = "Synced " + (mins < 2 ? "just now" : mins < 60 ? `${Math.round(mins)}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : when.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    if (ls.status === "error") btn.classList.add("error");
    else if (ls.status === "partial" || mins > 1440 * 1.5) btn.classList.add("stale");
  }
  const notes = [];
  if (ls && ls.status !== "ok" && ls.message) notes.push(ls.message);
  (d.nudges || []).forEach((n) => notes.push(n));
  if (d.stale && d.stale.length) notes.push(`Bank data hasn't refreshed in 3+ days for: ${d.stale.map((a) => a.label).join(", ")}. Missing spending there may just be delayed.`);
  const b = $("#banner");
  b.hidden = !notes.length; b.textContent = notes.join(" · ");
}
async function doSync() {
  const btn = $("#sync-btn");
  btn.classList.add("busy"); $("#sync-label").textContent = "Syncing…";
  try {
    const r = await api("/api/sync", { method: "POST" });
    toast(`Synced: ${r.added} new transactions${r.new_accounts?.length ? `, new account: ${r.new_accounts.join(", ")}` : ""}${r.errors?.length ? " (with warnings)" : ""}.`);
    if (r.new_accounts?.length) loadAccountFilter();
  } catch (e) {
    toast(e.body?.status === "demo" ? e.body.message : e.status === 409 ? "Not connected yet. Run `finance setup` in Terminal." : "Sync failed: " + e.message);
  } finally {
    btn.classList.remove("busy");
    refresh();
  }
}

/* ---------------- init ---------------- */
async function loadAccountFilter() {
  const { accounts } = await api("/api/accounts");
  const cur = state.account;
  $("#account-filter").innerHTML = `<option value="">All accounts</option>` +
    sortAccounts(accounts.filter((a) => !a.hidden && !a.closed)).map((a) => `<option value="${esc(a.id)}" ${a.id === cur ? "selected" : ""}>${esc(a.label)}</option>`).join("");
}
async function loadCategories() {
  state.categories = await api("/api/categories");
  const cur = $("#m-category").value;
  $("#m-category").innerHTML = `<option value="">All categories</option>` +
    state.categories.filter((c) => !["Transfer"].includes(c)).map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
}

function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

document.addEventListener("DOMContentLoaded", async () => {
  setPeriod("this_month");
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
  $("#period").addEventListener("change", (e) => { setPeriod(e.target.value); refresh(); });
  ["#start", "#end"].forEach((s) => $(s).addEventListener("change", () => { setPeriod("custom"); refresh(); }));
  $("#account-filter").addEventListener("change", (e) => { state.account = e.target.value; refresh(); });
  $("#sync-btn").addEventListener("click", doSync);
  $("#m-search").addEventListener("input", debounce(loadMerchants));
  $("#m-category").addEventListener("change", loadMerchants);
  $("#a-search").addEventListener("input", debounce(loadActivity));
  $$("#a-kind button").forEach((b) => b.addEventListener("click", () => {
    state.kind = b.dataset.kind; $$("#a-kind button").forEach((x) => x.classList.toggle("active", x === b)); loadActivity();
  }));
  $("#d-close").addEventListener("click", closeMerchant);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMerchant(); });
  window.addEventListener("resize", debounce(() => state.tab === "overview" && loadOverview(), 300));
  await Promise.all([loadAccountFilter(), loadCategories()]);
  const initial = location.hash.slice(1);
  showTab(["overview", "purchases", "activity", "accounts", "rewards", "budget"].includes(initial) ? initial : "overview");
});
