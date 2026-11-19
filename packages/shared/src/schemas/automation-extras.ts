/**
 * v0.1.455 — Dos disparadores y tres acciones nuevas de las automatizaciones:
 *
 *  - «Cuando un registro empieza a cumplir una condición» (`record_matches`):
 *    dispara UNA vez cuando el registro ENTRA en la condición (por una edición
 *    o porque pasó el tiempo: «vence en 3 días», un campo calculado que cambió)
 *    y sólo vuelve a disparar si sale y vuelve a entrar.
 *  - «Cuando se sube un archivo» (`file_added`): un campo de archivos ganó
 *    archivos (al crear o al editar el registro).
 *  - «Avisar en la app» (`notify_in_app`): un aviso en la campana (y el push,
 *    según las preferencias de cada persona) con un enlace al registro.
 *  - «Asignar por turno» (`assign_round_robin`): pone a una persona en un campo
 *    Persona, por turnos o a quien tenga menos registros abiertos.
 *  - «Copiar a otra lista» (`copy_record`): crea un registro en otra lista con
 *    los campos del mismo nombre, más los que se elijan a mano.
 *
 * Todo puro y sin zod: lo usan el motor, el editor y el asistente.
 */
import { RESPONSE_NAME_RE } from './automation-flow';

export const RECORD_MATCHES_TRIGGER = 'record_matches';
export const FILE_ADDED_TRIGGER = 'file_added';
export const NOTIFY_IN_APP_ACTION = 'notify_in_app';
export const ASSIGN_ROUND_ROBIN_ACTION = 'assign_round_robin';
export const COPY_RECORD_ACTION = 'copy_record';

