"""One-off import of the Veenendaal programmaboekjes (PDF) into data/events/*.json.

Usage: python3 tools/import_2026_booklets.py data/events

Stand coordinates were measured on the PDF floor plans (150 dpi) and are
normalised to the V&V floor plan, which defines the venue coordinate system.
"""
import json, re, sys, os

OUT = sys.argv[1]

def slug(s):
    s = s.lower().replace("‘", "").replace("’", "").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")

def tf_nurse(x, y, w, h):
    k = 1.028
    return (296 + (x - 362) / k, 628 - (595 - y) / k, w / k, h / k)

def tf_ghz(x, y, w, h):
    k = 0.931
    return (296 + (x - 381) / k, 628 - (597 - y) / k, w / k, h / k)

def tf_vv(x, y, w, h):
    return (x, y, w, h)

ROOMS = [
    {"id": "forum", "name": "Forum", "location": "Eerste verdieping (trap of lift)"},
    {"id": "kleine-zaal", "name": "Kleine zaal", "location": "Eerste verdieping (trap of lift)"},
    {"id": "constantijn", "name": "Constantijn", "location": "Begane grond"},
    {"id": "de-taverne", "name": "De Taverne", "location": "Begane grond"},
]

ROUNDS5 = [("09:30", "10:15"), ("10:45", "11:30"), ("12:00", "12:45"), ("13:15", "14:00"), ("14:30", "15:15")]

ACT = {
    "workshops": {"id": "workshops", "name": "Workshops", "icon": "workshop",
                  "text": "Tijdens de vele workshops — gegeven door allerlei verschillende zorgorganisaties — leer je alle uithoeken van de zorgwereld kennen. Doe mee aan de meest interessante sessies, laat je inspireren en geef richting aan jouw zorgcarrière! Je bent geheel vrij om zelf een keuze te maken welke workshop je volgt. Waar wil jij meer over weten?"},
    "fotomagneet": {"id": "fotomagneet", "name": "Fotomagneet", "icon": "camera",
                    "text": "Leg het moment vast! Zin in een leuke herinnering aan de beurs? Stap in de fotobooth, maak een gezellige foto en laat er meteen een leuke fotomagneet van maken. Een vrolijke herinnering om mee naar huis te nemen!"},
    "escaperoom": {"id": "escaperoom", "name": "Momo Escaperoom", "icon": "escape",
                   "text": "Ontdek de Momo-app op een leuke en laagdrempelige manier! Stap in de Momo Escape Room en puzzel jezelf een weg door de app. Weet jij alle uitdagingen te kraken en op tijd te ontsnappen? Meld je aan bij de stand van Momo Medical en doe mee!"},
    "handmassage": {"id": "handmassage", "name": "Handmassage", "icon": "hand",
                    "text": "Even een momentje voor jezelf? Tijdens de beurs kun je genieten van een heerlijke handmassage. Laat de drukte even achter je, kom tot rust en ervaar hoe een korte massage kan zorgen voor ontspanning en een moment van aandacht voor jezelf."},
}

def activity(key, xy, tf):
    a = dict(ACT[key])
    if xy:
        x, y, _, _ = tf(xy[0] + 13, xy[1] + 13, 0, 0)
        a["x"], a["y"] = round(x), round(y)
    return a

