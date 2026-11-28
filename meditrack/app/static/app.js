"use strict";
/* MediTrack Frontend – Vanilla JS, relative URLs (funktioniert hinter HA-Ingress). */

const state = {
  children: [],
  meds: [],
  childId: null,
  status: null,
  view: "status",
  editingMedId: null,
  editingChildId: null,
  editingDose: null,
  editingTemp: null,
  doseMedId: null,
  recent: [],
  history: [],
  tempHistory: [],
  eventHistory: [],
  editingEvent: null,
  pendingImport: null,
  chartHours: 72,
  chart: null,
};
const FEVER = 38.0;
const EVENT_KINDS = ["Erbrechen", "Durchfall", "Schnupfen/Husten", "Affektkrampf", "Arztbesuch",
  "Zahnen", "Stich/Verletzung", "Notiz"];

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n) => (n == null ? "" : Number(n).toLocaleString("de-CH", { maximumFractionDigits: 2 }));
// Komma oder Punkt als Dezimaltrennzeichen akzeptieren
const normNum = (s) => String(s ?? "").trim().replace(",", ".");

/* ---------- Icons (Inline-SVG statt Emojis) ---------- */
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  star: '<path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
};
function icon(name, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((i) => { i.outerHTML = icon(i.dataset.icon); });
}
const star = () => `<span class="fav-star">${icon("star", "sm fill")}</span>`;

async function api(path, options = {}) {
  const opts = { headers: { "Content-Type": "application/json" }, ...options };
  if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  const res = await fetch("api/" + path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- Datum & Zeit (immer TT.MM.JJJJ, 24 h – unabhängig von der Geräte-Region) ---------- */
const pad = (n) => String(n).padStart(2, "0");
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const fmtDM = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
const fmtHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function fmtTime(iso) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (days === 0) return fmtHM(d);
  if (days === -1) return `gestern ${fmtHM(d)}`;
  if (days === 1) return `morgen ${fmtHM(d)}`;
  return `${WD_SHORT[d.getDay()]} ${fmtDM(d)} ${fmtHM(d)}`;
}
function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 24) return `${Math.floor(h / 24)} T ${h % 24} h`;
  return h ? `${h} h ${pad(m)} min` : `${m} min`;
}
function parseDate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? d : null;
}
function parseHM(s) {
  const v = String(s || "").trim().replace(/[.,h\s]/g, ":");
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(v) || /^(\d{1,2})(\d{2})$/.exec(v) || /^(\d{1,2})()$/.exec(v);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  return h <= 23 && mi <= 59 ? { h, mi } : null;
}
function roundToQuarter(date) {
  // nächstgelegene Viertelstunde, aber nie in der Zukunft (Server lehnt > 5 min ab)
  const q = 15 * 60000;
  let t = Math.round(date.getTime() / q) * q;
  if (t > Date.now() + 4 * 60000) t -= q;
  return new Date(t);
}
function ageText(birthdate) {
  if (!birthdate) return "";
  const b = new Date(birthdate + "T00:00:00");
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) months -= 1;
  if (months < 0) return "";
  return months < 24 ? `${months} Mt.` : `${Math.floor(months / 12)} J.`;
}

/* Datumsfeld TT.MM.JJJJ: Punkte werden beim Tippen automatisch gesetzt */
function bindDateInput(input) {
  input.addEventListener("input", () => {
    let v = input.value.replace(/[^\d.]/g, "");
    const parts = v.split(".");
    const fits = parts.length <= 3 && parts.every((p, i) => p.length <= (i < 2 ? 2 : 4));
    if (!fits) {
      const d = v.replace(/\./g, "").slice(0, 8);
      v = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join(".");
    }
    if (v !== input.value) input.value = v;
  });
}

/* Zeitpunkt-Auswahl: Schnellknöpfe, Tag (Heute/Gestern/…) und Uhrzeit HH:MM */
function buildWhen(el, { quarter }) {
  el.innerHTML = `<label>Zeitpunkt</label>
    <div class="seg">
      <button type="button" data-q="now">Jetzt</button>
      <button type="button" data-q="-15">−15 min</button>
      <button type="button" data-q="-30">−30 min</button>
      <button type="button" data-q="-60">−1 h</button>
    </div>
    <div class="when-row">
      <select class="when-day" aria-label="Tag"></select>
      <input class="when-time" type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" aria-label="Uhrzeit (HH:MM)" autocomplete="off">
    </div>`;
  const time = el.querySelector(".when-time");
  const changed = () => el.dispatchEvent(new Event("input", { bubbles: true }));
  el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    const now = new Date();
    if (b.dataset.q === "now") setWhen(el, quarter ? roundToQuarter(now) : now);
    else {
      let t = new Date((readWhen(el) || now).getTime() + Number(b.dataset.q) * 60000);
      setWhen(el, t);
    }
    changed();
  }));
  time.addEventListener("input", () => {
    const digits = time.value.replace(/\D/g, "");
    if (!time.value.includes(":") && digits.length === 4) time.value = `${digits.slice(0, 2)}:${digits.slice(2)}`;
  });
  time.addEventListener("blur", () => {
    const hm = parseHM(time.value);
    if (hm) time.value = `${pad(hm.h)}:${pad(hm.mi)}`;
  });
}
function fillDays(select, extra) {
  const today = startOfDay(new Date());
  const opts = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const label = i === 0 ? `Heute, ${fmtDM(d)}` : i === 1 ? `Gestern, ${fmtDM(d)}` : `${WD_SHORT[d.getDay()]} ${fmtDate(d)}`;
    opts.push([isoDay(d), label]);
  }
  if (extra && !opts.some(([v]) => v === isoDay(extra))) opts.push([isoDay(extra), `${WD_SHORT[extra.getDay()]} ${fmtDate(extra)}`]);
  select.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
}
function setWhen(el, date) {
  const sel = el.querySelector(".when-day");
  fillDays(sel, date);
  sel.value = isoDay(date);
  el.querySelector(".when-time").value = fmtHM(date);
}
function readWhen(el) {
  const [y, mo, d] = el.querySelector(".when-day").value.split("-").map(Number);
  const hm = parseHM(el.querySelector(".when-time").value);
  if (!y || !hm) return null;
  return new Date(y, mo - 1, d, hm.h, hm.mi);
}

/* ---------- Navigation ---------- */
function showView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll("nav.bottom button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "history") loadHistory();
  if (view === "status") loadStatus();
  if (view === "chart") loadChart();
  window.scrollTo(0, 0);
  try { localStorage.setItem("meditrack.view", view); } catch (_) { /* ignorieren */ }
}

/* ---------- Kinder ---------- */
async function loadChildren() {
  state.children = await api("children");
  let saved = null;
  try { saved = Number(localStorage.getItem("meditrack.child")); } catch (_) { /* ignorieren */ }
  if (!state.children.some((c) => c.id === state.childId)) {
    state.childId = state.children.some((c) => c.id === saved) ? saved : (state.children[0]?.id ?? null);
  }
  renderChildTabs();
  renderChildList();
}

