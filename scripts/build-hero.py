#!/usr/bin/env python3
"""Builds the animated hero banner (dark + light) and the section divider.

Pure SVG + SMIL, no scripts, so it animates inside GitHub's image proxy.
Live data comes from assets/generated/stats.json (written by update-readme.mjs):
the radar plots real public repos and the terminal types the latest commit.
Without it, the banner falls back to static copy.
Run: python3 scripts/build-hero.py
"""
import json
import math
import re
from datetime import datetime, timezone
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "assets"
ROOT.mkdir(exist_ok=True)


def load(name):
    f = ROOT / name
    return json.loads(f.read_text()) if f.exists() else None


STATS = load("generated/stats.json")
CTF = load("ctf.json")

PALETTES = {
    "dark": dict(
        bg0="#0b0f19", bg1="#111827", grid="#1f2937", text="#f1f5f9", muted="#94a3b8",
        accent="#2dd4bf", accent2="#3b82f6", panel="#0f172a", panelBorder="#1f2937",
        term="#0a0e17", prompt="#2dd4bf", out="#cbd5e1", ok="#34d399", dim="#64748b",
        glowOp="0.18",
    ),
    "light": dict(
        bg0="#ffffff", bg1="#f8fafc", grid="#e5e7eb", text="#0f172a", muted="#475569",
        accent="#0f766e", accent2="#1d4ed8", panel="#f1f5f9", panelBorder="#e2e8f0",
        term="#0f172a", prompt="#2dd4bf", out="#e2e8f0", ok="#34d399", dim="#94a3b8",
        glowOp="0.10",
    ),
}

MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace"
SANS = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"

def clip(text, n):
    return text if len(text) <= n else text[: n - 1] + "…"


def script():
    """Terminal script: (text, color-key, start-seconds, type-duration-seconds)."""
    lines = [
        ("$ whoami", "prompt"),
        ("noah-franklin  ·  security engineer  ·  red team  ·  ai/llm infrastructure", "out"),
    ]
    if STATS and STATS.get("commit"):
        c = STATS["commit"]
        lines += [
            ("$ git log -1 --oneline", "prompt"),
            (clip(f"{c['sha']} ({c['repo']}) {c['message']}", 74) + f" · {c['date'][:10]}", "out"),
            ("$ ./profile --audit", "prompt"),
            (f"[ok] {STATS['stars']} stars   [ok] {STATS['forks']} forks   [ok] {STATS.get('skills') or '—'} gideon skills shipped", "ok"),
        ]
    else:
        lines += [
            ("$ ./threat-model --scope production --verify", "prompt"),
            ("[ok] attack surface mapped      [ok] exploits reproduced      [ok] fixes shipped", "ok"),
        ]
    lines.append(("$ ", "prompt"))
    out, t = [], 0.4
    for text, key in lines:
        dur = 0.2 if text == "$ " else min(1.8, 0.35 + len(text) * 0.02)
        out.append((text, key, round(t, 2), round(dur, 2)))
        t += dur + (0.25 if key == "prompt" else 0.5)
    return out


LINES = script()
CYCLE = 600  # seconds before the terminal retypes


def terminal(p):
    x, y, w, h = 60, 138, 720, 196
    parts = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{p["term"]}" stroke="{p["panelBorder"]}"/>',
        f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="12" fill="{p["panel"]}"/>',
        f'<rect x="{x}" y="{y+18}" width="{w}" height="12" fill="{p["panel"]}"/>',
        f'<circle cx="{x+20}" cy="{y+15}" r="5" fill="#ef4444"/>',
        f'<circle cx="{x+38}" cy="{y+15}" r="5" fill="#f59e0b"/>',
        f'<circle cx="{x+56}" cy="{y+15}" r="5" fill="#22c55e"/>',
        f'<text x="{x+w/2}" y="{y+19}" text-anchor="middle" font-family="{MONO}" font-size="11" fill="{p["dim"]}">noah@sec — zsh</text>',
    ]
    step = 26 if len(LINES) <= 5 else 21
    line_y = y + 58 if len(LINES) <= 5 else y + 54
    for i, (text, key, start, dur) in enumerate(LINES):
        cid = f"clip{i}"
        width = min(w - 40, 8.1 * len(text) + 4)
        end = start + dur
        # The rect's static width is the full line, so renderers without SMIL
        # (link unfurls, rasterizers) show finished text instead of an empty
        # terminal. Animated renderers type it out, then hold it for the rest of
        # a long repeating cycle: Chrome drops fill="freeze" clip animations
        # after ~a minute, which used to leave the terminal blank.
        parts.append(
            f'<clipPath id="{cid}"><rect x="{x+20}" y="{line_y-14}" width="{width:.0f}" height="20">'
            f'<animate attributeName="width" values="0;0;{width:.0f};{width:.0f}" '
            f'keyTimes="0;{start/CYCLE:.5f};{end/CYCLE:.5f};1" dur="{CYCLE}s" repeatCount="indefinite" calcMode="linear"/>'
            f'</rect></clipPath>'
        )
        parts.append(
            f'<text x="{x+20}" y="{line_y}" clip-path="url(#{cid})" font-family="{MONO}" font-size="13" fill="{p[key]}" xml:space="preserve">{escape(text)}</text>'
        )
        line_y += step
    # blinking cursor after the final prompt
    cy = line_y - step
    parts.append(
        f'<rect x="{x+38}" y="{cy-12}" width="8" height="15" fill="{p["accent"]}" opacity="0">'
        f'<animate attributeName="opacity" values="0;0;1;0;1;0;1;0;1;0;1;0;1;0;1;0;1;0;1;0;1" begin="{LINES[-1][2]}s" dur="10s" repeatCount="indefinite"/>'
        f'</rect>'
    )
    return "\n".join(parts)


