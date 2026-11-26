import { z } from 'zod';

import { idSchema } from './common';

/**
 * v0.1.470 — «Esta lista se puede ver como ficha»: la tarjeta que le
 * sugiere la ficha diseñada a quien administra una lista que todavía usa la
 * ficha simple. Se muestra UNA vez por lista: lo que la persona descartó
 * («Ahora no», cerrar) vive en `memberships.settings.layout_hints` y viaja
 * a todos sus dispositivos.
 */
export const LAYOUT_HINTS_MAX = 500;

export const layoutHintsSchema = z.object({
    dismissed_lists: z.array(idSchema).max(LAYOUT_HINTS_MAX).default([]),
});
export type LayoutHints = z.infer<typeof layoutHintsSchema>;

export const dismissLayoutHintSchema = z.object({ list_id: idSchema });
export type DismissLayoutHintInput = z.infer<typeof dismissLayoutHintSchema>;

/** Lectura tolerante de lo guardado (un valor raro = nada descartado). */
export function readLayoutHints(raw: unknown): LayoutHints {
    const parsed = layoutHintsSchema.safeParse(raw ?? {});
    if (parsed.success) return parsed.data;
    const list = raw && typeof raw === 'object' ? (raw as { dismissed_lists?: unknown }).dismissed_lists : undefined;
    const ids = Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n) && (n as number) > 0) : [];
    return { dismissed_lists: ids.slice(-LAYOUT_HINTS_MAX) };
}