def build(meta, tf, partners, letters, stands, sessions, rounds, acts, mains, tags=None):
    by_name = {}
    plist = []
    for num, name in partners:
        pid = slug(name)
        by_name[name] = pid
        plist.append({"id": pid, "name": name, "stand": str(num), "website": "", "description": "",
                      "main": name in mains})
    for letter, name in letters:
        pid = slug(name)
        by_name[name] = pid
        plist.append({"id": pid, "name": name, "stand": letter, "website": "", "description": "",
                      "main": False})
    slist = []
    for label, kind, (x, y, w, h) in stands:
        X, Y, W, H = tf(x, y, w, h)
        if kind == "point":
            slist.append({"id": label, "kind": "point", "x": round(X + W / 2), "y": round(Y + H / 2)})
        else:
            slist.append({"id": label + ("" if not any(s["id"] == label for s in slist) else "b"),
                          "label": label, "kind": kind,
                          "x": round(X), "y": round(Y), "w": round(W), "h": round(H)})
    for s in slist:
        s.setdefault("label", s["id"])
    sess = []
    for room, rnd, title, speaker, org, *rest in sessions:
        start, end = rounds[rnd - 1]
        s = {"id": f"{room}-{rnd}", "room": room, "start": start, "end": end,
             "title": title, "speaker": speaker, "partner": by_name.get(org or speaker, ""),
             "description": ""}
        if org and org not in by_name:
            s["organisation"] = org
        if rest:
            s["tags"] = rest[0]
        sess.append(s)
    ev = dict(meta)
    ev.update({
        "venue": "veenendaal",
        "rooms": ROOMS,
        "rounds": [{"name": f"Workshopronde {i+1}", "start": a, "end": b} for i, (a, b) in enumerate(rounds)],
        "sessions": sess,
        "activities": acts,
        "partners": plist,
        "stands": slist,
    })
    if tags:
        ev["tags"] = tags
    return ev

INTRO_VV = [
    "Leuk dat je aanwezig bent op het V&V Festival! Samen met vele (zorg)organisaties, experts, ervaringsdeskundigen en natuurlijk met jou, gaan we er een geweldige dag van maken!",
    "Tijdens de vele workshops — gegeven door allerlei inspirerende sprekers — leer je alles over actuele thema’s. Doe mee aan de meest interessante sessies en laat je inspireren! Natuurlijk is er ook meer dan genoeg ruimte voor ontspanning. Zo is er op de gezellige beursvloer van alles te doen. Doe mee aan leuke activiteiten, ga in gesprek met zorgorganisaties of collega’s en maak kennis met de nieuwste zorginnovaties.",
    "Veel (leer)plezier!",
]

# ---------------------------------------------------------------- V&V
vv_partners = list(enumerate([
    "Lichen Sclerosus", "Imvorma", "Naviva Kraamzorg", "Apneu vereniging", "GGz Centraal", "Dosell",
    "Altrecht", "Ministerie van Defensie", "Ecare", "Lichen Planus Vereniging", "De Herbergier",
    "Dagelijks Leven", "‘s Heeren Loo", "Less2Care", "NVVR", "Nedap", "Charim", "Medipoint", "Medilex",
    "Momo Medical", "Opella", "Korian Management service", "IZZ", "Medido", "Yakult", "Ambulance Wens",
    "Daan", "Medsocks", "Proflebo", "Nationale Zorg Reserve", "Magic Match", "Magic Match academy",
    "Pleyade"], start=1))
vv_letters = [("A", "Mentorschap Nederland"), ("B", "Ataxie Vereniging"), ("C", "TSC Connected Care"),
              ("D", "Angggila VPK"), ("E", "Ontplooi")]