def radar(p):
    cx, cy, r = 940, 236, 92
    rings = "".join(
        f'<circle cx="{cx}" cy="{cy}" r="{rr}" fill="none" stroke="{p["accent"]}" stroke-opacity="0.25" stroke-width="1"/>'
        for rr in (r, r * 0.66, r * 0.33)
    )
    cross = (
        f'<line x1="{cx-r}" y1="{cy}" x2="{cx+r}" y2="{cy}" stroke="{p["accent"]}" stroke-opacity="0.2"/>'
        f'<line x1="{cx}" y1="{cy-r}" x2="{cx}" y2="{cy+r}" stroke="{p["accent"]}" stroke-opacity="0.2"/>'
    )
    sweep = (
        f'<path d="M{cx} {cy} L{cx} {cy-r} A{r} {r} 0 0 1 {cx+r*0.7071:.1f} {cy-r*0.7071:.1f} Z" fill="url(#sweep)">'
        f'<animateTransform attributeName="transform" type="rotate" from="0 {cx} {cy}" to="360 {cx} {cy}" dur="4s" repeatCount="indefinite"/>'
        f'</path>'
    )
    blips = static_blips(p, cx, cy)
    if STATS:
        pts = radar_points()
        blips = "".join(blip(p, cx, cy, r, *b) for b in pts) + labels(p, cx, cy, r, pts)
    count = len(STATS["repos"]) if STATS else 0
    caption = f"{count} PUBLIC PROJECTS · LIVE" if count else "MONITORING"
    label = f'<text x="{cx}" y="{cy+r+26}" text-anchor="middle" font-family="{MONO}" font-size="11" fill="{p["dim"]}" letter-spacing="2">{caption}</text>'
    return rings + cross + sweep + blips + label + ctf_payload(cx, cy)


STATS_STARS = {}

SECTORS = (  # clockwise from 12 o'clock: (keywords, centre angle)
    (("ai", "llm", "claude", "gpt", "model", "codex", "agent"), 45),
    (("owasp", "web", "pentest", "api", "xss", "red-team", "security"), 135),
    (("training", "learn", "thm", "ceh", "oscp", "research"), 225),
    ((), 315),  # tooling & everything else
)


def radar_points():
    """(angle, distance 0..1, size, label, is_fresh) per public repo."""
    pts = []
    by_stars = sorted(STATS["repos"], key=lambda r: -r["stars"])
    labelled = {r["name"] for r in by_stars[:3] if r["stars"] > 0}
    STATS_STARS.update({r["name"]: r["stars"] for r in STATS["repos"]})
    n = max(1, len(STATS["repos"]) - 1)
    for i, repo in enumerate(STATS["repos"]):  # newest push first
        text = " ".join([repo["name"], repo["description"], *repo["topics"]]).lower()
        centre = next(a for keys, a in SECTORS if not keys or any(re.search(rf"\b{k}\b", text) for k in keys))
        angle = centre - 38 + (i * 29) % 76  # spread within the sector, deterministic
        days = (datetime.now(timezone.utc) - datetime.fromisoformat(repo["pushed"].replace("Z", "+00:00"))).days
        dist = 0.25 + 0.7 * i / n  # rank by recency: the newest push sits nearest the centre
        size = 2.5 + 1.6 * math.log2(1 + repo["stars"])
        pts.append((angle, dist, size, repo["name"] if repo["name"] in labelled else "", days <= 14))
    return pts


