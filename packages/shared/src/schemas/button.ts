import { z } from 'zod';
import { idSchema } from './common';
import { filterTreeSchema } from './filter';

/**
 * Campo «Botón» (A5 del estudio de funcionalidades).
 *
 * Un botón NO guarda valor: vive en la tabla, en la ficha y, si se elige, en
 * el portal, y al presionarlo el servidor ejecuta sus acciones sobre ESE
 * registro. Toda la config vive en `field.config` (este schema), así viaja
 * sola en plantillas, al duplicar una lista y al migrar una empresa:
 *  - las referencias a campos terminan en `field_id` (las re-mapean el
 *    blueprint y la migración por convención);
 *  - la plantilla de documento es `document_template_id` (el mismo nombre que
 *    usa la acción «Generar un PDF» de las automatizaciones);
 *  - la automatización es `automation_id` (se re-mapea aparte).
 *
 * Este archivo sólo tiene SCHEMAS (lo importa `field.ts`); la lógica pura
 * (deshabilitado, qué acciones van en lote o en el portal) está en
 * `field-types/button.ts`.
 */

/**
 * Colores: los mismos nombres que `COLOR_PRESETS` de `field.ts` (un test lo
 * verifica; no se importa de ahí para no armar un ciclo de imports).
 */
export const BUTTON_COLOR_PRESETS = [
    'gray', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
    'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'fuchsia',
    'pink', 'slate',
] as const;
export const buttonColorSchema = z.union([
    z.enum(BUTTON_COLOR_PRESETS),
    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido'),
]);

/** Iconos del botón (la interfaz los dibuja; una clave desconocida no se dibuja). */
export const BUTTON_ICONS = [
    'check', 'check_circle', 'zap', 'play', 'send', 'mail', 'phone', 'message',
    'map_pin', 'navigation', 'external_link', 'link', 'file_text', 'download',
    'printer', 'dollar', 'credit_card', 'calendar', 'clock', 'bell', 'flag',
    'star', 'thumbs_up', 'user', 'archive', 'refresh', 'rocket', 'truck',
    'shopping_cart', 'gift', 'x_circle', 'alert',
] as const;
export type ButtonIcon = (typeof BUTTON_ICONS)[number];

/**
 * Cómo se escribe un campo al presionar:
 *  - `set`: un valor fijo (en un texto se pueden usar variables `{{campo}}`).
 *  - `clear`: lo vacía.
 *  - `today`: fecha → hoy; fecha y hora → ahora (en el reloj de la empresa).
 *  - `me`: persona → quien presiona.
 *  - `toggle`: casilla → la invierte.
 *  - `add`: número, moneda, porcentaje, calificación o duración → le suma
 *    `value` (negativo resta): «+1 llamada».
 */
export const BUTTON_SET_MODES = ['set', 'clear', 'today', 'me', 'toggle', 'add'] as const;
export type ButtonSetMode = (typeof BUTTON_SET_MODES)[number];

export const buttonSetValueSchema = z.object({
    field_id: idSchema,
    mode: z.enum(BUTTON_SET_MODES).default('set'),
    value: z.unknown().optional(),
});
export type ButtonSetValue = z.infer<typeof buttonSetValueSchema>;

/** Las acciones de un botón, en el orden en que se ejecutan. */
export const BUTTON_ACTION_TYPES = ['open_url', 'update_fields', 'run_automation', 'generate_pdf'] as const;
export type ButtonActionType = (typeof BUTTON_ACTION_TYPES)[number];

/** Tope del enlace (antes de resolver las variables). */
export const BUTTON_URL_MAX_LENGTH = 2000;

export const buttonActionSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('open_url'),
        /** Con variables: `https://wa.me/{{telefono}}?text=Hola {{nombre}}`. */
        url: z.string().trim().max(BUTTON_URL_MAX_LENGTH).default(''),
    }),
    z.object({
        type: z.literal('update_fields'),
        values: z.array(buttonSetValueSchema).max(20).default([]),
    }),
    z.object({
        type: z.literal('run_automation'),
        /**
         * Una automatización puntual (con el disparador «Al presionar el
         * botón»). Sin ella, corren TODAS las que escuchan este botón.
         */
        automation_id: idSchema.nullable().optional(),
    }),
    z.object({
        type: z.literal('generate_pdf'),
        document_template_id: idSchema.nullable().optional(),
        /** `download`: lo descarga quien presiona; `save`: lo guarda en un campo Archivo. */
        mode: z.enum(['download', 'save']).default('download'),
        save_field_id: idSchema.nullable().optional(),
        save_mode: z.enum(['append', 'replace']).default('append'),
    }),
]);
export type ButtonAction = z.infer<typeof buttonActionSchema>;

