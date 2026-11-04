import { FORM_EDIT_CODE_RE, formEditLinksSchema, type FormEditLinks } from '@imagina-base/shared';

/**
 * v0.1.360 — Enlaces para que alguien actualice SU registro con un formulario.
 *
 * El enlace es la dirección pública del formulario con `?editar=<código>`, y
 * el código es `<id del registro>.<vence>.<firma>`: la firma (HMAC con el
 * secreto de los enlaces firmados, recortada a 32 hexadecimales) ata el
 * enlace a la empresa, el formulario, el registro, el vencimiento y la
 * versión de los enlaces del formulario. Así no hay que guardar nada por
 * enlace, y «Invalidar todos los enlaces» es subir la versión.
 *
 * Lo comparten el servicio de formularios (el botón de la ficha, la página
 * pública) y el motor de automatizaciones (`{{formulario.<id>.enlace}}`), que
 * no inyecta el servicio: el módulo de formularios registra lo que hace falta
 * al arrancar. Sin registrar (specs que arman el motor a mano), la variable
 * sale vacía.
 */
export interface FormEditRuntime {
    /** Firma de un enlace (ya recortada). */
    sign(tenantId: number, formId: number, recordId: number, exp: number, version: number): string;
    /** Origen de los enlaces de la empresa (su dominio propio si responde; si no, la plataforma). */
    linkBase(tenantId: number): Promise<string>;
}

let runtime: FormEditRuntime | null = null;

export function configureFormEditRuntime(r: FormEditRuntime | null): void {
    runtime = r;
}

export function formEditRuntime(): FormEditRuntime | null {
    return runtime;
}

/** Los ajustes de los enlaces de una config guardada (tolerante: lo raro = apagado). */
export function readEditLinks(config: unknown): FormEditLinks | null {
    const settings = (config as { settings?: { edit_links?: unknown } } | null)?.settings;
    const parsed = formEditLinksSchema.safeParse(settings?.edit_links ?? {});
    return parsed.success && parsed.data.enabled ? parsed.data : null;
}

/**
 * El vencimiento de un enlace pedido ahora (segundos): redondeado hacia arriba
 * a la hora, así los enlaces de un mismo registro pedidos en la misma hora son
 * iguales (un correo masivo no arma uno distinto por cada segundo).
 */
export function editLinkExpiry(days: number, nowMs = Date.now()): number {
    return Math.ceil((nowMs / 1000 + days * 86_400) / 3600) * 3600;
}

/** El código de un enlace (`<registro>.<vence>.<firma>`). */
export function editLinkCode(
    sign: FormEditRuntime['sign'],
    tenantId: number,
    formId: number,
    recordId: number,
    links: FormEditLinks,
    nowMs = Date.now(),
): { code: string; expiresAt: Date } {
    const exp = editLinkExpiry(links.days, nowMs);
    return { code: `${recordId}.${exp}.${sign(tenantId, formId, recordId, exp, links.version)}`, expiresAt: new Date(exp * 1000) };
}

/** La dirección completa del enlace. */
export function editLinkUrl(base: string, formToken: string, code: string): string {
    return `${base.replace(/\/+$/, '')}/api/v1/public/f/${formToken}?editar=${code}`;
}

/**
 * Lee un código: el registro y el vencimiento si es de la forma correcta y no
 * venció (la firma se comprueba aparte, con la versión vigente del formulario).
 * Un vencimiento a más de un año también es inválido: ningún enlace se arma así.
 */
export function parseEditCode(code: string, nowMs = Date.now()): { recordId: number; exp: number; sig: string } | null {
    if (!FORM_EDIT_CODE_RE.test(code)) return null;
    const [ridRaw, expRaw, sig] = code.split('.') as [string, string, string];
    const recordId = Number(ridRaw);
    const exp = Number(expRaw);
    if (!Number.isSafeInteger(recordId) || recordId <= 0 || !Number.isSafeInteger(exp)) return null;
    const now = nowMs / 1000;
    if (exp <= now || exp > now + 367 * 86_400) return null;
    return { recordId, exp, sig };
}

/** Las variables del enlace: `{{formulario.<id>.enlace}}` (y su alias en inglés). */
const EDIT_TOKEN_RE = /^(?:formulario|form)\.(\d{1,12})\.(?:enlace|link)$/;

export function editLinkFormId(token: string): number | null {
    const m = EDIT_TOKEN_RE.exec(token);
    return m ? Number(m[1]) : null;
}

/** Un formulario de la lista con los enlaces encendidos. */
export interface EditLinkForm {
    id: number;
    token: string;
    links: FormEditLinks;
}

/**
 * Para el motor: arma, dado el registro, el enlace de cada formulario con los
 * enlaces encendidos. `''` sin runtime, sin formularios o si el formulario no
 * es de la lista o los apagó.
 */
export async function editLinkMaker(tenantId: number, editForms: readonly EditLinkForm[]): Promise<((formId: number, recordId: number) => string) | undefined> {
    const rt = runtime;
    if (!rt || editForms.length === 0) return undefined;
    const base = await rt.linkBase(tenantId).catch(() => '');
    if (!base) return undefined;
    const byId = new Map(editForms.map((f) => [f.id, f]));
    return (formId, recordId) => {
        const f = byId.get(formId);
        if (!f || recordId <= 0) return '';
        return editLinkUrl(base, f.token, editLinkCode(rt.sign, tenantId, f.id, recordId, f.links).code);
    };
}