function selectChild(id) {
  state.childId = id;
  try { localStorage.setItem("meditrack.child", String(id)); } catch (_) { /* ignorieren */ }
  renderChildTabs();
  if (state.view === "history") loadHistory();
  else if (state.view === "chart") loadChart();
  else loadStatus();
}

function refreshViews() {
  loadStatus();
  if (state.view === "history") loadHistory();
  if (state.view === "chart") loadChart();
}

function currentChild() { return state.children.find((c) => c.id === state.childId) || null; }

function renderChildTabs() {
  const el = $("#childTabs");
  if (!state.children.length) { el.innerHTML = ""; return; }
  el.innerHTML = state.children.map((c) => `
    <button role="tab" data-id="${c.id}" class="${c.id === state.childId ? "active" : ""}">
      ${esc(c.name)}${c.weight_kg ? ` · ${fmtNum(c.weight_kg)} kg` : ""}
    </button>`).join("");
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => selectChild(Number(b.dataset.id))));
}

function renderChildList() {
  const el = $("#childList");
  if (!state.children.length) {
    el.innerHTML = `<div class="empty">Noch kein Kind erfasst.</div>`;
    return;
  }
  el.innerHTML = state.children.map((c) => {
    const born = c.birthdate ? `geb. ${fmtDate(new Date(c.birthdate + "T00:00:00"))}` : "";
    return `
    <div class="item clickable" data-id="${c.id}">
      <div class="lead">${icon("user")}</div>
      <div class="main"><div class="title">${esc(c.name)}</div>
      <div class="sub">${[c.weight_kg ? fmtNum(c.weight_kg) + " kg" : "Gewicht fehlt", ageText(c.birthdate), born].filter(Boolean).join(" · ")}</div></div>
      <span class="chev">${icon("chevron")}</span>
    </div>`;
  }).join("");
  el.querySelectorAll(".item").forEach((it) => it.addEventListener("click", () => openChildDialog(Number(it.dataset.id))));
}

function openChildDialog(id = null) {
  state.editingChildId = id;
  const f = $("#childForm");
  f.reset();
  const c = id ? state.children.find((x) => x.id === id) : null;
  $("#childDialogTitle").textContent = c ? "Kind bearbeiten" : "Kind hinzufügen";
  if (c) {
    f.name.value = c.name;
    f.birthdate.value = c.birthdate ? fmtDate(new Date(c.birthdate + "T00:00:00")) : "";
    f.weight_kg.value = c.weight_kg ?? "";
  }
  $("#childDelete").hidden = !c;
  $("#childDialog").showModal();
}

async function saveChild(ev) {
  ev.preventDefault();
  const f = $("#childForm");
  let birthdate = "";
  if (f.birthdate.value.trim()) {
    const d = parseDate(f.birthdate.value);
    if (!d) { toast("Geburtsdatum bitte als TT.MM.JJJJ eingeben"); return; }
    birthdate = isoDay(d);
  }
  const body = { name: f.name.value, birthdate, weight_kg: normNum(f.weight_kg.value) };
  try {
    const saved = state.editingChildId
      ? await api(`children/${state.editingChildId}`, { method: "PUT", body })
      : await api("children", { method: "POST", body });
    $("#childDialog").close();
    await loadChildren();
    if (!state.editingChildId) selectChild(saved.id); else loadStatus();
    toast("Gespeichert");
  } catch (e) { toast(e.message); }
}

async function deleteChild() {
  const c = state.children.find((x) => x.id === state.editingChildId);
  if (!c || !confirm(`${c.name} und den gesamten Verlauf wirklich löschen?`)) return;
  try {
    await api(`children/${c.id}`, { method: "DELETE" });
    $("#childDialog").close();
    await loadChildren();
    loadStatus();
    toast("Gelöscht");
  } catch (e) { toast(e.message); }
}

/* ---------- Status ---------- */
async function loadStatus() {
  if (!state.childId) { state.status = null; renderStatus(); return; }
  try {
    [state.status, state.recent] = await Promise.all([
      api(`status?child_id=${state.childId}`), api(`recent?child_id=${state.childId}&limit=15`)]);
  } catch (e) { toast(e.message); state.status = null; state.recent = []; }
  renderStatus();
}

/* ---------- Schnellauswahl (Favoriten + zuletzt verwendet) ---------- */
function shortName(name) { return name.replace(/\s*\(z\. B\. [^)]*\)/, ""); }

function quickMeds() {
  const favs = state.meds.filter((m) => m.favorite);
  const favIds = new Set(favs.map((m) => m.id));
  const recent = state.recent
    .map((r) => state.meds.find((m) => m.id === r.id))
    .filter((m) => m && !favIds.has(m.id))
    .slice(0, 5);
  return { favs, recent };
}

function chipHtml(m, selectedId) {
  const st = statusFor(m);
  const blocked = st && !st.allowed_now;
  const sub = blocked ? `${icon("clock", "sm")} ab ${fmtTime(st.next_allowed_at)}` : esc(m.active_ingredient);
  return `<button type="button" class="chip ${m.favorite ? "fav" : ""} ${blocked ? "blocked" : ""} ${m.id === selectedId ? "selected" : ""}" data-med="${m.id}">
    ${m.favorite ? star() + " " : ""}${esc(shortName(m.name))}<small>${sub}</small></button>`;
}

function renderQuick(el, onPick, selectedId = null) {
  if (!state.childId) { el.innerHTML = ""; return; }
  const { favs, recent } = quickMeds();
  let html = "";
  if (favs.length) html += `<div class="qlabel">Favoriten</div><div class="chips">${favs.map((m) => chipHtml(m, selectedId)).join("")}</div>`;
  if (recent.length) html += `<div class="qlabel">Zuletzt verwendet</div><div class="chips">${recent.map((m) => chipHtml(m, selectedId)).join("")}</div>`;
  el.innerHTML = html;
  el.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => onPick(Number(c.dataset.med))));
}

function renderLastTemp() {
  const el = $("#lastTemp");
  const t = state.status?.last_temperature;
  if (!state.childId || !t) { el.innerHTML = ""; return; }
  const age = Date.now() - new Date(t.measured_at).getTime();
  el.innerHTML = `<button type="button" class="temp-line ${t.celsius >= FEVER ? "fever" : ""}">
    ${icon("thermo")}
    <span><span class="val">${fmtNum(t.celsius)} °C</span><br>
    <span class="muted small">${fmtTime(t.measured_at)} · vor ${fmtDuration(age)}${t.method ? " · " + esc(t.method) : ""}</span></span>
    <span class="chev">${icon("chevron")}</span></button>`;
  el.firstElementChild.addEventListener("click", () => openTempDialog(t));
}

