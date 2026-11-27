"""Vorbelegte, gängige Kindermedikamente (Schweiz).

WICHTIG: Die Werte sind allgemeine Orientierungswerte aus gängigen
Dosierungsempfehlungen und ersetzen weder Packungsbeilage noch ärztliche
Verordnung. Sie können in der App jederzeit angepasst werden.

Felder:
  dose_unit        Einheit der Gabe (ml, Tropfen, Stück, Sprühstoss, ...)
  mg_per_unit      Wirkstoff in mg pro Einheit (für mg-Berechnung)
  default_dose     Vorschlag Menge pro Gabe (in dose_unit)
  dose_mg_per_kg   Einzeldosis mg pro kg Körpergewicht (für Gewichtsvorschlag)
  max_single_mg    maximale Einzeldosis in mg
  min_interval_hours  Mindestabstand zwischen zwei Gaben desselben Wirkstoffs
  max_doses_per_24h   maximale Anzahl Gaben in 24 h
  max_mg_per_kg_day   Tageshöchstdosis mg pro kg
"""

# Bei neuen/geänderten Vorlagen erhöhen; neue Einträge mit "added_in" markieren.
SEED_VERSION = 3

CHECK = "Werte vor Gebrauch mit Packungsbeilage bzw. Kinderarzt abgleichen."