P, G = "large", "small"
vv_stands = [
    ("23", P, (391, 382, 58, 58)), ("11", P, (639, 383, 58, 28)), ("17", P, (530, 412, 58, 28)),
    ("12", P, (639, 412, 28, 57)), ("22", P, (420, 441, 29, 58)), ("18", P, (530, 441, 28, 57)),
    ("16", P, (559, 441, 29, 57)), ("9", P, (668, 441, 29, 58)), ("27", P, (296, 500, 28, 87)),
    ("21", P, (391, 500, 58, 28)), ("8", P, (639, 500, 58, 28)), ("14", P, (530, 529, 58, 28)),
    ("20", P, (442, 569, 58, 59)), ("8", P, (619, 569, 59, 59)), ("32", P, (490, 630, 28, 87)),
    ("33", P, (620, 630, 58, 28)), ("31", P, (490, 718, 28, 58)),
    ("7", G, (790, 324, 29, 29)), ("30", G, (296, 349, 29, 29)), ("6", G, (790, 354, 29, 28)),
    ("29", G, (296, 379, 29, 27)), ("28", G, (296, 407, 29, 29)), ("10", G, (668, 412, 29, 28)),
    ("5", G, (790, 412, 29, 29)), ("24", G, (391, 441, 28, 28)), ("25", G, (391, 470, 28, 29)),
    ("13", G, (639, 470, 28, 29)), ("4", G, (790, 498, 29, 29)), ("19", G, (530, 499, 28, 29)),
    ("15", G, (559, 499, 29, 29)), ("3", G, (790, 528, 29, 28)), ("2", G, (790, 557, 29, 29)),
    ("1", G, (790, 587, 29, 28)), ("26", G, (296, 588, 28, 29)),
    ("E", "point", (441, 309, 18, 19)), ("B", "point", (661, 310, 18, 19)), ("D", "point", (301, 317, 19, 19)),
    ("C", "point", (570, 578, 18, 19)), ("A", "point", (743, 596, 19, 19)),
]
vv_sessions = [
    ("forum", 1, "Een kijkje in de wereld van een militair verpleegkundige", "", "Ministerie van Defensie"),
    ("forum", 2, "Trauma en rouw bij dementie: hoe herken je de signalen?", "", "Dagelijks Leven"),
    ("forum", 3, "Trauma en rouw bij dementie: hoe herken je de signalen?", "", "Dagelijks Leven"),
    ("forum", 4, "Palliatieve zorg: wat blijft belangrijk als alles verandert?", "", "Medipoint"),
    ("forum", 5, "Palliatieve zorg: wat blijft belangrijk als alles verandert?", "", "Medipoint"),
    ("kleine-zaal", 1, "Darmproblemen bij ouderen: leer wat je kunt doen", "", "Yakult"),
    ("kleine-zaal", 2, "Belevingsgericht werken: zorg met aandacht of een verplicht nummer?", "Rob Heebink", ""),
    ("kleine-zaal", 3, "Wondzorg zonder keuzestress: welk verband kies je wanneer?", "Jacobine Melis", ""),
    ("kleine-zaal", 4, "Verbinden bij het zwachtelen: zo krijg je cliënten beter mee", "Jacobine Melis", ""),
    ("kleine-zaal", 5, "Omgaan met Emotie & Agressie", "Jaro Wolff", ""),
    ("constantijn", 1, "Reablement: zo help je een cliënt zelf de regie te houden", "", "Charim"),
    ("constantijn", 2, "Energiek in je werk: hoe houd je de zorg leuk?", "", "IZZ"),
    ("constantijn", 3, "Intake onder de loep: welke informatie heb jij echt nodig?", "", "Nedap"),
    ("constantijn", 4, "De cliënt centraal: succesvol samenwerken met mentoren", "", "Mentorschap Nederland"),
    ("de-taverne", 1, "Het begint bij jou: bewust omgaan met je gedrag bij dementie", "", "Opella"),
    ("de-taverne", 2, "Het begint bij jou: bewust omgaan met je gedrag bij dementie", "", "Opella"),
    ("de-taverne", 3, "Van werkdruk naar werkgeluk", "", "Momo Medical"),
    ("de-taverne", 4, "Van data naar daadkracht: slimmer sturen op zorg en bedrijfsvoering", "", "Ecare"),
]
vv = build(
    {"id": "vv-veenendaal", "name": "V&V Festival", "city": "Veenendaal", "date": "",
     "tagline": "Hét inspirerende dagje uit voor Verpleegkundigen & Verzorgenden",
     "intro": INTRO_VV, "theme": {"primary": "#00513b", "accent": "#e89090"}},
    tf_vv, vv_partners, vv_letters, vv_stands, vv_sessions, ROUNDS5,
    [ACT["workshops"], activity("fotomagneet", (613, 744), tf_vv), activity("escaperoom", (458, 537), tf_vv),
     activity("handmassage", (792, 385), tf_vv)],
    {"IZZ", "Ministerie van Defensie", "Momo Medical"})

