// test-carrefour.js
// Runs the Carrefour scraper in test mode and validates the EAN + transformer pipeline.
// Usage:  node test-carrefour.js

const carrefourScraper = require('./scrapers/carrefour');
const { transformProduct } = require('./utils/transformers');
const { fetchProductData } = require('./services/openFoodFacts');

// Test mode: 2 categories × 2 pages ≈ ~100 products
process.env.SCRAPER_TEST_MODE = 'true';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function testCarrefour() {
  console.log('==================================================');
  console.log(' CARREFOUR SCRAPER — LOCAL TEST                  ');
  console.log('==================================================\n');

  // ── 1. Scrape ────────────────────────────────────────────────────────────────
  let rawProducts;
  try {
    rawProducts = await carrefourScraper.scrape();
  } catch (err) {
    console.error('Scraper failed:', err);
    process.exit(1);
  }

  if (rawProducts.length === 0) {
    console.error('No products returned. Check the selectors in scrapers/carrefour.js');
    process.exit(1);
  }

  // ── 2. Print EAN stats ────────────────────────────────────────────────────────
  const withEan  = rawProducts.filter(p => p.ean);
  const withoutEan = rawProducts.filter(p => !p.ean);
  console.log(`\nTotal scraped   : ${rawProducts.length}`);
  console.log(`With EAN        : ${withEan.length} (${((withEan.length / rawProducts.length) * 100).toFixed(1)}%)`);
  console.log(`Without EAN     : ${withoutEan.length}`);

  // Print sample EAN products
  console.log('\nSample products with EAN:');
  withEan.slice(0, 5).forEach(p =>
    console.log(`  [${p.ean}] ${p.name}  (€${p.price})`)
  );
  console.log('\nSample products without EAN:');
  withoutEan.slice(0, 3).forEach(p =>
    console.log(`  [---] ${p.name}  img: ${p.image_url?.slice(0, 60) ?? 'n/a'}`)
  );

  // ── 3. Enrich first 5 with Open Food Facts ────────────────────────────────────
  const ENRICH_LIMIT = 5;
  console.log(`\n── Open Food Facts enrichment (first ${ENRICH_LIMIT} products) ──`);
  const transformed = [];

  for (let i = 0; i < rawProducts.length; i++) {
    const prod = rawProducts[i];
    const shouldEnrich = i < ENRICH_LIMIT;
    let offData = {};

    if (shouldEnrich) {
      console.log(`\n[${i + 1}/${ENRICH_LIMIT}] "${prod.name}" (EAN: ${prod.ean ?? 'none'})`);
      try {
        offData = await fetchProductData(prod.ean, prod.name);
        console.log(`  → source: ${offData.source}, labels: ${offData.labels_tags.slice(0,3).join(', ')||'none'}`);
      } catch (err) {
        console.warn(`  → OFF lookup failed: ${err.message}`);
      }
      await sleep(1000); // respect rate-limit
    }

    const tags = transformProduct(
      { name: prod.name, category: prod.category, ingredients: prod.raw_info, description: prod.raw_info },
      offData
    );

    transformed.push({
      supermarket: prod.supermarket,
      name:        prod.name,
      price:       prod.price,
      price_per_kg: prod.price_per_kg,
      category:    prod.category,
      image_url:   prod.image_url,
      nutritional_goals: tags.nutritional_goals,
      allergens_free:    tags.allergens_free,
      cooking_methods:   tags.cooking_methods,
      _ean:        prod.ean,
      _enriched:   shouldEnrich,
    });
  }

  // ── 4. Print transformed sample ───────────────────────────────────────────────
  console.log('\n── Transformed sample (first 3) ──');
  console.log(JSON.stringify(transformed.slice(0, 3), null, 2));

  // ── 5. Stats ──────────────────────────────────────────────────────────────────
  const goalsCount   = {};
  const allergensCount = {};
  const cookingCount  = {};
  transformed.forEach(p => {
    p.nutritional_goals.forEach(g => goalsCount[g]    = (goalsCount[g]    || 0) + 1);
    p.allergens_free.forEach(a    => allergensCount[a] = (allergensCount[a] || 0) + 1);
    p.cooking_methods.forEach(c   => cookingCount[c]   = (cookingCount[c]   || 0) + 1);
  });

  console.log('\n── STATISTICS ──────────────────────────────────────');
  console.log('Nutritional Goals :', goalsCount);
  console.log('Allergens Free    :', allergensCount);
  console.log('Cooking Methods   :', cookingCount);
  console.log('────────────────────────────────────────────────────\n');
}

testCarrefour().catch(err => { console.error(err); process.exit(1); });
