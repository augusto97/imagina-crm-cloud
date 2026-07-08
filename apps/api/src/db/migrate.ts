import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env';
import { createDb, createPool } from './client';

export const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations');

async function main(): Promise<void> {
    const env = loadEnv();
    const pool = createPool(env.DATABASE_URL);
    try {
        await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
        console.log('Migraciones aplicadas ✔');
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
