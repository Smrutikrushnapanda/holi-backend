import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env before Pool is created (ConfigModule runs after module init)
dotenv.config({ path: path.join(process.cwd(), '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

@Global()
@Module({
  providers: [
    {
      provide: 'DB_POOL',
      useValue: pool,
    },
  ],
  exports: ['DB_POOL'],
})
export class DatabaseModule {}
