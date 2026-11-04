/**
 * v0.1.351 (ADR-S94) — Página pública de un formulario (el visitante, sin
 * cuenta). Se compila aparte (`vite.form.config.ts`) a un script chico que el
 * API sirve EN LÍNEA dentro del HTML con el nonce de la CSP: un formulario
 * se abre una vez por visitante, y así llega todo en un solo viaje.
 *
 * Antes era una copia escrita a mano en ES5 de la lógica de shared; ahora la
 * IMPORTA (condiciones, páginas) desde `form-logic`, que no arrastra Zod.
 *
 * Todo se arma con `createElement`/`textContent`: ni una etiqueta, texto u
 * opción llega como HTML. Lo que decide qué se guarda es el servidor (vuelve
 * a evaluar las condiciones y valida cada valor); esto sólo arma la pantalla.
 *
 * El diseño: los colores y tamaños vienen en el CSS del tema (`#ib-theme`,
 * hecho por el servidor); lo que cambia la ESTRUCTURA (etiqueta dentro del
 * campo, estilo de las opciones, portada, panel dividido, avance) viene en
 * `meta.theme`. En la vista previa del constructor los dos llegan por
 * postMessage y se reemplazan en vivo.
 */
import type { PublicFormFieldItem, PublicFormItem, PublicFormMeta, PublicThemeView } from '@imagina-base/shared';
import {
    FORM_CALC_VALUE_PREFIX,
    formAnswerText,
    formAnswered,
    formFlow,
    formRecallText,
    formScaleValues,
    splitFormPages,
    type FormCalcLike,
    type FormFlow,
} from '@imagina-base/shared/src/schemas/form-logic';

type FieldItem = PublicFormFieldItem;
type ImageItem = Extract<PublicFormItem, { type: 'image' }>;
type MatrixItem = Extract<PublicFormItem, { type: 'matrix' }>;
type Item = PublicFormItem;

interface Boot {
    token: string;
    preview: boolean;
    meta: PublicFormMeta | null;
    scripts: Record<string, string>;
}

interface Upload {
    name: string;
    pending: boolean;
    token?: string;
}

const BOOT = JSON.parse(document.getElementById('boot')?.textContent ?? '{}') as Boot;
const API = '/api/v1/public/forms/' + encodeURIComponent(BOOT.token);
const app = document.getElementById('app') as HTMLElement;
let embedded = false;
try {
    embedded = window.self !== window.top;
} catch {
    embedded = true;
}

const CONSENT = '__consent';
/** Tipos cuya etiqueta puede ir DENTRO del campo (se sube al escribir). */
const FLOAT_TYPES = new Set(['text', 'long_text', 'email', 'url', 'phone', 'number', 'duration']);

let meta: PublicFormMeta | null = BOOT.meta;

// ─────────────────────── Sello anti-robots (v0.1.352) ───────────────────────
// La página ya no lo trae (así se puede guardar en caché): se pide la primera
// vez que la persona toca el formulario. Una persona tarda más de unos
// segundos en completarlo; si alguien envía muy rápido (un formulario de un
// solo clic), se espera lo que falta antes de mandarlo.
const MIN_FILL_MS = 2600;
let stampPromise: Promise<{ stamp: string; at: number }> | null = null;

function ensureStamp(): Promise<{ stamp: string; at: number }> {
    if (meta?.stamp) return Promise.resolve({ stamp: meta.stamp, at: 0 });
    if (!stampPromise) {
        stampPromise = fetch(`${API}/stamp`, { credentials: 'omit', cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<{ stamp?: string }>) : Promise.reject(new Error('stamp'))))
            .then((b) => {
                if (!b.stamp) throw new Error('stamp');
                return { stamp: b.stamp, at: Date.now() };
            })
            .catch((err: unknown) => {
                stampPromise = null;
                throw err;
            });
    }
    return stampPromise;
}

/** El sello, esperando lo que falte para que el envío no cuente como «demasiado rápido». */
function readyStamp(): Promise<string> {
    return ensureStamp().then(({ stamp, at }) => {
        const wait = at + MIN_FILL_MS - Date.now();
        return wait > 0 ? new Promise<string>((r) => setTimeout(() => r(stamp), wait)) : stamp;
    });
}

function kickStamp(): void {
    if (BOOT.preview) return;
    void ensureStamp().catch(() => undefined);
}
let values: Record<string, unknown> = {};
let uploads: Record<string, Upload[]> = {};
let itemEls: Record<string, HTMLElement> = {};
let errEls: Record<string, HTMLElement> = {};
let selectedId: string | null = null;
/**
 * Lo que se muestra de a una vez: una página del formulario o, en el modo
 * «una pregunta por pantalla» (v0.1.357), una pregunta (con los títulos y
 * textos que van antes). `page` = la página real a la que pertenece (los
 * saltos se deciden por páginas).
 */
interface Unit {
    break_id: string | null;
    title: string;
    items: Item[];
    page: number;
    /** ¿Es lo primero de su página? (ahí va el título de la página). */
    first: boolean;
}
let pages: Unit[] = [];
let pageEls: HTMLElement[] = [];
let current = 0;
let root: HTMLElement | null = null;
let stepsLabel: HTMLElement | null = null;
let barEl: HTMLElement | null = null;
let dotsEl: HTMLElement | null = null;
let prevBtn: HTMLButtonElement | null = null;
let nextBtn: HTMLButtonElement | null = null;
let submitBtn: HTMLButtonElement | null = null;
let captchaBox: HTMLElement | null = null;
let alertBox: HTMLElement | null = null;
let consentCb: HTMLInputElement | null = null;
let consentBox: HTMLElement | null = null;
let captchaToken: string | null = null;
let captchaWidget: unknown = null;
let captchaMounted = false;
/** v0.1.355 — El campo de texto del «Otro» de cada pregunta (se muestra al elegir esa opción). */
let otherEls: Record<string, { wrap: HTMLElement; input: HTMLInputElement }> = {};
/** v0.1.357 — Ya tocó «Empezar» en la bienvenida. */
let started = false;
/** v0.1.357 — En la vista previa, mostrar la bienvenida (la pide el constructor). */
let previewWelcome = false;
/** v0.1.357 — El resultado de cada cálculo que mandó el servidor al enviar. */
let finalCalcs: Record<string, number> | null = null;

// ───────────────────────────── Utilidades ─────────────────────────────

type Attrs = Record<string, string | number | boolean | null | undefined> & { cls?: string; text?: string };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, kids?: Array<Node | null | undefined | false>): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'cls') n.className = String(v);
            else if (k === 'text') n.textContent = String(v);
            else if (v === true) n.setAttribute(k, '');
            else n.setAttribute(k, String(v));
        }
    }
    for (const c of kids ?? []) if (c) n.appendChild(c);
    return n;
}

