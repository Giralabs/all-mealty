import { ScrapedProduct } from './scraper/base.scraper';

export interface EnrichedProduct {
  name: string;
  price: number;
  imageUrl: string;
  supermarket: 'mercadona' | 'aldi' | 'dia' | 'carrefour' | 'alcampo';
  isFood: boolean;
  dietTypes: string[];
  allergens: string[];
  cookingMethods: string[];
  nutritionalInfo?: Record<string, number> | null;
}

export class MatchingService {
  private readonly openFoodFactsSearchUrl = 'https://es.openfoodfacts.org/cgi/search.pl';

  /**
   * Normalizes text by removing accents/diacritics.
   */
  normalizeText(str: string): string {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Cleans a product name by removing common weights, volumes, formats, and punctuation.
   */
  cleanName(name: string): string {
    const firstLine = name.split('\n').map(l => l.trim()).find(l => l.length > 0) || name;
    let cleaned = firstLine.toLowerCase();
    
    // Remove typical weight/measure markers: e.g. "500 g", "1,5 kg", "1L", "250 ml", "12 uds", "pack 6", "x6"
    cleaned = cleaned.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|uds|unidades|paquetes|botellas|latas|lata|botella|pack|gr|ozs?|x\s*\d+)\b/gi, '');
    
    // Remove common branding punctuation and double spaces
    cleaned = cleaned.replace(/[^a-záéíóúüñ0-9\s]/gi, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }

