// Admin screenshots as the loopback operator (no login). Usage: node shoot-admin.mjs <playwrightDir> <outDir>
import { createRequire } from "node:module";

const [pwDir, out] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwDir);
const BASE = "http://127.0.0.1:8787";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
  log(`shot ${name}`);
};
const theme = async (t) => {
  await page.evaluate((v) => (document.documentElement.dataset.theme = v), t);
  await page.waitForTimeout(250);
};
const go = async (path) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
};
const ask = async (question) => {
  const box = page.getByLabel("Question");
  await box.fill(question);
  await box.press("Enter");
};
const waitAnswerDone = async () => {
  await page.waitForFunction(() => !document.querySelector('[role="status"][aria-live="polite"]'), null, { timeout: 150000 });
  await page.waitForTimeout(1000);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    log(`FAILED ${name}: ${error?.message?.split("\n")[0]}`);
    await page.screenshot({ path: `${out}/fail-${name}.png` }).catch(() => {});
  }
};

await step("overview", async () => {
  await go("/admin/overview");
  await shot("10-overview-light");
  await theme("dark");
  await shot("10-overview-dark");
  await theme("light");
});
await step("sources", async () => {
  await go("/admin/sources");
  await shot("11-sources-light");
  await page.getByRole("button", { name: "Upload documents" }).click();
  await page.waitForTimeout(500);
  await shot("12-upload-dialog-light");
  await page.keyboard.press("Escape");
});
await step("people", async () => {
  await go("/admin/people");
  await page.locator('[role="row"]').nth(2).hover().catch(() => {});
  await shot("13-people-light");
  await page.getByRole("tab", { name: /Groups/ }).click();
  await shot("13-groups-light");
});
await step("evals", async () => {
  await go("/admin/evals");
  await shot("14-evals-light");
});
await step("activity", async () => {
  await go("/admin/activity");
  const first = page.locator('[role="row"] button').first();
  if (await first.count()) await first.click();
  await page.waitForTimeout(1200);
  await shot("15-activity-light");
});
await step("settings", async () => {
  await go("/chat?settings=1");
  await page.waitForTimeout(1200);
  await shot("16-settings-admin-appearance-light");
  await page.getByRole("button", { name: /Model and retrieval/ }).click();
  await page.waitForTimeout(800);
  await shot("16-settings-admin-model-light");
});
await step("skip-answer", async () => {
  await go("/chat");
  await ask("How much parental leave do I get, and when am I eligible?");
  await waitAnswerDone();
  await page.getByRole("button", { name: /^Citation/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot("02-chat-answer-evidence-admin-light");
  await page.getByRole("tab", { name: /Retrieved/ }).click().catch(() => {});
  await shot("02-chat-retrieved-admin-light");
});
await step("approval", async () => {
  await page.getByRole("link", { name: /New chat/ }).first().click();
  await page.waitForTimeout(800);
  await ask("Open a P1 ticket for Halvorsen Freight. Atlas sync has been stalled since 06:10 and their orders aren't flowing.");
  await waitAnswerDone();
  await shot("05-chat-approval-pending-light");
  const approve = page.getByRole("button", { name: "Approve and run" });
  if (await approve.count()) {
    await approve.click();
    await page.waitForFunction(() => /Ticket SUP-\d+ created/.test(document.body.innerText), null, { timeout: 60000 });
    await shot("05-chat-approval-done-light");
  } else {
    log("no approval card");
  }
});
await step("view-as", async () => {
  await go("/admin/people");
  const row = page.locator('[role="row"]', { hasText: "Priya Shah" }).first();
  await row.hover();
  await row.getByRole("button", { name: /View as/ }).click();
  await page.waitForURL(/viewAs=/);
  await page.waitForLoadState("networkidle");
  await ask("What are the salary bands for a senior support engineer?");
  await waitAnswerDone();
  await shot("13-viewing-as-light");
});
await browser.close();
