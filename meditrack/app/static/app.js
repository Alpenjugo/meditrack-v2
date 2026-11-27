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
  recent: [],
  history: [],
  editingTemp: null,
  chartHours: 72,
  chart: null,
};
const FEVER = 38.0;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n) => (n == null ? "" : Number(n).toLocaleString("de-CH", { maximumFractionDigits: 2 }));

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

/* ---------- Zeitformatierung ---------- */
function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `gestern ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `morgen ${time}`;
  return d.toLocaleString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 24) return `${Math.floor(h / 24)} T ${h % 24} h`;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

/* ---------- Navigation ---------- */
function showView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll("nav.bottom button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "history") loadHistory();
  if (view === "status") loadStatus();
  if (view === "chart") loadChart();
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
  el.innerHTML = state.children.map((c) => `
    <div class="item clickable" data-id="${c.id}">
      <div><div class="title">${esc(c.name)}</div>
      <div class="sub">${[c.weight_kg ? fmtNum(c.weight_kg) + " kg" : "Gewicht fehlt", ageText(c.birthdate)].filter(Boolean).join(" · ")}</div></div>
      <span class="muted">Bearbeiten ›</span>
    </div>`).join("");
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
    f.birthdate.value = c.birthdate || "";
    f.weight_kg.value = c.weight_kg ?? "";
  }
  $("#childDelete").hidden = !c;
  $("#childDialog").showModal();
}

async function saveChild(ev) {
  ev.preventDefault();
  const f = $("#childForm");
  const body = { name: f.name.value, birthdate: f.birthdate.value, weight_kg: f.weight_kg.value };
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
  const sub = blocked ? `⏳ ab ${fmtTime(st.next_allowed_at)}` : esc(m.active_ingredient);
  return `<button type="button" class="chip ${m.favorite ? "fav" : ""} ${blocked ? "blocked" : ""} ${m.id === selectedId ? "selected" : ""}" data-med="${m.id}">
    ${m.favorite ? '<span class="fav-star">★</span> ' : ""}${esc(shortName(m.name))}<small>${sub}</small></button>`;
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

function renderStatus() {
  renderQuick($("#quickPicks"), (id) => openDoseDialog(id));
  const el = $("#statusList");
  $("#btnAddDose").disabled = !state.childId;
  $("#btnAddTemp").disabled = !state.childId;
  renderLastTemp();
  if (!state.childId) {
    el.innerHTML = `<div class="empty">Erfasse zuerst ein Kind.<br><br>
      <button class="btn primary" id="emptyAddChild">+ Kind hinzufügen</button></div>`;
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
        <div class="meta">Zuletzt: ${fmtTime(s.last_given_at)} (vor ${fmtDuration(now - last)}) · ${fmtNum(s.last_amount)} ${esc(s.last_unit)} ${esc(s.medication_name)}${reason}</div>
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

function renderLastTemp() {
  const el = $("#lastTemp");
  const t = state.status?.last_temperature;
  if (!state.childId || !t) { el.innerHTML = ""; return; }
  const age = Date.now() - new Date(t.measured_at).getTime();
  el.innerHTML = `<div class="temp-line ${t.celsius >= FEVER ? "fever" : ""}">
    🌡 <span class="val">${fmtNum(t.celsius)} °C</span>
    <span class="muted small">${fmtTime(t.measured_at)} (vor ${fmtDuration(age)})${t.method ? " · " + esc(t.method) : ""}</span></div>`;
  el.firstElementChild.addEventListener("click", () => openTempDialog(t));
}

/* ---------- Verlauf ---------- */
async function loadHistory() {
  const el = $("#historyList");
  if (!state.childId) { el.innerHTML = `<div class="empty">Kein Kind ausgewählt.</div>`; return; }
  let doses, temps;
  try {
    [doses, temps] = await Promise.all([
      api(`doses?child_id=${state.childId}&limit=300`), api(`temperatures?child_id=${state.childId}&limit=300`)]);
  } catch (e) { toast(e.message); return; }
  state.history = doses;
  state.tempHistory = temps;
  const entries = [
    ...doses.map((d) => ({ kind: "dose", at: d.given_at, d })),
    ...temps.map((t) => ({ kind: "temp", at: t.measured_at, t })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  if (!entries.length) { el.innerHTML = `<div class="empty">Noch keine Gaben oder Messungen erfasst.</div>`; return; }
  let html = "", lastDay = "";
  for (const e of entries) {
    const dt = new Date(e.at);
    const day = dt.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (day !== lastDay) { html += `<div class="day">${esc(day)}</div>`; lastDay = day; }
    const hm = dt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    if (e.kind === "temp") {
      const t = e.t;
      html += `
      <div class="item clickable ${t.celsius >= FEVER ? "fever" : ""}" data-temp="${t.id}">
        <div>
          <div class="title">${hm} · 🌡 <span class="temp-val">${fmtNum(t.celsius)} °C</span></div>
          <div class="sub">Temperatur${t.method ? " · " + esc(t.method) : ""}${t.note ? " · " + esc(t.note) : ""}</div>
        </div>
        <span class="muted">Bearbeiten ›</span>
      </div>`;
      continue;
    }
    const d = e.d;
    html += `
      <div class="item clickable" data-id="${d.id}">
        <div>
          <div class="title">${hm} · ${esc(d.medication_name)}</div>
          <div class="sub">${fmtNum(d.amount)} ${esc(d.unit)}${d.mg != null ? ` (${fmtNum(d.mg)} mg)` : ""} · ${esc(d.active_ingredient)} · ${esc(d.route || "")}${d.note ? " · " + esc(d.note) : ""}</div>
        </div>
        <span class="muted">Bearbeiten ›</span>
      </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll(".item[data-id]").forEach((it) => it.addEventListener("click", () => {
    const dose = state.history.find((x) => x.id === Number(it.dataset.id));
    if (dose) openDoseDialog(dose.medication_id, dose);
  }));
  el.querySelectorAll(".item[data-temp]").forEach((it) => it.addEventListener("click", () => {
    const t = state.tempHistory.find((x) => x.id === Number(it.dataset.temp));
    if (t) openTempDialog(t);
  }));
}