function positiveInt(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function idList(v: unknown, max: number): number[] {
    const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : typeof v === 'number' ? [v] : [];
    const out: number[] = [];
    for (const x of raw) {
        const n = positiveInt(typeof x === 'string' ? x.trim() : x);
        if (n !== null && !out.includes(n)) out.push(n);
        if (out.length >= max) break;
    }
    return out;
}

function foldText(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// ─────────────── «Cuando un registro empieza a cumplir una condición» ───────────────

/** Cada cuántos minutos se revisa si un registro entró por el paso del tiempo. */
export const RECORD_MATCHES_SWEEP_MINUTES = 15;
/** Cuántos registros nuevos dispara como máximo una revisión (el resto, en la siguiente). */
export const RECORD_MATCHES_SWEEP_MAX = 1000;

export interface RecordMatchesConfig {
    /** El árbol de filtros (por `field_id`, el mismo de la tabla). null = sin condición. */
    filter: Record<string, unknown> | null;
    /** También cuando el registro se crea ya cumpliéndola (por defecto sí). */
    onCreate: boolean;
}

export function readRecordMatchesConfig(cfg: Record<string, unknown> | null | undefined): RecordMatchesConfig {
    const c = cfg ?? {};
    const f = c.match_filter;
    return {
        filter: f && typeof f === 'object' && !Array.isArray(f) ? (f as Record<string, unknown>) : null,
        onCreate: c.match_on_create !== false,
    };
}

/** Cuántas condiciones tiene un árbol de filtros (a cualquier profundidad). */
export function countFilterConditions(node: unknown, depth = 0): number {
    if (!node || typeof node !== 'object' || depth > 6) return 0;
    const n = node as { type?: unknown; children?: unknown };
    if (n.type === 'condition') return 1;
    if (!Array.isArray(n.children)) return 0;
    return n.children.reduce((sum: number, c) => sum + countFilterConditions(c, depth + 1), 0);
}

/** Los ids de campo que usa el árbol (para validar que existan y resumir). */
export function filterFieldIds(node: unknown, depth = 0, out: number[] = []): number[] {
    if (!node || typeof node !== 'object' || depth > 6) return out;
    const n = node as { type?: unknown; field_id?: unknown; children?: unknown };
    if (n.type === 'condition') {
        const id = positiveInt(n.field_id);
        if (id !== null && !out.includes(id)) out.push(id);
        return out;
    }
    if (Array.isArray(n.children)) for (const c of n.children) filterFieldIds(c, depth + 1, out);
    return out;
}

/** Resumen en palabras («Cuando un registro empieza a cumplir 2 condiciones»). */
export function describeRecordMatchesTrigger(cfg: RecordMatchesConfig): string {
    const n = countFilterConditions(cfg.filter);
    if (n === 0) return 'Cuando un registro empieza a cumplir una condición';
    return n === 1 ? 'Cuando un registro empieza a cumplir la condición' : `Cuando un registro empieza a cumplir ${n} condiciones`;
}

// ─────────────── «Cuando se sube un archivo» ───────────────

export const FILE_KINDS = ['any', 'image', 'pdf'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABELS: Record<FileKind, string> = {
    any: 'Cualquier archivo',
    image: 'Sólo imágenes',
    pdf: 'Sólo PDF',
};

export interface FileAddedConfig {
    /** El campo de archivos que se mira; null = cualquiera de la lista. */
    fieldId: number | null;
    kind: FileKind;
}

export function readFileAddedConfig(cfg: Record<string, unknown> | null | undefined): FileAddedConfig {
    const c = cfg ?? {};
    return {
        fieldId: positiveInt(c.file_field_id),
        kind: (FILE_KINDS as readonly string[]).includes(String(c.file_kind)) ? (c.file_kind as FileKind) : 'any',
    };
}

/** ¿El archivo es del tipo elegido? (por su tipo MIME o, si no se sabe, por la extensión). */
export function fileKindMatches(kind: FileKind, mime: string, filename: string): boolean {
    if (kind === 'any') return true;
    const m = (mime || '').toLowerCase();
    const ext = (filename || '').toLowerCase().split('.').pop() ?? '';
    if (kind === 'image') return m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'svg'].includes(ext);
    return m === 'application/pdf' || ext === 'pdf';
}

/** Los ids de archivo que llegaron: los de `after` que no estaban en `before`. */
export function addedFileIds(before: unknown, after: unknown): number[] {
    const prev = new Set(idList(before, 500));
    return idList(after, 500).filter((id) => !prev.has(id));
}

/** El archivo que disparó la automatización (viaja en el evento y en una espera). */
export interface FileEventInfo {
    id: number;
    name: string;
    mime: string;
    size: number;
    field_id: number;
    field_label: string;
    /** Enlace firmado de vida larga (sirve en un correo o un WhatsApp). */
    link: string;
    /** Cuántos archivos llegaron juntos (los demás datos son del primero). */
    count: number;
}

/** Variables `{{archivo.x}}` del disparador. */
export const FILE_VARIABLES: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'nombre', label: 'Nombre del archivo' },
    { key: 'tipo', label: 'Tipo (imagen, PDF…)' },
    { key: 'tamano', label: 'Tamaño' },
    { key: 'campo', label: 'Campo donde se subió' },
    { key: 'enlace', label: 'Enlace para abrirlo (sirve en un correo)' },
    { key: 'cantidad', label: 'Cuántos archivos llegaron' },
];

/** Un tamaño como lo lee una persona («245 KB», «2.4 MB»). */
export function humanFileSize(bytes: number): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 KB';
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** El tipo como lo lee una persona. */
export function humanFileType(mime: string, filename: string): string {
    if (fileKindMatches('pdf', mime, filename)) return 'PDF';
    if (fileKindMatches('image', mime, filename)) return 'Imagen';
    const ext = (filename || '').split('.').pop() ?? '';
    return ext && ext !== filename ? ext.toUpperCase() : mime || 'Archivo';
}

