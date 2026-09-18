# Übernimmt freigegebene SDXL-Ergebnisse in die Kartenbibliothek:
# Texturen → assets/tex, Objekte → assets/stamps (jeweils WebP + Vorschau),
# dazu tools/sdxl/gen-assets.json, das build-mapassets.mjs mit einliest.
#
# Aufruf (aus tools/sdxl):  .venv\Scripts\python.exe import.py [--only id1,id2]
import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out"
PPC = 255  # Pixel pro Feld (1,5 m bei 170 px/m) – wie im Stempel-Studio
MAXPX = 1024
THUMB = 96


def save_webp(img: Image.Image, path: Path, quality: int = 86):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", default="jobs.json")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    pick = set(x.strip() for x in args.only.split(",") if x.strip())

    entries = {"stamps": {}, "textures": {}}
    old = Path("gen-assets.json")
    if old.exists():
        entries = json.loads(old.read_text(encoding="utf-8"))

    for job in jobs:
        jid = job["id"]
        if pick and jid not in pick:
            continue
        kind = job.get("kind", "object")
        src = OUT / kind / f"{jid}.png"
        if not src.exists():
            print(f"fehlt: {src.name}")
            continue
        img = Image.open(src)
        if kind == "texture":
            img = img.convert("RGB").resize((512, 512), Image.LANCZOS)
            save_webp(img, ROOT / "assets" / "tex" / f"{jid}.webp", 84)
            save_webp(img.resize((THUMB, THUMB), Image.LANCZOS), ROOT / "assets" / "tex" / "t" / f"{jid}.webp", 76)
            entries["textures"][jid] = {"id": jid, "name": job.get("name", jid), "cat": job.get("cat", "gelaende"), "m": job.get("m", 3)}
            print(f"Textur: {job.get('name', jid)}")
        else:
            img = img.convert("RGBA")
            bbox = img.getbbox()
            if bbox:
                img = img.crop(bbox)
            cells_w = float(job.get("w", 1))
            cells_h = float(job.get("h", cells_w))
            target = min(MAXPX, int(max(cells_w, cells_h) * PPC))
            k = target / max(img.width, img.height)
            img = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)
            save_webp(img, ROOT / "assets" / "stamps" / f"{jid}.webp")
            th = img.copy()
            th.thumbnail((THUMB, THUMB), Image.LANCZOS)
            save_webp(th, ROOT / "assets" / "stamps" / "t" / f"{jid}.webp", 76)
            e = {
                "id": jid, "src": jid, "name": job.get("name", jid), "cat": job.get("cat", "dungeon"),
                "w": round(img.width / PPC, 3), "h": round(img.height / PPC, 3),
            }
            for k2 in ("block", "rough", "layer", "tags"):
                if job.get(k2):
                    e[k2] = job[k2]
            entries["stamps"][jid] = e
            print(f"Objekt: {job.get('name', jid)} ({e['w']}×{e['h']} Felder)")

    Path("gen-assets.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(entries['stamps'])} Stempel, {len(entries['textures'])} Texturen in tools/sdxl/gen-assets.json")
    print("Danach: node tools/build-mapassets.mjs")


if __name__ == "__main__":
    main()
