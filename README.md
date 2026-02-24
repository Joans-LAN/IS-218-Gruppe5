# IS-218-Gruppe5
IS-218 gruppeinnlevering

# Prosjektnavn 
Bufferzonen
# TLDR;
Raskt identifisere hvor flomsoner befinner seg og gjennomføre en analyse av hvor mange bygninger som er registrert innenfor en gitt flomsone.

# Datakatalog
| Datasett | Kilde | Format | Bearbeiding |
|---|---|---|---|
| Matrikkel bygningspunkt | GeoNorge WFS (Kartverket) | WFS (GML/XML i respons) | Hentes direkte ved behov via WFS-spørring (bbox rundt valgt flomsone), parses i klient og brukes i punkt-i-polygon-analyse |
| Flomsoner (Agder) | GeoNorge nedlastingstjeneste | FGDB (nedlastet), deretter GeoJSON | Lastet ned som FGDB, konvertert/reprojisert til GeoJSON (EPSG:4326) for visning og analyse i MapLibre |

# Teknisk stack
- MapLibre GL JS `4.7.1`
- Proj4js `2.11.0`
- Turf.js `6.5.0`
- HTML5 / CSS3 / JavaScript (ES6)
- GDAL/OGR (for dataforbehandling: FGDB -> GeoJSON)

![Arkitektur](assets/ar.png)

[Demo video](./assets/demo_video.webm)
press view raw after clicking the link to download and view the video.

# Refleksjon
- Parsing av XML/GML fra WFS-spørringen i nettleseren er praktisk, men en backend-løsning (proxy) ville vært bedre for ytelse og stabilitet.
- Kan legge til funksjonalitet for å sjekke flere områder samtidig.
- Punkt-i-polygon i nettleseren fungerer bra for moderate datamengder, men kan bli tregt ved svært store WFS-kall.
- Kan forbedre brukervennligheten.