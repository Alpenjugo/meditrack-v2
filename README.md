# MediTrack – Home-Assistant-Add-on

Medikamenten-Tracker für Kinder: Gaben erfassen, Sperrzeiten pro Wirkstoff,
Tageslimits, gewichtsbasierter Dosisvorschlag, Medikamenten-Datenbank mit
18 gängigen Kindermedikamenten (Schweiz). Erscheint als Seitenleisten-App
«Medikamente» in Home Assistant (auch in der Companion-App).

## Installation
**Variante A – über GitHub (Repo muss öffentlich sein):**
Einstellungen → Add-ons → Add-on Store → ⋮ → Repositories →
`https://github.com/alpenjugo/meditrack-v2` hinzufügen → «MediTrack» installieren → Starten
→ «In Seitenleiste anzeigen» aktivieren.

**Variante B – lokales Add-on (Repo bleibt privat):**
Ordner `meditrack/` per Samba- oder SSH-Add-on nach `/addons/meditrack/`
kopieren → Add-on Store → ⋮ → «Nach Updates suchen» → unter «Lokale Add-ons» installieren.

Voraussetzung: Home Assistant OS oder Supervised (Add-ons). Bei HA Container
läuft die App als normaler Docker-Container (siehe unten) und kann per
`panel_iframe`/Webseiten-Dashboard eingebunden werden.

## Lokal entwickeln / testen
```bash
cd meditrack/app && MEDITRACK_DB=./dev.db python3 server.py   # http://localhost:8099
python3 -m unittest discover -s tests                        # Tests
docker build -t meditrack meditrack && docker run -p 8099:8099 -v $PWD/data:/data meditrack
```

## Aufbau
- `meditrack/app/core.py` – Datenbank (SQLite) und Prüflogik
- `meditrack/app/seed.py` – vorbelegte Medikamente
- `meditrack/app/server.py` – HTTP/API (nur Python-Standardbibliothek)
- `meditrack/app/ha.py` – optionale HA-Sensoren
- `meditrack/app/static/` – Oberfläche (HTML/CSS/JS)

Details zur Bedienung: [meditrack/DOCS.md](meditrack/DOCS.md)
