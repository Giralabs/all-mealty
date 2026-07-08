// test-local.js
// Integration test to verify all 6 scrapers and the Open Food Facts pipeline.

const mercadonaScraper = require('./scrapers/mercadona');
const carrefourScraper = require('./scrapers/carrefour');
const diaScraper = require('./scrapers/dia');
const alcampoScraper = require('./scrapers/alcampo');
const lidlScraper = require('./scrapers/lidl');
const aldiScraper = require('./scrapers/aldi');

const { transformProduct } = require('./utils/transformers');
const { fetchProductData } = require('./services/openFoodFacts');

process.env.SCRAPER_TEST_MODE = 'true';

const sleep = (ms) => new Promise(resolve => resolve && setTimeout(resolve, ms));

async function testLocal() {
  console.log('==================================================');
  console.log('INTEGRATION TEST: ALL SUPERMARKET SCRAPERS & OFF');
  console.log('==================================================\n');

  const scrapers = [
    { name: 'mercadona', scraper: mercadonaScraper },
    { name: 'carrefour', scraper: carrefourScraper },
    { name: 'dia',       scraper: diaScraper       },
    { name: 'alcampo',   scraper: alcampoScraper   },
    { name: 'lidl',      scraper: lidlScraper      },
    { name: 'aldi',      scraper: aldiScraper      }
  ];

  const allTransformed = [];

  for (const item of scrapers) {
    console.log(`\n--------------------------------------------------`);
    console.log(`RUNNING SCRAPER: ${item.name.toUpperCase()}`);
    console.log(`--------------------------------------------------`);

    try {
      const rawProducts = await item.scraper.scrape();
      console.log(`✓ Scraped ${rawProducts.length} unique products.`);

      if (rawProducts.length === 0) {
        console.warn(`⚠️ No products returned from ${item.name}.`);
        continue;
      }

      // Test 2 products per scraper to keep execution quick
      const limit = Math.min(rawProducts.length, 2);
      console.log(`Enriching first ${limit} products...`);

      for (let i = 0; i < limit; i++) {
        const prod = rawProducts[i];
        console.log(`\n  [${i + 1}/${limit}] Product: "${prod.name}"`);
        console.log(`  EAN: ${prod.ean || 'none'}`);

        let offData = {};
        try {
          offData = await fetchProductData(prod.ean, prod.name);
          console.log(`  → OFF Source: ${offData.source}, Labels: ${offData.labels_tags.slice(0, 3).join(', ') || 'none'}`);
        } catch (err) {
          console.error(`  → OFF Fetch Error:`, err.message);
        }

        const tags = transformProduct({
          name: prod.name,
          category: prod.category,
          ingredients: prod.raw_info,
          description: prod.raw_info
        }, offData);

        allTransformed.push({
          supermarket: prod.supermarket,
          name: prod.name,
          price: prod.price,
          price_per_kg: prod.price_per_kg,
          category: prod.category,
          image_url: prod.image_url,
          ean: prod.ean || offData.ean || null,
          nutritional_goals: tags.nutritional_goals,
          allergens_free: tags.allergens_free,
          cooking_methods: tags.cooking_methods,
          _off_source: offData.source
        });

        // 1000ms polite delay between OFF requests
        await sleep(1000);
      }

    } catch (err) {
      console.error(`❌ Scraper ${item.name} failed during execution:`, err);
    }
  }

  console.log(`\n==================================================`);
  console.log(`INTEGRATION RESULTS SUMMARY`);
  console.log(`==================================================`);
  console.log(`Total transformed and enriched products: ${allTransformed.length}`);
  console.log(JSON.stringify(allTransformed.slice(0, 5), null, 2));
  console.log(`==================================================\n`);
}

testLocal().catch(err => {
  console.error('Integration test crashed:', err);
});