/* ---------- Temperatur ---------- */
function openTempDialog(temp = null) {
  if (!state.childId) return;
  state.editingTemp = temp;
  $("#tempForm").reset();
  $("#tempDialogTitle").textContent = temp ? "Temperatur bearbeiten" : "Temperatur erfassen";
  $("#tempDelete").hidden = !temp;
  let method = "";
  try { method = localStorage.getItem("meditrack.tempMethod") || ""; } catch (_) { /* ignorieren */ }
  $("#tempValue").value = temp ? temp.celsius : "";
  $("#tempMethod").value = temp ? (temp.method || "") : method;
  // Messungen minutengenau (nicht auf 15 min gerundet)
  $("#tempTime").value = toLocalInput(temp ? new Date(temp.measured_at) : new Date());
  $("#tempNote").value = temp?.note || "";
  $("#tempDialog").showModal();
  if (!temp) $("#tempValue").focus();
}

async function saveTemp(ev) {
  ev.preventDefault();
  const time = new Date($("#tempTime").value);
  if (isNaN(time)) { toast("Ungültiger Zeitpunkt"); return; }
  const value = String($("#tempValue").value).replace(",", ".");
  const body = {
    child_id: state.childId, celsius: value, method: $("#tempMethod").value,
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

/* ---------- Diagramm ---------- */
function chartRange() {
  if (state.chartHours === "custom") {
    const f = $("#chartFrom").value, t = $("#chartTo").value;
    if (!f || !t) return null;
    const from = new Date(f + "T00:00:00"), to = new Date(t + "T23:59:59");
    return to > from ? { from, to } : null;
  }
  const to = new Date();
  return { from: new Date(to.getTime() - state.chartHours * 3600000), to };
}

async function loadChart() {
  const box = $("#chartBox");
  if (!state.childId) { box.innerHTML = `<div class="empty">Kein Kind ausgewählt.</div>`; $("#chartSummary").innerHTML = ""; return; }
  const r = chartRange();
  if (!r) { box.innerHTML = `<div class="empty">Bitte Von- und Bis-Datum wählen.</div>`; $("#chartSummary").innerHTML = ""; return; }
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
  if (!temps.length && !doses.length) {
    box.innerHTML = `<div class="empty">Keine Messungen oder Gaben in diesem Zeitraum.</div>`;
    $("#chartSummary").innerHTML = "";
    return;
  }
  const lanes = [...new Set(doses.map((d) => d.active_ingredient))];
  const W = Math.max(300, box.clientWidth - 8);
  const padL = 40, padR = 12, padT = 12;
  const plotH = Math.round(Math.min(260, Math.max(180, W * 0.5)));
  const laneH = 36, axisH = 30;
  const H = padT + plotH + axisH + lanes.length * laneH + (lanes.length ? 6 : 0);
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
      ? d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" })
      : d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
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
  svg += `<line class="cross" id="chartCross" x1="0" x2="0" y1="${padT}" y2="${bottom}" visibility="hidden"/>`;
  svg += `<rect id="chartHit" x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent"/>`;
  svg += `</svg>`;
  box.innerHTML = svg;

  // Hover/Tap: nächster Punkt (Messung oder Gabe) zur Zeigerposition
  const svgEl = box.querySelector("svg");
  const tip = $("#chartTip"), cross = svgEl.querySelector("#chartCross");
  const points = [
    ...temps.map((t) => ({ x: xs(t.x), y: ys(t.celsius), html: `<b>${fmtNum(t.celsius)} °C</b>${t.method ? " · " + esc(t.method) : ""}<br>${esc(fmtTime(t.measured_at))}${t.note ? "<br>" + esc(t.note) : ""}` })),
    ...doses.map((d) => ({ x: xs(d.x), y: null, html: `<b>${esc(d.medication_name)}</b><br>${fmtNum(d.amount)} ${esc(d.unit)}${d.mg != null ? ` (${fmtNum(d.mg)} mg)` : ""}<br>${esc(fmtTime(d.given_at))}` })),
  ];
  const show = (ev) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let best = null, bd = Infinity;
    points.forEach((p) => { const dist = Math.abs(p.x - px); if (dist < bd) { bd = dist; best = p; } });
    if (!best || bd > 24) { hide(); return; }
    cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x); cross.setAttribute("visibility", "visible");
    tip.innerHTML = best.html;
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

function renderMedList() {
  const q = $("#medSearch").value.trim().toLowerCase();
  const list = state.meds.filter((m) => !q || m.name.toLowerCase().includes(q) || m.active_ingredient.toLowerCase().includes(q));
  const el = $("#medList");
  if (!list.length) { el.innerHTML = `<div class="empty">Keine Medikamente gefunden.</div>`; return; }
  el.innerHTML = list.map((m) => `
    <div class="item clickable" data-id="${m.id}">
      <div>
        <div class="title">${m.favorite ? '<span class="fav-star">★</span> ' : ""}${esc(m.name)}</div>
        <div class="sub"><span class="tag">${esc(m.active_ingredient)}</span><span class="tag">${esc(m.form || "–")}</span><span class="tag">${esc(m.route || "–")}</span></div>
        <div class="sub">${esc(medSummary(m))}</div>
      </div>
      <span class="muted">›</span>
    </div>`).join("");
  el.querySelectorAll(".item").forEach((it) => it.addEventListener("click", () => openMedDialog(Number(it.dataset.id))));
}

const MED_FORM_FIELDS = ["name", "active_ingredient", "form", "route", "dose_unit", "mg_per_unit", "default_dose",
  "dose_mg_per_kg", "max_single_mg", "min_interval_hours", "max_doses_per_24h", "max_mg_per_kg_day", "notes"];

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
  MED_FORM_FIELDS.forEach((k) => { body[k] = f.elements[k].value; });
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

function fillDoseMedSelect(selectedId) {
  const q = $("#doseMedFilter").value.trim().toLowerCase();
  const sel = $("#doseMed");
  const list = state.meds.filter((m) => !q || m.name.toLowerCase().includes(q) || m.active_ingredient.toLowerCase().includes(q));
  sel.innerHTML = list.map((m) => `<option value="${m.id}">${esc(m.name)} — ${esc(m.active_ingredient)}</option>`).join("");
  if (selectedId && list.some((m) => m.id === selectedId)) sel.value = String(selectedId);
  else if (list.length === 1) sel.value = String(list[0].id);
}

function statusFor(med) {
  const key = (med.active_ingredient || med.name).trim().toLowerCase().replace(/\s+/g, " ");
  return (state.status?.ingredients || []).find((s) => s.key === key);
}

async function onDoseMedChange(keepAmount = false) {
  resetDoseWarnings();
  renderQuick($("#doseQuick"), pickDoseMed, Number($("#doseMed").value));
  const med = state.meds.find((m) => m.id === Number($("#doseMed").value));
  const info = $("#doseMedInfo");
  if (!med) { info.innerHTML = ""; $("#doseUnit").textContent = ""; return; }
  $("#doseUnit").textContent = med.dose_unit;
  let html = `<div><b>${esc(med.active_ingredient)}</b> · ${esc(med.form || "")} · ${esc(med.route || "")}</div>
    <div class="muted">${esc(medSummary(med))}</div>`;
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
      if (suggestion.amount != null && ["ml", "Tropfen", "mg"].includes(med.dose_unit)) {
        amount = med.dose_unit === "Tropfen" ? Math.round(suggestion.amount) : Math.round(suggestion.amount * 10) / 10;
      }
    } else if (med.dose_mg_per_kg && !child?.weight_kg) {
      html += `<div class="muted">Für einen Dosisvorschlag beim Kind das Gewicht erfassen.</div>`;
    }
  } catch (_) { /* Vorschlag optional */ }
  const st = statusFor(med);
  if (st && !st.allowed_now && !state.editingDose) {
    html += `<div style="color:var(--wait);font-weight:600">⏳ ${esc(st.ingredient)} erst wieder ab ${fmtTime(st.next_allowed_at)}</div>`;
  }
  if (med.notes) html += `<div class="muted small">${esc(med.notes)}</div>`;
  info.innerHTML = html;
  if (!keepAmount) $("#doseAmount").value = amount ?? "";
}

