"""Datenbank und Fachlogik für MediTrack.

Alle Zeitpunkte werden als UTC-ISO-Strings gespeichert. Die Anzeige in
lokaler Zeit übernimmt das Frontend (Browser-Zeitzone).
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from seed import PRESET_MEDICATIONS

SCHEMA = """
CREATE TABLE IF NOT EXISTS children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    birthdate TEXT,
    weight_kg REAL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active_ingredient TEXT NOT NULL,
    form TEXT,
    route TEXT,
    dose_unit TEXT NOT NULL DEFAULT 'ml',
    mg_per_unit REAL,
    default_dose REAL,
    dose_mg_per_kg REAL,
    max_single_mg REAL,
    min_interval_hours REAL NOT NULL DEFAULT 0,
    max_doses_per_24h INTEGER,
    max_mg_per_kg_day REAL,
    notes TEXT,
    is_preset INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS doses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    medication_id INTEGER NOT NULL REFERENCES medications(id),
    given_at TEXT NOT NULL,
    amount REAL NOT NULL,
    unit TEXT NOT NULL,
    mg REAL,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doses_child_time ON doses(child_id, given_at);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

MED_FIELDS = [
    "name", "active_ingredient", "form", "route", "dose_unit", "mg_per_unit",
    "default_dose", "dose_mg_per_kg", "max_single_mg", "min_interval_hours",
    "max_doses_per_24h", "max_mg_per_kg_day", "notes",
]
CHILD_FIELDS = ["name", "birthdate", "weight_kg"]
NUMERIC_MED_FIELDS = {
    "mg_per_unit", "default_dose", "dose_mg_per_kg", "max_single_mg",
    "min_interval_hours", "max_mg_per_kg_day",
}


class ValidationError(ValueError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_iso(value: str) -> datetime:
    """Parst ISO-Zeitpunkte; ohne Zeitzone wird UTC angenommen."""
    if not isinstance(value, str) or not value:
        raise ValidationError("Ungültiger Zeitpunkt")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("Ungültiger Zeitpunkt") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def ingredient_key(med: dict) -> str:
    """Gruppierungsschlüssel: gleicher Wirkstoff = gleiche Sperrzeit."""
    key = (med.get("active_ingredient") or med.get("name") or "").strip().lower()
    return " ".join(key.split())


def _num(value, field, *, integer=False, allow_none=True):
    if value is None or value == "":
        if allow_none:
            return None
        raise ValidationError(f"Feld '{field}' ist erforderlich")
    try:
        number = int(value) if integer else float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"Feld '{field}' muss eine Zahl sein") from exc
    if number < 0:
        raise ValidationError(f"Feld '{field}' darf nicht negativ sein")
    return number


def _text(value, field, *, required=False, max_len=500):
    if value is None:
        value = ""
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if required and not value:
        raise ValidationError(f"Feld '{field}' ist erforderlich")
    if len(value) > max_len:
        raise ValidationError(f"Feld '{field}' ist zu lang")
    return value or None


