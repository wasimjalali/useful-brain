// axe scan (light + dark) and a keyboard focus pass on the running app.
// Usage: node a11y.mjs <pwDir> <axeFile> <outJson> <passFile>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const [pwDir, axeFile, outJson, passFile] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwDir);
const pass = readFileSync(passFile, "utf8").trim();
const BASE = "http://127.0.0.1:8787";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { axe: [], keyboard: [] };

async function scan(page, label) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.waitForTimeout(300);
    await page.addScriptTag({ path: axeFile });
    const result = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ["violations"] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ")) }));
    });
    report.axe.push({ page: label, theme, violations: result });
    console.log(`${label} [${theme}] ${result.length} violations${result.length ? ": " + result.map((v) => `${v.id}(${v.impact},${v.nodes})`).join(", ") : ""}`);
  }
}

async function keyboard(page, label, presses = 30) {
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.mouse.click(5, 5).catch(() => {});
  const stops = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" && cs.outlineColor !== "rgba(0, 0, 0, 0)") || (cs.boxShadow && cs.boxShadow !== "none");
      const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.getAttribute("placeholder") || el.tagName;
      return { tag: el.tagName.toLowerCase(), name, ring: Boolean(ring) };
    });
    if (info) stops.push(info);
  }
  const noRing = stops.filter((s) => !s.ring);
  report.keyboard.push({ page: label, stops: stops.length, withoutVisibleFocus: noRing });
  console.log(`${label} keyboard: ${stops.length} stops, ${noRing.length} without a visible focus style${noRing.length ? ": " + noRing.map((s) => s.name).join(" | ") : ""}`);
}

// Signed out
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await scan(page, "login");
  await keyboard(page, "login", 8);
  await page.close();
}
// Member
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("maya.chen@northwind.example");
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/chat/);
  await page.waitForLoadState("networkidle");
  await scan(page, "chat-empty");
  await keyboard(page, "chat-empty", 20);
  const first = page.locator("a[href^='/chat/']").first();
  if (await first.count()) {
    await first.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^Citation 1/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await scan(page, "chat-answer-evidence");
    await keyboard(page, "chat-answer-evidence", 40);
  }
  await page.goto(`${BASE}/library`);
  await page.waitForLoadState("networkidle");
  await scan(page, "library");
  await keyboard(page, "library", 25);
  await page.goto(`${BASE}/chat?settings=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await scan(page, "settings-member");
  await ctx.close();
}
// Admin (loopback)
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (const path of ["/admin/overview", "/admin/sources", "/admin/people", "/admin/evals", "/admin/activity"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await scan(page, path);
    await keyboard(page, path, 25);
  }
}
await browser.close();
writeFileSync(outJson, JSON.stringify(report, null, 2));
