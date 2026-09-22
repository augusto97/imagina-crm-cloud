import type { OAuthStateStore } from '../../src/connectors/connectors.service';

/**
 * Redis en memoria, acotado a lo que usa el flujo OAuth de los conectores.
 *
 * Existe para que los specs que sólo ejercitan conectores no tengan que
 * levantar un contenedor de Redis, y para poder probar el LOCK del refresh
 * (dos renovaciones en paralelo) de forma determinista.
 */
export function memoryOAuthStore(): OAuthStateStore {
    const data = new Map<string, string>();
    return {
        async set(key: string, value: string, _mode: 'EX', _seconds: number, nx?: 'NX') {
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
    } as OAuthStateStore;
}
