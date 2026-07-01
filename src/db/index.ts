// =============================================================================
// DATABASE CONNECTION SETUP FOR SUPABASE
// =============================================================================
// This file exports the database clients for both Prisma and Drizzle ORM.
// Choose the one that matches your project configuration.
// Make sure to add the following to your .env file:
//
// DATABASE_URL="postgresql://postgres.[REF_ID]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
// DIRECT_URL="postgresql://postgres.[REF_ID]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
// =============================================================================

// -----------------------------------------------------------------------------
// OPTION A: PRISMA CLIENT CONNECTION
// -----------------------------------------------------------------------------
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;


// -----------------------------------------------------------------------------
// OPTION B: DRIZZLE ORM CONNECTION
// -----------------------------------------------------------------------------
/*
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Supabase Connection Pooling (Session mode) requires disabling prepared statements
const queryClient = postgres(process.env.DATABASE_URL!, { 
  max: 10,
  prepare: false 
});

export const db = drizzle(queryClient, { schema });
*/
