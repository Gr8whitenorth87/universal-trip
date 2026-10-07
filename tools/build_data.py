#!/usr/bin/env python3
"""Build the encrypted trip bundle data/app-data.enc.json from data/src/.

Run from the repo root:  TRIP_PASSWORD=... python3 tools/build_data.py

The family-specific files (plan, guide, dining, birthday) are not committed in plain text.
They live in data/src/private/ (git-ignored) and are also saved, encrypted with the same
password, as data/src/private.enc.json so they can be restored on any machine.
Prints any names it could not place on the map so they can be fixed in OVERRIDES.
"""
import base64
import hashlib
import json
import math
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "src"
OUT = ROOT / "data" / "app-data.enc.json"
PRIVATE_DIR = SRC / "private"
PRIVATE_ENC = SRC / "private.enc.json"
PRIVATE_FILES = ["plan.json", "guide.json", "dining.json", "birthday.json"]
# Fixed salt so a phone that already unlocked keeps working after each rebuild.
SALT = hashlib.sha256(b"universal-trip-2026").digest()[:16]
ITERATIONS = 200_000


def _key(password):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=SALT, iterations=ITERATIONS).derive(password.encode())


def encrypt(obj, password):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    ct = AESGCM(_key(password)).encrypt(iv, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS, "salt": b64(SALT), "iv": b64(iv), "ct": b64(ct)}


def decrypt(blob, password):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = AESGCM(_key(password)).decrypt(base64.b64decode(blob["iv"]), base64.b64decode(blob["ct"]), None)
    return json.loads(raw)


def load_private(password):
    """Plain files in data/src/private/ win; otherwise restore them from the encrypted copy."""
    if all((PRIVATE_DIR / f).exists() for f in PRIVATE_FILES):
        files = {f: json.loads((PRIVATE_DIR / f).read_text()) for f in PRIVATE_FILES}
        PRIVATE_ENC.write_text(json.dumps(encrypt(files, password)))
        return files
    files = decrypt(json.loads(PRIVATE_ENC.read_text()), password)
    PRIVATE_DIR.mkdir(exist_ok=True)
    for name, content in files.items():
        (PRIVATE_DIR / name).write_text(json.dumps(content, ensure_ascii=False, indent=1))
    return files

PARKS = {
    "USF": {"id": "eb3f4560-2383-4a36-9152-6b3e5ed6bc57", "name": "Universal Studios Florida", "short": "Studios"},
    "IOA": {"id": "267615cc-8943-4c2a-ae2c-5da728ca591f", "name": "Islands of Adventure", "short": "Islands"},
    "EPIC": {"id": "12dbb85b-265f-44e6-bccf-f1faa17211fc", "name": "Epic Universe", "short": "Epic"},
}

# Canonical land names per park, in walking order around the park.
LANDS = {
    "USF": ["Production Central", "Minion Land", "New York", "San Francisco", "Diagon Alley", "London",
            "World Expo", "Springfield", "DreamWorks Land", "Hollywood"],
    "IOA": ["Port of Entry", "Marvel Super Hero Island", "Toon Lagoon", "Skull Island", "Jurassic Park",
            "Hogsmeade", "Lost Continent", "Seuss Landing"],
    "EPIC": ["Celestial Park", "Super Nintendo World", "Dark Universe", "Ministry of Magic", "Isle of Berk"],
}

LAND_RULES = [
    ("knockturn", "Diagon Alley"), ("diagon", "Diagon Alley"), ("gringotts", "Diagon Alley"),
    ("london", "London"), ("king's cross", "London"), ("kings cross", "London"),
    ("hogsmeade", "Hogsmeade"), ("ministry", "Ministry of Magic"), ("paris", "Ministry of Magic"),
    ("minion", "Minion Land"), ("dreamworks", "DreamWorks Land"), ("springfield", "Springfield"),
    ("simpsons", "Springfield"), ("new york", "New York"), ("san francisco", "San Francisco"),
    ("world expo", "World Expo"), ("production central", "Production Central"), ("hollywood", "Hollywood"),
    ("marvel", "Marvel Super Hero Island"), ("toon lagoon", "Toon Lagoon"), ("skull island", "Skull Island"),
    ("jurassic", "Jurassic Park"), ("lost continent", "Lost Continent"), ("seuss", "Seuss Landing"),
    ("port of entry", "Port of Entry"), ("celestial", "Celestial Park"), ("nintendo", "Super Nintendo World"),
    ("mushroom", "Super Nintendo World"), ("donkey kong", "Super Nintendo World"), ("mario", "Super Nintendo World"),
    ("dark universe", "Dark Universe"), ("darkmoor", "Dark Universe"), ("berk", "Isle of Berk"),
    ("dragon", "Isle of Berk"),
]