function paragraphs(text: string, cls: string): HTMLElement {
    const box = el('div', { cls });
    for (const p of String(text || '').split(/\n{2,}/)) {
        if (!p.trim()) continue;
        const para = el('p');
        setRecall(para, p);
        box.appendChild(para);
    }
    return box;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string> = {
    arrow: 'M5 12h14M13 6l6 6-6 6',
    send: 'M4 12l16-8-6 16-3-7-7-1z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
};
function icon(name: string): SVGSVGElement | null {
    const d = ICONS[name];
    if (!d) return null;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
}

function empty(v: unknown): boolean {
    if (v === null || v === undefined || v === false) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
}

function view(): PublicThemeView | undefined {
    return meta?.theme;
}

function fields(): FieldItem[] {
    return (meta?.items ?? []).filter((i): i is FieldItem => i.type === 'field');
}

/**
 * v0.1.356 — El camino por las páginas con las respuestas actuales (con los
 * saltos): la MISMA función que usa el servidor para decidir qué acepta. Se
 * calcula una vez por cambio (`dirty()` lo invalida).
 */
let flowCache: FormFlow | null = null;
/** v0.1.357 — Los cálculos que la página puede hacer (los demás los hace el servidor al enviar). */
function liveCalcs(): FormCalcLike[] {
    return (meta?.calcs ?? []).filter((c) => c.parts !== null).map((c) => ({ key: c.key, start: c.start, parts: c.parts }));
}
function flow(): FormFlow {
    if (!flowCache) flowCache = formFlow((meta?.items ?? []) as never, values, meta?.jumps ?? [], liveCalcs());
    return flowCache;
}
function dirty(): void {
    flowCache = null;
}

/** ¿Se le muestra esta pregunta? (en una página del camino y con su condición cumplida). */
function visible(item: Item): boolean {
    return flow().shown(item.id);
}

// ─────────────── Recordar respuestas: «Hola {{nombre}}» (v0.1.356) ───────────────

let recallNodes: Array<{ node: Node; tpl: string }> = [];

/** La respuesta de `{{nombre}}` como la lee una persona (en la vista previa, sin respuesta, `[nombre]`). */
function recallValue(slug: string): string {
    const key = meta?.recall?.[slug];
    if (!key) return '';
    // v0.1.357 — un cálculo: el que mandó el servidor al enviar o el que va llevando la página.
    if (key.startsWith(FORM_CALC_VALUE_PREFIX)) {
        if (BOOT.preview) return `[${slug}]`;
        const ck = key.slice(FORM_CALC_VALUE_PREFIX.length);
        const v = finalCalcs?.[ck] ?? flow().calcs[ck];
        return typeof v === 'number' && Number.isFinite(v) ? fmtNum(v) : '';
    }
    const text = formAnswerText((meta?.items ?? []) as never, key, values, fmtNum);
    if (text || !BOOT.preview) return text;
    return `[${slug}]`;
}
function recall(tpl: string): string {
    return tpl.includes('{{') ? formRecallText(tpl, recallValue) : tpl;
}
/** Escribe un texto que puede llevar `{{nombre}}` y lo anota para reescribirlo al cambiar las respuestas. */
function setRecall(node: Node, tpl: string): void {
    node.textContent = recall(tpl);
    if (tpl.includes('{{')) recallNodes.push({ node, tpl });
}
function recallText(tpl: string): Text {
    const t = document.createTextNode('');
    setRecall(t, tpl);
    return t;
}
function paintRecall(): void {
    for (const r of recallNodes) {
        const next = recall(r.tpl);
        if (r.node.textContent !== next) r.node.textContent = next;
    }
}

/** v0.1.355 — ¿Eligió la opción «Otro» de esta pregunta? */
function choseOther(f: FieldItem): boolean {
    if (!f.other) return false;
    const v = values[f.key];
    return Array.isArray(v) ? v.map(String).includes(f.other.value) : v === f.other.value;
}

/** Un número con los separadores de la empresa. */
function fmtNum(n: number): string {
    const fmt = meta?.number_format ?? 'comma_dot';
    const [int, dec] = String(Math.abs(n)).split('.');
    const sep = fmt === 'comma_dot' ? ',' : fmt === 'dot_comma' ? '.' : '\u00a0';
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    const decSep = fmt === 'comma_dot' ? '.' : ',';
    return `${n < 0 ? '-' : ''}${grouped}${dec ? decSep + dec : ''}`;
}

function paged(): boolean {
    return pages.length > 1;
}
/** v0.1.357 — ¿Una pregunta por pantalla? */
function conversational(): boolean {
    return meta?.layout === 'conversational';
}
function isQuestion(i: Item): boolean {
    return (i.type === 'field' && !i.hidden) || i.type === 'matrix';
}
/** v0.1.357 — ¿Con una sola elección ya está respondida? (pasa sola a la siguiente). */
function autoAdvances(f: FieldItem): boolean {
    if (f.display === 'scale' || f.display === 'yes_no') return true;
    if (f.field_type === 'rating') return f.display !== 'slider';
    const single = f.field_type === 'select' || (f.field_type === 'team' && !f.multiple);
    return single && f.display !== 'dropdown' && f.display !== 'search';
}
/**
 * v0.1.357 — Parte el formulario en lo que se muestra de a una vez. Por
 * páginas (lo de siempre) o, una pregunta por pantalla: cada pregunta con los
 * títulos, textos e imágenes que van antes de ella; lo que queda al final de
 * una página va con su última pregunta.
 */
function buildUnits(items: Item[]): Unit[] {
    const real = splitFormPages(items as Array<Item & { title?: string }>) as Array<{ break_id: string | null; title: string; items: Item[] }>;
    if (!conversational()) return real.map((p, i) => ({ ...p, page: i, first: true }));
    const out: Unit[] = [];
    real.forEach((p, pi) => {
        let buf: Item[] = [];
        let first = true;
        const push = (list: Item[]): void => {
            out.push({ break_id: p.break_id, title: first ? p.title : '', items: list, page: pi, first });
            first = false;
        };
        for (const it of p.items) {
            buf.push(it);
            if (isQuestion(it)) {
                push(buf);
                buf = [];
            }
        }
        if (buf.length) {
            const last = out[out.length - 1];
            if (last && last.page === pi) last.items.push(...buf);
            else push(buf);
        }
    });
    return out;
}
/** v0.1.356 — Lo que ve la persona, en orden (las páginas del camino; con una pregunta por pantalla, las preguntas a la vista). */
function visiblePages(): number[] {
    // En la vista previa se puede ver cualquier página (sin respuestas, un salto no decide nada).
    if (BOOT.preview) return pages.map((_, i) => i);
    const path = new Set(flow().path);
    const out: number[] = [];
    pages.forEach((u, i) => {
        if (!path.has(u.page)) return;
        if (conversational()) {
            const qs = u.items.filter(isQuestion);
            if (qs.length ? !qs.some((q) => visible(q)) : !u.items.some((it) => visible(it))) return;
        }
        out.push(i);
    });
    return out;
}
function isLastPage(): boolean {
    const vis = visiblePages();
    return vis.length === 0 || vis[vis.length - 1]! <= current;
}
function pageOfItem(id: string): number {
    for (let i = 0; i < pages.length; i++) if (pages[i]!.items.some((it) => it.id === id)) return i;
    return 0;
}

function parseNumber(raw: string): number | null {
    let s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/[^0-9.,-]/g, '');
    // Tolerante: «1.500.000» y «1,500,000» son miles en cualquier formato; con
    // los dos separadores el último es el decimal; uno suelto sigue el formato
    // de la empresa.
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;
    if (dots && commas) {
        const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
        s = s.split(dec === '.' ? ',' : '.').join('');
        if (dec === ',') s = s.replace(',', '.');
    } else if (dots > 1) s = s.replace(/\./g, '');
    else if (commas > 1) s = s.replace(/,/g, '');
    else if (meta?.number_format === 'comma_dot') s = s.replace(/,/g, '');
    else s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

function setErr(id: string, msg: string): void {
    const n = itemEls[id];
    const e = errEls[id];
    if (!n || !e) return;
    e.textContent = msg || '';
    e.hidden = !msg;
    n.classList.toggle('ib-invalid', !!msg);
}
function clearErrs(): void {
    for (const id of Object.keys(errEls)) setErr(id, '');
}

/** Revisa las preguntas a la vista de estos ítems; marca y devuelve si hay errores. */
function validate(items: Item[]): boolean {
    dirty();
    let bad = false;
    for (const i of items) {
        if (i.type === 'matrix') {
            if (!visible(i)) continue;
            setErr(i.id, '');
            if (i.required && i.rows.some((r) => empty(values[r.key]))) {
                setErr(i.id, 'Responde todas las filas.');
                bad = true;
            }
            continue;
        }
        if (i.type !== 'field' || i.hidden || !visible(i)) continue;
        setErr(i.id, '');
        const v = values[i.key];
        if (i.required && !formAnswered(i.display, v)) {
            setErr(i.id, i.display === 'ranking' ? 'Ordena las opciones (o toca «Dejar este orden»).' : i.display === 'signature' ? 'Falta la firma.' : 'Esta pregunta es obligatoria.');
            bad = true;
        } else if (i.other && choseOther(i) && empty(values[i.other.key])) {
            setErr(i.id, 'Escribe cuál.');
            bad = true;
        } else if (i.field_type === 'email' && !empty(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
            setErr(i.id, 'Revisa el correo.');
            bad = true;
        } else if ((i.field_type === 'number' || i.field_type === 'currency' || i.field_type === 'percent') && typeof v === 'number' && Number.isNaN(v)) {
            setErr(i.id, 'Escribe un número.');
            bad = true;
        } else if (i.field_type === 'file' && (uploads[i.key] ?? []).some((u) => u.pending)) {
            setErr(i.id, i.display === 'signature' ? 'Espera a que termine de guardarse la firma.' : 'Espera a que termine de subir.');
            bad = true;
        }
    }
    return bad;
}

// ───────────────────────────── Captcha ─────────────────────────────

interface CaptchaApi {
    render: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
    reset: (id?: unknown) => void;
}
function captchaApi(): CaptchaApi | null {
    const p = meta?.captcha?.provider;
    const w = window as unknown as Record<string, CaptchaApi | undefined>;
    return (p === 'turnstile' ? w.turnstile : p === 'hcaptcha' ? w.hcaptcha : w.grecaptcha) ?? null;
}
function mountCaptcha(): void {
    if (!meta?.captcha || BOOT.preview || captchaMounted || !captchaBox) return;
    captchaMounted = true;
    const c = meta.captcha;
    const box = captchaBox;
    const w = window as unknown as Record<string, unknown>;
    w.__imbCaptchaReady = (): void => {
        const api = captchaApi();
        if (!api?.render) return;
        const opts: Record<string, unknown> = {
            sitekey: c.site_key,
            callback: (t: string) => {
                captchaToken = t;
                if (alertBox) alertBox.hidden = true;
            },
            'expired-callback': () => {
                captchaToken = null;
            },
            'error-callback': () => {
                captchaToken = null;
            },
        };
        if (c.provider === 'turnstile') opts.language = 'es';
        try {
            captchaWidget = api.render(box, opts);
        } catch {
            // el widget dirá qué pasó
        }
        reportHeight();
    };
    if (captchaApi()?.render) {
        (w.__imbCaptchaReady as () => void)();
        return;
    }
    const src = BOOT.scripts[c.provider];
    if (!src) return;
    const s = document.createElement('script');
    s.src = `${src}?render=explicit&onload=__imbCaptchaReady${c.provider === 'turnstile' ? '' : '&hl=es'}`;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
}
function resetCaptcha(): void {
    captchaToken = null;
    const api = captchaApi();
    if (api && captchaWidget !== null) {
        try {
            api.reset(captchaWidget);
        } catch {
            // nada
        }
    }
}

// ───────────────────────────── Controles ─────────────────────────────

type Control = HTMLElement & { _paint?: () => void };

function control(f: FieldItem, float: boolean): Control {
    const key = f.key;
    const id = 'q_' + f.id;
    const cfg = f.config || {};
    const ph = float ? ' ' : f.placeholder || undefined;
    const bindText = <T extends HTMLInputElement | HTMLTextAreaElement>(input: T, transform?: (v: string) => unknown): T => {
        input.classList.add('ib-input');
        input.addEventListener('input', () => {
            values[key] = transform ? transform(input.value) : input.value;
            setErr(f.id, '');
            refresh();
        });
        return input;
    };
    // v0.1.355 — las formas propias (escala, deslizador, sí/no, firma, ordenar, buscador).
    switch (f.display) {
        case 'scale':
            return scaleControl(f);
        case 'slider':
            return sliderControl(f);
        case 'yes_no':
            return yesNoControl(f);
        case 'signature':
            return signatureControl(f);
        case 'ranking':
            return rankingControl(f);
        case 'search':
            return withOther(f, searchControl(f));
        default:
            break;
    }
    // C1 — un «Equipo» se dibuja como una selección (una o varias).
    const kind = f.field_type === 'team' ? (f.display === 'checkboxes' ? 'multi_select' : 'select') : f.field_type;
    switch (kind) {
        case 'long_text':
            return bindText(el('textarea', { id, placeholder: ph, maxlength: cfg.max_length }));
        case 'email':
            return bindText(el('input', { type: 'email', id, placeholder: float ? ' ' : ph || 'nombre@ejemplo.com', autocomplete: 'email' }));
        case 'url':
            return bindText(el('input', { type: 'text', inputmode: 'url', id, placeholder: float ? ' ' : ph || 'https://' }));
        case 'phone':
            return bindText(el('input', { type: 'tel', id, placeholder: ph, autocomplete: 'tel' }));
        case 'date':
            return bindText(el('input', { type: 'date', id }));
        case 'datetime':
            return bindText(el('input', { type: 'datetime-local', id }), (v) => {
                if (!v) return null;
                const d = new Date(v);
                return Number.isNaN(d.getTime()) ? v : d.toISOString();
            });
        case 'duration':
            return bindText(el('input', { type: 'text', id, placeholder: float ? ' ' : ph || 'Ej.: 1h 30m' }));
        case 'number':
        case 'currency':
        case 'percent': {
            const input = bindText(el('input', { type: 'text', inputmode: 'decimal', id, placeholder: ph }), parseNumber);
            if (f.field_type === 'currency') {
                input.classList.add('ib-pre');
                return el('div', { cls: 'ib-affix' }, [el('span', { cls: 'ib-pre', text: cfg.currency || '$' }), input]);
            }
            if (f.field_type === 'percent') {
                input.classList.add('ib-suf');
                return el('div', { cls: 'ib-affix' }, [input, el('span', { cls: 'ib-suf', text: '%' })]);
            }
            return input;
        }
        case 'checkbox': {
            const cb = el('input', { type: 'checkbox', id });
            cb.addEventListener('change', () => {
                values[key] = cb.checked;
                setErr(f.id, '');
                refresh();
            });
            const text = el('span', { text: f.label });
            if (f.required) text.appendChild(el('span', { cls: 'ib-req', text: '*', 'aria-hidden': 'true' }));
            return el('label', { cls: 'ib-check', for: id }, [cb, text]);
        }
        case 'rating': {
            const max = Math.max(1, Math.min(10, cfg.max || 5));
            const box: Control = el('div', { cls: 'ib-stars', role: 'radiogroup', 'aria-label': f.label });
            const btns: HTMLButtonElement[] = [];
            const paint = (): void => btns.forEach((b, i) => b.classList.toggle('ib-on', (Number(values[key]) || 0) > i));
            for (let n = 1; n <= max; n++) {
                const b = el('button', { type: 'button', 'aria-label': `${n} de ${max}`, text: '★' });
                b.addEventListener('click', () => {
                    values[key] = values[key] === n ? null : n;
                    paint();
                    setErr(f.id, '');
                    refresh();
                });
                btns.push(b);
                box.appendChild(b);
            }
            box._paint = paint;
            return box;
        }
        case 'select': {
            const opts = f.options ?? [];
            if (f.display === 'dropdown') {
                const sel = el('select', { id, cls: 'ib-input' }, [
                    el('option', { value: '', text: f.placeholder || 'Elige una opción' }),
                    ...opts.map((o) => el('option', { value: o.value, text: o.label })),
                ]);
                sel.addEventListener('change', () => {
                    values[key] = sel.value || null;
                    setErr(f.id, '');
                    refresh();
                });
                return withOther(f, sel);
            }
            return withOther(f, choices(f, false));
        }
        case 'multi_select':
            return withOther(f, choices(f, true));
        case 'file':
            return filesControl(f, id);
        default:
            return bindText(el('input', { type: 'text', id, placeholder: ph, maxlength: cfg.max_length }));
    }
}

// ─────────────────────── Formas propias (v0.1.355) ───────────────────────

/** Mueve el foco entre botones de un grupo con las flechas (y elige al moverse). */
function arrowNav(btns: HTMLButtonElement[], onPick: (idx: number) => void): void {
    btns.forEach((b, idx) => {
        b.addEventListener('keydown', (e) => {
            const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            const next = (idx + dir + btns.length) % btns.length;
            btns[next]!.focus();
            onPick(next);
        });
    });
}

/** Etiquetas debajo de una escala o un deslizador («Nada probable» · «Muy probable»). */
function rangeLabels(r: NonNullable<FieldItem['range']>, fallback: [string, string]): HTMLElement | null {
    const low = r.low_label || fallback[0];
    const high = r.high_label || fallback[1];
    if (!low && !high && !r.mid_label) return null;
    return el('div', { cls: 'ib-scale-labels', 'aria-hidden': 'true' }, [el('span', { text: low }), el('span', { text: r.mid_label }), el('span', { text: high })]);
}

/** Escala de botones numerados (NPS, 1 a 5…). Tocar el elegido lo quita. */
function scaleControl(f: FieldItem): Control {
    const key = f.key;
    const r = f.range!;
    const vals = formScaleValues(r);
    const group = el('div', { cls: `ib-scale${vals.length > 6 ? ' ib-scale-many' : ''}`, role: 'radiogroup', 'aria-labelledby': 'l_' + f.id });
    group.style.setProperty('--ib-n', String(vals.length));
    const btns: HTMLButtonElement[] = [];
    const paint = (): void =>
        btns.forEach((b, i) => {
            const on = values[key] === vals[i];
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on || ((values[key] === null || values[key] === undefined) && i === 0) ? 0 : -1;
        });
    const pick = (idx: number, toggle: boolean): void => {
        const v = vals[idx]!;
        values[key] = toggle && values[key] === v ? null : v;
        paint();
        setErr(f.id, '');
        kickStamp();
        refresh();
    };
    vals.forEach((v, idx) => {
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': r.low_label && idx === 0 ? `${fmtNum(v)} · ${r.low_label}` : r.high_label && idx === vals.length - 1 ? `${fmtNum(v)} · ${r.high_label}` : fmtNum(v), text: fmtNum(v) });
        b.addEventListener('click', () => pick(idx, true));
        btns.push(b);
        group.appendChild(b);
    });
    arrowNav(btns, (idx) => pick(idx, false));
    paint();
    const box: Control = el('div', { cls: 'ib-scale-wrap' }, [group, rangeLabels(r, ['', ''])]);
    box._paint = paint;
    return box;
}

/** Cómo se lee el valor de un deslizador (con su moneda o su porcentaje). */
function sliderText(f: FieldItem, n: number): string {
    if (f.field_type === 'currency') return `${f.config.currency || '$'} ${fmtNum(n)}`;
    if (f.field_type === 'percent') return `${fmtNum(n)} %`;
    if (f.field_type === 'rating') return `${fmtNum(n)} de ${f.range!.max}`;
    return fmtNum(n);
}

/** Deslizador. Hasta que se mueve no hay respuesta (y lo dice). */
function sliderControl(f: FieldItem): Control {
    const key = f.key;
    const r = f.range!;
    const start = r.min + Math.round((r.max - r.min) / r.step / 2) * r.step;
    const input = el('input', { type: 'range', id: 'q_' + f.id, min: r.min, max: r.max, step: r.step, value: start });
    const out = el('output', { cls: 'ib-slider-value ib-unset', for: 'q_' + f.id, 'aria-live': 'polite', text: 'Mueve el control' });
    const paint = (): void => {
        const v = values[key];
        if (typeof v === 'number' && Number.isFinite(v)) {
            input.value = String(v);
            out.textContent = sliderText(f, v);
            out.classList.remove('ib-unset');
            input.setAttribute('aria-valuetext', sliderText(f, v));
        } else {
            out.textContent = 'Mueve el control';
            out.classList.add('ib-unset');
            input.removeAttribute('aria-valuetext');
        }
    };
    input.addEventListener('input', () => {
        values[key] = Number(input.value);
        paint();
        setErr(f.id, '');
        kickStamp();
        refresh();
    });
    const box: Control = el('div', { cls: 'ib-slider' }, [
        el('div', { cls: 'ib-slider-row' }, [input, out]),
        rangeLabels(r, [sliderText(f, r.min), sliderText(f, r.max)]),
    ]);
    box._paint = paint;
    return box;
}

/** Dos botones «Sí» y «No». Tocar el elegido lo quita. */
function yesNoControl(f: FieldItem): Control {
    const key = f.key;
    const group: Control = el('div', { cls: 'ib-yesno', role: 'radiogroup', 'aria-labelledby': 'l_' + f.id });
    const opts: Array<[boolean, string]> = [
        [true, f.yes_label || 'Sí'],
        [false, f.no_label || 'No'],
    ];
    const btns = opts.map(([, text]) => el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', text }));
    const paint = (): void =>
        btns.forEach((b, i) => {
            const on = values[key] === opts[i]![0];
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on || (values[key] !== true && values[key] !== false && i === 0) ? 0 : -1;
        });
    const pick = (idx: number, toggle: boolean): void => {
        const v = opts[idx]![0];
        values[key] = toggle && values[key] === v ? null : v;
        paint();
        setErr(f.id, '');
        kickStamp();
        refresh();
    };
    btns.forEach((b, idx) => {
        b.addEventListener('click', () => pick(idx, true));
        group.appendChild(b);
    });
    arrowNav(btns, (idx) => pick(idx, false));
    paint();
    group._paint = paint;
    return group;
}

/** Sube un archivo (o la firma) para una pregunta; devuelve su comprobante. */
function uploadBlob(key: string, blob: Blob, name: string): Promise<{ token: string; name: string }> {
    const fd = new FormData();
    fd.append('file', blob, name);
    return ensureStamp()
        .then(({ stamp }) =>
            fetch(`${API}/files?field=${encodeURIComponent(key)}`, { method: 'POST', body: fd, credentials: 'omit', headers: { 'X-Form-Stamp': stamp } }),
        )
        .then((r) => r.json().then((b: { message?: string; token?: string; name?: string }) => ({ ok: r.ok, b })))
        .then((res) => {
            if (!res.ok || !res.b.token) throw new Error(res.b?.message || 'No se pudo subir el archivo.');
            return { token: res.b.token, name: res.b.name || name };
        });
}

/**
 * Firma dibujada con el dedo o el mouse, sobre «papel» blanco (se ve igual en
 * modo oscuro y en el registro). Se guarda como PNG un momento después de
 * dejar de firmar: se sube como cualquier archivo de la pregunta.
 */
function signatureControl(f: FieldItem): Control {
    const key = f.key;
    uploads[key] = [];
    const canvas = el('canvas', { cls: 'ib-sign-canvas', id: 'q_' + f.id, role: 'img', 'aria-label': 'Espacio para firmar' });
    const hint = el('div', { cls: 'ib-sign-hint', text: 'Firma aquí con el dedo o el mouse' });
    const pad = el('div', { cls: 'ib-sign' }, [canvas, el('div', { cls: 'ib-sign-line', 'aria-hidden': 'true' }), hint]);
    const status = el('span', { cls: 'ib-sign-status', 'aria-live': 'polite' });
    const clear = el('button', { type: 'button', text: 'Borrar y volver a firmar', hidden: true });
    let ctx: CanvasRenderingContext2D | null = null;
    let drawing = false;
    let dirty = false;
    let last: { x: number; y: number } | null = null;
    let timer: number | undefined;
    let seq = 0;
    const fit = (): void => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#111827';
    };
    const point = (e: PointerEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const reset = (): void => {
        dirty = false;
        uploads[key] = [];
        values[key] = null;
        hint.hidden = false;
        clear.hidden = true;
        status.textContent = '';
        seq++;
        fit();
        refresh();
    };
    const save = (): void => {
        if (!dirty) return;
        values[key] = ['x'];
        if (BOOT.preview) {
            status.textContent = 'Firma lista';
            refresh();
            return;
        }
        const mine = ++seq;
        const u: Upload = { name: 'firma.png', pending: true };
        uploads[key] = [u];
        status.textContent = 'Guardando la firma…';
        refresh();
        canvas.toBlob((blob) => {
            if (!blob || mine !== seq) return;
            uploadBlob(key, blob, 'firma.png')
                .then((res) => {
                    if (mine !== seq) return;
                    u.pending = false;
                    u.token = res.token;
                    status.textContent = 'Firma lista ✓';
                    setErr(f.id, '');
                    refresh();
                })
                .catch((err: Error) => {
                    if (mine !== seq) return;
                    uploads[key] = [];
                    values[key] = null;
                    status.textContent = '';
                    setErr(f.id, err.message || 'No se pudo guardar la firma.');
                    refresh();
                });
        }, 'image/png');
    };
    canvas.addEventListener('pointerdown', (e) => {
        if (!ctx || canvas.width === 0 || (!dirty && Math.abs(canvas.getBoundingClientRect().width * Math.min(3, window.devicePixelRatio || 1) - canvas.width) > 2)) fit();
        if (!ctx) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        last = point(e);
        ctx.beginPath();
        ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = '#111827';
        ctx.fill();
        dirty = true;
        hint.hidden = true;
        clear.hidden = false;
        window.clearTimeout(timer);
        kickStamp();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!drawing || !ctx || !last) return;
        const p = point(e);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
    });
    const end = (): void => {
        if (!drawing) return;
        drawing = false;
        last = null;
        window.clearTimeout(timer);
        timer = window.setTimeout(save, 600);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    clear.addEventListener('click', reset);
    window.addEventListener('resize', () => {
        if (!dirty) fit();
    });
    requestAnimationFrame(fit);
    return el('div', { cls: 'ib-sign-box' }, [pad, el('div', { cls: 'ib-sign-bar' }, [status, clear])]);
}

/**
 * Ordenar opciones: se arrastran (con el dedo o el mouse) o se mueven con las
 * flechas. Hasta que se toca, no hay respuesta («Dejar este orden» la da).
 */
function rankingControl(f: FieldItem): Control {
    const key = f.key;
    const opts = f.ranking ?? [];
    const labelOf = new Map(opts.map((o) => [o.value, o.label]));
    let order = opts.map((o) => o.value);
    const list = el('ol', { cls: 'ib-rank ib-untouched', 'aria-labelledby': 'l_' + f.id });
    const keep = el('button', { type: 'button', cls: 'ib-rank-keep', text: 'Dejar este orden' });
    const commit = (): void => {
        values[key] = [...order];
        list.classList.remove('ib-untouched');
        keep.hidden = true;
        setErr(f.id, '');
        kickStamp();
        refresh();
    };
    const draw = (focus?: { value: string; dir: 'up' | 'down' }): void => {
        list.textContent = '';
        order.forEach((v, idx) => {
            const up = el('button', { type: 'button', 'aria-label': `Subir «${labelOf.get(v) ?? v}»`, text: '↑', disabled: idx === 0 });
            const down = el('button', { type: 'button', 'aria-label': `Bajar «${labelOf.get(v) ?? v}»`, text: '↓', disabled: idx === order.length - 1 });
            const move = (delta: number, dir: 'up' | 'down'): void => {
                const to = idx + delta;
                if (to < 0 || to >= order.length) return;
                const next = [...order];
                [next[idx], next[to]] = [next[to]!, next[idx]!];
                order = next;
                draw({ value: v, dir });
                commit();
            };
            up.addEventListener('click', () => move(-1, 'up'));
            down.addEventListener('click', () => move(1, 'down'));
            const grip = el('span', { cls: 'ib-rank-grip', 'aria-hidden': 'true', text: '⋮⋮' });
            const li = el('li', { 'data-value': v }, [
                grip,
                el('span', { cls: 'ib-rank-n', text: String(idx + 1) }),
                el('span', { cls: 'ib-rank-label', text: labelOf.get(v) ?? v }),
                el('span', { cls: 'ib-rank-move' }, [up, down]),
            ]);
            // Arrastrar: el renglón sigue al dedo y los demás se reacomodan.
            grip.addEventListener('pointerdown', (e) => startDrag(e, li, v));
            li.querySelector('.ib-rank-label')!.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, li, v));
            list.appendChild(li);
            if (focus && focus.value === v) {
                const btn = focus.dir === 'up' ? (idx === 0 ? down : up) : idx === order.length - 1 ? up : down;
                btn.focus();
            }
        });
        reportHeight();
    };
    const startDrag = (e: PointerEvent, li: HTMLElement, value: string): void => {
        if (e.button !== 0) return;
        e.preventDefault();
        li.setPointerCapture(e.pointerId);
        li.classList.add('ib-dragging');
        let moved = false;
        const onMove = (ev: PointerEvent): void => {
            const items = Array.from(list.children) as HTMLElement[];
            const from = order.indexOf(value);
            let to = from;
            items.forEach((node, idx) => {
                const r = node.getBoundingClientRect();
                if (ev.clientY > r.top + r.height / 2) to = idx >= from ? idx : idx + 1;
            });
            to = Math.max(0, Math.min(order.length - 1, ev.clientY < (items[0]?.getBoundingClientRect().top ?? 0) ? 0 : to));
            if (to !== from) {
                const next = order.filter((x) => x !== value);
                next.splice(to, 0, value);
                order = next;
                moved = true;
                const ref = (Array.from(list.children) as HTMLElement[]).filter((n) => n !== li)[to] ?? null;
                list.insertBefore(li, ref);
                (Array.from(list.children) as HTMLElement[]).forEach((n, i) => {
                    const num = n.querySelector('.ib-rank-n');
                    if (num) num.textContent = String(i + 1);
                });
            }
        };
        const onUp = (): void => {
            li.removeEventListener('pointermove', onMove);
            li.removeEventListener('pointerup', onUp);
            li.removeEventListener('pointercancel', onUp);
            li.classList.remove('ib-dragging');
            if (moved) {
                draw();
                commit();
            }
        };
        li.addEventListener('pointermove', onMove);
        li.addEventListener('pointerup', onUp);
        li.addEventListener('pointercancel', onUp);
    };
    keep.addEventListener('click', commit);
    draw();
    const box: Control = el('div', { cls: 'ib-rank-box' }, [
        el('p', { cls: 'ib-help', text: 'Arrastra o usa las flechas: lo primero es lo más importante.' }),
        list,
        keep,
    ]);
    box._paint = () => {
        const v = values[key];
        if (Array.isArray(v) && v.length === order.length) {
            order = v.map(String);
            list.classList.remove('ib-untouched');
            keep.hidden = true;
            draw();
        }
    };
    return box;
}

/** Sin tildes ni mayúsculas, para buscar. */
function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Lista con buscador (una opción o varias), para listas largas de opciones. */
function searchControl(f: FieldItem): Control {
    const key = f.key;
    const multiple = !!f.multiple;
    const opts = f.options ?? [];
    const listId = 'lb_' + f.id;
    const input = el('input', {
        type: 'text',
        id: 'q_' + f.id,
        cls: 'ib-input',
        role: 'combobox',
        'aria-expanded': 'false',
        'aria-controls': listId,
        'aria-autocomplete': 'list',
        autocomplete: 'off',
        placeholder: f.placeholder || (multiple ? 'Escribe para buscar y elegir…' : 'Escribe para buscar…'),
    });
    const list = el('ul', { cls: 'ib-combo-list', id: listId, role: 'listbox', hidden: true, 'aria-multiselectable': multiple ? 'true' : null });
    const chips = el('div', { cls: 'ib-chips', hidden: true });
    let shown: typeof opts = [];
    let active = -1;
    const selected = (): string[] => {
        const v = values[key];
        return multiple ? (Array.isArray(v) ? v.map(String) : []) : typeof v === 'string' && v ? [v] : [];
    };
    const labelOf = (v: string): string => opts.find((o) => o.value === v)?.label ?? v;
    const paintChips = (): void => {
        chips.textContent = '';
        const sel = selected();
        chips.hidden = !multiple || sel.length === 0;
        for (const v of sel) {
            const x = el('button', { type: 'button', 'aria-label': `Quitar «${labelOf(v)}»`, text: '×' });
            x.addEventListener('click', () => {
                values[key] = selected().filter((s) => s !== v);
                paintChips();
                setErr(f.id, '');
                refresh();
            });
            chips.appendChild(el('span', { cls: 'ib-chip' }, [el('span', { text: labelOf(v) }), x]));
        }
    };
    const setActive = (idx: number): void => {
        active = idx;
        Array.from(list.children).forEach((li, i) => li.setAttribute('aria-selected', String(i === idx)));
        const node = list.children[idx] as HTMLElement | undefined;
        if (node) {
            input.setAttribute('aria-activedescendant', node.id);
            node.scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
    };
    const close = (): void => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
        reportHeight();
    };
    const open = (): void => {
        const q = fold(input.value.trim());
        const sel = selected();
        // Con una opción elegida y su nombre escrito, se ven todas otra vez.
        const typed = !multiple && sel.length === 1 && input.value === labelOf(sel[0]!) ? '' : q;
        shown = opts.filter((o) => !typed || fold(o.label).includes(typed)).slice(0, 80);
        list.textContent = '';
        if (shown.length === 0) list.appendChild(el('li', { cls: 'ib-combo-empty', role: 'presentation', text: 'No hay opciones con ese nombre.' }));
        shown.forEach((o, i) => {
            const li = el('li', { id: `${listId}_${i}`, role: 'option', 'aria-selected': 'false', cls: sel.includes(o.value) ? 'ib-chosen' : '', text: o.label });
            li.addEventListener('mousedown', (e) => e.preventDefault());
            li.addEventListener('click', () => choose(o.value));
            list.appendChild(li);
        });
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
        reportHeight();
    };
    const choose = (v: string): void => {
        if (multiple) {
            const sel = selected();
            values[key] = sel.includes(v) ? sel.filter((s) => s !== v) : [...sel, v];
            input.value = '';
            paintChips();
            open();
        } else {
            values[key] = v;
            input.value = labelOf(v);
            close();
        }
        setErr(f.id, '');
        kickStamp();
        refresh();
    };
    input.addEventListener('focus', open);
    input.addEventListener('input', () => {
        if (!multiple && input.value.trim() === '') values[key] = null;
        open();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.hidden) open();
            const n = shown.length;
            if (!n) return;
            setActive(e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
        } else if (e.key === 'Enter') {
            if (!list.hidden && active >= 0 && shown[active]) {
                e.preventDefault();
                choose(shown[active]!.value);
            }
        } else if (e.key === 'Escape') {
            if (!list.hidden) {
                e.preventDefault();
                close();
            }
        }
    });
    input.addEventListener('blur', () => {
        window.setTimeout(() => {
            close();
            // Una opción a medio escribir no queda: vuelve el nombre de la elegida.
            if (!multiple) {
                const sel = selected();
                input.value = sel.length ? labelOf(sel[0]!) : '';
            } else input.value = '';
        }, 120);
    });
    const box: Control = el('div', { cls: 'ib-combo' }, [chips, input, list]);
    box._paint = () => {
        const sel = selected();
        if (!multiple) input.value = sel.length ? labelOf(sel[0]!) : '';
        paintChips();
    };
    return box;
}

