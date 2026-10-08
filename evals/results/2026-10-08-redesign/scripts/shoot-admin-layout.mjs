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
await browser.close();
