const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePrice(text) {
  if (!text) return null;
  const clean = text
    .replace(/\s/g, '')
    .replace(/[^\d,.]/g, '')
    .replace(/\.(?=\d{3}[,.])/g, '')
    .replace(',', '.');
  const v = parseFloat(clean);
  return isNaN(v) ? null : v;
}

// ── Real Carrefour ES supermercado food categories (confirmed 2025-07) ────────
const FOOD_CATEGORIES = [
  { name: 'Pizzas congeladas', url: 'https://www.carrefour.es/supermercado/congelados/pizzas-congeladas/cat21449183/c' },
  { name: 'Frescos',    url: 'https://www.carrefour.es/supermercado/frescos/cat20002/c' },
  { name: 'La Despensa', url: 'https://www.carrefour.es/supermercado/la-despensa/cat20001/c' },
  { name: 'Bebidas',    url: 'https://www.carrefour.es/supermercado/bebidas/cat20003/c' },
  { name: 'Congelados', url: 'https://www.carrefour.es/supermercado/congelados/cat21449123/c' },
];

// ── Phase 1: parse one listing page ──────────────────────────────────────────

async function parseListingPage(page, categoryName) {
  return page.evaluate((catName) => {
    function parsePrice(text) {
      if (!text) return null;
      const clean = text.replace(/\s/g, '').replace(/[^\d,.]/g, '')
        .replace(/\.(?=\d{3}[,.])/g, '').replace(',', '.');
      const v = parseFloat(clean);
      return isNaN(v) ? null : v;
    }

    // Confirmed selector from DOM inspection (July 2025)
    const tiles = Array.from(document.querySelectorAll('li.product-card-list__item'));

    return tiles.map(tile => {
      // Name
      const nameEl = tile.querySelector('h2.product-card__title, a.product-card__title-link');
      const name   = nameEl?.textContent.trim() || null;
      if (!name) return null;

      // Price
      const priceEl = tile.querySelector('span.product-card__price');
      const price   = parsePrice(priceEl?.textContent);

      // Price per KG / L
      const perEl       = tile.querySelector('span.product-card__price-per-unit');
      const price_per_kg = parsePrice(perEl?.textContent);

      // Image URL — read from DOM attr (images are blocked at network level)
      const imgEl     = tile.querySelector('img.product-card__image');
      const image_url =
        imgEl?.getAttribute('data-src') ||
        imgEl?.getAttribute('src')      ||
        null;

      // Product detail link (used in Phase 2 to get EAN)
      const linkEl     = tile.querySelector('a.product-card__media-link, a.product-card__title-link');
      const detail_path = linkEl ? linkEl.getAttribute('href') : null;
      const detail_url  = detail_path
        ? 'https://www.carrefour.es' + detail_path
        : null;

      return {
        supermarket: 'carrefour',
        name,
        price,
        price_per_kg,
        category: catName,
        image_url,
        detail_url,
        ean: null,          // filled in Phase 2
        raw_info: [name, catName].join(' '),
      };
    }).filter(Boolean);
  }, categoryName);
}

// ── Phase 2: get EAN from a product detail page's JSON-LD ────────────────────

async function fetchDetailsFromDetailPage(page, detailUrl) {
  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    return page.evaluate(() => {
      let ean = null;
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const items = [].concat(JSON.parse(s.textContent));
          for (const item of items) {
            if (item['@type'] === 'Product') {
              ean =
                (item.gtin13 && /^\d{13}$/.test(item.gtin13) ? item.gtin13 : null) ||
                (item.gtin   && /^\d{13}$/.test(item.gtin)   ? item.gtin   : null);
              if (ean) break;
            }
          }
          if (ean) break;
        } catch (_) {}
      }

      // Collect all text blocks that look like ingredients or instructions/modo de empleo/preparación/consejos de uso
      const elements = Array.from(document.querySelectorAll(
        '.product-details, .product-description, [class*="description"], [class*="instruction"], [class*="prep"], [class*="detail"], p, div, span, li'
      ));

      const texts = [];
      elements.forEach(el => {
        const text = el.textContent.trim();
        if (
          text.length > 5 &&
          text.length < 1500 &&
          /ingredientes|modo\s+de\s+empleo|preparaci[oó]n|instrucciones|consejos\s+de\s+uso|conservaci[oó]n|horno|microondas|fre[ií]r|hervir|cocer/i.test(text)
        ) {
          texts.push(text);
        }
      });

      return {
        ean,
        preparationText: [...new Set(texts)].join(' ')
      };
    });
  } catch (_) {
    return { ean: null, preparationText: '' };
  }
}