function renderStatus() {
  renderQuick($("#quickPicks"), (id) => openDoseDialog(id));
  const el = $("#statusList");
  $("#btnAddDose").disabled = !state.childId;
  $("#btnAddTemp").disabled = !state.childId;
  $("#btnAddEvent").disabled = !state.childId;
  renderLastTemp();
  if (!state.childId) {
    el.innerHTML = `<div class="empty">Erfasse zuerst ein Kind.<br><br>
      <button class="btn primary" id="emptyAddChild">${icon("plus")}Kind hinzufügen</button></div>`;
    $("#emptyAddChild").addEventListener("click", () => openChildDialog());
    return;
  }
  const items = state.status?.ingredients || [];
  if (!items.length) {
    el.innerHTML = `<div class="empty">In den letzten 48 Stunden keine Gaben erfasst.</div>`;
    return;
  }
  const now = Date.now();
  el.innerHTML = items.map((s) => {
    const next = new Date(s.next_allowed_at).getTime();
    const last = new Date(s.last_given_at).getTime();
    const allowed = next <= now;
    const total = Math.max(1, next - last);
    const pct = allowed ? 100 : Math.min(100, Math.max(0, ((now - last) / total) * 100));
    const reason = s.blocked_reason === "max_doses" ? " (Tageslimit erreicht)" : "";
    const dosesTxt = s.max_doses_per_24h ? `${s.doses_24h} / ${s.max_doses_per_24h} Gaben in 24 h` : `${s.doses_24h} Gabe(n) in 24 h`;
    const mgTxt = s.mg_24h != null ? ` · ${fmtNum(s.mg_24h)}${s.max_mg_24h ? " / " + fmtNum(s.max_mg_24h) : ""} mg` : "";
    return `
      <div class="card ${allowed ? "" : "wait"}">
        <div class="head">
          <span class="ingredient">${esc(s.ingredient)}</span>
          <span class="badge ${allowed ? "ok" : "wait"}">${allowed ? "jetzt möglich" : "Sperrzeit"}</span>
        </div>
        <div class="big-time">${allowed
          ? "Wieder möglich"
          : `ab ${fmtTime(s.next_allowed_at)} <span class="muted small">(in ${fmtDuration(next - now)})</span>`}</div>
        <div class="meta">Zuletzt ${fmtTime(s.last_given_at)} (vor ${fmtDuration(now - last)}) · ${fmtNum(s.last_amount)} ${esc(s.last_unit)} ${esc(shortName(s.medication_name))}${reason}</div>
        <div class="progress"><div style="width:${pct.toFixed(1)}%"></div></div>
        <div class="foot">
          <span class="meta">${dosesTxt}${mgTxt}</span>
          <button class="btn small ${allowed ? "primary" : "ghost"}" data-med="${s.medication_id}">Erneut geben</button>
        </div>
      </div>`;
  }).join("");
  el.querySelectorAll("button[data-med]").forEach((b) =>
    b.addEventListener("click", () => openDoseDialog(Number(b.dataset.med))));
}

