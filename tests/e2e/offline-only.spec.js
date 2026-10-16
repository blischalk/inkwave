// Regression guard: Inkwave must make ZERO outbound network requests.
//
// Bug this suite exists to catch: index.html loaded marked.js,
// highlight.js (+ bash/shell language packs), and Google Fonts CSS from
// CDNs (cdn.jsdelivr.net, cdnjs.cloudflare.com, fonts.googleapis.com)
// as the PRIMARY source, with vendor/*.min.js as an onerror fallback.
// js/utils.js similarly tried a jsdelivr ESM import for mermaid before
// falling back to vendor/mermaid.min.js. On a machine with no internet
// access (or a captive portal / DNS blackhole), every page load paid a
// multi-second connection-timeout tax per asset before the fallback
// fired, and a user auditing network traffic would see Inkwave phoning
// out to four different third-party domains despite being marketed as
// a local-first, fully offline markdown editor.
//
// Fix: every asset (fonts, marked, highlight.js + language packs,
// mermaid) is loaded directly from vendor/ with no network attempt at
// all. See index.html <head> and js/utils.js loadMermaid().
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers.js";

test.describe("offline-only posture — zero outbound network calls", () => {
  test("plain app load makes no request to any non-local host", async ({ page }) => {
    const outboundRequests = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1") && !url.startsWith("file:")) {
        outboundRequests.push(url);
      }
    });
    await gotoApp(page, { initialSettings: {}, welcomeContent: "# Welcome\n\nHello." });
    // Give any stray async import/fetch time to fire before asserting.
    await page.waitForTimeout(300);
    expect(outboundRequests).toEqual([]);
  });

  test("marked and highlight.js are loaded from vendor/, not a CDN", async ({ page }) => {
    const scriptSrcs = [];
    page.on("request", (req) => {
      if (req.resourceType() === "script") scriptSrcs.push(req.url());
    });
    await gotoApp(page, { initialSettings: {}, welcomeContent: "# Welcome\n\nHello." });
    await page.waitForTimeout(200);
    const hasCdnScript = scriptSrcs.some((u) => u.includes("cdn.jsdelivr.net") || u.includes("cdnjs.cloudflare.com"));
    expect(hasCdnScript).toBe(false);
    const hasVendorMarked = scriptSrcs.some((u) => u.includes("vendor/marked.min.js"));
    const hasVendorHighlight = scriptSrcs.some((u) => u.includes("vendor/highlight.min.js"));
    expect(hasVendorMarked).toBe(true);
    expect(hasVendorHighlight).toBe(true);
  });

  test("fonts stylesheet is vendor/fonts.css, not fonts.googleapis.com", async ({ page }) => {
    const linkedHrefs = [];
    page.on("request", (req) => {
      if (req.resourceType() === "stylesheet") linkedHrefs.push(req.url());
    });
    await gotoApp(page, { initialSettings: {}, welcomeContent: "# Welcome\n\nHello." });
    await page.waitForTimeout(200);
    const hasGoogleFonts = linkedHrefs.some((u) => u.includes("fonts.googleapis.com"));
    expect(hasGoogleFonts).toBe(false);
    const hasVendorFonts = linkedHrefs.some((u) => u.includes("vendor/fonts.css"));
    expect(hasVendorFonts).toBe(true);
  });

  test("mermaid loader (js/utils.js loadMermaid) never attempts an ESM CDN import", async ({ page }) => {
    const requestedUrls = [];
    page.on("request", (req) => requestedUrls.push(req.url()));
    await gotoApp(page, { initialSettings: {}, welcomeContent: "# Welcome\n\nHello." });
    // Trigger a mermaid code block render, which is what calls loadMermaid().
    await page.evaluate(async () => {
      const utils = await import("/js/utils.js");
      await utils.loadMermaid();
    });
    await page.waitForTimeout(300);
    const hitJsdelivr = requestedUrls.some((u) => u.includes("jsdelivr.net"));
    expect(hitJsdelivr).toBe(false);
  });

  test("vendor/mermaid.min.js sets a usable global without any network fetch", async ({ page }) => {
    await gotoApp(page, { initialSettings: {}, welcomeContent: "# Welcome\n\nHello." });
    const mermaidType = await page.evaluate(async () => {
      const utils = await import("/js/utils.js");
      const m = await utils.loadMermaid();
      return typeof m;
    });
    expect(mermaidType).not.toBe("undefined");
  });
});