class Store:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        with self.lock, self.conn:
            self.conn.executescript(SCHEMA)
        self._seed()

    # ------------------------------------------------------------------ seed
    def _seed(self):
        with self.lock, self.conn:
            row = self.conn.execute(
                "SELECT value FROM meta WHERE key='seeded'").fetchone()
            if row:
                return
            for med in PRESET_MEDICATIONS:
                self._insert_med(med, is_preset=1)
            self.conn.execute(
                "INSERT INTO meta(key, value) VALUES('seeded', '1')")

    # ------------------------------------------------------------- children
    def list_children(self):
        with self.lock:
            rows = self.conn.execute(
                "SELECT * FROM children ORDER BY name COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]

    def get_child(self, child_id):
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM children WHERE id=?", (child_id,)).fetchone()
        return dict(row) if row else None

    def _clean_child(self, data):
        weight = _num(data.get("weight_kg"), "Gewicht")
        if weight is not None and not (0.5 <= weight <= 150):
            raise ValidationError("Gewicht muss zwischen 0.5 und 150 kg liegen")
        birthdate = _text(data.get("birthdate"), "Geburtsdatum", max_len=10)
        if birthdate:
            try:
                datetime.strptime(birthdate, "%Y-%m-%d")
            except ValueError as exc:
                raise ValidationError("Geburtsdatum im Format JJJJ-MM-TT") from exc
        return {
            "name": _text(data.get("name"), "Name", required=True, max_len=60),
            "birthdate": birthdate,
            "weight_kg": weight,
        }

    def create_child(self, data):
        c = self._clean_child(data)
        with self.lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO children(name, birthdate, weight_kg, created_at) "
                "VALUES(?,?,?,?)",
                (c["name"], c["birthdate"], c["weight_kg"], to_iso(utcnow())))
        return self.get_child(cur.lastrowid)

    def update_child(self, child_id, data):
        if not self.get_child(child_id):
            return None
        c = self._clean_child(data)
        with self.lock, self.conn:
            self.conn.execute(
                "UPDATE children SET name=?, birthdate=?, weight_kg=? WHERE id=?",
                (c["name"], c["birthdate"], c["weight_kg"], child_id))
        return self.get_child(child_id)

    def delete_child(self, child_id):
        with self.lock, self.conn:
            cur = self.conn.execute("DELETE FROM children WHERE id=?", (child_id,))
        return cur.rowcount > 0

    # ---------------------------------------------------------- medications
    def list_medications(self, include_archived=False):
        sql = "SELECT * FROM medications"
        if not include_archived:
            sql += " WHERE archived=0"
        sql += " ORDER BY name COLLATE NOCASE"
        with self.lock:
            rows = self.conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def get_medication(self, med_id):
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM medications WHERE id=?", (med_id,)).fetchone()
        return dict(row) if row else None

    def _clean_med(self, data):
        out = {}
        for field in MED_FIELDS:
            value = data.get(field)
            if field in NUMERIC_MED_FIELDS:
                out[field] = _num(value, field)
            elif field == "max_doses_per_24h":
                out[field] = _num(value, field, integer=True)
            elif field == "notes":
                out[field] = _text(value, field, max_len=2000)
            else:
                out[field] = _text(value, field, required=field in (
                    "name", "active_ingredient", "dose_unit"), max_len=120)
        if out["min_interval_hours"] is None:
            out["min_interval_hours"] = 0
        if out["min_interval_hours"] > 168:
            raise ValidationError("Mindestabstand höchstens 168 Stunden")
        return out

    def _insert_med(self, data, is_preset=0):
        m = self._clean_med(data)
        cols = MED_FIELDS + ["is_preset"]
        values = [m[f] for f in MED_FIELDS] + [is_preset]
        cur = self.conn.execute(
            f"INSERT INTO medications({','.join(cols)}) "
            f"VALUES({','.join('?' * len(cols))})", values)
        return cur.lastrowid

    def create_medication(self, data):
        with self.lock, self.conn:
            med_id = self._insert_med(data)
        return self.get_medication(med_id)

    def update_medication(self, med_id, data):
        if not self.get_medication(med_id):
            return None
        m = self._clean_med(data)
        with self.lock, self.conn:
            self.conn.execute(
                f"UPDATE medications SET {', '.join(f + '=?' for f in MED_FIELDS)} "
                "WHERE id=?", [m[f] for f in MED_FIELDS] + [med_id])
        return self.get_medication(med_id)

    def delete_medication(self, med_id):
        """Mit Verlauf wird archiviert (Historie bleibt lesbar), sonst gelöscht."""
        with self.lock, self.conn:
            used = self.conn.execute(
                "SELECT 1 FROM doses WHERE medication_id=? LIMIT 1",
                (med_id,)).fetchone()
            if used:
                cur = self.conn.execute(
                    "UPDATE medications SET archived=1 WHERE id=?", (med_id,))
            else:
                cur = self.conn.execute(
                    "DELETE FROM medications WHERE id=?", (med_id,))
        return cur.rowcount > 0

    # ---------------------------------------------------------------- doses
    def list_doses(self, child_id, limit=200, since=None):
        sql = ("SELECT d.*, m.name AS medication_name, "
               "m.active_ingredient, m.route, m.form "
               "FROM doses d JOIN medications m ON m.id = d.medication_id "
               "WHERE d.child_id=?")
        params = [child_id]
        if since:
            sql += " AND d.given_at >= ?"
            params.append(to_iso(since))
        sql += " ORDER BY d.given_at DESC LIMIT ?"
        params.append(int(limit))
        with self.lock:
            rows = self.conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def delete_dose(self, dose_id):
        with self.lock, self.conn:
            cur = self.conn.execute("DELETE FROM doses WHERE id=?", (dose_id,))
        return cur.rowcount > 0

    def _clean_dose(self, data):
        try:
            child_id = int(data.get("child_id"))
            med_id = int(data.get("medication_id"))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Kind und Medikament sind erforderlich") from exc
        child = self.get_child(child_id)
        med = self.get_medication(med_id)
        if not child:
            raise ValidationError("Kind nicht gefunden")
        if not med:
            raise ValidationError("Medikament nicht gefunden")
        amount = _num(data.get("amount"), "Menge", allow_none=False)
        if amount <= 0:
            raise ValidationError("Menge muss grösser als 0 sein")
        given_at = parse_iso(data["given_at"]) if data.get("given_at") else utcnow()
        if given_at > utcnow() + timedelta(minutes=5):
            raise ValidationError("Zeitpunkt liegt in der Zukunft")
        note = _text(data.get("note"), "Notiz", max_len=500)
        mg = amount * med["mg_per_unit"] if med.get("mg_per_unit") else None
        return child, med, amount, given_at, mg, note

    def check_dose(self, data):
        """Liefert (Warnungen, bereinigte Daten) für eine geplante Gabe."""
        child, med, amount, given_at, mg, note = self._clean_dose(data)
        warnings = evaluate_dose(
            child, med, amount, mg, given_at, self._doses_for_window(child["id"], given_at))
        return warnings, (child, med, amount, given_at, mg, note)

    def add_dose(self, data, force=False):
        warnings, (child, med, amount, given_at, mg, note) = self.check_dose(data)
        if warnings and not force:
            return None, warnings
        with self.lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO doses(child_id, medication_id, given_at, amount, unit, "
                "mg, note, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (child["id"], med["id"], to_iso(given_at), amount, med["dose_unit"],
                 mg, note, to_iso(utcnow())))
        return cur.lastrowid, warnings

    def _doses_for_window(self, child_id, around: datetime):
        """Alle Gaben ±48 h um den Zeitpunkt, mit Medikamentendaten."""
        sql = ("SELECT d.given_at, d.amount, d.mg, m.* , d.id AS dose_id "
               "FROM doses d JOIN medications m ON m.id = d.medication_id "
               "WHERE d.child_id=? AND d.given_at >= ? AND d.given_at <= ?")
        with self.lock:
            rows = self.conn.execute(sql, (
                child_id, to_iso(around - timedelta(hours=48)),
                to_iso(around + timedelta(hours=48)))).fetchall()
        return [dict(r) for r in rows]

    # --------------------------------------------------------------- status
    def status(self, child_id, now=None, lookback_hours=48):
        child = self.get_child(child_id)
        if not child:
            return None
        now = now or utcnow()
        with self.lock:
            rows = self.conn.execute(
                "SELECT d.given_at, d.amount, d.mg, d.unit, m.* , d.id AS dose_id "
                "FROM doses d JOIN medications m ON m.id = d.medication_id "
                "WHERE d.child_id=? AND d.given_at >= ? AND d.given_at <= ? "
                "ORDER BY d.given_at",
                (child_id, to_iso(now - timedelta(hours=lookback_hours)),
                 to_iso(now))).fetchall()
        return compute_status(child, [dict(r) for r in rows], now)


