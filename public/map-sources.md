# Offline map data

The application reads only bundled files at runtime. It does not request map
tiles, a geocoding service or GPS. Location queries use the public profile city;
private profile locations are never loaded by the map.

## Land outlines

Natural Earth, 1:50 million land polygons, public domain:
https://www.naturalearthdata.com/about/terms-of-use/
Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_land.geojson

## City reference points and names

GeoNames cities15000, countryInfo and admin1CodesASCII, downloaded 2026-10-05:
https://download.geonames.org/export/dump/
License: Creative Commons Attribution 4.0 International
https://creativecommons.org/licenses/by/4.0/

Adaptations: selected name aliases, compact records, rounded WGS84 city reference
points and Web Mercator projection of land rings. The map shows approximate
city-level geography, not streets, administrative borders, navigation or actual
residence. Data accuracy and completeness are not guaranteed; unrecognized
places need a more explicit city name or manually supplied coordinates.

The original data and derived bundles remain credited in the map panel and this
file. Country labels in the dataset are source metadata, not a statement about
sovereignty or boundaries. Only land outlines, not political boundaries, are drawn.

Regeneration: download the four input files into a temporary directory and run
`python scripts/build_offline_map.py <input-directory>`. The builder never reads
personal records. City name disambiguation is saved only in browser localStorage;
manual coordinates are part of the public profile and public export.
