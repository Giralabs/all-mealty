const playwright = require('playwright');

/**
 * Scrapes Mercadona products by using Playwright to initialize a valid session
 * (entering postal code) and then querying their internal category/product API.
 * 
 * Extracts EAN barcodes and product description metadata.
 * 
 * @returns {Promise<Array>} List of raw scraped products.
 */
async function scrapeMercadona() {
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // Optimization: Block heavy and unnecessary network requests (images, fonts, stylesheets)
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    const url = route.request().url();
    // Allow API requests, documents, and scripts necessary for page initialization
    if (
      ['image', 'font', 'media', 'stylesheet'].includes(resourceType) ||
      url.includes('google-analytics') ||
      url.includes('doubleclick') ||
      url.includes('facebook')
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    console.log('[Mercadona Scraper] Navigating to shop home page...');
    await page.goto('https://tienda.mercadona.es/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle postal code modal to initialize session cookies
    console.log('[Mercadona Scraper] Entering postal code to initialize session...');
    const postalInputSelector = 'input[name="postalCode"], input[placeholder*="código postal" i], input[type="text"]';
    await page.waitForSelector(postalInputSelector, { timeout: 15000 });
    
    // We enter a valid Spanish postal code (e.g., 46001 for Valencia, where Mercadona is based)
    await page.type(postalInputSelector, '46001');
    await page.press(postalInputSelector, 'Enter');

    console.log('[Mercadona Scraper] Waiting for postal code modal to dismiss...');
    // Wait for the modal input to disappear from the DOM, signaling successful submission
    await page.waitForSelector(postalInputSelector, { state: 'hidden', timeout: 15000 }).catch((err) => {
      console.log('[Mercadona Scraper] Warning: Postal code input did not hide. Continuing...', err.message);
    });

    // Grace period for cookies and session to propagate
    await page.waitForTimeout(3000);

    // Call the internal API directly from the browser window context to avoid CORS and bot-detection limits
    console.log('[Mercadona Scraper] Fetching category tree from internal API...');
    const categoriesData = await page.evaluate(async () => {
      const response = await fetch('https://tienda.mercadona.es/api/categories/');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    });

    if (!categoriesData || !categoriesData.results) {
      throw new Error('Could not retrieve category list structure from Mercadona.');
    }

    const categoriesList = categoriesData.results;
    console.log(`[Mercadona Scraper] Found ${categoriesList.length} root categories.`);

    // Extract leaf subcategories
    const subcategoryIds = [];
    for (const rootCat of categoriesList) {
      if (!rootCat.categories) continue;
      for (const midCat of rootCat.categories) {
        // If there's a third level (leafCat), we crawl that. If not, midCat is the leaf!
        if (midCat.categories && midCat.categories.length > 0) {
          for (const leafCat of midCat.categories) {
            subcategoryIds.push({
              id: leafCat.id,
              name: leafCat.name,
              parentName: midCat.name
            });
          }
        } else {
          subcategoryIds.push({
            id: midCat.id,
            name: midCat.name,
            parentName: rootCat.name
          });
        }
      }
    }

    console.log(`[Mercadona Scraper] Total subcategories found to crawl: ${subcategoryIds.length}`);

    const totalCats = subcategoryIds.length;
    console.log(`[Mercadona Scraper] Crawling all ${totalCats} subcategories...`);

    const scrapedProducts = [];

    // 1. Gather all basic product information from categories list
    for (let i = 0; i < totalCats; i++) {
      const subcat = subcategoryIds[i];
      console.log(`[Mercadona Scraper] [${i + 1}/${totalCats}] Processing: ${subcat.parentName} > ${subcat.name} (ID: ${subcat.id})`);
      
      try {
        const subcatDetail = await page.evaluate(async (id) => {
          const response = await fetch(`https://tienda.mercadona.es/api/categories/${id}/`);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return await response.json();
        }, subcat.id);

        if (subcatDetail && subcatDetail.categories) {
          for (const itemGroup of subcatDetail.categories) {
            if (!itemGroup.products) continue;
            for (const prod of itemGroup.products) {
              const name = prod.display_name;
              const price = prod.price_instructions.unit_price;
              const pricePerKgText = prod.price_instructions.bulk_price;
              const price_per_kg = pricePerKgText ? parseFloat(pricePerKgText) : null;
              const image_url = prod.thumbnail;
              const category = `${subcat.parentName} > ${subcat.name}`;
              
              scrapedProducts.push({
                id: prod.id, // Store ID to fetch details
                supermarket: 'mercadona',
                name,
                price: price ? parseFloat(price) : null,
                price_per_kg,
                category,
                image_url,
                raw_info: `${name} ${category}`
              });
            }
          }
        }
        
        // Polite delay to avoid hammering the internal API
        await page.waitForTimeout(500);

      } catch (err) {
        console.error(`[Mercadona Scraper] Error retrieving subcategory ${subcat.id}:`, err.message);
      }
    }

    console.log(`[Mercadona Scraper] Scraped ${scrapedProducts.length} basic products. Fetching details and EAN barcodes...`);

    // 2. Fetch detailed EAN codes, ingredients, and descriptions in batches
    const productsWithBarcodes = [];
    const batchSize = 10;

    for (let i = 0; i < scrapedProducts.length; i += batchSize) {
      const batch = scrapedProducts.slice(i, i + batchSize);
      console.log(`[Mercadona Scraper] Fetching product details batch [${i + 1} - ${Math.min(i + batchSize, scrapedProducts.length)}] of ${scrapedProducts.length}...`);

      try {
        const details = await page.evaluate(async (items) => {
          return await Promise.all(items.map(async (item) => {
            try {
              const response = await fetch(`https://tienda.mercadona.es/api/products/${item.id}/`);
              if (response.ok) {
                const data = await response.json();
                return {
                  id: item.id,
                  ean: data.ean || null,
                  ingredients: data.nutrition_information?.ingredients || '',
                  allergens: data.nutrition_information?.allergens || '',
                  description: data.details?.description || ''
                };
              }
            } catch (e) {
              // Ignore failure for individual product detail
            }
            return { id: item.id, ean: null, ingredients: '', allergens: '', description: '' };
          }));
        }, batch.map(p => ({ id: p.id })));

        // Merge detail info back to products
        for (let j = 0; j < batch.length; j++) {
          const detail = details[j];
          const prod = batch[j];
          prod.ean = detail ? detail.ean : null;
          
          // Clean HTML tags from ingredients, allergens, and description (Mercadona returns formatted HTML strings)
          let ingredientsText = '';
          let allergensText = '';
          let descriptionText = '';

          if (detail) {
            ingredientsText = (detail.ingredients || '').replace(/<[^>]*>/g, ' ');
            allergensText = (detail.allergens || '').replace(/<[^>]*>/g, ' ');
            descriptionText = (detail.description || '').replace(/<[^>]*>/g, ' ');
          }

          prod.raw_info = `${prod.name} ${prod.category} ${descriptionText} ${ingredientsText} ${allergensText}`;
          productsWithBarcodes.push(prod);
        }
      } catch (err) {
        console.error(`[Mercadona Scraper] Batch detail fetch error:`, err.message);
        // Fallback: push products with null EAN if batch call fails completely
        for (const prod of batch) {
          prod.ean = null;
          productsWithBarcodes.push(prod);
        }
      }

      // Small polite delay between batch API fetches
      await page.waitForTimeout(100);
    }

    console.log(`[Mercadona Scraper] Scrape finished. Total products retrieved: ${productsWithBarcodes.length}`);
    return productsWithBarcodes;

  } catch (error) {
    console.error('[Mercadona Scraper] Critical error in Mercadona scraper:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrape: scrapeMercadona
};