# ---------------------------------------------------------------- GHZ & GGZ
ghz_partners = list(enumerate([
    "Lichen Sclerosus", "Apneu vereniging", "GGz Centraal", "Dosell", "Altrecht", "Mijn Eigen Plan",
    "‘s Heeren Loo", "Ministerie van Defensie", "Philadelphia Zorg", "Medilex", "Nedap", "Thomashuis",
    "Belevenis Tafel", "JP van den Bent", "Medido", "IZZ", "Ambulance Wens", "Daan", "Medsocks",
    "Magic Match", "Magic Match academy"], start=1))
ghz_letters = [("A", "Jonic Solutions"), ("B", "TSC Connected Care"), ("C", "Vereniging van Huntington"),
               ("D", "Geert Bettinger")]
ghz_stands = [
    ("16", P, (470, 369, 54, 54)), ("6", P, (700, 369, 54, 26)), ("13", P, (599, 397, 54, 26)),
    ("12", P, (599, 424, 26, 53)), ("11", P, (627, 424, 26, 53)), ("18", P, (382, 478, 26, 82)),
    ("14", P, (470, 478, 54, 27)), ("8", P, (700, 479, 54, 26)), ("9", P, (520, 543, 54, 54)),
    ("8", P, (682, 543, 54, 54)), ("21", P, (562, 599, 26, 81)), ("20", P, (562, 681, 26, 54)),
    ("5", G, (841, 314, 26, 27)), ("4", G, (841, 342, 26, 26)), ("19", G, (381, 395, 27, 27)),
    ("3", G, (841, 399, 26, 26)), ("15", G, (470, 424, 26, 26)), ("7", G, (701, 451, 26, 27)),
    ("2", G, (841, 477, 26, 27)), ("10", G, (599, 478, 26, 26)), ("1", G, (841, 559, 26, 27)),
    ("17", G, (381, 561, 27, 26)),
    ("A", "point", (705, 428, 17, 18)), ("B", "point", (733, 428, 18, 18)), ("C", "point", (733, 456, 18, 17)),
    ("D", "point", (845, 523, 17, 17)),
]
ghz_sessions = [
    ("forum", 1, "De natuur als tweede spreekkamer: buiten behandelen in de GGZ", "", "Altrecht"),
    ("forum", 2, "De natuur als tweede spreekkamer: buiten behandelen in de GGZ", "", "Altrecht"),
    ("forum", 3, "Energiek in je werk: hoe houd je de zorg leuk?", "", "IZZ"),
    ("kleine-zaal", 1, "Omgaan met Emotie & Agressie", "Jaro Wolff", ""),
    ("kleine-zaal", 2, "ABCD-community building: hoe help je cliënten meedoen in de buurt?", "", "Philadelphia Zorg"),
    ("kleine-zaal", 3, "Werkdruk of druk met werk?", "", "Philadelphia Zorg"),
    ("kleine-zaal", 4, "Luister naar je lijf: meer rust en energie in je werk", "Astrid de Bruijn", ""),
    ("constantijn", 1, "Meer eigen regie voor cliënten met digitale tools", "", "Philadelphia Zorg"),
    ("constantijn", 2, "Meer eigen regie: praten met mensen, niet over mensen", "", "‘s Heeren Loo"),
    ("constantijn", 3, "Gelukkig is er ‘probleemgedrag’", "Geert Bettinger", ""),
    ("constantijn", 4, "Gelukkig is er ‘probleemgedrag’", "Geert Bettinger", ""),
    ("constantijn", 5, "Maak kennis met maatschappelijke zorg bij het leger", "", "Ministerie van Defensie"),
    ("de-taverne", 1, "Crisisdienst van binnenuit: wat gebeurt er bij acute situaties?", "", "GGz Centraal"),
    ("de-taverne", 2, "Intake onder de loep: welke informatie heb jij echt nodig?", "", "Nedap"),
    ("de-taverne", 3, "Ontdek hoe je beter contact maakt met je cliënt", "", "JP van den Bent"),
    ("de-taverne", 4, "Meer eigen regie: praten met mensen, niet over mensen", "", "‘s Heeren Loo"),
    ("de-taverne", 5, "Hoe zorg jij goed voor jezelf bij hoge werkdruk?", "Anneke Kersten", ""),
]
ghz = build(
    {"id": "ghz-ggz-veenendaal", "name": "GHZ & GGZ Festival", "city": "Veenendaal", "date": "",
     "tagline": "Het leuke & leerzame dagje uit voor alle professionals in de gehandicaptenzorg en geestelijke gezondheidszorg!",
     "intro": [
         "Welkom! Leuk dat je aanwezig bent op het GHZ & GGZ Festival! Samen met alle (zorg)organisaties, experts, ervaringsdeskundigen en natuurlijk met jou, gaan we er een geweldige dag van maken! Tijdens de vele workshops — gegeven door allerlei inspirerende sprekers — leer je alles over actuele thema’s. Doe mee aan de meest interessante sessies en laat je inspireren!",
         "Natuurlijk is er ook meer dan genoeg ruimte voor ontspanning. Zo is er op de gezellige beursvloer van alles te doen. Doe mee aan leuke activiteiten, ga in gesprek met zorgorganisaties of collega’s en maak kennis met de nieuwste zorginnovaties.",
         "Veel (leer)plezier!"],
     "theme": {"primary": "#00513b", "accent": "#e89090"}},
    tf_ghz, ghz_partners, ghz_letters, ghz_stands, ghz_sessions, ROUNDS5,
    [ACT["workshops"], activity("fotomagneet", (676, 705), tf_ghz), activity("handmassage", (499, 438), tf_ghz)],
    {"IZZ", "Ministerie van Defensie", "Philadelphia Zorg"})

