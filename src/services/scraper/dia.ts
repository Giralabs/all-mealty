import { ISupermarketScraper, ScrapedProduct } from './base.scraper';

export class DiaScraper implements ISupermarketScraper {
  readonly supermarket = 'dia';
  private readonly apiBaseUrl = 'https://www.dia.es/api/v1';
  private readonly imageBaseUrl = 'https://www.dia.es';

  /**
   * Dynamically crawls Dia's category tree to retrieve all active categories.
   */
  async fetchCategories(): Promise<{ url: string; name: string }[]> {
    try {
      // Fetch a basic PLP page to get the categories hierarchy tree dynamically
      const initialUrl = `${this.apiBaseUrl}/plp-back/category/L2302?navigation=L2302&page=1&size=1`;
      const response = await fetch(initialUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        const categories: { url: string; name: string }[] = [];

        const processNode = (node: any, path: string) => {
          const currentPath = path ? `${path} > ${node.name}` : node.name;
          if (node.id && Array.isArray(node.children) && node.children.length === 0) {
            categories.push({
              url: `${this.apiBaseUrl}/plp-back/category/${node.id}?navigation=${node.id}&page=1&size=100`,
              name: `Dia > ${currentPath}`,
            });
          }
          if (Array.isArray(node.children)) {
            for (const child of node.children) {
              processNode(child, currentPath);
            }
          }
        };

        const roots = data.category_data?.categories || [];
        for (const root of roots) {
          processNode(root, '');
        }

        if (categories.length > 0) {
          // Limit to first 25 categories to avoid over-saturating during testing/small environments
          return categories.slice(0, 25);
        }
      }
    } catch (e: any) {
      console.warn(`Dia dynamic categories crawl failed, using fallback list. Error: ${e.message}`);
    }

    // Fallback static categories
    return [
      { url: `${this.apiBaseUrl}/plp-back/category/L2302?navigation=L2302&page=1&size=100`, name: 'Dia > Novedades' },
      { url: `${this.apiBaseUrl}/plp-back/category/L2001?navigation=L2001&page=1&size=100`, name: 'Dia > Frescos' },
      { url: `${this.apiBaseUrl}/plp-back/category/L2002?navigation=L2002&page=1&size=100`, name: 'Dia > Despensa' },
      { url: `${this.apiBaseUrl}/plp-back/category/L2003?navigation=L2003&page=1&size=100`, name: 'Dia > Bebidas' },
    ];
  }

  /**
   * Scrapes all products from Dia's JSON category listing API.
   */
  async scrapeCategory(categoryUrl: string): Promise<ScrapedProduct[]> {
    const response = await fetch(categoryUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Dia products from ${categoryUrl}: ${response.statusText}`);
    }

    const data = await response.json();
    const scrapedProducts: ScrapedProduct[] = [];
    const items = data.plp_items || [];

    for (const item of items) {
      const name = item.display_name;
      const price = parseFloat(item.prices?.price);
      let image = item.image;

      if (!name || isNaN(price) || !image) {
        continue;
      }

      if (image && !image.startsWith('http')) {
        image = `${this.imageBaseUrl}${image}`;
      }

      scrapedProducts.push({
        name,
        price,
        imageUrl: image,
        supermarket: 'dia',
        categoryName: item.brand || 'Dia Category',
      });
    }

    return scrapedProducts;
  }
}
