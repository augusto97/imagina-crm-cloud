import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * v0.1.458 — El Airtable falso de `scripts/dev/fake-airtable.mjs` (el MISMO
 * que usa el entorno de desarrollo), con tipos para los tests.
 */
export interface FakeAirtable {
    url: string;
    state: { rateLimit: number; retryAfter: number | null; requests: number; rateLimited: number; attachmentsServed: number; recordRequests: number };
    control(c: { rate_limit?: number; retry_after?: number | null }): void;
    stop(): Promise<void>;
}

interface FakeAirtableModule {
    FULL_TOKEN: string;
    DATA_ONLY_TOKEN: string;
    AGENCY_BASE: string;
    STOCK_BASE: string;
    startFakeAirtable(opts: { port?: number; memberEmail?: string; rateLimit?: number; retryAfter?: number | null }): Promise<FakeAirtable>;
}

export async function loadFakeAirtable(): Promise<FakeAirtableModule> {
    const file = resolve(__dirname, '../../../../scripts/dev/fake-airtable.mjs');
    return (await import(pathToFileURL(file).href)) as FakeAirtableModule;
}