/** «Otro»: al elegir esa opción aparece un campo para escribir cuál. */
function withOther(f: FieldItem, ctl: Control): Control {
    if (!f.other) return ctl;
    const o = f.other;
    const input = el('input', { type: 'text', cls: 'ib-input', id: `q_${f.id}_otro`, placeholder: o.placeholder, 'aria-label': o.placeholder, maxlength: 500 });
    input.addEventListener('input', () => {
        values[o.key] = input.value;
        setErr(f.id, '');
    });
    const wrap = el('div', { cls: 'ib-other', hidden: true }, [input]);
    otherEls[f.id] = { wrap, input };
    const box: Control = el('div', { cls: 'ib-with-other' }, [ctl, wrap]);
    box._paint = () => ctl._paint?.();
    return box;
}

/** Matriz: una fila por campo, una columna por respuesta (en el celular, cada fila en su tarjeta). */
function matrixNode(i: MatrixItem): HTMLElement {
    const node = el('div', { cls: 'ib-item ib-matrix-item' });
    const label = el('div', { cls: 'ib-label', id: 'l_' + i.id });
    label.appendChild(recallText(i.label || 'Responde cada fila'));
    if (i.required) label.appendChild(el('span', { cls: 'ib-req', text: '*', 'aria-hidden': 'true' }));
    node.appendChild(label);
    if (i.help) {
        const h = el('div', { cls: 'ib-help' });
        setRecall(h, i.help);
        node.appendChild(h);
    }
    const table = el('table', { cls: 'ib-matrix', 'aria-labelledby': 'l_' + i.id });
    const headRow = el('tr', null, [el('td', { 'aria-hidden': 'true' })]);
    i.columns.forEach((c) => headRow.appendChild(el('th', { scope: 'col', text: c.label })));
    table.appendChild(el('thead', null, [headRow]));
    const body = el('tbody');
    const cells: Array<{ row: MatrixItem['rows'][number]; value: string | number; input: HTMLInputElement; cell: HTMLElement }> = [];
    const sync = (): void =>
        cells.forEach((c) => {
            const v = values[c.row.key];
            const on = Array.isArray(v) ? v.map(String).includes(String(c.value)) : String(v ?? '') === String(c.value);
            c.input.checked = on;
            c.cell.classList.toggle('ib-checked', on);
        });
    i.rows.forEach((row, ri) => {
        const tr = el('tr', null, [el('th', { scope: 'row', text: row.label })]);
        row.values.forEach((value, ci) => {
            const td = el('td');
            if (value === null) {
                td.setAttribute('aria-hidden', 'true');
                tr.appendChild(td);
                return;
            }
            const col = i.columns[ci]?.label ?? String(value);
            const input = el('input', { type: i.multiple ? 'checkbox' : 'radio', name: `m_${i.id}_${ri}`, value: String(value), 'aria-label': `${row.label}: ${col}` });
            const cell = el('label', { cls: 'ib-matrix-cell', 'data-col': col }, [input]);
            input.addEventListener('change', () => {
                if (i.multiple) {
                    const cur = Array.isArray(values[row.key]) ? [...(values[row.key] as Array<string | number>)] : [];
                    const has = cur.map(String).includes(String(value));
                    values[row.key] = input.checked ? (has ? cur : [...cur, value]) : cur.filter((x) => String(x) !== String(value));
                } else values[row.key] = value;
                sync();
                setErr(i.id, '');
                kickStamp();
                refresh();
            });
            cells.push({ row, value, input, cell });
            td.appendChild(cell);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
    table.appendChild(body);
    node.appendChild(el('div', { cls: 'ib-matrix-scroll' }, [table]));
    const err = el('div', { cls: 'ib-error', role: 'alert', hidden: true });
    errEls[i.id] = err;
    node.appendChild(err);
    (node as Control)._paint = sync;
    return node;
}

function choices(f: FieldItem, multiple: boolean): Control {
    const key = f.key;
    const id = 'q_' + f.id;
    const style = f.choice_style ?? view()?.choice_style ?? 'list';
    const cols = style === 'buttons' ? 1 : Math.max(1, Math.min(4, f.columns ?? view()?.choice_columns ?? 1));
    const group: Control = el('div', {
        cls: `ib-choices ib-choices-${style}${cols > 1 ? ` ib-cols-${cols}` : ''}`,
        role: multiple ? 'group' : 'radiogroup',
        'aria-labelledby': 'l_' + f.id,
    });
    const labels: HTMLLabelElement[] = [];
    const inputs: HTMLInputElement[] = [];
    const sync = (): void => labels.forEach((l, i) => l.classList.toggle('ib-checked', inputs[i]!.checked));
    (f.options ?? []).forEach((o, idx) => {
        const inp = el('input', { type: multiple ? 'checkbox' : 'radio', name: id, value: o.value, id: `${id}_${idx}`, cls: 'ib-choice-input' });
        inp.addEventListener('change', () => {
            if (multiple) {
                let cur = Array.isArray(values[key]) ? [...(values[key] as string[])] : [];
                if (inp.checked) {
                    if (!cur.includes(o.value)) cur.push(o.value);
                } else cur = cur.filter((v) => v !== o.value);
                values[key] = cur;
            } else values[key] = o.value;
            sync();
            setErr(f.id, '');
            refresh();
        });
        const img =
            style === 'cards' && o.image_url
                ? el('span', { cls: 'ib-choice-img' }, [el('img', { src: o.image_url, alt: '', loading: 'lazy', decoding: 'async' })])
                : null;
        const lab = el('label', { cls: 'ib-choice', for: `${id}_${idx}` }, [inp, img, el('span', { cls: 'ib-choice-label', text: o.label })]);
        labels.push(lab);
        inputs.push(inp);
        group.appendChild(lab);
    });
    group._paint = sync;
    return group;
}

function filesControl(f: FieldItem, id: string): Control {
    const key = f.key;
    const cfg = f.config || {};
    const maxFiles = Math.max(1, Math.min(10, cfg.max_files || 10));
    uploads[key] = [];
    const picker = el('input', { type: 'file', id, multiple: maxFiles > 1, hidden: true, accept: cfg.accept || null });
    const drop = el('div', { cls: 'ib-drop', role: 'button', tabindex: '0', text: `Elige ${maxFiles > 1 ? 'archivos' : 'un archivo'} para subir` });
    const mb = Math.max(1, Math.round((meta?.max_upload_bytes ?? 0) / (1024 * 1024)));
    const limits = el('p', {
        cls: 'ib-help',
        text: `${maxFiles > 1 ? `Hasta ${maxFiles} archivos` : 'Un archivo'} de hasta ${mb} MB${cfg.accept_label ? ` · ${cfg.accept_label}` : ''}.`,
    });
    const ul = el('ul');
    const render = (): void => {
        ul.textContent = '';
        (uploads[key] ?? []).forEach((u, idx) => {
            const rm = el('button', { type: 'button', text: u.pending ? 'Subiendo…' : 'Quitar', disabled: u.pending });
            rm.addEventListener('click', () => {
                uploads[key]!.splice(idx, 1);
                render();
            });
            ul.appendChild(el('li', null, [el('span', { text: u.name }), rm]));
        });
        values[key] = (uploads[key] ?? []).filter((u) => !u.pending).length ? ['x'] : null;
        refresh();
    };
    const open = (): void => {
        if (!BOOT.preview) picker.click();
    };
    drop.addEventListener('click', open);
    drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
        }
    });
    picker.addEventListener('change', () => {
        const chosen = Array.from(picker.files ?? []);
        picker.value = '';
        for (const file of chosen.slice(0, Math.max(0, maxFiles - (uploads[key]?.length ?? 0)))) {
            if (file.size > (meta?.max_upload_bytes ?? 0)) {
                setErr(f.id, `El archivo «${file.name}» es demasiado grande.`);
                continue;
            }
            const u: Upload = { name: file.name, pending: true };
            uploads[key]!.push(u);
            render();
            uploadBlob(key, file, file.name)
                .then((res) => {
                    u.pending = false;
                    u.token = res.token;
                    u.name = res.name || u.name;
                    render();
                    setErr(f.id, '');
                })
                .catch((err: Error) => {
                    uploads[key] = (uploads[key] ?? []).filter((x) => x !== u);
                    render();
                    setErr(f.id, err.message || 'No se pudo subir el archivo.');
                });
        }
    });
    return el('div', { cls: 'ib-files' }, [drop, limits, picker, ul]);
}

function prefill(controls: Record<string, Control>): void {
    if (!meta?.allow_prefill || BOOT.preview) return;
    const params = new URLSearchParams(location.search);
    for (const f of fields()) {
        if (!params.has(f.slug)) continue;
        const raw = params.get(f.slug) ?? '';
        const c = controls[f.id];
        // v0.1.355 — las formas propias se completan por su valor.
        if (f.display === 'yes_no') {
            values[f.key] = /^(1|true|si|sí|yes)$/i.test(raw) ? true : /^(0|false|no)$/i.test(raw) ? false : null;
            c?._paint?.();
            continue;
        }
        if (f.display === 'scale' || f.display === 'slider') {
            const n = parseNumber(raw);
            values[f.key] = n !== null && !Number.isNaN(n) ? n : null;
            c?._paint?.();
            continue;
        }
        if (f.display === 'ranking' || f.display === 'signature') continue;
        const kind = f.field_type === 'team' ? (f.multiple ? 'multi_select' : 'select') : f.field_type;
        switch (kind) {
            case 'multi_select': {
                const vals = raw
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                values[f.key] = vals;
                c?.querySelectorAll('input').forEach((i) => (i.checked = vals.includes(i.value)));
                c?._paint?.();
                break;
            }
            case 'checkbox': {
                const on = /^(1|true|si|sí|yes)$/i.test(raw);
                values[f.key] = on;
                const cb = c?.querySelector('input');
                if (cb) cb.checked = on;
                break;
            }
            case 'select': {
                values[f.key] = raw;
                const sel = c instanceof HTMLSelectElement ? c : c?.querySelector('select');
                if (sel) sel.value = raw;
                else c?.querySelectorAll('input').forEach((i) => (i.checked = i.value === raw));
                (c as Control | undefined)?._paint?.();
                break;
            }
            case 'rating':
                values[f.key] = Number(raw) || null;
                c?._paint?.();
                break;
            case 'file':
                break;
            case 'number':
            case 'currency':
            case 'percent': {
                values[f.key] = parseNumber(raw);
                const inp = c instanceof HTMLInputElement ? c : c?.querySelector('input');
                if (inp) inp.value = raw;
                break;
            }
            default:
                values[f.key] = raw;
                if (c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement) c.value = raw;
        }
    }
    // v0.1.355 — una fila de una matriz, por su campo: `?atencion=bueno`.
    for (const m of (meta.items ?? []).filter((i): i is MatrixItem => i.type === 'matrix')) {
        for (const row of m.rows) {
            if (!params.has(row.slug)) continue;
            const raw = (params.get(row.slug) ?? '').trim().toLowerCase();
            const pick = (txt: string): string | number | null => {
                const idx = row.values.findIndex((v, ci) => v !== null && (String(v).toLowerCase() === txt || (m.columns[ci]?.label ?? '').toLowerCase() === txt));
                return idx >= 0 ? row.values[idx]! : null;
            };
            if (m.multiple) values[row.key] = raw.split(',').map((t) => pick(t.trim())).filter((v) => v !== null);
            else values[row.key] = pick(raw);
        }
        controls[m.id]?._paint?.();
    }
}

// ───────────────────────────── Ítems ─────────────────────────────

function pvTag(text: string): HTMLElement {
    return el('span', { cls: 'ib-pv-tag', text });
}

function previewable(node: HTMLElement, id: string): void {
    if (!BOOT.preview) return;
    node.classList.add('ib-pv-item');
    if (id === selectedId) node.classList.add('ib-selected');
    node.addEventListener(
        'click',
        (e) => {
            e.preventDefault();
            parent.postMessage({ type: 'imb-form-select', id }, location.origin);
        },
        true,
    );
}

function fieldNode(i: FieldItem, controls: Record<string, Control>): HTMLElement {
    const float = view()?.label_position === 'floating' && FLOAT_TYPES.has(i.field_type) && !i.hide_label;
    const c = control(i, float);
    controls[i.id] = c;
    const node = el('div', { cls: `ib-item ib-field ib-type-${i.field_type} ib-show-${i.display} ib-w-${i.width ?? 'full'}${float ? ' ib-float' : ''}` });
    const err = el('div', { cls: 'ib-error', role: 'alert', hidden: true });
    errEls[i.id] = err;
    let label: HTMLElement | null = null;
    if (i.field_type !== 'checkbox' || i.display === 'yes_no') {
        const own = i.display === 'scale' || i.display === 'yes_no' || i.display === 'ranking' || i.display === 'signature';
        const labelFor = i.display === 'search' || i.display === 'slider';
        const isGroup =
            own ||
            (!labelFor &&
                ((i.field_type === 'select' && i.display !== 'dropdown') ||
                    i.field_type === 'multi_select' ||
                    i.field_type === 'rating' ||
                    (i.field_type === 'team' && i.display !== 'dropdown')));
        label = isGroup ? el('div', { cls: 'ib-label', id: 'l_' + i.id }) : el('label', { cls: 'ib-label', for: 'q_' + i.id, id: 'l_' + i.id });
        label.appendChild(recallText(i.label));
        if (i.required) label.appendChild(el('span', { cls: 'ib-req', text: '*', 'aria-hidden': 'true' }));
        if (i.hide_label) label.classList.add('ib-sr');
    }
    const help = i.help ? el('div', { cls: 'ib-help' }) : null;
    if (help) setRecall(help, i.help);
    if (float && label) {
        node.appendChild(el('div', { cls: 'ib-control' }, [c, label]));
        if (help) node.appendChild(help);
    } else {
        if (label) node.appendChild(label);
        if (help) node.appendChild(help);
        node.appendChild(el('div', { cls: 'ib-control' }, [c]));
    }
    node.appendChild(err);
    if (BOOT.preview && i.hidden) {
        node.style.opacity = '.55';
        node.insertBefore(pvTag('Oculta · se completa desde la dirección'), node.firstChild);
    }
    return node;
}

function imageNode(i: ImageItem): HTMLElement {
    const node = el('figure', { cls: `ib-item ib-image ib-w-${i.width}` });
    if (i.url) {
        const img = el('img', { src: i.url, alt: i.alt || '', loading: 'lazy', decoding: 'async' });
        if (i.max_height) img.style.maxHeight = `${i.max_height}px`;
        node.appendChild(img);
    } else if (BOOT.preview) {
        node.appendChild(el('div', { cls: 'ib-pv-empty', text: 'Elige una imagen en el panel de la derecha.' }));
    }
    if (i.caption) {
        const cap = el('figcaption');
        setRecall(cap, i.caption);
        node.appendChild(cap);
    }
    return node;
}

function itemNode(i: Item, controls: Record<string, Control>): HTMLElement {
    let node: HTMLElement;
    if (i.type === 'heading') {
        node = el('div', { cls: 'ib-item ib-heading' });
        setRecall(node, i.text);
    }
    else if (i.type === 'text') {
        node = paragraphs(i.text, 'ib-item ib-text');
    } else if (i.type === 'image') node = imageNode(i);
    else if (i.type === 'matrix') {
        node = matrixNode(i);
        controls[i.id] = node as Control;
    } else node = fieldNode(i as FieldItem, controls);
    if (BOOT.preview && i.show_if) node.insertBefore(pvTag('Condicional · sólo aparece si se cumple su condición'), node.firstChild);
    previewable(node, i.id);
    itemEls[i.id] = node;
    return node;
}

// ───────────────────────────── Pantalla ─────────────────────────────

function refresh(): void {
    dirty();
    paintRecall();
    for (const i of meta?.items ?? []) {
        const n = itemEls[i.id];
        if (!n) continue;
        // En la vista previa se ve todo (atenuado lo condicional y lo oculto).
        n.hidden = BOOT.preview ? false : i.type === 'field' && i.hidden ? true : !visible(i);
        // v0.1.355 — el «Otro» aparece al elegir esa opción.
        if (i.type === 'field' && i.other && otherEls[i.id]) {
            const { wrap, input } = otherEls[i.id]!;
            const on = choseOther(i);
            const opened = on && wrap.hidden;
            wrap.hidden = !on;
            if (opened && !BOOT.preview) input.focus();
        }
    }
    if (paged()) paintPages();
    reportHeight();
}

function paintPages(): void {
    const vis = visiblePages();
    // La página actual dejó de aplicar (cambió una respuesta anterior): a la siguiente que sí.
    if (vis.length && !vis.includes(current)) {
        const next = vis.filter((i) => i > current)[0];
        current = next ?? vis[vis.length - 1]!;
    }
    pageEls.forEach((n, idx) => (n.hidden = idx !== current));
    const pos = Math.max(0, vis.indexOf(current)) + 1;
    const total = Math.max(1, vis.length);
    if (stepsLabel) stepsLabel.textContent = conversational() ? `Pregunta ${pos} de ${total}` : `Paso ${pos} de ${total}`;
    if (barEl) barEl.style.width = `${Math.round((pos / total) * 100)}%`;
    if (dotsEl) {
        dotsEl.textContent = '';
        for (let k = 1; k <= total; k++) dotsEl.appendChild(el('span', { cls: k <= pos ? 'ib-on' : '' }));
    }
    const last = isLastPage();
    if (prevBtn) prevBtn.hidden = pos <= 1;
    if (nextBtn) nextBtn.hidden = last;
    if (submitBtn) submitBtn.hidden = !last;
    if (captchaBox) captchaBox.hidden = !last;
    if (consentBox) consentBox.hidden = !last;
    if (last) mountCaptcha();
}

function goToPage(idx: number, focus = true): void {
    current = idx;
    paintPages();
    if (alertBox) alertBox.hidden = true;
    if (focus) {
        const target = stepsLabel?.parentElement?.parentElement ?? root;
        try {
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
            target?.scrollIntoView();
        }
        focusCurrent();
    }
    reportHeight();
}

/**
 * Lleva el foco a lo que se está viendo: el «Paso 2 de 3» (lo anuncian los
 * lectores de pantalla) o el título de la página. v0.1.357 — con una
 * pregunta por pantalla, en una compu, directo a la respuesta (en el celular
 * no: abriría el teclado sin que la persona lo pida).
 */
function focusCurrent(): void {
    const box = pageEls[current];
    const answer =
        conversational() && matchMedia('(hover: hover) and (pointer: fine)').matches
            ? box?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select')
            : null;
    const title = box?.querySelector<HTMLElement>('.ib-page-title');
    (answer ?? stepsLabel ?? title)?.focus({ preventScroll: true });
}

function primaryButton(text: string, type: 'submit' | 'button'): HTMLButtonElement {
    const b = el('button', { type, cls: 'ib-btn ib-btn-primary' });
    b.appendChild(document.createTextNode(text));
    const ic = icon(view()?.button_icon ?? 'none');
    if (ic) b.appendChild(ic);
    return b;
}

function shell(): HTMLElement {
    const v = view();
    const card = el('div', { cls: 'ib-card' });
    if (v?.cover) card.appendChild(el('div', { cls: 'ib-cover', role: 'presentation' }));
    else if (v?.band ?? true) card.appendChild(el('div', { cls: 'ib-band' }));
    root = el('div', { cls: 'ib-inner', id: 'root' });
    card.appendChild(root);
    const main = el('main', { cls: 'ib-wrap' }, [card]);
    const kids: HTMLElement[] = [];
    if (v?.split) {
        const media = el('aside', { cls: 'ib-split-media', 'aria-hidden': v.split.headline ? null : 'true' });
        if (v.split.headline) media.appendChild(el('div', { cls: 'ib-split-headline', text: v.split.headline }));
        kids.push(media);
    }
    kids.push(main);
    return el('div', { cls: 'ib-shell' }, kids);
}

function applyBodyClasses(): void {
    const v = view();
    const cls = ['ib-body', ...(v?.classes ?? [])];
    if (meta?.layout === 'conversational') cls.push('ib-layout-conv');
    if (embedded && !BOOT.preview) cls.push('ib-embedded');
    if (embedded && !BOOT.preview && v?.embed_background) cls.push('ib-embed-bg');
    document.body.className = cls.join(' ');
}

/** v0.1.357 — La bienvenida: imagen, título, mensaje, cuánto toma y «Empezar». */
function welcomeNode(w: NonNullable<PublicFormMeta['welcome']>): HTMLElement {
    const kids: HTMLElement[] = [];
    if (w.image_url) kids.push(el('div', { cls: 'ib-welcome-img' }, [el('img', { src: w.image_url, alt: '', decoding: 'async', fetchpriority: 'high' })]));
    if (w.title) {
        const h = el('h2');
        setRecall(h, w.title);
        kids.push(h);
    }
    if (w.message) kids.push(paragraphs(w.message, 'ib-welcome-msg'));
    if (w.minutes) kids.push(el('div', { cls: 'ib-welcome-time', text: w.minutes === 1 ? '⏱ Toma 1 minuto' : `⏱ Toma unos ${w.minutes} minutos` }));
    const btn = primaryButton(w.button_label || 'Empezar', 'button');
    btn.setAttribute('data-testid', 'form-welcome-start');
    btn.addEventListener('click', () => {
        if (BOOT.preview) return;
        started = true;
        render(false);
        try {
            root?.scrollIntoView({ block: 'start' });
        } catch {
            // nada
        }
        focusCurrent();
        reportHeight();
    });
    kids.push(btn);
    const box = el('div', { cls: 'ib-welcome', 'data-testid': 'form-welcome' }, kids);
    if (BOOT.preview) box.insertBefore(pvTag('Bienvenida · lo primero que ve la persona'), box.firstChild);
    return box;
}

function header(): HTMLElement {
    const m = meta!;
    const box = el('header', { cls: 'ib-header' });
    if (m.logo_url) box.appendChild(el('div', { cls: 'ib-logo' }, [el('img', { src: m.logo_url, alt: m.company || 'Logo', decoding: 'async', fetchpriority: 'high' })]));
    const h1 = el('h1', { cls: 'ib-title' });
    setRecall(h1, m.title);
    box.appendChild(h1);
    if (m.description) box.appendChild(paragraphs(m.description, 'ib-desc'));
    return box;
}

function render(keepPage: boolean): void {
    itemEls = {};
    recallNodes = [];
    dirty();
    errEls = {};
    otherEls = {};
    pageEls = [];
    stepsLabel = barEl = dotsEl = null;
    prevBtn = nextBtn = submitBtn = null;
    captchaBox = alertBox = null;
    consentCb = null;
    consentBox = null;
    captchaMounted = false;
    captchaWidget = null;
    captchaToken = null;
    applyBodyClasses();
    app.textContent = '';
    app.appendChild(shell());
    const r = root!;
    if (!meta) {
        r.appendChild(el('div', { cls: 'ib-pv-empty', text: 'Cargando vista previa…' }));
        return;
    }
    if (!BOOT.preview) document.title = meta.title;
    r.appendChild(header());

    if (meta.closed && !BOOT.preview) {
        r.appendChild(el('div', { cls: 'ib-closed', text: meta.closed }));
        return;
    }

    // v0.1.357 — la bienvenida: lo primero que ve, con «Empezar». Las
    // respuestas que llegan en la dirección ya cuentan (su texto puede decir
    // «Hola, {{nombre}}»).
    const w = meta.welcome;
    if (w && (BOOT.preview ? previewWelcome : !started)) {
        prefill({});
        r.appendChild(welcomeNode(w));
        if (w.title) r.classList.add('ib-welcome-hide');
        return;
    }

    pages = buildUnits(meta.items);
    if (!keepPage || current >= pages.length) current = 0;

    const form = el('form', { cls: 'ib-form', novalidate: true });
    const controls: Record<string, Control> = {};
    const progress = view()?.progress ?? 'bar';
    if (paged() && progress !== 'none') {
        stepsLabel = el('strong', { tabindex: '-1' });
        const top = el('div', { cls: 'ib-steps-top' }, [stepsLabel]);
        if (progress === 'steps' && !(conversational() && pages.length > 12)) {
            dotsEl = el('div', { cls: 'ib-dots', role: 'presentation' });
            form.appendChild(el('div', { cls: 'ib-steps', 'aria-live': 'polite' }, [top, dotsEl]));
        } else {
            barEl = el('span');
            form.appendChild(el('div', { cls: 'ib-steps', 'aria-live': 'polite' }, [top, el('div', { cls: 'ib-progress', role: 'presentation' }, [barEl])]));
        }
    }
    pages.forEach((p) => {
        const box = el('div', { cls: 'ib-page' });
        if (paged() && p.first && (p.title || (BOOT.preview && p.break_id))) {
            const t = p.title ? el('h2', { cls: 'ib-page-title' }) : pvTag(`Página ${p.page + 1} · sin título`);
            if (p.title) setRecall(t, p.title);
            if (p.break_id) previewable(t, p.break_id);
            box.appendChild(t);
        }
        const grid = el('div', { cls: 'ib-grid' });
        for (const i of p.items) grid.appendChild(itemNode(i, controls));
        if (BOOT.preview && !p.items.length && !meta!.items.length) grid.appendChild(el('div', { cls: 'ib-item ib-pv-empty', text: 'Agrega preguntas desde el panel de la izquierda.' }));
        box.appendChild(grid);
        pageEls.push(box);
        form.appendChild(box);
    });

    const hp = el('div', { cls: 'ib-hp', 'aria-hidden': 'true' }, [el('label', { text: 'No completar' }), el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' })]);
    form.appendChild(hp);
    if (meta.captcha) {
        if (BOOT.preview) {
            const names: Record<string, string> = { turnstile: 'Cloudflare Turnstile', hcaptcha: 'hCaptcha', recaptcha: 'Google reCAPTCHA' };
            form.appendChild(el('div', { cls: 'ib-captcha-ph', text: `Aquí aparece la verificación anti-robots (${names[meta.captcha.provider] ?? meta.captcha.provider}).` }));
        } else {
            captchaBox = el('div', { cls: 'ib-captcha', 'data-provider': meta.captcha.provider });
            form.appendChild(captchaBox);
        }
    }
    if (meta.data_consent) form.appendChild(consentNode(meta.data_consent));
    alertBox = el('div', { cls: 'ib-alert', role: 'alert', hidden: true });
    form.appendChild(alertBox);
    submitBtn = primaryButton(meta.submit_label || 'Enviar', 'submit');
    if (paged()) {
        prevBtn = el('button', { type: 'button', cls: 'ib-btn ib-btn-secondary', text: 'Anterior' });
        nextBtn = primaryButton('Siguiente', 'button');
        prevBtn.addEventListener('click', () => {
            const before = visiblePages().filter((i) => i < current);
            if (before.length) goToPage(before[before.length - 1]!);
        });
        nextBtn.addEventListener('click', () => advance());
        // v0.1.357 — una pregunta por pantalla: Enter también sigue.
        const hint = conversational() ? el('span', { cls: 'ib-conv-hint', text: 'o pulsa Enter ↵', 'aria-hidden': 'true' }) : null;
        form.appendChild(el('div', { cls: 'ib-actions ib-paged' }, [prevBtn, el('span', { cls: 'ib-grow' }), hint, nextBtn, submitBtn]));
    } else {
        form.appendChild(el('div', { cls: 'ib-actions' }, [submitBtn]));
    }
    r.appendChild(form);
    prefill(controls);
    refresh();
    if (!paged() && meta.captcha && !BOOT.preview) mountCaptcha();

    function advance(): void {
        if (!BOOT.preview) {
            alertBox!.hidden = true;
            if (validate(pages[current]!.items)) {
                focusFirstError();
                return;
            }
        }
        const after = visiblePages().filter((i) => i > current);
        if (after.length) goToPage(after[0]!);
    }

    // v0.1.357 — una pregunta por pantalla: elegir una opción de una
    // selección, una escala o Sí/No pasa sola a la siguiente (como al tocar
    // «Siguiente»). Con el teclado (flechas) no: ahí se confirma con Enter.
    if (conversational() && paged() && !BOOT.preview) {
        form.addEventListener('click', (e) => {
            const unit = pages[current];
            const box = pageEls[current];
            if (!unit || !box || !(e.target instanceof Node) || !box.contains(e.target)) return;
            const q = unit.items.find(isQuestion);
            if (!q || q.type !== 'field' || !autoAdvances(q)) return;
            if (!(e.target as Element).closest?.('.ib-choice,.ib-scale button,.ib-yesno button,.ib-stars button')) return;
            const at = current;
            setTimeout(() => {
                if (current !== at || isLastPage() || empty(values[q.key]) || choseOther(q)) return;
                advance();
            }, 380);
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        // Enter en una página que no es la última = «Siguiente».
        if (paged() && !isLastPage()) {
            advance();
            return;
        }
        if (BOOT.preview || !meta) return;
        submit(hp.querySelector('input')!.value);
    });
}

function submit(hpValue: string): void {
    const m = meta!;
    clearErrs();
    alertBox!.hidden = true;
    const badConsent = !!(m.data_consent && consentCb && !consentCb.checked);
    if (badConsent) setErr(CONSENT, 'Para enviar, acepta la autorización para el tratamiento de tus datos personales.');
    if (validate(m.items) || badConsent) {
        const firstBad = m.items.find((i) => itemEls[i.id]?.classList.contains('ib-invalid'));
        if (firstBad && paged()) goToPage(pageOfItem(firstBad.id), false);
        focusFirstError();
        return;
    }
    if (m.captcha && !captchaToken) {
        alertBox!.textContent = 'Completa la verificación para enviar.';
        alertBox!.hidden = false;
        return;
    }
    const outValues: Record<string, unknown> = {};
    const outUploads: Record<string, string[]> = {};
    for (const i of m.items) {
        if (i.type === 'matrix') {
            for (const r of i.rows) if (values[r.key] !== undefined) outValues[r.key] = values[r.key];
            continue;
        }
        if (i.type !== 'field') continue;
        if (i.field_type === 'file') {
            outUploads[i.key] = (uploads[i.key] ?? []).filter((u) => u.token).map((u) => u.token!);
            continue;
        }
        if (values[i.key] !== undefined) outValues[i.key] = values[i.key];
        if (i.other && choseOther(i) && values[i.other.key] !== undefined) outValues[i.other.key] = values[i.other.key];
    }
    const label = m.submit_label || 'Enviar';
    setBusy(true, label);
    const body: Record<string, unknown> = { values: outValues, uploads: outUploads, hp: hpValue };
    if (m.captcha) body.captcha = captchaToken;
    if (m.data_consent && consentCb) {
        body.consent = consentCb.checked;
        body.consent_version = m.data_consent.version;
    }
    readyStamp()
        .then((stamp) => {
            body.stamp = stamp;
            return fetch(`${API}/submit`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        })
        .then((r) =>
            r.json().then(
                (b: Record<string, unknown>) => ({ ok: r.ok, b }),
                () => ({ ok: r.ok, b: {} as Record<string, unknown> }),
            ),
        )
        .then((res) => {
            const b = res.b as {
                pending_confirmation?: boolean;
                email_hint?: string;
                redirect_url?: string;
                ending_id?: string | null;
                calcs?: Record<string, number>;
                message?: string;
                data?: { errors?: Record<string, string> };
            };
            if (res.ok) {
                // v0.1.357 — el puntaje lo dice el servidor (la pantalla final lo puede mostrar).
                if (b.calcs && typeof b.calcs === 'object') finalCalcs = b.calcs;
                if (b.pending_confirmation) return checkEmail(b.email_hint);
                if (b.redirect_url) return goTo(b.redirect_url);
                return done(b.ending_id ?? null);
            }
            // El token del captcha ya se usó (el servidor lo verifica una vez).
            if (m.captcha) resetCaptcha();
            // Un sello vencido (la pestaña quedó abierta un día): el próximo intento pide otro.
            if ((res.b as { code?: string }).code === 'form_stale') stampPromise = null;
            const errs = b.data?.errors;
            if (errs) {
                const ids = Object.keys(errs);
                for (const id of ids) setErr(id, errs[id]!);
                // La casilla de la autorización está en la última página.
                const target = ids.find((id) => id !== CONSENT);
                if (paged() && ids.length) {
                    if (target) goToPage(pageOfItem(target), false);
                    else {
                        const vis = visiblePages();
                        if (vis.length) goToPage(vis[vis.length - 1]!, false);
                    }
                }
                focusFirstError();
            }
            alertBox!.textContent = b.message || 'No se pudo enviar. Prueba de nuevo.';
            alertBox!.hidden = false;
            setBusy(false, label);
        })
        .catch(() => {
            if (m.captcha) resetCaptcha();
            alertBox!.textContent = 'No hay conexión. Revisa tu internet y prueba de nuevo.';
            alertBox!.hidden = false;
            setBusy(false, label);
        });
}

function setBusy(busy: boolean, label: string): void {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.firstChild!.textContent = busy ? 'Enviando…' : label;
    if (prevBtn) prevBtn.disabled = busy;
}

// Ley 1581 — la casilla de la autorización con su resumen, el texto completo
// desplegable y el enlace a la política. Sin marcarla no se envía (y el
// servidor lo vuelve a exigir).
function consentNode(dc: NonNullable<PublicFormMeta['data_consent']>): HTMLElement {
    const cb = el('input', { type: 'checkbox', id: 'q_' + CONSENT, 'aria-describedby': 'consent_err' });
    consentCb = cb;
    cb.addEventListener('change', () => setErr(CONSENT, ''));
    const full = el('div', { cls: 'ib-consent-text', id: 'consent_text', hidden: true, tabindex: '0', text: dc.text, 'data-testid': 'form-consent-text' });
    const toggle = el('button', {
        type: 'button',
        cls: 'ib-linkbtn',
        text: 'Ver la autorización completa',
        'aria-expanded': 'false',
        'aria-controls': 'consent_text',
        'data-testid': 'form-consent-toggle',
    });
    toggle.addEventListener('click', () => {
        const open = full.hidden;
        full.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? 'Ocultar la autorización' : 'Ver la autorización completa';
        reportHeight();
    });
    const links: HTMLElement[] = [toggle];
    if (dc.policy_url && /^https:\/\//i.test(dc.policy_url)) {
        links.push(el('a', { href: dc.policy_url, target: '_blank', rel: 'noopener noreferrer', text: 'Política de tratamiento de datos' }));
    }
    const err = el('div', { cls: 'ib-error', id: 'consent_err', role: 'alert', hidden: true });
    const kids: HTMLElement[] = [el('label', { cls: 'ib-check', for: 'q_' + CONSENT }, [cb, el('span', { text: dc.label })]), el('div', { cls: 'ib-consent-links' }, links), full, err];
    if (BOOT.preview) kids.unshift(pvTag('Autorización de datos · el texto se edita en Ajustes → Datos personales'));
    const box = el('div', { cls: 'ib-item ib-consent', 'data-testid': 'form-consent' }, kids);
    consentBox = box;
    itemEls[CONSENT] = box;
    errEls[CONSENT] = err;
    return box;
}

// Insertado en otro sitio, la redirección lleva a TODA la página (no al
// marco): el script de inserción la hace; sin él, se intenta igual.
function goTo(url: string): void {
    if (!embedded) {
        location.href = url;
        return;
    }
    try {
        parent.postMessage({ type: 'imb-form-redirect', url }, '*');
    } catch {
        // nada
    }
    setTimeout(() => {
        try {
            window.open(url, '_top');
        } catch {
            location.href = url;
        }
    }, 200);
}

// Insertado: avisa su alto al sitio para que el marco no corte ni sobre.
function reportHeight(): void {
    if (!embedded || BOOT.preview) return;
    try {
        parent.postMessage({ type: 'imb-form-height', height: Math.ceil(document.documentElement.scrollHeight) }, '*');
    } catch {
        // nada
    }
}

function focusFirstError(): void {
    const first = root?.querySelector<HTMLElement>('.ib-item.ib-invalid');
    if (!first) return;
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first.querySelector<HTMLElement>('input,select,textarea,button')?.focus({ preventScroll: true });
}

function finalScreen(kids: HTMLElement[], testid?: string): void {
    const r = root!;
    r.textContent = '';
    r.appendChild(el('div', { cls: 'ib-done', 'data-testid': testid }, kids));
    try {
        parent.postMessage({ type: 'imb-form-submitted' }, '*');
    } catch {
        // nada
    }
    reportHeight();
}

/** v0.1.356 — Lo que muestra una pantalla final (la que corresponde, o el «¡Gracias!» de siempre). */
function endingKids(endingId: string | null): HTMLElement[] {
    const m = meta!;
    const ending = endingId ? m.endings?.find((e) => e.id === endingId) : undefined;
    const title = ending ? ending.title : m.success_title;
    const message = ending ? ending.message : m.success_message;
    return [
        el('div', { cls: 'ib-tick', text: '✓', 'aria-hidden': 'true' }),
        el('h2', { text: recall(title || '¡Gracias!'), 'data-ending': ending?.id ?? null }),
        ...(message ? [paragraphs(recall(message), 'ib-done-msg')] : []),
    ];
}

function done(endingId: string | null = null): void {
    const m = meta!;
    const kids = endingKids(endingId);
    if (m.allow_another) {
        const again = el('button', { type: 'button', cls: 'ib-btn ib-btn-secondary', text: 'Enviar otra respuesta' });
        again.addEventListener('click', () => location.reload());
        kids.push(again);
    }
    finalScreen(kids, 'form-done');
}

// Doble opt-in: la respuesta quedó pendiente hasta que abra el enlace.
function checkEmail(hint?: string): void {
    finalScreen(
        [
            el('div', { cls: 'ib-tick', text: '✉', 'aria-hidden': 'true' }),
            el('h2', { text: 'Revisa tu correo' }),
            el('p', { text: `Te enviamos un enlace${hint ? ` a ${hint}` : ''} para confirmar tu respuesta. Hasta que lo abras, no queda registrada.` }),
            el('p', { cls: 'ib-small', text: '¿No te llegó? Revisa la carpeta de spam. El enlace vence en 48 horas.' }),
        ],
        'form-check-email',
    );
}

// ───────────────────────────── Arranque ─────────────────────────────

if (embedded && !BOOT.preview) {
    if ('ResizeObserver' in window) new ResizeObserver(() => reportHeight()).observe(document.body);
    window.addEventListener('load', reportHeight);
}

if (BOOT.preview) {
    window.addEventListener('message', (e: MessageEvent) => {
        const d = e.data as {
            type?: string;
            meta?: PublicFormMeta;
            selected?: string | null;
            css?: string;
            scheme?: 'light' | 'dark' | null;
            /** v0.1.356 — ver una pantalla final (`''` = el «¡Gracias!» del formulario). */
            ending?: string | null;
            /** v0.1.357 — ver la bienvenida. */
            welcome?: boolean;
        } | null;
        if (e.origin !== location.origin || !d || d.type !== 'imb-form-preview') return;
        const keep = window.scrollY;
        meta = d.meta ?? null;
        selectedId = d.selected ?? null;
        if (typeof d.css === 'string') {
            const style = document.getElementById('ib-theme');
            if (style) style.textContent = d.css;
        }
        if (d.scheme) document.documentElement.setAttribute('data-scheme', d.scheme);
        else document.documentElement.removeAttribute('data-scheme');
        values = {};
        uploads = {};
        previewWelcome = d.welcome === true;
        if (meta && typeof d.ending === 'string') {
            recallNodes = [];
            const r = root!;
            r.textContent = '';
            r.appendChild(header());
            r.appendChild(el('div', { cls: 'ib-done', 'data-testid': 'form-ending-preview' }, endingKids(d.ending || null)));
            window.scrollTo(0, 0);
            return;
        }
        render(true);
        // Elegir una pregunta en el constructor lleva a su página.
        if (selectedId && paged()) {
            const p = pageOfItem(selectedId);
            if (p !== current) {
                current = p;
                paintPages();
            }
        }
        window.scrollTo(0, keep);
    });
    parent.postMessage({ type: 'imb-form-ready' }, location.origin);
}

render(false);

// v0.1.352 — el sello se pide al primer contacto con el formulario (no al cargarlo).
if (!BOOT.preview) {
    for (const ev of ['pointerdown', 'focusin', 'keydown', 'touchstart'] as const) {
        app.addEventListener(ev, kickStamp, { once: true, passive: true });
    }
}
