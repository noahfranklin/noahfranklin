#!/usr/bin/env node
/**
 * Profile generator. Runs in CI on a schedule (see .github/workflows/update-readme.yml).
 *
 *  1. Rewrites the "Latest commits" section of README.md from my most recently
 *     pushed public repos.
 *  2. Renders assets/generated/metrics-{dark,light}.svg — a self-hosted metrics
 *     board (stars, forks, projects, contributions, language mix).
 *  3. Renders assets/generated/badge-*.svg — follower, star, and Gideon skill
 *     counts drawn here instead of fetched from shields.io, which intermittently
 *     renders "invalid".
 *  4. Writes assets/generated/stats.json, which scripts/build-hero.py reads to
 *     plot real repos on the hero radar and type the latest commit.
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
const HOF_START = "<!--CTF_HOF:START-->";
const HOF_END = "<!--CTF_HOF:END-->";
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

const xml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- 0. count badges ----------

// Approximate Verdana 11px advance widths, enough to size a badge.
const textWidth = (t) => [...t].reduce((w, ch) => w + (/[ijlI.,:;|!' ]/.test(ch) ? 3.6 : /[mwMW]/.test(ch) ? 9.5 : /[A-Z0-9★]/.test(ch) ? 7.4 : 6.2), 0);

function countBadge(label, value, color = "0f766e") {
  const lw = Math.round(textWidth(label) + 14), vw = Math.round(textWidth(value) + 14), W = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" role="img" aria-label="${xml(label)}: ${xml(value)}">
  <rect width="${lw}" height="20" fill="#0f172a"/><rect x="${lw}" width="${vw}" height="20" fill="#${color}"/>
  <g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${lw / 2}" y="14">${xml(label)}</text><text x="${lw + vw / 2}" y="14" font-weight="700">${xml(value)}</text>
  </g>
</svg>
`;
}

async function writeBadges(own, followers, md) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/badge-followers.svg`, countBadge("Followers", fmt(followers)));
  // Only repos the README actually shows a star badge for.
  for (const r of own.filter((r) => md.includes(`badge-stars-${r.name}.svg`))) {
    await writeFile(`${OUT_DIR}/badge-stars-${r.name}.svg`, countBadge("★ stars", fmt(r.stargazers_count), "475569"));
  }
  const tree = await rest(`/repos/${USER}/gideon/git/trees/HEAD?recursive=1`).catch(() => null);
  const skills = tree?.tree.filter((f) => f.path.endsWith("/SKILL.md")).length;
  if (skills) await writeFile(`${OUT_DIR}/badge-gideon-skills.svg`, countBadge("skills", String(skills)));
  return skills || null;
}

// ---------- 1. latest commits ----------

async function recentCommits(repos) {
  const lists = await Promise.all(
    repos.slice(0, 4).map(async (r) =>
      (await rest(`/repos/${USER}/${r.name}/commits?per_page=${COUNT}`).catch(() => []))
        .filter((c) => c.parents.length < 2)
        .map((c) => ({ repo: r.name, sha: c.sha.slice(0, 7), url: c.html_url, message: c.commit.message.split("\n")[0], date: c.commit.committer.date }))
    )
  );
  return lists.flat().sort((a, b) => b.date.localeCompare(a.date)).slice(0, COUNT);
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function commitsBlock(commits, stamp) {
  const rows = commits.map((c) =>
    `<tr>\n<td><a href="${c.url}"><code>${c.sha}</code></a></td>\n<td><a href="https://github.com/${USER}/${c.repo}"><strong>${xml(c.repo)}</strong></a></td>\n<td>${xml(clip(c.message, 72))}</td>\n<td><sub>${ago(c.date)}</sub></td>\n</tr>`
  );
  return `${START}\n<table>\n${rows.join("\n")}\n</table>\n\n<sub>Last synced ${stamp}</sub>\n${END}`;
}

// ---------- 2. metrics board ----------

const THEMES = {
  dark: { bg0: "#0b0f19", bg1: "#111827", border: "#1f2937", text: "#f1f5f9", muted: "#94a3b8", dim: "#64748b",
          accent: "#2dd4bf", accent2: "#3b82f6", tile: "#0f172a" },
  light: { bg0: "#ffffff", bg1: "#f8fafc", border: "#e2e8f0", text: "#0f172a", muted: "#475569", dim: "#94a3b8",
           accent: "#0f766e", accent2: "#1d4ed8", tile: "#f1f5f9" },
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
  const W = 1200, H = 260;
  const tiles = [
    ["Stars earned", fmt(m.stars), `top: ${m.topRepo}`],
    ["Forked by others", fmt(m.forks), "people building on my work"],
    ["Public projects", fmt(m.repos), `${m.languages.length} languages in use`],
    ["Contributions", fmt(m.contributions), `last 12 months · best run ${m.streak.longest}d`],
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
    stars: repos.filter((r) => !r.fork).reduce((s, r) => s + r.stargazers_count, 0),
    forks: repos.filter((r) => !r.fork).reduce((s, r) => s + r.forks_count, 0),
    topRepo: repos.filter((r) => !r.fork).sort((a, b) => b.stargazers_count - a.stargazers_count)[0]?.name || "—",
    repos: repos.filter((r) => !r.fork).length,
    followers: data.user.followers.totalCount,
    languages,
    weeks,
  };

  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, theme] of Object.entries(THEMES)) {
    await writeFile(`${OUT_DIR}/metrics-${name}.svg`, metricsSvg(theme, m));
  }
  console.log(`Metrics board: ${m.contributions} contributions, ${m.stars} stars, ${m.forks} forks, ${languages.length} languages.`);
  return m;
}

// ---------- main ----------

async function main() {
  const stamp = new Date().toISOString().slice(0, 10);
  const all = (await rest(`/users/${USER}/repos?per_page=100&sort=pushed&type=owner`))
    .filter((r) => !r.archived && r.name.toLowerCase() !== USER.toLowerCase());
  const own = all.filter((r) => !r.fork);

  const md = await readFile(README, "utf8");
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!re.test(md)) throw new Error("Markers not found in README.md");
  const commits = await recentCommits(own);
  const next = md.replace(re, commitsBlock(commits, stamp));
  if (next !== md) {
    await writeFile(README, next);
    console.log(`README: updated ${commits.length} recent commits.`);
  } else {
    console.log("README: no changes.");
  }

  const m = await buildMetrics(all, stamp);
  const followers = m?.followers ?? (await rest(`/users/${USER}`)).followers;
  const skills = await writeBadges(own, followers, next);

  const hof = next.match(new RegExp(`${HOF_START}([\\s\\S]*?)${HOF_END}`))?.[1].match(/github\.com\/[\w-]+\)/g) || [];
  const stats = {
    stamp,
    followers,
    stars: own.reduce((s, r) => s + r.stargazers_count, 0),
    forks: own.reduce((s, r) => s + r.forks_count, 0),
    skills,
    solvers: hof.length,
    commit: commits[0] || null,
    repos: own.map((r) => ({ name: r.name, stars: r.stargazers_count, pushed: r.pushed_at, topics: r.topics || [], description: r.description || "" })),
  };
  await writeFile(`${OUT_DIR}/stats.json`, JSON.stringify(stats, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