def blip(p, cx, cy, r, angle, dist, size, label, fresh):
    rad = math.radians(angle)
    bx, by = cx + r * dist * math.sin(rad), cy - r * dist * math.cos(rad)
    # Light up as the sweep's leading edge (45° ahead of its start) passes.
    delay = ((angle - 45) % 360) / 360 * 4
    out = (
        f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="{size:.1f}" fill="{p["accent"]}" opacity="0.25">'
        f'<animate attributeName="opacity" values="1;0.25" begin="{delay:.2f}s" dur="4s" repeatCount="indefinite"/>'
        f'</circle>'
    )
    if fresh:
        out += (
            f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="{size:.1f}" fill="none" stroke="{p["accent"]}" opacity="0">'
            f'<animate attributeName="r" values="{size:.1f};{size + 14:.1f}" begin="{delay:.2f}s" dur="4s" repeatCount="indefinite"/>'
            f'<animate attributeName="opacity" values="0.8;0" begin="{delay:.2f}s" dur="4s" repeatCount="indefinite"/>'
            f'</circle>'
        )
    return out


def labels(p, cx, cy, r, pts):
    """Names for the most-starred blips, in a column beside the radar so they never collide."""
    named = sorted((pt for pt in pts if pt[3]), key=lambda pt: -pt[2])
    lx, out = cx + r + 22, ""
    for i, (angle, dist, size, label, _) in enumerate(named):
        rad = math.radians(angle)
        bx, by = cx + r * dist * math.sin(rad), cy - r * dist * math.cos(rad)
        ly = cy - r + 16 + i * 16
        out += (
            f'<polyline points="{bx:.1f},{by:.1f} {lx - 14},{ly - 3.5} {lx - 4},{ly - 3.5}" fill="none" stroke="{p["dim"]}" stroke-width="0.75" stroke-opacity="0.7"/>'
            f'<text x="{lx}" y="{ly}" font-family="{MONO}" font-size="10" fill="{p["muted"]}">{escape(label)} <tspan fill="{p["dim"]}">★{STATS_STARS[label]}</tspan></text>'
        )
    return out


def static_blips(p, cx, cy):
    out = ""
    for (bx, by, delay) in ((cx + 40, cy - 30, 0.6), (cx - 55, cy + 20, 2.1), (cx + 15, cy + 60, 3.2)):
        out += (
            f'<circle cx="{bx}" cy="{by}" r="3.5" fill="{p["accent"]}" opacity="0">'
            f'<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.1;1" begin="{delay}s" dur="4s" repeatCount="indefinite"/>'
            f'</circle>'
        )
    return out


def ctf_payload(cx, cy):
    """An invisible signal on the radar. See the README's capture-the-flag section."""
    if not CTF:
        return ""
    return (
        f'<text x="{cx}" y="{cy}" font-family="{MONO}" font-size="1" fill-opacity="0" '
        f'data-signal="faint">{CTF["signal"]}</text>'
    )


def hero(p):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-label="Noah Franklin — Security Engineer">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{p["bg0"]}"/><stop offset="1" stop-color="{p["bg1"]}"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{p["accent"]}"/><stop offset="1" stop-color="{p["accent2"]}"/></linearGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{p["accent"]}" stop-opacity="0.55"/><stop offset="1" stop-color="{p["accent"]}" stop-opacity="0"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="{p["grid"]}" stroke-width="1"/></pattern>
    <radialGradient id="glow" cx="0.82" cy="0.45" r="0.5"><stop offset="0" stop-color="{p["accent"]}" stop-opacity="{p["glowOp"]}"/><stop offset="1" stop-color="{p["accent"]}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="360" rx="14" fill="url(#bg)" stroke="{p["panelBorder"]}"/>
  <rect width="1200" height="360" rx="14" fill="url(#grid)"/>
  <rect width="1200" height="360" rx="14" fill="url(#glow)"/>

  <rect x="60" y="48" width="6" height="64" rx="3" fill="url(#accent)"/>
  <text x="84" y="84" font-family="{SANS}" font-size="44" font-weight="700" fill="{p["text"]}" letter-spacing="-1">Noah Franklin</text>
  <text x="86" y="112" font-family="{SANS}" font-size="17" font-weight="500" fill="{p["muted"]}">Security Engineer · Offensive Security · AI/LLM Infrastructure</text>

  <g>
    <circle cx="1010" cy="70" r="4" fill="{p["ok"]}"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></circle>
    <text x="1022" y="74" font-family="{MONO}" font-size="12" fill="{p["muted"]}">open to work</text>
  </g>

{terminal(p)}
{radar(p)}
</svg>
'''


def divider(p):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="8" viewBox="0 0 1200 8">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="{p["accent"]}" stop-opacity="0"/><stop offset="0.5" stop-color="{p["accent"]}"/><stop offset="1" stop-color="{p["accent2"]}" stop-opacity="0"/></linearGradient></defs>
  <rect x="0" y="3" width="1200" height="2" fill="url(#g)"/>
</svg>
'''


for name, p in PALETTES.items():
    (ROOT / f"hero-{name}.svg").write_text(hero(p))
(ROOT / "divider.svg").write_text(divider(PALETTES["dark"]))
print("wrote", sorted(f.name for f in ROOT.glob("*.svg")))
