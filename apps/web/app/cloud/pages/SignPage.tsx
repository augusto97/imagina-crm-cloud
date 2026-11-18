import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SIGNER_STATUS_LABELS, type PublicSignatureDto } from '@imagina-base/shared';
import { CheckCircle2, Clock, Download, Eraser, FileSignature, Loader2, PenLine, ShieldCheck, Type, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { brandVars, hexToHslTriplet } from '@/hooks/useBranding';
import { applyDocumentTitle } from '@/lib/favicon';
import { __, sprintf } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

// pdf.js pesa: el visor se baja a pedido.
const FilePreviewPdf = lazy(() => import('@/components/files/FilePreviewPdf'));

function apiBase(): string {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_API_URL?.replace(/\/$/, '') ?? '/api/v1';
}

class SignApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
    }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${apiBase()}/public/sign/${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        credentials: 'omit',
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = (await res.json().catch(() => null)) as { data?: T; message?: string; code?: string } | null;
    if (!res.ok) {
        const fallback =
            res.status === 404
                ? __('Este enlace no es válido o ya no está disponible.')
                : res.status === 429
                  ? __('Demasiados intentos. Espera unos minutos y vuelve a probar.')
                  : __('No se pudo completar. Revisa tu conexión y vuelve a probar.');
        throw new SignApiError(payload?.message || fallback, res.status, payload?.code ?? 'error');
    }
    return payload?.data as T;
}

function day(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es', { dateStyle: 'long' });
}

// ─────────────────────────── La firma (dibujada o escrita) ───────────────────────────

const INK = '#111827';
const SCRIPT_FONTS = `"Segoe Script","Brush Script MT","Snell Roundhand","Apple Chancery","Lucida Handwriting",cursive`;

/** Dibuja el nombre en letra manuscrita y devuelve el PNG (fondo transparente). */
function typedSignaturePng(name: string): string {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    let size = 96;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    do {
        ctx.font = `italic ${size}px ${SCRIPT_FONTS}`;
        if (ctx.measureText(name).width <= canvas.width - 60) break;
        size -= 4;
    } while (size > 28);
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 6);
    return canvas.toDataURL('image/png');
}

function SignaturePad({ onChange }: { onChange: (png: string | null) => void }): JSX.Element {
    const ref = useRef<HTMLCanvasElement | null>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const strokes = useRef(0);
    const [empty, setEmpty] = useState(true);

    const setup = useCallback(() => {
        const c = ref.current;
        if (!c) return;
        const ratio = Math.min(3, window.devicePixelRatio || 1);
        const { width, height } = c.getBoundingClientRect();
        c.width = Math.max(1, Math.round(width * ratio));
        c.height = Math.max(1, Math.round(height * ratio));
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = INK;
    }, []);

    useEffect(() => {
        setup();
        // Cambiar el tamaño borra el lienzo: se avisa que quedó vacío.
        const onResize = (): void => {
            setup();
            strokes.current = 0;
            setEmpty(true);
            onChange(null);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [setup, onChange]);

    const point = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const r = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const clear = (): void => {
        const c = ref.current;
        const ctx = c?.getContext('2d');
        if (c && ctx) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.restore();
        }
        strokes.current = 0;
        setEmpty(true);
        onChange(null);
    };

    return (
        <div>
            <div className="imcrm-relative imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-input imcrm-bg-white">
                <canvas
                    ref={ref}
                    className="imcrm-block imcrm-h-40 imcrm-w-full imcrm-cursor-crosshair sm:imcrm-h-44"
                    style={{ touchAction: 'none' }}
                    aria-label={__('Espacio para dibujar tu firma')}
                    role="img"
                    data-testid="sign-pad"
                    onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drawing.current = true;
                        last.current = point(e);
                        const ctx = e.currentTarget.getContext('2d');
                        if (ctx && last.current) {
                            ctx.beginPath();
                            ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
                            ctx.fillStyle = INK;
                            ctx.fill();
                        }
                    }}
                    onPointerMove={(e) => {
                        if (!drawing.current || !last.current) return;
                        const ctx = e.currentTarget.getContext('2d');
                        const p = point(e);
                        if (ctx) {
                            ctx.beginPath();
                            ctx.moveTo(last.current.x, last.current.y);
                            ctx.lineTo(p.x, p.y);
                            ctx.stroke();
                        }
                        last.current = p;
                    }}
                    onPointerUp={(e) => {
                        if (!drawing.current) return;
                        drawing.current = false;
                        last.current = null;
                        strokes.current += 1;
                        setEmpty(false);
                        onChange(e.currentTarget.toDataURL('image/png'));
                    }}
                    onPointerCancel={() => {
                        drawing.current = false;
                        last.current = null;
                    }}
                />
                {empty && (
                    <span className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-0 imcrm-bottom-3 imcrm-text-center imcrm-text-xs imcrm-text-gray-400">
                        {__('Firma aquí con el dedo o el mouse')}
                    </span>
                )}
                <span className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-6 imcrm-bottom-9 imcrm-border-b imcrm-border-gray-200" />
            </div>
            <div className="imcrm-mt-1 imcrm-flex imcrm-justify-end">
                <button type="button" onClick={clear} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted" data-testid="sign-clear">
                    <Eraser className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Borrar y volver a firmar')}
                </button>
            </div>
        </div>
    );
}

