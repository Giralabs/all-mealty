-- Create Custom Types
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supermarket') THEN
        CREATE TYPE supermarket AS ENUM ('mercadona', 'aldi', 'dia', 'carrefour', 'alcampo');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'queue_status') THEN
        CREATE TYPE queue_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
END $$;

-- Create Products Table
CREATE TABLE IF NOT EXISTS mealty_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    image_url TEXT NOT NULL,
    supermarket supermarket NOT NULL,
    is_food BOOLEAN NOT NULL,
    diet_types TEXT[] NOT NULL DEFAULT '{}',
    allergens TEXT[] NOT NULL DEFAULT '{}',
    cooking_methods TEXT[] NOT NULL DEFAULT '{}',
    nutritional_info JSONB,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Scraping Queue Table (For Vercel Cron state management)
CREATE TABLE IF NOT EXISTS mealty_scraping_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supermarket supermarket NOT NULL,
    category_url TEXT NOT NULL,
    category_name TEXT NOT NULL,
    status queue_status NOT NULL DEFAULT 'pending',
    last_attempt TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Indexes
CREATE INDEX IF NOT EXISTS mealty_products_supermarket_idx ON mealty_products (supermarket);
CREATE INDEX IF NOT EXISTS mealty_queue_status_supermarket_idx ON mealty_scraping_queue (status, supermarket);

-- Migrations/Updates
ALTER TABLE mealty_products ADD COLUMN IF NOT EXISTS nutritional_info JSONB;

