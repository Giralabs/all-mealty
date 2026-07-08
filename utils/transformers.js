/**
 * Transforms product text/ingredients/name/category combined with Open Food Facts data
 * to categorize arrays:
 * - nutritional_goals
 * - allergens_free
 * - cooking_methods
 *
 * @param {Object} rawProduct
 * @param {string} rawProduct.name
 * @param {string} rawProduct.category
 * @param {string} [rawProduct.ingredients]
 * @param {string} [rawProduct.description]
 * @param {Object} [offData] - Open Food Facts data
 * @param {Object} [offData.nutriments]
 * @param {string[]} [offData.allergens_tags]
 * @param {string} [offData.allergens_from_ingredients]
 * @param {string[]} [offData.labels_tags]
 * @returns {Object} { nutritional_goals: string[], allergens_free: string[], cooking_methods: string[] }
 */
function transformProduct(rawProduct, offData = {}) {
  const name = (rawProduct.name || '').toLowerCase();
  const category = (rawProduct.category || '').toLowerCase();
  const ingredients = (rawProduct.ingredients || '').toLowerCase();
  const description = (rawProduct.description || '').toLowerCase();

  // Combine everything for full-text checks
  const fullText = `${name} ${category} ${ingredients} ${description}`;

  const nutritional_goals = [];
  const allergens_free = [];
  const cooking_methods = [];

  // --- 1. Cooking Methods (Fallback logic) ---
  if (/microondas|micro|calentar\s+en\s+microondas/i.test(fullText)) {
    cooking_methods.push('microondas');
  }
  if (/horno|hornear|al\s+horno/i.test(fullText)) {
    cooking_methods.push('horno');
  }
  if (/sart[eé]n|fre[ií]r|plancha/i.test(fullText)) {
    cooking_methods.push('sarten');
  }
  if (/hervir|cocer|hervido|cocido/i.test(fullText)) {
    cooking_methods.push('hervido');
  }
  if (cooking_methods.length === 0) {
    cooking_methods.push('sin_cocinar');
  }

  // --- 2. Allergens Free (Standard extraction) ---
  const offAllergensTags = offData.allergens_tags || [];
  const offAllergensStr = (offAllergensTags.join(' ') + ' ' + (offData.allergens_from_ingredients || '')).toLowerCase();

  // sin_gluten
  const hasGluten = /gluten|trigo|triticale|centeno|cebada|wheat|barley|rye/i.test(fullText) || 
                     offAllergensStr.includes('gluten') || 
                     offAllergensStr.includes('wheat') || 
                     offAllergensTags.some(tag => tag.includes('gluten') || tag.includes('wheat'));
  if (/sin\s+gluten|gluten\s+free|sin\s+tacc/i.test(fullText) || (offData.allergens_tags && !hasGluten)) {
    allergens_free.push('sin_gluten');
  }

  // sin_lactosa
  const hasLactose = /lactosa|leche|lactose|milk|queso|nata|mantequilla/i.test(fullText) || 
                      offAllergensStr.includes('milk') || 
                      offAllergensStr.includes('lactose') || 
                      offAllergensStr.includes('leche') ||
                      offAllergensTags.some(tag => tag.includes('milk') || tag.includes('lactose') || tag.includes('dairy'));
  if (/sin\s+lactosa|lactose\s+free|0%\s+lactosa/i.test(fullText) || (offData.allergens_tags && !hasLactose)) {
    allergens_free.push('sin_lactosa');
  }

  // sin_huevo
  const hasEgg = /huevo|egg/i.test(fullText) || 
                 offAllergensStr.includes('egg') || 
                 offAllergensStr.includes('huevo') ||
                 offAllergensTags.some(tag => tag.includes('egg'));
  if (/sin\s+huevo/i.test(fullText) || (offData.allergens_tags && !hasEgg)) {
    allergens_free.push('sin_huevo');
  }

  // sin_soja
  const hasSoy = /soja|soy/i.test(fullText) || 
                 offAllergensStr.includes('soy') || 
                 offAllergensStr.includes('soja') ||
                 offAllergensTags.some(tag => tag.includes('soy'));
  if (/sin\s+soja/i.test(fullText) || (offData.allergens_tags && !hasSoy)) {
    allergens_free.push('sin_soja');
  }

  // --- 3. Nutritional Goals (Standard extraction) ---
  const nutriments = offData.nutriments || {};

  // bajo_en_kcal: Menos de 120 kcal / 100g
  if (nutriments['energy-kcal_100g'] !== undefined && nutriments['energy-kcal_100g'] !== null) {
    const energyKcal = parseFloat(nutriments['energy-kcal_100g']);
    if (!isNaN(energyKcal) && energyKcal < 120) {
      nutritional_goals.push('bajo_en_kcal');
    }
  }

  // alto_en_proteinas: Más de 12g de proteína / 100g
  if (nutriments.proteins_100g !== undefined && nutriments.proteins_100g !== null) {
    const proteinVal = parseFloat(nutriments.proteins_100g);
    if (!isNaN(proteinVal) && proteinVal > 12) {
      nutritional_goals.push('alto_en_proteinas');
    }
  }

  // bajo_en_grasas: Menos de 3g de grasa total / 100g
  if (nutriments.fat_100g !== undefined && nutriments.fat_100g !== null) {
    const fatVal = parseFloat(nutriments.fat_100g);
    if (!isNaN(fatVal) && fatVal < 3) {
      nutritional_goals.push('bajo_en_grasas');
    }
  }

  // alto_en_fibra: Más de 6g de fibra / 100g
  if (nutriments.fiber_100g !== undefined && nutriments.fiber_100g !== null) {
    const fiberVal = parseFloat(nutriments.fiber_100g);
    if (!isNaN(fiberVal) && fiberVal > 6) {
      nutritional_goals.push('alto_en_fibra');
    }
  }

  // bajo_en_carbohidratos: Menos de 10g de carbohidratos / 100g
  if (nutriments.carbohydrates_100g !== undefined && nutriments.carbohydrates_100g !== null) {
    const carbsVal = parseFloat(nutriments.carbohydrates_100g);
    if (!isNaN(carbsVal) && carbsVal < 10) {
      nutritional_goals.push('bajo_en_carbohidratos');
    }
  }

  // Vegano & Vegetariano (Vía labels_tags de OFF o regex de supermercado)
  const labelsTagsStr = (offData.labels_tags || []).join(' ').toLowerCase();
  const isVegan = labelsTagsStr.includes('vegan') || 
                  labelsTagsStr.includes('vegano') || 
                  labelsTagsStr.includes('100% vegetal') || 
                  (/vegano|vegan|100%\s+vegetal/i.test(fullText) && !/no\s+vegano/i.test(fullText));
  if (isVegan) {
    nutritional_goals.push('vegano', 'vegetariano');
  }

  const isVegetarian = labelsTagsStr.includes('vegetarian') || 
                       labelsTagsStr.includes('vegetariano') || 
                       isVegan || 
                       /vegetariano/i.test(fullText);
  if (isVegetarian && !nutritional_goals.includes('vegetariano')) {
    nutritional_goals.push('vegetariano');
  }

  // --- 4. Heuristic Fallback (Plan C) ---
  // If the product was not successfully enriched by Open Food Facts, apply rule-based heuristics
  const wasEnriched = offData && offData.source && offData.source !== 'none';
  
  if (!wasEnriched) {
    // Fruta, verdura, hortaliza (safe to assume vegan and free of gluten/lactose/egg)
    if (
      category.includes('fruta') || category.includes('verdura') || category.includes('hortaliza') ||
      name.includes('fruta') || name.includes('verdura') || name.includes('hortaliza')
    ) {
      nutritional_goals.push('vegano', 'vegetariano');
      allergens_free.push('sin_gluten', 'sin_lactosa', 'sin_huevo', 'sin_soja');
    }

    // High protein sources (meat/fish/eggs)
    if (
      name.includes('pollo') || name.includes('pavo') || name.includes('atún') ||
      name.includes('salmón') || name.includes('ternera') || name.includes('huevos') ||
      name.includes('huevo')
    ) {
      nutritional_goals.push('alto_en_proteinas');
      
      // Clean meats/eggs are safe allergen-free (lactose-free). Egg is also soy-free/gluten-free.
      // Canned tuna and meat can be cross-contaminated or prepared, so let's stick to safe subsets:
      allergens_free.push('sin_lactosa');
      if (name.includes('huevos') || name.includes('huevo')) {
        allergens_free.push('sin_gluten', 'sin_soja');
      }
    }

    // Water and infusions
    if (
      category.includes('agua') || category.includes('infusiones') ||
      name.includes('agua') || name.includes('infusión') || name.includes('infusion')
    ) {
      nutritional_goals.push('bajo_en_kcal', 'vegano', 'vegetariano');
      allergens_free.push('sin_gluten', 'sin_lactosa', 'sin_huevo', 'sin_soja');
    }
  }

  return {
    nutritional_goals: [...new Set(nutritional_goals)],
    allergens_free: [...new Set(allergens_free)],
    cooking_methods: [...new Set(cooking_methods)]
  };
}

module.exports = {
  transformProduct
};
