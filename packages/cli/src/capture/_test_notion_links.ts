import puppeteer from "puppeteer-core";
async function main() {
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const b = await puppeteer.launch({
    headless: true,
    executablePath: browser.executablePath,
    args: ["--no-sandbox"],
  });
  const page = await b.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("https://notion.so", { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 5000));

  const info = await page.evaluate(`(() => {
    var headLinks = Array.from(document.head.querySelectorAll('link[rel="stylesheet"][href]'));
    var allLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
    return {
      headLinkCount: headLinks.length,
      headLinkHrefs: headLinks.map(function(l) { return l.href.slice(0, 80); }),
      allLinkCount: allLinks.length,
    };
  })()`);

  console.log(JSON.stringify(info, null, 2));
  await b.close();
}
main().catch(console.error);
