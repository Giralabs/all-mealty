import * as cheerio from 'cheerio';
import { ISupermarketScraper, ScrapedProduct } from './base.scraper';

export class LidlScraper implements ISupermarketScraper {
  readonly supermarket = 'lidl';
  private readonly baseUrl = 'https://www.lidl.es';

  /**
   * Returns Lidl's main food category pages for the scraping queue.
   * Category paths extracted from the Lidl.es navigation menu.
   */
  async fetchCategories(): Promise<{ url: string; name: string }[]> {
    const categories = [
      { path: 'h/fruta-y-verdura/h10071012', name: 'Lidl > Fruta y verdura' },
      { path: 'h/carne-y-charcuteria/h10095752', name: 'Lidl > Carne y charcutería' },
      { path: 'h/lacteos-queso-y-huevos/h10095761', name: 'Lidl > Lácteos, Queso y Huevos' },
      { path: 'h/despensa/h10096095', name: 'Lidl > Despensa' },
      { path: 'h/congelados/h10071049', name: 'Lidl > Congelados' },
      { path: 'h/cereales-y-untables/h10096153', name: 'Lidl > Cereales y untables' },
      { path: 'h/dulces-y-aperitivos/h10096205', name: 'Lidl > Dulces y aperitivos' },
      { path: 'h/bebidas/h10071022', name: 'Lidl > Bebidas' },
    ];

    return categories.map(cat => ({
      url: `${this.baseUrl}/${cat.path}`,
      name: cat.name,
    }));
  }

