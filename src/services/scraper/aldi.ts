import * as cheerio from 'cheerio';
import { ISupermarketScraper, ScrapedProduct } from './base.scraper';

export class AldiScraper implements ISupermarketScraper {
  readonly supermarket = 'aldi';
  private readonly baseUrl = 'https://www.aldi.es';

  /**
   * Returns Aldi's weekly offers catalog page for the queue.
   * Aldi Spain mainly lists their active catalog items under "ofertas.html".
   */
  async fetchCategories(): Promise<{ url: string; name: string }[]> {
    return [
      {
        url: `${this.baseUrl}/ofertas.html`,
        name: 'Aldi > Ofertas Semanales',
      },
    ];
  }

  /**
   * Scrapes all products from Aldi's weekly offers page using their Next.js hydration payload.
   */
  async scrapeCategory(categoryUrl: string): Promise<ScrapedProduct[]> {
    const response = await fetch(categoryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Aldi category ${categoryUrl}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const nextScript = $('#__NEXT_DATA__');

    if (nextScript.length === 0) {
      throw new Error('Could not find Aldi NextJS __NEXT_DATA__ script block.');
    }

    const json = JSON.parse(nextScript.html() || '{}');
    const apiData = json.props?.pageProps?.apiData;

    if (!apiData) {
      throw new Error('Could not find apiData inside Aldi PageProps.');
    }

    // Reconstruction: apiData is a split chunked array of characters/strings
    const serialized = Object.values(apiData).join('');
    const parsedData = JSON.parse(serialized);

    // Deep search helper to find the Algolia data map in the reconstructed structure
    let algoliaMap: any = null;
    const findAlgoliaMap = (obj: any) => {
      if (!obj || typeof obj !== 'object' || algoliaMap) return;
      if (obj.algoliaDataMap && typeof obj.algoliaDataMap === 'object') {
        algoliaMap = obj.algoliaDataMap;
        return;
      }
      for (const k of Object.keys(obj)) {
        findAlgoliaMap(obj[k]);
      }
    };
    findAlgoliaMap(parsedData);

    if (!algoliaMap) {
      throw new Error('Could not find algoliaDataMap inside reconstructed Aldi payload.');
    }

    const scrapedProducts: ScrapedProduct[] = [];

    for (const item of Object.values(algoliaMap) as any[]) {
      const name = item.name;
      const price = parseFloat(item.currentPrice?.priceValue || item.promotionPrices?.[0]?.priceValue);
      const imageUrl = item.assets?.find((a: any) => a.type === 'primary')?.url || item.assets?.[0]?.url;

      if (!name || isNaN(price) || !imageUrl) {
        continue;
      }

      scrapedProducts.push({
        name,
        price,
        imageUrl,
        supermarket: 'aldi',
        categoryName: item.brandName || 'Aldi Ofertas',
      });
    }

    return scrapedProducts;
  }
}
