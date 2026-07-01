export interface ScrapedProduct {
  name: string;
  price: number;
  imageUrl: string;
  supermarket: 'mercadona' | 'aldi' | 'dia' | 'carrefour' | 'alcampo';
  categoryName: string;
}

export interface ISupermarketScraper {
  supermarket: 'mercadona' | 'aldi' | 'dia' | 'carrefour' | 'alcampo';

  /**
   * Fetches the list of all category URLs/identifiers and their names for the supermarket.
   * This is used to populate the queue at the start of a scraping cycle.
   */
  fetchCategories(): Promise<{ url: string; name: string }[]>;

  /**
   * Scrapes all products within a specific category URL.
   * Processes a single category to fit within serverless execution limits.
   */
  scrapeCategory(categoryUrl: string): Promise<ScrapedProduct[]>;
}