# ---------------------------------------------------------------- NURSE.
nurse_partners = list(enumerate([
    "Lichen Sclerosus", "Imvorma", "Naviva Kraamzorg", "Apneu vereniging", "GGz Centraal", "Icare",
    "Dosell", "Altrecht", "Ministerie van Defensie", "‘s Heeren Loo", "Lichen Planus Vereniging",
    "Zorgnetwerk GAIN", "NVVR", "Bartimeus", "Charim", "Buro Nexus", "Momo Medical", "JP van den Bent",
    "paraDIGMA groep", "IZZ", "Ambulance Wens", "Daan", "Medsocks", "Magic Match", "Magic Match academy"],
    start=1))
nurse_letters = [("A", "Vereniging van Huntington")]
nurse_stands = [
    ("20", P, (460, 343, 59, 60)), ("15", P, (602, 374, 60, 29)), ("16", P, (602, 404, 29, 58)),
    ("14", P, (633, 404, 29, 58)), ("22", P, (362, 464, 29, 90)), ("18", P, (459, 464, 60, 29)),
    ("9", P, (714, 464, 60, 29)), ("17", P, (515, 535, 60, 60)), ("9", P, (694, 535, 60, 60)),
    ("25", P, (561, 597, 29, 90)), ("24", P, (561, 688, 29, 59)),
    ("8", G, (870, 283, 29, 30)), ("7", G, (870, 314, 29, 29)), ("6", G, (870, 344, 29, 29)),
    ("23", G, (362, 368, 29, 29)), ("12", G, (714, 373, 29, 29)), ("11", G, (745, 373, 29, 29)),
    ("5", G, (870, 374, 29, 30)), ("19", G, (490, 404, 29, 29)), ("10", G, (714, 434, 30, 29)),
    ("13", G, (632, 463, 30, 30)), ("4", G, (870, 463, 29, 29)), ("3", G, (870, 493, 29, 29)),
    ("2", G, (870, 523, 29, 29)), ("1", G, (870, 553, 29, 30)), ("21", G, (361, 555, 30, 29)),
    ("A", "point", (751, 439, 19, 19)),
]
ALL = ["helpende", "verzorgende", "verpleegkunde", "sociaal-werk", "maatschappelijke-zorg"]
ZORG = ["helpende", "verzorgende", "verpleegkunde"]
nurse_sessions = [
    ("forum", 2, "Maak kennis met ‘s Heeren Loo", "", "‘s Heeren Loo", ALL),
    ("forum", 3, "Kraamzorg: zit dit vak in jou?", "", "Naviva Kraamzorg", ZORG),
    ("kleine-zaal", 1, "Een kijkje in de wereld van een militair verpleegkundige", "", "Ministerie van Defensie", ZORG),
    ("kleine-zaal", 2, "Omgaan met Emotie & Agressie", "Jaro Wolff", "", ALL),
    ("kleine-zaal", 3, "Omgaan met Emotie & Agressie", "Jaro Wolff", "", ALL),
    ("kleine-zaal", 4, "Maak kennis met maatschappelijke zorg bij het leger", "", "Ministerie van Defensie",
     ["sociaal-werk", "maatschappelijke-zorg"]),
    ("constantijn", 1, "Reablement: zo help je een cliënt zelf de regie te houden", "", "Charim", ALL),
    ("constantijn", 2, "Ontdek hoe je beter contact maakt met je cliënt", "", "JP van den Bent", ALL),
    ("constantijn", 3, "Energiek in je werk: hoe houd je de zorg leuk?", "", "IZZ", ALL),
    ("constantijn", 4, "Maak kennis met ‘s Heeren Loo", "", "‘s Heeren Loo", ALL),
    ("de-taverne", 1, "Energiek in je werk: hoe houd je de zorg leuk?", "", "IZZ", ALL),
    ("de-taverne", 2, "Kraamzorg: zit dit vak in jou?", "", "Naviva Kraamzorg", ZORG),
    ("de-taverne", 3, "Van werkdruk naar werkgeluk", "", "Momo Medical", ALL),
]
nurse = build(
    {"id": "nurse-veenendaal", "name": "NURSE. Festival", "city": "Veenendaal", "date": "",
     "tagline": "De carrièredag voor studenten & starters in de zorg!",
     "intro": [
         "Wat leuk dat je aanwezig bent bij het NURSE. Festival! Samen met (zorg)organisaties uit alle uithoeken van de zorg, experts, ervaringsdeskundigen en natuurlijk met jou gaan we er een geweldige dag van maken.",
         "Een dag vol inspiratie en nuttige informatie, maar natuurlijk ook ontspanning en gezelligheid! Maak een praatje met organisaties, volg interessante sessies en leer uit eerste hand hoe het is om als zorgprofessional te werken in verschillende sectoren.",
         "Veel plezier met het ontdekken van de zorg!"],
     "theme": {"primary": "#00513b", "accent": "#e89090"}},
    tf_nurse, nurse_partners, nurse_letters, nurse_stands, nurse_sessions, ROUNDS5[:4],
    [ACT["workshops"], activity("fotomagneet", (688, 715), tf_nurse), activity("escaperoom", (531, 502), tf_nurse)],
    {"IZZ", "Ministerie van Defensie", "Momo Medical"},
    tags=[
        {"id": "helpende", "name": "Helpende Z&W", "color": "#3d9a6e"},
        {"id": "verzorgende", "name": "Verzorgende IG", "color": "#f7cc52"},
        {"id": "verpleegkunde", "name": "Verpleegkunde", "color": "#e89090"},
        {"id": "sociaal-werk", "name": "Sociaal Werk MBO & HBO", "color": "#65629b"},
        {"id": "maatschappelijke-zorg", "name": "Maatschappelijke Zorg", "color": "#d4622c"},
    ])

os.makedirs(OUT, exist_ok=True)
for ev in (vv, ghz, nurse):
    with open(os.path.join(OUT, ev["id"] + ".json"), "w") as f:
        json.dump(ev, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(ev["id"], len(ev["partners"]), "partners", len(ev["stands"]), "stands", len(ev["sessions"]), "sessions")
