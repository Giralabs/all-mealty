/**
 * Cleans a product name by removing weights, quantities, packaging terms,
 * and descriptive words that cause Open Food Facts search queries to fail.
 * 
 * E.g., "Jamón Serrano Bodega en lonchas Carrefour El Mercado 500 g aprox" 
 *    → "Jamón Serrano Bodega Carrefour El Mercado"
 * 
 * @param {string} name
 * @returns {string}
 */
function cleanProductName(name) {
  if (!name) return '';
  return name
    // Remove weights and units: 150g, 1 Kg, 500 ml, 1.5 l, etc. (case-insensitive)
    .replace(/\b\d+([.,]\d+)?\s*(g|kg|ml|l|cl|ud|pcs|unidades|latas|brik|pack|paquete|gr|grs|kilos|gramos|litros|mililitros)\b/gi, '')
    // Remove descriptive weight terms: "aprox", "al corte", "en lonchas", etc.
    .replace(/\b(aprox|al corte|en lonchas|en rebanadas|corte a cuchillo|lonchas|loncheado|rebanadas|formato familiar|super pack|ahorro|pack de|pack)\b/gi, '')
    // Remove punctuation leftovers (like parentheses or dashes left after removals)
    .replace(/[()\-+,.]/g, ' ')
    // Replace multiple spaces with a single space and trim
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches product metadata from the Open Food Facts API.
 * Uses barcode (EAN) primary lookup. Falls back to text search if EAN is missing or not found.
 * 
 * @param {string|null} ean - The product barcode
 * @param {string} name - The product name for search fallback
 * @returns {Promise<Object>} Standardized product metadata from Open Food Facts
 */
async function fetchProductData(ean, name) {
  const userAgent = 'MealtyScraper - Node - Version 1.0 - https://giralabs.com/mealty';
  
  // Standardized default response object indicating no enrichment
  const defaultResponse = {
    ean: ean || null,
    nutriments: null,
    allergens_tags: [],
    allergens_from_ingredients: '',
    labels_tags: [],
    source: 'none'
  };

  const trimmedEan = ean ? ean.trim() : null;
  
  // Rule: If the EAN barcode starts with 20 to 29, it is an internal/variable weight code.
  // We skip EAN lookup and jump straight to the cleaned text search.
  const isInternalBarcode = trimmedEan && /^2[0-9]/.test(trimmedEan);

  // 1. Try EAN Lookup if present and not an internal code
  if (trimmedEan && !isInternalBarcode) {
    const eanUrl = `https://world.openfoodfacts.org/api/v2/product/${trimmedEan}.json`;
    console.log(`[Open Food Facts] Looking up EAN: ${trimmedEan}...`);
    
    try {
      const response = await fetch(eanUrl, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(5000) // 5-second timeout
      });

      if (response.status === 503) {
        console.warn(`[Open Food Facts] ⚠️ 503 Service Unavailable for EAN ${trimmedEan}. Skipping to fallback.`);
      } else if (response.ok) {
        const data = await response.json();
        if (data && data.status === 1 && data.product) {
          console.log(`[Open Food Facts] EAN ${trimmedEan} found!`);
          return {
            ean: trimmedEan,
            nutriments: data.product.nutriments || null,
            allergens_tags: data.product.allergens_tags || [],
            allergens_from_ingredients: data.product.allergens_from_ingredients || '',
            labels_tags: data.product.labels_tags || [],
            source: 'ean_api'
          };
        } else {
          console.log(`[Open Food Facts] EAN ${trimmedEan} not found in database. Trying search fallback...`);
        }
      } else {
        console.warn(`[Open Food Facts] EAN lookup returned status ${response.status}. trying search fallback...`);
      }
    } catch (err) {
      console.warn(`[Open Food Facts] EAN lookup failed for ${trimmedEan}:`, err.message || err);
    }
  }

  // 2. Fallback Search by Text (with 503 Exponential Backoff Retry)
  if (name) {
    const cleanedName = cleanProductName(name);
    if (cleanedName.length > 0) {
      const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanedName)}&search_simple=1&action=process&json=1&page_size=3`;
      
      const maxRetries = 1;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          console.log(`[Open Food Facts] [Retry] Waiting 2000ms before retrying search for "${cleanedName}"...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        try {
          console.log(`[Open Food Facts] Searching text fallback (attempt ${attempt + 1}/${maxRetries + 1}) for: "${cleanedName}"`);
          const response = await fetch(searchUrl, {
            headers: { 'User-Agent': userAgent },
            signal: AbortSignal.timeout(5000)
          });

          if (response.status === 503) {
            console.warn(`[Open Food Facts] ⚠️ 503 Service Unavailable (attempt ${attempt + 1}/${maxRetries + 1}).`);
            if (attempt === maxRetries) {
              console.warn(`[Open Food Facts] Max retries reached. Returning default schema.`);
              return defaultResponse;
            }
            continue; // trigger next loop iteration with retry delay
          }

          if (response.ok) {
            const data = await response.json();
            if (data && data.products && data.products.length > 0) {
              const product = data.products[0];
              console.log(`[Open Food Facts] Found text match: "${product.product_name}" (EAN: ${product.code})`);
              return {
                ean: product.code || trimmedEan || null,
                nutriments: product.nutriments || null,
                allergens_tags: product.allergens_tags || [],
                allergens_from_ingredients: product.allergens_from_ingredients || '',
                labels_tags: product.labels_tags || [],
                source: 'text_search'
              };
            } else {
              console.log(`[Open Food Facts] No text search results found for name: "${cleanedName}"`);
              break; // no results found, don't waste time retrying
            }
          } else {
            console.warn(`[Open Food Facts] Text search failed with status: ${response.status}`);
            break; // other error, skip retry
          }
        } catch (err) {
          console.warn(`[Open Food Facts] Text search error (attempt ${attempt + 1}/${maxRetries + 1}):`, err.message || err);
          if (attempt === maxRetries) return defaultResponse;
        }
      }
    }
  }

  return defaultResponse;
}

module.exports = {
  fetchProductData,
  cleanProductName
};
