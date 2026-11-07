#!/usr/bin/env python3
"""Draw the architecture without image-generation APIs or network access.

Usage: python3 infra/scripts/generate-architecture.py
SVG uses only Python's standard library; PNG additionally uses Pillow.
Official SVG artwork and PNG caches live in docs/architecture/icons.
Vendor sources and SHA-256 digests are recorded in icons/sources.json.
Generating either format is offline; ImageMagick is not a runtime dependency.
Edit the layout below, or pass --config settings.json to override CONFIG values.
The GitHub Actions voice pipeline is planned, not implemented by this script.
"""
from __future__ import annotations

import argparse
import base64
from html import escape
import json
import math
from pathlib import Path

CONFIG = {
    "web_region": "Asia Pacific (Singapore)",
    "web_region_code": "ap-southeast-1",
    "backend_region": "Asia Pacific (Jakarta)",
    "backend_region_code": "ap-southeast-3",
    "vpc": "10.40.0.0/16",
    "voice_subnet": "10.40.1.0/24",
    "db_subnet_a": "10.40.10.0/24",
    "db_subnet_b": "10.40.11.0/24",
    "instance": "t3.medium",
    "db_instance": "db.t4g.micro",
    "disk_gb": 40,
    "repository": "VennethN/jude",
    "voice_pipeline_status": "planned",
}
INK = "#172033"
MUTED = "#586579"
ORANGE = "#ed7900"
PURPLE = "#8050ce"
PINK = "#c92d69"
TEAL = "#009b8c"
BLUE = "#2874d8"
GREEN = "#469f25"
ASSETS = Path(__file__).resolve().parents[2] / "docs/architecture/icons"
ICON_BY_TITLE = {
    "AWS Amplify Hosting": "amplify", "CloudWatch Logs": "cloudwatch",
    "OpenAI API": "openai", "Internet Gateway": "internet-gateway",
    "Amazon ECR": "ecr", "Parameter Store": "parameter-store",
    "Secrets Manager": "secrets-manager", "Session Manager": "session-manager",
    "Users": "users", "GitHub": "github", "Actions": "actions", "Admin": "admin",
}