# Source names that don't match an API entity name closely enough.
OVERRIDES = {
    "Hogwarts Express – King's Cross Station": "Hogwarts™ Express - King's Cross Station",
    "Hogwarts Express – Hogsmeade Station": "Hogwarts Express™ - Hogsmeade™ Station",
    "Illumination Theater (Minions, Gru & the Girls Meet & Greet)": "Illumination Theater",
    "Ollivanders": "Ollivanders™ Experience in Hogsmeade™",
    "Meet Toothless & Friends": "Meet Toothless and Friends",
    "Mario & Luigi Meet & Greet": "Meet Mario and Luigi",
    "Princess Peach Meet & Greet": "Meet Princess Peach",
    "Toad Meet & Greet": "Meet Toad",
    "Donkey Kong Meet & Greet": "Meet Donkey Kong",
    "Dark Universe Character Encounters": "Say Hello to the Residents of Darkmoor Village",
    "Universal Celestial Goodnight": "Universal Celestial Goodnight",
    "Marvel Character Meet & Greet (Spider-Man, Captain America, X-Men)": "Meet Spider-Man and the Marvel® Super Heroes",
    "Toon Lagoon Character Meet (Popeye, Olive Oyl, Betty Boop)": "Classic Comic Book Characters",
    "Seuss Character Meet & Greet (Cat in the Hat, Thing 1 & 2, Grinch, Lorax)": "Seuss Character Zone",
    "DreamWorks Character Meets (Trolls, Puss in Boots, King Julien, Gabby)": "DreamWorks Character Zone",
    "The Simpsons Character Meet & Greet": "The Simpsons™ Character Zone",
    "Transformers Meet & Greet (Optimus Prime, Bumblebee, Megatron)": "Meet The TRANSFORMERS™",
    "SpongeBob & Friends Meet & Greet": "Meet SpongeBob SquarePants and Friends",
    "Shrek, Fiona & Donkey Meet & Greet (Shrek's Swamp)": "Shrek's Swamp Meet",
    "DreamWorks Character Meets (Trolls, Puss in Boots, Gabby)": "DreamWorks Character Zone",
    "Death Eaters in Knockturn Alley": "Death Eaters™ Encounter",
    "The Knight Bus": "Knight Bus™",
    "Shrek's Swamp for Little Ogres": "Shrek's Swamp Meet",
}

# Hand-placed points for things the API doesn't list (lat, lng).
MANUAL_POINTS = {
    ("USF", "Celestina Warbeck and the Banshees"): None,
    ("EPIC", "Berk Character Encounters (Astrid & Stormfly, Gobber, Ruffnut & Tuffnut, baby dragons)"): (28.44075, -81.44540),
    ("EPIC", "Captain Cacao Meet & Greet"): (28.44120, -81.44760),
}

MUST_DO = {
    # The kids' franchises and the headline rides; drives ordering and suggestions.
    "Harry Potter and the Escape from Gringotts", "Hogwarts Express – King's Cross Station",
    "Hogwarts Express – Hogsmeade Station", "Harry Potter and the Forbidden Journey",
    "Hagrid's Magical Creatures Motorbike Adventure", "Flight of the Hippogriff",
    "Harry Potter and the Battle at the Ministry", "Mario Kart: Bowser's Challenge", "Mine-Cart Madness",
    "Yoshi's Adventure", "Bowser Jr. Challenge", "Hiccup's Wing Gliders", "Meet Toothless & Friends",
    "The Untrainable Dragon", "Jurassic World VelociCoaster", "Pteranodon Flyers", "Camp Jurassic",
    "Raptor Encounter", "Despicable Me Minion Mayhem", "Illumination's Villain-Con Minion Blast",
    "Stardust Racers", "The Amazing Adventures of Spider-Man", "Ollivanders Experience in Diagon Alley",
}