PRESET_MEDICATIONS = [
    {
        "name": "Paracetamol Sirup 30 mg/ml (z. B. Dafalgan)",
        "active_ingredient": "Paracetamol",
        "form": "Sirup", "route": "oral", "dose_unit": "ml",
        "mg_per_unit": 30, "dose_mg_per_kg": 15, "max_single_mg": 1000,
        "min_interval_hours": 6, "max_doses_per_24h": 4, "max_mg_per_kg_day": 60,
        "notes": f"Fieber/Schmerzen. {CHECK}",
    },
    {
        "name": "Paracetamol Zäpfchen 125 mg (z. B. Ben-u-ron)",
        "active_ingredient": "Paracetamol",
        "form": "Zäpfchen", "route": "rektal", "dose_unit": "Stück",
        "mg_per_unit": 125, "default_dose": 1, "dose_mg_per_kg": 15,
        "max_single_mg": 1000, "min_interval_hours": 6, "max_doses_per_24h": 4,
        "max_mg_per_kg_day": 60,
        "notes": f"Zäpfchenstärke passend zum Gewicht wählen. {CHECK}",
    },
    {
        "name": "Paracetamol Zäpfchen 250 mg (z. B. Ben-u-ron)",
        "active_ingredient": "Paracetamol",
        "form": "Zäpfchen", "route": "rektal", "dose_unit": "Stück",
        "mg_per_unit": 250, "default_dose": 1, "dose_mg_per_kg": 15,
        "max_single_mg": 1000, "min_interval_hours": 6, "max_doses_per_24h": 4,
        "max_mg_per_kg_day": 60,
        "notes": f"Zäpfchenstärke passend zum Gewicht wählen. {CHECK}",
    },
    {
        "name": "Algifor Junior Suspension 100 mg/5 ml",
        "favorite": True,
        "active_ingredient": "Ibuprofen",
        "form": "Suspension", "route": "oral", "dose_unit": "ml",
        "mg_per_unit": 20, "dose_mg_per_kg": 10, "max_single_mg": 400,
        "min_interval_hours": 6, "max_doses_per_24h": 3, "max_mg_per_kg_day": 30, "added_in": 3,
        "notes": f"Fieber/Schmerzen. Mit etwas Nahrung geben. Nicht bei Dehydratation. {CHECK}",
    },
    {
        "name": "Ibuprofen Suspension 20 mg/ml",
        "active_ingredient": "Ibuprofen",
        "form": "Suspension", "route": "oral", "dose_unit": "ml",
        "mg_per_unit": 20, "dose_mg_per_kg": 10, "max_single_mg": 400,
        "min_interval_hours": 6, "max_doses_per_24h": 3, "max_mg_per_kg_day": 30, "added_in": 3,
        "notes": f"Fieber/Schmerzen. Mit etwas Nahrung geben. Nicht bei Dehydratation. {CHECK}",
    },
    {
        "name": "Dafalgan Zäpfchen 150 mg",
        "active_ingredient": "Paracetamol",
        "form": "Zäpfchen", "route": "rektal", "dose_unit": "Stück",
        "mg_per_unit": 150, "default_dose": 1, "dose_mg_per_kg": 15,
        "max_single_mg": 1000, "min_interval_hours": 6, "max_doses_per_24h": 4,
        "max_mg_per_kg_day": 60, "favorite": True, "added_in": 2,
        "notes": f"Zäpfchenstärke passend zum Gewicht wählen (150 mg ≈ ab 10 kg). {CHECK}",
    },
    {
        "name": "Ibuprofen Zäpfchen 125 mg",
        "active_ingredient": "Ibuprofen",
        "form": "Zäpfchen", "route": "rektal", "dose_unit": "Stück",
        "mg_per_unit": 125, "default_dose": 1, "dose_mg_per_kg": 10,
        "max_single_mg": 400, "min_interval_hours": 6, "max_doses_per_24h": 3,
        "max_mg_per_kg_day": 30,
        "notes": f"Zäpfchenstärke passend zum Gewicht wählen. {CHECK}",
    },
    {
        "name": "Mefenaminsäure Zäpfchen 125 mg (z. B. Ponstan)",
        "active_ingredient": "Mefenaminsäure",
        "form": "Zäpfchen", "route": "rektal", "dose_unit": "Stück",
        "mg_per_unit": 125, "default_dose": 1,
        "min_interval_hours": 8, "max_doses_per_24h": 3,
        "notes": f"Rezeptpflichtig. Dosierung gemäss Verordnung. {CHECK}",
    },
    {
        "name": "Metamizol Tropfen 500 mg/ml (z. B. Novalgin)",
        "active_ingredient": "Metamizol",
        "form": "Tropfen", "route": "oral", "dose_unit": "Tropfen",
        "mg_per_unit": 25, "dose_mg_per_kg": 10, "max_single_mg": 1000,
        "min_interval_hours": 6, "max_doses_per_24h": 4,
        "notes": f"Rezeptpflichtig. 20 Tropfen = 1 ml = 500 mg. Nur nach ärztlicher Verordnung. {CHECK}",
    },
    {
        "name": "Xylometazolin Nasenspray 0.05 % (z. B. Otrivin Kinder)",
        "active_ingredient": "Xylometazolin",
        "form": "Nasenspray", "route": "nasal", "dose_unit": "Sprühstoss",
        "default_dose": 1, "min_interval_hours": 8, "max_doses_per_24h": 3,
        "notes": f"1 Sprühstoss pro Nasenloch. Max. 5–7 Tage am Stück. Altersfreigabe beachten. {CHECK}",
    },
    {
        "name": "Nasivin Kinder Spray 0.025 %",
        "active_ingredient": "Oxymetazolin",
        "form": "Nasenspray", "route": "nasal", "dose_unit": "Sprühstoss",
        "default_dose": 1, "min_interval_hours": 8, "max_doses_per_24h": 3,
        "favorite": True, "added_in": 2,
        "notes": f"1 Sprühstoss pro Nasenloch, 2–3× täglich. Max. 5–7 Tage am Stück. Altersfreigabe beachten. {CHECK}",
    },
    {
        "name": "Meerwasser-/Kochsalz-Nasenspray",
        "active_ingredient": "Natriumchlorid",
        "form": "Nasenspray", "route": "nasal", "dose_unit": "Sprühstoss",
        "default_dose": 1, "min_interval_hours": 0,
        "notes": "Bei Bedarf, keine Sperrzeit.",
    },
    {
        "name": "Cetirizin Tropfen 10 mg/ml (z. B. Zyrtec)",
        "active_ingredient": "Cetirizin",
        "form": "Tropfen", "route": "oral", "dose_unit": "Tropfen",
        "mg_per_unit": 0.5, "default_dose": 5,
        "min_interval_hours": 12, "max_doses_per_24h": 2,
        "notes": f"Allergie. 20 Tropfen = 1 ml = 10 mg. 2–6 J.: 2× 2.5 mg (5 Tropfen); 6–12 J.: 2× 5 mg (10 Tropfen). {CHECK}",
    },
    {
        "name": "Dimetinden Tropfen 1 mg/ml (z. B. Feniallerg)",
        "active_ingredient": "Dimetinden",
        "form": "Tropfen", "route": "oral", "dose_unit": "Tropfen",
        "mg_per_unit": 0.05, "dose_mg_per_kg": 0.033,
        "min_interval_hours": 8, "max_doses_per_24h": 3, "max_mg_per_kg_day": 0.1,
        "notes": f"Allergie/Juckreiz, ab 1 Jahr. 20 Tropfen = 1 ml = 1 mg. {CHECK}",
    },
    {
        "name": "Vitamin D3 Tropfen (z. B. Vi-De 3)",
        "active_ingredient": "Colecalciferol (Vitamin D3)",
        "form": "Tropfen", "route": "oral", "dose_unit": "Tropfen",
        "default_dose": 4, "min_interval_hours": 20, "max_doses_per_24h": 1,
        "notes": "Prophylaxe: 1× täglich, 4 Tropfen ≈ 400 IE (1 Tropfen ≈ 100 IE).",
    },
    {
        "name": "Orale Rehydratationslösung (z. B. Normolytoral)",
        "active_ingredient": "Elektrolyte/Glukose",
        "form": "Lösung", "route": "oral", "dose_unit": "ml",
        "min_interval_hours": 0,
        "notes": "Bei Durchfall/Erbrechen: häufig kleine Mengen. Keine Sperrzeit.",
    },
    {
        "name": "Simeticon Tropfen (z. B. Flatulex)",
        "active_ingredient": "Simeticon",
        "form": "Tropfen", "route": "oral", "dose_unit": "Tropfen",
        "min_interval_hours": 0,
        "notes": f"Blähungen, zu den Mahlzeiten. {CHECK}",
    },
    {
        "name": "Amoxicillin Suspension 50 mg/ml",
        "active_ingredient": "Amoxicillin",
        "form": "Suspension", "route": "oral", "dose_unit": "ml",
        "mg_per_unit": 50, "min_interval_hours": 8, "max_doses_per_24h": 3,
        "notes": "Antibiotikum, rezeptpflichtig. Dosis, Intervall (oft 2–3× täglich) und Dauer exakt gemäss Rezept anpassen.",
    },
    {
        "name": "Dexpanthenol Salbe (z. B. Bepanthen)",
        "active_ingredient": "Dexpanthenol",
        "form": "Salbe", "route": "äusserlich", "dose_unit": "Anwendung",
        "default_dose": 1, "min_interval_hours": 0,
        "notes": "Wundschutz, bei Bedarf.",
    },
]

# Favoriten, die bei bestehenden Installationen (Seed-Version 1) gesetzt werden
FAVORITES_V2 = ["Dafalgan Zäpfchen 150 mg", "Nasivin Kinder Spray 0.025 %"]

# Umbenennungen von Vorlagen (alter Name -> neuer Name, Favorit), angewendet bei Seed-Version < 3.
# Nur unveränderte Vorlagen (is_preset=1) und nur, wenn der neue Name noch frei ist.
RENAMES_V3 = [
    ("Algifor Junior Suspension 20 mg/ml", "Algifor Junior Suspension 100 mg/5 ml", 1),
    ("Ibuprofen Suspension 20 mg/ml (z. B. Algifor Junior)", "Ibuprofen Suspension 20 mg/ml", 0),
]
