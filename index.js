require('dotenv').config();
// Force full production mode for scrapers
process.env.SCRAPER_TEST_MODE = 'false';

const { createClient } = require('@supabase/supabase-js');
const mercadonaScraper = require('./scrapers/mercadona');
const carrefourScraper = require('./scrapers/carrefour');
const diaScraper = require('./scrapers/dia');
const alcampoScraper = require('./scrapers/alcampo');
const lidlScraper = require('./scrapers/lidl');
const aldiScraper = require('./scrapers/aldi');
const { transformProduct } = require('./utils/transformers');
const { fetchProductData } = require('./services/openFoodFacts');

// Validate Environment Variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey || supabaseServiceKey === 'YOUR_SUPABASE_SERVICE_ROLE_KEY') {
  console.error('[Orchestrator] Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.');
  console.error('[Orchestrator] Please update the .env file with your actual Supabase Service Role Key.');
  process.exit(1);
}

// Initialize Supabase Client using Service Role key for admin rights (bypassing RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Batch size for upserts
const BATCH_SIZE = 100;
// Sleep utility for Rate Limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runScrapers() {
  console.log('[Orchestrator] Starting product scraping and enrichment cycle...');
  const startTime = Date.now();

  const scrapers = [
    { name: 'mercadona', run: mercadonaScraper.scrape },
    { name: 'carrefour', run: carrefourScraper.scrape },
    { name: 'dia',       run: diaScraper.scrape       },
    { name: 'alcampo',   run: alcampoScraper.scrape   },
    { name: 'lidl',      run: lidlScraper.scrape      },
    { name: 'aldi',      run: aldiScraper.scrape      },
  ];

  let totalScraped = 0;
  let totalUpserted = 0;

  for (const scraper of scrapers) {
    console.log(`\n[Orchestrator] Running scraper for: ${scraper.name.toUpperCase()}`);
    try {
      // 1. Run Scraper to get products (with EANs if available)
      const rawProducts = await scraper.run();
      console.log(`[Orchestrator] Scraped ${rawProducts.length} products from ${scraper.name}.`);

      if (rawProducts.length === 0) {
        console.log(`[Orchestrator] No products retrieved for ${scraper.name}. Skipping database upsert.`);
        continue;
      }

      totalScraped += rawProducts.length;

      // 2. Enrich products with Open Food Facts API and Transform
      console.log(`[Orchestrator] Enriching and transforming products...`);
      const transformedProducts = [];

      for (let i = 0; i < rawProducts.length; i++) {
        const prod = rawProducts[i];
        console.log(`[Orchestrator] [${i + 1}/${rawProducts.length}] Processing product: "${prod.name}" (EAN: ${prod.ean || 'None'})`);
        
        let offData = {};
        try {
          // Fetch data from Open Food Facts API (handles barcode lookup and text search fallback)
          offData = await fetchProductData(prod.ean, prod.name);
        } catch (err) {
          console.warn(`[Orchestrator] Open Food Facts enrichment failed for "${prod.name}":`, err.message || err);
          console.warn(`[Orchestrator] Falling back to basic supermarket data for database upsert.`);
        }

        // Cross-reference data via the evolved transformer
        const tags = transformProduct({
          name: prod.name,
          category: prod.category,
          ingredients: prod.raw_info,
          description: prod.raw_info
        }, offData);

        transformedProducts.push({
          supermarket: prod.supermarket,
          name: prod.name,
          price: prod.price,
          price_per_kg: prod.price_per_kg,
          category: prod.category,
          image_url: prod.image_url,
          nutritional_goals: tags.nutritional_goals,
          allergens_free: tags.allergens_free,
          cooking_methods: tags.cooking_methods
        });

        // Critical rate limiting requirement: Sleep at least 1000ms between calls to Open Food Facts
        await sleep(1000);
      }

      // 3. Batch Upsert to Supabase
      console.log(`\n[Orchestrator] Upserting products to Supabase in batches of ${BATCH_SIZE}...`);
      for (let i = 0; i < transformedProducts.length; i += BATCH_SIZE) {
        const batch = transformedProducts.slice(i, i + BATCH_SIZE);
        
        const { error } = await supabase
          .from('products')
          .upsert(batch, { onConflict: 'supermarket,name' });

        if (error) {
          console.error(`[Orchestrator] Error upserting batch starting at index ${i}:`, error.message);
        } else {
          totalUpserted += batch.length;
          console.log(`[Orchestrator] Upserted batch [${i + 1} - ${Math.min(i + BATCH_SIZE, transformedProducts.length)}] successfully.`);
        }
      }

    } catch (error) {
      console.error(`[Orchestrator] Scraper "${scraper.name}" failed:`, error.message || error);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n==================================================`);
  console.log(`[Orchestrator] Scraping & Enrichment cycle completed in ${durationSec}s.`);
  console.log(`[Orchestrator] Total products scraped: ${totalScraped}`);
  console.log(`[Orchestrator] Total products upserted: ${totalUpserted}`);
  console.log(`==================================================`);
}

// Execute orchestrator
runScrapers().catch(err => {
  console.error('[Orchestrator] Unhandled critical error in runner:', err);
  process.exit(1);
});
