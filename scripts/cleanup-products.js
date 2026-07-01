const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class MatchingService {
  constructor() {
    this.openFoodFactsSearchUrl = 'https://es.openfoodfacts.org/cgi/search.pl';
  }

  normalizeText(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  cleanName(name) {
    const firstLine = name.split('\n').map(l => l.trim()).find(l => l.length > 0) || name;
    let cleaned = firstLine.toLowerCase();
    
    // Remove typical weight/measure markers: e.g. "500 g", "1,5 kg", "1L", "250 ml", "12 uds", "pack 6", "x6"
    cleaned = cleaned.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|uds|unidades|paquetes|botellas|latas|lata|botella|pack|gr|ozs?|x\s*\d+)\b/gi, '');
    
    // Remove common branding punctuation and double spaces
    cleaned = cleaned.replace(/[^a-záéíóúüñ0-9\s]/gi, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }

  cleanForComparison(name) {
    let s = this.cleanName(name);
    s = this.normalizeText(s);

    // Map banana to platano synonym
    s = s.replace(/\bbanana\b/g, 'platano');
    s = s.replace(/\bbananas\b/g, 'platanos');
    
    const wordsToRemove = [
      // Brands
      'hacendado', 'carrefour', 'alcampo', 'aldi', 'dia', 'pascual', 'danone', 'nestle', 'campofrio', 'elpozo',
      'gullon', 'casa tarradellas', 'buitoni', 'pescanova', 'gallina blanca', 'knorr',
      // Packaging / Descriptors
      'botella', 'bolsa', 'tarro', 'paquete', 'tarrina', 'tetrabrik', 'brik', 'caja', 'lata', 'congelado',
      'congelada', 'fileteado', 'fileteada', 'troceado', 'troceada', 'cortado', 'cortada', 'lonchas',
      'rebanadas', 'entera', 'entero', 'fresco', 'fresca', 'envasado', 'envasada', 'natural', 'bote', 'botes',
      'pack', 'packs', 'unidad', 'unidades', 'formato', 'ahorro', 'aprox', 'granel', 'a',
      'bio', 'eco', 'ecologico', 'ecologica', 'organico', 'organica'
    ];

    for (const word of wordsToRemove) {
      const reg = new RegExp(`\\b${word}\\b`, 'gi');
      s = s.replace(reg, '');
    }

    return s.replace(/\s+/g, ' ').trim();
  }

  getStringSimilarity(str1, str2) {
    const s1 = this.normalizeText(str1).toLowerCase().replace(/\s+/g, '');
    const s2 = this.normalizeText(str2).toLowerCase().replace(/\s+/g, '');
    
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const bigrams1 = new Map();
    for (let i = 0; i < s1.length - 1; i++) {
      const bigram = s1.substring(i, i + 2);
      bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
      const bigram = s2.substring(i, i + 2);
      const count = bigrams1.get(bigram) || 0;
      if (count > 0) {
        intersection++;
        bigrams1.set(bigram, count - 1);
      }
    }

    return (2.0 * intersection) / (s1.length + s2.length - 2);
  }

  checkIsNonFood(categoryName, productName) {
    const nonFoodKeywords = [
      'limpieza', 'hogar', 'perfumeria', 'higiene', 'menaje', 'cosmetica',
      'bebe', 'mascota', 'cuidado personal', 'drogueria', 'lavavajillas',
      'detergente', 'suavizante', 'ambientador', 'insecticida', 'fregona',
      'estropajo', 'papel higienico', 'servilleta', 'champu', 'gel de baño',
      'desodorante', 'dentifrico', 'maquinilla', 'compresas', 'pañales',
      'bazar', 'textil', 'cocina', 'vajilla', 'limpiador', 'lavadora',
      // Cosmetics & Perfumery specific keywords
      'parfum', 'toilette', 'colonia', 'perfume', 'body spray', 'citronela',
      'uñas', 'laca', 'esmalte', 'manicura', 'pedicura', 'maquillaje',
      'crema facial', 'locion', 'balsamo', 'champu', 'acondicionador',
      'cepillo dental', 'hilo dental', 'dentifrico', 'pasta de dientes',
      'preservativos', 'compresa', 'tampon', 'toallita'
    ].map(kw => this.normalizeText(kw.toLowerCase()));

    const catNormalized = this.normalizeText((categoryName || '').toLowerCase());
    const prodNormalized = this.normalizeText((productName || '').toLowerCase());

    return nonFoodKeywords.some(keyword => catNormalized.includes(keyword) || prodNormalized.includes(keyword));
  }

  detectCookingMethods(name) {
    const methods = new Set();
    const lowerName = name.toLowerCase();

    const mapping = [
      { id: 'sarten', keywords: ['sarten', 'saltear', 'hamburguesa', 'filete', 'pechuga', 'chuleta', 'entrecot', 'lomo', 'revuelto'] },
      { id: 'air_frayer', keywords: ['patatas fritas', 'congeladas', 'empanados', 'empanado', 'nuggets', 'croquetas', 'san jacobo', 'librito', 'calamares', 'rebozado'] },
      { id: 'horno', keywords: ['pizza', 'pizzas', 'asado', 'lasaña', 'lasagna', 'canelones', 'gratinar', 'hojaldre', 'repostería', 'bizcocho'] },
      { id: 'microondas', keywords: ['plato preparado', 'listo para comer', 'microondas', 'vapor', 'calentar y listo', 'tupper', 'vaso de arroz'] }
    ];

    for (const item of mapping) {
      if (item.keywords.some(kw => lowerName.includes(kw))) {
        methods.add(item.id);
      }
    }

    return Array.from(methods);
  }

  classifyDiets(offProduct, originalName) {
    const diets = new Set();
    const nutrients = offProduct.nutriments || {};

    const proteins = parseFloat(nutrients.proteins_100g || nutrients.proteins_value);
    if (!isNaN(proteins) && proteins > 15) {
      diets.add('high_protein');
    }

    const calories = parseFloat(nutrients['energy-kcal_100g'] || nutrients['energy-kcal_value']);
    if (!isNaN(calories) && calories < 40) {
      diets.add('low_kcal');
    }

    const nutriGrade = (offProduct.nutriscore_grade || offProduct.nutrition_grades || '').toLowerCase();
    if (nutriGrade === 'a' || nutriGrade === 'b') {
      diets.add('healthy');
    }

    const carbs = parseFloat(nutrients.carbohydrates_100g || nutrients.carbohydrates_value);
    if (!isNaN(carbs) && carbs < 5) {
      diets.add('keto');
    }

    const labels = offProduct.labels_tags || [];
    const analysis = offProduct.ingredients_analysis_tags || [];
    const isVegan = labels.some(tag => (tag.includes('vegan') || tag.includes('vegetariano-vegano')) && !tag.includes('non-')) ||
                     analysis.some(tag => tag.includes('vegan') && !tag.includes('non-'));
    if (isVegan) {
      diets.add('vegan');
    }

    const sodium = parseFloat(nutrients.sodium_100g || nutrients.sodium_value);
    if (!isNaN(sodium) && sodium < 0.12) {
      diets.add('low_sodium');
    }

    this.detectLocalDietsOnly(originalName).forEach(d => diets.add(d));

    return Array.from(diets);
  }

  detectLocalDietsOnly(name) {
    const diets = [];
    const lowerName = name.toLowerCase();

    const quickEasyKeywords = [
      'listo para comer', 'preparado', 'microondas', 'instantaneo',
      'instantánea', 'precocinado', 'calentar y listo', 'abrir y listo'
    ];
    const batchCookingKeywords = [
      'kilo', 'familiar', 'pack', 'grande', 'ahorro', 'x4', 'x6', 'x8', 'formato ahorro'
    ];

    if (quickEasyKeywords.some(kw => lowerName.includes(kw))) {
      diets.push('quick_easy');
    }
    if (batchCookingKeywords.some(kw => lowerName.includes(kw))) {
      diets.push('batch_cooking');
    }

    return diets;
  }

  classifyAllergens(offProduct) {
    const allergens = new Set();
    const tags = [
      ...(offProduct.allergens_hierarchy || []),
      ...(offProduct.allergens_tags || [])
    ].map(tag => tag.toLowerCase());

    const mapping = [
      { id: 'gluten', keywords: ['en:gluten', 'en:wheat', 'en:oats', 'en:barley', 'trigo', 'avena', 'cebada'] },
      { id: 'lactose', keywords: ['en:milk', 'en:lactose', 'en:dairy', 'leche', 'lácteos'] },
      { id: 'nuts', keywords: ['en:nuts', 'en:peanuts', 'en:almonds', 'en:hazelnuts', 'en:walnuts', 'en:cashews', 'frutos de cáscara', 'cacahuete'] },
      { id: 'seafood', keywords: ['en:crustaceans', 'en:molluscs', 'en:seafood', 'crustáceos', 'moluscos'] },
      { id: 'egg', keywords: ['en:eggs', 'huevos', 'huevo'] },
      { id: 'fish', keywords: ['en:fish', 'pescado'] },
      { id: 'soy', keywords: ['en:soybeans', 'en:soy', 'soja'] }
    ];

    for (const item of mapping) {
      if (tags.some(tag => item.keywords.some(kw => tag.includes(kw)))) {
        allergens.add(item.id);
      }
    }

    if (allergens.size === 0) {
      allergens.add('none');
    }

    return Array.from(allergens);
  }

  async fetchFromOpenFoodFacts(productName) {
    const cleanedName = this.cleanName(productName);
    let offProduct = null;

    try {
      let queryWords = cleanedName.split(' ');
      let products = [];

      while (queryWords.length >= 1) {
        const searchQuery = queryWords.join(' ');
        
        if (queryWords.length === 1 && (searchQuery.length <= 3 || ['con', 'del', 'los', 'las'].includes(searchQuery))) {
          break;
        }

        const url = `${this.openFoodFactsSearchUrl}?search_terms=${encodeURIComponent(searchQuery)}&search_simple=1&action=process&json=1&page_size=5`;

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'AllMealtyScraperPipeline/1.0 (contact@giralabs.com)',
          },
        });

        if (response.ok) {
          const searchResult = await response.json();
          if (searchResult.products && searchResult.products.length > 0) {
            products = searchResult.products;
            break;
          }
        } else {
          await response.text();
        }
        queryWords.pop();
      }

      if (products.length > 0) {
        let bestMatch = null;
        let bestScore = 0;
        const targetCompare = this.cleanForComparison(productName);

        for (const product of products) {
          const offName = product.product_name_es || product.product_name || '';
          if (!offName) continue;

          const candidateCompare = this.cleanForComparison(offName);
          const score = this.getStringSimilarity(targetCompare, candidateCompare);

          if (score > bestScore) {
            bestScore = score;
            bestMatch = product;
          }
        }

        if (bestScore > 0.8) {
          offProduct = bestMatch;
        }
      }
    } catch (error) {
      console.error(`Error querying Open Food Facts for "${productName}":`, error.message);
    }

    return offProduct;
  }
}

