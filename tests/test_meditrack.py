"""Tests für MediTrack:  python3 -m unittest discover -s tests"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "meditrack", "app"))

from core import Store, ValidationError, ceil_to_minutes, compute_status, suggested_dose, to_iso, utcnow  # noqa: E402
from ha import slugify  # noqa: E402
from seed import PRESET_MEDICATIONS  # noqa: E402
import core  # noqa: E402
import server  # noqa: E402


def med_by(store, prefix):
    return next(m for m in store.list_medications() if m["name"].startswith(prefix))


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "t.db"))
        self.child = self.store.create_child({"name": "Lena", "weight_kg": 12})
        self.para_syrup = med_by(self.store, "Paracetamol Sirup")
        self.para_supp = med_by(self.store, "Paracetamol Zäpfchen 125")
        self.ibu = med_by(self.store, "Algifor Junior")
        self.assertEqual(self.ibu["mg_per_unit"], 20)  # 100 mg / 5 ml

    def tearDown(self):
        self.store.conn.close()
        self.tmp.cleanup()

    def dose(self, med, amount, hours_ago, force=False):
        return self.store.add_dose({
            "child_id": self.child["id"], "medication_id": med["id"], "amount": amount,
            "given_at": to_iso(utcnow() - timedelta(hours=hours_ago))}, force=force)

    def test_seed_once_and_complete(self):
        self.assertEqual(len(self.store.list_medications()), len(PRESET_MEDICATIONS))
        Store(self.store.path)  # erneutes Öffnen darf nicht doppelt seeden
        self.assertEqual(len(self.store.list_medications()), len(PRESET_MEDICATIONS))
        for m in self.store.list_medications():
            self.assertTrue(m["active_ingredient"] and m["route"] and m["form"])

    def test_suggestion_weight_based(self):
        s = suggested_dose(self.child, self.para_syrup)  # 12 kg * 15 = 180 mg / 30 = 6 ml
        self.assertEqual(s, {"mg": 180.0, "amount": 6.0})
        heavy = {"weight_kg": 90}
        self.assertEqual(suggested_dose(heavy, self.para_syrup)["mg"], 1000)  # Max-Einzeldosis
        self.assertIsNone(suggested_dose({"weight_kg": None}, self.para_syrup))

    def test_interval_blocks_same_ingredient_across_products(self):
        dose_id, w = self.dose(self.para_syrup, 6, hours_ago=2)
        self.assertIsNotNone(dose_id)
        self.assertEqual(w, [])
        # Zäpfchen mit gleichem Wirkstoff nach 2 h -> Warnung
        dose_id, w = self.dose(self.para_supp, 1, hours_ago=0)
        self.assertIsNone(dose_id)
        self.assertIn("interval", [x["code"] for x in w])
        # Ibuprofen (anderer Wirkstoff) ist erlaubt
        dose_id, w = self.dose(self.ibu, 6, hours_ago=0)
        self.assertIsNotNone(dose_id)

    def test_force_saves_despite_warning(self):
        self.dose(self.para_syrup, 6, hours_ago=1)
        dose_id, w = self.dose(self.para_syrup, 6, hours_ago=0, force=True)
        self.assertIsNotNone(dose_id)
        self.assertTrue(w)

    def test_backdated_entry_checks_later_doses(self):
        self.dose(self.para_syrup, 6, hours_ago=1)
        # Nachtrag 3 h zurück: liegt nur 2 h vor bestehender Gabe
        _, w = self.dose(self.para_syrup, 6, hours_ago=3)
        self.assertIn("interval", [x["code"] for x in w])

    def test_max_doses_and_mg_per_day(self):
        for h in (20, 14, 8):
            self.assertIsNotNone(self.dose(self.ibu, 6, hours_ago=h)[0])
        _, w = self.dose(self.ibu, 6, hours_ago=0)
        codes = [x["code"] for x in w]
        self.assertIn("max_doses", codes)       # 4. Gabe bei max 3
        self.assertIn("max_mg_day", codes)      # 480 mg > 30*12=360 mg

    def test_above_suggestion_warning(self):
        _, w = self.dose(self.para_syrup, 12, hours_ago=0)  # 360 mg statt 180
        self.assertIn("above_suggestion", [x["code"] for x in w])

    def test_status(self):
        self.dose(self.para_syrup, 6, hours_ago=2)
        self.dose(self.ibu, 6, hours_ago=7)
        st = self.store.status(self.child["id"])
        by = {s["ingredient"]: s for s in st["ingredients"]}
        self.assertFalse(by["Paracetamol"]["allowed_now"])
        self.assertEqual(by["Paracetamol"]["mg_24h"], 180)
        self.assertEqual(by["Paracetamol"]["max_mg_24h"], 720)
        self.assertTrue(by["Ibuprofen"]["allowed_now"])
        self.assertEqual(st["ingredients"][0]["ingredient"], "Paracetamol")  # neueste zuerst

    def test_status_daily_limit_extends_block(self):
        now = utcnow()
        med = dict(self.ibu)
        doses = []
        for h in (23, 16, 9):
            doses.append({**med, "given_at": to_iso(now - timedelta(hours=h)),
                          "amount": 6, "mg": 120, "dose_id": h})
        st = compute_status(self.child, doses, now)["ingredients"][0]
        # Intervall wäre seit 3 h vorbei, aber 3/3 Gaben -> frei erst nach 23h-Gabe + 24 h
        self.assertFalse(st["allowed_now"])
        self.assertEqual(st["blocked_reason"], "max_doses")
        self.assertEqual(st["next_allowed_at"], to_iso(ceil_to_minutes(now + timedelta(hours=1))))

    def test_ceil_to_15_minutes(self):
        from datetime import datetime, timezone
        t = lambda h, m, sec=0: datetime(2026, 1, 1, h, m, sec, tzinfo=timezone.utc)
        self.assertEqual(ceil_to_minutes(t(13, 43)), t(13, 45))
        self.assertEqual(ceil_to_minutes(t(13, 45)), t(13, 45))
        self.assertEqual(ceil_to_minutes(t(13, 45, 1)), t(14, 0))
        self.assertEqual(ceil_to_minutes(t(23, 58)), datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc))

    def test_status_rounded_never_earlier(self):
        self.dose(self.para_syrup, 6, hours_ago=2)
        st = self.store.status(self.child["id"])["ingredients"][0]
        nxt = datetime.fromisoformat(st["next_allowed_at"])
        self.assertEqual(nxt.minute % 15, 0)
        self.assertEqual(nxt.second, 0)
        exact = datetime.fromisoformat(self.store.list_doses(self.child["id"])[0]["given_at"]) + timedelta(hours=6)
        self.assertGreaterEqual(nxt, exact)
        self.assertLess(nxt - exact, timedelta(minutes=15))

    def test_validation(self):
        with self.assertRaises(ValidationError):
            self.store.create_child({"name": ""})
        with self.assertRaises(ValidationError):
            self.store.create_child({"name": "X", "weight_kg": -3})
        with self.assertRaises(ValidationError):
            self.store.create_medication({"name": "X", "active_ingredient": "", "dose_unit": "ml"})
        with self.assertRaises(ValidationError):
            self.dose(self.para_syrup, 6, hours_ago=-2)  # Zukunft
        with self.assertRaises(ValidationError):
            self.dose(self.para_syrup, 0, hours_ago=0)

    def test_delete_med_with_history_archives(self):
        self.dose(self.ibu, 6, hours_ago=1)
        self.assertTrue(self.store.delete_medication(self.ibu["id"]))
        self.assertNotIn(self.ibu["id"], [m["id"] for m in self.store.list_medications()])
        self.assertEqual(len(self.store.list_doses(self.child["id"])), 1)

    def test_update_dose_excludes_itself_and_checks_others(self):
        id1, _ = self.dose(self.para_syrup, 6, hours_ago=8)
        # Menge/Zeit der einzigen Gabe ändern -> darf nicht gegen sich selbst warnen
        ok, w = self.store.update_dose(id1, {
            "medication_id": self.para_syrup["id"], "amount": 5.5,
            "given_at": to_iso(utcnow() - timedelta(hours=7)), "note": "korrigiert"})
        self.assertTrue(ok)
        self.assertEqual(w, [])
        d = self.store.get_dose(id1)
        self.assertEqual((d["amount"], d["note"], d["mg"]), (5.5, "korrigiert", 165))
        # zweite Gabe so verschieben, dass sie zu nah an der ersten liegt -> Warnung
        id2, _ = self.dose(self.para_syrup, 6, hours_ago=0)
        res = self.store.update_dose(id2, {
            "medication_id": self.para_syrup["id"], "amount": 6,
            "given_at": to_iso(utcnow() - timedelta(hours=5))})
        self.assertEqual(res[0], False)
        self.assertIn("interval", [x["code"] for x in res[1]])
        self.assertTrue(self.store.update_dose(id2, {
            "medication_id": self.para_syrup["id"], "amount": 6,
            "given_at": to_iso(utcnow() - timedelta(hours=5))}, force=True)[0])
        # Medikament wechseln
        ok, _ = self.store.update_dose(id2, {"medication_id": self.ibu["id"], "amount": 6,
                                             "given_at": to_iso(utcnow() - timedelta(hours=5))})
        self.assertTrue(ok)
        self.assertEqual(self.store.get_dose(id2)["medication_id"], self.ibu["id"])
        self.assertIsNone(self.store.update_dose(9999, {}))

    def test_favorites_and_recent(self):
        favs = {m["name"] for m in self.store.list_medications() if m["favorite"]}
        self.assertEqual(favs, {"Algifor Junior Suspension 100 mg/5 ml", "Dafalgan Zäpfchen 150 mg",
                                "Nasivin Kinder Spray 0.025 %"})
        self.assertTrue(self.store.list_medications()[0]["favorite"])  # Favoriten zuerst
        meds = self.store.list_medications()
        for i, m in enumerate(meds[:7]):
            self.store.add_dose({"child_id": self.child["id"], "medication_id": m["id"], "amount": 1,
                                 "given_at": to_iso(utcnow() - timedelta(hours=50 - i))}, force=True)
        recent = self.store.recent_medications(self.child["id"])
        self.assertEqual(len(recent), 5)
        self.assertEqual(recent[0]["id"], meds[6]["id"])  # neueste zuerst
        # Favorit per Update entfernen
        m = dict(meds[0]); m["favorite"] = False
        self.assertEqual(self.store.update_medication(m["id"], m)["favorite"], 0)

    def test_migration_from_seed_v1(self):
        import sqlite3
        path = os.path.join(self.tmp.name, "old.db")
        conn = sqlite3.connect(path)
        old_schema = core.SCHEMA.replace("    favorite INTEGER NOT NULL DEFAULT 0,\n", "")
        conn.executescript(old_schema)
        conn.execute("INSERT INTO medications(name, active_ingredient, dose_unit, min_interval_hours, is_preset) "
                     "VALUES('Ibuprofen Suspension 20 mg/ml (z. B. Algifor Junior)', 'Ibuprofen', 'ml', 6, 1)")
        conn.execute("INSERT INTO meta(key, value) VALUES('seeded', '1')")
        conn.commit(); conn.close()
        st = Store(path)
        names = {m["name"]: m for m in st.list_medications()}
        # alte Vorlage umbenannt (ID bleibt -> Verlauf bleibt zugeordnet), kein Favorit
        self.assertEqual(names["Ibuprofen Suspension 20 mg/ml"]["id"], 1)
        self.assertEqual(names["Ibuprofen Suspension 20 mg/ml"]["favorite"], 0)
        self.assertEqual(names["Algifor Junior Suspension 100 mg/5 ml"]["favorite"], 1)
        self.assertEqual(names["Nasivin Kinder Spray 0.025 %"]["favorite"], 1)
        self.assertEqual(names["Dafalgan Zäpfchen 150 mg"]["favorite"], 1)
        Store(path)  # idempotent
        # Ibuprofen (umbenannt), Algifor, Dafalgan, Nasivin, Amoxicillin Sandoz, Perenterol, Viburcol
        self.assertEqual(len(st.list_medications()), 7)
        st.conn.close()

    def test_migration_from_seed_v2(self):
        import sqlite3
        path = os.path.join(self.tmp.name, "v2.db")
        conn = sqlite3.connect(path)
        conn.executescript(core.SCHEMA)
        conn.execute("INSERT INTO medications(name, active_ingredient, dose_unit, mg_per_unit, "
                     "min_interval_hours, is_preset, favorite) "
                     "VALUES('Algifor Junior Suspension 20 mg/ml', 'Ibuprofen', 'ml', 20, 6, 1, 1)")
        conn.execute("INSERT INTO meta(key, value) VALUES('seed_version', '2')")
        conn.commit(); conn.close()
        st = Store(path)
        names = {m["name"]: m for m in st.list_medications()}
        self.assertEqual(names["Algifor Junior Suspension 100 mg/5 ml"]["id"], 1)
        self.assertEqual(names["Algifor Junior Suspension 100 mg/5 ml"]["favorite"], 1)
        self.assertEqual(names["Ibuprofen Suspension 20 mg/ml"]["favorite"], 0)
        self.assertNotIn("Algifor Junior Suspension 20 mg/ml", names)
        self.assertIn("Amoxicillin Sandoz Suspension 200 mg/4 ml", names)  # v4
        self.assertIn("Perenterol (Saccharomyces boulardii)", names)  # v5
        self.assertEqual(len(names), 5)
        st.conn.close()

    def test_temperatures(self):
        cid = self.child["id"]
        t1 = self.store.add_temperature({"child_id": cid, "celsius": "38.66", "method": "Ohr",
                                         "measured_at": to_iso(utcnow() - timedelta(hours=3))})
        self.assertEqual(t1["celsius"], 38.7)
        t2 = self.store.add_temperature({"child_id": cid, "celsius": 37.4})
        self.assertEqual(self.store.status(cid)["last_temperature"]["id"], t2["id"])
        for bad in ({"celsius": 30}, {"celsius": 44}, {"celsius": ""}, {"celsius": 38, "method": "Zehe"},
                    {"celsius": 38, "measured_at": to_iso(utcnow() + timedelta(hours=1))}):
            with self.assertRaises(ValidationError):
                self.store.add_temperature({"child_id": cid, **bad})
        upd = self.store.update_temperature(t1["id"], {"celsius": 39.1, "measured_at": t1["measured_at"]})
        self.assertEqual(upd["celsius"], 39.1)
        self.assertIsNone(self.store.update_temperature(9999, {"celsius": 38}))
        self.dose(self.para_syrup, 6, hours_ago=2)
        self.dose(self.para_syrup, 6, hours_ago=80)
        chart = self.store.chart(cid, utcnow() - timedelta(hours=24), utcnow())
        self.assertEqual([t["celsius"] for t in chart["temperatures"]], [39.1, 37.4])  # aufsteigend
        self.assertEqual(len(chart["doses"]), 1)
        with self.assertRaises(ValidationError):
            self.store.chart(cid, utcnow(), utcnow() - timedelta(hours=1))
        self.assertTrue(self.store.delete_temperature(t2["id"]))
        self.store.delete_child(cid)  # Kaskade
        self.assertEqual(self.store.list_temperatures(cid), [])

    def test_events(self):
        cid = self.child["id"]
        e = self.store.add_event({"child_id": cid, "kind": "Erbrechen", "note": "viel"})
        self.assertEqual(e["kind"], "Erbrechen")
        with self.assertRaises(ValidationError):
            self.store.add_event({"child_id": cid, "kind": "Unbekannt"})
        with self.assertRaises(ValidationError):
            self.store.add_event({"child_id": cid, "kind": "Notiz",
                                  "occurred_at": to_iso(utcnow() + timedelta(hours=2))})
        upd = self.store.update_event(e["id"], {"kind": "Durchfall", "occurred_at": e["occurred_at"]})
        self.assertEqual(upd["kind"], "Durchfall")
        chart = self.store.chart(cid, utcnow() - timedelta(hours=1), utcnow() + timedelta(minutes=1))
        self.assertEqual(len(chart["events"]), 1)
        self.assertTrue(self.store.delete_event(e["id"]))

    def test_import(self):
        cid = self.child["id"]
        t0 = utcnow() - timedelta(days=10)
        iso = lambda h: to_iso(t0 + timedelta(hours=h))
        data = {
            "format": "meditrack-import", "child": "Lena",
            "medications": [{"name": "Testmittel", "active_ingredient": "Test", "dose_unit": "Stück",
                             "min_interval_hours": 0}],
            "doses": [
                {"at": iso(0), "medication": self.ibu["name"], "amount": 4},
                {"at": iso(1), "medication": self.ibu["name"], "amount": 4},  # zu früh -> trotzdem import
                {"at": iso(2), "medication": "Testmittel", "amount": 1, "note": "neu"},
            ],
            "temperatures": [{"at": iso(0), "celsius": 39.5}],
            "events": [{"at": iso(3), "kind": "Erbrechen", "note": "viel"}],
        }
        dry = self.store.import_data(cid, data, dry_run=True)
        self.assertEqual(dry["doses"]["new"], 3)
        self.assertEqual(dry["new_medications"], ["Testmittel"])
        self.assertEqual(self.store.list_doses(cid), [])  # Vorschau speichert nichts
        self.assertFalse(any(m["name"] == "Testmittel" for m in self.store.list_medications()))
        res = self.store.import_data(cid, data)
        self.assertEqual((res["doses"]["new"], res["temperatures"]["new"], res["events"]["new"]), (3, 1, 1))
        self.assertEqual(len(self.store.list_doses(cid)), 3)
        self.assertEqual(self.store.list_doses(cid)[-1]["mg"], 80)  # 4 ml * 20 mg
        again = self.store.import_data(cid, data)  # keine Duplikate
        self.assertEqual((again["doses"]["new"], again["doses"]["skipped"]), (0, 3))
        self.assertEqual(again["events"]["skipped"], 1)
        # Fehler in einer Zeile -> nichts gespeichert
        bad = {**data, "doses": [{"at": iso(5), "medication": self.ibu["name"], "amount": 4},
                                 {"at": iso(6), "medication": self.ibu["name"], "amount": 0}]}
        with self.assertRaises(ValidationError):
            self.store.import_data(cid, bad)
        self.assertEqual(len(self.store.list_doses(cid)), 3)
        with self.assertRaises(ValidationError):
            self.store.import_data(cid, {**data, "doses": [{"at": iso(7), "medication": "Gibtsnicht", "amount": 1}]})
        with self.assertRaises(ValidationError):
            self.store.import_data(cid, {"format": "anders"})
        # Store bleibt nach Fehlern benutzbar (keine offene Transaktion)
        self.assertTrue(self.store.add_event({"child_id": cid, "kind": "Notiz"}))

    def test_slugify(self):
        self.assertEqual(slugify("Jürg Müller"), "juerg_mueller")
        self.assertEqual(slugify("Colecalciferol (Vitamin D3)"), "colecalciferol_vitamin_d3")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ.pop("SUPERVISOR_TOKEN", None)
        cls.app = server.App(os.path.join(cls.tmp.name, "h.db"), publish=False)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(cls.app))
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}/"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.app.store.conn.close()
        cls.tmp.cleanup()

    def req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method,
                                   headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw and path.startswith("api") else raw)
        except urllib.error.HTTPError as e:
            raw = e.read()
            return e.code, json.loads(raw) if raw else None

    def test_flow(self):
        status, html = self.req("GET", "")
        self.assertEqual(status, 200)
        self.assertIn(b"MediTrack", html)
        self.assertEqual(self.req("GET", "app.js")[0], 200)
        self.assertEqual(self.req("GET", "../server.py")[0], 404)

        status, child = self.req("POST", "api/children", {"name": "Tim", "weight_kg": 15})
        self.assertEqual(status, 201)
        status, meds = self.req("GET", "api/medications")
        para = next(m for m in meds if m["name"].startswith("Paracetamol Sirup"))
        status, sug = self.req("GET", f"api/suggestion?child_id={child['id']}&medication_id={para['id']}")
        self.assertEqual(sug["suggestion"]["mg"], 225)

        body = {"child_id": child["id"], "medication_id": para["id"], "amount": 7.5}
        self.assertEqual(self.req("POST", "api/doses", body)[0], 201)
        status, res = self.req("POST", "api/doses", body)
        self.assertEqual(status, 409)
        self.assertTrue(res["warnings"])
        self.assertEqual(self.req("POST", "api/doses", {**body, "force": True})[0], 201)

        status, st = self.req("GET", f"api/status?child_id={child['id']}")
        self.assertEqual(st["ingredients"][0]["doses_24h"], 2)
        status, doses = self.req("GET", f"api/doses?child_id={child['id']}")
        self.assertEqual(len(doses), 2)
        status, res = self.req("PUT", f"api/doses/{doses[0]['id']}",
                               {"medication_id": para["id"], "amount": 7, "note": "edit",
                                "given_at": doses[0]["given_at"], "force": True})
        self.assertEqual(status, 200)
        self.assertEqual(self.req("PUT", "api/doses/99999", {"medication_id": para["id"], "amount": 1})[0], 404)
        status, recent = self.req("GET", f"api/recent?child_id={child['id']}")
        self.assertEqual(recent[0]["id"], para["id"])
        self.assertEqual(self.req("DELETE", f"api/doses/{doses[0]['id']}")[0], 204)

        status, err = self.req("POST", "api/children", {"name": ""})
        self.assertEqual(status, 400)
        self.assertEqual(self.req("GET", "api/unknown")[0], 404)
        status, temp = self.req("POST", "api/temperatures", {"child_id": child["id"], "celsius": 39.2, "method": "rektal"})
        self.assertEqual(status, 201)
        self.assertEqual(self.req("POST", "api/temperatures", {"child_id": child["id"], "celsius": 50})[0], 400)
        self.assertEqual(self.req("PUT", f"api/temperatures/{temp['id']}", {"celsius": 38.9})[0], 200)
        status, chart = self.req("GET", f"api/chart?child_id={child['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(chart["temperatures"][0]["celsius"], 38.9)
        self.assertEqual(len(chart["doses"]), 1)
        self.assertEqual(self.req("GET", "api/chart?child_id=9999")[0], 404)
        self.assertEqual(self.req("GET", f"api/chart?child_id={child['id']}&from=xyz")[0], 400)
        status, exp = self.req("GET", "api/export")
        self.assertEqual(status, 200)
        self.assertEqual(len(exp["temperatures"]), 1)
        self.assertEqual(self.req("DELETE", f"api/temperatures/{temp['id']}")[0], 204)
        status, ev = self.req("POST", "api/events", {"child_id": child["id"], "kind": "Erbrechen", "note": "viel"})
        self.assertEqual(status, 201)
        self.assertEqual(self.req("GET", f"api/events?child_id={child['id']}")[1][0]["note"], "viel")
        self.assertEqual(self.req("POST", "api/events", {"child_id": child["id"], "kind": "x"})[0], 400)
        imp = {"format": "meditrack-import", "doses": [],
               "temperatures": [{"at": "2026-01-27T17:00:00Z", "celsius": 39.5}], "events": []}
        status, res = self.req("POST", "api/import", {"child_id": child["id"], "data": imp, "dry_run": True})
        self.assertEqual((status, res["temperatures"]["new"], res["dry_run"]), (200, 1, True))
        status, res = self.req("POST", "api/import", {"child_id": child["id"], "data": imp})
        self.assertEqual((status, res["temperatures"]["new"]), (200, 1))
        self.assertEqual(self.req("POST", "api/import", {"child_id": child["id"], "data": {"x": 1}})[0], 400)
        self.assertEqual(self.req("DELETE", f"api/events/{ev['id']}")[0], 204)

    def test_ingress_only_blocks_other_ips(self):
        self.app.ingress_only = True
        try:
            self.assertEqual(self.req("GET", "api/health")[0], 403)
        finally:
            self.app.ingress_only = False


if __name__ == "__main__":
    unittest.main()
