"""Optionale Veröffentlichung von Sensoren in Home Assistant.

Nutzt die Supervisor-API (nur verfügbar, wenn MediTrack als Add-on läuft).
Fehler werden geloggt, brechen die App aber nie ab.

Entitäten (pro Kind):
  sensor.meditrack_<kind>_letzte_gabe          Zeitpunkt der letzten Gabe
  sensor.meditrack_<kind>_<wirkstoff>          Zeitpunkt der nächsten möglichen Gabe
  sensor.meditrack_<kind>_temperatur           zuletzt gemessene Temperatur (°C)
Hinweis: Per API gesetzte Zustände überleben keinen HA-Neustart; deshalb
wird regelmässig neu veröffentlicht.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.request
from core import utcnow

log = logging.getLogger("meditrack.ha")
API = "http://supervisor/core/api/states/"
UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
                         "é": "e", "è": "e", "à": "a", "ç": "c"})


def slugify(text: str) -> str:
    text = (text or "").lower().translate(UMLAUTS)
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text or "x"


class Publisher:
    def __init__(self, store, enabled: bool, interval_s: int = 60):
        self.store = store
        self.token = os.environ.get("SUPERVISOR_TOKEN")
        self.enabled = bool(enabled and self.token)
        self.interval_s = interval_s
        self._wake = threading.Event()
        if enabled and not self.token:
            log.info("Kein SUPERVISOR_TOKEN – Sensoren werden nicht veröffentlicht")

    def start(self):
        if not self.enabled:
            return
        threading.Thread(target=self._loop, daemon=True, name="ha-publisher").start()

    def trigger(self):
        self._wake.set()

    def _loop(self):
        while True:
            try:
                self.publish_all()
            except Exception:  # noqa: BLE001 – darf nie den Thread beenden
                log.exception("Veröffentlichen fehlgeschlagen")
            self._wake.wait(self.interval_s)
            self._wake.clear()

    def _post(self, entity_id, state, attributes):
        body = json.dumps({"state": state, "attributes": attributes}).encode()
        req = urllib.request.Request(
            API + entity_id, data=body, method="POST",
            headers={"Authorization": f"Bearer {self.token}",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()

    def publish_all(self):
        now = utcnow()
        for child in self.store.list_children():
            cslug = slugify(child["name"])
            status = self.store.status(child["id"], now=now, lookback_hours=24 * 7)
            items = status["ingredients"] if status else []
            last = items[0] if items else None
            self._post(f"sensor.meditrack_{cslug}_letzte_gabe",
                       last["last_given_at"] if last else "unknown", {
                           "friendly_name": f"{child['name']} letzte Medikamentengabe",
                           "device_class": "timestamp",
                           "icon": "mdi:pill",
                           "medication": last["medication_name"] if last else None,
                           "amount": f"{last['last_amount']:g} {last['last_unit']}" if last else None,
                       })
            temp = status.get("last_temperature") if status else None
            if temp:
                self._post(f"sensor.meditrack_{cslug}_temperatur", temp["celsius"], {
                    "friendly_name": f"{child['name']} Temperatur",
                    "device_class": "temperature",
                    "unit_of_measurement": "°C",
                    "icon": "mdi:thermometer",
                    "measured_at": temp["measured_at"],
                    "method": temp["method"],
                })
            for item in items:
                self._post(
                    f"sensor.meditrack_{cslug}_{slugify(item['ingredient'])}",
                    item["next_allowed_at"], {
                        "friendly_name": f"{child['name']} {item['ingredient']} nächste Gabe",
                        "device_class": "timestamp",
                        "icon": "mdi:clock-check-outline" if item["allowed_now"] else "mdi:clock-alert-outline",
                        "allowed_now": item["allowed_now"],
                        "last_given_at": item["last_given_at"],
                        "medication": item["medication_name"],
                        "doses_24h": item["doses_24h"],
                        "max_doses_24h": item["max_doses_per_24h"],
                        "mg_24h": item["mg_24h"],
                        "max_mg_24h": item["max_mg_24h"],
                    })
        log.debug("Sensoren veröffentlicht")
