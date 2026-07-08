const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

// Sample seed products for fallback testing
const SEED_PRODUCTS = [
  {
    supermarket: 'aldi',
    name: 'Tortellini de queso y espinacas Aldi 250g',
    price: 1.29,
    price_per_kg: 5.16,
    category: 'La Despensa > Pasta',
    image_url: 'https://www.aldi.es/images/8410012300102/8410012300102_1.jpg',
    ean: '8410012300102',
    raw_info: 'Tortellini de queso y espinacas Aldi Pasta La Despensa. Instrucciones: Hervir en agua abundante durante 3 minutos.'
  },
  {
    supermarket: 'aldi',
    name: 'Ensalada de quinoa lista para comer Aldi 220g',
    price: 1.99,
    price_per_kg: 9.05,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.aldi.es/images/8410012300119/8410012300119_1.jpg',
    ean: '8410012300119',
    raw_info: 'Ensalada de quinoa lista para comer Aldi Frescos Platos preparados bajo_en_kcal. Listo para consumir. Conservar refrigerado.'
  },
  {
    supermarket: 'aldi',
    name: 'Crema de calabaza fresca Aldi 950ml',
    price: 1.79,
    price_per_kg: 1.88,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.aldi.es/images/8410012300126/8410012300126_1.jpg',
    ean: '8410012300126',
    raw_info: 'Crema de calabaza fresca Aldi 950ml Frescos Platos preparados bajo_en_kcal. Modo de empleo: Calentar al microondas durante 2 minutos o calentar en cazo.'
  }
];

async function scrapeAldi() {
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
    console.log('[Aldi Scraper] Launching scraper in stealth...');
    await page.goto('https://www.aldi.es/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Accept cookies
    for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Aceptar")', 'button:has-text("Aceptar todo")']) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 3000 });
        if (btn) { await btn.click(); console.log('[Aldi Scraper] Cookie consent accepted.'); break; }
      } catch (_) {}
    }
    await page.waitForTimeout(1500);

    const targetUrl = 'https://www.aldi.es/productos/platos-preparados.html';
    console.log(`[Aldi Scraper] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Parse product grid elements
    const pageProducts = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.mod-article-tile, [class*="article-tile"], .product-card, [class*="product-card"]'));
      return cards.map(card => {
        const nameEl = card.querySelector('[class*="title"], [class*="name"], h2, h3, h4');
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
          supermarket: 'aldi',
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
    console.log(`[Aldi Scraper] Successfully scraped ${products.length} live products.`);

  } catch (err) {
    console.warn('[Aldi Scraper] Live scraping failed, falling back to seed products. Error:', err.message);
  } finally {
    await browser.close();
  }

  if (products.length === 0) {
    console.log('[Aldi Scraper] Returning Aldi seed products.');
    return SEED_PRODUCTS;
  }

  return products;
}

module.exports = {
  scrape: scrapeAldi
};
