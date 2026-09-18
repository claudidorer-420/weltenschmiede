# Lokale Bilderzeugung mit SDXL (RTX-GPU) für die Kartenwerkstatt.
# Texturen werden nahtlos gekachelt (circular padding), Objekte auf Magenta erzeugt und freigestellt.
#
# Aufruf (aus tools/sdxl):
#   .venv\Scripts\python.exe gen.py --jobs jobs.json --out out --steps 28
#
# jobs.json: [{ "id": "folterbank", "name": "Folterbank", "kind": "object"|"texture", "prompt": "..." }]
import argparse
import json
import os
import sys
import time
from pathlib import Path

import torch
from PIL import Image

TEX_PROMPT = (
    "seamless tileable top-down texture of {name}, photorealistic, even diffuse daylight, "
    "no shadows, no highlights, no objects, no text, flat orthographic top view, highly detailed, 8k material scan"
)
OBJ_PROMPT = (
    "top-down flat lay photograph of a single {name}, camera directly overhead at 90 degrees, bird's eye view, "
    "object lying flat, centered, whole object visible, even soft daylight, no cast shadow, "
    "isolated on a plain pure magenta #FF00FF background, photorealistic, sharp focus, highly detailed"
)
NEG = (
    "text, watermark, signature, people, person, hands, blurry, low quality, jpeg artifacts, "
    "perspective view, side view, front view, three-quarter view, eye level, isometric, tilted, horizon, "
    "background scenery, floor, wall, table, multiple objects, frame, border, drop shadow, vignette"
)


def set_tiling(pipe, on: bool):
    """Nahtlose Kacheln: alle Faltungen zyklisch umbrechen lassen."""
    targets = [pipe.unet, pipe.vae]
    for m in targets:
        for mod in m.modules():
            if isinstance(mod, torch.nn.Conv2d):
                mod.padding_mode = "circular" if on else "zeros"


def cutout_magenta(img: Image.Image, tol: int = 60) -> Image.Image:
    """Magenta/Pink-Hintergrund entfernen (auch gedämpfte Töne), Farbsaum abziehen, zuschneiden."""
    import numpy as np
    from PIL import ImageFilter

    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # Hintergrund: Rot UND Blau deutlich über Grün (Magenta-Familie), halbwegs bunt
    bg = (r > g + 22) & (b > g + 22) & (sat > 0.16) & (mx > 45)
    # nur was am Rand hängt, ist wirklich Hintergrund (Magenta im Objekt bleibt)
    h, w = bg.shape
    keep = np.zeros_like(bg)
    stack = [(0, x) for x in range(w) if bg[0, x]] + [(h - 1, x) for x in range(w) if bg[h - 1, x]]
    stack += [(y, 0) for y in range(h) if bg[y, 0]] + [(y, w - 1) for y in range(h) if bg[y, w - 1]]
    seen = np.zeros_like(bg)
    while stack:
        y, x = stack.pop()
        if y < 0 or x < 0 or y >= h or x >= w or seen[y, x] or not bg[y, x]:
            continue
        seen[y, x] = True
        keep[y, x] = True
        stack.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    alpha = np.where(keep, 0, 255).astype(np.uint8)
    # Farbsaum: an den Rändern das Magenta aus der Farbe rechnen
    fringe = (r > g + 12) & (b > g + 12) & (~keep)
    rr = np.where(fringe, np.minimum(r, g + 18), r)
    bb = np.where(fringe, np.minimum(b, g + 18), b)
    out = np.dstack([rr, g, bb, alpha]).astype(np.uint8)
    im = Image.fromarray(out, "RGBA")
    a = im.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    im.putalpha(a)
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", default="jobs.json")
    ap.add_argument("--out", default="out")
    ap.add_argument("--steps", type=int, default=28)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--model", default="stabilityai/stable-diffusion-xl-base-1.0")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    if args.limit:
        jobs = jobs[: args.limit]
    out = Path(args.out)
    (out / "texture").mkdir(parents=True, exist_ok=True)
    (out / "object").mkdir(parents=True, exist_ok=True)

    from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler

    print(f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'keine'}", flush=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        args.model, torch_dtype=torch.float16, variant="fp16", use_safetensors=True,
        cache_dir=os.environ.get("HF_HOME", "models"),
    )
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to("cuda")
    pipe.set_progress_bar_config(disable=True)

    t0 = time.time()
    for i, job in enumerate(jobs, 1):
        kind = job.get("kind", "object")
        name = job.get("name") or job["id"]
        prompt = job.get("prompt") or (TEX_PROMPT if kind == "texture" else OBJ_PROMPT).format(name=job.get("en", name))
        set_tiling(pipe, kind == "texture")
        gen = torch.Generator("cuda").manual_seed(job.get("seed", abs(hash(job["id"])) % (2**31)))
        img = pipe(
            prompt=prompt, negative_prompt=NEG, num_inference_steps=args.steps,
            guidance_scale=job.get("cfg", 6.5), width=args.size, height=args.size, generator=gen,
        ).images[0]
        if kind == "object":
            img = cutout_magenta(img)
            img.save(out / "object" / f"{job['id']}.png")
        else:
            img.save(out / "texture" / f"{job['id']}.png")
        per = (time.time() - t0) / i
        print(f"[{i}/{len(jobs)}] {kind}: {name} ({per:.1f}s/Bild)", flush=True)
    print(f"fertig in {time.time() - t0:.0f}s → {out.resolve()}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
