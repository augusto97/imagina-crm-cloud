#!/usr/bin/env node
/**
 * Fotos de una ilustración animada en varios instantes de su ciclo, para
 * revisarla (desarrollo). Necesita el entorno de desarrollo arriba.
 *
 *   node scripts/help-captures/tools/shot-illustration.mjs <clave> [segundos,separados,por,coma]
 *   DARK=1 W=420 node ... (oscuro / ancho de celular)
 * Deja PNG en /tmp/learn-shots/<clave>-[dark-]<t>.png
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright-core');
const BASE = process.env.BASE ?? 'http://localhost:5174';
const key = process.argv[2];
const times = (process.argv[3] ?? '0.6,2,3.5,5.5').split(',').map(Number);
const dark = process.env.DARK === '1';
const width = Number(process.env.W ?? 900);
const OUT = '/tmp/learn-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
await ctx.addInitScript((d) => localStorage.setItem('imcrm:theme', d ? 'dark' : 'light'), dark);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}/login`);
await page.fill('#email', process.env.EMAIL ?? 'e2e@test.local');
await page.fill('#password', process.env.PASSWORD ?? 'Superadmin-pass-1');
await page.click('button[type=submit]');
await page.waitForFunction(() => location.hash.startsWith('#/'), null, { timeout: 20000 });
await sleep(600);
await page.goto(`${BASE}/?only=${key}#/aprende/lab`);
await page.waitForSelector(`[data-testid="lab-${key}"] .ill-stage`, { timeout: 20000 });
for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await sleep(80);
}
const el = page.locator(`[data-testid="lab-${key}"] .ill-stage`);
for (const t of times) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), t * 1000);
    const file = `${OUT}/${key}-${dark ? 'dark-' : ''}${t}.png`;
    await el.screenshot({ path: file });
    console.log(file);
}
if (errs.length) console.log('errores:', errs);
await browser.close();
