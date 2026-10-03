/*
 * Aziza Bakery order page (Telegram Mini App).
 *
 * Flow: load catalog.json -> client picks box quantities -> fills the form ->
 * Telegram.WebApp.sendData(order) -> the bot receives it as message.web_app_data.
 * The bot re-checks everything (products, minimum, prices); this page only helps the client.
 */
(function () {
  "use strict";

  const STEP = 1;                        // +/- buttons change quantity by one box
  const MAX_QTY = 1000000;               // no practical limit; just guards against typos like 1e12
  const DRAFT_KEY = "aziza-draft-v1";    // quantities kept if the page is closed
  const PROFILE_KEY = "aziza_profile_v1";   // regular customer details (Telegram CloudStorage)
  const PROFILE_FIELDS = ["company", "person", "phone", "address"];
  const DESKTOP_PLATFORMS = ["tdesktop", "macos", "weba", "webk", "web", "unigram"];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let catalog = null;
  let qty = {};                          // "productId|sizeKg" -> boxes

  /* ---------------- Telegram ---------------- */
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = Boolean(tg && tg.platform && tg.platform !== "unknown");

  function setupTelegram() {
    if (!inTelegram) return;
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor("#ffffff"); tg.setBackgroundColor("#FBF4EC"); } catch (e) { /* old clients */ }
    document.documentElement.dataset.platform = tg.platform;
    // On computers open full screen so the desktop layout has room
    if (DESKTOP_PLATFORMS.includes(tg.platform) && tg.isVersionAtLeast && tg.isVersionAtLeast("8.0")) {
      try { tg.requestFullscreen(); } catch (e) { /* not supported */ }
    }
    if (tg.BackButton) tg.BackButton.onClick(closeSheet);
  }

  /* ---------------- helpers ---------------- */
  const fmt = (n) => n.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const key = (id, size) => id + "|" + size;

  function priceOf(product, size) {
    const value = product.price ? product.price[String(size)] : null;
    return typeof value === "number" && value > 0 ? value : null;
  }

  function storageGet(name, fallback) {
    try { return JSON.parse(localStorage.getItem(name)) || fallback; } catch (e) { return fallback; }
  }
  function storageSet(name, value) {
    try { localStorage.setItem(name, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------------- catalog ---------------- */
  async function loadCatalog() {
    const version = new URLSearchParams(location.search).get("v") || Date.now();
    const response = await fetch("catalog.json?v=" + version, { cache: "no-store" });
    if (!response.ok) throw new Error("catalog.json: HTTP " + response.status);
    return response.json();
  }

  function renderChips() {
    const chips = [{ id: "all", name: "Hammasi" }].concat(catalog.categories);
    $("#chips").innerHTML = chips.map((c, i) =>
      `<button class="chip" type="button" data-f="${esc(c.id)}" aria-pressed="${i === 0}">${esc(c.name)}</button>`
    ).join("");
  }

  function renderProducts() {
    const categoryName = Object.fromEntries(catalog.categories.map((c) => [c.id, c.name]));
    $("#products").innerHTML = catalog.products.map((p) => {
      const rows = catalog.box_sizes_kg.map((size) => {
        const price = priceOf(p, size);
        const value = qty[key(p.id, size)] || 0;
        return `<div class="variant${value ? " on" : ""}" data-k="${esc(key(p.id, size))}">
          <div><span class="v-size">${size} kg quti</span><span class="v-price">${price ? "<b>" + fmt(price) + "</b> so'm / quti" : "Narx kelishiladi"}</span></div>
          <div class="stepper">
            <button type="button" data-d="-1" aria-label="${esc(p.name)}, ${size} kg: ${STEP} ta kamaytirish">−</button>
            <input type="number" inputmode="numeric" min="0" value="${value}" aria-label="${esc(p.name)}, ${size} kg qutilar soni">
            <button type="button" data-d="1" aria-label="${esc(p.name)}, ${size} kg: ${STEP} ta qo'shish">+</button>
          </div>
        </div>`;
      }).join("");
      return `<article class="card" data-cat="${esc(p.category)}">
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="720" height="540">
        <div class="card-head"><span class="ptag">${esc(categoryName[p.category] || "")}</span><h3>${esc(p.name)}</h3><p class="desc">${esc(p.description || "")}</p></div>
        <div class="variants">${rows}</div>
      </article>`;
    }).join("");
  }

  /* ---------------- quantities ---------------- */
  function setQty(k, value, row) {
    value = Math.max(0, Math.min(MAX_QTY, Math.round(Number(value) || 0)));
    if (value) qty[k] = value; else delete qty[k];
    row.querySelector("input").value = value;
    row.classList.toggle("on", value > 0);
    storageSet(DRAFT_KEY, qty);
    renderSummary();
  }

  function totals() {
    const items = [];
    let boxes = 0, kg = 0, sum = 0, unknownPrice = false;
    catalog.products.forEach((p) => catalog.box_sizes_kg.forEach((size) => {
      const q = qty[key(p.id, size)];
      if (!q) return;
      const price = priceOf(p, size);
      boxes += q;
      kg += q * size;
      if (price) sum += price * q; else unknownPrice = true;
      items.push({ product: p, size, qty: q });
    }));
    return { items, boxes, kg, sum, unknownPrice };
  }

  function renderSummary() {
    const t = totals();
    const min = catalog.min_boxes;
    let html;
    if (!t.items.length) {
      html = '<p class="empty">Hali hech narsa tanlanmagan. Katalogda kerakli qutilar sonini kiriting.</p>';
    } else {
      html = '<ul class="lines">' + t.items.map((i) =>
        `<li><span>${esc(i.product.name)}, ${i.size} kg</span><span>${fmt(i.qty)} quti</span></li>`).join("") + "</ul>" +
        `<div class="totals"><div><span>Jami qutilar</span><b>${fmt(t.boxes)}</b></div>` +
        `<div><span>Jami og'irlik</span><b>${fmt(t.kg)} kg</b></div>` +
        `<div class="big"><span>Summa</span><span>${t.unknownPrice ? "Kelishiladi" : fmt(t.sum) + " so'm"}</span></div></div>`;
    }
    const missing = min - t.boxes;
    const warning = t.boxes && missing > 0 ? `Minimal buyurtma ${fmt(min)} quti. Yana ${fmt(missing)} quti qo'shing.` : "";
    $$("[data-summary]").forEach((el) => { el.innerHTML = html + `<p class="warn">${warning}</p>`; });

    const ready = t.boxes >= min;
    $$("[data-go]").forEach((b) => { b.disabled = !ready; });
    $("#sendBtn").disabled = !ready;
    $("#headCount").textContent = t.boxes ? fmt(t.boxes) : "";
    $("#barMain").textContent = t.boxes ? `${fmt(t.boxes)} quti · ${fmt(t.kg)} kg` : "Qutilar tanlanmagan";
    $("#barSub").textContent = !t.boxes ? "Mahsulot va qutilar sonini tanlang"
      : missing > 0 ? `Minimal buyurtma: ${fmt(min)} quti` : "Buyurtma berishga tayyor";
  }

  /* ---------------- checkout sheet ---------------- */
  function openSheet() {
    if (!catalog || !totals().boxes) { $("#katalog").scrollIntoView(); return; }
    $("#sheet").hidden = false;
    document.body.style.overflow = "hidden";
    if (inTelegram && tg.BackButton) tg.BackButton.show();
  }

  function closeSheet() {
    $("#sheet").hidden = true;
    document.body.style.overflow = "";
    if (inTelegram && tg.BackButton) tg.BackButton.hide();
  }

  /* ---------------- regular customer profile ----------------
   * Saved with Telegram CloudStorage: tied to the client's Telegram account,
   * so it is there on phone and computer. Falls back to localStorage outside Telegram.
   */
  const cloud = inTelegram && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9") ? tg.CloudStorage : null;

  function loadProfile() {
    return new Promise((resolve) => {
      if (!cloud) { resolve(storageGet(PROFILE_KEY, null)); return; }
      cloud.getItem(PROFILE_KEY, (error, value) => {
        try { resolve(!error && value ? JSON.parse(value) : null); } catch (e) { resolve(null); }
      });
    });
  }

  // Resolves when saved, so sendData (which closes the page) does not cut the save off.
  // Gives up after 2 seconds so a slow connection never blocks the order.
  function saveProfile(profile) {
    if (!profile) {
      if (!cloud) { try { localStorage.removeItem(PROFILE_KEY); } catch (e) { /* ignore */ } return Promise.resolve(); }
      return withTimeout(new Promise((done) => cloud.removeItem(PROFILE_KEY, () => done())));
    }
    if (!cloud) { storageSet(PROFILE_KEY, profile); return Promise.resolve(); }
    return withTimeout(new Promise((done) => cloud.setItem(PROFILE_KEY, JSON.stringify(profile), () => done())));
  }

  function withTimeout(promise) {
    return Promise.race([promise, new Promise((done) => setTimeout(done, 2000))]);
  }

  function showCustomerFields(show) {
    $("#customerFields").hidden = !show;
    $("#savedCard").hidden = show;
  }

  function applyProfile(profile) {
    if (!profile || !profile.company) return;
    const form = $("#orderForm");
    PROFILE_FIELDS.forEach((name) => { form[name].value = profile[name] || ""; });
    form.remember.checked = true;
    $("#savedText").textContent = [profile.company, profile.person, profile.phone, profile.address].filter(Boolean).join("\n");
    showCustomerFields(false);   // regular customer: no need to type anything
  }

  function submitOrder(event) {
    event.preventDefault();
    const form = event.target;
    let firstInvalid = null;
    // Required: date and store name. Phone is optional, but if typed it must be complete.
    form.querySelectorAll(".field[data-req], #f-phone").forEach((el) => {
      const field = el.closest(".field");
      const input = field.querySelector("input");
      const value = input.value.trim();
      const digits = value.replace(/\D/g, "").length;
      const invalid = input.name === "phone" ? digits > 0 && digits < 9 : !value;
      field.classList.toggle("err", invalid);
      if (invalid && !firstInvalid) firstInvalid = input;
    });
    if (firstInvalid) {
      if (firstInvalid.name !== "date") showCustomerFields(true);
      firstInvalid.focus();
      return;
    }

    const t = totals();
    if (t.boxes < catalog.min_boxes) return;

    const customer = {
      company: form.company.value.trim(),
      person: form.person.value.trim(),
      phone: form.phone.value.trim(),
      address: form.address.value.trim(),
    };
    const order = {
      items: t.items.map((i) => ({ id: i.product.id, size: i.size, qty: i.qty })),
      ...customer,
      date: form.date.value,
      regular: form.remember.checked,
    };

    if (!inTelegram) {
      $("#notTg").hidden = false;
      console.log("Order (not sent, page opened outside Telegram):", order);
      return;
    }
    $("#sendBtn").disabled = true;
    saveProfile(form.remember.checked ? customer : null).then(() => {
      storageSet(DRAFT_KEY, {});           // order sent: clear the draft
      tg.sendData(JSON.stringify(order));  // closes the page; the bot gets the order
    });
  }

  /* ---------------- events ---------------- */
  function bindEvents() {
    const products = $("#products");
    products.addEventListener("click", (e) => {
      const button = e.target.closest("button[data-d]");
      if (!button) return;
      const row = button.closest(".variant");
      const k = row.dataset.k;
      setQty(k, (qty[k] || 0) + STEP * Number(button.dataset.d), row);
      if (inTelegram && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
    });
    products.addEventListener("change", (e) => {
      if (e.target.tagName !== "INPUT") return;
      const row = e.target.closest(".variant");
      setQty(row.dataset.k, e.target.value, row);
    });
    products.addEventListener("focusin", (e) => { if (e.target.tagName === "INPUT") e.target.select(); });

    $("#chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      $$(".card").forEach((card) => { card.hidden = !(chip.dataset.f === "all" || card.dataset.cat === chip.dataset.f); });
    });

    $$("[data-open]").forEach((b) => b.addEventListener("click", openSheet));
    $("#closeSheet").addEventListener("click", closeSheet);
    $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
    $("#orderForm").addEventListener("submit", submitOrder);
    // Hide a field's error as soon as the client starts fixing it
    $("#orderForm").addEventListener("input", (e) => {
      const field = e.target.closest(".field");
      if (field) field.classList.remove("err");
    });
    $("#editSaved").addEventListener("click", () => { showCustomerFields(true); $("#f-company").focus(); });
  }

  function renderTicker() {
    const words = ["Ulgurji buyurtmalar", "1 kg va 2 kg qutilar", "2006-yildan beri", "Mehr bilan tayyorlangan", "Siz izlagan ta'm"];
    $("#ticker").innerHTML = words.concat(words, words, words).map((w) => `<span>${w}</span>`).join("");
  }

  /* ---------------- start ---------------- */
  async function start() {
    setupTelegram();
    renderTicker();
    bindEvents();
    loadProfile().then(applyProfile);
    // Delivery date cannot be in the past
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    $("#f-date").min = today.toISOString().slice(0, 10);
    try {
      catalog = await loadCatalog();
    } catch (error) {
      console.error(error);
      $("#products").innerHTML = '<div class="state">Katalogni yuklab bo\'lmadi. Internetni tekshirib, qayta urinib ko\'ring.<br><button class="btn btn-plum" type="button" onclick="location.reload()">Qayta yuklash</button></div>';
      return;
    }
    // Keep only draft quantities that still exist in the catalog
    const draft = storageGet(DRAFT_KEY, {});
    catalog.products.forEach((p) => catalog.box_sizes_kg.forEach((size) => {
      const k = key(p.id, size);
      if (draft[k] > 0) qty[k] = draft[k];
    }));
    renderChips();
    renderProducts();
    renderSummary();
  }

  start();
})();
