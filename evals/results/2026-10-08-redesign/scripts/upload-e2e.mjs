// Real upload pipeline E2E as the loopback admin. Usage: node upload-e2e.mjs <playwrightDir> <outDir> <file>
import { createRequire } from "node:module";

const [pwDir, out, file] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwDir);
const BASE = "http://127.0.0.1:8787";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
page.setDefaultTimeout(60000);
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  log(`shot ${name}`);
};
const text = () => page.evaluate(() => document.body.innerText);
try {
  await page.goto(`${BASE}/admin/sources`);
  await page.waitForLoadState("networkidle");
  const discard = page.getByRole("button", { name: "Discard" }).first();
  if (await discard.count()) {
    await discard.click();
    await page.waitForTimeout(400);
    await page.getByRole("dialog").getByRole("button", { name: /Discard/ }).click();
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await shot("11-sources-after-discard-light");
  }
  await page.getByRole("button", { name: "Upload documents" }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(1500);
  await shot("12-upload-dialog-progress-light");
  const started = Date.now();
  while (Date.now() - started < 6 * 60_000) {
    const t = await text();
    if (/1 of 1 ready|files ready|1 file ready/i.test(t)) break;
    if (/failed|could not/i.test(t) && /Upload documents/.test(t)) log("dialog mentions a failure");
    await page.waitForTimeout(3000);
  }
  await shot("12-upload-dialog-ready-light");
  const add = page.getByRole("button", { name: "Add to draft" });
  if (await add.isEnabled()) await add.click();
  await page.waitForTimeout(1500);
  await shot("11-sources-draft-building-light");
  const checksStart = Date.now();
  let state = "unknown";
  while (Date.now() - checksStart < 15 * 60_000) {
    await page.reload();
    await page.waitForLoadState("networkidle");
    const t = await text();
    if (/Checks passed/.test(t)) { state = "passed"; break; }
    if (/Checks failed|checks failed/.test(t)) { state = "failed"; break; }
    if (/Checks paused/.test(t)) { state = "paused"; break; }
    await page.waitForTimeout(10_000);
  }
  log(`draft checks: ${state} after ${Math.round((Date.now() - checksStart) / 1000)} s`);
  await shot(`11-sources-draft-${state}-light`);
  if (state === "passed") {
    await page.getByRole("button", { name: "Promote draft" }).first().click();
    await page.waitForTimeout(500);
    await shot("11-sources-promote-confirm-light");
    const confirm = page.getByRole("dialog").getByRole("button", { name: /Promote/ });
    await confirm.click();
    await page.waitForTimeout(4000);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await shot("11-sources-promoted-light");
  }
} catch (error) {
  log(`ERROR ${error?.message?.split("\n")[0]}`);
  await page.screenshot({ path: `${out}/upload-error-state.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
