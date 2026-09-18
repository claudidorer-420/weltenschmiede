# Lokale Bilderzeugung mit SDXL (RTX-GPU) für die Kartenwerkstatt – Qualitätsfassung.
#
# Ablauf je Auftrag:
#   1. mehrere Kandidaten mit verschiedenen Startwerten (Basis + Verfeinerer, Ensemble)
#   2. jeder Kandidat wird bewertet: Bildaufbau, Schärfe und CLIP-Ähnlichkeit zur Draufsicht
#   3. der beste Kandidat bekommt einen Detaildurchgang in höherer Auflösung (img2img)
#   4. Objekte werden vom Magenta-Hintergrund freigestellt, Texturen bleiben nahtlos
#
# Aufruf (aus tools/sdxl):
#   .venv\Scripts\python.exe gen.py --jobs jobs.json --out out --steps 60 --cands 6 --hires 1536
#
# jobs.json: [{ "id": …, "name": …, "en": …, "look": "objektgenauer Satz", "kind": "object"|"texture" }]
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFilter

TEX_PROMPT = (
    "seamless tileable photographic material scan of {en}: {look}. "
    "real photograph taken straight down from above, flat even diffuse daylight, no shadows, no highlights, "
    "nothing lying on top, no text, orthographic top view, natural colours, extremely detailed, tack sharp, "
    "8k albedo map, uniform lighting across the whole frame"
)
OBJ_PROMPT = (
    "top-down flat lay photograph of one single {en}, camera directly overhead at 90 degrees, bird's eye view: {look}. "
    "the complete object centred with empty margin all around, isolated on a plain seamless white studio backdrop, "
    "orthographic top view, the camera looks straight down onto the object and no part is seen from the side, "
    "even soft studio daylight from above, no cast shadow, photorealistic, tack sharp focus, extremely detailed, "
    "game asset, product photography"
)
NEG_COMMON = (
    "text, watermark, signature, logo, caption, people, person, hands, blurry, out of focus, "
    "low quality, jpeg artifacts, noise, oversaturated, cartoon, illustration, painting, drawing, 3d render clay"
)
NEG_OBJ = NEG_COMMON + (
    ", perspective view, side view, front view, three-quarter view, eye level, isometric, tilted camera, horizon, "
    "background scenery, floor, wall, table surface, ground, grass, multiple objects, duplicates, collage, grid of items, "
    "frame, border, vignette, drop shadow, cropped, cut off, out of frame"
)
NEG_TEX = NEG_COMMON + (
    ", perspective, tilted, vignette, dark corners, uneven lighting, strong directional shadow, seam, visible tiling border, "
    "object, item, prop, character, plant pot, frame, border, depth of field, "
    "stylized, cartoon pattern, exaggerated colours, neon green, painted texture"
)


# ---------------------------------------------------------------- Hilfsmittel
def set_tiling(pipes, on: bool):
    """Nahtlose Kacheln: alle Faltungen zyklisch umbrechen lassen."""
    for p in pipes:
        if p is None:
            continue
        for part in (getattr(p, "unet", None), getattr(p, "vae", None)):
            if part is None:
                continue
            for mod in part.modules():
                if isinstance(mod, torch.nn.Conv2d):
                    mod.padding_mode = "circular" if on else "zeros"


_SESSION = None


def matting():
    """Freistell-Modell laden (bestes zuerst) – arbeitet auf beliebigem Hintergrund."""
    global _SESSION
    if _SESSION is None:
        from rembg import new_session
        for mid in ("birefnet-general", "isnet-general-use", "u2net"):
            try:
                _SESSION = new_session(mid)
                print(f"Freistellen mit {mid}", flush=True)
                break
            except Exception:
                continue
    return _SESSION


def cutout(img: Image.Image):
    """Objekt freistellen, Alpha säubern, zuschneiden. Gibt (Bild, Kennzahlen) zurück."""
    from rembg import remove
    im = remove(
        img.convert("RGB"), session=matting(), alpha_matting=True,
        alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=15,
        alpha_matting_erode_size=6,
    ).convert("RGBA")
    a = im.getchannel("A")
    a = a.point(lambda v: 0 if v < 24 else (255 if v > 232 else v))
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.5))
    im.putalpha(a)
    obj = np.asarray(a).astype(np.float32) / 255 > 0.4
    H, W = obj.shape
    bbox = im.getbbox()
    stats = {
        "flaeche": float(obj.mean()),
        "rand": float(obj[0].mean() + obj[-1].mean() + obj[:, 0].mean() + obj[:, -1].mean()) / 4,
        "bbox": bbox,
        "groesse": (W, H),
    }
    return (im.crop(bbox) if bbox else im), stats


