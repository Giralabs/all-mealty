import { ISupermarketScraper, ScrapedProduct } from './base.scraper';

export class MercadonaScraper implements ISupermarketScraper {
  readonly supermarket = 'mercadona';

  private readonly apiBaseUrl = 'https://tienda.mercadona.es/api';

  /**
   * Fetches the category tree from Mercadona and extracts all level 2 category IDs
   * to use as queue items.
   */
  async fetchCategories(): Promise<{ url: string; name: string }[]> {
    const response = await fetch(`${this.apiBaseUrl}/categories/`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Mercadona categories: ${response.statusText}`);
    }

    const data = await response.json();
    const categories: { url: string; name: string }[] = [];

    // Traverse the category tree
    // Root level: results
    if (data.results && Array.isArray(data.results)) {
      for (const root of data.results) {
        const rootName = root.name; // e.g. "Aceite, especias y salsas" or "Limpieza y hogar"

        if (root.categories && Array.isArray(root.categories)) {
          for (const sub of root.categories) {
            // "sub" represents subcategories (e.g. "Aceite, vinagre y sal")
            // We can scrape at this level since the sub-category API returns its nested leaf categories and products.
            const url = `${this.apiBaseUrl}/categories/${sub.id}/`;
            categories.push({
              url,
              name: `${rootName} > ${sub.name}`,
            });
          }
        }
      }
    }

    return categories;
  }

  /**
   * Scrapes all products from a Mercadona category detail API endpoint.
   */
  async scrapeCategory(categoryUrl: string): Promise<ScrapedProduct[]> {
    const response = await fetch(categoryUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Mercadona products for category ${categoryUrl}: ${response.statusText}`);
    }

    const data = await response.json();
    const scrapedProducts: ScrapedProduct[] = [];

    // In a category page response, we have:
    // data.categories -> array of leaf subcategories
    // each leaf subcategory has a list of "products"
    if (data.categories && Array.isArray(data.categories)) {
      for (const leafCat of data.categories) {
        const leafCatName = leafCat.name;

        if (leafCat.products && Array.isArray(leafCat.products)) {
          for (const prod of leafCat.products) {
            // Mercadona products are only considered active/available if they have a unit_price
            const price = parseFloat(prod.price_instructions?.unit_price);
            if (isNaN(price) || !prod.thumbnail || !prod.display_name) {
              continue; // Skip products with missing critical info
            }

            scrapedProducts.push({
              name: prod.display_name,
              price: price,
              imageUrl: prod.thumbnail,
              supermarket: 'mercadona',
              categoryName: `${data.name || ''} > ${leafCatName}`,
            });
          }
        }
      }
    }

    return scrapedProducts;
  }
}
