import { z } from 'zod';

import { FORM_DRAFT_CODE_RE, FORM_STAT_DEVICES, FORM_STAT_ITEM_ID_RE, FORM_STAT_MAX_STEP } from './form-stats-logic';

export * from './form-stats-logic';

/** v0.1.358 — Lo que manda la página pública (ver `form-stats-logic.ts`). */
export const formStatEventSchema = z.object({
    kind: z.enum(['view', 'start', 'step', 'leave']),
    /** `step` — el paso al que llegó (1 = el primero). */
    step: z.number().int().min(1).max(FORM_STAT_MAX_STEP).optional(),
    /** `leave` — la última pregunta que tocó antes de irse. */
    item: z.string().regex(FORM_STAT_ITEM_ID_RE).optional(),
    /** `view` — de dónde vino (ver `FORM_STAT_SOURCE_RE`). */
    src: z.string().max(90).optional(),
    /** `view` — desde qué dispositivo. */
    dev: z.enum(FORM_STAT_DEVICES).optional(),
});

export const formStatEventsSchema = z.object({
    events: z.array(formStatEventSchema).min(1).max(12),
});
export type FormStatEventsInput = z.infer<typeof formStatEventsSchema>;

/** v0.1.358 — «Guardar y seguir después». */
export const saveFormDraftSchema = z.object({
    stamp: z.string().max(200),
    hp: z.string().max(500).optional(),
    email: z.string().trim().toLowerCase().email().max(320),
    values: z.record(z.string().regex(/^\d{1,12}$/), z.unknown()).default({}),
    /** El paso donde quedó (0 = el primero). */
    page: z.number().int().min(0).max(FORM_STAT_MAX_STEP).default(0),
    /** Si ya tenía un enlace: se actualiza el mismo, sin mandar otro correo. */
    code: z.string().regex(FORM_DRAFT_CODE_RE).optional(),
});
export type SaveFormDraftInput = z.infer<typeof saveFormDraftSchema>;

