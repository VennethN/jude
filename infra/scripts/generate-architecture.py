#!/usr/bin/env python3
"""Draw the architecture without image-generation APIs or network access.

Usage: python3 infra/scripts/generate-architecture.py
SVG uses only Python's standard library; PNG additionally uses Pillow.
Official SVG artwork and PNG caches live in infra/docs/architecture/icons.
Vendor sources and SHA-256 digests are recorded in icons/sources.json.
Generating either format is offline; ImageMagick is not a runtime dependency.
Edit the layout below, or pass --config settings.json to override CONFIG values.
The diagrams document application flows, Terraform and the GitHub Actions workflow.
The overview and two focused views are emitted together; see the architecture README.
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
    "voice_subnet": "10.40.20.0/24",
    "db_subnet_a": "10.40.10.0/24",
    "db_subnet_b": "10.40.11.0/24",
    "instance": "t3.medium",
    "db_instance": "db.t4g.micro",
    "disk_gb": 40,
    "repository": "VennethN/jude",
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
    "Amazon Transcribe": "transcribe",
    "Amazon ECR": "ecr", "Parameter Store": "parameter-store",
    "Secrets Manager": "secrets-manager", "Session Manager": "session-manager",
    "Users": "users", "GitHub": "github", "Actions": "actions", "Admin": "admin",
}


class Drawing:
    """One set of primitives, rendered to both scalable SVG and a 2x PNG."""

    def __init__(self, width=2000, height=1100, png=True):
        self.width, self.height, self.scale = width, height, 2
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                    '<title id="title">Jude service architecture and application flows</title>',
                    '<desc id="desc">CloudFront serves HTTPS from a Jakarta EC2 host running SvelteKit frontend and API plus Python voice. RDS and private S3 storage are in Jakarta. GitHub Actions checks both services, builds an ECR image and deploys it by digest through Systems Manager using OIDC.</desc>',
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

    def write(self, directory, name="aws-architecture"):
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{name}.svg"
        target.write_text("\n".join(self.svg+["</svg>"]), encoding="utf-8")
        print(target)
        if self.image:
            target = directory / f"{name}.png"
            self.image.save(target)
            print(target)


def box(d, x, y, w, h, title, lines=(), color=BLUE, fill="#f7faff", icon=None):
    d.rect(x, y, w, h, fill, color, 12)
    if icon:
        d.icon(x+16, y+12, color, icon, size=32)
    d.text(x+(60 if icon else 18), y+28, title, 21, bold=True)
    for index, line in enumerate(lines):
        d.text(x+18, y+58+index*25, line, 18, color=MUTED)


def heading(d, title, subtitle):
    d.text(32, 34, title, 30, bold=True)
    d.text(32, 70, subtitle, 18, color=MUTED)


def note(d, x, y, text, color=MUTED):
    d.text(x, y, text, 17, color=color)


def flow(d, points, label=None, label_at=None, color=BLUE, dashed=False):
    d.line(points, color=color, width=2, dashed=dashed, arrow=True)
    if label:
        x, y = label_at
        width = len(label)*8.3+16
        d.rect(x-width/2, y-13, width, 26, "white", "none", 4)
        d.text(x, y, label, 16, color=color, bold=True, align="center")


def save(d, output, name):
    d.write(output, name)


def generate(config, output, png):
    """Render the current voice-host path, then focused application/control planes.

    This checked-in Python source is the editable, offline diagram source.
    README.md in the output directory records evidence and conditional behavior.
    """
    c = config
    d = Drawing(width=1280, height=1240, png=png)
    heading(d, "Jude · service and hosting overview", "Repository configuration · Jakarta compute/storage · Singapore speech recognition")

    box(d, 32, 108, 340, 130, "Browser", ["Svelte workspace + microphone", "Session cookie; per-tab memory cache"], INK, "#f8fafc", icon="users")
    box(d, 450, 108, 360, 130, "CloudFront · global edge", ["HTTPS / WSS entry point", "Caching disabled; forwards requests"], PURPLE, "#fbf8ff", icon="cloudfront")
    box(d, 888, 108, 360, 130, "Direct voice gateway", ["Optional HTTPS :443 → /api/live/*", "Enabled by committed tfvars"], PURPLE, "#fbf8ff", icon="caddy")
    flow(d, [(372, 171), (450, 171)], "TLS", (410, 151))
    flow(d, [(202, 238), (202, 259), (1068, 259), (1068, 238)], color=PURPLE, dashed=True)

    d.rect(32, 290, 1216, 604, "#fbfefb", GREEN, 16)
    d.icon(52, 300, PURPLE, "region", size=32)
    d.text(96, 319, "AWS Jakarta · ap-southeast-3", 24, bold=True)
    note(d, 52, 349, "VPC 10.40.0.0/16 · Internet Gateway · public app subnet 10.40.20.0/24")
    d.rect(52, 378, 748, 460, "#fffaf4", ORANGE, 14)
    d.icon(72, 388, ORANGE, "ec2", size=32)
    d.text(116, 406, f'EC2 · {c["instance"]} · encrypted gp3 {c["disk_gb"]} GB', 22, bold=True)
    d.icon(736, 422, BLUE, "docker", size=28)
    note(d, 72, 436, "Caddy proxy container + one combined application container")
    box(d, 72, 462, 708, 94, "Caddy :80 · CloudFront origin", ["HTTP origin restricted to CloudFront IP prefix list"], ORANGE, "white", icon="caddy")
    flow(d, [(630, 238), (630, 276), (822, 276), (822, 508), (780, 508)], "HTTP / WS :80", (731, 276))
    flow(d, [(1068, 238), (1068, 276), (832, 276), (832, 574), (244, 574), (244, 590)], color=PURPLE, dashed=True)
    box(d, 72, 590, 338, 218, "Web · Node :3000", ["UI, auth, case and document APIs", "SSE events; NDJSON answers", "Analysis / index / retention jobs", "SvelteKit + shared TypeScript core"], BLUE, icon="docker")
    box(d, 442, 590, 338, 218, "Voice · FastAPI :3001", ["Recording permissions + replay", "Live audio + file transcription", "Audio persistence, speaker labels", "Optional legacy pyannote worker"], TEAL, "#f2fcfa", icon="fastapi")
    flow(d, [(244, 556), (244, 590)])
    flow(d, [(410, 650), (442, 650)], color=TEAL)
    note(d, 325, 851, "Web → Voice: HTTP / WS over loopback; no public :3000/:3001")

    box(d, 850, 378, 378, 172, "RDS PostgreSQL", ["TLS :5432 · users, orgs, case records", "Transcripts, jobs, semantic vectors", "pgvector if installed; native fallback", "Single-AZ · two-subnet DB group"], PURPLE, "#fbf8ff", icon="rds")
    box(d, 850, 590, 378, 140, "Private S3 + KMS", ["Original documents + hearing audio", "Server-side object access over HTTPS", "Public access blocked; SSE-KMS"], GREEN, "#f6fcf3", icon="s3")
    d.icon(1180, 602, PINK, "kms", size=32)
    flow(d, [(800, 486), (850, 486)], color=PURPLE)
    flow(d, [(800, 678), (850, 678)], color=GREEN)
    note(d, 850, 770, "RDS: db.t4g.micro · backup retention 7d")
    note(d, 850, 797, "Committed public DB allowlist: 0.0.0.0/0")
    note(d, 850, 824, "TLS required; no standby in current config")
    note(d, 52, 875, "Boundary: provider credentials and private object access stay in the backend; see focused flows.")

    box(d, 32, 922, 378, 146, "OpenAI + Pasal.id", ["OpenAI · LLM + embeddings · HTTPS", "Pasal.id · optional legal discovery", "No fixed provider region asserted"], TEAL, "#f2fcfa", icon="openai")
    box(d, 442, 922, 378, 146, "Singapore · Transcribe", ["ap-southeast-1 · speech streaming", "Signed WSS :8443 from Voice", "Anonymous speaker labels + text"], TEAL, "#f2fcfa", icon="transcribe")
    box(d, 852, 922, 396, 146, "Release + operations", ["GitHub OIDC → ECR / SSM", "S3 release scripts; Parameter Store", "RDS secret; PostgreSQL log export"], INK, "#f8fafc", icon="github")
    for x, key, label in [(32, "aws-cloud", "AWS"), (180, "vpc", "VPC"), (328, "internet-gateway", "Internet GW"), (476, "ecr", "ECR"), (624, "parameter-store", "Parameters"), (772, "secrets-manager", "Secrets"), (920, "session-manager", "SSM"), (1068, "cloudwatch", "CloudWatch")]:
        d.icon(x, 1090, INK, key, size=30)
        d.text(x+39, 1105, label, 15, color=MUTED)
    note(d, 32, 1160, "Solid arrows: request/data path. Dashed: configuration-dependent direct gateway.")
    note(d, 32, 1190, "Details and source links: infra/docs/architecture/README.md · application-flow.svg · deployment-flow.svg")
    # Write overview last, since Drawing.write retains the established output basename.
    overview = d

    d = Drawing(width=1280, height=1210, png=png)
    heading(d, "Jude · application data flows", "Three transports: HTTP APIs + case SSE + voice WebSocket · server-authoritative permissions")
    box(d, 32, 108, 378, 220, "1 · Browser workspace", ["HttpOnly jude_session cookie", "Versioned snapshots + case register", "Bounded Maps in this tab's memory", "BroadcastChannel invalidates tabs", "Focus / visibility refresh guards"], INK, "#f8fafc")
    box(d, 492, 108, 756, 220, "2 · Web authentication and case boundary", ["Session token hash → sessions + current organisation", "Case membership: owner / editor / viewer; mutation checks", "SSR guards + x-jude-workspace identity/version checks", "GET workspace snapshot + case library over HTTPS", "Guest entry imports bundled, labelled practice archive"], BLUE)
    flow(d, [(410, 202), (492, 202)], "HTTPS", (450, 180))

    box(d, 32, 390, 378, 190, "3 · Case change stream", ["EventSource /api/cases/:id/events", "Web polls DB version every 1.5s", "SSE case.updated → refetch snapshot", "Access lost → discard / navigate"], BLUE)
    box(d, 492, 390, 756, 190, "Shared PostgreSQL records and migrations", ["Both backends share sessions, orgs, cases and hearing records", "Durable analysis_jobs; semantic evidence + vector index", "PostgreSQL real[] cosine fallback; pgvector if installed", "Local development: shared SQLite + private filesystem"], PURPLE, "#fbf8ff")
    flow(d, [(870, 328), (870, 390)], "SQL / TLS", (948, 357), color=PURPLE)
    flow(d, [(492, 465), (410, 465)], "SSE", (450, 442))
    flow(d, [(220, 390), (220, 328)], color=BLUE)

    box(d, 32, 654, 378, 252, "4 · Hearings and audio", ["Web Audio microphone in browser", "Same-origin /api/live/*", "WSS: live PCM + server events", "HTTPS: upload, replay, audio range", "Web forwards cookie / origin", "Voice rechecks role + consent"], TEAL, "#f2fcfa")
    box(d, 492, 654, 352, 252, "Voice · Python", ["FFmpeg decodes uploaded audio", "Transcribe text + speaker labels", "Persist transcript → queue analysis", "Store hearing audio privately", "Synthetic replay is labelled", "Legacy pyannote is optional"], TEAL, "#f2fcfa")
    box(d, 922, 654, 326, 252, "Speech and objects", ["Transcribe · Singapore", "SigV4 WSS :8443", "", "S3 + KMS · Jakarta", "HTTPS object read / write", "Audio served through backend"], GREEN, "#f6fcf3")
    flow(d, [(410, 748), (492, 748)], "HTTP/WS", (450, 726), color=TEAL)
    flow(d, [(844, 748), (922, 748)], "WSS", (883, 726), color=TEAL)
    flow(d, [(844, 848), (922, 848)], "HTTPS", (883, 826), color=GREEN)
    flow(d, [(668, 654), (668, 580)], "SQL / TLS", (737, 615), color=PURPLE)

    box(d, 32, 980, 378, 180, "5 · Evidence and Assistant", ["Documents: extract / OCR / convert", "Case archive import / export", "Private files through backend", "Source-linked answers + findings"], BLUE)
    box(d, 492, 980, 352, 180, "Web jobs + retrieval", ["Two in-process analysis lanes", "Durable leases / retry / recovery", "Embedding index + retention purge", "Lexical + semantic case retrieval"], BLUE)
    box(d, 922, 980, 326, 180, "Optional providers · HTTPS", ["OpenAI Responses: model tasks", "OpenAI embeddings: 1536 dims", "Pasal.id: legal discovery", "Assistant returns NDJSON stream"], TEAL, "#f2fcfa")
    flow(d, [(410, 1060), (492, 1060)])
    flow(d, [(844, 1060), (922, 1060)], "HTTPS", (883, 1037), color=TEAL)
    note(d, 32, 1190, "All browser-to-backend traffic follows the overview ingress path. Workers run inside the services; no separate queue broker.")
    save(d, output, "application-flow")

    d = Drawing(width=1280, height=1030, png=png)
    heading(d, "Jude · release and operations", "Current .github/workflows/deploy.yml path · one EC2 host · immutable image digest")
    box(d, 32, 108, 378, 170, "1 · GitHub Actions checks", ["Pull requests / eligible main pushes", "pnpm check + design:check", "Python Ruff lint", "CI does not run full test suites"], INK, "#f8fafc")
    box(d, 492, 108, 756, 170, "2 · Build, authenticate, publish", ["GitHub OIDC assumes scoped AWS deployment role", "Docker release-pyannote target · Linux AMD64", "Combined Node + Python image → immutable ECR digest", "Deployment scripts uploaded to S3 _deploy/releases/"], ORANGE, "#fffaf4")
    flow(d, [(410, 190), (492, 190)], "pass", (450, 167), color=ORANGE)
    box(d, 32, 354, 378, 200, "3 · SSM Run Command", ["deploy-ci.py invokes target EC2", "EC2 role fetches ECR + scripts", "Run run-voice-host.sh", "Then configured direct gateway", "No SSH deployment step"], ORANGE, "#fffaf4")
    box(d, 492, 354, 756, 200, "4 · EC2 runtime · Jakarta", ["/jude-dev/runtime/* → temporary /run/jude/app.env", "Parameter Store holds runtime config + credentials", "RDS CA bundle downloaded; mounted read-only", "Optional offline Community-1 model mounted read-only", "jude-app + jude-proxy replaced on the single host"], BLUE)
    flow(d, [(870, 278), (870, 314), (220, 314), (220, 354)], "OIDC → AWS SSM", (545, 314), color=ORANGE)
    flow(d, [(410, 450), (492, 450)], "run", (450, 427), color=ORANGE)
    box(d, 32, 630, 378, 192, "5 · Readiness and smoke test", ["Both :3000 and :3001 /healthz", "Expected x-jude-revision checked", "Proxy starts after app readiness", "Workflow checks public /healthz", "Replacement briefly interrupts traffic"], GREEN, "#f6fcf3")
    box(d, 492, 630, 352, 192, "Persistent infrastructure", ["RDS: app data + job leases", "S3/KMS: originals + audio", "ECR: immutable release images", "SSM: host administration", "EBS: host + optional model"], PURPLE, "#fbf8ff")
    box(d, 922, 630, 326, 192, "Secrets and logs", ["RDS-managed master secret", "Stored in Secrets Manager", "RDS PostgreSQL → CloudWatch", "Container logs: local rotation", "No app log sink asserted"], INK, "#f8fafc")
    flow(d, [(870, 554), (870, 592), (220, 592), (220, 630)], "local health → public revision", (550, 592), color=GREEN)
    box(d, 32, 892, 1216, 100, "Separate Terraform deployment option · not the workflow above", ["app_image_digest + app_hostname create app-host EC2 with direct Caddy TLS and application Secrets Manager JSON.", "Committed tfvars instead enables voice-host + CloudFront. These are separate provisioning paths; avoid assuming two live hosts."], MUTED, "#f8fafc")
    save(d, output, "deployment-flow")
    save(overview, output, "aws-architecture")

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
