#!/usr/bin/env node
/**
 * Verifies a capture-the-flag submission (see .github/workflows/ctf.yml).
 *
 * The issue body is untrusted input: it arrives through an env var, is only
 * searched for a 64-char hex digest, and is never echoed back or executed.
 * A valid proof is sha256(`${flag}:${login}`), so a proof posted publicly in
 * one issue is useless to anyone else. Solvers are added to the README's
 * hall of fame; the workflow commits the change.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const { CTF_FLAG, ISSUE_BODY = "", ISSUE_LOGIN, ISSUE_NUMBER, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
const README = "README.md";
const START = "<!--CTF_HOF:START-->";
const END = "<!--CTF_HOF:END-->";

async function api(path, body) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${ISSUE_NUMBER}${path}`, {
    method: path ? "POST" : "PATCH",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
}

const reply = (text) => api("/comments", { body: text });
const close = (reason) => api("", { state: "closed", state_reason: reason });

async function main() {
  if (!CTF_FLAG) {
    await reply("The verifier isn't armed yet, so I can't check proofs right now. Leave this open and it will be reviewed.");
    return;
  }
  const proof = ISSUE_BODY.match(/\b[0-9a-fA-F]{64}\b/)?.[0]?.toLowerCase();
  const expected = createHash("sha256").update(`${CTF_FLAG}:${ISSUE_LOGIN}`).digest("hex");
  if (!proof || !timingSafeEqual(Buffer.from(proof), Buffer.from(expected))) {
    await reply("Not quite. The proof is `sha256(flag + ':' + your_github_login)` as 64 hex characters. The signal is still out there.");
    await close("not_planned");
    return;
  }

  const md = await readFile(README, "utf8");
  const re = new RegExp(`${START}([\\s\\S]*?)${END}`);
  const current = md.match(re)?.[1] ?? "";
  const solvers = [...current.matchAll(/\[@([\w-]+)\]/g)].map((m) => m[1]);
  const fresh = !solvers.some((s) => s.toLowerCase() === ISSUE_LOGIN.toLowerCase());
  if (fresh) solvers.push(ISSUE_LOGIN);
  const list = solvers.map((s, i) => `${i + 1}. [@${s}](https://github.com/${s})`).join("\n");
  await writeFile(README, md.replace(re, `${START}\n${list}\n${END}`));

  await reply(fresh
    ? `🚩 Signal decoded. Welcome to the hall of fame, @${ISSUE_LOGIN}: you're solver #${solvers.length}.`
    : `🚩 Still correct, @${ISSUE_LOGIN}. You're already in the hall of fame.`);
  await close("completed");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
