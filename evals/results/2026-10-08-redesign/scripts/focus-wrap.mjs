import { createRequire } from "node:module";
const [pwDir] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwDir);
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const check = async (label) => {
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    let el = document.activeElement; const out = [];
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      const cs = getComputedStyle(el); out.push(`${el.tagName.toLowerCase()}.${(el.className||"").toString().split(" ")[0]} shadow=${cs.boxShadow.slice(0,90)} outline=${cs.outlineStyle}`);
    }
    return out;
  });
  console.log(label); r.forEach((l) => console.log("  ", l));
};
await p.goto("http://127.0.0.1:8787/login"); await p.waitForLoadState("networkidle");
await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await check("login first input");
await p.goto("http://127.0.0.1:8787/chat"); await p.waitForLoadState("networkidle");
await p.getByLabel("Question").focus(); await check("composer");
await b.close();