export function fileEventValue(ev: FileEventInfo | undefined, key: string): string | undefined {
    if (!ev) return '';
    switch (key) {
        case 'nombre':
            return ev.name;
        case 'tipo':
            return humanFileType(ev.mime, ev.name);
        case 'tamano':
            return humanFileSize(ev.size);
        case 'campo':
            return ev.field_label;
        case 'enlace':
            return ev.link;
        case 'cantidad':
            return String(ev.count);
        case 'id':
            return String(ev.id);
        default:
            return undefined;
    }
}

/** Resumen en palabras («Cuando se sube una imagen a «Fotos»»). */
export function describeFileTrigger(cfg: FileAddedConfig, fieldLabel?: string | null): string {
    const what = cfg.kind === 'image' ? 'una imagen' : cfg.kind === 'pdf' ? 'un PDF' : 'un archivo';
    return `Cuando se sube ${what}${fieldLabel ? ` a «${fieldLabel}»` : ''}`;
}

// ─────────────── «Avisar en la app» ───────────────

/** Tope de personas que avisa una acción (sumando personas, campos y equipos). */
export const NOTIFY_IN_APP_MAX_RECIPIENTS = 50;

export interface NotifyInAppConfig {
    /** Título del aviso (acepta variables). */
    title: string;
    /** El texto (opcional, acepta variables). */
    message: string;
    /** Personas puntuales (ids de usuario). */
    userIds: number[];
    /** Campos Persona del registro (ids de campo): se avisa a quien esté ahí. */
    personFieldIds: number[];
    /** Equipos: se avisa a sus personas (las de HOY). */
    teamIds: number[];
    /** También a quien hizo el cambio que disparó la automatización. */
    includeActor: boolean;
}

export function readNotifyInAppConfig(cfg: Record<string, unknown> | null | undefined): NotifyInAppConfig {
    const c = cfg ?? {};
    return {
        title: typeof c.title === 'string' ? c.title.slice(0, 300) : '',
        message: typeof c.message === 'string' ? c.message.slice(0, 2000) : '',
        userIds: idList(c.notify_user_ids, 50),
        personFieldIds: idList(c.person_field_ids, 10),
        teamIds: idList(c.notify_team_ids, 10),
        includeActor: c.include_actor === true,
    };
}

export function notifyInAppHasRecipients(c: NotifyInAppConfig): boolean {
    return c.userIds.length > 0 || c.personFieldIds.length > 0 || c.teamIds.length > 0 || c.includeActor;
}

// ─────────────── «Asignar por turno» ───────────────

export const ASSIGN_MODES = ['round_robin', 'least_open'] as const;
export type AssignMode = (typeof ASSIGN_MODES)[number];
export const ASSIGN_MODE_LABELS: Record<AssignMode, string> = {
    round_robin: 'Por turnos (uno cada vez)',
    least_open: 'A quien tenga menos registros abiertos en esta lista',
};

export interface AssignRoundRobinConfig {
    /** El campo Persona que se llena. */
    personFieldId: number | null;
    /** Entre estas personas… */
    userIds: number[];
    /** …o entre las personas de este equipo (las de HOY). */
    teamId: number | null;
    mode: AssignMode;
    /** Sólo si el campo está vacío (por defecto sí: no le quita el registro a nadie). */
    onlyIfEmpty: boolean;
}

export function readAssignRoundRobinConfig(cfg: Record<string, unknown> | null | undefined): AssignRoundRobinConfig {
    const c = cfg ?? {};
    return {
        personFieldId: positiveInt(c.person_field_id),
        userIds: idList(c.assignee_user_ids, 50),
        teamId: positiveInt(c.team_id),
        mode: (ASSIGN_MODES as readonly string[]).includes(String(c.assign_mode)) ? (c.assign_mode as AssignMode) : 'round_robin',
        onlyIfEmpty: c.only_if_empty !== false,
    };
}

/** El turno: con las candidatas en su orden, la siguiente según el contador. */
export function pickRoundRobin<T>(candidates: readonly T[], counter: number): T | null {
    if (candidates.length === 0) return null;
    const n = Math.abs(Math.trunc(counter));
    return candidates[n % candidates.length] ?? null;
}

