import * as cheerio from 'cheerio';
import { ISupermarketScraper, ScrapedProduct } from './base.scraper';

export class AlcampoScraper implements ISupermarketScraper {
  readonly supermarket = 'alcampo';
  private readonly baseUrl = 'https://www.alcampo.es';

  /**
   * Returns Alcampo's main category paths for the queue.
   */
  async fetchCategories(): Promise<{ url: string; name: string }[]> {
    const categories = [
      { path: 'alimentacion/c/W10', name: 'Alcampo > Alimentación' },
      { path: 'frescos/c/W11', name: 'Alcampo > Frescos' },
      { path: 'bebidas/c/W12', name: 'Alcampo > Bebidas' },
      { path: 'congelados/c/W13', name: 'Alcampo > Congelados' },
      { path: 'drogueria-y-limpieza/c/W15', name: 'Alcampo > Droguería y Limpieza' },
      { path: 'perfumeria-y-parafarmacia/c/W16', name: 'Alcampo > Perfumería e Higiene' },
    ];

    return categories.map(cat => ({
      url: `${this.baseUrl}/compra-online/es/${cat.path}`,
      name: cat.name,
    }));
  }

  /**
   * Scrapes all products from Alcampo's category page by parsing their window.__INITIAL_STATE__ script block.
   */
  async scrapeCategory(categoryUrl: string): Promise<ScrapedProduct[]> {
    const response = await fetch(categoryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Alcampo category ${categoryUrl}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Find and extract window.__INITIAL_STATE__ object safely using bracket counting
    const prefix = "window.__INITIAL_STATE__=";
    const startIndex = html.indexOf(prefix);
    
    if (startIndex === -1) {
      throw new Error(`Could not find window.__INITIAL_STATE__ block on Alcampo page ${categoryUrl}`);
    }

    const jsonStart = html.indexOf('{', startIndex);
    let bracketCount = 0;
    let jsonEnd = -1;

    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') bracketCount++;
      else if (html[i] === '}') {
        bracketCount--;
        if (bracketCount === 0) {
          jsonEnd = i;
          break;
        }
      }
    }

    if (jsonEnd === -1) {
      throw new Error(`Failed to identify matching brackets for Alcampo state on ${categoryUrl}`);
    }

    const jsonStr = html.substring(jsonStart, jsonEnd + 1);
    const stateJson = JSON.parse(jsonStr);

    const productEntities = stateJson.data?.products?.productEntities || {};
    const scrapedProducts: ScrapedProduct[] = [];

    for (const item of Object.values(productEntities) as any[]) {
      const name = item.name;
      const price = parseFloat(item.price?.current?.amount);
      const imageUrl = item.image?.src;

      if (!name || isNaN(price) || !imageUrl) {
        continue;
      }

      scrapedProducts.push({
        name,
        price,
        imageUrl,
        supermarket: 'alcampo',
        categoryName: item.brand || 'Alcampo Category',
      });
    }

    return scrapedProducts;
  }
}
