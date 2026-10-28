#!/usr/bin/env node
/**
 * Headless smoke test: drives the real UI via CDP against the dev server.
 * Requires the playwright chromium headless shell (already cached on this
 * machine) — not part of `npm test`; run manually:
 *   node scripts/smoke.mjs            (SMOKE_CHROME=/path/to/chrome to override the binary)
 */
import { spawn } from "node:child_process";

const BIN =
  process.env.SMOKE_CHROME ??
  process.env.HOME +
    "/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell";
const PORT = 9333;
const URL = process.env.SMOKE_URL ?? "http://localhost:5173";

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
// A laptop-sized window: the build screens and the room are laid out as one fixed screen there.
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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

const waitFor = async (pred, tries = 80, ms = 200) => {
  for (let w = 0; w < tries; w++) {
    if (await pred()) return true;
    await sleep(ms);
  }
  return false;
};
const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const setSpeed = (v) =>
  evalJs(`(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'instant'));
    if (!s) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(v)});
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
const myRoster = () => count(".team-panel .roster li:not(.now):not(.empty)");

// ---- 1. Setup ----
await send("Page.navigate", { url: URL });
await sleep(2500);
log("setup screen renders", await bodyHas("Choose your session slot"));

// pick slot 4 (index 3) so rivals pick first
await evalJs(`document.querySelectorAll('.slot-grid .slot')[3].click()`);
await sleep(600);
log("opponents preview shown", await bodyHas("Your opponents"));
await evalJs(
  `[...document.querySelectorAll('button')].find(b => b.innerText.startsWith('Start session'))?.click()`,
);
await sleep(800);
await setSpeed("instant");

// ---- 2. First pick: build options ----
log("first-pick screen reached", await waitFor(() => bodyHas("Your first pick sets your build")));
log("build options load", await waitFor(() => count(".build-card").then((n) => n > 0), 150));
log("every player in range is listed", await evalJs(`(() => { const t = document.body.innerText.match(/(\\d+) players tested/); const n = document.querySelectorAll('.build-card, .build-row').length; return !!t && Number(t[1]) === n && n >= 10; })()`));
log("build screen fits one screen", await evalJs(`document.documentElement.scrollHeight <= innerHeight + 1`));
log("feed says it's your turn", await evalJs(`!!document.querySelector('.feed.yours')`));
await evalJs(`document.querySelector('.build-detail .btn.primary')?.click()`);
log("panel stays on your pick", await waitFor(() => evalJs(`!!document.querySelector('.player-panel .panel-state.yours')`), 20, 100));
log("room is watching", await evalJs(`!!document.querySelector('.feed.watching') && !document.querySelector('.player-panel .btn.primary')`));

// ---- 3. Second pick: finish the build ----
log("second-pick screen reached", await waitFor(() => bodyHas("Finish your build")));
log("second-pick options load", await waitFor(() => count(".build-card").then((n) => n > 0), 150));
await evalJs(`document.querySelector('.build-detail .btn.primary')?.click()`);

// ---- 4. Draft room ----
log("draft room renders", await waitFor(() => bodyHas("Available players")));
log("build banner shows concede", await bodyHas("Your build"));
await waitFor(() => bodyHas("Draft ") && evalJs(`!!document.querySelector('.player-panel .btn.primary:not(:disabled)')`));
log("roster has 2 players", (await myRoster()) === 2);
// Table state survives the rival run and the board holds while rivals pick.
await evalJs(`document.querySelector('[aria-label="Sort by Value"]')?.click()`);
await evalJs(`document.querySelector('.player-panel .btn.primary')?.click()`);
await sleep(120);
log("taken rows stay in place during the rival run", await evalJs(`document.querySelectorAll('.fit-table tr.taken').length > 0`));
log("board held while rivals pick", await bodyHas("Board held"));
await waitFor(() => evalJs(`!!document.querySelector('.player-panel .btn.primary:not(:disabled)')`));
log("sort survives the rival run", await evalJs(`document.querySelector('.sort-btn.on')?.innerText.trim() === 'Value'`));
log("taken rows settle on your turn", await evalJs(`document.querySelectorAll('.fit-table tr.taken').length === 0`));
await evalJs(`document.querySelector('[aria-label="Sort by Fit"]')?.click()`);

// ---- 5. Autosave + resume after reload ----
await sleep(500);
await send("Page.navigate", { url: URL });
await sleep(1800);
log("resume offered after reload", await bodyHas("Pick up where you left off"));
await clickText("Resume session");
await waitFor(() => bodyHas("Available players"));
log("roster restored", (await myRoster()) === 3);

// ---- 6. Pause/resume ----
await clickText("Pause");
await sleep(300);
log("paused badge shows", await evalJs(`document.body.innerText.toLowerCase().includes('paused')`));
await clickText("Resume");
await setSpeed("instant");

// ---- 7. Finish the draft (take the top Fit on each user turn) ----
let drafted = 0;
for (let i = 0; i < 16; i++) {
  await waitFor(
    async () =>
      (await bodyHas("Draft complete")) ||
      (await evalJs(`!!document.querySelector('.player-panel .btn.primary:not(:disabled)')`)),
  );
  if (await bodyHas("Draft complete")) break;
  await evalJs(`document.querySelector('.player-panel .btn.primary:not(:disabled)')?.click()`);
  drafted++;
  await sleep(300);
}
await sleep(1200);
log("remaining 10 user picks made", drafted >= 10);
log("draft completes", await bodyHas("Draft complete"));
log("paper record shown", await evalJs(`!!document.querySelector('.recap-num.record')`));
log("week-to-week win rate shown next to it", await evalJs(`/^\\d+%$/.test(document.querySelectorAll('.recap-num')[1]?.innerText ?? '')`));
log("standings carry both columns", await bodyHas("Category standings") && await bodyHas("Week to week"));
log("conceded category keeps its rank", await evalJs(`[...document.querySelectorAll('.standings-table .rank-cell.conceded')].every(c => /^\\d+$/.test(c.innerText))`));
log("matchup for every opponent", (await count('.duel-row')) === 11);
log("matchup detail explains with players", await evalJs(`document.querySelectorAll('.tape .tape-row').length === 9 && document.querySelectorAll('.tape .decider').length >= 9`));
const firstDetail = await evalJs(`document.querySelector('.duel-detail h3')?.innerText`);
await evalJs(`document.querySelectorAll('.duel-row')[3]?.click()`);
await sleep(200);
log("picking an opponent switches the detail", firstDetail !== (await evalJs(`document.querySelector('.duel-detail h3')?.innerText`)));
log("pick history shown", (await count(".picks-card .roster li")) === 13);

// ---- 8. Rewind ----
const rewindClicked = await evalJs(
  `[...document.querySelectorAll('.picks-card .link-btn')].at(-1)?.click(); true`,
);
await sleep(800);
log("rewind returns to draft room", rewindClicked === true && (await bodyHas("Available players")));

console.log("\n--- console errors:", consoleErrors.length ? "" : "none");
consoleErrors.slice(0, 6).forEach((e) => console.log("  " + e));

proc.kill();
process.exit(consoleErrors.length ? 1 : 0);