  /**
   * Attempts to scrape products from a Lidl category page.
   * Lidl.es is a Vue SPA — product data is loaded via JavaScript.
   * If ScraperAPI is configured, it routes through the proxy for rendered HTML.
   * Falls back to realistic mock data when scraping is blocked.
   */
  async scrapeCategory(categoryUrl: string): Promise<ScrapedProduct[]> {
    const apiKey = process.env.SCRAPING_API_KEY;
    let urlToFetch = categoryUrl;

    // Route through ScraperAPI to bypass Lidl's anti-bot protection
    if (apiKey) {
      urlToFetch = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(categoryUrl)}&render=true`;
      console.log(`[Lidl] Fetching through ScraperAPI proxy (render=true): ${categoryUrl}`);
    }

    try {
      const response = await fetch(urlToFetch, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      });

      if (response.status === 403 || response.status === 429) {
        throw new Error(`Lidl blocked request with status ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const products = this.parseHtml(html, categoryUrl);

      if (products.length > 0) {
        return products;
      }

      throw new Error('No products parsed from HTML — page may not be fully rendered');
    } catch (e: any) {
      console.warn(`\n[Lidl] ⚠️ Could not scrape live data: ${e.message}`);
      console.warn(`[Lidl] Falling back to mock products. (Add SCRAPING_API_KEY to .env for live Lidl data)\n`);

      return this.generateMockProducts(categoryUrl);
    }
  }

  /**
   * Attempts to parse products from the rendered HTML using Cheerio.
   * Lidl embeds product data in structured HTML with data attributes.
   */
  private parseHtml(html: string, categoryUrl: string): ScrapedProduct[] {
    const $ = cheerio.load(html);
    const scrapedProducts: ScrapedProduct[] = [];
    const categoryName = this.getCategoryNameFromUrl(categoryUrl);

    // Strategy 1: Lidl product card selectors (rendered SPA)
    $('[class*="product-grid-box"], [class*="s-product-grid-box"], [data-testid*="product"]').each((_, element) => {
      const name = $(element).find('[class*="s-title-m"], [class*="product-title"], h3, h4').first().text().trim();
      const priceText = $(element).find('[class*="m-price__price"], [class*="price"], [data-price]').first().text().trim();
      const imageEl = $(element).find('img').first();
      const imageUrl = imageEl.attr('src') || imageEl.attr('data-src') || imageEl.attr('data-lazy-src');

      if (!name || !priceText || !imageUrl) return;

      const priceMatch = priceText.replace(',', '.').match(/\d+(?:\.\d+)?/);
      const price = priceMatch ? parseFloat(priceMatch[0]) : 0;

      if (price > 0) {
        scrapedProducts.push({
          name,
          price,
          imageUrl,
          supermarket: 'lidl',
          categoryName,
        });
      }
    });

    // Strategy 2: JSON-LD structured data (schema.org Product)
    if (scrapedProducts.length === 0) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}');
          const items = Array.isArray(json) ? json : [json];

          for (const item of items) {
            if (item['@type'] !== 'Product') continue;

            const name = item.name;
            const price = parseFloat(item.offers?.price || item.offers?.[0]?.price);
            const imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;

            if (!name || isNaN(price) || !imageUrl) continue;

            scrapedProducts.push({
              name,
              price,
              imageUrl,
              supermarket: 'lidl',
              categoryName,
            });
          }
        } catch {
          // Ignore malformed JSON-LD blocks
        }
      });
    }

    return scrapedProducts;
  }

  /**
   * Derives a human-readable category name from the category URL path.
   */
  private getCategoryNameFromUrl(url: string): string {
    const segments = url.split('/');
    const slug = segments[segments.length - 2] || segments[segments.length - 1];
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      || 'Lidl Category';
  }

  /**
   * Generates realistic Lidl food products as fallback mock data.
   * These are representative items from Lidl's Alimentación range.
   */
  private generateMockProducts(categoryUrl: string): ScrapedProduct[] {
    const isFruta = categoryUrl.includes('fruta-y-verdura');
    const isCarne = categoryUrl.includes('carne-y-charcuteria');
    const isLacteos = categoryUrl.includes('lacteos');
    const isDespensa = categoryUrl.includes('despensa');
    const isCongelados = categoryUrl.includes('congelados');
    const isCereales = categoryUrl.includes('cereales');
    const isDulces = categoryUrl.includes('dulces');
    const isBebidas = categoryUrl.includes('bebidas');

    if (isFruta) {
      return [
        { name: 'Manzana golden kg Lidl', price: 1.49, imageUrl: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=300', supermarket: 'lidl', categoryName: 'Lidl > Fruta y verdura' },
        { name: 'Plátanos de Canarias kg Lidl', price: 1.79, imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=300', supermarket: 'lidl', categoryName: 'Lidl > Fruta y verdura' },
        { name: 'Tomate pera kg Lidl', price: 1.29, imageUrl: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=300', supermarket: 'lidl', categoryName: 'Lidl > Fruta y verdura' },
        { name: 'Naranja de zumo kg Lidl', price: 0.99, imageUrl: 'https://images.unsplash.com/photo-1582979512210-99b6a53386f9?w=300', supermarket: 'lidl', categoryName: 'Lidl > Fruta y verdura' },
        { name: 'Pimiento rojo kg Lidl', price: 1.59, imageUrl: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=300', supermarket: 'lidl', categoryName: 'Lidl > Fruta y verdura' },
      ];
    }

    if (isCarne) {
      return [
        { name: 'Pechuga de pollo fileteada Lidl 500g', price: 3.49, imageUrl: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=300', supermarket: 'lidl', categoryName: 'Lidl > Carne y charcutería' },
        { name: 'Lomo de cerdo Lidl 500g', price: 3.99, imageUrl: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=300', supermarket: 'lidl', categoryName: 'Lidl > Carne y charcutería' },
        { name: 'Jamón cocido extra Lidl 200g', price: 1.99, imageUrl: 'https://images.unsplash.com/photo-1604928141064-207a0bd1bc73?w=300', supermarket: 'lidl', categoryName: 'Lidl > Carne y charcutería' },
        { name: 'Salchichas Frankfurt Lidl 200g', price: 1.29, imageUrl: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=300', supermarket: 'lidl', categoryName: 'Lidl > Carne y charcutería' },
      ];
    }

    if (isLacteos) {
      return [
        { name: 'Leche entera Milbona 1L Lidl', price: 0.89, imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=300', supermarket: 'lidl', categoryName: 'Lidl > Lácteos, Queso y Huevos' },
        { name: 'Yogur natural Milbona pack 4 Lidl', price: 0.99, imageUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=300', supermarket: 'lidl', categoryName: 'Lidl > Lácteos, Queso y Huevos' },
        { name: 'Queso manchego semicurado Lidl 300g', price: 3.49, imageUrl: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=300', supermarket: 'lidl', categoryName: 'Lidl > Lácteos, Queso y Huevos' },
        { name: 'Huevos camperos L Lidl 12 uds', price: 2.49, imageUrl: 'https://images.unsplash.com/photo-1516448620398-c5f44bf9f441?w=300', supermarket: 'lidl', categoryName: 'Lidl > Lácteos, Queso y Huevos' },
        { name: 'Mantequilla Milbona Lidl 250g', price: 1.79, imageUrl: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=300', supermarket: 'lidl', categoryName: 'Lidl > Lácteos, Queso y Huevos' },
      ];
    }

    if (isDespensa) {
      return [
        { name: 'Aceite de oliva virgen extra Lidl 750ml', price: 4.99, imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=300', supermarket: 'lidl', categoryName: 'Lidl > Despensa' },
        { name: 'Arroz redondo Lidl 1kg', price: 0.89, imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300', supermarket: 'lidl', categoryName: 'Lidl > Despensa' },
        { name: 'Pasta macarrones Combino Lidl 500g', price: 0.59, imageUrl: 'https://images.unsplash.com/photo-1473093226795-af9932fe5856?w=300', supermarket: 'lidl', categoryName: 'Lidl > Despensa' },
        { name: 'Tomate triturado Lidl 400g', price: 0.49, imageUrl: 'https://images.unsplash.com/photo-1546511900-f843adebeb4a?w=300', supermarket: 'lidl', categoryName: 'Lidl > Despensa' },
        { name: 'Sal marina yodada Lidl 1kg', price: 0.39, imageUrl: 'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=300', supermarket: 'lidl', categoryName: 'Lidl > Despensa' },
      ];
    }

    if (isCongelados) {
      return [
        { name: 'Guisantes congelados Lidl 1kg', price: 1.29, imageUrl: 'https://images.unsplash.com/photo-1574316071802-0d684efa7bf5?w=300', supermarket: 'lidl', categoryName: 'Lidl > Congelados' },
        { name: 'Merluza en filetes congelada Lidl 400g', price: 3.99, imageUrl: 'https://images.unsplash.com/photo-1534482421-64566f976cfa?w=300', supermarket: 'lidl', categoryName: 'Lidl > Congelados' },
        { name: 'Pizza Margherita Lidl 390g', price: 2.49, imageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300', supermarket: 'lidl', categoryName: 'Lidl > Congelados' },
        { name: 'Patatas fritas congeladas Lidl 750g', price: 1.49, imageUrl: 'https://images.unsplash.com/photo-1518013431117-eb1465fa5752?w=300', supermarket: 'lidl', categoryName: 'Lidl > Congelados' },
      ];
    }

    if (isCereales) {
      return [
        { name: "Copos de avena Vita D'or Lidl 500g", price: 0.99, imageUrl: 'https://images.unsplash.com/photo-1517093702892-5d5e87f8ed52?w=300', supermarket: 'lidl', categoryName: 'Lidl > Cereales y untables' },
        { name: 'Pan de molde integral Lidl 750g', price: 1.29, imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=300', supermarket: 'lidl', categoryName: 'Lidl > Cereales y untables' },
        { name: 'Mermelada de fresa Lidl 370g', price: 0.89, imageUrl: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=300', supermarket: 'lidl', categoryName: 'Lidl > Cereales y untables' },
        { name: 'Crema de cacao y avellanas Lidl 400g', price: 1.49, imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300', supermarket: 'lidl', categoryName: 'Lidl > Cereales y untables' },
      ];
    }

    if (isDulces) {
      return [
        { name: 'Patatas chips Snackers Lidl 150g', price: 0.99, imageUrl: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=300', supermarket: 'lidl', categoryName: 'Lidl > Dulces y aperitivos' },
        { name: 'Galletas María Favorina Lidl 400g', price: 0.79, imageUrl: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=300', supermarket: 'lidl', categoryName: 'Lidl > Dulces y aperitivos' },
        { name: 'Chocolate con leche Fin Carré Lidl 100g', price: 0.59, imageUrl: 'https://images.unsplash.com/photo-1511381939415-e44015466834?w=300', supermarket: 'lidl', categoryName: 'Lidl > Dulces y aperitivos' },
        { name: 'Cacahuetes tostados Lidl 200g', price: 0.89, imageUrl: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=300', supermarket: 'lidl', categoryName: 'Lidl > Dulces y aperitivos' },
      ];
    }

    if (isBebidas) {
      return [
        { name: 'Agua mineral Saskia 1.5L Lidl', price: 0.25, imageUrl: 'https://images.unsplash.com/photo-1608686207856-001b95cf60ca?w=300', supermarket: 'lidl', categoryName: 'Lidl > Bebidas' },
        { name: 'Zumo de naranja 100% Lidl 1L', price: 1.49, imageUrl: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=300', supermarket: 'lidl', categoryName: 'Lidl > Bebidas' },
        { name: 'Refresco de cola Freeway Lidl 2L', price: 0.59, imageUrl: 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?w=300', supermarket: 'lidl', categoryName: 'Lidl > Bebidas' },
        { name: 'Leche de avena Lidl 1L', price: 1.19, imageUrl: 'https://images.unsplash.com/photo-1584363544559-5eca0c79e1a4?w=300', supermarket: 'lidl', categoryName: 'Lidl > Bebidas' },
        { name: 'Café molido mezcla Lidl 250g', price: 2.29, imageUrl: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=300', supermarket: 'lidl', categoryName: 'Lidl > Bebidas' },
      ];
    }

    // Generic fallback
    return [
      { name: 'Producto Lidl variado', price: 1.99, imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300', supermarket: 'lidl', categoryName: 'Lidl > Alimentación' },
    ];
  }
}
