import { z } from 'zod';

/**
 * Modelos del asistente IA (ADR-S60, v0.1.305).
 *
 * La app NO trae una lista fija de modelos: el catálogo sale de la API del
 * proveedor (`GET /v1/models`) con la clave que se va a usar, así un modelo
 * nuevo aparece solo, sin esperar una versión de la app. Lo que se guarda es
 * una ELECCIÓN:
 *
 * - `auto:<familia>` — el más reciente de esa familia, resuelto en cada
 *   pedido contra el catálogo (recomendado: se actualiza solo).
 * - un id concreto — versión fija. Si el proveedor la retira, se usa la más
 *   reciente de la misma familia y la configuración lo avisa.
 *
 * Las familias se reconocen por el patrón de los ids (`claude-<familia>-<versión>`),
 * así una familia nueva también aparece sola.
 */

/** Orden en que se muestran las familias conocidas; una familia nueva va al final. */
export const AI_MODEL_FAMILY_ORDER = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** Familia por defecto del asistente (la más capaz para armar estructuras). */
export const DEFAULT_AI_MODEL_FAMILY = 'opus';
/** Familia de los campos con IA en calidad «rápida»: muchas filas, poco texto. */
export const FAST_AI_MODEL_FAMILY = 'haiku';

export const AI_AUTO_PREFIX = 'auto:';
export const DEFAULT_AI_MODEL_CHOICE = `${AI_AUTO_PREFIX}${DEFAULT_AI_MODEL_FAMILY}`;

/** `auto:<familia>` o un id del proveedor. Se valida la forma; la existencia la decide el catálogo. */
export const aiModelChoiceSchema = z
    .string()
    .trim()
    .max(100)
    .regex(/^(auto:[a-z][a-z0-9]{1,29}|claude-[a-z0-9][a-z0-9.-]{1,90})$/, 'Modelo inválido');
export type AiModelChoice = z.infer<typeof aiModelChoiceSchema>;

export interface ParsedAiModelId {
    family: string;
    /** [mayor, menor] — `claude-x-5` es [5, 0]. */
    version: [number, number];
    /** Sufijo de fecha (`20251001`) si el id lo trae. */
    date: string | null;
}

const MODEL_ID_RE = /^claude-([a-z]+)-(\d{1,3})(?:-(\d{1,2}))?(?:-(\d{8}))?$/;

/** Familia y versión de un id del proveedor. `null` si no sigue el patrón (p. ej. una preview). */
export function parseAiModelId(id: string): ParsedAiModelId | null {
    const m = MODEL_ID_RE.exec(id.trim());
    if (!m) return null;
    return { family: m[1]!, version: [Number(m[2]), m[3] ? Number(m[3]) : 0], date: m[4] ?? null };
}

/** Familia de una elección (`auto:opus` → `opus`; un id → su familia). */
export function aiChoiceFamily(choice: string): string | null {
    if (choice.startsWith(AI_AUTO_PREFIX)) return choice.slice(AI_AUTO_PREFIX.length) || null;
    return parseAiModelId(choice)?.family ?? null;
}

export function isAutoModelChoice(choice: string): boolean {
    return choice.startsWith(AI_AUTO_PREFIX);
}

/**
 * Lo que guardaban las versiones anteriores (un id de una lista fija de tres,
 * cada uno el más nuevo de su familia en ese momento) se lee como «el más
 * reciente de esa familia»: era la intención, y así la instalación se pone
 * al día sola.
 */
export function legacyModelToChoice(value: unknown): AiModelChoice | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const family = parseAiModelId(value)?.family;
    return family ? `${AI_AUTO_PREFIX}${family}` : null;
}

/** Posición de una familia en el orden de muestra (las desconocidas al final, alfabético). */
export function aiFamilyRank(family: string | null): number {
    if (!family) return 999;
    const i = (AI_MODEL_FAMILY_ORDER as readonly string[]).indexOf(family);
    return i === -1 ? 100 : i;
}

/** «opus» → «Opus» (cuando no hay un nombre del proveedor del que derivarlo). */
export function aiFamilyLabelFallback(family: string): string {
    return family.charAt(0).toUpperCase() + family.slice(1);
}

// ── Nivel de esfuerzo (v0.1.306, ADR-S61) ─────────────────────────────────

/**
 * Cuánto piensa el modelo antes de responder (`output_config.effort`). Más
 * esfuerzo = respuestas más cuidadas en pedidos complejos, pero más lentas y
 * con más consumo de la clave. En orden de menos a más.
 */
export const AI_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const aiEffortSchema = z.enum(AI_EFFORT_LEVELS);
export type AiEffort = z.infer<typeof aiEffortSchema>;