def sharpness(img: Image.Image) -> float:
    """Varianz des Laplace-Filters – grobes Maß für Detailschärfe."""
    g = np.asarray(img.convert("L").resize((512, 512), Image.LANCZOS)).astype(np.float32)
    lap = (
        -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    )
    return float(lap.var())


def geom_score(kind: str, img: Image.Image, stats=None) -> float:
    """Bildaufbau: sitzt das Objekt frei und groß genug im Bild?"""
    if kind != "object" or not stats:
        return 1.0
    a = stats["flaeche"]
    s = 1.0
    s *= 1.0 if 0.14 <= a <= 0.72 else max(0.05, 1 - abs(a - 0.4) * 2.2)   # weder Fussel noch randlos
    s *= max(0.05, 1 - stats["rand"] * 6)                                   # nichts darf am Rand kleben
    if stats["bbox"]:
        x0, y0, x1, y1 = stats["bbox"]
        W, H = stats["groesse"]
        mitte = 1 - (abs((x0 + x1) / 2 - W / 2) / W + abs((y0 + y1) / 2 - H / 2) / H)
        s *= max(0.3, mitte)
        seiten = (x1 - x0) / max(1, y1 - y0)
        if seiten > 6 or seiten < 1 / 6:
            s *= 0.4                                                        # platt gequetscht = meist Seitenansicht
    return s


class Clip:
    """Bewertet, ob das Bild wirklich nach Draufsicht auf das gewünschte Ding aussieht."""

    def __init__(self):
        self.ok = False
        try:
            from transformers import CLIPModel, CLIPProcessor
            mid = "openai/clip-vit-large-patch14"
            cache = os.environ.get("HF_HOME", "models")
            self.model = CLIPModel.from_pretrained(mid, cache_dir=cache, torch_dtype=torch.float16).to("cuda").eval()
            self.proc = CLIPProcessor.from_pretrained(mid, cache_dir=cache)
            self.ok = True
        except Exception as e:  # ohne CLIP wird nur nach Aufbau und Schärfe bewertet
            print(f"CLIP nicht verfügbar ({e}) – Bewertung ohne Bildvergleich", flush=True)

    def score(self, img: Image.Image, en: str, kind: str) -> float:
        if not self.ok:
            return 0.5
        if kind == "object":
            txt = [
                f"a photo of a {en} seen from directly above, top down view, flat lay",
                f"a photo of a {en} seen from the side at eye level, perspective view",
                "an empty white studio background",
            ]
        else:
            txt = [
                f"a seamless top down texture of {en}, flat material surface",
                f"a photo of a {en} scene with objects and perspective",
                "a blurry flat gray surface",
            ]
        with torch.no_grad():
            inp = self.proc(text=txt, images=img, return_tensors="pt", padding=True).to("cuda")
            inp["pixel_values"] = inp["pixel_values"].half()
            logits = self.model(**inp).logits_per_image[0].float()
            p = torch.softmax(logits, 0)
        return float(p[0])


def rank(vals):
    """Rangnormierung auf 0…1 – robuster als absolute Zahlen zu mischen."""
    if len(vals) < 2:
        return [1.0] * len(vals)
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    out = [0.0] * len(vals)
    for pos, i in enumerate(order):
        out[i] = pos / (len(vals) - 1)
    return out


