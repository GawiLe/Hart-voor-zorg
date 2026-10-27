# Hart voor Zorg · interactief programmaboekje

Een digitale versie van het programmaboekje voor de festivals van Hart voor Zorg
(V&V Festival, GHZ & GGZ Festival en NURSE. Festival). Eén app, met per festival een databestand.

Bezoekers krijgen:

- **Programma** als blokkenschema (zalen × tijd, zoals in het boekje) of als lijst per ronde, met zoeken
  en filteren op doelgroep (bijv. opleiding bij NURSE.).
- **Plattegrond** om in te zoomen en te verslepen, met aanklikbare stands, activiteiten en voorzieningen.
- **Looproutes** van de ingang (of een andere plek/stand) naar een stand, activiteit of zaal.
- **Standhouders**: zoeken, hoofdpartners bovenaan, per standhouder de workshops die ze geven.
- **Mijn dag**: workshops met een ster en stands met een hartje bewaren, afvinken wat je bezocht hebt,
  waarschuwing bij overlappende keuzes en export naar de agenda (.ics).
- **Nu bezig**: op de festivaldag een balk met de lopende of volgende ronde, en een rode lijn in het schema.

Alles werkt zonder installatie of server-side code: het zijn statische bestanden.

## Bestanden

```
index.html               Overzicht van de festivals
event.html?e=<id>        Het programmaboekje van één festival
beheer.html              Invullen en controleren van een festival
data/events/index.json   Welke festivals op de overzichtspagina staan
data/events/<id>.json    Inhoud per festival (programma, standhouders, stands op de kaart)
data/venues/<id>.json    De locatie: zalen, muren, ingangen, toiletten, looppaden
assets/                  Code en opmaak
```

De locatie (`venues/veenendaal.json`) teken je één keer. Per festival verandert alleen wat er in
`events/<id>.json` staat: workshops, standhouders en waar hun stands staan.

## Een nieuw festival invullen

1. Open `beheer.html` en kies **+ Nieuw festival…** (de standindeling van het gekozen festival wordt als
   startpunt overgenomen), of kies een bestaand festival om het aan te passen.
2. **Algemeen**: naam, datum, welkomsttekst, workshoprondes, zalen, doelgroep-labels en activiteiten.
3. **Standhouders**: plak de genummerde lijst uit InDesign/Excel in één keer (`12  Nedap`), en vul
   eventueel website, omschrijving en logo aan.
4. **Programma**: klik in het raster op een vak en vul de workshop in. Met *Herhaal in volgende ronde*
   kopieer je een workshop die twee keer gegeven wordt.
5. **Plattegrond**: sleep de stands naar hun plek, wijzig nummers en maten. Rechts staat welke
   standhouders nog geen plek hebben.
6. **Controle**: lijst met fouten en aandachtspunten (dubbele boekingen, ontbrekende stands, geen datum…).
7. **Bekijk voorbeeld** toont het boekje zoals bezoekers het zien, met jouw concept.
8. **Download JSON** en zet het bestand in `data/events/`. Voor een nieuw festival voeg je het ook toe
   aan `data/events/index.json`.

Concepten worden automatisch in de browser bewaard (localStorage) tot je ze downloadt.

## Lokaal bekijken

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Direct dubbelklikken op `index.html` werkt niet, omdat de browser dan geen databestanden mag laden.)

## Publiceren

Elke statische hosting werkt, bijvoorbeeld GitHub Pages (Settings → Pages → branch kiezen), Netlify of
de eigen webserver. Tip: maak per stand een QR-code naar `event.html?e=<id>#partners/partner/<partner-id>`
en op de tafels/schermen een QR-code naar het programma.

## Gegevensmodel (kort)

| Veld | Uitleg |
|---|---|
| `rounds[]` | `name`, `start`, `end` (HH:MM) |
| `rooms[]` | `id`, `name`, `location`; de plek op de kaart staat in de venue onder `rooms` |
| `sessions[]` | `room`, `start`, `end`, `title`, `speaker`, `partner` (id van een standhouder) of `organisation`, `description`, `tags[]` |
| `partners[]` | `id`, `name`, `stand` (nummer of letter), `main` (hoofdpartner), `website`, `description`, `logo` |
| `stands[]` | Plek op de kaart: `label` (= standnummer), `kind` (`large`, `small`, `point`), `x`, `y`, `w`, `h`. Een nummer mag vaker voorkomen (bijv. Defensie met stand én plein). |
| `activities[]` | `name`, `icon`, `text`, optioneel `x`/`y` op de kaart |
| `tags[]` | Doelgroep-labels met kleur, bijv. de opleidingen bij NURSE. |

Kaartcoördinaten zijn in dezelfde eenheden als de plattegrond uit het drukwerk (150 dpi), zodat een
nieuwe indeling uit InDesign makkelijk over te nemen is.
