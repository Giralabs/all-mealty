import { pgTable, uuid, text, numeric, boolean, timestamp, pgEnum, index, jsonb } from 'drizzle-orm/pg-core';

export const supermarketEnum = pgEnum('supermarket', ['mercadona', 'aldi', 'dia', 'carrefour', 'alcampo']);
export const queueStatusEnum = pgEnum('queue_status', ['pending', 'processing', 'completed', 'failed']);

export const products = pgTable('mealty_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  imageUrl: text('image_url').notNull(),
  supermarket: supermarketEnum('supermarket').notNull(),
  isFood: boolean('is_food').notNull(),
  dietTypes: text('diet_types').array().notNull(), // postgres array type
  allergens: text('allergens').array().notNull(), // postgres array type
  cookingMethods: text('cooking_methods').array().notNull(), // postgres array type
  nutritionalInfo: jsonb('nutritional_info'),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supermarketIdx: index('mealty_products_supermarket_idx').on(table.supermarket),
}));

export const scrapingQueue = pgTable('mealty_scraping_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  supermarket: supermarketEnum('supermarket').notNull(),
  categoryUrl: text('category_url').notNull(),
  categoryName: text('category_name').notNull(),
  status: queueStatusEnum('status').default('pending').notNull(),
  lastAttempt: timestamp('last_attempt', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  statusSupermarketIdx: index('mealty_queue_status_supermarket_idx').on(table.status, table.supermarket),
}));