/** Roles del equipo que se eligen (admin puede siempre). */
export const BUTTON_ROLES = ['manager', 'agent', 'viewer'] as const;
export type ButtonRole = (typeof BUTTON_ROLES)[number];

/** Tope de acciones por botón. */
export const BUTTON_MAX_ACTIONS = 5;

export const buttonConfigSchema = z.object({
    /** Lo que dice el botón; vacío = el nombre del campo. */
    label: z.string().trim().max(60).optional(),
    color: buttonColorSchema.optional(),
    icon: z.enum(BUTTON_ICONS).optional(),
    /** Si tiene texto, se pide confirmación con ese texto («¿Marcar como pagado?»). */
    confirm: z.string().trim().max(200).optional(),
    actions: z.array(buttonActionSchema).max(BUTTON_MAX_ACTIONS).default([]),
    /** Deshabilitado si el registro cumple este filtro («ya está pagado»). */
    disabled_if: filterTreeSchema.nullable().optional(),
    /** El motivo que se ve en el tooltip cuando está deshabilitado. */
    disabled_reason: z.string().trim().max(200).optional(),
    /**
     * Quién puede presionarlo además de los admins. Sin esto, todo el equipo
     * (manager, agent y viewer). Cambiar campos exige además poder editar el
     * registro.
     */
    roles: z.array(z.enum(BUTTON_ROLES)).max(3).optional(),
    /**
     * Portal del cliente: el botón aparece si está en el diseño del portal.
     * Ahí sólo abre enlaces, cambia campos que el portal deja editar y genera
     * PDF publicados en el portal. Correr una automatización (que corre con
     * los permisos del equipo) exige esta regla explícita.
     */
    portal_run_automation: z.boolean().optional(),
});
export type ButtonConfig = z.infer<typeof buttonConfigSchema>;

/** Lectura tolerante: una config que no valida se lee como un botón sin acciones. */
export function readButtonConfig(config: unknown): ButtonConfig {
    const parsed = buttonConfigSchema.safeParse(config ?? {});
    if (parsed.success) return parsed.data;
    return { actions: [] };
}

// ── Presionar (API) ─────────────────────────────────────────────────────────

/** `POST /lists/:l/records/:id/buttons/:fieldId` (y el del portal). */
export const pressButtonSchema = z.object({}).passthrough();

/** `POST /lists/:l/records/buttons/:fieldId/bulk` — presionar sobre varios registros. */
export const BUTTON_BULK_MAX = 50;
export const pressButtonBulkSchema = z.object({
    ids: z.array(idSchema).min(1).max(BUTTON_BULK_MAX),
});
export type PressButtonBulkInput = z.infer<typeof pressButtonBulkSchema>;

/** Qué pasó con cada acción. */
export type ButtonActionResult =
    | { type: 'open_url'; ok: true; url: string }
    | { type: 'update_fields'; ok: true; changed: string[] }
    | {
          type: 'run_automation';
          ok: true;
          /** Las automatizaciones que se pusieron en marcha (corren en la cola). */
          automations: Array<{ id: number; name: string }>;
          /** Para consultar cómo terminaron (`GET …/presses/:pressId`). */
          press_id: string | null;
      }
    | {
          type: 'generate_pdf';
          ok: true;
          filename: string;
          number: string | null;
          /** `download`: el PDF en base64 (lo baja el navegador). */
          pdf: string | null;
          /** `save`: el archivo guardado en el registro. */
          file_id: number | null;
      }
    | { type: ButtonActionType; ok: false; error: string }
    | { type: ButtonActionType; ok: false; skipped: true; error: string };

export interface PressButtonResult {
    /** true si todas las acciones salieron bien. */
    ok: boolean;
    /** Resumen legible («Listo: se marcó como pagado»). */
    message: string;
    actions: ButtonActionResult[];
    /** El registro como quedó (si alguna acción lo cambió). */
    record: Record<string, unknown> | null;
}

export interface PressButtonBulkResult {
    results: Array<{ id: number; ok: boolean; message: string }>;
    ok: number;
    failed: number;
}

/** El estado de las automatizaciones que inició un botón. */
export interface ButtonPressStatus {
    /** `queued`: todavía no empezó; `running`: en curso; `done`: terminó. */
    state: 'queued' | 'running' | 'done' | 'unknown';
    runs: Array<{
        automation_id: number;
        name: string;
        status: string;
        error: string | null;
    }>;
}
