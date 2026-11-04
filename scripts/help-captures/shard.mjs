/**
 * v0.1.364 — Reparto de las capturas entre varias máquinas a la vez.
 *
 * Se reparte por ARCHIVO de escenarios, nunca por demo suelta: las demos de
 * un mismo archivo pueden apoyarse en lo que dejó la anterior (un formulario,
 * una plantilla) y tienen que correr juntas y en su orden.
 *
 * El reparto busca que todas las máquinas terminen a la vez: cada archivo pesa
 * lo que tardaron sus demos la última vez (`timings.json`, en segundos) y se
 * asigna, del más pesado al más liviano, a la máquina con menos carga. Es
 * determinístico: todas las máquinas calculan el mismo reparto sin hablarse.
 *
 * Para refrescar los tiempos con el log de un release:
 *   node scripts/help-captures/timings.mjs <log-del-release>
 */

/** Lo que pesa una demo que todavía no tiene tiempo medido. */
export const DEFAULT_SECONDS = 8;

/** `"2/5"` → `{ index: 2, total: 5 }`; vacío o inválido → `null` (todas). */
export function parseShard(value) {
    const m = /^(\d+)\/(\d+)$/.exec(String(value ?? '').trim());
    if (!m) return null;
    const index = Number(m[1]);
    const total = Number(m[2]);
    if (total < 1 || index < 1 || index > total) return null;
    return { index, total };
}

/**
 * @param {Array<{ file: string, keys: string[] }>} files archivos con las claves de sus demos
 * @param {{ index: number, total: number }} shard
 * @param {Record<string, number>} timings segundos por clave de demo
 * @returns {Set<string>} los archivos que le tocan a esta máquina
 */
export function pickShard(files, shard, timings = {}) {
    const weight = (f) => f.keys.reduce((s, k) => s + (Number(timings[k]) > 0 ? Number(timings[k]) : DEFAULT_SECONDS), 0);
    const ordered = [...files].map((f) => ({ file: f.file, w: weight(f) })).sort((a, b) => b.w - a.w || a.file.localeCompare(b.file));
    const bins = Array.from({ length: shard.total }, () => ({ load: 0, files: new Set() }));
    for (const f of ordered) {
        // La menos cargada; ante un empate, la de menor número (determinístico).
        let target = bins[0];
        for (const b of bins) if (b.load < target.load) target = b;
        target.load += f.w;
        target.files.add(f.file);
    }
    return bins[shard.index - 1].files;
}
