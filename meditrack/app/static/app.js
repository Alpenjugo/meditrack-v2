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
};

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
  if (state.view === "history") loadHistory(); else loadStatus();
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
    state.status = await api(`status?child_id=${state.childId}`);
  } catch (e) { toast(e.message); state.status = null; }
  renderStatus();
}

function renderStatus() {
  const el = $("#statusList");
  $("#btnAddDose").disabled = !state.childId;
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

/* ---------- Verlauf ---------- */
async function loadHistory() {
  const el = $("#historyList");
  if (!state.childId) { el.innerHTML = `<div class="empty">Kein Kind ausgewählt.</div>`; return; }
  let doses;
  try { doses = await api(`doses?child_id=${state.childId}&limit=300`); } catch (e) { toast(e.message); return; }
  if (!doses.length) { el.innerHTML = `<div class="empty">Noch keine Gaben erfasst.</div>`; return; }
  let html = "", lastDay = "";
  for (const d of doses) {
    const dt = new Date(d.given_at);
    const day = dt.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (day !== lastDay) { html += `<div class="day">${esc(day)}</div>`; lastDay = day; }
    html += `
      <div class="item">
        <div>
          <div class="title">${dt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} · ${esc(d.medication_name)}</div>
          <div class="sub">${fmtNum(d.amount)} ${esc(d.unit)}${d.mg != null ? ` (${fmtNum(d.mg)} mg)` : ""} · ${esc(d.active_ingredient)} · ${esc(d.route || "")}${d.note ? " · " + esc(d.note) : ""}</div>
        </div>
        <button class="btn small danger" data-del="${d.id}" title="Eintrag löschen">✕</button>
      </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Diesen Eintrag löschen?")) return;
    try { await api(`doses/${b.dataset.del}`, { method: "DELETE" }); loadHistory(); toast("Gelöscht"); }
    catch (e) { toast(e.message); }
  }));
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
        <div class="title">${esc(m.name)}</div>
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
  $("#medDelete").hidden = !m;
  $("#medDialog").showModal();
}

async function saveMed(ev) {
  ev.preventDefault();
  const f = $("#medForm");
  const body = {};
  MED_FORM_FIELDS.forEach((k) => { body[k] = f.elements[k].value; });
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

async function onDoseMedChange() {
  resetDoseWarnings();
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
      html += `<div class="hint">Vorschlag für ${fmtNum(child.weight_kg)} kg: ${fmtNum(suggestion.mg)} mg${suggestion.amount != null ? ` ≈ ${fmtNum(suggestion.amount)} ${esc(med.dose_unit)}` : ""}</div>`;
      if (suggestion.amount != null && ["ml", "Tropfen", "mg"].includes(med.dose_unit)) {
        amount = med.dose_unit === "Tropfen" ? Math.round(suggestion.amount) : Math.round(suggestion.amount * 10) / 10;
      }
    } else if (med.dose_mg_per_kg && !child?.weight_kg) {
      html += `<div class="muted">Für einen Dosisvorschlag beim Kind das Gewicht erfassen.</div>`;
    }
  } catch (_) { /* Vorschlag optional */ }
  const st = statusFor(med);
  if (st && !st.allowed_now) {
    html += `<div style="color:var(--wait);font-weight:600">⏳ ${esc(st.ingredient)} erst wieder ab ${fmtTime(st.next_allowed_at)}</div>`;
  }
  if (med.notes) html += `<div class="muted small">${esc(med.notes)}</div>`;
  info.innerHTML = html;
  $("#doseAmount").value = amount ?? "";
}

function resetDoseWarnings() {
  pendingForce = false;
  $("#doseWarnings").hidden = true;
  $("#doseSubmit").textContent = "Speichern";
  $("#doseSubmit").classList.remove("danger");
}

async function openDoseDialog(medId = null) {
  if (!state.childId) return;
  if (!state.meds.length) await loadMeds();
  $("#doseForm").reset();
  $("#doseMedFilter").value = "";
  fillDoseMedSelect(medId);
  $("#doseTime").value = toLocalInput(new Date());
  resetDoseWarnings();
  $("#doseDialog").showModal();
  await onDoseMedChange();
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
    await api("doses", { method: "POST", body });
    $("#doseDialog").close();
    toast("Gabe gespeichert");
    loadStatus();
    if (state.view === "history") loadHistory();
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
  $("#btnAddChild").addEventListener("click", () => openChildDialog());
  $("#medSearch").addEventListener("input", renderMedList);
  $("#doseMedFilter").addEventListener("input", () => { fillDoseMedSelect(Number($("#doseMed").value)); onDoseMedChange(); });
  $("#doseMed").addEventListener("change", onDoseMedChange);
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
  showView(["status", "history", "meds", "children"].includes(view) ? view : "status");
  setInterval(() => { if (state.view === "status") renderStatus(); }, 30000);
  setInterval(() => { if (state.view === "status" && !document.hidden) loadStatus(); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.view === "status") loadStatus(); });
}

init();