# Kid notes rewritten for this family: youngest is 51.5" with shoes, the twins are 54.5"+.
KID_NOTES = {
    "Jurassic World VelociCoaster": "The best coaster in Orlando. The youngest clears the 51\" minimum by half an inch; it's the most intense ride here.",
    "Revenge of the Mummy": "The twins will love the launches; darkness, fire, scarabs and mummies may be too much for the youngest.",
    "Dudley Do-Right's Ripsaw Falls": "The 75-ft drop gives screams and laughs. Everyone clears the 44\" minimum.",
    "Doctor Doom's Fearfall": "A 185-ft launch tower. At 52\" it's just out of reach for the youngest.",
    "The Incredible Hulk Coaster": "Launch, inversions and speed. 54\" minimum: the twins can ride, the youngest can't yet.",
    "Pteranodon Flyers": "Riders 36–56\" only, so all three kids qualify; anyone taller must ride with a child in that range.",
    "Monsters Unchained: The Frankenstein Experiment": "Genuinely frightening robot-arm ride (Dracula, Wolf Man, jump scares). Brave riders only.",
    "Stardust Racers": "A dueling 62-mph racer with big airtime; the twins will want to ride it again.",
    "Dragon Racer's Rally": "Riders tilt their own wings to flip and barrel-roll; the twins will love it.",
    "Harry Potter and the Battle at the Ministry": "The Floo Network intro and Umbridge trial wow the kids. 40\" minimum, so everyone can ride.",
    "Hiccup's Wing Gliders": "Smooth launched family coaster with Toothless; a great first big coaster.",
    "Harry Potter and the Escape from Gringotts": "Likely a top-3 ride for the kids; Bellatrix, Voldemort and the dragon fire can rattle a sensitive rider.",
}


def kid_note(name, text):
    if name in KID_NOTES:
        return KID_NOTES[name]
    t = text or ""
    for pat, rep in [
        (r"\b[Bb]oth kids\b", "the kids"),
        (r"\ba 48\"\+ 10-year-old\b", "the twins"),
        (r"\ba 51\"\+ 10-year-old\b", "the twins"),
        (r"\bthe 10-year-old\b", "the twins"),
        (r"\ba 10-year-old\b", "the twins"),
        (r"\bthe 8-year-old\b", "the youngest"),
        (r"\ban 8-year-old\b", "the youngest"),
        (r"\bmost 8-year-olds\b", "younger kids"),
    ]:
        t = re.sub(pat, rep, t, flags=re.I)
    t = re.sub(r"\bthe twins will find it babyish\b", "the twins may find it babyish", t)
    t = re.sub(r"\bthe twins will pass\b", "the twins may pass", t)
    return t[:1].upper() + t[1:] if t else t


