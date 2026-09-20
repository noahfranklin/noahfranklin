#!/usr/bin/env node
/**
 * Rewrites the "Recently Pushed" section of README.md with the user's
 * most recently updated public repos, pulled live from the GitHub API.
 * Runs in CI on a schedule (see .github/workflows/update-readme.yml).
 *
 * No dependencies — uses Node 20+ global fetch.
 */

import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "noahfranklin";
const README = "README.md";
const START = "<!--RECENT_REPOS:START-->";
const END = "<!--RECENT_REPOS:END-->";
const COUNT = 6;

// Common language -> hex color (GitHub linguist-ish). Fallback is slate.
const LANG_COLORS = {
  TypeScript: "3178C6", JavaScript: "F7DF1E", Python: "3776AB", Go: "00ADD8",
  Rust: "DE4B25", "C++": "00599C", C: "555555", Java: "B07219", PHP: "777BB4",
  Shell: "89E051", HTML: "E34C26", CSS: "563D7C", Ruby: "CC342D", Dockerfile: "384D54",
};

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": USER,
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

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
const badge = (l, msg, color, opts = "") => {
  const path = msg ? `${encodeURIComponent(l)}-${encodeURIComponent(msg)}-${color}` : `${encodeURIComponent(l)}-${color}`;
  return `![${l}](https://img.shields.io/badge/${path}?style=flat-square${opts})`;
};

function card(repo) {
  const name = repo.name;
  const url = repo.html_url;
  const desc = repo.description ? esc(repo.description) : "_No description yet._";
  const lang = repo.language;
  const parts = [];
  if (lang) parts.push(badge(lang, "", LANG_COLORS[lang] || "64748B", `&logo=${lang.toLowerCase().replace(/[^a-z0-9]/g, "")}&logoColor=white`));
  if (repo.fork) parts.push(badge("Fork", "", "64748B"));
  const meta = [`${repo.stargazers_count} star${repo.stargazers_count === 1 ? "" : "s"}`, `updated ${ago(repo.pushed_at)}`];
  return `### [${name}](${url})\n\n${desc}\n\n${parts.join(" ")}${parts.length ? "  \n" : ""}<sub>${meta.join(" · ")}</sub>`;
}

async function main() {
  const res = await fetch(
    `https://api.github.com/users/${USER}/repos?per_page=100&sort=pushed&type=owner`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const repos = (await res.json())
    .filter((r) => !r.archived && r.name.toLowerCase() !== USER.toLowerCase())
    .slice(0, COUNT);

  const rows = [];
  for (let i = 0; i < repos.length; i += 2) {
    const left = card(repos[i]);
    const right = repos[i + 1] ? card(repos[i + 1]) : "";
    rows.push(
      `<tr>\n<td width="50%" valign="top">\n\n${left}\n\n</td>\n<td width="50%" valign="top">\n\n${right}\n\n</td>\n</tr>`
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const block =
    `${START}\n<table>\n${rows.join("\n")}\n</table>\n\n` +
    `<sub>Last synced ${stamp}</sub>\n${END}`;

  const md = await readFile(README, "utf8");
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!re.test(md)) throw new Error("Markers not found in README.md");
  const next = md.replace(re, block);

  if (next === md) {
    console.log("No changes.");
    return;
  }
  await writeFile(README, next);
  console.log(`Updated ${repos.length} repos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
