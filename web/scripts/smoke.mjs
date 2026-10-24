#!/usr/bin/env node
/**
 * Headless smoke test: drives the real UI via CDP against the dev server.
 * Requires the playwright chromium headless shell (already cached on this
 * machine) — not part of `npm test`; run manually:
 *   node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";

const BIN =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell";
const PORT = 9333;
const URL = "http://localhost:5173";

const proc = spawn(BIN, [
  "--headless",
  `--remote-debugging-port=${PORT}`,
  "--no-first-run",
  "--user-data-dir=/tmp/fantasy-draft-lab-smoke",
  "about:blank",
]);
await new Promise((r) => setTimeout(r, 1500));

const targets = await fetch(`http://localhost:${PORT}/json`).then((r) =>
  r.json(),
);
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);

let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(
      msg.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300),
    );
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");

const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    consoleErrors.push(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  }
  return r.result?.result?.value;
};

const clickText = (text) =>
  evalJs(
    `[...document.querySelectorAll('button')].find(b => b.innerText===${JSON.stringify(text)})?.click()`,
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyHas = (s) =>
  evalJs(`document.body.innerText.includes(${JSON.stringify(s)})`);

const log = (name, val) => console.log(`${val ? "PASS" : "FAIL"}  ${name}${val === true || val === false ? "" : " = " + val}`);

// ---- 1. Setup ----
await send("Page.navigate", { url: URL });
await sleep(2500);
log("setup screen renders", await bodyHas("Choose your draft slot"));

// pick slot 4 (index 3) so bots pick first
await evalJs(`document.querySelectorAll('.slot-grid .slot')[3].click()`);
await evalJs(
  `[...document.querySelectorAll('button')].find(b => b.innerText.startsWith('Start draft'))?.click()`,
);
await sleep(800);
log("draft screen renders", await bodyHas("Available players"));

// ---- 2. Bots pick until user's turn ----
await clickText("instant");
for (let w = 0; w < 50; w++) {
  if (await bodyHas("Your pick")) break;
  await sleep(200);
}
log("user turn reached after bot picks", await bodyHas("Your pick"));

// ---- 3. Inspect + draft a player ----
await evalJs(`document.querySelector('.player-table tbody tr')?.click()`);
await sleep(300);
log("inspection panel opens", await bodyHas("Draft player"));
log("before/after preview shown", await bodyHas("Roster projection"));
await clickText("Draft player");
await sleep(400);
log("roster has 1 player", (await evalJs(`document.querySelectorAll('.roster-list li:not(.empty)').length`)) === 1);
log("pick appears on board", await bodyHas("Recent:"));

// ---- 4. Autosave + resume after reload ----
await sleep(500);
await send("Page.navigate", { url: URL });
await sleep(1800);
log("resume offered after reload", await bodyHas("Saved drafts"));
await clickText("Resume");
await sleep(800);
log("roster restored", (await evalJs(`document.querySelectorAll('.roster-list li:not(.empty)').length`)) === 1);

// ---- 5. Pause/resume ----
await clickText("Pause");
await sleep(300);
// badge renders uppercase via CSS text-transform — check case-insensitively
log(
  "paused badge shows",
  await evalJs(`document.body.innerText.toLowerCase().includes('paused')`),
);
await clickText("Resume");
await clickText("instant");

// ---- 6. Finish the draft (auto-pick top row on each user turn) ----
let drafted = 0;
for (let i = 0; i < 16; i++) {
  for (let w = 0; w < 80; w++) {
    if ((await bodyHas("Your pick")) || (await bodyHas("Draft complete"))) break;
    await sleep(150);
  }
  if (await bodyHas("Draft complete")) break;
  await evalJs(`document.querySelector('.player-table tbody tr')?.click()`);
  await sleep(120);
  await clickText("Draft player");
  drafted++;
  await sleep(150);
}
await sleep(1200);
log("all 13 user picks made", drafted >= 12);
log("draft completes", await bodyHas("Draft complete"));
log("report renders", await bodyHas("Draft report"));
log("category matrix shown", await bodyHas("Category standings"));
log("pick history shown", await bodyHas("Pick history"));

// ---- 7. Rewind ----
const rewindClicked = await evalJs(
  `[...document.querySelectorAll('.pick-history .tiny')].at(-1)?.click(); true`,
);
await sleep(800);
log("rewind returns to draft screen", rewindClicked === true && (await bodyHas("Available players")));

console.log("\n--- console errors:", consoleErrors.length ? "" : "none");
consoleErrors.slice(0, 6).forEach((e) => console.log("  " + e));

proc.kill();
process.exit(consoleErrors.length ? 1 : 0);
