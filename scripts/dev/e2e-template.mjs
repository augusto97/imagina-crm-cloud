/**
 * Plantilla de prueba E2E en navegador real (así se verificó cada release).
 *
 * Uso (fuera del repo, para no ensuciar el lockfile):
 *   mkdir -p /tmp/e2e && cd /tmp/e2e && npm i playwright-core
 *   cp <repo>/scripts/dev/e2e-template.mjs ./e2e-x.mjs && node e2e-x.mjs
 *
 * Requiere el entorno arriba (scripts/dev/up.sh). Chromium ya viene instalado
 * en /opt/pw-browsers (NO correr "playwright install").
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:5174';
const results = [];
const check = (name, ok, extra = '') => {
    results.push(ok);
    console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
// Consultas directas a la base de desarrollo (para preparar datos o verificar).
const sql = (q) =>
    execSync(`docker exec -i imagina-base-postgres-1 psql -U imagina -d imagina_base -Atc "${q}"`).toString().trim();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));

// Llamar al API con la sesión del navegador (cookie) — X-Tenant-Id es obligatorio.
const apiFetch = (method, path, body) =>
    page.evaluate(
        async ({ method, path, body }) => {
            const r = await fetch(`/api/v1${path}`, {
                method,
                credentials: 'include',
                headers: { 'X-Tenant-Id': '1', 'content-type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            });
            return { status: r.status, body: await r.text() };
        },
        { method, path, body },
    );

try {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', 'e2e@test.local');
    await page.fill('#password', 'Superadmin-pass-1');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.hash.startsWith('#/lists'), null, { timeout: 15000 });
    check('login', true);

    // ... la prueba: navegar, clickear (data-testid), verificar con apiFetch/sql ...
    const lists = await apiFetch('GET', '/lists');
    check('listado de listas', lists.status === 200);
    check('tenants en la base', Number(sql('select count(*) from tenants')) > 0);

    await page.screenshot({ path: '/tmp/e2e/captura.png', fullPage: true });
    // Celular: newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
} catch (e) {
    check('sin excepciones', false, e.message);
} finally {
    check('sin errores de JS', jsErrors.length === 0, jsErrors.join(' | '));
    await browser.close();
    const ok = results.filter(Boolean).length;
    console.log(`\n${ok}/${results.length}`);
    process.exit(ok === results.length ? 0 : 1);
}
