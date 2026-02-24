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
- Frontend: HTML, CSS, JavaScript
- Kartbibliotek: MapLibre GL JS
- Geospatial analyse i nettleser: Turf.js (point-in-polygon)
- Koordinatsystem-konvertering: Proj4js (EPSG:25833 til EPSG:4326)

![Arkitektur](assets/ar.png)

[Demo video](assets/demo.mp4)