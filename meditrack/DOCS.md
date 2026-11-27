# MediTrack

Erfasse, wann du deinem Kind welches Medikament gegeben hast – mit Sperrzeit
(«wieder geben ab …»), Tageslimit und gewichtsbasiertem Dosisvorschlag.

## Bedienung
1. **Kinder** → Kind mit Gewicht (und optional Geburtsdatum) erfassen.
2. **Übersicht** → «+ Gabe erfassen»: Medikament wählen, Menge prüfen, speichern.
   Zeitpunkt ist änderbar (Nachträge möglich).
3. Die Übersicht zeigt pro **Wirkstoff**, wann die letzte Gabe war und ab wann
   wieder gegeben werden darf. Dafalgan und Ben-u-ron zählen z. B. gemeinsam als Paracetamol.
4. Wird zu früh oder zu viel erfasst, erscheint eine Warnung. Speichern ist nur
   mit «Trotzdem speichern» möglich (z. B. bei ärztlicher Anweisung).
5. **Medikamente** → Vorlagen anpassen oder eigene hinzufügen.

## Felder eines Medikaments
| Feld | Bedeutung |
|---|---|
| Wirkstoff | Gruppiert Sperrzeiten über Produkte hinweg |
| Darreichungsform / Art der Einnahme | z. B. Sirup / oral, Zäpfchen / rektal |
| Einheit, mg pro Einheit | z. B. ml und 30 → 6 ml = 180 mg |
| mg pro kg, max. Einzeldosis | für den Dosisvorschlag |
| Wieder geben nach (h) | Mindestabstand zwischen zwei Gaben |
| Max. Gaben / 24 h, max. mg/kg/Tag | Tageslimit (rollierend über 24 h) |

## Optionen
- `publish_sensors` (Standard `true`): veröffentlicht Sensoren in Home Assistant:
  - `sensor.meditrack_<kind>_letzte_gabe` – Zeitpunkt der letzten Gabe
  - `sensor.meditrack_<kind>_<wirkstoff>` – Zeitpunkt der nächsten möglichen Gabe
    (Attribut `allowed_now`)
- `log_level`: debug | info | warning | error

### Beispiel-Automation: Push, sobald Paracetamol wieder möglich ist
```yaml
automation:
  - alias: "Paracetamol Lena wieder möglich"
    triggers:
      - trigger: time
        at: sensor.meditrack_lena_paracetamol
    actions:
      - action: notify.mobile_app_mein_handy
        data:
          message: "Lena darf wieder Paracetamol bekommen."
```

## Daten & Datenschutz
Alle Daten liegen lokal in `/data/meditrack.db` auf deinem Home-Assistant-Server
und sind in HA-Backups enthalten. Zugriff nur über HA (Ingress). Export als JSON
unter **Kinder → Daten exportieren**.

## Wichtiger Hinweis
Die vorbelegten Dosierungen sind allgemeine Richtwerte und **ersetzen weder
Packungsbeilage noch ärztliche Beratung**. Bitte vor der ersten Nutzung prüfen
und bei Bedarf anpassen. Notfall: Tox Info Suisse 145, Notruf 144.