/** Lo que cada modelo declara que soporta (de la API; `null` si no lo informa). */
export const aiModelCapsSchema = z.object({
    /** Pensamiento adaptativo (`thinking: {type: 'adaptive'}`). */
    adaptive_thinking: z.boolean(),
    /** Pensamiento con presupuesto fijo (`thinking: {type: 'enabled', budget_tokens}`). */
    budget_thinking: z.boolean(),
    /** Parámetro `effort`. */
    effort: z.boolean(),
    /**
     * v0.1.306 — Niveles de esfuerzo que el modelo acepta, en orden. `null`
     * = no lo informó (se asume el juego habitual: bajo a máximo, sin «muy
     * alto»). Opcional para leer catálogos cacheados por versiones anteriores.
     */
    effort_levels: z.array(aiEffortSchema).nullable().optional(),
    image_input: z.boolean(),
    pdf_input: z.boolean(),
});
export type AiModelCaps = z.infer<typeof aiModelCapsSchema>;

/** El que usaba el asistente antes de que se pudiera elegir. */
export const DEFAULT_AI_EFFORT: AiEffort = 'medium';
/** Lo que se asume cuando el modelo acepta esfuerzo pero no dice qué niveles. */
const ASSUMED_EFFORT_LEVELS: readonly AiEffort[] = ['low', 'medium', 'high', 'max'];

/** Niveles que acepta un modelo (vacío = no usa esfuerzo). */
export function aiEffortLevels(caps: AiModelCaps | null | undefined): AiEffort[] {
    if (!caps?.effort) return [];
    const declared = caps.effort_levels;
    if (!declared || declared.length === 0) return [...ASSUMED_EFFORT_LEVELS];
    return AI_EFFORT_LEVELS.filter((l) => declared.includes(l));
}

/**
 * El nivel que se manda de verdad: el pedido si el modelo lo acepta; si no,
 * el más cercano (ante un empate, el MENOR: no se gasta de más sin que nadie
 * lo pidiera). `null` si el modelo no usa esfuerzo.
 */
export function clampAiEffort(wanted: AiEffort, caps: AiModelCaps | null | undefined): AiEffort | null {
    return nearestAiEffort(wanted, aiEffortLevels(caps));
}

/** El nivel de `levels` más cercano a `wanted` (el menor ante un empate); `null` si no hay ninguno. */
export function nearestAiEffort(wanted: AiEffort, levels: readonly AiEffort[]): AiEffort | null {
    if (levels.length === 0) return null;
    if (levels.includes(wanted)) return wanted;
    const at = AI_EFFORT_LEVELS.indexOf(wanted);
    let best = levels[0]!;
    let bestDist = Infinity;
    for (const l of levels) {
        const d = Math.abs(AI_EFFORT_LEVELS.indexOf(l) - at);
        if (d < bestDist) {
            best = l;
            bestDist = d;
        }
    }
    return best;
}

export const aiModelInfoSchema = z.object({
    id: z.string(),
    display_name: z.string(),
    family: z.string().nullable(),
    created_at: z.string().nullable(),
    max_input_tokens: z.number().int().nullable(),
    /** Es el más reciente de su familia. */
    latest: z.boolean(),
    caps: aiModelCapsSchema.nullable(),
});
export type AiModelInfo = z.infer<typeof aiModelInfoSchema>;

export const aiModelFamilySchema = z.object({
    family: z.string(),
    /** «Opus», derivado del nombre que da el proveedor. */
    label: z.string(),
    latest_id: z.string(),
    latest_name: z.string(),
});
export type AiModelFamily = z.infer<typeof aiModelFamilySchema>;

/** `GET /ai/models` y `GET /platform/ai/models`. */
export const aiModelCatalogSchema = z.object({
    models: z.array(aiModelInfoSchema),
    /** Una entrada por familia, en orden de muestra (para «el más reciente»). */
    families: z.array(aiModelFamilySchema),
    /** No hay ninguna clave con la que consultar. */
    no_key: z.boolean(),
    /** Cuándo se consultó al proveedor por última vez con éxito. */
    fetched_at: z.string().nullable(),
    /** La última consulta falló (se muestra la lista anterior, si había). */
    error: z.string().nullable(),
});
export type AiModelCatalog = z.infer<typeof aiModelCatalogSchema>;

/**
 * Orden «más nuevo primero» dentro de una familia: versión, después fecha del
 * id y por último `created_at` del proveedor (que puede venir en época 0 si no
 * se conoce). Los que no siguen el patrón van al final.
 */
export function compareAiModels(
    a: Pick<AiModelInfo, 'id' | 'created_at'>,
    b: Pick<AiModelInfo, 'id' | 'created_at'>,
): number {
    const pa = parseAiModelId(a.id);
    const pb = parseAiModelId(b.id);
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    if (pa && pb) {
        if (pa.version[0] !== pb.version[0]) return pb.version[0] - pa.version[0];
        if (pa.version[1] !== pb.version[1]) return pb.version[1] - pa.version[1];
        // A igual versión, el alias sin fecha primero (es el que el proveedor recomienda).
        if ((pa.date === null) !== (pb.date === null)) return pa.date === null ? -1 : 1;
        if (pa.date && pb.date && pa.date !== pb.date) return pb.date.localeCompare(pa.date);
    }
    const ta = (a.created_at ? Date.parse(a.created_at) : 0) || 0;
    const tb = (b.created_at ? Date.parse(b.created_at) : 0) || 0;
    if (ta !== tb) return tb - ta;
    return a.id.localeCompare(b.id);
}

