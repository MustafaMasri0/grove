"""Imports the Charmed Icons file icon theme (MIT, Littensy) from an unpacked VSIX.

Usage: python scripts/import-charmed-icons.py <unpacked-vsix>/extension

Writes src/assets/charmed/{dark,light}/*.svg (the "Charmed" and "Charmed Light"
variants) and src/assets/charmed/theme.json: the name → icon tables, with icon
ids that are the SVG file names. Get the VSIX from
https://marketplace.visualstudio.com/items?itemName=littensy.charmed-icons
(it is a zip; the generated themes are in extension/dist/themes).
"""

import json
import pathlib
import shutil
import sys

KEYS = ["file", "folder", "folderExpanded", "fileExtensions", "fileNames", "languageIds", "folderNames", "folderNamesExpanded"]


def main(ext_dir: str) -> None:
    themes = pathlib.Path(ext_dir) / "dist" / "themes"
    out = pathlib.Path(__file__).resolve().parent.parent / "src" / "assets" / "charmed"
    base = json.loads((themes / "base" / "theme.json").read_text(encoding="utf-8"))
    light = json.loads((themes / "light" / "theme.json").read_text(encoding="utf-8"))
    if {k: base[k] for k in KEYS} != {k: light[k] for k in KEYS}:
        sys.exit("the light variant maps names differently; this importer assumes it only recolours")

    # Icon id → SVG file name (without .svg).
    defs = {k: pathlib.Path(v["iconPath"]).stem for k, v in base["iconDefinitions"].items()}
    used = set()

    def ref(icon_id: str) -> str:
        used.add(defs[icon_id])
        return defs[icon_id]

    table = {}
    for k in KEYS:
        v = base[k]
        table[k] = ref(v) if isinstance(v, str) else {name.lower(): ref(i) for name, i in sorted(v.items())}

    if out.exists():
        shutil.rmtree(out)
    for variant, src in (("dark", "base"), ("light", "light")):
        (out / variant).mkdir(parents=True)
        for name in sorted(used):
            shutil.copyfile(themes / src / "icons" / f"{name}.svg", out / variant / f"{name}.svg")
    (out / "theme.json").write_text(json.dumps(table, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(used)} icons x 2 variants, {sum(len(v) for v in table.values() if isinstance(v, dict))} mappings -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
