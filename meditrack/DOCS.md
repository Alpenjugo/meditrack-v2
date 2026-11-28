# MediTrack

Erfasse, wann du deinem Kind welches Medikament gegeben hast – mit Sperrzeit
(«wieder geben ab …»), Tageslimit und gewichtsbasiertem Dosisvorschlag.

## Bedienung
1. **Kinder** → Kind mit Gewicht (und optional Geburtsdatum) erfassen.
2. **Übersicht** → «+ Gabe erfassen»: Medikament wählen, Menge prüfen, speichern.
   Zeitpunkt ist änderbar (Nachträge möglich), vorausgefüllt auf die nächste Viertelstunde.
3. Die Übersicht zeigt pro **Wirkstoff**, wann die letzte Gabe war und ab wann
   wieder gegeben werden darf. Dafalgan und Ben-u-ron zählen z. B. gemeinsam als Paracetamol.
4. Wird zu früh oder zu viel erfasst, erscheint eine Warnung. Speichern ist nur
   mit «Trotzdem speichern» möglich (z. B. bei ärztlicher Anweisung).
5. **Schnellauswahl**: Favoriten (Stern) und die 5 zuletzt verwendeten Medikamente
   erscheinen als Knöpfe im Dialog «Gabe erfassen». Favorit setzen:
   Medikamente → Medikament öffnen → «Favorit».
6. **Temperatur** → «Temperatur» auf der Übersicht: Wert in °C, Messart (Ohr, Stirn,
   rektal, Achsel, Mund), Zeitpunkt. Die letzte Messung steht oben auf der Übersicht.
7. **Verlauf** → Gaben und Messungen chronologisch; Eintrag antippen zum Bearbeiten oder Löschen.
8. **Diagramm** → Temperaturkurve mit den Gaben darunter (eine Spur pro Wirkstoff).
   Zeitraum: 24 h, 3 Tage, 7 Tage, 30 Tage oder eigenes Von–Bis-Datum. Punkt antippen
   zeigt Details. Gestrichelte Linie = Fiebergrenze 38.0 °C.
9. **Ereignis** → z. B. Erbrechen, Durchfall, Affektkrampf, Arztbesuch, Zahnen oder eine Notiz
   mit Zeitpunkt festhalten. Erscheint im Verlauf und im Diagramm.
10. **Medikamente** → Vorlagen anpassen oder eigene hinzufügen.
11. **Daten importieren** (Kinder) → MediTrack-Importdatei (JSON) für das ausgewählte Kind.
    Vor dem Speichern erscheint eine Vorschau; doppelte Einträge werden übersprungen.

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
  - `sensor.meditrack_<kind>_temperatur` – zuletzt gemessene Temperatur in °C
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

## Mehrere Benutzer & Dashboard
Ab Version 1.3.1 können auch **normale Home-Assistant-Benutzer** (ohne Adminrechte)
MediTrack verwenden – über die Seitenleiste «Medikamente». Nicht angemeldete Personen
haben weiterhin keinen Zugriff: MediTrack ist nur über HA-Ingress erreichbar, es gibt
keinen offenen Port, und HA prüft bei jeder Sitzung den angemeldeten Benutzer.

Zugriff steuern: Einstellungen → Personen → Benutzer. Wer kein HA-Konto hat, sieht
MediTrack nicht. Alle Benutzer mit Zugriff sehen dieselben Daten.

**Im Dashboard einbetten:** Die HACS-Karte `addon-iframe-card` funktioniert nur für
Administratoren, weil sie den Admin-Befehl `supervisor/api` verwendet (Fehler 401 bei
normalen Benutzern). Stattdessen die mitgelieferte Karte `dashboard/meditrack-card.js`
aus dem Repository verwenden:

1. Datei nach `/config/www/meditrack-card.js` kopieren.
2. Einstellungen → Dashboards → ⋮ → Ressourcen → «Ressource hinzufügen»:
   URL `/local/meditrack-card.js`, Typ «JavaScript-Modul».
3. Karte (YAML):
   ```yaml
   type: custom:meditrack-card
   addon: 3aa2d0b6_meditrack   # Slug aus der Adresszeile der Seitenleisten-App
   height: 80vh
   ```

Ohne zusätzliche Karte geht auch eine Schaltfläche, die die Seitenleisten-App öffnet:
```yaml
type: button
name: Medikamente
icon: mdi:pill
tap_action:
  action: navigate
  navigation_path: /3aa2d0b6_meditrack
```

## Daten & Datenschutz
Alle Daten liegen lokal in `/data/meditrack.db` auf deinem Home-Assistant-Server
und sind in HA-Backups enthalten. Zugriff nur über HA (Ingress). Export als JSON
unter **Kinder → Daten exportieren**.

## Wichtiger Hinweis
Die vorbelegten Dosierungen sind allgemeine Richtwerte und **ersetzen weder
Packungsbeilage noch ärztliche Beratung**. Bitte vor der ersten Nutzung prüfen
und bei Bedarf anpassen. Notfall: Tox Info Suisse 145, Notruf 144.
