// Browser journey against a running server (live Qloo): sample scenario -> map (keyboard) -> activity -> plan -> counterfactual -> mobile.
// Run: node <browser-automation>/browser.mjs http://localhost:8787/ --script e2e/journey.mjs   (set SHOT=docs/screenshots to save images)
export default async function run(page, ui) {
  const out = {};
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: (process.env.SHOT || ".") + "/s1-hero.png" });
  await page.getByRole("button", { name: "Try the sample scenario" }).click();
  await page.waitForSelector("article.card", { timeout: 30000 });
  out.cards = await page.locator("article.card h3").allInnerTexts();
  out.header = await page.locator(".rhead").innerText();
  await page.locator("#results").scrollIntoViewIfNeeded();
  await page.screenshot({ path: (process.env.SHOT || ".") + "/s2-translation.png" });
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForSelector("svg g.node");
  out.mapNodes = await page.locator("svg g.node").count();
  out.mapEdges = await page.locator("svg path").count();
  out.listRows = await page.locator("table.tbl tbody tr").count();
  await page.locator("svg g.node").nth(3).focus(); await page.keyboard.press("Enter");
  out.detail = (await page.locator(".detail").innerText()).slice(0, 160);
  await page.locator("#results").scrollIntoViewIfNeeded();
  await page.screenshot({ path: (process.env.SHOT || ".") + "/s3-map.png" });
  await page.getByRole("button", { name: "Agent activity" }).click();
  out.timeline = await page.locator(".timeline li").count();
  out.timelineErrors = await page.locator(".timeline li.t-error").count();
  out.fallback = (await page.locator(".timeline li").allInnerTexts()).filter(t => /Fallback/.test(t)).map(t => t.replace(/\n/g, " ")).slice(0,2);
  await page.screenshot({ path: (process.env.SHOT || ".") + "/s4-activity.png" });
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  out.plan = await page.locator("ol.plan li").allInnerTexts();
  out.planLabel = await page.locator("#pl-h").innerText();
  // counterfactual: drop a place category, re-translate, expect a diff
  await page.getByRole("button", { name: "Translation" }).click();
  await page.getByRole("button", { name: "Drop Japanese food" }).click();
  await page.getByRole("button", { name: "Update results" }).click();
  await page.waitForSelector(".diff", { timeout: 30000 });
  out.diff = await page.locator(".diff").innerText();
  // mobile
  await page.setViewportSize({ width: 390, height: 800 });
  out.mobileHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.locator("#results").scrollIntoViewIfNeeded();
  await page.screenshot({ path: (process.env.SHOT || ".") + "/s5-mobile.png" });
  const asserts = {
    cardsRendered: out.cards.length > 5, mapMatchesList: out.mapNodes === out.listRows, noFailedCalls: out.timelineErrors === 0,
    planLabeledUnverified: /Proposed, unverified/.test(out.planLabel), diffUsesNames: !/[0-9A-F]{8}-[0-9A-F]{4}-/.test(out.diff), noMobileHScroll: out.mobileHScroll === false,
  };
  out.asserts = asserts; out.allPass = Object.values(asserts).every(Boolean);
  return out;
}