/** El nombre del proveedor sin «Claude» ni la versión: «Claude Opus 9.5» → «Opus». */
export function familyLabelFromName(displayName: string, family: string): string {
    const stripped = displayName
        .replace(/^claude\s+/i, '')
        .replace(/\s+\d[\d.]*.*$/, '')
        .trim();
    return stripped && stripped.toLowerCase() === family ? stripped : aiFamilyLabelFallback(family);
}

/**
 * Marca `latest` y arma la lista de familias. Puro: lo usan el servidor (al
 * normalizar lo que devolvió el proveedor) y los tests.
 */
export function buildAiModelCatalog(models: Omit<AiModelInfo, 'latest' | 'family'>[]): { models: AiModelInfo[]; families: AiModelFamily[] } {
    const withFamily = models.map((m) => ({ ...m, family: parseAiModelId(m.id)?.family ?? null, latest: false }));
    const byFamily = new Map<string, AiModelInfo[]>();
    for (const m of withFamily) {
        if (!m.family) continue;
        const arr = byFamily.get(m.family) ?? [];
        arr.push(m);
        byFamily.set(m.family, arr);
    }
    const families: AiModelFamily[] = [];
    for (const [family, arr] of byFamily) {
        arr.sort(compareAiModels);
        const top = arr[0]!;
        top.latest = true;
        families.push({ family, label: familyLabelFromName(top.display_name, family), latest_id: top.id, latest_name: top.display_name });
    }
    families.sort((a, b) => aiFamilyRank(a.family) - aiFamilyRank(b.family) || a.family.localeCompare(b.family));
    const sorted = [...withFamily].sort(
        (a, b) => aiFamilyRank(a.family) - aiFamilyRank(b.family) || (a.family ?? '').localeCompare(b.family ?? '') || compareAiModels(a, b),
    );
    return { models: sorted, families };
}

export interface AiModelResolution {
    /** El id que se manda al proveedor. */
    id: string;
    display_name: string;
    caps: AiModelCaps | null;
    /**
     * Se pidió otra cosa que no está en el catálogo (una versión fija retirada,
     * o una familia que esta clave no ve) y se usó este en su lugar.
     */
    fallback_from: string | null;
}

/**
 * Resuelve una elección contra un catálogo. Puro.
 *
 * - `auto:<familia>` → el más reciente de la familia; si la clave no ve esa
 *   familia, el más reciente de la primera familia conocida que sí vea.
 * - id fijo → ese, si está (también acepta el mismo modelo con o sin sufijo de
 *   fecha); si no, el más reciente de su familia.
 * - Catálogo vacío (no se pudo consultar nunca): un id fijo se usa tal cual
 *   (no se puede verificar); `auto:` devuelve `null` — no hay de dónde sacarlo.
 */
export function resolveAiModelChoice(choice: string, models: readonly AiModelInfo[]): AiModelResolution | null {
    const pick = (m: AiModelInfo, from: string | null): AiModelResolution => ({ id: m.id, display_name: m.display_name, caps: m.caps, fallback_from: from });
    const newestOf = (family: string | null): AiModelInfo | undefined =>
        family ? [...models].filter((m) => m.family === family).sort(compareAiModels)[0] : undefined;
    const newestAny = (): AiModelInfo | undefined => {
        for (const f of AI_MODEL_FAMILY_ORDER) {
            const m = newestOf(f);
            if (m) return m;
        }
        return [...models].filter((m) => m.family).sort(compareAiModels)[0];
    };

    if (isAutoModelChoice(choice)) {
        const own = newestOf(aiChoiceFamily(choice));
        if (own) return pick(own, null);
        const other = newestAny();
        return other ? pick(other, choice) : null;
    }
    const exact = models.find((m) => m.id === choice);
    if (exact) return pick(exact, null);
    const parsed = parseAiModelId(choice);
    if (parsed) {
        const same = models.find((m) => {
            const p = parseAiModelId(m.id);
            return p !== null && p.family === parsed.family && p.version[0] === parsed.version[0] && p.version[1] === parsed.version[1];
        });
        if (same) return pick(same, null);
    }
    if (models.length === 0) return { id: choice, display_name: choice, caps: null, fallback_from: null };
    const fallback = newestOf(parsed?.family ?? null) ?? newestAny();
    return fallback ? pick(fallback, choice) : null;
}

/**
 * Cuando el proveedor no informa capacidades: los modelos desde la versión
 * 4.6 piensan en modo adaptativo y aceptan `effort`; los anteriores, con
 * presupuesto fijo. Es sólo la red de seguridad — la API sí las informa.
 */
export function inferAiModelCaps(id: string): AiModelCaps {
    const p = parseAiModelId(id);
    const modern = !p || p.version[0] > 4 || (p.version[0] === 4 && p.version[1] >= 6);
    return {
        adaptive_thinking: modern,
        budget_thinking: !modern,
        effort: modern,
        effort_levels: null,
        image_input: true,
        pdf_input: true,
    };
}