# ---------------------------------------------------------------------------
# Reine Logik (ohne DB) – gut testbar
# ---------------------------------------------------------------------------

def max_mg_day(child, med):
    if med.get("max_mg_per_kg_day") and child.get("weight_kg"):
        return med["max_mg_per_kg_day"] * child["weight_kg"]
    return None


def suggested_dose(child, med):
    """Gewichtsbasierter Dosisvorschlag (nur Orientierung)."""
    weight = child.get("weight_kg")
    if not (weight and med.get("dose_mg_per_kg")):
        return None
    mg = weight * med["dose_mg_per_kg"]
    if med.get("max_single_mg"):
        mg = min(mg, med["max_single_mg"])
    amount = mg / med["mg_per_unit"] if med.get("mg_per_unit") else None
    return {"mg": round(mg, 1), "amount": round(amount, 1) if amount else None}


def _fmt_hours(hours: float) -> str:
    total_min = max(0, int(round(hours * 60)))
    h, m = divmod(total_min, 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def evaluate_dose(child, med, amount, mg, given_at, window_doses):
    """Prüft eine geplante Gabe gegen Abstand und Tageshöchstwerte.

    window_doses: bisherige Gaben (beliebige Medikamente) rund um given_at.
    Gruppiert wird nach Wirkstoff, damit z. B. Dafalgan und Ben-u-ron
    gemeinsam zählen.
    """
    warnings = []
    key = ingredient_key(med)
    same = [d for d in window_doses if ingredient_key(d) == key]
    times = [(parse_iso(d["given_at"]), d) for d in same]

    # Mindestabstand – vor und nach dem geplanten Zeitpunkt (Nachträge)
    interval = med.get("min_interval_hours") or 0
    if interval > 0:
        for t, d in times:
            other_interval = d.get("min_interval_hours") or 0
            needed = max(interval, other_interval)
            diff = abs((given_at - t).total_seconds()) / 3600
            if diff < needed:
                warnings.append({
                    "code": "interval",
                    "message": (
                        f"Mindestabstand für {med['active_ingredient']} ist "
                        f"{needed:g} h – letzte Gabe ({d['name']}) liegt erst "
                        f"{_fmt_hours(diff)} {'zurück' if t <= given_at else 'danach'}."),
                })
                break

    # 24-h-Fenster: rollierend um den geplanten Zeitpunkt
    start, end = given_at - timedelta(hours=24), given_at
    in_window = [d for t, d in times if start < t <= end]
    max_doses = med.get("max_doses_per_24h")
    if max_doses and len(in_window) + 1 > max_doses:
        warnings.append({
            "code": "max_doses",
            "message": (f"Maximal {max_doses} Gaben {med['active_ingredient']} "
                        f"in 24 h – das wäre Gabe {len(in_window) + 1}."),
        })

    limit = max_mg_day(child, med)
    if limit and mg is not None:
        total = sum(d["mg"] or 0 for d in in_window) + mg
        if total > limit + 0.01:
            warnings.append({
                "code": "max_mg_day",
                "message": (f"Tageshöchstmenge {med['active_ingredient']}: "
                            f"{limit:.0f} mg ({med['max_mg_per_kg_day']:g} mg/kg) – "
                            f"mit dieser Gabe {total:.0f} mg in 24 h."),
            })

    if med.get("max_single_mg") and mg is not None and mg > med["max_single_mg"] + 0.01:
        warnings.append({
            "code": "max_single",
            "message": (f"Einzeldosis {mg:.0f} mg überschreitet das hinterlegte "
                        f"Maximum von {med['max_single_mg']:g} mg."),
        })

    sugg = suggested_dose(child, med)
    if sugg and mg is not None and mg > sugg["mg"] * 1.25 + 0.01:
        warnings.append({
            "code": "above_suggestion",
            "message": (f"Dosis {mg:.0f} mg liegt deutlich über der Gewichtsempfehlung "
                        f"von {sugg['mg']:.0f} mg ({med['dose_mg_per_kg']:g} mg/kg)."),
        })
    return warnings


def compute_status(child, doses, now):
    """Status pro Wirkstoff: letzte Gabe, nächste mögliche Gabe, 24-h-Bilanz.

    doses: Gaben der letzten 48 h (aufsteigend), inkl. Medikamentenfelder.
    """
    groups: dict[str, list] = {}
    for d in doses:
        groups.setdefault(ingredient_key(d), []).append(d)

    result = []
    for key, items in groups.items():
        items.sort(key=lambda d: d["given_at"])
        last = items[-1]
        last_time = parse_iso(last["given_at"])
        interval = last.get("min_interval_hours") or 0
        next_allowed = last_time + timedelta(hours=interval)
        reason = "interval" if interval else None

        window = [d for d in items if parse_iso(d["given_at"]) > now - timedelta(hours=24)]
        max_doses = last.get("max_doses_per_24h")
        if max_doses and len(window) >= max_doses:
            # frei, sobald die älteste relevante Gabe aus dem Fenster fällt
            oldest = parse_iso(window[len(window) - max_doses]["given_at"])
            free_at = oldest + timedelta(hours=24)
            if free_at > next_allowed:
                next_allowed, reason = free_at, "max_doses"

        mg_24h = sum(d["mg"] or 0 for d in window)
        limit = max_mg_day(child, last)
        result.append({
            "ingredient": last["active_ingredient"],
            "key": key,
            "medication_id": last["id"],
            "medication_name": last["name"],
            "route": last.get("route"),
            "last_given_at": last["given_at"],
            "last_amount": last["amount"],
            "last_unit": last["dose_unit"],
            "min_interval_hours": interval,
            "next_allowed_at": to_iso(next_allowed),
            "allowed_now": next_allowed <= now,
            "blocked_reason": reason if next_allowed > now else None,
            "doses_24h": len(window),
            "max_doses_per_24h": max_doses,
            "mg_24h": round(mg_24h, 1) if any(d["mg"] for d in window) else None,
            "max_mg_24h": round(limit, 1) if limit else None,
        })
    result.sort(key=lambda s: s["last_given_at"], reverse=True)
    return {"child": child, "now": to_iso(now), "ingredients": result}
