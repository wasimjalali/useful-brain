// Member screenshots against the local preview stack. Reads the throwaway demo password from disk;
// it is never printed. Usage: node shoot-member.mjs <playwrightDir> <outDir> <passFile>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [pwDir, out, passFile] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwDir);
const BASE = "http://127.0.0.1:8787";
const pass = readFileSync(passFile, "utf8").trim();
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  log(`shot ${name}`);
};
const theme = async (t) => {
  await page.evaluate((v) => {
    if (v === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
  }, t);
  await page.waitForTimeout(250);
};
const ask = async (question) => {
  const box = page.getByLabel("Question");
  await box.fill(question);
  await box.press("Enter");
};
const waitAnswerDone = async () => {
  await page.waitForFunction(() => !document.querySelector('[role="status"][aria-live="polite"]'), null, { timeout: 120000 });
  await page.waitForTimeout(800);
};

try {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await shot("17-sign-in-light");
  await page.getByLabel("Email").fill("maya.chen@northwind.example");
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/chat/);
  await page.waitForLoadState("networkidle");
  await shot("01-chat-empty-light");
  await theme("dark");
  await shot("01-chat-empty-dark");
  await theme("light");

  // 03 working + 02 answer
  await ask("How much parental leave do I get, and when am I eligible?");
  await page.waitForSelector('[role="status"]');
  await page.waitForTimeout(700);
  await shot("03-chat-working-light");
  await waitAnswerDone();
  const chip = page.getByRole("button", { name: /^Citation 1/ }).first();
  if (await chip.count()) {
    await chip.click();
  }
  await page.waitForTimeout(600);
  await shot("02-chat-answer-evidence-light");
  const chip2 = page.getByRole("button", { name: /^Citation 2/ }).first();
  if (await chip2.count()) {
    await chip2.hover();
    await page.waitForTimeout(400);
    await shot("02-chat-answer-hover-c2-light");
  }
  await theme("dark");
  await shot("02-chat-answer-evidence-dark");
  await theme("light");
  const retrieved = page.getByRole("tab", { name: /Retrieved/ });
  if (await retrieved.count()) {
    await retrieved.click();
    await shot("02-chat-retrieved-light");
    await page.getByRole("tab", { name: /Cited/ }).click();
  }
  const openDoc = page.getByRole("button", { name: /Open document/ }).first();
  if (await openDoc.count()) {
    await openDoc.click();
    await page.waitForTimeout(1500);
    await shot("07-document-reader-light");
  }

  // 04 no evidence
  await page.getByRole("link", { name: /New chat/ }).first().click();
  await page.waitForTimeout(800);
  await ask("When is the 2027 company holiday calendar published?");
  await waitAnswerDone();
  await shot("04-chat-no-evidence-light");
  const req = page.getByRole("button", { name: "Request this document" });
  if (await req.count()) {
    await req.click();
    await page.waitForTimeout(1200);
    await shot("04-chat-no-evidence-requested-light");
  }

  // 06 error: abort the next ask transport so the real error path renders
  await page.getByRole("link", { name: /New chat/ }).first().click();
  await page.waitForTimeout(800);
  await page.route("**/chat**", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await ask("What's the travel per diem for a trip to Berlin?");
  await page.waitForTimeout(3000);
  await shot("06-chat-error-light");
  await page.unroute("**/chat**");

  // 09 library
  await page.goto(`${BASE}/library`);
  await page.waitForLoadState("networkidle");
  await shot("09-library-light");
  await page.getByLabel("Search titles and sections").fill("2027 holiday calendar");
  await page.waitForTimeout(400);
  await shot("09-library-no-match-light");
  await page.getByLabel("Search titles and sections").fill("");
  await page.locator("tr, [role=row]").nth(3).hover().catch(() => {});
  await shot("09-library-hover-light");

  // 08 search
  await page.goto(`${BASE}/chat`);
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(400);
  await page.keyboard.type("parental");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await shot("08-search-light");
  await page.keyboard.press("Escape");

  // 16 settings (member)
  await page.goto(`${BASE}/chat?settings=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await shot("16-settings-member-light");

  // 18 mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/chat`);
  await page.waitForLoadState("networkidle");
  const firstChat = page.getByRole("link", { name: /Parental/i }).first();
  await page.getByRole("button", { name: /Open menu|menu/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await shot("18-mobile-rail");
  if (await firstChat.count()) {
    await firstChat.click();
    await page.waitForTimeout(2500);
    await shot("18-mobile-chat");
    const summary = page.getByRole("button", { name: /passages/ }).first();
    if (await summary.count()) {
      await summary.click();
      await page.waitForTimeout(700);
      await shot("18-mobile-evidence-sheet");
    }
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(500);
  await shot("18-tablet-1000");
} catch (error) {
  log(`ERROR ${error?.message ?? error}`);
  await page.screenshot({ path: `${out}/member-error-state.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