def norm(s):
    s = re.sub(r"[™®©]", "", s or "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\b(the|a|an|starring|presents)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def canon_land(park, raw):
    r = (raw or "").lower()
    for key, land in LAND_RULES:
        if key in r and land in LANDS[park]:
            return land
    if "wizarding" in r:
        return {"USF": "Diagon Alley", "IOA": "Hogsmeade", "EPIC": "Ministry of Magic"}[park]
    return None


def load(name):
    return json.loads((SRC / name).read_text())


def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", norm(s))).strip("-")


def main():
    password = os.environ.get("TRIP_PASSWORD")
    if not password:
        sys.exit("Set TRIP_PASSWORD to the app password.")
    private = load_private(password)
    problems = []
    coords = {p: load(f"coords_{p}.json") for p in PARKS}
    by_norm = {p: {norm(c["name"]): c for c in coords[p]} for p in PARKS}

    def find_entity(park, name, types=None):
        target = OVERRIDES.get(name, name)
        n = norm(target)
        cands = [c for c in coords[park] if not types or c["type"] in types]
        for c in cands:
            if norm(c["name"]) == n:
                return c
        # containment either way, prefer longest overlap
        best = None
        for c in cands:
            cn = norm(c["name"])
            if n and cn and (n in cn or cn in n):
                score = min(len(n), len(cn))
                if not best or score > best[0]:
                    best = (score, c)
        return best[1] if best and best[0] >= 6 else None

    # ---------- parks: hours ----------
    parks = {}
    for code, meta in PARKS.items():
        sched = load(f"schedule_{code}.json")
        hours = defaultdict(dict)
        for s in sched:
            d = s["date"]
            o, c = s["openingTime"][11:16], s["closingTime"][11:16]
            if s["type"] == "OPERATING":
                hours[d]["open"], hours[d]["close"] = o, c
            elif s["type"] == "EXTRA_HOURS":
                hours[d]["early"] = o
            elif s["type"] == "TICKETED_EVENT":
                hours[d]["event"] = f'{s.get("description") or "Ticketed event"} {o}'
        pts = [(c["lat"], c["lng"]) for c in coords[code] if c["type"] == "ATTRACTION" and c["lat"]]
        center = [round(sum(p[0] for p in pts) / len(pts), 5), round(sum(p[1] for p in pts) / len(pts), 5)]
        parks[code] = {**meta, "code": code, "center": center, "hours": dict(hours), "lands": LANDS[code]}

    # ---------- attractions ----------
    alts = {a["for"]: a["alternatives"] for a in load("alternatives.json")}
    attractions = []
    land_pts = defaultdict(list)
    for a in load("attractions.json"):
        park = a["park"]
        land = canon_land(park, a["land"]) or canon_land(park, a["name"])
        if not land:
            problems.append(f"land? {park} {a['land']} / {a['name']}")
        ent = find_entity(park, a["name"])
        pt = MANUAL_POINTS.get((park, a["name"]))
        if ent:
            pt = (ent["lat"], ent["lng"])
        elif pt is None:
            problems.append(f"no map point: {park} {a['name']}")
        item = {
            "key": slug(f"{park} {a['name']}"),
            "park": park,
            "land": land,
            "name": a["name"],
            "apiId": ent["id"] if ent else None,
            "lat": pt[0] if pt else None,
            "lng": pt[1] if pt else None,
            "kind": a["type"],
            "status": a["status"],
            "minHeight": a.get("min_height_in"),
            "thrill": a.get("thrill"),
            "scary": a.get("scary"),
            "motion": a.get("motion_sickness"),
            "wet": a.get("wet"),
            "minutes": a.get("duration_min"),
            "express": bool(a.get("express")),
            "singleRider": bool(a.get("single_rider")),
            "locker": bool(a.get("locker_required")),
            "typicalWait": a.get("typical_peak_wait_min") or 0,
            "franchise": a.get("franchise"),
            "kidNote": kid_note(a["name"], a.get("kid_note")),
            "tip": a.get("tip"),
            "mustDo": a["name"] in MUST_DO,
        }
        if a["name"] in alts:
            item["alternatives"] = [{"name": x["name"], "walk": x["walk_min"], "why": kid_note("", x["why"])} for x in alts[a["name"]]]
        attractions.append(item)
        if pt and land:
            land_pts[(park, land)].append(pt)

    # alternatives -> link to keys
    by_name = {(x["park"], norm(x["name"])): x for x in attractions}
    for x in attractions:
        for alt in x.get("alternatives", []):
            hit = by_name.get((x["park"], norm(alt["name"])))
            if hit:
                alt["key"] = hit["key"]
            else:
                problems.append(f"alt not linked: {x['name']} -> {alt['name']}")

    # Some API shows/attractions aren't in the research list but belong on the map/live list.
    known_ids = {x["apiId"] for x in attractions if x["apiId"]}
    hhn = re.compile(r"stranger things|sinners|ozzy|cybergoria|evil dead|bloodengutz|hellraiser|invasion|oddfellow|madlands|nightmare fuel|clowntown|club horror|hamikuma|zombies|fortnitemares|infernal|sideshow|summer music|last train|first train|hogwarts always", re.I)
    extra = []
    for p in PARKS:
        for c in coords[p]:
            if c["type"] in ("ATTRACTION", "SHOW") and c["id"] not in known_ids and not hhn.search(c["name"]):
                extra.append(c["name"])
    if extra:
        problems.append("API entities not in research list (ignored): " + "; ".join(extra))

    land_center = {k: (round(sum(p[0] for p in v) / len(v), 5), round(sum(p[1] for p in v) / len(v), 5))
                   for k, v in land_pts.items()}
    # Lands without rides of their own
    land_center.setdefault(("USF", "London"), (28.47920, -81.46930))
    land_center.setdefault(("USF", "San Francisco"), (28.47820, -81.46960))
    land_center.setdefault(("IOA", "Port of Entry"), (28.47210, -81.46870))
    land_center.setdefault(("IOA", "Lost Continent"), (28.47160, -81.47450))

    # ---------- food ----------
    food = []
    for f in load("food.json"):
        if f.get("category") == "table-service":
            continue  # sit-down picks come from private/dining.json
        park = f["park"] if f["park"] in PARKS else f["park"]
        loc = f.get("location") or ""
        ent = None
        if park in PARKS:
            first = re.split(r"[;,(/]| – | - ", loc)[0].strip()
            ent = find_entity(park, first, {"RESTAURANT"}) or find_entity(park, loc, {"RESTAURANT"})
        land = canon_land(park, f.get("land")) if park in PARKS else None
        pt = (ent["lat"], ent["lng"]) if ent else (land_center.get((park, land)) if land else None)
        food.append({
            "park": park, "land": land or f.get("land"), "location": loc, "item": f.get("item"),
            "category": f.get("category"), "section": f.get("section"), "price": f.get("price_approx"),
            "mobileOrder": f.get("mobile_order"), "note": f.get("note"),
            "lat": pt[0] if pt else None, "lng": pt[1] if pt else None, "exactPoint": bool(ent),
        })
        if park in PARKS and not ent and f.get("category") in ("butterbeer", "table-service", "meal"):
            problems.append(f"food approx point: {park} {loc}")

    # ---------- shows / meets ----------
    shows = []
    for s in load("shows.json"):
        park = s["park"].upper()
        if park not in PARKS:
            continue
        ent = find_entity(park, s["name"], {"SHOW", "ATTRACTION"})
        land = canon_land(park, s.get("land")) or canon_land(park, s["name"])
        pt = (ent["lat"], ent["lng"]) if ent else land_center.get((park, land))
        shows.append({**s, "park": park, "land": land, "apiId": ent["id"] if ent else None,
                      "lat": pt[0] if pt else None, "lng": pt[1] if pt else None})

    # ---------- hunts / interactive / photos ----------
    def place(items):
        out = []
        for h in items:
            park = (h.get("park") or "").upper()
            land = canon_land(park, h.get("land")) if park in PARKS else None
            if park in PARKS and not land:
                land = canon_land(park, (h.get("where") or "") + " " + (h.get("title") or ""))
            pt = land_center.get((park, land)) if land else None
            out.append({**h, "park": park, "land": land or h.get("land"),
                        "lat": pt[0] if pt else None, "lng": pt[1] if pt else None})
        return out

    hunts = place(load("hunts.json"))
    for i, h in enumerate(hunts):
        h["key"] = slug(f"{h['park']} {h['title']}")[:60] + f"-{i}"
    interactive = place(load("interactive.json"))
    photos = place(load("photos.json"))

    dining = private["dining.json"]
    for d in dining["picks"] + dining["alternates"]:
        if d.get("park") in PARKS:
            ent = find_entity(d["park"], d["name"], {"RESTAURANT"})
            if ent:
                d["lat"], d["lng"] = ent["lat"], ent["lng"]
            else:
                problems.append(f"dining no point: {d['name']}")

    data = {
        "builtFrom": "data/src (research checked Oct 6, 2026)",
        "parks": parks,
        "landCenters": {f"{k[0]}|{k[1]}": v for k, v in land_center.items()},
        "attractions": attractions,
        "food": food,
        "shows": shows,
        "hunts": hunts,
        "interactive": interactive,
        "photos": photos,
        "plan": private["plan.json"],
        "guide": private["guide.json"],
        "dining": dining,
        "birthday": private["birthday.json"],
        "riders": [{"name": "Youngest", "height": 51.5}, {"name": "Twins", "height": 54.5}],
    }
    keys = {a["key"] for a in attractions}
    for day in (data["plan"] or {}).get("days", []):
        for step in day["steps"]:
            for t in step.get("targets", []):
                if t not in keys:
                    problems.append(f"plan target missing: {day['date']} {t}")
    OUT.write_text(json.dumps(encrypt(data, password)))
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB, "
          f"{len(attractions)} attractions, {len(food)} food, {len(shows)} shows, {len(hunts)} hunts")
    for p in problems:
        print("  !", p)


if __name__ == "__main__":
    sys.exit(main())