# ---------------------------------------------------------------------- Lauf
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", default="jobs.json")
    ap.add_argument("--out", default="out")
    ap.add_argument("--steps", type=int, default=60)
    ap.add_argument("--cands", type=int, default=8)
    ap.add_argument("--cands-tex", type=int, default=4)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--hires", type=int, default=1536, help="Detaildurchgang; 0 = aus")
    ap.add_argument("--strength", type=float, default=0.3)
    ap.add_argument("--model", default="stabilityai/stable-diffusion-xl-base-1.0")
    ap.add_argument("--refiner", default="stabilityai/stable-diffusion-xl-refiner-1.0")
    ap.add_argument("--no-refiner", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    pick = set(x.strip() for x in args.only.split(",") if x.strip())
    if pick:
        jobs = [j for j in jobs if j["id"] in pick]
    if args.limit:
        jobs = jobs[: args.limit]
    out = Path(args.out)
    for sub in ("texture", "object", "kandidaten"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    from diffusers import (
        StableDiffusionXLPipeline,
        StableDiffusionXLImg2ImgPipeline,
        EulerAncestralDiscreteScheduler,
    )

    print(f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'keine'}", flush=True)
    cache = os.environ.get("HF_HOME", "models")
    base = StableDiffusionXLPipeline.from_pretrained(
        args.model, torch_dtype=torch.float16, variant="fp16", use_safetensors=True, cache_dir=cache,
    )
    base.scheduler = EulerAncestralDiscreteScheduler.from_config(base.scheduler.config)
    base = base.to("cuda")
    base.set_progress_bar_config(disable=True)

    ref = None
    if not args.no_refiner:
        try:
            ref = StableDiffusionXLImg2ImgPipeline.from_pretrained(
                args.refiner, torch_dtype=torch.float16, variant="fp16", use_safetensors=True, cache_dir=cache,
                text_encoder_2=base.text_encoder_2, vae=base.vae,
            ).to("cuda")
            ref.set_progress_bar_config(disable=True)
            print("Verfeinerer geladen (Ensemble aus Basis + Refiner)", flush=True)
        except Exception as e:
            print(f"Verfeinerer nicht verfügbar ({e}) – nur Basismodell", flush=True)
    try:
        base.vae.enable_slicing()
    except Exception:
        pass
    clip = Clip()

    t0 = time.time()
    for n, job in enumerate(jobs, 1):
        kind = job.get("kind", "object")
        name = job.get("name") or job["id"]
        en = job.get("en", name)
        look = job.get("look", "")
        tmpl = TEX_PROMPT if kind == "texture" else OBJ_PROMPT
        prompt = job.get("prompt") or tmpl.format(en=en, look=look)
        neg = NEG_TEX if kind == "texture" else NEG_OBJ
        cfg = job.get("cfg", 5.5 if kind == "texture" else 7.0)
        anz = args.cands_tex if kind == "texture" else args.cands
        set_tiling([base, ref], kind == "texture")

        roh, cuts, punkte = [], [], []
        for c in range(anz):
            seed = job.get("seed", abs(hash(job["id"])) % (2 ** 31)) + c * 7919
            gen = torch.Generator("cuda").manual_seed(seed)
            if ref is not None:
                lat = base(
                    prompt=prompt, negative_prompt=neg, num_inference_steps=args.steps,
                    guidance_scale=cfg, width=args.size, height=args.size, generator=gen,
                    denoising_end=0.8, output_type="latent",
                ).images
                img = ref(
                    prompt=prompt, negative_prompt=neg, num_inference_steps=args.steps,
                    guidance_scale=cfg, image=lat, denoising_start=0.8, generator=gen,
                ).images[0]
            else:
                img = base(
                    prompt=prompt, negative_prompt=neg, num_inference_steps=args.steps,
                    guidance_scale=cfg, width=args.size, height=args.size, generator=gen,
                ).images[0]
            roh.append(img)
            if kind == "object":
                cut, st = cutout(img)
                cuts.append((cut, st))
                punkte.append((clip.score(cut.convert("RGB"), en, kind), sharpness(cut), geom_score(kind, img, st)))
            else:
                cuts.append((img, None))
                punkte.append((clip.score(img, en, kind), sharpness(img), 1.0))
            img.save(out / "kandidaten" / f"{job['id']}_{c}.png")

        rc = rank([p[0] for p in punkte])
        rs = rank([p[1] for p in punkte])
        rg = rank([p[2] for p in punkte])
        w = (0.5, 0.5, 0.0) if kind == "texture" else (0.6, 0.15, 0.25)
        gesamt = [w[0] * rc[i] + w[1] * rs[i] + w[2] * rg[i] for i in range(len(punkte))]
        beste = max(range(len(gesamt)), key=lambda i: gesamt[i])

        img = roh[beste]
        if args.hires:
            zwischen = img.resize((args.hires, args.hires), Image.LANCZOS)
            pipe_hi = ref if ref is not None else None
            if pipe_hi is None:
                from diffusers import StableDiffusionXLImg2ImgPipeline as I2I
                pipe_hi = I2I(**base.components).to("cuda")
                pipe_hi.set_progress_bar_config(disable=True)
                set_tiling([pipe_hi], kind == "texture")
            gen = torch.Generator("cuda").manual_seed(4242)
            img = pipe_hi(
                prompt=prompt, negative_prompt=neg, image=zwischen, strength=args.strength,
                num_inference_steps=max(30, args.steps // 2), guidance_scale=cfg, generator=gen,
            ).images[0]

        if kind == "object":
            fertig, st = cutout(img)
            fertig.save(out / "object" / f"{job['id']}.png")
            info = f"{fertig.width}×{fertig.height}"
        else:
            img.save(out / "texture" / f"{job['id']}.png")
            info = f"{img.width}×{img.height}"
        per = (time.time() - t0) / n
        print(
            f"[{n}/{len(jobs)}] {kind}: {name} → Kandidat {beste + 1}/{anz} "
            f"(CLIP {punkte[beste][0]:.2f}, Aufbau {punkte[beste][2]:.2f}) {info} · {per:.0f}s/Auftrag",
            flush=True,
        )
        torch.cuda.empty_cache()

    print(f"fertig in {time.time() - t0:.0f}s → {out.resolve()}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
