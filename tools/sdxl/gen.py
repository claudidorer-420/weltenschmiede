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
    "a single {name} for a tabletop battlemap, strict orthographic top-down view seen from directly above, "
    "centered, whole object visible, flat neutral daylight, no cast shadow, isolated on plain magenta background, "
    "photorealistic, sharp focus, highly detailed"
)
NEG = (
    "text, watermark, signature, people, person, hands, blurry, low quality, jpeg artifacts, "
    "perspective, side view, isometric, tilted, multiple objects, frame, border, drop shadow"
)


def set_tiling(pipe, on: bool):
    """Nahtlose Kacheln: alle Faltungen zyklisch umbrechen lassen."""
    targets = [pipe.unet, pipe.vae]
    for m in targets:
        for mod in m.modules():
            if isinstance(mod, torch.nn.Conv2d):
                mod.padding_mode = "circular" if on else "zeros"


def cutout_magenta(img: Image.Image, tol: int = 60) -> Image.Image:
    """Magenta-Hintergrund entfernen, Rand beschneiden."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > 150 and b > 150 and g < 110 and abs(r - b) < 90:
                px[x, y] = (r, g, b, 0)
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


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
