#!/usr/bin/env node
/**
 * Profile generator. Runs in CI on a schedule (see .github/workflows/update-readme.yml).
 *
 *  1. Rewrites the "Recently pushed" section of README.md with the newest repos.
 *  2. Renders assets/generated/metrics-{dark,light}.svg — a self-hosted metrics
 *     board (contribution heatmap, streak, stars, repos, language mix).
 *
 * No dependencies — Node 20+ global fetch. GITHUB_TOKEN is required for the
 * GraphQL contribution calendar; without it the metrics board is skipped.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const USER = process.env.GH_USER || "noahfranklin";
const TOKEN = process.env.GITHUB_TOKEN;
const README = "README.md";
const START = "<!--RECENT_REPOS:START-->";
const END = "<!--RECENT_REPOS:END-->";
const COUNT = 6;
const OUT_DIR = "assets/generated";

const LANG_COLORS = {
  TypeScript: "3178C6", JavaScript: "F7DF1E", Python: "3776AB", Go: "00ADD8",
  Rust: "DE4B25", "C++": "00599C", C: "555555", Java: "B07219", PHP: "777BB4",
  Shell: "89E051", HTML: "E34C26", CSS: "563D7C", Ruby: "CC342D", Dockerfile: "384D54",
  Jupyter: "DA5B0B", "Jupyter Notebook": "DA5B0B", Kotlin: "A97BFF", Swift: "F05138",
};

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": USER,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function rest(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub REST ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub GraphQL: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

// ---------- helpers ----------

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [label, secs] of units) {
    const v = Math.floor(s / secs);
    if (v >= 1) return `${v} ${label}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

const esc = (t) => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
const xml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const badge = (l, msg, color, opts = "") => {
  const path = msg ? `${encodeURIComponent(l)}-${encodeURIComponent(msg)}-${color}` : `${encodeURIComponent(l)}-${color}`;
  return `![${l}](https://img.shields.io/badge/${path}?style=flat-square${opts})`;
};

// ---------- 1. recently pushed ----------

function card(repo) {
  const desc = repo.description ? esc(repo.description) : "_No description yet._";
  const lang = repo.language;
  const parts = [];
  if (lang) parts.push(badge(lang, "", LANG_COLORS[lang] || "64748B", `&logo=${lang.toLowerCase().replace(/[^a-z0-9]/g, "")}&logoColor=white`));
  if (repo.fork) parts.push(badge("Fork", "", "64748B"));
  const meta = [`${repo.stargazers_count} star${repo.stargazers_count === 1 ? "" : "s"}`, `updated ${ago(repo.pushed_at)}`];
  return `### [${repo.name}](${repo.html_url})\n\n${desc}\n\n${parts.join(" ")}${parts.length ? "  \n" : ""}<sub>${meta.join(" · ")}</sub>`;
}

function recentBlock(repos, stamp) {
  const rows = [];
  for (let i = 0; i < repos.length; i += 2) {
    const left = card(repos[i]);
    const right = repos[i + 1] ? card(repos[i + 1]) : "";
    rows.push(`<tr>\n<td width="50%" valign="top">\n\n${left}\n\n</td>\n<td width="50%" valign="top">\n\n${right}\n\n</td>\n</tr>`);
  }
  return `${START}\n<table>\n${rows.join("\n")}\n</table>\n\n<sub>Last synced ${stamp}</sub>\n${END}`;
}

// ---------- 2. metrics board ----------

const THEMES = {
  dark: { bg0: "#0b0f19", bg1: "#111827", border: "#1f2937", text: "#f1f5f9", muted: "#94a3b8", dim: "#64748b",
          accent: "#2dd4bf", accent2: "#3b82f6", tile: "#0f172a", cell0: "#1f2937",
          cells: ["#134e4a", "#0f766e", "#14b8a6", "#5eead4"] },
  light: { bg0: "#ffffff", bg1: "#f8fafc", border: "#e2e8f0", text: "#0f172a", muted: "#475569", dim: "#94a3b8",
           accent: "#0f766e", accent2: "#1d4ed8", tile: "#f1f5f9", cell0: "#e5e7eb",
           cells: ["#99f6e4", "#5eead4", "#14b8a6", "#0f766e"] },
};
const SANS = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace";

function streaks(days) {
  // days: [{date, count}] ascending
  let current = 0, longest = 0, run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  // current streak: walk back from the last day, allowing today to be empty
  let i = days.length - 1;
  if (days[i] && days[i].count === 0) i--;
  for (; i >= 0 && days[i].count > 0; i--) current++;
  return { current, longest };
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function metricsSvg(t, m) {
  const W = 1200, H = 380;
  const tiles = [
    ["Contributions", fmt(m.contributions), "last 12 months"],
    ["Current streak", `${m.streak.current}d`, `longest ${m.streak.longest}d`],
    ["Stars earned", fmt(m.stars), `across ${m.repos} public repos`],
    ["Followers", fmt(m.followers), "on GitHub"],
  ];
  const tileW = 262, gap = 24, x0 = 48, y0 = 56;
  const tilesSvg = tiles.map(([label, value, sub], i) => {
    const x = x0 + i * (tileW + gap);
    return `<g>
      <rect x="${x}" y="${y0}" width="${tileW}" height="96" rx="12" fill="${t.tile}" stroke="${t.border}"/>
      <rect x="${x}" y="${y0}" width="4" height="96" rx="2" fill="url(#accent)"/>
      <text x="${x + 22}" y="${y0 + 28}" font-family="${SANS}" font-size="12" font-weight="600" fill="${t.muted}" letter-spacing="1">${xml(label.toUpperCase())}</text>
      <text x="${x + 22}" y="${y0 + 66}" font-family="${SANS}" font-size="34" font-weight="700" fill="${t.text}" letter-spacing="-1">${xml(value)}</text>
      <text x="${x + 22}" y="${y0 + 84}" font-family="${SANS}" font-size="11" fill="${t.dim}">${xml(sub)}</text>
    </g>`;
  }).join("\n");

  // language bar
  const barY = 184, barX = 48, barW = 1104;
  const total = m.languages.reduce((s, l) => s + l.bytes, 0) || 1;
  let cursor = barX;
  const segs = [], legend = [];
  m.languages.forEach((l, i) => {
    const w = Math.max(3, Math.round((l.bytes / total) * barW));
    const color = `#${LANG_COLORS[l.name] || "64748B"}`;
    segs.push(`<rect x="${cursor}" y="${barY}" width="${w}" height="10" fill="${color}"/>`);
    const lx = barX + i * 150;
    legend.push(`<circle cx="${lx + 5}" cy="${barY + 30}" r="4.5" fill="${color}"/>
      <text x="${lx + 16}" y="${barY + 34}" font-family="${SANS}" font-size="12" fill="${t.muted}">${xml(l.name)} <tspan fill="${t.dim}">${((l.bytes / total) * 100).toFixed(1)}%</tspan></text>`);
    cursor += w;
  });

  // heatmap
  const cell = 12, cgap = 3, hx = 48, hy = 250;
  const cells = [];
  const max = Math.max(1, ...m.weeks.flatMap((w) => w.map((d) => d.count)));
  m.weeks.forEach((week, wi) => {
    week.forEach((d, di) => {
      let fill = t.cell0;
      if (d.count > 0) {
        const lvl = Math.min(3, Math.floor((d.count / max) * 4));
        fill = t.cells[lvl];
      }
      cells.push(`<rect x="${hx + wi * (cell + cgap)}" y="${hy + di * (cell + cgap)}" width="${cell}" height="${cell}" rx="2.5" fill="${fill}"><title>${d.date}: ${d.count}</title></rect>`);
    });
  });
  const heatW = m.weeks.length * (cell + cgap);
  const monthLabels = [];
  let lastMonth = "";
  m.weeks.forEach((week, wi) => {
    const mo = new Date(week[0].date).toLocaleString("en", { month: "short", timeZone: "UTC" });
    if (mo !== lastMonth) {
      monthLabels.push(`<text x="${hx + wi * (cell + cgap)}" y="${hy - 8}" font-family="${SANS}" font-size="10" fill="${t.dim}">${mo}</text>`);
      lastMonth = mo;
    }
  });
  const legendX = hx + heatW - 5 * 17 - 60;
  const heatLegend = `<text x="${legendX - 30}" y="${hy + 7 * 15 + 14}" font-family="${SANS}" font-size="10" fill="${t.dim}">Less</text>` +
    [t.cell0, ...t.cells].map((c, i) => `<rect x="${legendX + i * 17}" y="${hy + 7 * 15 + 4}" width="12" height="12" rx="2.5" fill="${c}"/>`).join("") +
    `<text x="${legendX + 5 * 17 + 4}" y="${hy + 7 * 15 + 14}" font-family="${SANS}" font-size="10" fill="${t.dim}">More</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub metrics for ${USER}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg0}"/><stop offset="1" stop-color="${t.bg1}"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#bg)" stroke="${t.border}"/>
  <text x="48" y="36" font-family="${SANS}" font-size="13" font-weight="600" fill="${t.muted}" letter-spacing="2">ACTIVITY</text>
  <text x="${W - 48}" y="36" text-anchor="end" font-family="${MONO}" font-size="11" fill="${t.dim}">synced ${m.stamp}</text>
${tilesSvg}
  ${segs.join("\n  ")}
  ${legend.join("\n  ")}
  ${monthLabels.join("\n  ")}
  ${cells.join("\n  ")}
  ${heatLegend}
</svg>
`;
}

async function buildMetrics(repos, stamp) {
  if (!TOKEN) {
    console.log("No GITHUB_TOKEN — skipping metrics board.");
    return;
  }
  const to = new Date();
  const from = new Date(to.getTime() - 364 * 86400 * 1000);
  const data = await graphql(
    `query($login:String!,$from:DateTime!,$to:DateTime!){
       user(login:$login){
         followers{ totalCount }
         contributionsCollection(from:$from,to:$to){
           contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
         }
       }
     }`,
    { login: USER, from: from.toISOString(), to: to.toISOString() }
  );
  const cal = data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })));
  const days = weeks.flat();

  const langTotals = {};
  await Promise.all(
    repos.filter((r) => !r.fork).map(async (r) => {
      const langs = await rest(`/repos/${USER}/${r.name}/languages`);
      for (const [name, bytes] of Object.entries(langs)) langTotals[name] = (langTotals[name] || 0) + bytes;
    })
  );
  const NOT_CODE = new Set(["Rich Text Format", "Text", "Markdown", "Roff", "TeX", "Batchfile"]);
  const languages = Object.entries(langTotals)
    .filter(([name]) => !NOT_CODE.has(name))
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 7);

  const m = {
    stamp,
    contributions: cal.totalContributions,
    streak: streaks(days),
    stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
    repos: repos.length,
    followers: data.user.followers.totalCount,
    languages,
    weeks,
  };

  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, theme] of Object.entries(THEMES)) {
    await writeFile(`${OUT_DIR}/metrics-${name}.svg`, metricsSvg(theme, m));
  }
  console.log(`Metrics board: ${m.contributions} contributions, streak ${m.streak.current}d, ${m.stars} stars, ${languages.length} languages.`);
}

// ---------- main ----------

async function main() {
  const stamp = new Date().toISOString().slice(0, 10);
  const all = (await rest(`/users/${USER}/repos?per_page=100&sort=pushed&type=owner`))
    .filter((r) => !r.archived && r.name.toLowerCase() !== USER.toLowerCase());

  const md = await readFile(README, "utf8");
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!re.test(md)) throw new Error("Markers not found in README.md");
  const next = md.replace(re, recentBlock(all.slice(0, COUNT), stamp));
  if (next !== md) {
    await writeFile(README, next);
    console.log(`README: updated ${Math.min(COUNT, all.length)} recent repos.`);
  } else {
    console.log("README: no changes.");
  }

  await buildMetrics(all, stamp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
