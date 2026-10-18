#!/usr/bin/env python3
"""Arms (or re-keys) the profile capture-the-flag.

Writes assets/ctf.json, the encrypted signal the hero banner hides on its radar,
and prints the plaintext flag to stdout so it can go straight into the secret
the verifier reads. The flag itself is never written to the repo:

    python3 scripts/ctf-arm.py | gh secret set CTF_FLAG
    python3 scripts/build-hero.py && git add assets && git commit -m "ctf: re-key" && git push
"""
import base64
import json
import secrets
from pathlib import Path

KEY = b"gideon"  # the flagship tool's name, lowercase: the puzzle's hint

flag = f"FLAG{{{secrets.token_hex(8)}_r4d4r_n3v3r_l13s}}"
cipher = bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(flag.encode())).hex()
note = f"xor:{cipher} | key: my flagship tool, lowercase | proof: sha256(flag + ':' + your_github_login)"
signal = base64.b64encode(note.encode()).decode()

out = Path(__file__).resolve().parent.parent / "assets" / "ctf.json"
out.write_text(json.dumps({"signal": signal}, indent=2) + "\n")
print(flag, end="")
