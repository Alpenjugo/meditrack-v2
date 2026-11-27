"""Tests für MediTrack:  python3 -m unittest discover -s tests"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import timedelta
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "meditrack", "app"))

from core import Store, ValidationError, compute_status, suggested_dose, to_iso, utcnow  # noqa: E402
from ha import slugify  # noqa: E402
from seed import PRESET_MEDICATIONS  # noqa: E402
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
        self.ibu = med_by(self.store, "Ibuprofen Suspension")

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
        self.assertEqual(st["next_allowed_at"], to_iso(now + timedelta(hours=1)))

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
        para = next(m for m in meds if m["active_ingredient"] == "Paracetamol")
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
        self.assertEqual(self.req("DELETE", f"api/doses/{doses[0]['id']}")[0], 204)

        status, err = self.req("POST", "api/children", {"name": ""})
        self.assertEqual(status, 400)
        self.assertEqual(self.req("GET", "api/unknown")[0], 404)
        self.assertEqual(self.req("GET", "api/export")[0], 200)

    def test_ingress_only_blocks_other_ips(self):
        self.app.ingress_only = True
        try:
            self.assertEqual(self.req("GET", "api/health")[0], 403)
        finally:
            self.app.ingress_only = False


if __name__ == "__main__":
    unittest.main()
