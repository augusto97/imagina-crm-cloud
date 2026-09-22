import { loadEnv } from '../../src/config/env';
import {
    IntegrationAppsService,
    type KeyValueStore,
} from '../../src/connectors/integration-apps.service';
import type { OAuthStateStore } from '../../src/connectors/connectors.service';

/**
 * Redis en memoria, acotado a lo que usa el flujo OAuth de los conectores.
 *
 * Existe para que los specs que sólo ejercitan conectores no tengan que
 * levantar un contenedor de Redis, y para poder probar el LOCK del refresh
 * (dos renovaciones en paralelo) de forma determinista.
 */
/** Sirve a la vez de store del flujo OAuth y de `platform:*` (get/set simples). */
export function memoryOAuthStore(): OAuthStateStore & KeyValueStore {
    const data = new Map<string, string>();
    return {
        async get(key: string) {
            return data.get(key) ?? null;
        },
        async set(key: string, value: string, _mode?: 'EX', _seconds?: number, nx?: 'NX') {
            if (nx === 'NX' && data.has(key)) return null;
            data.set(key, value);
            return 'OK';
        },
        async getdel(key: string) {
            const value = data.get(key) ?? null;
            data.delete(key);
            return value;
        },
        async del(key: string) {
            return data.delete(key) ? 1 : 0;
        },
    } as OAuthStateStore & KeyValueStore;
}

/**
 * v0.1.203 — apps OAuth de la plataforma (Plataforma → Integraciones) sobre un
 * Redis en memoria. Sin configurar ningún proveedor, que es el estado de una
 * instalación nueva.
 */
export function memoryIntegrationApps(
    secretsKey = 'clave-de-test-32-bytes-o-lo-que-sea',
): IntegrationAppsService {
    return new IntegrationAppsService(
        memoryOAuthStore(),
        loadEnv({ SECRETS_KEY: secretsKey }),
    );
}
