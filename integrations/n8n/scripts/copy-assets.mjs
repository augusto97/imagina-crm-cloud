// Copia los íconos y las fichas (.json) de los nodos a dist/ (tsc sólo emite .js).
import { cpSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(svg|png|json)$/.test(name)) cpSync(p, join('dist', p));
    }
}
walk('nodes');
walk('credentials');
