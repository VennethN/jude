#!/usr/bin/env python3
"""Draw the architecture without image-generation APIs or network access.

Usage: python3 infra/scripts/generate-architecture.py
SVG uses only Python's standard library; PNG additionally uses Pillow.
Official SVG artwork and PNG caches live in infra/docs/architecture/icons.
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
ASSETS = Path(__file__).resolve().parents[1] / "docs/architecture/icons"
ICON_BY_TITLE = {
    "CloudFront": "cloudfront", "CloudWatch Logs": "cloudwatch",
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
                    '<title id="title">AWS architecture: EC2 frontend, web API and Python voice</title>',
                    '<desc id="desc">CloudFront serves HTTPS from a Jakarta EC2 host running SvelteKit frontend and API plus Python voice. RDS and private S3 storage are in Jakarta. GitHub Actions deployment is planned.</desc>',
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
    """One Jakarta compute region; CloudFront is an edge service, not hosting."""
    c = config
    d = Drawing(width=2080, height=1180, png=png)
    d.rect(240, 40, 1600, 1090, "white", "#647084", 16)
    d.icon(264, 64, INK, "aws-cloud", size=40)
    d.text(320, 85, "AWS Cloud", 27, bold=True)
    d.card(320, 132, 330, 88, "CloudFront", PURPLE, size=22)
    d.card(1870, 132, 180, 88, "OpenAI API", TEAL, size=17)
    d.group(280, 268, 1520, 800, c["backend_region"], c["backend_region_code"])
    d.group(312, 374, 1456, 466, f'Amazon VPC · {c["vpc"]}', color=GREEN, fill="#fbfefb")
    d.group(344, 454, 850, 362, f'Application subnet · {c["voice_subnet"]}', color=GREEN, fill="#f5fbf4")
    d.group(1242, 454, 494, 362, "RDS subnet group · 2 AZs", color=BLUE, fill="#f6faff")
    d.card(1452, 350, 284, 64, "Internet Gateway", PURPLE, size=18)

    d.card(368, 528, 802, 214, f'Amazon EC2 · {c["instance"]}', ORANGE, kind="compute", fill="#fffaf4", size=23)
    d.asset(1040, 547, 28, 24, "docker")
    d.text(1076, 560, "Docker", 17, color=BLUE, bold=True)
    d.rect(392, 602, 330, 72, "#f4f9ff", "#91b3de", 8)
    d.text(557, 625, "SvelteKit · Node.js", 21, bold=True, align="center")
    d.text(557, 653, "Frontend + API :3000", 18, color=MUTED, align="center")
    d.rect(780, 602, 366, 72, "#f4f9ff", "#91b3de", 8)
    d.icon(796, 624, TEAL, "fastapi", size=28)
    d.text(980, 625, "Python · FastAPI", 21, bold=True, align="center")
    d.text(980, 653, "Voice :3001", 18, color=MUTED, align="center")
    d.line([(722, 638), (780, 638)], width=1.8, arrow=True)
    d.rect(392, 690, 330, 40, "white", "#91b3de", 8)
    d.asset(463, 698, 80, 26, "caddy")
    d.text(582, 710, ":80", 17, bold=True)
    d.line([(418, 690), (418, 674)], width=1.8, arrow=True)
    d.rect(368, 758, 802, 40, "white", "#a9c99b", 8)
    d.icon(384, 766, GREEN, "ebs", size=24)
    d.text(424, 778, f'EBS gp3 · {c["disk_gb"]} GB', 19, bold=True)

    d.text(1266, 519, f'AZ A · {c["db_subnet_a"]}', 18, color=MUTED)
    d.card(1266, 548, 446, 112, "RDS PostgreSQL", PURPLE,
           [f'{c["db_instance"]} · Single-AZ'], "database", fill="#fcf8ff", size=23)
    d.text(1266, 692, f'AZ B · {c["db_subnet_b"]}', 18, color=MUTED)
    d.text(1266, 719, "Subnet only · no standby", 17, color=MUTED)
    d.rect(1266, 750, 446, 42, "#fff8ed", "#e8c99b", 8)
    d.text(1489, 771, "Public RDS · TLS :5432", 18, bold=True, align="center")

    tiles = [
        ("Amazon ECR", "ecr", ORANGE), ("Parameter Store", "parameter-store", PINK),
        ("Secrets Manager", "secrets-manager", PINK), ("KMS", "kms", PINK),
        ("S3 private files", "s3", GREEN), ("Session Manager", "session-manager", PINK),
        ("CloudWatch Logs", "cloudwatch", PINK),
    ]
    for index, (title, key, color) in enumerate(tiles):
        x = 312 + index * 208
        d.rect(x, 904, 192, 120, "white", "#d7dde7", 10)
        d.icon(x+72, 922, color, key, size=48)
        d.text(x+96, 998, title, 15, bold=True, align="center")

    d.card(32, 130, 168, 96, "Users", INK, size=20)
    d.card(32, 640, 168, 112, "GitHub", INK, size=19)
    d.text(116, 727, c["repository"], 14, color=MUTED, align="center")
    d.card(32, 842, 168, 112, "Actions", INK, detail=[c["voice_pipeline_status"]], size=18)
    d.card(32, 1038, 168, 88, "Admin", INK, size=19)

    def label(x, y, value, color=INK):
        w = len(value)*8.5+18
        d.rect(x-w/2, y-13, w, 26, "white", "none", 5)
        d.text(x, y, value, 16, color=color, bold=True, align="center")

    d.line([(200, 178), (320, 178)], arrow=True)
    label(260, 157, "HTTPS")
    d.line([(320, 200), (264, 200), (264, 710), (392, 710)], BLUE, 2, arrow=True)
    d.line([(692, 674), (692, 682), (1216, 682), (1216, 604), (1266, 604)], INK, 2, arrow=True)
    d.line([(392, 638), (300, 638), (300, 348), (1960, 348), (1960, 220)], TEAL, 2, arrow=True)
    label(1070, 348, "OpenAI HTTPS", TEAL)
    d.line([(116, 752), (116, 842)], ORANGE, 1.7, dashed=True, arrow=True)
    d.line([(200, 884), (224, 884), (224, 1054), (408, 1054), (408, 1024)], ORANGE, 1.7, dashed=True, arrow=True)
    d.line([(408, 904), (408, 866), (1228, 866), (1228, 582), (1170, 582)], ORANGE, 1.7, dashed=True, arrow=True)
    label(782, 866, "Image pull", ORANGE)
    d.line([(200, 926), (216, 926), (216, 1100), (1444, 1100), (1444, 1024)], ORANGE, 1.7, dashed=True, arrow=True)
    label(850, 1100, "Deploy via SSM", ORANGE)
    d.line([(200, 1082), (232, 1082), (232, 1140), (1476, 1140), (1476, 1024)], BLUE, 1.7, dashed=True, arrow=True)
    d.line([(1448, 904), (1448, 882), (1204, 882), (1204, 720), (1170, 720)], BLUE, 1.7, dashed=True, arrow=True)
    d.write(output)


def main():
    root = Path(__file__).resolve().parents[1]
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