/** La de menos registros abiertos; con un empate, la primera en el orden elegido. */
export function pickLeastOpen<T extends { open: number }>(candidates: readonly T[]): T | null {
    let best: T | null = null;
    for (const c of candidates) if (best === null || c.open < best.open) best = c;
    return best;
}

/** Variables `{{asignado.x}}` que deja la acción. */
export const ASSIGN_OUTPUTS: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'nombre', label: 'Nombre de la persona asignada' },
    { key: 'email', label: 'Correo de la persona asignada' },
    { key: 'id', label: 'Id de la persona asignada' },
];

// ─────────────── «Copiar a otra lista» ───────────────

export const COPY_RECORD_DEFAULT_NAME = 'copia';

export interface CopyRecordConfig {
    /** La lista donde se crea la copia. */
    listId: number | null;
    /** Valores por slug de la lista destino (aceptan variables), como «Crear un registro». */
    values: Record<string, unknown>;
    /** Copiar solos los campos que se llaman igual y son compatibles (por defecto sí). */
    autoMap: boolean;
    /**
     * Una relación que vincula la copia con el original: la de la lista destino
     * (apunta a esta lista) o la de esta lista (apunta a la destino).
     */
    linkFieldId: number | null;
    /** Copiar también los archivos (por defecto sí). */
    copyFiles: boolean;
    responseName: string;
}

export function readCopyRecordConfig(cfg: Record<string, unknown> | null | undefined): CopyRecordConfig {
    const c = cfg ?? {};
    const values: Record<string, unknown> = {};
    if (c.values && typeof c.values === 'object' && !Array.isArray(c.values)) {
        for (const [k, v] of Object.entries(c.values as Record<string, unknown>)) if (k.trim() !== '') values[k.trim()] = v;
    }
    const name = typeof c.response_name === 'string' ? c.response_name.trim().toLowerCase() : '';
    return {
        listId: positiveInt(c.target_list_id ?? c.list_id),
        values,
        autoMap: c.auto_map !== false,
        linkFieldId: positiveInt(c.link_field_id),
        copyFiles: c.copy_files !== false,
        responseName: name === '' ? COPY_RECORD_DEFAULT_NAME : name,
    };
}

export const COPY_RECORD_OUTPUTS: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'id', label: 'Id del registro copiado' },
    { key: 'titulo', label: 'Título del registro copiado' },
    { key: 'lista', label: 'Lista donde quedó' },
];

/** Un campo, lo justo para decidir si se copia solo. */
export interface CopyFieldLike {
    id: number;
    label: string;
    type: string;
    config?: unknown;
}

/** Tipos que se escriben a mano (los demás se calculan o viven fuera del registro). */
const COPY_WRITABLE = new Set([
    'text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime', 'checkbox',
    'url', 'email', 'user', 'relation', 'file', 'phone', 'rating', 'percent', 'duration', 'team',
]);
const TEXT_FAMILY = new Set(['text', 'long_text']);
const NUMBER_FAMILY = new Set(['number', 'currency']);

/** ¿Un valor de `from` se puede copiar a `to`? */
export function copyTypesCompatible(from: CopyFieldLike, to: CopyFieldLike): boolean {
    if (!COPY_WRITABLE.has(from.type) || !COPY_WRITABLE.has(to.type)) return false;
    if (from.type === 'relation' || to.type === 'relation') {
        const target = (f: CopyFieldLike): number | null => positiveInt((f.config as { target_list_id?: unknown } | undefined)?.target_list_id);
        return from.type === 'relation' && to.type === 'relation' && target(from) !== null && target(from) === target(to);
    }
    if (from.type === to.type) return true;
    if (TEXT_FAMILY.has(to.type) && ['text', 'long_text', 'email', 'url', 'phone', 'select'].includes(from.type)) return true;
    return NUMBER_FAMILY.has(from.type) && NUMBER_FAMILY.has(to.type);
}