function pickDoseMed(id) {
  $("#doseMedFilter").value = "";
  fillDoseMedSelect(id);
  onDoseMedChange();
}

function resetDoseWarnings() {
  pendingForce = false;
  $("#doseWarnings").hidden = true;
  $("#doseSubmit").textContent = "Speichern";
  $("#doseSubmit").classList.remove("danger");
}

async function openDoseDialog(medId = null, dose = null) {
  if (!state.childId) return;
  if (!state.meds.length) await loadMeds();
  state.editingDose = dose;
  $("#doseForm").reset();
  $("#doseMedFilter").value = "";
  $("#doseDialogTitle").textContent = dose ? "Gabe bearbeiten" : "Gabe erfassen";
  $("#doseDelete").hidden = !dose;
  if (dose && !state.meds.some((m) => m.id === dose.medication_id)) {
    // archiviertes Medikament: trotzdem auswählbar machen
    const all = await api("medications?archived=1");
    const med = all.find((m) => m.id === dose.medication_id);
    if (med) state.meds.push(med);
  }
  fillDoseMedSelect(medId);
  $("#doseTime").value = toLocalInput(dose ? new Date(dose.given_at) : roundToQuarter(new Date()));
  resetDoseWarnings();
  $("#doseDialog").showModal();
  await onDoseMedChange(!!dose);
  if (dose) {
    $("#doseAmount").value = dose.amount;
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
  const medId = Number($("#doseMed").value);
  if (!medId) { toast("Bitte Medikament wählen"); return; }
  const time = new Date($("#doseTime").value);
  if (isNaN(time)) { toast("Ungültiger Zeitpunkt"); return; }
  const body = {
    child_id: state.childId,
    medication_id: medId,
    amount: $("#doseAmount").value,
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
      w.innerHTML = `<b>⚠️ Achtung</b><ul>${e.data.warnings.map((x) => `<li>${esc(x.message)}</li>`).join("")}</ul>
        Nur speichern, wenn dies ärztlich so verordnet ist oder bereits gegeben wurde.`;
      w.hidden = false;
      pendingForce = true;
      $("#doseSubmit").textContent = "Trotzdem speichern";
      $("#doseSubmit").classList.add("danger");
    } else {
      toast(e.message);
    }
  }
}

