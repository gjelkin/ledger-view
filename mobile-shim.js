"use strict";
/* Ledger's phone view: download the encrypted snapshot, decrypt it here, and answer the dashboard's
   /api/* requests from it. Nothing is ever sent anywhere; changes are made on the Mac. */
(() => {
  const DB = "ledger-phone", STORE = "keys";
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let SNAP = null, BLOB = null;

  /* ---------- remembered key: a non-extractable CryptoKey in IndexedDB ---------- */
  function idb() {
    return new Promise((ok, bad) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    });
  }
  async function keyStore(mode, fn) {
    try {
      const db = await idb();
      return await new Promise((ok, bad) => {
        const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => ok(req && req.result); tx.onerror = () => bad(tx.error);
      });
    } catch { return null; }
  }
  const savedKey = (salt) => keyStore("readonly", (s) => s.get(salt));
  const saveKey = (salt, key) => keyStore("readwrite", (s) => s.put(key, salt));
  const forgetKeys = () => keyStore("readwrite", (s) => s.clear());

  /* ---------- crypto ---------- */
  async function deriveKey(pass, blob) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(blob.salt), iterations: blob.iter },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function open(blob, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.data));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return JSON.parse(text);
  }
  async function download() {
    const r = await fetch("snapshot.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("Couldn't download your snapshot (" + r.status + ").");
    return r.json();
  }

  /* ---------- the dashboard's API, answered from the snapshot ---------- */
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  function periodFor(start, end) {
    for (const [k, [s, e]] of Object.entries(SNAP.periods)) if (s === start && e === end) return k;
    return null;
  }
  function inRange(t, start, end) { return t.date >= start && t.date <= end; }
  const like = (v, q) => String(v || "").toLowerCase().includes(q);

  function answer(url, method) {
    const u = new URL(url, location.href);
    const p = u.searchParams, path = u.pathname.replace(/^.*?\/api\//, "/api/");
    if (method !== "GET") return json({ message: "Read-only on your phone. Make changes in Ledger on your Mac." }, 403);
    const start = p.get("start"), end = p.get("end"), R = SNAP.responses;
    if (path === "/api/categories") return json(R.categories);
    if (path === "/api/reminders") return json(R.reminders);
    if (path === "/api/accounts") return json(start ? (R[`accounts|${start}|${end}`] || R.accounts) : R.accounts);
    if (path === "/api/summary") {
      const s = R[`summary|${start}|${end}`];
      return s ? json(s) : json({ detail: "Not in this snapshot" }, 404);
    }
    if (path === "/api/merchants") {
      let list = R[`merchants|${start}|${end}`] || [];
      const q = (p.get("q") || "").toLowerCase(), cat = p.get("category");
      if (cat) list = list.filter((m) => m.category === cat);
      if (q) {
        const hit = new Set(SNAP.transactions.filter((t) => t.spend && inRange(t, start, end) && like(t.description, q)).map((t) => t.merchant));
        list = list.filter((m) => like(m.merchant, q) || hit.has(m.merchant));
      }
      return json(list);
    }
    if (path === "/api/merchant") {
      const name = p.get("name");
      return json(SNAP.transactions.filter((t) => t.spend && t.merchant === name && inRange(t, start, end))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.amount - b.amount)));
    }
    if (path === "/api/transactions") {
      const q = (p.get("q") || "").toLowerCase(), kind = p.get("kind");
      return json(SNAP.transactions.filter((t) => inRange(t, start, end)
        && (!q || like(t.merchant, q) || like(t.description, q) || like(t.category, q))
        && (kind === "in" ? t.income : kind === "out" ? t.spend : kind === "transfers" ? t.is_transfer : true)));
    }
    return json({ detail: "Not available on your phone" }, 404);
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, opts = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (SNAP && /(^|\/)api\//.test(new URL(url, location.href).pathname)) return Promise.resolve(answer(url, (opts.method || "GET").toUpperCase()));
    return realFetch(input, opts);
  };

  /* ---------- store logos: the Mac fetches them itself; here they come straight from DuckDuckGo ---------- */
  function fixIcons(root) {
    root.querySelectorAll && root.querySelectorAll('img[src^="/api/icon/"]').forEach((img) => {
      img.src = "https://icons.duckduckgo.com/ip3/" + img.getAttribute("src").slice("/api/icon/".length) + ".ico";
    });
  }
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(fixIcons))).observe(document.body, { childList: true, subtree: true });

  /* ---------- start the dashboard ---------- */
  let started = false;
  function startDashboard() {
    document.getElementById("unlock").hidden = true;
    document.body.classList.add("unlocked");
    if (started) { window.refresh && window.refresh(); return; }
    started = true;
    const custom = document.querySelector('#period option[value="custom"]');
    if (custom) custom.remove();
    const lock = document.createElement("button");
    lock.id = "lock-btn"; lock.className = "ghost"; lock.textContent = "Lock"; lock.title = "Forget the passphrase on this device";
    lock.onclick = () => window.ledgerLock();
    document.querySelector(".controls").appendChild(lock);
    const s = document.createElement("script");
    s.src = "app.js?v=" + (BLOB.published || Date.now());
    s.onload = () => {
      // Use the Mac's dates for each period, so they match the snapshot exactly.
      const orig = window.setPeriod;
      window.setPeriod = (kind) => {
        orig(kind);
        const r = SNAP.periods[kind];
        if (r) { state.start = r[0]; state.end = r[1]; }
      };
      // The sync button checks for a newer snapshot instead.
      document.getElementById("sync-btn").addEventListener("click", (ev) => { ev.stopImmediatePropagation(); checkForUpdate(true); }, true);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    };
    document.body.appendChild(s);
  }
  async function checkForUpdate(announce) {
    try {
      const blob = await download();
      if (BLOB && blob.data === BLOB.data) { if (announce) window.toast && toast("Up to date with your Mac."); return; }
      const key = await savedKey(blob.salt) || CURRENT_KEY;
      if (!key) return;
      SNAP = await open(blob, key); BLOB = blob;
      const sel = document.getElementById("period");
      if (window.setPeriod) { setPeriod(sel.value); window.refresh && refresh(); }
      if (announce) window.toast && toast("Updated from your Mac.");
    } catch (e) { if (announce) window.toast && toast(e.message); }
  }
  let CURRENT_KEY = null;

  async function unlockWith(key, blob, remember) {
    SNAP = await open(blob, key); BLOB = blob; CURRENT_KEY = key;
    if (remember) await saveKey(blob.salt, key);
    startDashboard();
  }

  async function boot() {
    const msg = document.getElementById("unlock-msg");
    let blob;
    try { blob = await download(); } catch (e) { msg.textContent = e.message; return; }
    if (!(window.crypto && crypto.subtle && window.DecompressionStream)) {
      msg.textContent = "This browser is too old to open Ledger. Update iOS (16.4 or later) and try again."; return;
    }
    const saved = await savedKey(blob.salt);
    if (saved) {
      try { return await unlockWith(saved, blob, false); } catch { await forgetKeys(); }
    }
    document.getElementById("unlock-pass").focus();
    document.getElementById("unlock-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = document.getElementById("unlock-btn"), pass = document.getElementById("unlock-pass");
      btn.disabled = true; msg.textContent = "Unlocking…";
      try {
        await unlockWith(await deriveKey(pass.value, blob), blob, document.getElementById("unlock-remember").checked);
        pass.value = ""; msg.textContent = "";
      } catch { msg.textContent = "That passphrase didn't open it. Try again."; }
      btn.disabled = false;
    });
  }

  // Coming back to the app: pick up anything the Mac published since.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && SNAP) checkForUpdate(false); });
  window.ledgerLock = async () => { await forgetKeys(); location.reload(); };
  boot();
})();