/**
 * Los pares (campo de esta lista → campo de la destino) que se copian solos:
 * mismo nombre (sin tildes ni mayúsculas) y tipo compatible. Los archivos,
 * sólo con `copyFiles`. Cada campo destino recibe UN origen.
 */
export function autoMapCopyFields(
    source: readonly CopyFieldLike[],
    target: readonly CopyFieldLike[],
    opts: { copyFiles: boolean },
): Array<{ from: CopyFieldLike; to: CopyFieldLike }> {
    const out: Array<{ from: CopyFieldLike; to: CopyFieldLike }> = [];
    const used = new Set<number>();
    for (const to of target) {
        if (to.type === 'file' && !opts.copyFiles) continue;
        const name = foldText(to.label);
        if (name === '') continue;
        const from = source.find((s) => foldText(s.label) === name && copyTypesCompatible(s, to));
        if (!from || used.has(to.id)) continue;
        used.add(to.id);
        out.push({ from, to });
    }
    return out;
}

// ─────────────── Validación y resúmenes ───────────────

/** Problemas de la config de las tres acciones (al guardar y en el editor). */
export function automationExtraActionIssues(type: string, cfg: Record<string, unknown>, at: string): Array<{ path: string; message: string }> {
    const out: Array<{ path: string; message: string }> = [];
    if (type === NOTIFY_IN_APP_ACTION) {
        const c = readNotifyInAppConfig(cfg);
        if (c.title.trim() === '') out.push({ path: `${at}.config.title`, message: 'Escribe el título del aviso.' });
        if (!notifyInAppHasRecipients(c)) {
            out.push({ path: `${at}.config.notify_user_ids`, message: 'Elige a quién avisar: personas, un campo Persona del registro, un equipo o quien hizo el cambio.' });
        }
    }
    if (type === ASSIGN_ROUND_ROBIN_ACTION) {
        const c = readAssignRoundRobinConfig(cfg);
        if (c.personFieldId === null) out.push({ path: `${at}.config.person_field_id`, message: 'Elige el campo Persona que se llena.' });
        if (c.userIds.length === 0 && c.teamId === null) {
            out.push({ path: `${at}.config.assignee_user_ids`, message: 'Elige entre quiénes se reparte: personas o un equipo.' });
        }
    }
    if (type === COPY_RECORD_ACTION) {
        const c = readCopyRecordConfig(cfg);
        if (c.listId === null) out.push({ path: `${at}.config.target_list_id`, message: 'Elige la lista donde se crea la copia.' });
        if (!RESPONSE_NAME_RE.test(c.responseName)) {
            out.push({ path: `${at}.config.response_name`, message: 'El nombre del resultado usa sólo minúsculas, números y guion bajo, y empieza con una letra (por ejemplo «copia»).' });
        }
        if (!c.autoMap && Object.keys(c.values).length === 0 && c.linkFieldId === null) {
            out.push({ path: `${at}.config.values`, message: 'Elige qué copiar: los campos del mismo nombre o al menos un campo a mano.' });
        }
    }
    return out;
}

/** El nombre del resultado que deja «Copiar a otra lista» (para que dos pasos no se pisen). */
export function extraActionResponseName(type: string, cfg: Record<string, unknown>): string | null {
    return type === COPY_RECORD_ACTION ? readCopyRecordConfig(cfg).responseName : null;
}

/** Problemas del disparador (al guardar). */
export function automationExtraTriggerIssues(type: string | undefined, cfg: Record<string, unknown>): Array<{ path: string; message: string }> {
    if (type !== RECORD_MATCHES_TRIGGER) return [];
    const c = readRecordMatchesConfig(cfg);
    if (countFilterConditions(c.filter) === 0) {
        return [{ path: 'trigger_config.match_filter', message: 'Agrega al menos una condición: el disparador avisa cuando un registro empieza a cumplirla.' }];
    }
    return [];
}
