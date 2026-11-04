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
import { formItemVisible, formPageVisible, splitFormPages } from '@imagina-base/shared/src/schemas/form-logic';

type FieldItem = PublicFormFieldItem;
type ImageItem = Extract<PublicFormItem, { type: 'image' }>;
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
let pages: Array<{ break_id: string | null; title: string; items: Item[] }> = [];
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
    for (const p of String(text || '').split(/\n{2,}/)) if (p.trim()) box.appendChild(el('p', { text: p }));
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

/** Las preguntas en la forma que esperan las funciones de shared (`key` = id del campo). */
function visible(item: Item): boolean {
    return formItemVisible(item as never, (meta?.items ?? []).map(normalized) as never, values);
}
function normalized(i: Item): { type: string; field_id?: number; show_if: unknown } {
    return { type: i.type, field_id: i.type === 'field' ? Number(i.key) : undefined, show_if: i.show_if };
}

function paged(): boolean {
    return pages.length > 1;
}
function visiblePages(): number[] {
    const all = (meta?.items ?? []) as never;
    const out: number[] = [];
    pages.forEach((p, idx) => {
        if (formPageVisible(p as never, all, values)) out.push(idx);
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
    let bad = false;
    for (const i of items) {
        if (i.type !== 'field' || i.hidden || !visible(i)) continue;
        setErr(i.id, '');
        const v = values[i.key];
        if (i.required && empty(v)) {
            setErr(i.id, 'Esta pregunta es obligatoria.');
            bad = true;
        } else if (i.field_type === 'email' && !empty(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
            setErr(i.id, 'Revisa el correo.');
            bad = true;
        } else if ((i.field_type === 'number' || i.field_type === 'currency' || i.field_type === 'percent') && typeof v === 'number' && Number.isNaN(v)) {
            setErr(i.id, 'Escribe un número.');
            bad = true;
        } else if (i.field_type === 'file' && (uploads[i.key] ?? []).some((u) => u.pending)) {
            setErr(i.id, 'Espera a que termine de subir.');
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
                return sel;
            }
            return choices(f, false);
        }
        case 'multi_select':
            return choices(f, true);
        case 'file':
            return filesControl(f, id);
        default:
            return bindText(el('input', { type: 'text', id, placeholder: ph, maxlength: cfg.max_length }));
    }
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
            const fd = new FormData();
            fd.append('file', file, file.name);
            ensureStamp()
                .then(({ stamp }) =>
                    fetch(`${API}/files?field=${encodeURIComponent(key)}`, { method: 'POST', body: fd, credentials: 'omit', headers: { 'X-Form-Stamp': stamp } }),
                )
                .then((r) => r.json().then((b: { message?: string; token?: string; name?: string }) => ({ ok: r.ok, b })))
                .then((res) => {
                    if (!res.ok) throw new Error(res.b?.message || 'No se pudo subir el archivo.');
                    u.pending = false;
                    u.token = res.b.token;
                    u.name = res.b.name || u.name;
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
        const kind = f.field_type === 'team' ? (f.display === 'checkboxes' ? 'multi_select' : 'select') : f.field_type;
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
            case 'select':
                values[f.key] = raw;
                if (c instanceof HTMLSelectElement) c.value = raw;
                else c?.querySelectorAll('input').forEach((i) => (i.checked = i.value === raw));
                (c as Control | undefined)?._paint?.();
                break;
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
    const node = el('div', { cls: `ib-item ib-field ib-type-${i.field_type} ib-w-${i.width ?? 'full'}${float ? ' ib-float' : ''}` });
    const err = el('div', { cls: 'ib-error', role: 'alert', hidden: true });
    errEls[i.id] = err;
    let label: HTMLElement | null = null;
    if (i.field_type !== 'checkbox') {
        const isGroup = (i.field_type === 'select' && i.display !== 'dropdown') || i.field_type === 'multi_select' || i.field_type === 'rating' || (i.field_type === 'team' && i.display !== 'dropdown');
        label = isGroup ? el('div', { cls: 'ib-label', id: 'l_' + i.id }) : el('label', { cls: 'ib-label', for: 'q_' + i.id, id: 'l_' + i.id });
        label.appendChild(document.createTextNode(i.label));
        if (i.required) label.appendChild(el('span', { cls: 'ib-req', text: '*', 'aria-hidden': 'true' }));
        if (i.hide_label) label.classList.add('ib-sr');
    }
    const help = i.help ? el('div', { cls: 'ib-help', text: i.help }) : null;
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
    if (i.caption) node.appendChild(el('figcaption', { text: i.caption }));
    return node;
}

function itemNode(i: Item, controls: Record<string, Control>): HTMLElement {
    let node: HTMLElement;
    if (i.type === 'heading') node = el('div', { cls: 'ib-item ib-heading', text: i.text });
    else if (i.type === 'text') {
        node = paragraphs(i.text, 'ib-item ib-text');
    } else if (i.type === 'image') node = imageNode(i);
    else node = fieldNode(i as FieldItem, controls);
    if (BOOT.preview && i.show_if) node.insertBefore(pvTag('Condicional · sólo aparece si se cumple su condición'), node.firstChild);
    previewable(node, i.id);
    itemEls[i.id] = node;
    return node;
}

// ───────────────────────────── Pantalla ─────────────────────────────

function refresh(): void {
    for (const i of meta?.items ?? []) {
        const n = itemEls[i.id];
        if (!n) continue;
        // En la vista previa se ve todo (atenuado lo condicional y lo oculto).
        n.hidden = BOOT.preview ? false : i.type === 'field' && i.hidden ? true : !visible(i);
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
    if (stepsLabel) stepsLabel.textContent = `Paso ${pos} de ${total}`;
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
        const title = pageEls[idx]?.querySelector<HTMLElement>('.ib-page-title');
        (stepsLabel ?? title)?.focus({ preventScroll: true });
    }
    reportHeight();
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
    if (embedded && !BOOT.preview) cls.push('ib-embedded');
    if (embedded && !BOOT.preview && v?.embed_background) cls.push('ib-embed-bg');
    document.body.className = cls.join(' ');
}

function header(): HTMLElement {
    const m = meta!;
    const box = el('header', { cls: 'ib-header' });
    if (m.logo_url) box.appendChild(el('div', { cls: 'ib-logo' }, [el('img', { src: m.logo_url, alt: m.company || 'Logo', decoding: 'async', fetchpriority: 'high' })]));
    box.appendChild(el('h1', { cls: 'ib-title', text: m.title }));
    if (m.description) box.appendChild(paragraphs(m.description, 'ib-desc'));
    return box;
}

function render(keepPage: boolean): void {
    itemEls = {};
    errEls = {};
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

    pages = splitFormPages(meta.items as Array<Item & { title?: string }>) as typeof pages;
    if (!keepPage || current >= pages.length) current = 0;

    const form = el('form', { cls: 'ib-form', novalidate: true });
    const controls: Record<string, Control> = {};
    const progress = view()?.progress ?? 'bar';
    if (paged() && progress !== 'none') {
        stepsLabel = el('strong', { tabindex: '-1' });
        const top = el('div', { cls: 'ib-steps-top' }, [stepsLabel]);
        if (progress === 'steps') {
            dotsEl = el('div', { cls: 'ib-dots', role: 'presentation' });
            form.appendChild(el('div', { cls: 'ib-steps', 'aria-live': 'polite' }, [top, dotsEl]));
        } else {
            barEl = el('span');
            form.appendChild(el('div', { cls: 'ib-steps', 'aria-live': 'polite' }, [top, el('div', { cls: 'ib-progress', role: 'presentation' }, [barEl])]));
        }
    }
    pages.forEach((p, pidx) => {
        const box = el('div', { cls: 'ib-page' });
        if (paged() && (p.title || (BOOT.preview && p.break_id))) {
            const t = p.title ? el('h2', { cls: 'ib-page-title', text: p.title }) : pvTag(`Página ${pidx + 1} · sin título`);
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
        form.appendChild(el('div', { cls: 'ib-actions ib-paged' }, [prevBtn, el('span', { cls: 'ib-grow' }), nextBtn, submitBtn]));
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
    for (const i of fields()) {
        if (i.field_type === 'file') {
            outUploads[i.key] = (uploads[i.key] ?? []).filter((u) => u.token).map((u) => u.token!);
            continue;
        }
        if (values[i.key] !== undefined) outValues[i.key] = values[i.key];
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
            const b = res.b as { pending_confirmation?: boolean; email_hint?: string; redirect_url?: string; message?: string; data?: { errors?: Record<string, string> } };
            if (res.ok) {
                if (b.pending_confirmation) return checkEmail(b.email_hint);
                if (b.redirect_url) return goTo(b.redirect_url);
                return done();
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

function done(): void {
    const m = meta!;
    const kids: HTMLElement[] = [el('div', { cls: 'ib-tick', text: '✓', 'aria-hidden': 'true' }), el('h2', { text: m.success_title || '¡Gracias!' }), el('p', { text: m.success_message || '' })];
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
        const d = e.data as { type?: string; meta?: PublicFormMeta; selected?: string | null; css?: string; scheme?: 'light' | 'dark' | null } | null;
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
