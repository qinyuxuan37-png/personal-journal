"""Convert downloaded public datasets to a bundled, network-free map asset.

Inputs: Natural Earth ne_50m_land.geojson; GeoNames cities15000.zip,
countryInfo.txt and admin1CodesASCII.txt. No personal data is read here.
"""
import argparse
import json
import math
import re
import zipfile
from pathlib import Path


def project(lon, lat):
    lat = max(-85.05112878, min(85.05112878, lat))
    return [(lon + 180) / 360 * 1000,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 1000]


def build(source):
    countries = {}
    for line in (source / "countryInfo.txt").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            fields = line.split("\t")
            countries[fields[0]] = fields[4]
    regions = {}
    for line in (source / "admin1CodesASCII.txt").read_text(encoding="utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) >= 3:
            regions[fields[0]] = fields[1]
    cities = []
    with zipfile.ZipFile(source / "cities15000.zip") as archive:
        lines = archive.read("cities15000.txt").decode("utf-8").splitlines()
    for line in lines:
        f = line.split("\t")
        aliases = list(dict.fromkeys([f[1], f[2], *f[3].split(",")]))
        aliases = [name for name in aliases if name and len(name) <= 80]
        # Prefer the Chinese name in China, but retain all supplied aliases.
        name = f[1]
        if f[8] == "CN":
            name = next((a for a in aliases if any("\u4e00" <= c <= "\u9fff" for c in a) and not a.endswith("市")), name)
        chinese = [a for a in aliases if any("\u4e00" <= c <= "\u9fff" for c in a)]
        latin = [a for a in aliases if re.fullmatch(r"[A-Za-z][A-Za-z .'’-]{2,79}", a)]
        aliases = list(dict.fromkeys([f[1], f[2], name, *chinese[:8], *latin[:10]]))
        cities.append([f[0], name, f[8], countries.get(f[8], f[8]),
                       regions.get(f[8] + "." + f[10], ""),
                       round(float(f[5]), 5), round(float(f[4]), 5), aliases,
                       list(dict.fromkeys([f[1], f[2]]))])
    geometry = json.loads((source / "ne_50m_land.geojson").read_text(encoding="utf-8"))
    paths = []
    for feature in geometry["features"]:
        g = feature["geometry"]
        polygons = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for polygon in polygons:
            for ring in polygon:
                points = [project(*p[:2]) for p in ring]
                paths.append("M" + "L".join(f"{x:.3f},{y:.3f}" for x, y in points) + "Z")
    data = {"version": 1, "land": "".join(paths), "cities": cities}
    output = Path(__file__).resolve().parents[1] / "public" / "offline-map-data.js"
    output.write_text("// Natural Earth (public domain); GeoNames (CC BY 4.0). See map-sources.md.\n"
                      + "window.OfflineGeoData=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Bundled {len(cities)} cities, {len(paths)} land rings, {output.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    build(parser.parse_args().source)
