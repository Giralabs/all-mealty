import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../db';
import { MercadonaScraper } from '../../../../services/scraper/mercadona';
import { AldiScraper } from '../../../../services/scraper/aldi';
import { DiaScraper } from '../../../../services/scraper/dia';
import { CarrefourScraper } from '../../../../services/scraper/carrefour';
import { AlcampoScraper } from '../../../../services/scraper/alcampo';
import { MatchingService } from '../../../../services/matching.service';

// Matching Service
const matchingService = new MatchingService();

// Supermarket Scrapers Registry
const scrapers = {
  mercadona: new MercadonaScraper(),
  aldi: new AldiScraper(),
  dia: new DiaScraper(),
  carrefour: new CarrefourScraper(),
  alcampo: new AlcampoScraper(),
};

/**
 * Main handler for Vercel Cron Jobs.
 * Cron expression: 0 3 * / 3 * * (every 3 days at 3:00 AM)
 */
export async function GET(req: NextRequest) {
  return handleScraping(req);
}

export async function POST(req: NextRequest) {
  return handleScraping(req);
}

async function handleScraping(req: NextRequest) {
  const startTime = Date.now();
  // We stop processing new items after 20s to prevent PgBouncer connection issues and timeout limits.
  const TIMEOUT_LIMIT_MS = 20000; 
  const searchParams = req.nextUrl.searchParams;
  
  // 1. Authorization Check
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const targetSupermarket = searchParams.get('supermarket'); // e.g. 'aldi', 'dia', 'carrefour', 'alcampo'

    // 2. Check if the Queue needs to be populated
    // We filter by targetSupermarket if specified to allow isolated supermarket runs
    const activeQueueItemsCount = await prisma.scrapingQueue.count({
      where: {
        status: { in: ['pending', 'processing'] },
        ...(targetSupermarket ? { supermarket: targetSupermarket as any } : {})
      }
    });

    if (activeQueueItemsCount === 0) {
      console.log('Scraping queue is empty. Initializing new scraping cycle...');
      
      // Clear completed/failed items from previous run to clean up the DB
      // If filtering by a specific supermarket, only delete queue items of that supermarket
      if (targetSupermarket) {
        await prisma.scrapingQueue.deleteMany({
          where: { supermarket: targetSupermarket as any }
        });
      } else {
        await prisma.scrapingQueue.deleteMany({});
      }
      
      // Fetch categories from all active scrapers and populate queue
      for (const [supermarket, scraper] of Object.entries(scrapers)) {
        // If a specific supermarket was targeted, skip all other supermarkets
        if (targetSupermarket && supermarket !== targetSupermarket) {
          continue;
        }

        try {
          console.log(`Fetching categories for ${supermarket}...`);
          const categories = await scraper.fetchCategories();
          
          if (categories.length > 0) {
            await prisma.scrapingQueue.createMany({
              data: categories.map(cat => ({
                supermarket: supermarket as any,
                categoryUrl: cat.url,
                categoryName: cat.name,
                status: 'pending'
              }))
            });
            console.log(`Added ${categories.length} categories for ${supermarket} to the queue.`);
          }
        } catch (scraperErr: any) {
          console.error(`Error initializing queue for ${supermarket}:`, scraperErr.message);
        }
      }
    }

    // 3. Process Chunked Queue Items
    let processedCount = 0;
    let hasMorePending = true;

    while (true) {
      // Check if we are running out of time in the current serverless invocation
      const elapsed = Date.now() - startTime;
      if (elapsed > TIMEOUT_LIMIT_MS) {
        console.log(`Approaching Vercel timeout limits (${elapsed}ms elapsed). Chaining next batch...`);
        
        // Trigger next batch asynchronously
        const host = req.headers.get('host') || 'localhost:3000';
        const protocol = req.nextUrl.protocol; // 'http:' or 'https:'
        
        // Non-blocking self-call
        triggerSelfCall(protocol, host, cronSecret || '', targetSupermarket || undefined);
        
        return NextResponse.json({
          message: `Batch execution paused. Processed ${processedCount} categories. Chained next invocation.`,
          status: 'chunk_paused'
        });
      }

      // Fetch the next pending category in the queue
      const queueItem = await prisma.scrapingQueue.findFirst({
        where: {
          status: 'pending',
          ...(targetSupermarket ? { supermarket: targetSupermarket as any } : {})
        },
        orderBy: { createdAt: 'asc' }
      });

      if (!queueItem) {
        hasMorePending = false;
        break; // Queue is fully empty or completed
      }

      console.log(`Processing Queue Item: ${queueItem.supermarket} - ${queueItem.categoryName}`);

      // Lock item for processing
      await prisma.scrapingQueue.update({
        where: { id: queueItem.id },
        data: { status: 'processing', lastAttempt: new Date() }
      });

      try {
        const scraper = scrapers[queueItem.supermarket];
        if (!scraper) {
          throw new Error(`No scraper implemented for supermarket: ${queueItem.supermarket}`);
        }

        // Scrape category
        const scrapedProducts = await scraper.scrapeCategory(queueItem.categoryUrl);
        console.log(`Scraped ${scrapedProducts.length} raw products from ${queueItem.categoryName}`);

        // Enrich and Upsert products in database
        for (const prod of scrapedProducts) {
          const enriched = await matchingService.enrichProduct(prod);

          // Find existing product to update or create new one
          const existingProduct = await prisma.product.findFirst({
            where: {
              name: enriched.name,
              supermarket: enriched.supermarket as any
            }
          });

          if (existingProduct) {
            await prisma.product.update({
              where: { id: existingProduct.id },
              data: {
                price: enriched.price,
                imageUrl: enriched.imageUrl,
                isFood: enriched.isFood,
                dietTypes: enriched.dietTypes,
                allergens: enriched.allergens,
                cookingMethods: enriched.cookingMethods,
                nutritionalInfo: enriched.nutritionalInfo ?? null,
                lastUpdated: new Date()
              }
            });
          } else {
            await prisma.product.create({
              data: {
                name: enriched.name,
                price: enriched.price,
                imageUrl: enriched.imageUrl,
                supermarket: enriched.supermarket as any,
                isFood: enriched.isFood,
                dietTypes: enriched.dietTypes,
                allergens: enriched.allergens,
                cookingMethods: enriched.cookingMethods,
                nutritionalInfo: enriched.nutritionalInfo ?? null
              }
            });
          }
        }

        // Mark category as completed
        await prisma.scrapingQueue.update({
          where: { id: queueItem.id },
          data: { status: 'completed' }
        });
        
        processedCount++;

      } catch (err: any) {
        console.error(`Failed to process category ${queueItem.categoryName}:`, err);
        
        // Mark category as failed and save error log
        await prisma.scrapingQueue.update({
          where: { id: queueItem.id },
          data: { 
            status: 'failed',
            error: err.message || 'Unknown error'
          }
        });
      }
    }

    return NextResponse.json({
      message: `Scraping run completed successfully. Processed ${processedCount} categories.`,
      status: 'completed',
      hasMorePending
    });

  } catch (error: any) {
    console.error('Fatal error in scraping pipeline:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Triggers a non-blocking asynchronous call to this same route
 * to process the next batch.
 */
function triggerSelfCall(protocol: string, host: string, secret: string, targetSupermarket?: string) {
  let url = `${protocol}//${host}/api/cron/scrape`;
  if (targetSupermarket) {
    url += `?supermarket=${targetSupermarket}`;
  }
  
  fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json'
    }
  }).catch(err => {
    // Ignored on purpose (fire-and-forget will trigger network abort on connection close, which is fine)
    console.log('Self-call triggered for next batch.');
  });
}

/*
================================================================================
DRIZZLE ORM IMPLEMENTATION HINT:
================================================================================
If you prefer Drizzle ORM instead of Prisma, replace the DB logic as follows:

import { db } from '@/db';
import { products, scrapingQueue } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// Fetch active count:
const activeQueueItems = await db.select()
  .from(scrapingQueue)
  .where(inArray(scrapingQueue.status, ['pending', 'processing']));

// Delete queue:
await db.delete(scrapingQueue);

// Create many queue:
await db.insert(scrapingQueue).values(categories.map(...));

// Find first pending:
const [queueItem] = await db.select()
  .from(scrapingQueue)
  .where(eq(scrapingQueue.status, 'pending'))
  .limit(1);

// Update status to processing:
await db.update(scrapingQueue)
  .set({ status: 'processing', lastAttempt: new Date() })
  .where(eq(scrapingQueue.id, queueItem.id));

// Find product for upsert:
const [existingProduct] = await db.select()
  .from(products)
  .where(and(
    eq(products.name, enriched.name),
    eq(products.supermarket, enriched.supermarket)
  ));
================================================================================
*/
