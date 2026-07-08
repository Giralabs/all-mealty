const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

// Sample seed products for fallback testing
const SEED_PRODUCTS = [
  {
    supermarket: 'dia',
    name: 'Pechuga de pollo fileteada Dia 500g',
    price: 3.89,
    price_per_kg: 7.78,
    category: 'Frescos > Carne',
    image_url: 'https://www.dia.es/product_images/8410012300010/8410012300010_1.jpg',
    ean: '8410012300010',
    raw_info: 'Pechuga de pollo fileteada Dia Frescos Carne alto_en_proteinas. Modo de empleo: Cocinar en sartén o plancha.'
  },
  {
    supermarket: 'dia',
    name: 'Leche entera Dia brik 1 l',
    price: 0.92,
    price_per_kg: 0.92,
    category: 'La Despensa > Lácteos',
    image_url: 'https://www.dia.es/product_images/8410012300027/8410012300027_1.jpg',
    ean: '8410012300027',
    raw_info: 'Leche entera Dia brik 1 l La Despensa Lácteos. Listo para consumir.'
  },
  {
    supermarket: 'dia',
    name: 'Ensalada Mezclum Dia bolsa 150g',
    price: 1.19,
    price_per_kg: 7.93,
    category: 'Frescos > Verduras',
    image_url: 'https://www.dia.es/product_images/8410012300034/8410012300034_1.jpg',
    ean: '8410012300034',
    raw_info: 'Ensalada Mezclum Dia bolsa 150g Frescos Verduras bajo_en_kcal. Abrir y listo para consumir.'
  }
];

async function scrapeDia() {
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
    console.log('[Dia Scraper] Launching scraper in stealth...');
    await page.goto('https://www.dia.es/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Accept cookies
    for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Aceptar")', 'button:has-text("Aceptar todo")']) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 3000 });
        if (btn) { await btn.click(); console.log('[Dia Scraper] Cookie consent accepted.'); break; }
      } catch (_) {}
    }
    await page.waitForTimeout(1500);

    const targetUrl = 'https://www.dia.es/compra-online/platos-preparados/c/007';
    console.log(`[Dia Scraper] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Parse product grid elements
    const pageProducts = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-card, [class*="product-card"], .product-item, [class*="product-grid-item"]'));
      return cards.map(card => {
        const nameEl = card.querySelector('[class*="title"], [class*="name"], h3, h4');
        const priceEl = card.querySelector('[class*="price"]');
        const imgEl = card.querySelector('img');
        
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

        return {
          supermarket: 'dia',
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
    console.log(`[Dia Scraper] Successfully scraped ${products.length} live products.`);

  } catch (err) {
    console.warn('[Dia Scraper] Live scraping failed, falling back to seed products. Error:', err.message);
  } finally {
    await browser.close();
  }

  if (products.length === 0) {
    console.log('[Dia Scraper] Returning Dia seed products.');
    return SEED_PRODUCTS;
  }

  return products;
}

module.exports = {
  scrape: scrapeDia
};
