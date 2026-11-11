/**
 * v0.1.409 — `embed.js` minificado al compilar (lo pide CADA página de los
 * sitios donde está pegado). La fuente sigue siendo `FORM_EMBED_JS`
 * (src/forms/form-page.ts): esto escribe `dist/forms/embed.min.js` y el
 * servidor lo usa si existe (si no, sirve la fuente tal cual).
 *
 * Corre después de `tsc` (lee el compilado). Falla en voz alta: un build con
 * el script roto no tiene que llegar a un release.
 */
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');

/** La fuente → el minificado (lo usa también el test). */
function minifyEmbed(source) {
    const out = transformSync(source, { loader: 'js', minify: true, target: 'es2017', legalComments: 'none', charset: 'utf8' }).code.trim();
    if (!out.includes('__imbFormsEmbed') || out.length < 2000) {
        throw new Error('embed.min.js: el resultado no parece el script de inserción');
    }
    return out;
}

module.exports = { minifyEmbed };

if (require.main === module) {
    const dist = path.join(__dirname, '..', 'dist', 'forms');
    const { FORM_EMBED_JS } = require(path.join(dist, 'form-page.js'));
    const out = minifyEmbed(FORM_EMBED_JS);
    fs.writeFileSync(path.join(dist, 'embed.min.js'), `${out}\n`);
    console.log(`embed.min.js: ${FORM_EMBED_JS.length} → ${out.length} bytes`);
}