  /**
   * Strips brands and packaging descriptors to perform a clean comparison of the core product.
   */
  cleanForComparison(name: string): string {
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

  /**
   * Calculates similarity between two strings using Sørensen-Dice coefficient (bigram comparison).
   * Returns a value between 0.0 and 1.0.
   */
  getStringSimilarity(str1: string, str2: string): number {
    const s1 = this.normalizeText(str1).toLowerCase().replace(/\s+/g, '');
    const s2 = this.normalizeText(str2).toLowerCase().replace(/\s+/g, '');
    
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const bigrams1 = new Map<string, number>();
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

  /**
   * Determines if a product is a non-food item based on its category names.
   */
  checkIsNonFood(categoryName: string, productName: string): boolean {
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

    const catNormalized = this.normalizeText(categoryName.toLowerCase());
    const prodNormalized = this.normalizeText(productName.toLowerCase());

    return nonFoodKeywords.some(keyword => catNormalized.includes(keyword) || prodNormalized.includes(keyword));
  }

  /**
   * Enriches a scraped product with Open Food Facts data and applies classification rules.
   */
  async enrichProduct(scraped: ScrapedProduct): Promise<EnrichedProduct> {
    const isNonFood = this.checkIsNonFood(scraped.categoryName, scraped.name);

    if (isNonFood) {
      return {
        name: scraped.name,
        price: scraped.price,
        imageUrl: scraped.imageUrl,
        supermarket: scraped.supermarket,
        isFood: false,
        dietTypes: [],
        allergens: [],
        cookingMethods: [],
        nutritionalInfo: null,
      };
    }

    // It's food. Initialize details.
    let dietTypes: string[] = [];
    let allergens: string[] = [];
    let cookingMethods: string[] = this.detectCookingMethods(scraped.name);

    // Clean name and fetch from Open Food Facts using progressive word popping
    const cleanedName = this.cleanName(scraped.name);
    let offProduct: any = null;

    // Rate-limiting delay to prevent socket closures from Open Food Facts
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
      let queryWords = cleanedName.split(' ');
      let products: any[] = [];

      // Loop to try searching for products by dropping the last word when 0 results are returned.
      // This prevents specific packaging details/words from breaking the OFF text index match.
      while (queryWords.length >= 1) {
        const searchQuery = queryWords.join(' ');
        
        // Stop word guard: do not query single words that are too short or standard stop words
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
          // Consume the body to prevent undici socket hanging
          await response.text();
        }
        queryWords.pop();
      }

      if (products.length > 0) {
        // Find the best match using fuzzy matching on the core product identity
        let bestMatch: any = null;
        let bestScore = 0;
        const targetCompare = this.cleanForComparison(scraped.name);

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

        // Match threshold: > 80% (0.8)
        if (bestScore > 0.8) {
          offProduct = bestMatch;
        }
      }
    } catch (error) {
      console.error(`Error querying Open Food Facts for "${scraped.name}":`, error);
    }

    let nutritionalInfo: Record<string, number> | null = null;

    if (offProduct) {
      // Map Diets
      dietTypes = this.classifyDiets(offProduct, scraped.name);
      // Map Allergens
      allergens = this.classifyAllergens(offProduct);

      // Extract nutritional details if present
      if (offProduct.nutriments) {
        const nutriments = offProduct.nutriments;
        nutritionalInfo = {};

        const mapKey = (dbKey: string, offKey: string) => {
          const val = parseFloat(nutriments[offKey]);
          if (!isNaN(val)) {
            nutritionalInfo![dbKey] = parseFloat(val.toFixed(2));
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
    } else {
      // Fallback local checks if Open Food Facts has no match
      dietTypes = this.detectLocalDietsOnly(scraped.name);
      allergens = ['none'];
    }

    return {
      name: scraped.name,
      price: scraped.price,
      imageUrl: scraped.imageUrl,
      supermarket: scraped.supermarket,
      isFood: true,
      dietTypes,
      allergens,
      cookingMethods,
      nutritionalInfo,
    };
  }

  /**
   * Classifies diets based on nutrients, labels, and local keywords.
   */
  private classifyDiets(offProduct: any, originalName: string): string[] {
    const diets = new Set<string>();
    const nutrients = offProduct.nutriments || {};

    // 1. high_protein: proteins > 15g per 100g
    const proteins = parseFloat(nutrients.proteins_100g || nutrients.proteins_value);
    if (!isNaN(proteins) && proteins > 15) {
      diets.add('high_protein');
    }

    // 2. low_kcal: calories < 40 kcal per 100g (or 100ml)
    const calories = parseFloat(nutrients['energy-kcal_100g'] || nutrients['energy-kcal_value']);
    if (!isNaN(calories) && calories < 40) {
      diets.add('low_kcal');
    }

    // 3. healthy: Nutri-Score is A or B
    const nutriGrade = (offProduct.nutriscore_grade || offProduct.nutrition_grades || '').toLowerCase();
    if (nutriGrade === 'a' || nutriGrade === 'b') {
      diets.add('healthy');
    }

    // 4. keto: carbohydrates < 5g per 100g
    const carbs = parseFloat(nutrients.carbohydrates_100g || nutrients.carbohydrates_value);
    if (!isNaN(carbs) && carbs < 5) {
      diets.add('keto');
    }

    // 5. vegan: labels_tags or ingredients_analysis_tags indicate vegan
    const labels = offProduct.labels_tags || [];
    const analysis = offProduct.ingredients_analysis_tags || [];
    const isVegan = labels.some((tag: string) => (tag.includes('vegan') || tag.includes('vegetariano-vegano')) && !tag.includes('non-')) ||
                     analysis.some((tag: string) => tag.includes('vegan') && !tag.includes('non-'));
    if (isVegan) {
      diets.add('vegan');
    }

    // 6. low_sodium: sodium < 0.12g per 100g
    const sodium = parseFloat(nutrients.sodium_100g || nutrients.sodium_value);
    if (!isNaN(sodium) && sodium < 0.12) {
      diets.add('low_sodium');
    }

    // 7. quick_easy / batch_cooking keywords
    this.detectLocalDietsOnly(originalName).forEach(d => diets.add(d));

    return Array.from(diets);
  }

  /**
   * Local keyword fallback for quick_easy and batch_cooking diets.
   */
  private detectLocalDietsOnly(name: string): string[] {
    const diets: string[] = [];
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

  /**
   * Maps Open Food Facts allergens tag hierarchy to specific requirement IDs.
   */
  private classifyAllergens(offProduct: any): string[] {
    const allergens = new Set<string>();
    const tags: string[] = [
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

  /**
   * Analyzes name and description keywords to determine suggested cooking methods.
   */
  private detectCookingMethods(name: string): string[] {
    const methods = new Set<string>();
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
}