const matchingService = new MatchingService();

async function main() {
  console.log("Starting product database cleanup...");
  
  const allProducts = await prisma.product.findMany({});
  console.log(`Found ${allProducts.length} total products in database.`);

  let updatedCount = 0;
  let nameDeduplicatedCount = 0;
  let nonFoodMarkedCount = 0;
  let enrichedCount = 0;

  for (const product of allProducts) {
    let nameChanged = false;
    let nameToUse = product.name;

    // 1. Deduplicate name if it contains newline
    if (product.name.includes('\n')) {
      const parts = product.name.split('\n').map(l => l.trim()).filter(Boolean);
      if (parts.length > 0 && parts[0] !== product.name) {
        nameToUse = parts[0];
        nameChanged = true;
        nameDeduplicatedCount++;
        console.log(`Deduplicating name for ID ${product.id}:`);
        console.log(`  OLD: ${JSON.stringify(product.name)}`);
        console.log(`  NEW: ${JSON.stringify(nameToUse)}`);
      }
    }

    let updatedData = {};
    if (nameChanged) {
      updatedData.name = nameToUse;
    }

    // 2. Check if the product is actually a non-food item
    const isNonFood = matchingService.checkIsNonFood("", nameToUse);
    let markAsNonFood = false;

    if (isNonFood && product.isFood) {
      markAsNonFood = true;
      nonFoodMarkedCount++;
      updatedData.isFood = false;
      updatedData.nutritionalInfo = null;
      updatedData.dietTypes = [];
      updatedData.allergens = [];
      updatedData.cookingMethods = [];
      console.log(`Correcting non-food item: "${nameToUse}" (ID: ${product.id}) => isFood: false`);
    }

    // 3. Check if we need to enrich nutritional info
    // We only enrich if it is currently food, is NOT marked as non-food, AND (nutritionalInfo is null OR the name changed)
    const needsEnrichment = product.isFood && !isNonFood && (!product.nutritionalInfo || nameChanged);

    if (needsEnrichment) {
      console.log(`Enriching food product "${nameToUse}" (ID: ${product.id})...`);
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));

      const offProduct = await matchingService.fetchFromOpenFoodFacts(nameToUse);
      if (offProduct) {
        const dietTypes = matchingService.classifyDiets(offProduct, nameToUse);
        const allergens = matchingService.classifyAllergens(offProduct);
        const cookingMethods = matchingService.detectCookingMethods(nameToUse);

        let nutritionalInfo = null;
        if (offProduct.nutriments) {
          const nutriments = offProduct.nutriments;
          nutritionalInfo = {};

          const mapKey = (dbKey, offKey) => {
            const val = parseFloat(nutriments[offKey]);
            if (!isNaN(val)) {
              nutritionalInfo[dbKey] = parseFloat(val.toFixed(2));
            }
          };

          mapKey('calories', 'energy-kcal_100g');
          mapKey('proteins', 'proteins_100g');
          mapKey('fats', 'fat_100g');
          mapKey('carbohydrates', 'carbohydrates_100g');
          mapKey('salt', 'salt_100g');
          mapKey('fiber', 'fiber_100g');

          if (Object.keys(nutritionalInfo).length === 0) {
            nutritionalInfo = null;
          }
        }

        updatedData.dietTypes = dietTypes;
        updatedData.allergens = allergens;
        updatedData.cookingMethods = cookingMethods;
        updatedData.nutritionalInfo = nutritionalInfo;
        enrichedCount++;
        
        console.log(`  Success! Found match: ${offProduct.product_name_es || offProduct.product_name}`);
        console.log(`  Nutritional Info:`, nutritionalInfo);
      } else {
        console.log(`  No match found in Open Food Facts for "${nameToUse}"`);
        const dietTypes = matchingService.detectLocalDietsOnly(nameToUse);
        updatedData.dietTypes = dietTypes;
        updatedData.allergens = ['none'];
        updatedData.cookingMethods = matchingService.detectCookingMethods(nameToUse);
        updatedData.nutritionalInfo = null;
      }
    }

    if (Object.keys(updatedData).length > 0) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          ...updatedData,
          lastUpdated: new Date()
        }
      });
      updatedCount++;
    }
  }

  console.log("-----------------------------------");
  console.log("Cleanup completed successfully!");
  console.log(`Total products processed: ${allProducts.length}`);
  console.log(`Names deduplicated:       ${nameDeduplicatedCount}`);
  console.log(`Non-food items corrected:  ${nonFoodMarkedCount}`);
  console.log(`Products enriched (OFF):  ${enrichedCount}`);
  console.log(`Total database updates:   ${updatedCount}`);
}

main()
  .catch(err => {
    console.error("Fatal error during cleanup:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