/* ---------- Init ---------- */
function bind() {
  document.querySelectorAll("nav.bottom button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#btnAddDose").addEventListener("click", () => openDoseDialog());
  $("#btnAddMed").addEventListener("click", () => openMedDialog());
  $("#btnAddTemp").addEventListener("click", () => openTempDialog());
  $("#tempForm").addEventListener("submit", saveTemp);
  $("#tempDelete").addEventListener("click", deleteTemp);
  const today = toLocalInput(new Date()).slice(0, 10);
  $("#chartTo").value = today;
  $("#chartFrom").value = toLocalInput(new Date(Date.now() - 6 * 86400000)).slice(0, 10);
  document.querySelectorAll("#chartRanges button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#chartRanges button").forEach((x) => x.classList.toggle("active", x === b));
    state.chartHours = b.dataset.hours === "custom" ? "custom" : Number(b.dataset.hours);
    $("#chartCustom").hidden = state.chartHours !== "custom";
    loadChart();
  }));
  ["#chartFrom", "#chartTo"].forEach((s) => $(s).addEventListener("change", loadChart));
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.view === "chart") renderChart(); }, 150); });
  $("#btnAddChild").addEventListener("click", () => openChildDialog());
  $("#medSearch").addEventListener("input", renderMedList);
  $("#doseMedFilter").addEventListener("input", () => { fillDoseMedSelect(Number($("#doseMed").value)); onDoseMedChange(); });
  $("#doseMed").addEventListener("change", () => onDoseMedChange());
  $("#doseDelete").addEventListener("click", deleteDose);
  ["#doseAmount", "#doseTime"].forEach((s) => $(s).addEventListener("input", resetDoseWarnings));
  $("#doseForm").addEventListener("submit", saveDose);
  $("#medForm").addEventListener("submit", saveMed);
  $("#childForm").addEventListener("submit", saveChild);
  $("#medDelete").addEventListener("click", deleteMed);
  $("#childDelete").addEventListener("click", deleteChild);
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