// ─────────────────────────── La página ───────────────────────────

type Done = { kind: 'signed'; completed: boolean } | { kind: 'declined' };

/**
 * D6 (v0.1.446, ADR-S107) — La página donde una persona de afuera lee y firma
 * un documento. Sin cuenta: el enlace personal es la credencial; con la marca
 * de la empresa que lo envió (nunca la de la plataforma).
 */
export default function SignPage({ token }: { token: string }): JSX.Element {
    const { resolved } = useTheme();
    const [doc, setDoc] = useState<PublicSignatureDto | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [done, setDone] = useState<Done | null>(null);

    useEffect(() => {
        let alive = true;
        call<PublicSignatureDto>('GET', token)
            .then((d) => {
                if (!alive) return;
                setDoc(d);
                applyDocumentTitle(d.company || null, __('Firmar'));
            })
            .catch((err: unknown) => alive && setLoadError(err instanceof Error ? err.message : String(err)));
        return () => {
            alive = false;
        };
    }, [token]);

    const vars = useMemo(() => {
        const color = doc?.brand.color ?? null;
        const triplet = color ? hexToHslTriplet(color) : null;
        return brandVars(triplet, resolved) as React.CSSProperties;
    }, [doc?.brand.color, resolved]);

    if (loadError !== null) {
        return (
            <Frame>
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-py-10 imcrm-text-center" data-testid="sign-invalid">
                    <XCircle className="imcrm-h-10 imcrm-w-10 imcrm-text-muted-foreground" />
                    <h1 className="imcrm-text-lg imcrm-font-semibold">{__('Este enlace ya no sirve')}</h1>
                    <p className="imcrm-max-w-sm imcrm-text-sm imcrm-text-muted-foreground">
                        {loadError} {__('Si todavía tienes que firmar, pídele a quien te lo envió un enlace nuevo.')}
                    </p>
                </div>
            </Frame>
        );
    }
    if (doc === null) {
        return (
            <Frame>
                <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-16 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando el documento…')}
                </div>
            </Frame>
        );
    }

    const pdfUrl = `${apiBase()}/public/sign/${token}/document.pdf`;
    const signable = doc.status === 'pending' && (doc.signer.status === 'sent' || doc.signer.status === 'viewed') && done === null;

    return (
        <div style={vars} className="imcrm-min-h-screen imcrm-bg-canvas">
            <header className="imcrm-border-b imcrm-border-border imcrm-bg-card">
                <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-5xl imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3">
                    {doc.brand.logo_url ? (
                        <img src={doc.brand.logo_url} alt={doc.company} className="imcrm-h-8 imcrm-max-w-[160px] imcrm-object-contain" />
                    ) : (
                        <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary imcrm-text-sm imcrm-font-bold imcrm-text-primary-foreground">
                            {(doc.company || '·').slice(0, 1).toUpperCase()}
                        </span>
                    )}
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{doc.company}</span>
                    <span className="imcrm-ml-auto imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                        <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Firma electrónica')}
                    </span>
                </div>
            </header>

            <main className="imcrm-mx-auto imcrm-grid imcrm-max-w-5xl imcrm-gap-5 imcrm-px-4 imcrm-py-5 lg:imcrm-grid-cols-[minmax(0,1fr)_360px]">
                <section className="imcrm-min-w-0">
                    <div className="imcrm-mb-3">
                        <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-leading-tight" data-testid="sign-title">
                            {doc.title}
                        </h1>
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                            {sprintf(__('Te lo envió %s'), doc.company)}
                            {doc.pages > 0 ? ` · ${doc.pages === 1 ? __('1 página') : sprintf(__('%d páginas'), doc.pages)}` : ''}
                        </p>
                    </div>
                    {doc.message && (
                        <p className="imcrm-mb-3 imcrm-whitespace-pre-wrap imcrm-rounded-lg imcrm-border-l-4 imcrm-border-primary imcrm-bg-card imcrm-px-4 imcrm-py-3 imcrm-text-sm">{doc.message}</p>
                    )}
                    <DocViewer url={pdfUrl} />
                    <a href={`${pdfUrl}?download=1`} className="imcrm-mt-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline" data-testid="sign-download">
                        <Download className="imcrm-h-4 imcrm-w-4" />
                        {doc.signed_available ? __('Descargar el documento firmado') : __('Descargar el PDF')}
                    </a>
                </section>

                <aside className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    {done !== null ? (
                        <DoneCard done={done} doc={doc} pdfUrl={pdfUrl} />
                    ) : signable ? (
                        <SignForm token={token} doc={doc} onDone={setDone} />
                    ) : (
                        <StatusCard doc={doc} />
                    )}
                    <PeopleCard doc={doc} />
                    <p className="imcrm-text-center imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                        {__('Firma electrónica simple (Ley 527 de 1999 y Decreto 2364 de 2012). Al terminar, cada persona recibe el PDF firmado con la constancia de las firmas.')}{' '}
                        <a href={doc.verify_url} className="imcrm-underline" target="_blank" rel="noopener noreferrer">
                            {__('Verificar')}
                        </a>
                    </p>
                </aside>
            </main>
        </div>
    );
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-start imcrm-justify-center imcrm-bg-canvas imcrm-px-4 imcrm-py-10 sm:imcrm-items-center">
            <div className="imcrm-w-full imcrm-max-w-lg imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-md">{children}</div>
        </div>
    );
}

