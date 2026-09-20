#!/usr/bin/env python3
"""Builds the animated hero banner (dark + light) and the section divider.

Pure SVG + SMIL, no scripts, so it animates inside GitHub's image proxy.
Run: python3 scripts/build-hero.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "assets"
ROOT.mkdir(exist_ok=True)

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

# Terminal script: (text, color-key, start-seconds, type-duration-seconds)
LINES = [
    ("$ whoami", "prompt", 0.4, 0.8),
    ("noah-franklin  ·  security engineer  ·  red team  ·  ai/llm infrastructure", "out", 1.4, 1.6),
    ("$ ./threat-model --scope production --verify", "prompt", 3.4, 1.6),
    ("[ok] attack surface mapped      [ok] exploits reproduced      [ok] fixes shipped", "ok", 5.3, 1.8),
    ("$ ", "prompt", 7.4, 0.2),
]


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
    line_y = y + 58
    for i, (text, key, start, dur) in enumerate(LINES):
        cid = f"clip{i}"
        width = min(w - 40, 8.1 * len(text) + 4)
        parts.append(
            f'<clipPath id="{cid}"><rect x="{x+20}" y="{line_y-14}" width="0" height="20">'
            f'<animate attributeName="width" from="0" to="{width:.0f}" begin="{start}s" dur="{dur}s" fill="freeze" calcMode="linear"/>'
            f'</rect></clipPath>'
        )
        parts.append(
            f'<text x="{x+20}" y="{line_y}" clip-path="url(#{cid})" font-family="{MONO}" font-size="13" fill="{p[key]}" xml:space="preserve">{text}</text>'
        )
        line_y += 26
    # blinking cursor after the final prompt
    cy = line_y - 26
    parts.append(
        f'<rect x="{x+38}" y="{cy-12}" width="8" height="15" fill="{p["accent"]}" opacity="0">'
        f'<animate attributeName="opacity" values="0;0;1;0;1;0;1;0;1;0;1;0;1;0;1;0;1;0;1;0;1" begin="7.6s" dur="10s" repeatCount="indefinite"/>'
        f'</rect>'
    )
    return "\n".join(parts)


def radar(p):
    cx, cy, r = 1010, 236, 92
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
    blips = ""
    for (bx, by, delay) in ((cx + 40, cy - 30, 0.6), (cx - 55, cy + 20, 2.1), (cx + 15, cy + 60, 3.2)):
        blips += (
            f'<circle cx="{bx}" cy="{by}" r="3.5" fill="{p["accent"]}" opacity="0">'
            f'<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.1;1" begin="{delay}s" dur="4s" repeatCount="indefinite"/>'
            f'</circle>'
            f'<circle cx="{bx}" cy="{by}" r="3.5" fill="none" stroke="{p["accent"]}" opacity="0">'
            f'<animate attributeName="r" values="3;16" begin="{delay}s" dur="4s" repeatCount="indefinite"/>'
            f'<animate attributeName="opacity" values="0.8;0" begin="{delay}s" dur="4s" repeatCount="indefinite"/>'
            f'</circle>'
        )
    label = f'<text x="{cx}" y="{cy+r+26}" text-anchor="middle" font-family="{MONO}" font-size="11" fill="{p["dim"]}" letter-spacing="2">MONITORING</text>'
    return rings + cross + sweep + blips + label


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
