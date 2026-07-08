const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

// Sample seed products for fallback testing
const SEED_PRODUCTS = [
  {
    supermarket: 'alcampo',
    name: 'Atún claro en aceite de oliva Alcampo pack 3x80g',
    price: 2.65,
    price_per_kg: 11.04,
    category: 'La Despensa > Conservas',
    image_url: 'https://www.alcampo.es/images/8410012300041/8410012300041_1.jpg',
    ean: '8410012300041',
    raw_info: 'Atún claro en aceite de oliva Alcampo Conservas La Despensa. Listo para consumir. Conservar en sitio fresco y seco.'
  },
  {
    supermarket: 'alcampo',
    name: 'Gazpacho tradicional Alcampo brick 1 l',
    price: 1.85,
    price_per_kg: 1.85,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.alcampo.es/images/8410012300058/8410012300058_1.jpg',
    ean: '8410012300058',
    raw_info: 'Gazpacho tradicional Alcampo brick 1 l Frescos Platos preparados bajo_en_kcal. Modo de empleo: Servir frío. Listo para tomar.'
  },
  {
    supermarket: 'alcampo',
    name: 'Hummus clásico receta tradicional Alcampo 200g',
    price: 1.09,
    price_per_kg: 5.45,
    category: 'Frescos > Platos preparados',
    image_url: 'https://www.alcampo.es/images/8410012300065/8410012300065_1.jpg',
    ean: '8410012300065',
    raw_info: 'Hummus clásico receta tradicional Alcampo 200g Frescos Platos preparados. Modo de empleo: Consumir directamente.'
  }
];

async function scrapeAlcampo() {
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
    console.log('[Alcampo Scraper] Launching scraper in stealth...');
    await page.goto('https://www.alcampo.es/compra-online/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Accept cookies
    for (const sel of ['#cookie-accept', '#onetrust-accept-btn-handler', 'button:has-text("Aceptar")', 'button:has-text("Aceptar todo")']) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 3000 });
        if (btn) { await btn.click(); console.log('[Alcampo Scraper] Cookie consent accepted.'); break; }
      } catch (_) {}
    }
    await page.waitForTimeout(1500);

    const targetUrl = 'https://www.alcampo.es/compra-online/frescos/platos-preparados/c/w08';
    console.log(`[Alcampo Scraper] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Parse product grid elements
    const pageProducts = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-item, [class*="product-item"], .product-card, [class*="product-card"]'));
      return cards.map(card => {
        const nameEl = card.querySelector('[class*="title"], [class*="name"], h2, h3, [itemprop="name"]');
        const priceEl = card.querySelector('[class*="price"], [itemprop="price"]');
        const imgEl = card.querySelector('img');
        const linkEl = card.querySelector('a[href]');
        
        const name = nameEl ? nameEl.textContent.trim() : null;
        if (!name) return null;

        const priceText = priceEl ? priceEl.textContent.trim() : '0';
        const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.')) || null;

        const image_url = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src')) : null;
        
        let ean = null;
        const linkHref = linkEl ? linkEl.getAttribute('href') : '';
        const linkMatch = linkHref.match(/\/p\/(\d{13})\b/);
        if (linkMatch) {
          ean = linkMatch[1];
        } else if (image_url) {
          const imgMatch = image_url.match(/\/(\d{13})\b/);
          if (imgMatch) ean = imgMatch[1];
        }

        return {
          supermarket: 'alcampo',
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
    console.log(`[Alcampo Scraper] Successfully scraped ${products.length} live products.`);

  } catch (err) {
    console.warn('[Alcampo Scraper] Live scraping failed, falling back to seed products. Error:', err.message);
  } finally {
    await browser.close();
  }

  if (products.length === 0) {
    console.log('[Alcampo Scraper] Returning Alcampo seed products.');
    return SEED_PRODUCTS;
  }

  return products;
}

module.exports = {
  scrape: scrapeAlcampo
};