/* ---------- Verlauf ---------- */
async function loadHistory() {
  const el = $("#historyList");
  if (!state.childId) { el.innerHTML = `<div class="empty">Kein Kind ausgewählt.</div>`; return; }
  let doses, temps, events;
  try {
    [doses, temps, events] = await Promise.all([
      api(`doses?child_id=${state.childId}&limit=500`), api(`temperatures?child_id=${state.childId}&limit=500`),
      api(`events?child_id=${state.childId}&limit=500`)]);
  } catch (e) { toast(e.message); return; }
  state.history = doses;
  state.tempHistory = temps;
  state.eventHistory = events;
  const entries = [
    ...doses.map((d) => ({ kind: "dose", at: d.given_at, d })),
    ...temps.map((t) => ({ kind: "temp", at: t.measured_at, t })),
    ...events.map((v) => ({ kind: "event", at: v.occurred_at, v })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  if (!entries.length) { el.innerHTML = `<div class="empty">Noch keine Gaben, Messungen oder Ereignisse erfasst.</div>`; return; }
  let html = "", lastDay = "";
  for (const e of entries) {
    const dt = new Date(e.at);
    const day = `${WD_LONG[dt.getDay()]}, ${fmtDate(dt)}`;
    if (day !== lastDay) { html += `<div class="day">${esc(day)}</div>`; lastDay = day; }
    if (e.kind === "event") {
      const v = e.v;
      html += `
      <div class="item clickable event" data-event="${v.id}">
        <div class="lead">${icon("note")}</div>
        <div class="main">
          <div class="title"><span class="time">${fmtHM(dt)}</span> · ${esc(v.kind)}</div>
          ${v.note ? `<div class="sub">${esc(v.note)}</div>` : ""}
        </div>
        <span class="chev">${icon("chevron")}</span>
      </div>`;
      continue;
    }
    if (e.kind === "temp") {
      const t = e.t;
      html += `
      <div class="item clickable temp ${t.celsius >= FEVER ? "fever" : ""}" data-temp="${t.id}">
        <div class="lead">${icon("thermo")}</div>
        <div class="main">
          <div class="title"><span class="time">${fmtHM(dt)}</span> · <span class="temp-val">${fmtNum(t.celsius)} °C</span></div>
          <div class="sub">Temperatur${t.method ? " · " + esc(t.method) : ""}${t.note ? " · " + esc(t.note) : ""}</div>
        </div>
        <span class="chev">${icon("chevron")}</span>
      </div>`;
      continue;
    }
    const d = e.d;
    html += `
      <div class="item clickable" data-id="${d.id}">
        <div class="lead">${icon("pill")}</div>
        <div class="main">
          <div class="title"><span class="time">${fmtHM(dt)}</span> · ${esc(shortName(d.medication_name))}</div>
          <div class="sub">${fmtNum(d.amount)} ${esc(d.unit)}${d.mg != null ? ` (${fmtNum(d.mg)} mg)` : ""} · ${esc(d.active_ingredient)}${d.note ? " · " + esc(d.note) : ""}</div>
        </div>
        <span class="chev">${icon("chevron")}</span>
      </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll(".item[data-id]").forEach((it) => it.addEventListener("click", () => {
    const dose = state.history.find((x) => x.id === Number(it.dataset.id));
    if (dose) openDoseDialog(dose.medication_id, dose);
  }));
  el.querySelectorAll(".item[data-event]").forEach((it) => it.addEventListener("click", () => {
    const v = state.eventHistory.find((x) => x.id === Number(it.dataset.event));
    if (v) openEventDialog(v);
  }));
  el.querySelectorAll(".item[data-temp]").forEach((it) => it.addEventListener("click", () => {
    const t = state.tempHistory.find((x) => x.id === Number(it.dataset.temp));
    if (t) openTempDialog(t);
  }));
}

/* ---------- Temperatur ---------- */
function setTempMethod(v) {
  document.querySelectorAll("#tempMethod button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
}
function getTempMethod() { return $("#tempMethod button.active")?.dataset.v || ""; }

function openTempDialog(temp = null) {
  if (!state.childId) return;
  state.editingTemp = temp;
  $("#tempForm").reset();
  $("#tempDialogTitle").textContent = temp ? "Temperatur bearbeiten" : "Temperatur erfassen";
  $("#tempDelete").hidden = !temp;
  let method = "";
  try { method = localStorage.getItem("meditrack.tempMethod") || ""; } catch (_) { /* ignorieren */ }
  $("#tempValue").value = temp ? fmtNum(temp.celsius) : "";
  setTempMethod(temp ? (temp.method || "") : method);
  // Messungen minutengenau (nicht auf 15 min gerundet)
  setWhen($("#tempWhen"), temp ? new Date(temp.measured_at) : new Date());
  $("#tempNote").value = temp?.note || "";
  $("#tempDialog").showModal();
}

function stepTemp(delta) {
  const cur = parseFloat(normNum($("#tempValue").value));
  const base = isNaN(cur) ? 37.5 : cur;
  const v = Math.min(43, Math.max(34, Math.round((base + (isNaN(cur) ? 0 : delta)) * 10) / 10));
  $("#tempValue").value = v.toFixed(1);
}

async function saveTemp(ev) {
  ev.preventDefault();
  const time = readWhen($("#tempWhen"));
  if (!time) { toast("Uhrzeit bitte als HH:MM eingeben"); return; }
  const value = normNum($("#tempValue").value);
  if (!value) { toast("Bitte Temperatur eingeben"); return; }
  const body = {
    child_id: state.childId, celsius: value, method: getTempMethod(),
    measured_at: time.toISOString(), note: $("#tempNote").value,
  };
  try {
    if (state.editingTemp) await api(`temperatures/${state.editingTemp.id}`, { method: "PUT", body });
    else await api("temperatures", { method: "POST", body });
    try { localStorage.setItem("meditrack.tempMethod", body.method); } catch (_) { /* ignorieren */ }
    $("#tempDialog").close();
    toast("Temperatur gespeichert");
    refreshViews();
  } catch (e) { toast(e.message); }
}

async function deleteTemp() {
  const t = state.editingTemp;
  if (!t || !confirm("Diese Messung löschen?")) return;
  try {
    await api(`temperatures/${t.id}`, { method: "DELETE" });
    $("#tempDialog").close();
    toast("Gelöscht");
    refreshViews();
  } catch (e) { toast(e.message); }
}

/* ---------- Ereignisse ---------- */
function setEventKind(v) {
  document.querySelectorAll("#eventKind button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
}

function openEventDialog(ev = null) {
  if (!state.childId) return;
  state.editingEvent = ev;
  $("#eventForm").reset();
  $("#eventDialogTitle").textContent = ev ? "Ereignis bearbeiten" : "Ereignis erfassen";
  $("#eventDelete").hidden = !ev;
  setEventKind(ev ? ev.kind : "");
  setWhen($("#eventWhen"), ev ? new Date(ev.occurred_at) : new Date());
  $("#eventNote").value = ev?.note || "";
  $("#eventDialog").showModal();
}

async function saveEvent(evt) {
  evt.preventDefault();
  const kind = $("#eventKind button.active")?.dataset.v;
  if (!kind) { toast("Bitte Art wählen"); return; }
  const time = readWhen($("#eventWhen"));
  if (!time) { toast("Uhrzeit bitte als HH:MM eingeben"); return; }
  const body = { child_id: state.childId, kind, occurred_at: time.toISOString(), note: $("#eventNote").value };
  try {
    if (state.editingEvent) await api(`events/${state.editingEvent.id}`, { method: "PUT", body });
    else await api("events", { method: "POST", body });
    $("#eventDialog").close();
    toast("Ereignis gespeichert");
    refreshViews();
  } catch (e) { toast(e.message); }
}

async function deleteEvent() {
  const v = state.editingEvent;
  if (!v || !confirm("Dieses Ereignis löschen?")) return;
  try {
    await api(`events/${v.id}`, { method: "DELETE" });
    $("#eventDialog").close();
    toast("Gelöscht");
    refreshViews();
  } catch (e) { toast(e.message); }
}

/* ---------- Import (z. B. aus alten Notizen) ---------- */
// "2026-01-27T18:00" = lokale Zeit dieses Geräts -> ISO (UTC); Zeitpunkte mit Zone bleiben unverändert
function localToIso(at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(at || "").trim());
  if (!m) return at;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString();
}

async function onImportFile(ev) {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  const child = currentChild();
  if (!child) { toast("Bitte zuerst ein Kind auswählen"); return; }
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { toast("Datei ist kein gültiges JSON"); return; }
  if (data.format !== "meditrack-import") { toast("Keine MediTrack-Importdatei"); return; }
  const conv = (list) => (list || []).map((x) => ({ ...x, at: localToIso(x.at) }));
  data = { ...data, doses: conv(data.doses), temperatures: conv(data.temperatures), events: conv(data.events) };
  try {
    const s = await api("import", { method: "POST", body: { child_id: child.id, data, dry_run: true } });
    state.pendingImport = data;
    const other = data.child && data.child.trim().toLowerCase() !== child.name.trim().toLowerCase();
    $("#importSummary").innerHTML = `
      ${other ? `<div class="warnings">${icon("alert", "sm")} Die Datei ist für «${esc(data.child)}», ausgewählt ist «${esc(child.name)}».</div>` : ""}
      <p>Import für <b>${esc(child.name)}</b>${data.title ? ` aus «${esc(data.title)}»` : ""}:</p>
      <ul>
        <li>${s.doses.new} Gaben${s.doses.skipped ? ` (${s.doses.skipped} bereits vorhanden)` : ""}</li>
        <li>${s.temperatures.new} Temperaturen${s.temperatures.skipped ? ` (${s.temperatures.skipped} bereits vorhanden)` : ""}</li>
        <li>${s.events.new} Ereignisse${s.events.skipped ? ` (${s.events.skipped} bereits vorhanden)` : ""}</li>
      </ul>
      ${s.new_medications.length ? `<p>Neue Medikamente: ${s.new_medications.map(esc).join(", ")}</p>` : ""}
      <p class="muted small">Sperrzeit-Warnungen werden beim Import nicht geprüft. Bereits vorhandene Einträge werden übersprungen.</p>`;
    $("#importConfirm").disabled = !(s.doses.new + s.temperatures.new + s.events.new);
    $("#importDialog").showModal();
  } catch (e) { toast(e.message); }
}

async function confirmImport() {
  const child = currentChild();
  if (!state.pendingImport || !child) return;
  $("#importConfirm").disabled = true;
  try {
    const s = await api("import", { method: "POST", body: { child_id: child.id, data: state.pendingImport } });
    $("#importDialog").close();
    state.pendingImport = null;
    await loadMeds();
    toast(`Importiert: ${s.doses.new} Gaben, ${s.temperatures.new} Temperaturen, ${s.events.new} Ereignisse`);
    refreshViews();
  } catch (e) { toast(e.message); $("#importConfirm").disabled = false; }
}

/* ---------- Diagramm ---------- */
function chartRange() {
  if (state.chartHours === "custom") {
    const f = parseDate($("#chartFrom").value), t = parseDate($("#chartTo").value);
    if (!f || !t) return null;
    const from = f, to = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59);
    return to > from ? { from, to } : null;
  }
  const to = new Date();
  return { from: new Date(to.getTime() - state.chartHours * 3600000), to };
}

async function loadChart() {
  const box = $("#chartBox");
  if (!state.childId) { box.innerHTML = `<div class="empty">Kein Kind ausgewählt.</div>`; $("#chartSummary").innerHTML = ""; return; }
  const r = chartRange();
  if (!r) { box.innerHTML = `<div class="empty">Bitte Von- und Bis-Datum als TT.MM.JJJJ eingeben.</div>`; $("#chartSummary").innerHTML = ""; return; }
  try {
    state.chart = await api(`chart?child_id=${state.childId}&from=${encodeURIComponent(r.from.toISOString())}&to=${encodeURIComponent(r.to.toISOString())}`);
  } catch (e) { toast(e.message); return; }
  renderChart();
}

// Farbe folgt dem Wirkstoff (stabil, unabhängig vom Zeitraum)
const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"];
const FIXED_COLORS = { paracetamol: 0, ibuprofen: 1 };
function ingredientColor(name) {
  const key = (name || "").trim().toLowerCase();
  if (key in FIXED_COLORS) return `var(${SERIES[FIXED_COLORS[key]]})`;
  const others = [...new Set(state.meds.map((m) => m.active_ingredient.trim().toLowerCase()))]
    .filter((k) => !(k in FIXED_COLORS)).sort();
  const i = others.indexOf(key);
  return `var(${SERIES[2 + ((i < 0 ? 0 : i) % (SERIES.length - 2))]})`;
}

function niceTicks(from, to, width) {
  const span = to - from, H = 3600000;
  const maxTicks = Math.max(2, Math.floor(width / 70));
  const steps = [1, 2, 3, 6, 12, 24, 48, 72, 168, 336].map((h) => h * H);
  const step = steps.find((s) => span / s <= maxTicks) || 720 * H;
  const ticks = [];
  const start = new Date(from);
  if (step >= 24 * H) start.setHours(0, 0, 0, 0); else start.setMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= to; t += step) {
    if (step < 24 * H) { const d = new Date(t); if (d.getHours() % (step / H)) continue; }
    if (t >= from) ticks.push(t);
    if (ticks.length > 60) break;
  }
  return { ticks, daily: step >= 24 * H };
}

function renderChart() {
  const c = state.chart;
  const box = $("#chartBox");
  if (!c) return;
  const from = new Date(c.from).getTime(), to = new Date(c.to).getTime();
  const temps = c.temperatures.map((t) => ({ ...t, x: new Date(t.measured_at).getTime() }));
  const doses = c.doses.map((d) => ({ ...d, x: new Date(d.given_at).getTime() }));
  const events = (c.events || []).map((e) => ({ ...e, x: new Date(e.occurred_at).getTime() }));
  if (!temps.length && !doses.length && !events.length) {
    box.innerHTML = `<div class="empty">Keine Messungen oder Gaben in diesem Zeitraum.</div>`;
    $("#chartSummary").innerHTML = "";
    return;
  }
  const lanes = [...new Set(doses.map((d) => d.active_ingredient))];
  const W = Math.max(300, box.clientWidth - 8);
  const padL = 40, padR = 12, padT = 12;
  const plotH = Math.round(Math.min(260, Math.max(180, W * 0.5)));
  const laneH = 36, axisH = 30;
  const nLanes = lanes.length + (events.length ? 1 : 0);
  const H = padT + plotH + axisH + nLanes * laneH + (nLanes ? 6 : 0);
  const plotW = W - padL - padR;
  const xs = (t) => padL + ((t - from) / (to - from)) * plotW;

  let lo = 36, hi = 40;
  temps.forEach((t) => { lo = Math.min(lo, Math.floor(t.celsius)); hi = Math.max(hi, Math.ceil(t.celsius)); });
  const ys = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const fever = c.fever_c || FEVER;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Temperaturverlauf mit Medikamentengaben">`;
  // Fieberbereich + Gitter
  svg += `<rect class="fever-band" x="${padL}" y="${ys(hi)}" width="${plotW}" height="${ys(fever) - ys(hi)}"/>`;
  for (let v = lo; v <= hi; v += (hi - lo > 5 ? 1 : 0.5)) {
    svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${ys(v)}" y2="${ys(v)}"/>`;
    if (Number.isInteger(v)) svg += `<text x="${padL - 6}" y="${ys(v) + 4}" text-anchor="end">${v}°</text>`;
  }
  svg += `<line class="fever-line" x1="${padL}" x2="${W - padR}" y1="${ys(fever)}" y2="${ys(fever)}"/>`;
  svg += `<text class="fever-label" x="${padL + 4}" y="${ys(fever) + 14}">Fieber ab ${fmtNum(fever)} °C</text>`;

  // Zeitachse
  const { ticks, daily } = niceTicks(from, to, plotW);
  const axisY = padT + plotH;
  const bottom = H - 2;
  ticks.forEach((t) => {
    const d = new Date(t), x = xs(t);
    const midnight = d.getHours() === 0 && d.getMinutes() === 0;
    svg += `<line class="grid" x1="${x}" x2="${x}" y1="${padT}" y2="${bottom}" ${midnight ? 'stroke-width="1.5"' : ""}/>`;
    const lbl = daily || midnight
      ? `${WD_SHORT[d.getDay()]} ${fmtDM(d)}`
      : fmtHM(d);
    svg += `<text x="${x}" y="${axisY + 16}" text-anchor="middle">${esc(lbl)}</text>`;
  });

  // Temperaturkurve (Lücke bei > 12 h ohne Messung)
  if (temps.length) {
    let d = "", prev = null;
    temps.forEach((t) => {
      d += `${!prev || t.x - prev.x > 12 * 3600000 ? "M" : "L"}${xs(t.x).toFixed(1)},${ys(t.celsius).toFixed(1)}`;
      prev = t;
    });
    svg += `<path class="temp-path" d="${d}"/>`;
    temps.forEach((t, i) => {
      svg += `<circle class="temp-dot" cx="${xs(t.x).toFixed(1)}" cy="${ys(t.celsius).toFixed(1)}" r="4" data-t="${i}"/>`;
    });
    // Höchstwert direkt beschriften
    const max = temps.reduce((a, b) => (b.celsius > a.celsius ? b : a));
    const mx = Math.min(Math.max(xs(max.x), padL + 20), W - padR - 20);
    svg += `<text x="${mx}" y="${Math.max(ys(max.celsius) - 9, 10)}" text-anchor="middle" class="lane-label">${fmtNum(max.celsius)}°</text>`;
  }

  // Gaben-Spuren pro Wirkstoff
  lanes.forEach((ing, li) => {
    const top = axisY + axisH + li * laneH;
    const col = ingredientColor(ing);
    const y = top + 24;
    svg += `<text class="lane-label" x="${padL + 2}" y="${top + 10}">${esc(ing)}</text>`;
    svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    doses.forEach((d, di) => {
      if (d.active_ingredient !== ing) return;
      const x = xs(d.x);
      // dünne Hilfslinie hoch in die Temperaturkurve
      svg += `<line x1="${x}" x2="${x}" y1="${padT}" y2="${axisY}" stroke="${col}" stroke-opacity=".35" stroke-width="1"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="5" fill="${col}" stroke="var(--card)" stroke-width="2" data-d="${di}"/>`;
    });
  });
  if (events.length) {
    const top = axisY + axisH + lanes.length * laneH, y = top + 24;
    svg += `<text class="lane-label" x="${padL + 2}" y="${top + 10}">Ereignisse</text>`;
    svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    events.forEach((e) => {
      const x = xs(e.x);
      svg += `<path class="event-mark" d="M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} Z"/>`;
    });
  }
  svg += `<line class="cross" id="chartCross" x1="0" x2="0" y1="${padT}" y2="${bottom}" visibility="hidden"/>`;
  svg += `<rect id="chartHit" x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent"/>`;
  svg += `</svg>`;
  box.innerHTML = svg;

  // Hover/Tap: nächster Punkt (Messung oder Gabe) zur Zeigerposition
  const svgEl = box.querySelector("svg");
  const tip = $("#chartTip"), cross = svgEl.querySelector("#chartCross");
  const points = [
    ...temps.map((t) => ({ x: xs(t.x), y: ys(t.celsius), html: `<b>${fmtNum(t.celsius)} °C</b>${t.method ? " · " + esc(t.method) : ""}<br>${esc(fmtTime(t.measured_at))}${t.note ? "<br>" + esc(t.note) : ""}` })),
    ...events.map((e) => ({ x: xs(e.x), y: null, html: `<b>${esc(e.kind)}</b>${e.note ? "<br>" + esc(e.note) : ""}<br>${esc(fmtTime(e.occurred_at))}` })),
    ...doses.map((d) => ({ x: xs(d.x), y: null, html: `<b>${esc(d.medication_name)}</b><br>${fmtNum(d.amount)} ${esc(d.unit)}${d.mg != null ? ` (${fmtNum(d.mg)} mg)` : ""}<br>${esc(fmtTime(d.given_at))}` })),
  ];
  const show = (ev) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let best = null, bd = Infinity;
    points.forEach((p) => { const dist = Math.abs(p.x - px); if (dist < bd) { bd = dist; best = p; } });
    if (!best || bd > 24) { hide(); return; }
    cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x); cross.setAttribute("visibility", "visible");
    // alle Einträge am selben Zeitpunkt gemeinsam anzeigen
    const same = points.filter((q) => Math.abs(q.x - best.x) < 1.5);
    tip.innerHTML = same.slice(0, 6).map((q) => q.html).join("<hr>") + (same.length > 6 ? `<br>… +${same.length - 6}` : "");
    tip.hidden = false;
    const tx = rect.left + (best.x / W) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(8, tx - tw / 2), window.innerWidth - tw - 8)}px`;
    tip.style.top = `${Math.max(8, rect.top + 4 - tip.offsetHeight)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  svgEl.addEventListener("pointermove", show);
  svgEl.addEventListener("pointerdown", show);
  svgEl.addEventListener("pointerleave", hide);

  // Zusammenfassung + Legende
  const parts = [];
  if (temps.length) {
    const vals = temps.map((t) => t.celsius);
    const feverCount = vals.filter((v) => v >= fever).length;
    parts.push(`<div><b>Temperatur:</b> ${temps.length} Messung(en) · max. ${fmtNum(Math.max(...vals))} °C · min. ${fmtNum(Math.min(...vals))} °C · ${feverCount}× ≥ ${fmtNum(fever)} °C</div>`);
  }
  const counts = {};
  doses.forEach((d) => { counts[d.active_ingredient] = (counts[d.active_ingredient] || 0) + 1; });
  const legend = [];
  if (temps.length) legend.push(`<span><span class="sw line" style="background:var(--temp)"></span>Temperatur</span>`);
  lanes.forEach((ing) => legend.push(`<span><span class="sw" style="background:${ingredientColor(ing)}"></span>${esc(ing)}: ${counts[ing]}×</span>`));
  if (events.length) legend.push(`<span><span class="sw diamond"></span>Ereignisse: ${events.length}×</span>`);
  parts.push(`<div class="legend">${legend.join("")}</div>`);
  parts.push(`<p class="muted small">Tippe auf einen Punkt für Details. Fiebergrenze rektal/Ohr 38.0 °C; unter der Achsel gemessen liegt der Wert meist etwas tiefer.</p>`);
  $("#chartSummary").innerHTML = parts.join("");
}

/* ---------- Medikamente ---------- */
async function loadMeds() {
  state.meds = await api("medications");
  renderMedList();
  $("#ingredientList").innerHTML = [...new Set(state.meds.map((m) => m.active_ingredient))]
    .sort().map((i) => `<option value="${esc(i)}">`).join("");
}

function medSummary(m) {
  const parts = [];
  if (m.min_interval_hours > 0) parts.push(`alle ${fmtNum(m.min_interval_hours)} h`);
  else parts.push("keine Sperrzeit");
  if (m.max_doses_per_24h) parts.push(`max. ${m.max_doses_per_24h}×/24 h`);
  if (m.dose_mg_per_kg) parts.push(`${fmtNum(m.dose_mg_per_kg)} mg/kg`);
  if (m.max_mg_per_kg_day) parts.push(`max. ${fmtNum(m.max_mg_per_kg_day)} mg/kg/Tag`);
  return parts.join(" · ");
}

const matches = (m, q) => !q || m.name.toLowerCase().includes(q) || m.active_ingredient.toLowerCase().includes(q);

function renderMedList() {
  const q = $("#medSearch").value.trim().toLowerCase();
  const list = state.meds.filter((m) => matches(m, q));
  const el = $("#medList");
  if (!list.length) { el.innerHTML = `<div class="empty">Keine Medikamente gefunden.</div>`; return; }
  el.innerHTML = list.map((m) => `
    <div class="item clickable" data-id="${m.id}">
      <div class="main">
        <div class="title">${m.favorite ? star() + " " : ""}${esc(m.name)}</div>
        <div class="sub"><span class="tag">${esc(m.active_ingredient)}</span><span class="tag">${esc(m.form || "–")}</span><span class="tag">${esc(m.route || "–")}</span></div>
        <div class="sub">${esc(medSummary(m))}</div>
      </div>
      <span class="chev">${icon("chevron")}</span>
    </div>`).join("");
  el.querySelectorAll(".item").forEach((it) => it.addEventListener("click", () => openMedDialog(Number(it.dataset.id))));
}

const MED_FORM_FIELDS = ["name", "active_ingredient", "form", "route", "dose_unit", "mg_per_unit", "default_dose",
  "dose_mg_per_kg", "max_single_mg", "min_interval_hours", "max_doses_per_24h", "max_mg_per_kg_day", "notes"];
const MED_NUM_FIELDS = new Set(["mg_per_unit", "default_dose", "dose_mg_per_kg", "max_single_mg",
  "min_interval_hours", "max_doses_per_24h", "max_mg_per_kg_day"]);

function openMedDialog(id = null) {
  state.editingMedId = id;
  const f = $("#medForm");
  f.reset();
  const m = id ? state.meds.find((x) => x.id === id) : null;
  $("#medDialogTitle").textContent = m ? "Medikament bearbeiten" : "Medikament hinzufügen";
  if (m) MED_FORM_FIELDS.forEach((k) => { f.elements[k].value = m[k] ?? ""; });
  f.elements.favorite.checked = !!m?.favorite;
  $("#medDelete").hidden = !m;
  $("#medDialog").showModal();
}

async function saveMed(ev) {
  ev.preventDefault();
  const f = $("#medForm");
  const body = {};
  MED_FORM_FIELDS.forEach((k) => { body[k] = MED_NUM_FIELDS.has(k) ? normNum(f.elements[k].value) : f.elements[k].value; });
  body.favorite = f.elements.favorite.checked;
  try {
    if (state.editingMedId) await api(`medications/${state.editingMedId}`, { method: "PUT", body });
    else await api("medications", { method: "POST", body });
    $("#medDialog").close();
    await loadMeds();
    loadStatus();
    toast("Gespeichert");
  } catch (e) { toast(e.message); }
}

async function deleteMed() {
  const m = state.meds.find((x) => x.id === state.editingMedId);
  if (!m || !confirm(`«${m.name}» entfernen? Bereits erfasste Gaben bleiben im Verlauf erhalten.`)) return;
  try {
    await api(`medications/${m.id}`, { method: "DELETE" });
    $("#medDialog").close();
    await loadMeds();
    toast("Entfernt");
  } catch (e) { toast(e.message); }
}

/* ---------- Gabe erfassen ---------- */
let pendingForce = false;

function statusFor(med) {
  const key = (med.active_ingredient || med.name).trim().toLowerCase().replace(/\s+/g, " ");
  return (state.status?.ingredients || []).find((s) => s.key === key);
}

function renderDosePicker() {
  renderQuick($("#doseQuick"), selectDoseMed, state.doseMedId);
  const q = $("#doseMedFilter").value.trim().toLowerCase();
  // ohne Suche: Medikamente aus der Schnellauswahl nicht doppelt auflisten
  const { favs, recent } = quickMeds();
  const shown = new Set(q ? [] : [...favs, ...recent].map((m) => m.id));
  const list = state.meds.filter((m) => matches(m, q) && !shown.has(m.id));
  $("#doseMedList").innerHTML = list.length ? list.map((m) => `
    <button type="button" class="pick" data-med="${m.id}">
      <div>${m.favorite ? star() + " " : ""}${esc(m.name)}</div>
      <div class="sub">${esc(m.active_ingredient)} · ${esc(m.form || "")} · ${esc(m.route || "")}</div>
    </button>`).join("") : `<div class="muted small">Nichts gefunden.</div>`;
  $("#doseMedList").querySelectorAll(".pick").forEach((b) => b.addEventListener("click", () => selectDoseMed(Number(b.dataset.med))));
}

function showDosePicker(show) {
  $("#dosePicker").hidden = !show;
  $("#doseSelected").hidden = show;
  $("#doseForm .sheet-actions").hidden = show;
  if (show) { $("#doseMedFilter").value = ""; renderDosePicker(); }
}

function selectDoseMed(id) {
  state.doseMedId = id;
  showDosePicker(false);
  onDoseMedChange();
}

function stepFor(unit) { return unit === "ml" ? 0.5 : unit === "mg" ? 10 : 1; }

function stepDose(dir) {
  const med = state.meds.find((m) => m.id === state.doseMedId);
  const step = stepFor(med?.dose_unit);
  const v = parseFloat(normNum($("#doseAmount").value)) || 0;
  const n = dir > 0 ? (Math.floor(v / step + 1e-9) + 1) * step : (Math.ceil(v / step - 1e-9) - 1) * step;
  $("#doseAmount").value = fmtNum(Math.max(0, Math.round(n * 100) / 100));
  resetDoseWarnings();
}

async function onDoseMedChange(keepAmount = false) {
  resetDoseWarnings();
  const med = state.meds.find((m) => m.id === state.doseMedId);
  const info = $("#doseMedInfo");
  if (!med) { info.innerHTML = ""; $("#doseUnit").textContent = ""; return; }
  $("#doseMedName").innerHTML = `${med.favorite ? star() + " " : ""}${esc(shortName(med.name))}`;
  $("#doseMedSub").textContent = [med.active_ingredient, med.form, med.route].filter(Boolean).join(" · ");
  $("#doseUnit").textContent = med.dose_unit;
  let html = `<div class="muted">${esc(medSummary(med))}</div>`;
  let amount = med.default_dose;
  const child = currentChild();
  try {
    const { suggestion } = await api(`suggestion?child_id=${state.childId}&medication_id=${med.id}`);
    if (suggestion) {
      const divisible = ["ml", "Tropfen", "mg"].includes(med.dose_unit);
      html += `<div class="hint">Vorschlag für ${fmtNum(child.weight_kg)} kg: ${fmtNum(suggestion.mg)} mg (${fmtNum(med.dose_mg_per_kg)} mg/kg)${divisible && suggestion.amount != null ? ` ≈ ${fmtNum(suggestion.amount)} ${esc(med.dose_unit)}` : ""}</div>`;
      if (!divisible && med.mg_per_unit && med.default_dose) {
        const mg = med.default_dose * med.mg_per_unit;
        html += `<div class="muted">${fmtNum(med.default_dose)} ${esc(med.dose_unit)} = ${fmtNum(mg)} mg (${fmtNum(mg / child.weight_kg)} mg/kg)</div>`;
      }
      if (suggestion.amount != null && divisible) {
        amount = med.dose_unit === "Tropfen" ? Math.round(suggestion.amount) : Math.round(suggestion.amount * 10) / 10;
      }
    } else if (med.dose_mg_per_kg && !child?.weight_kg) {
      html += `<div class="muted">Für einen Dosisvorschlag beim Kind das Gewicht erfassen.</div>`;
    }
  } catch (_) { /* Vorschlag optional */ }
  const st = statusFor(med);
  if (st && !st.allowed_now && !state.editingDose) {
    html += `<div class="wait-note">${icon("clock", "sm")} ${esc(st.ingredient)} erst wieder ab ${fmtTime(st.next_allowed_at)}</div>`;
  }
  if (med.notes) html += `<div class="muted small">${esc(med.notes)}</div>`;
  info.innerHTML = html;
  if (!keepAmount) $("#doseAmount").value = amount != null ? fmtNum(amount) : "";
}

function resetDoseWarnings() {
  pendingForce = false;
  $("#doseWarnings").hidden = true;
  $("#doseSubmit").textContent = "Speichern";
  $("#doseSubmit").classList.remove("danger");
  $("#doseSubmit").classList.add("primary");
}

async function openDoseDialog(medId = null, dose = null) {
  if (!state.childId) return;
  if (!state.meds.length) await loadMeds();
  state.editingDose = dose;
  $("#doseForm").reset();
  $("#doseDialogTitle").textContent = dose ? "Gabe bearbeiten" : "Gabe erfassen";
  $("#doseDelete").hidden = !dose;
  if (dose && !state.meds.some((m) => m.id === dose.medication_id)) {
    // archiviertes Medikament: trotzdem anzeigen
    const all = await api("medications?archived=1");
    const med = all.find((m) => m.id === dose.medication_id);
    if (med) state.meds.push(med);
  }
  state.doseMedId = medId;
  setWhen($("#doseWhen"), dose ? new Date(dose.given_at) : roundToQuarter(new Date()));
  resetDoseWarnings();
  showDosePicker(!medId);
  $("#doseDialog").showModal();
  if (medId) await onDoseMedChange(!!dose);
  if (dose) {
    $("#doseAmount").value = fmtNum(dose.amount);
    $("#doseNote").value = dose.note || "";
  }
}

async function deleteDose() {
  const d = state.editingDose;
  if (!d || !confirm("Diese Gabe löschen?")) return;
  try {
    await api(`doses/${d.id}`, { method: "DELETE" });
    $("#doseDialog").close();
    toast("Gelöscht");
    refreshViews();
  } catch (e) { toast(e.message); }
}

async function saveDose(ev) {
  ev.preventDefault();
  if (!state.doseMedId) { toast("Bitte Medikament wählen"); return; }
  const time = readWhen($("#doseWhen"));
  if (!time) { toast("Uhrzeit bitte als HH:MM eingeben"); return; }
  const amount = normNum($("#doseAmount").value);
  if (!amount) { toast("Bitte Menge eingeben"); return; }
  const body = {
    child_id: state.childId,
    medication_id: state.doseMedId,
    amount,
    given_at: time.toISOString(),
    note: $("#doseNote").value,
    force: pendingForce,
  };
  try {
    if (state.editingDose) await api(`doses/${state.editingDose.id}`, { method: "PUT", body });
    else await api("doses", { method: "POST", body });
    $("#doseDialog").close();
    toast(state.editingDose ? "Änderung gespeichert" : "Gabe gespeichert");
    refreshViews();
  } catch (e) {
    if (e.status === 409 && e.data?.warnings) {
      const w = $("#doseWarnings");
      w.innerHTML = `<b>${icon("alert", "sm")} Achtung</b><ul>${e.data.warnings.map((x) => `<li>${esc(x.message)}</li>`).join("")}</ul>
        Nur speichern, wenn dies ärztlich so verordnet ist oder bereits gegeben wurde.`;
      w.hidden = false;
      w.scrollIntoView({ block: "nearest", behavior: "smooth" });
      pendingForce = true;
      $("#doseSubmit").textContent = "Trotzdem speichern";
      $("#doseSubmit").classList.remove("primary");
      $("#doseSubmit").classList.add("danger");
    } else {
      toast(e.message);
    }
  }
}

/* ---------- Init ---------- */
function bind() {
  hydrateIcons();
  document.querySelectorAll("nav.bottom button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  // Tipp auf den abgedunkelten Hintergrund schliesst das Sheet
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
  $("#btnAddDose").addEventListener("click", () => openDoseDialog());
  $("#btnAddTemp").addEventListener("click", () => openTempDialog());
  $("#btnAddEvent").addEventListener("click", () => openEventDialog());
  $("#eventKind").innerHTML = EVENT_KINDS.map((k) => `<button type="button" data-v="${k}">${k}</button>`).join("");
  document.querySelectorAll("#eventKind button").forEach((b) => b.addEventListener("click", () => setEventKind(b.dataset.v)));
  buildWhen($("#eventWhen"), { quarter: false });
  $("#eventForm").addEventListener("submit", saveEvent);
  $("#eventDelete").addEventListener("click", deleteEvent);
  $("#importFile").addEventListener("change", onImportFile);
  $("#importConfirm").addEventListener("click", confirmImport);
  $("#btnAddMed").addEventListener("click", () => openMedDialog());
  $("#btnAddChild").addEventListener("click", () => openChildDialog());
  $("#medSearch").addEventListener("input", renderMedList);

  buildWhen($("#doseWhen"), { quarter: true });
  buildWhen($("#tempWhen"), { quarter: false });
  $("#doseMedFilter").addEventListener("input", renderDosePicker);
  $("#doseChange").addEventListener("click", () => showDosePicker(true));
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => stepDose(Number(b.dataset.step))));
  document.querySelectorAll("[data-tstep]").forEach((b) => b.addEventListener("click", () => stepTemp(Number(b.dataset.tstep))));
  $("#doseDelete").addEventListener("click", deleteDose);
  $("#doseAmount").addEventListener("input", resetDoseWarnings);
  $("#doseWhen").addEventListener("input", resetDoseWarnings);
  $("#doseForm").addEventListener("submit", saveDose);

  document.querySelectorAll("#tempMethod button").forEach((b) => b.addEventListener("click", () =>
    setTempMethod(b.classList.contains("active") ? "" : b.dataset.v)));
  $("#tempForm").addEventListener("submit", saveTemp);
  $("#tempDelete").addEventListener("click", deleteTemp);

  $("#medForm").addEventListener("submit", saveMed);
  $("#childForm").addEventListener("submit", saveChild);
  $("#medDelete").addEventListener("click", deleteMed);
  $("#childDelete").addEventListener("click", deleteChild);

  document.querySelectorAll(".date-input").forEach(bindDateInput);
  $("#chartTo").value = fmtDate(new Date());
  $("#chartFrom").value = fmtDate(new Date(Date.now() - 6 * 86400000));
  document.querySelectorAll("#chartRanges button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#chartRanges button").forEach((x) => x.classList.toggle("active", x === b));
    state.chartHours = b.dataset.hours === "custom" ? "custom" : Number(b.dataset.hours);
    $("#chartCustom").hidden = state.chartHours !== "custom";
    loadChart();
  }));
  ["#chartFrom", "#chartTo"].forEach((s) => {
    $(s).addEventListener("change", loadChart);
    $(s).addEventListener("input", () => { if ($(s).value.length === 10 && parseDate($(s).value)) loadChart(); });
  });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.view === "chart") renderChart(); }, 150); });
}

async function init() {
  bind();
  try {
    await Promise.all([loadChildren(), loadMeds()]);
  } catch (e) { toast("Laden fehlgeschlagen: " + e.message); }
  let view = "status";
  try { view = localStorage.getItem("meditrack.view") || "status"; } catch (_) { /* ignorieren */ }
  showView(["status", "history", "chart", "meds", "children"].includes(view) ? view : "status");
  setInterval(() => { if (state.view === "status") renderStatus(); }, 30000);
  setInterval(() => { if (state.view === "status" && !document.hidden) loadStatus(); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.view === "status") loadStatus(); });
}

init();
