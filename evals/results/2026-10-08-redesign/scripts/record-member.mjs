// Member reshoot plus frame recordings (CDP screencast, every paint). Password read from disk, never printed.
// Usage: node record-member.mjs <playwrightDir> <outDir> <passFile>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const [pwDir, out, passFile] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwDir);
const BASE = "http://127.0.0.1:8787";
const pass = readFileSync(passFile, "utf8").trim();
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  log(`shot ${name}`);
};
const theme = async (t) => {
  await page.evaluate((v) => (document.documentElement.dataset.theme = v), t);
  await page.waitForTimeout(250);
};
const ask = async (q) => {
  const box = page.getByLabel("Question");
  await box.fill(q);
  await box.press("Enter");
};
const waitAnswerDone = async () => {
  await page.waitForFunction(() => !document.querySelector('[role="status"][aria-live="polite"]'), null, { timeout: 150000 });
  await page.waitForTimeout(800);
};

// Screencast recorder: saves every frame Chrome paints, with its timestamp.
async function record(name) {
  const dir = `${out}/frames-${name}`;
  mkdirSync(dir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  let i = 0;
  const times = [];
  cdp.on("Page.screencastFrame", async (frame) => {
    const n = String(i++).padStart(4, "0");
    writeFileSync(`${dir}/frame-${n}.jpg`, Buffer.from(frame.data, "base64"));
    times.push(frame.metadata.timestamp);
    await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  return async () => {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    const gaps = times.slice(1).map((t, k) => t - times[k]);
    const maxGapMs = gaps.length ? Math.round(Math.max(...gaps) * 1000) : 0;
    writeFileSync(`${dir}/timing.json`, JSON.stringify({ frames: times.length, seconds: span, maxGapMs }, null, 2));
    log(`recorded ${name}: ${times.length} frames over ${span.toFixed(2)} s, max gap ${maxGapMs} ms`);
  };
}

try {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("maya.chen@northwind.example");
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/chat/);
  await page.waitForLoadState("networkidle");
  await shot("01-chat-empty-light");

  // Working status line, frame by frame.
  const stopWorking = await record("status-line");
  await ask("How much parental leave do I get, and when am I eligible?");
  await page.waitForSelector('[role="status"]');
  await page.waitForTimeout(600);
  await shot("03-chat-working-light");
  await waitAnswerDone();
  await page.waitForTimeout(600);
  await stopWorking();
  const conversationUrl = page.url();

  // Linked hover signature, frame by frame.
  await page.getByRole("button", { name: /^Citation 1/ }).first().click();
  await page.waitForTimeout(600);
  await shot("02-chat-answer-evidence-light");
  const stopHover = await record("hover-signature");
  const c2 = page.getByRole("button", { name: /^Citation 2/ }).first();
  await c2.hover();
  await page.waitForTimeout(700);
  await shot("02-chat-answer-hover-c2-light");
  await page.mouse.move(700, 700);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Source 1/ }).first().hover().catch(() => {});
  await page.waitForTimeout(700);
  await stopHover();
  await theme("dark");
  await shot("02-chat-answer-evidence-dark");
  await theme("light");
  await page.getByRole("button", { name: /Open document/ }).first().click();
  await page.waitForTimeout(1500);
  await shot("07-document-reader-light");

  // New chat must reset the panel; no-evidence state.
  await page.getByRole("link", { name: /New chat/ }).first().click();
  await page.waitForTimeout(800);
  await shot("01-chat-empty-after-new-chat-light");
  await ask("When is the 2027 company holiday calendar published?");
  await waitAnswerDone();
  await shot("04-chat-no-evidence-light");

  // Search footer.
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("parental");
  await page.waitForTimeout(1500);
  await shot("08-search-light");
  await page.keyboard.press("Escape");

  // Mobile and tablet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(conversationUrl);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await shot("18-mobile-chat");
  const summary = page.getByRole("button", { name: /passages/ }).first();
  if (await summary.count()) {
    await summary.click();
    await page.waitForTimeout(800);
    await shot("18-mobile-evidence-sheet");
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: /Open menu/i }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shot("18-mobile-rail");
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(conversationUrl);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Citation 1/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot("18-tablet-1000-sheet");
} catch (error) {
  log(`ERROR ${error?.message?.split("\n")[0]}`);
  await page.screenshot({ path: `${out}/member-error-state.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