class Drawing:
    """One set of primitives, rendered to both scalable SVG and a 2x PNG."""

    def __init__(self, width=2000, height=1100, png=True):
        self.width, self.height, self.scale = width, height, 2
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                    '<title id="title">AWS architecture: Amplify web and standalone voice</title>',
                    '<desc id="desc">Singapore Amplify calls OpenAI, Jakarta EC2 voice and public Single-AZ RDS. GitHub Actions voice deployment is planned.</desc>',
                    '<rect width="100%" height="100%" fill="white"/>']
        self.image = self.pen = None
        self.font_cache = {}
        if png:
            try:
                from PIL import Image, ImageDraw, ImageFont
            except ImportError as error:
                raise SystemExit("PNG needs Pillow: python3 -m pip install Pillow; or use --svg-only") from error
            self.font_module = ImageFont
            self.image = Image.new("RGB", (width * self.scale, height * self.scale), "white")
            self.pen = ImageDraw.Draw(self.image)

    def font(self, size, bold=False):
        key = (size, bold)
        if key not in self.font_cache:
            filename = "Arial Bold.ttf" if bold else "Arial.ttf"
            linux = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
            candidates = [Path("/System/Library/Fonts/Supplemental") / filename,
                          Path("/usr/share/fonts/truetype/dejavu") / linux]
            available = next((p for p in candidates if p.exists()), None)
            self.font_cache[key] = (self.font_module.truetype(str(available), round(size * self.scale))
                                    if available else self.font_module.load_default(size=round(size * self.scale)))
        return self.font_cache[key]

    def rect(self, x, y, w, h, fill="white", stroke="#cbd3df", radius=10, width=1.5):
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')
        if self.pen:
            s = self.scale
            self.pen.rounded_rectangle((x*s, y*s, (x+w)*s, (y+h)*s), radius=radius*s,
                                      fill=None if fill == "none" else fill,
                                      outline=None if stroke == "none" else stroke,
                                      width=max(1, round(width*s)))

    def text(self, x, y, value, size=19, color=INK, bold=False, align="left"):
        anchor = {"left": "start", "center": "middle", "right": "end"}[align]
        self.svg.append(f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" fill="{color}" text-anchor="{anchor}" dominant-baseline="central">{escape(str(value))}</text>')
        if self.pen:
            self.pen.text((x*self.scale, y*self.scale), str(value), font=self.font(size, bold), fill=color,
                          anchor={"left": "lm", "center": "mm", "right": "rm"}[align])

    def line(self, points, color=INK, width=2, dashed=False, arrow=False):
        coords = " ".join(f"{x},{y}" for x, y in points)
        dash = ' stroke-dasharray="8 6"' if dashed else ""
        self.svg.append(f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{dash}/>')
        if self.pen:
            s = self.scale
            if not dashed:
                self.pen.line([(x*s, y*s) for x, y in points], fill=color, width=round(width*s), joint="curve")
            else:
                for (x1, y1), (x2, y2) in zip(points, points[1:]):
                    length = math.hypot(x2-x1, y2-y1)
                    if not length:
                        continue
                    for start in range(0, math.ceil(length), 14):
                        end = min(start+8, length)
                        segment = [(s*(x1+(x2-x1)*t/length), s*(y1+(y2-y1)*t/length)) for t in (start, end)]
                        self.pen.line(segment, fill=color, width=round(width*s))
        if arrow:
            x, y = points[-1]
            before = next(p for p in reversed(points[:-1]) if p != (x, y))
            angle = math.atan2(y-before[1], x-before[0])
            triangle = [(x, y)] + [(x-12*math.cos(angle)+side*5*math.sin(angle),
                                    y-12*math.sin(angle)-side*5*math.cos(angle)) for side in [-1, 1]]
            self.svg.append(f'<polygon points="{" ".join(f"{a},{b}" for a,b in triangle)}" fill="{color}"/>')
            if self.pen:
                self.pen.polygon([(a*self.scale, b*self.scale) for a,b in triangle], fill=color)

    def asset(self, x, y, w, h, key):
        """Embed original vendor SVG; use the checked-in raster cache for PNG."""
        source = ASSETS / f"{key}.svg"
        if not source.is_file():
            raise SystemExit(f"Missing official icon: {source}")
        encoded = base64.b64encode(source.read_bytes()).decode("ascii")
        self.svg.append(f'<image x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid meet" href="data:image/svg+xml;base64,{encoded}"/>')
        if self.pen:
            from PIL import Image, ImageOps
            cached = source.with_suffix(".png")
            if not cached.is_file():
                raise SystemExit(f"Missing raster cache: {cached}")
            with Image.open(cached) as original:
                icon = ImageOps.contain(original.convert("RGBA"), (round(w*self.scale), round(h*self.scale)), Image.Resampling.LANCZOS)
            position = (round((x+w/2)*self.scale-icon.width/2), round((y+h/2)*self.scale-icon.height/2))
            self.image.paste(icon, position, icon)

    def icon(self, x, y, color, kind="service", size=48):
        # Never redraw or recolor vendor artwork. Reverse marks retain their
        # original white paths and are placed on appropriate solid carriers.
        key = {"compute": "ec2", "database": "rds", "logs": "cloudwatch", "workflow": "actions"}.get(kind, kind)
        if key in {"openai", "fastapi"}:
            self.rect(x, y, size, size, "#000000" if key == "openai" else "#009688", "none", radius=6)
            self.asset(x+4, y+4, size-8, size-8, key)
        else:
            self.asset(x, y, size, size, key)

    def card(self, x, y, w, h, title, color, detail=None, kind="service", fill="white", size=21):
        self.rect(x,y,w,h,fill,color)
        compact = not detail and h <= 100
        self.icon(x+16,y+(h-48)/2 if compact else y+16,color,ICON_BY_TITLE.get(title, kind))
        self.text(x+80,y+h/2 if compact else y+38,title,size,bold=True)
        if detail:
            for row, value in enumerate(detail):
                self.text(x+80,y+72+row*25,value,18,color=MUTED)

    def group(self, x, y, w, h, title, code=None, color=PURPLE, fill="#fbf9ff"):
        self.rect(x,y,w,h,fill,color,12)
        self.rect(x+1,y+1,w-2,72 if code else 50,"#f0eafa" if color==PURPLE else "#eef8ed", "none",11)
        kind = "region" if code else ("vpc" if title.startswith("Amazon VPC") else "subnet")
        self.icon(x+14,y+14,color,kind,size=30)
        self.text(x+58,y+25,title,23,bold=True)
        if code:
            self.text(x+58,y+53,code,20,color=MUTED)

    def write(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "aws-architecture-script.svg"
        target.write_text("\n".join(self.svg+["</svg>"]), encoding="utf-8")
        print(target)
        if self.image:
            target = directory / "aws-architecture-script.png"
            self.image.save(target)
            print(target)


def generate(config, output, png):
    """32px outer padding, 24px component padding, dedicated connector lanes."""
    c = config
    d = Drawing(width=2240, height=1160, png=png)

    # Centralized bounds: x, y, width, height. Regions fit their contents rather
    # than stretching Singapore to the height of Jakarta's networking stack.
    boxes = {
        "account": (256, 56, 1740, 1056),
        "singapore": (288, 190, 420, 532),
        "jakarta": (760, 190, 1204, 858),
        "vpc": (792, 300, 1140, 464),
        "voice_subnet": (824, 380, 520, 360),
        "db_subnets": (1400, 380, 500, 360),
        "amplify": (320, 330, 356, 128),
        "iam": (320, 490, 356, 80),
        "web_logs": (320, 602, 356, 88),
        "openai": (2028, 190, 180, 96),
        "gateway": (1548, 276, 352, 64),
        "ec2": (848, 450, 472, 176),
        "caddy": (872, 532, 176, 64),
        "fastapi": (1096, 532, 200, 64),
        "ebs": (848, 650, 472, 56),
        "rds": (1424, 458, 452, 112),
        "db_public": (1424, 666, 452, 50),
        "users": (32, 350, 168, 96),
        "github": (32, 578, 168, 112),
        "actions": (32, 792, 168, 112),
        "admin": (32, 964, 168, 88),
    }

    def card(name, title, color, **kwargs):
        d.card(*boxes[name], title, color, **kwargs)

    def label(x, y, value, color=INK, size=16):
        # White backplates keep labels legible at a boundary or line crossing.
        width = len(value) * size * 0.55 + 20
        d.rect(x-width/2, y-size/2-5, width, size+10, "white", "none", 5)
        d.text(x, y, value, size, color=color, bold=True, align="center")

    d.rect(*boxes["account"], "white", "#647084", 16, 1.5)
    d.icon(280, 80, INK, "aws-cloud", size=40)
    d.text(336, 101, "AWS Cloud", 27, bold=True)
    d.group(*boxes["singapore"], c["web_region"], c["web_region_code"])
    d.group(*boxes["jakarta"], c["backend_region"], c["backend_region_code"])
    d.group(*boxes["vpc"], f'Amazon VPC · {c["vpc"]}', color=GREEN, fill="#fbfefb")
    d.group(*boxes["voice_subnet"], f'Voice subnet · {c["voice_subnet"]}', color=GREEN, fill="#f5fbf4")
    d.group(*boxes["db_subnets"], "RDS subnet group · 2 AZs", color=BLUE, fill="#f6faff")

    card("amplify", "AWS Amplify Hosting", PINK, detail=["SvelteKit · SSR"], kind="amplify", fill="#fff8fa", size=22)
    card("iam", "SSR compute role", PINK, kind="iam-role", size=20)
    card("web_logs", "CloudWatch Logs", PINK, kind="logs", size=20)
    card("openai", "OpenAI API", TEAL, size=17)
    card("gateway", "Internet Gateway", PURPLE, size=20)
    card("ec2", f'EC2 · {c["instance"]}', ORANGE, kind="compute", fill="#fffaf4", size=22)
    d.asset(1190, 470, 28, 24, "docker")
    d.text(1227, 482, "Docker", 16, color=BLUE, bold=True)
    d.rect(*boxes["caddy"], "#f4f9ff", "#91b3de", 8)
    d.asset(888, 549, 94, 30, "caddy")
    d.text(1016, 564, ":443", 17, bold=True, align="center")
    d.rect(*boxes["fastapi"], "#f4f9ff", "#91b3de", 8)
    d.icon(1110, 547, TEAL, "fastapi", size=28)
    d.text(1211, 553, "FastAPI · pyannote", 15, bold=True, align="center")
    d.text(1211, 578, ":8000", 17, color=MUTED, align="center")
    d.line([(1048, 564), (1096, 564)], width=1.8, arrow=True)
    d.rect(*boxes["ebs"], "white", "#a9c99b", 8)
    d.icon(864, 662, GREEN, "ebs", size=32)
    d.text(916, 678, f'EBS gp3 · {c["disk_gb"]} GB', 20, bold=True)

    d.text(1424, 443, f'AZ A · {c["db_subnet_a"]}', 18, color=MUTED)
    card("rds", "RDS PostgreSQL", PURPLE, detail=[f'{c["db_instance"]} · Single-AZ'], kind="database", fill="#fcf8ff", size=23)
    d.text(1424, 609, f'AZ B · {c["db_subnet_b"]}', 18, color=MUTED)
    d.text(1424, 634, "Subnet only · no standby", 17, color=MUTED)
    d.rect(*boxes["db_public"], "#fff8ed", "#e8c99b", 8)
    d.text(1650, 691, "Public RDS · TLS :5432", 18, bold=True, align="center")

    # Five equal service tiles: consistent icon size, baseline and spacing.
    for index, (title, key, color) in enumerate([
        ("Amazon ECR", "ecr", ORANGE),
        ("Parameter Store", "parameter-store", PINK),
        ("Secrets Manager", "secrets-manager", PINK),
        ("Session Manager", "session-manager", PINK),
        ("CloudWatch Logs", "cloudwatch", PINK),
    ]):
        x = 792 + 228 * index
        d.rect(x, 824, 200, 120, "white", "#d7dde7", 10)
        d.icon(x+76, 842, color, key, size=48)
        d.text(x+100, 919, title, 17, bold=True, align="center")

    card("users", "Users", INK, size=20)
    card("github", "GitHub", INK, size=19)
    d.text(116, 665, c["repository"], 14, color=MUTED, align="center")
    card("actions", "Actions", INK, detail=[c["voice_pipeline_status"]], size=18)
    card("admin", "Admin", INK, size=19)

    # Application routes use three separate gutters, clear of card contents.
    d.line([(200, 394), (320, 394)], width=2, arrow=True)
    label(260, 374, "HTTPS")
    d.line([(676, 392), (744, 392), (744, 564), (872, 564)], width=2, arrow=True)
    d.line([(676, 430), (728, 430), (728, 790), (1384, 790), (1384, 514), (1424, 514)], width=2, arrow=True)
    label(1074, 790, "PostgreSQL · TLS", size=16)
    d.line([(676, 354), (732, 354), (732, 150), (2118, 150), (2118, 190)], TEAL, 2, arrow=True)
    label(1350, 150, "OpenAI HTTPS", color=TEAL)
    d.line([(676, 440), (696, 440), (696, 646), (676, 646)], MUTED, 1.3, arrow=True)
    d.line([(1876, 542), (1948, 542), (1948, 884), (1904, 884)], MUTED, 1.3, arrow=True)

    # CI and administration stay in their own bottom routing lanes.
    d.line([(200, 630), (272, 630), (272, 434), (320, 434)], ORANGE, 1.7, dashed=True, arrow=True)
    d.line([(116, 690), (116, 792)], ORANGE, 1.7, dashed=True, arrow=True)
    d.line([(200, 839), (232, 839), (232, 976), (892, 976), (892, 944)], ORANGE, 1.7, dashed=True, arrow=True)
    label(540, 976, "Build + push image", color=ORANGE)
    d.line([(892, 824), (892, 802), (1360, 802), (1360, 506), (1320, 506)], ORANGE, 1.7, dashed=True, arrow=True)
    d.line([(200, 878), (216, 878), (216, 1080), (1556, 1080), (1556, 944)], ORANGE, 1.7, dashed=True, arrow=True)
    label(1050, 1080, "Deploy via SSM", color=ORANGE)
    d.line([(200, 1008), (232, 1008), (232, 1016), (1588, 1016), (1588, 944)], BLUE, 1.7, dashed=True, arrow=True)
    d.line([(1576, 824), (1576, 814), (1372, 814), (1372, 642), (1320, 642), (1320, 610)], BLUE, 1.7, dashed=True, arrow=True)
    d.write(output)


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir",type=Path,default=root/"docs/architecture")
    parser.add_argument("--config",type=Path,help="JSON overrides for CONFIG")
    parser.add_argument("--svg-only",action="store_true",help="Generate SVG without requiring Pillow")
    args = parser.parse_args()
    config = dict(CONFIG)
    if args.config:
        overrides = json.loads(args.config.read_text())
        unknown = set(overrides)-set(CONFIG)
        if unknown:
            parser.error(f"Unknown config keys: {', '.join(sorted(unknown))}")
        config.update(overrides)
    generate(config,args.output_dir,not args.svg_only)


if __name__ == "__main__":
    main()
