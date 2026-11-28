# Changelog

## 1.4.0
- Neu: **Ereignisse** erfassen (Erbrechen, Durchfall, Schnupfen/Husten, Affektkrampf, Arztbesuch,
  Zahnen, Stich/Verletzung, Notiz) – im Verlauf und als eigene Spur im Diagramm.
- Neu: **Daten importieren** (Kinder → Daten importieren) mit Vorschau. Sperrzeit-Warnungen werden
  beim Import nicht angewendet, bereits vorhandene Einträge werden übersprungen, bei Fehlern wird nichts gespeichert.
- Neue Vorlagen: Perenterol (Saccharomyces boulardii), Viburcol Zäpfchen.
- Diagramm-Tooltip zeigt gleichzeitige Einträge gemeinsam. Ereignisse sind im JSON-Export enthalten.

## 1.3.1
- Behoben: Normale Home-Assistant-Benutzer (ohne Adminrechte) erhielten «401 Unauthorized».
  Das Add-on-Panel ist jetzt für alle angemeldeten Benutzer freigegeben (`panel_admin: false`).
  Nicht angemeldete Zugriffe bleiben gesperrt (nur Ingress, kein offener Port).
- Neu: Dashboardkarte `dashboard/meditrack-card.js`, die auch für Nicht-Admins funktioniert
  (die HACS-Karte `addon-iframe-card` nutzt einen reinen Admin-Befehl).
- Keine Änderungen an Daten, Design oder Funktionen.

## 1.3.0
- Datum und Uhrzeit immer im Format TT.MM.JJJJ und 24 h – unabhängig von der Spracheinstellung des Handys.
  Eigene Zeitauswahl: «Jetzt», «−15 min», «−30 min», «−1 h», Tag (Heute/Gestern/…) und Uhrzeit HH:MM.
- Smartphone-Bedienung: Dialoge als Bottom-Sheet mit fixer Speichern-Leiste, grössere Tippflächen,
  Plus/Minus für Menge und Temperatur, Messart als Knöpfe, Medikamentenauswahl als Liste.
- Komma oder Punkt als Dezimaltrennzeichen (38,5 oder 38.5).
- Einheitliche Linien-Icons statt Emojis; doppelter App-Titel entfernt (HA zeigt ihn bereits).

## 1.2.2
- Amoxicillin Sandoz: eingestellt auf 2× täglich (mind. 10 h Abstand, kein 24-h-Zähler).
  Bereits installierte Vorlage ggf. von Hand anpassen (eigene Werte werden nie überschrieben).

## 1.2.1
- Neue Vorlage: «Amoxicillin Sandoz Suspension 200 mg/4 ml» (50 mg/ml); wird bei bestehenden Installationen ergänzt.

## 1.2.0
- Temperatur separat erfassen (°C, Messart, Zeitpunkt, Notiz); bearbeiten und löschen.
- Letzte Temperatur auf der Übersicht; Messungen erscheinen im Verlauf.
- Neue Ansicht «Diagramm»: Temperaturkurve mit Fiebergrenze und Gaben pro Wirkstoff,
  Zeitraum 24 h / 3 / 7 / 30 Tage oder frei wählbar.
- Neuer Sensor `sensor.meditrack_<kind>_temperatur`; Temperaturen im JSON-Export.

## 1.1.1
- Neu: «Algifor Junior Suspension 100 mg/5 ml» (Ibuprofen 20 mg/ml) als Favorit.
- Generischer Eintrag heisst wieder «Ibuprofen Suspension 20 mg/ml» (kein Favorit).
- Bestehende Installationen: Vorlagen werden umbenannt, erfasste Gaben bleiben zugeordnet.

## 1.1.0
- Gaben bearbeiten und löschen (im Verlauf auf einen Eintrag tippen); Sperrzeiten werden neu geprüft.
- Schnellauswahl auf Übersicht und im Erfassen-Dialog: Favoriten (★) und die 5 zuletzt verwendeten Medikamente.
- Neue Vorlagen: Dafalgan Zäpfchen 150 mg, Nasivin Kinder Spray 0.025 % (Oxymetazolin).
  Bestehende Installationen erhalten die neuen Vorlagen automatisch, eigene Änderungen bleiben erhalten.
- Favorit pro Medikament einstellbar; Favoriten stehen in Listen zuoberst.
- Zäpfchen: Dosisinfo zeigt «1 Stück = 150 mg (12 mg/kg)» statt Bruchteilen.

## 1.0.1
- «Wieder möglich ab» wird auf die nächste Viertelstunde aufgerundet (nie früher als der Mindestabstand).
- Zeitpunkt beim Erfassen wird mit der nächstgelegenen Viertelstunde vorausgefüllt.

## 1.0.0
- Erste Version: Kinderprofile, Medikamenten-Datenbank mit 16 Vorlagen,
  Gaben erfassen, Sperrzeiten pro Wirkstoff, Tageslimits, Gewichtsvorschlag,
  Verlauf, JSON-Export, optionale HA-Sensoren.