// ── Main scraper ──────────────────────────────────────────────────────────────

async function scrapeCarrefour() {
  const categoriesToUse = FOOD_CATEGORIES;
  const maxPagesPerCat  = 10; // Complete subcategory pagination limit

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:   { width: 1440, height: 900 },
    locale:     'es-ES',
    timezoneId: 'Europe/Madrid',
  });
  const page = await context.newPage();

  // Block heavy resources; still capture img src from DOM attrs
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    const url  = route.request().url();
    if (
      ['font', 'media'].includes(type) ||
      url.includes('google-analytics') || url.includes('doubleclick') ||
      url.includes('facebook')         || url.includes('hotjar')      ||
      url.includes('newrelic')         || url.includes('cookielaw')
    ) return route.abort();
    if (type === 'image') return route.abort();
    route.continue();
  });

  try {
    // ── Warm-up: accept cookies ────────────────────────────────────────────
    console.log('[Carrefour] Initialising with stealth...');
    await page.goto('https://www.carrefour.es/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    for (const sel of [
      '#onetrust-accept-btn-handler',
      'button:has-text("Aceptar todo")',
      'button:has-text("Aceptar")',
    ]) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 3000 });
        if (btn) { await btn.click(); console.log(`[Carrefour] Cookie consent accepted.`); break; }
      } catch (_) {}
    }
    await page.waitForTimeout(1500);

    // ── Phase 1: Scrape listing pages ──────────────────────────────────────
    const allProducts = [];

    for (const cat of categoriesToUse) {
      console.log(`\n[Carrefour] ─── ${cat.name} ───`);

      for (let pNum = 0; pNum < maxPagesPerCat; pNum++) {
        const url = pNum === 0
          ? cat.url
          : `${cat.url}?start=${pNum * 24}&sz=24`;

        console.log(`[Carrefour]   Listing page ${pNum + 1}: ${url}`);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

          // Abort if Cloudflare blocks again
          const title = await page.title();
          if (/attention|blocked/i.test(title)) {
            console.error('[Carrefour]   ⚠ Cloudflare block! Stopping.');
            break;
          }

          await page.waitForTimeout(3000);

          const count = await page.$$eval('li.product-card-list__item', els => els.length);
          if (count === 0) {
            console.log('[Carrefour]   No tiles on this page. Moving on.');
            break;
          }

          const products = await parseListingPage(page, cat.name);
          allProducts.push(...products);
          console.log(`[Carrefour]   ✓ ${products.length} products from this page.`);

          // Stop if no next-page indicator
          const hasNext = await page.evaluate(() =>
            !!(document.querySelector('[class*="pagination__next"]:not([disabled])') ||
               document.querySelector('a[aria-label*="Siguiente"]'))
          );
          if (!hasNext && pNum > 0) break;

          await page.waitForTimeout(600);
        } catch (err) {
          console.error(`[Carrefour]   Page error:`, err.message);
          break;
        }
      }
    }

    // ── Phase 2: Fetch EAN and details from product detail pages ───────────────────────
    const toFetch = allProducts.filter(p => p.detail_url);

    console.log(`\n[Carrefour] Fetching details from ${toFetch.length} product pages...`);
    let fetched = 0;
    for (const prod of toFetch) {
      fetched++;
      process.stdout.write(`\r[Carrefour] Page detail ${fetched}/${toFetch.length}  `);
      const { ean, preparationText } = await fetchDetailsFromDetailPage(page, prod.detail_url);
      if (ean) prod.ean = ean;
      if (preparationText) {
        prod.raw_info = `${prod.raw_info} ${preparationText}`;
      }
      await page.waitForTimeout(400);
    }
    if (toFetch.length > 0) console.log(); // newline after \r

    // ── Deduplicate by name ────────────────────────────────────────────────
    const seen   = new Set();
    const unique = allProducts.filter(p => {
      const k = p.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const eanCount = unique.filter(p => p.ean).length;
    console.log(
      `[Carrefour] Done. ${unique.length} unique products, ` +
      `${eanCount} with EAN (${unique.length ? ((eanCount / unique.length) * 100).toFixed(1) : 0}%)`
    );
    return unique;

  } finally {
    await browser.close();
  }
}

module.exports = { scrape: scrapeCarrefour };
