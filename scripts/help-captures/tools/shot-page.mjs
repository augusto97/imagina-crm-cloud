#!/usr/bin/env node
/**
 * Foto de una pantalla de la app (desarrollo): por ejemplo un artículo del
 * centro de aprendizaje en claro, oscuro o celular.
 *
 *   node scripts/help-captures/tools/shot-page.mjs /aprende/vistas/vistas-kanban nombre
 *   DARK=1 W=390 H=844 FULL=1 node ...
 * Deja /tmp/learn-shots/<nombre>.png
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright-core');
const BASE = process.env.BASE ?? 'http://localhost:5174';
const [route, name] = [process.argv[2], process.argv[3] ?? 'page'];
const W = Number(process.env.W ?? 1400);
const H = Number(process.env.H ?? 900);
const dark = process.env.DARK === '1';
const OUT = '/tmp/learn-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', hasTouch: W < 700, isMobile: W < 700 });
await ctx.addInitScript((d) => localStorage.setItem('imcrm:theme', d ? 'dark' : 'light'), dark);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}/login`);
await page.fill('#email', process.env.EMAIL ?? 'e2e@test.local');
await page.fill('#password', process.env.PASSWORD ?? 'Superadmin-pass-1');
await page.click('button[type=submit]');
await page.waitForFunction(() => location.hash.startsWith('#/'), null, { timeout: 20000 });
await sleep(700);
await page.goto(`${BASE}/#${route}`);
await sleep(Number(process.env.WAIT ?? 2500));
for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape');
    await sleep(80);
}
if (process.env.SCROLL) await page.evaluate((y) => document.querySelector('main')?.scrollTo({ top: Number(y) }), process.env.SCROLL);
await sleep(400);
await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: process.env.FULL === '1' });
console.log(`${OUT}/${name}.png`);
if (errs.length) console.log('errores:', errs);
await browser.close();
