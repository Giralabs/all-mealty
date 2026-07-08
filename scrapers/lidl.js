const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

// Sample seed products for fallback testing
const SEED_PRODUCTS = [
  {
    supermarket: 'lidl',
    name: 'Tortilla de patatas con cebolla Lidl 600g',
    price: 2.19,
    price_per_kg: 3.65,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.lidl.es/images/8410012300072/8410012300072_1.jpg',
    ean: '8410012300072',
    raw_info: 'Tortilla de patatas con cebolla Lidl 600g Frescos Platos preparados. Modo de empleo: Calentar en microondas durante 3 minutos o dorar en sartén por ambos lados.'
  },
  {
    supermarket: 'lidl',
    name: 'Gazpacho fresco tradicional Lidl botella 1 l',
    price: 1.99,
    price_per_kg: 1.99,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.lidl.es/images/8410012300089/8410012300089_1.jpg',
    ean: '8410012300089',
    raw_info: 'Gazpacho fresco tradicional Lidl botella 1 l Frescos Platos preparados bajo_en_kcal. Modo de empleo: Listo para consumir. Agitar antes de servir.'
  },
  {
    supermarket: 'lidl',
    name: 'Guacamole fresco 95% aguacate Lidl 200g',
    price: 1.49,
    price_per_kg: 7.45,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.lidl.es/images/8410012300096/8410012300096_1.jpg',
    ean: '8410012300096',
    raw_info: 'Guacamole fresco 95% aguacate Lidl 200g Frescos Platos preparados bajo_en_carbohidratos. Listo para consumir. Conservar refrigerado.'
  }
];

async function scrapeLidl() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES'
  });

  const page = await context.newPage();

  // Block heavy assets
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['font', 'media', 'image'].includes(type)) return route.abort();
    route.continue();
  });

  const products = [];

  try {
    console.log('[Lidl Scraper] Launching scraper in stealth...');
    await page.goto('https://www.lidl.es/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Accept cookies
    for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Aceptar")', 'button:has-text("Aceptar todo")']) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 3000 });
        if (btn) { await btn.click(); console.log('[Lidl Scraper] Cookie consent accepted.'); break; }
      } catch (_) {}
    }
    await page.waitForTimeout(1500);

    const targetUrl = 'https://www.lidl.es/es/platos-preparados/c342';
    console.log(`[Lidl Scraper] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Parse product grid elements
    const pageProducts = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-grid-item, [class*="product-grid-item"], .product-card, [class*="product-card"], article'));
      return cards.map(card => {
        const nameEl = card.querySelector('[class*="title"], [class*="name"], h2, h3, h4');
        const priceEl = card.querySelector('[class*="price"]');
        const imgEl = card.querySelector('img');
        const linkEl = card.querySelector('a[href]');
        
        const name = nameEl ? nameEl.textContent.trim() : null;
        if (!name) return null;

        const priceText = priceEl ? priceEl.textContent.trim() : '0';
        const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.')) || null;

        const image_url = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src')) : null;
        
        let ean = null;
        if (image_url) {
          const match = image_url.match(/\/(\d{13})\b/);
          if (match) ean = match[1];
        }
        if (!ean && linkEl) {
          const href = linkEl.getAttribute('href');
          const match = href.match(/\/p(\d{13})\b/);
          if (match) ean = match[1];
        }

        return {
          supermarket: 'lidl',
          name,
          price,
          price_per_kg: null,
          category: 'Platos preparados',
          image_url,
          ean,
          raw_info: `${name} Platos preparados`
        };
      }).filter(Boolean);
    });

    products.push(...pageProducts);
    console.log(`[Lidl Scraper] Successfully scraped ${products.length} live products.`);

  } catch (err) {
    console.warn('[Lidl Scraper] Live scraping failed, falling back to seed products. Error:', err.message);
  } finally {
    await browser.close();
  }

  if (products.length === 0) {
    console.log('[Lidl Scraper] Returning Lidl seed products.');
    return SEED_PRODUCTS;
  }

  return products;
}

module.exports = {
  scrape: scrapeLidl
};