function PeopleCard({ doc }: { doc: PublicSignatureDto }): JSX.Element | null {
    if (doc.others.length === 0) return null;
    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="sign-people">
            <p className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('También firman')}</p>
            <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {doc.others.map((o, i) => (
                    <li key={i} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        {o.status === 'signed' ? (
                            <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" />
                        ) : (
                            <Clock className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        )}
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                            {o.name}
                            {o.role ? <span className="imcrm-text-muted-foreground"> · {o.role}</span> : null}
                        </span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{SIGNER_STATUS_LABELS[o.status]}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function StatusCard({ doc }: { doc: PublicSignatureDto }): JSX.Element {
    const card = 'imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-text-sm';
    if (doc.status === 'completed') {
        return (
            <div className={card} data-testid="sign-status" data-status="completed">
                <CheckCircle2 className="imcrm-h-8 imcrm-w-8 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" />
                <p className="imcrm-mt-2 imcrm-font-semibold">{__('Ya firmaron todos')}</p>
                <p className="imcrm-mt-1 imcrm-text-muted-foreground">{__('Puedes descargar el documento firmado, con la constancia de las firmas al final.')}</p>
            </div>
        );
    }
    if (doc.signer.status === 'signed') {
        return (
            <div className={card} data-testid="sign-status" data-status="signed">
                <CheckCircle2 className="imcrm-h-8 imcrm-w-8 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" />
                <p className="imcrm-mt-2 imcrm-font-semibold">{__('Ya firmaste este documento')}</p>
                <p className="imcrm-mt-1 imcrm-text-muted-foreground">{__('Cuando firmen todos te llega por correo el PDF firmado.')}</p>
            </div>
        );
    }
    if (doc.signer.status === 'waiting') {
        return (
            <div className={card} data-testid="sign-status" data-status="waiting">
                <Clock className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
                <p className="imcrm-mt-2 imcrm-font-semibold">{__('Todavía no te toca')}</p>
                <p className="imcrm-mt-1 imcrm-text-muted-foreground">{__('Este documento se firma en orden: te avisamos por correo cuando sea tu turno.')}</p>
            </div>
        );
    }
    const text =
        doc.status === 'declined' || doc.signer.status === 'declined'
            ? { title: __('No se va a firmar'), body: __('Alguien decidió no firmar este documento, así que la solicitud se cerró.') }
            : doc.status === 'expired'
              ? { title: __('Venció el plazo para firmar'), body: __('Si todavía hace falta, pídele a quien te lo envió que lo mande de nuevo.') }
              : { title: __('Esta solicitud ya no está activa'), body: __('Pídele a quien te lo envió que lo mande de nuevo.') };
    return (
        <div className={card} data-testid="sign-status" data-status={doc.status}>
            <XCircle className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
            <p className="imcrm-mt-2 imcrm-font-semibold">{text.title}</p>
            <p className="imcrm-mt-1 imcrm-text-muted-foreground">{text.body}</p>
        </div>
    );
}

/**
 * El PDF del documento. Memorizado y con `onError` estable: si no, cada
 * cambio de estado de la página (firmar, escribir el código) volvía a pedir
 * y dibujar el PDF entero.
 */
const DocViewer = memo(function DocViewer({ url }: { url: string }): JSX.Element {
    const [error, setError] = useState<string | null>(null);
    const onError = useCallback((message: string) => setError(message), []);
    return (
        <div className="imcrm-h-[62vh] imcrm-min-h-[360px] imcrm-overflow-hidden imcrm-rounded-lg imcrm-bg-[#3b3f45]" data-testid="sign-viewer">
            {error !== null ? (
                <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-px-6 imcrm-text-center imcrm-text-sm imcrm-text-white/85">
                    <FileSignature className="imcrm-h-8 imcrm-w-8 imcrm-opacity-70" />
                    {__('No se pudo mostrar el PDF aquí. Descárgalo para leerlo antes de firmar.')}
                </div>
            ) : (
                <Suspense
                    fallback={
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-16 imcrm-text-sm imcrm-text-white/80">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando el PDF…')}
                        </div>
                    }
                >
                    <FilePreviewPdf url={url} onError={onError} />
                </Suspense>
            )}
        </div>
    );
});

function DoneCard({ done, doc, pdfUrl }: { done: Done; doc: PublicSignatureDto; pdfUrl: string }): JSX.Element {
    if (done.kind === 'declined') {
        return (
            <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-text-sm" data-testid="sign-done" data-kind="declined">
                <XCircle className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
                <p className="imcrm-mt-2 imcrm-font-semibold">{__('Listo: no firmaste el documento')}</p>
                <p className="imcrm-mt-1 imcrm-text-muted-foreground">{sprintf(__('Le avisamos a %s con el motivo que escribiste.'), doc.company)}</p>
            </div>
        );
    }
    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-emerald-500/40 imcrm-bg-emerald-500/10 imcrm-p-5 imcrm-text-sm" data-testid="sign-done" data-kind={done.completed ? 'completed' : 'signed'}>
            <CheckCircle2 className="imcrm-h-9 imcrm-w-9 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" />
            <p className="imcrm-mt-2 imcrm-text-base imcrm-font-semibold">{__('¡Firmaste el documento!')}</p>
            <p className="imcrm-mt-1 imcrm-text-muted-foreground">
                {done.completed
                    ? __('Ya firmaron todos. Te llega por correo el PDF firmado, con la constancia de las firmas al final.')
                    : __('Cuando firmen las demás personas, te llega por correo el PDF firmado.')}
            </p>
            {done.completed && (
                <a href={`${pdfUrl}?download=1`} className="imcrm-mt-3 imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                    <Download className="imcrm-h-4 imcrm-w-4" />
                    {__('Descargar el documento firmado')}
                </a>
            )}
        </div>
    );
}

function SignForm({ token, doc, onDone }: { token: string; doc: PublicSignatureDto; onDone: (d: Done) => void }): JSX.Element {
    const [name, setName] = useState(doc.signer.name);
    const [mode, setMode] = useState<'draw' | 'type'>('draw');
    const [drawn, setDrawn] = useState<string | null>(null);
    const [consent, setConsent] = useState(false);
    const [codeSent, setCodeSent] = useState(false);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState<'code' | 'sign' | 'decline' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState('');
    const onDrawn = useCallback((png: string | null) => setDrawn(png), []);

    const typedPreview = useMemo(() => (mode === 'type' && name.trim().length >= 2 ? typedSignaturePng(name.trim()) : ''), [mode, name]);
    const needsCode = doc.verify === 'email';
    const image = mode === 'draw' ? drawn : typedPreview || null;
    const ready = name.trim().length >= 2 && image !== null && consent && (!needsCode || /^\d{6}$/.test(code.trim()));

    const sendCode = async (): Promise<void> => {
        setBusy('code');
        setError(null);
        try {
            const r = await call<{ sent: boolean; email_masked: string }>('POST', `${token}/code`);
            setCodeSent(true);
            setInfo(sprintf(__('Te mandamos un código de 6 números a %s. Vence en 10 minutos.'), r.email_masked));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    const sign = async (): Promise<void> => {
        if (!ready || image === null) return;
        setBusy('sign');
        setError(null);
        try {
            const r = await call<{ status: string; signed_available: boolean }>('POST', `${token}/sign`, {
                name: name.trim(),
                kind: mode === 'draw' ? 'drawn' : 'typed',
                image,
                consent: true,
                ...(needsCode ? { code: code.trim() } : {}),
            });
            onDone({ kind: 'signed', completed: r.status === 'completed' });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    const decline = async (): Promise<void> => {
        setBusy('decline');
        setError(null);
        try {
            await call('POST', `${token}/decline`, { reason: reason.trim() });
            onDone({ kind: 'declined' });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="sign-form">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                <FileSignature className="imcrm-h-5 imcrm-w-5 imcrm-text-primary" />
                {__('Tu firma')}
            </p>
            <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('Lee el documento completo antes de firmar. Tienes hasta el %s.'), day(doc.expires_at))}
            </p>

            {declining ? (
                <form
                    className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (reason.trim().length >= 3) void decline();
                    }}
                >
                    <Label htmlFor="sign-reason">{__('¿Por qué no lo firmas?')}</Label>
                    <Textarea id="sign-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder={__('Por ejemplo: el valor no es el que acordamos.')} data-testid="sign-decline-reason" />
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Se lo contamos a %s y la solicitud se cierra.'), doc.company)}</p>
                    {error && <ErrorBox text={error} />}
                    <div className="imcrm-flex imcrm-gap-2">
                        <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>
                            {__('Volver')}
                        </Button>
                        <Button type="submit" variant="destructive" className="imcrm-flex-1" disabled={reason.trim().length < 3 || busy !== null} data-testid="sign-decline-confirm">
                            {busy === 'decline' && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                            {__('No firmar')}
                        </Button>
                    </div>
                </form>
            ) : (
                <form
                    className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void sign();
                    }}
                >
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="sign-name">{__('Tu nombre completo')}</Label>
                        <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" data-testid="sign-name" />
                    </div>

                    <div>
                        <div className="imcrm-mb-2 imcrm-inline-flex imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5 imcrm-text-xs" role="tablist" aria-label={__('Cómo firmas')}>
                            {(
                                [
                                    ['draw', __('Dibujar'), PenLine],
                                    ['type', __('Escribir'), Type],
                                ] as const
                            ).map(([m, label, Icon]) => (
                                <button
                                    key={m}
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === m}
                                    onClick={() => setMode(m)}
                                    className={cn(
                                        'imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-3 imcrm-py-1.5 imcrm-font-medium',
                                        mode === m ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground',
                                    )}
                                    data-testid={`sign-mode-${m}`}
                                >
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {label}
                                </button>
                            ))}
                        </div>
                        {mode === 'draw' ? (
                            <SignaturePad onChange={onDrawn} />
                        ) : (
                            <div className="imcrm-flex imcrm-h-40 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-input imcrm-bg-white imcrm-p-2 sm:imcrm-h-44" data-testid="sign-typed">
                                {typedPreview ? (
                                    <img src={typedPreview} alt={__('Tu firma escrita')} className="imcrm-max-h-full imcrm-max-w-full" />
                                ) : (
                                    <span className="imcrm-text-xs imcrm-text-gray-400">{__('Escribe tu nombre arriba')}</span>
                                )}
                            </div>
                        )}
                    </div>

                    {needsCode && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="sign-code">{__('Código de verificación')}</Label>
                            {!codeSent ? (
                                <>
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {sprintf(__('Para confirmar que eres tú, te mandamos un código a %s.'), doc.signer.email_masked)}
                                    </p>
                                    <Button type="button" variant="outline" onClick={() => void sendCode()} disabled={busy !== null} data-testid="sign-send-code">
                                        {busy === 'code' && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                        {__('Enviarme el código')}
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Input
                                        id="sign-code"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        placeholder="000000"
                                        className="imcrm-text-center imcrm-font-mono imcrm-text-lg imcrm-tracking-[0.4em]"
                                        data-testid="sign-code"
                                    />
                                    {info && <p className="imcrm-text-xs imcrm-text-muted-foreground">{info}</p>}
                                    <button type="button" className="imcrm-self-start imcrm-text-xs imcrm-text-primary hover:imcrm-underline disabled:imcrm-opacity-50" onClick={() => void sendCode()} disabled={busy !== null}>
                                        {__('Enviar otro código')}
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs imcrm-leading-relaxed">
                        <input type="checkbox" className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="sign-consent" />
                        <span>{doc.consent_text}</span>
                    </label>

                    {error && <ErrorBox text={error} />}

                    <Button type="submit" size="lg" disabled={!ready || busy !== null} className="imcrm-gap-2" data-testid="sign-submit">
                        {busy === 'sign' ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <FileSignature className="imcrm-h-4 imcrm-w-4" />}
                        {__('Firmar el documento')}
                    </Button>
                    <button type="button" onClick={() => setDeclining(true)} className="imcrm-self-center imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline" data-testid="sign-decline">
                        {__('No voy a firmar')}
                    </button>
                </form>
            )}
        </div>
    );
}

function ErrorBox({ text }: { text: string }): JSX.Element {
    return (
        <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert" data-testid="sign-error">
            {text}
        </p>
    );
}

