import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckIcon, ChevronDown, Code2, Copy, ExternalLink, Globe, Link2, Mail, RefreshCw, Share2, ShieldCheck, X, type LucideIcon } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { WidgetFromFormCard } from '@/admin/widgets/WidgetFromFormCard';
import { EmbedCodePicker } from './EmbedCodePicker';
import { useEmbedOrigin } from './useEmbedOrigin';
import { PublicQrCard } from './PublicQrCard';
import { cleanEmbedDomain, shareMessage } from './shareHelpers';

/**
 * `qr` abre la pestaña del enlace con el código QR a la vista (desde v0.1.397
 * el QR vive ahí: sólo eran 168 px en una ventana vacía).
 */
export type ShareTab = 'link' | 'embed' | 'qr';

/**
 * v0.1.381 — «Compartir» del formulario y de la agenda en una VENTANA.
 *
 * v0.1.397 — Rediseñada: dos pestañas en un control segmentado (el enlace, con
 * los atajos para mandarlo y el código QR; e insertar en tu sitio, en tres
 * pasos con la demostración a todo el alto). La ventana se ajusta a lo que
 * muestra: la del enlace es chica y sin espacios vacíos; la de insertar, ancha.
 * Los sitios que pueden insertarlo quedan plegados (casi nadie los usa).
 */
export function ShareDialog({
    open,
    onOpenChange,
    kind,
    name,
    url,
    origin,
    path,
    version,
    published,
    onPublish,
    publishBusy,
    publishProblems,
    accent,
    bare,
    domains,
    dirty,
    onSave,
    onRegenerate,
    tab,
    onTab,
    formId,
    embedOrigin,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: 'form' | 'booking';
    /** El título público (o el nombre interno si no tiene). */
    name: string;
    url: string;
    origin: string;
    /** La dirección SIN origen, para la demostración. */
    path: string;
    version: string;
    published: boolean;
    onPublish: () => void;
    publishBusy?: boolean;
    /** Lo que falta para poder publicar (la agenda). */
    publishProblems?: string[];
    accent: string;
    bare: { value: boolean; onChange: (bare: boolean) => void; unsaved: boolean };
    domains: { value: string[]; onChange: (v: string[]) => void; unsaved: boolean };
    dirty: boolean;
    onSave?: () => void;
    onRegenerate?: () => void;
    tab: ShareTab;
    onTab: (t: ShareTab) => void;
    /** v0.1.394 — el formulario (para armar un widget de contacto con él). */
    formId?: number;
    /** v0.1.409 (ADR-S102) — la dirección rápida (por Cloudflare) que mandó el servidor. */
    embedOrigin?: string | null;
}): JSX.Element {
    const codeOrigin = useEmbedOrigin(embedOrigin);
    const isForm = kind === 'form';
    const prefix = isForm ? 'form' : 'booking';
    const view: 'link' | 'embed' = tab === 'embed' ? 'embed' : 'link';
    const TABS: Array<{ id: 'link' | 'embed'; label: string; icon: LucideIcon }> = [
        { id: 'link', label: __('Enlace y QR'), icon: Link2 },
        { id: 'embed', label: __('Insertar en tu sitio'), icon: Code2 },
    ];
    const unpublished = !published ? (
        <UnpublishedNote isForm={isForm} problems={publishProblems ?? []} onPublish={onPublish} busy={publishBusy} prefix={prefix} />
    ) : null;

    return (
        <RDialog.Root open={open} onOpenChange={onOpenChange}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/45 imcrm-backdrop-blur-sm" />
                <ShareContent view={view} data-testid={`${prefix}-share-panel`} data-view={view}>
                    <header className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-pb-3 imcrm-pt-3.5 sm:imcrm-px-5">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-pr-9">
                            <RDialog.Title className="imcrm-min-w-0 imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                {isForm ? __('Compartir el formulario') : __('Compartir la agenda')}
                            </RDialog.Title>
                            <StatusPill published={published} isForm={isForm} prefix={prefix} />
                        </div>
                        <RDialog.Description className="imcrm-sr-only">{name}</RDialog.Description>
                        <div
                            role="tablist"
                            aria-label={__('Cómo compartir')}
                            className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-0.5 imcrm-self-stretch imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5 sm:imcrm-inline-grid sm:imcrm-self-start"
                        >
                            {TABS.map((t) => {
                                const Icon = t.icon;
                                const on = t.id === view;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={on}
                                        onClick={() => onTab(t.id)}
                                        className={cn(
                                            'imcrm-inline-flex imcrm-h-8 imcrm-min-w-0 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-rounded-md imcrm-px-3 imcrm-text-sm imcrm-transition-colors',
                                            on ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                        )}
                                        data-testid={`${prefix}-share-tab-${t.id}`}
                                    >
                                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                                        <span className="imcrm-truncate">{t.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </header>

                    {view === 'link' ? (
                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-5" data-testid={`${prefix}-share-body`} data-tab="link">
                            {unpublished}
                            <LinkView kind={kind} url={url} name={name} testId={`${prefix}-link`} highlightQr={tab === 'qr'} onRegenerate={onRegenerate} />
                        </div>
                    ) : (
                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-overflow-y-auto lg:imcrm-overflow-hidden" data-testid={`${prefix}-share-body`} data-tab="embed">
                            {unpublished && <div className="imcrm-shrink-0 imcrm-px-4 imcrm-pt-4 sm:imcrm-px-5">{unpublished}</div>}
                            <div className="imcrm-min-h-0 imcrm-flex-1">
                                <EmbedCodePicker
                                    target={{ url, origin, title: name, kind }}
                                    accent={accent}
                                    testId={`${prefix}-embed`}
                                    dataTour={`${prefix}-embed-mode`}
                                    bare={bare}
                                    embedOrigin={codeOrigin}
                                    demo={{ path, version, published, dirty, onPublish, onSave, busy: publishBusy }}
                                    extra={
                                        <>
                                            <DomainsSection kind={kind} domains={domains} testId={`${prefix}-domains`} />
                                            {isForm && formId !== undefined && <WidgetFromFormCard formId={formId} name={name} />}
                                        </>
                                    }
                                />
                            </div>
                        </div>
                    )}
                </ShareContent>
            </RDialog.Portal>
        </RDialog.Root>
    );
}

// forwardRef: el portal de Radix le pasa una ref al hijo.
const ShareContent = forwardRef<HTMLDivElement, { children: ReactNode; view: 'link' | 'embed'; 'data-testid'?: string; 'data-view'?: string }>(function ShareContent({ children, view, ...rest }, ref) {
    return (
        <RDialog.Content
            ref={ref}
            {...rest}
            // En el celular ocupa toda la pantalla; en la computadora, una ventana al
            // centro del tamaño de lo que muestra (chica para el enlace, ancha para insertar).
            className={cn(
                'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-bg-card imcrm-shadow-imcrm-xl',
                'sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:-imcrm-translate-x-1/2 sm:-imcrm-translate-y-1/2 sm:imcrm-rounded-2xl sm:imcrm-border sm:imcrm-border-border sm:imcrm-transition-[width] sm:imcrm-duration-200 sm:imcrm-ease-out',
                view === 'embed'
                    ? 'sm:imcrm-h-[min(92dvh,860px)] sm:imcrm-w-[min(1200px,calc(100vw-2rem))]'
                    : 'sm:imcrm-max-h-[min(92dvh,760px)] sm:imcrm-w-[min(560px,calc(100vw-2rem))]',
            )}
        >
            <RDialog.Close asChild>
                <button
                    type="button"
                    aria-label={__('Cerrar')}
                    className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-z-10 imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    data-testid="share-close"
                >
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </RDialog.Close>
            {children}
        </RDialog.Content>
    );
});

function StatusPill({ published, isForm, prefix }: { published: boolean; isForm: boolean; prefix: string }): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium',
                published ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
            )}
            data-testid={`${prefix}-share-status`}
            data-published={published ? '' : undefined}
        >
            <span className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full', published ? 'imcrm-bg-success' : 'imcrm-bg-muted-foreground/60')} />
            {published ? (isForm ? __('Publicado') : __('Publicada')) : __('Sin publicar')}
        </span>
    );
}

function UnpublishedNote({ isForm, problems, onPublish, busy, prefix }: { isForm: boolean; problems: string[]; onPublish: () => void; busy?: boolean; prefix: string }): JSX.Element {
    return (
        <div
            className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-x-3 imcrm-gap-y-2 imcrm-rounded-xl imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3"
            data-testid={`${prefix}-share-unpublished`}
        >
            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" />
            <div className="imcrm-min-w-[180px] imcrm-flex-1">
                <p className="imcrm-text-sm imcrm-font-medium">{isForm ? __('Todavía no está publicado') : __('Todavía no está publicada')}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {isForm
                        ? __('El enlace responde «no disponible» hasta que lo publiques.')
                        : __('El enlace responde «no disponible» hasta que la publiques.')}
                </p>
                {problems.length > 0 && (
                    <ul className="imcrm-mt-1.5 imcrm-list-disc imcrm-pl-4 imcrm-text-xs imcrm-text-muted-foreground" data-testid={`${prefix}-share-problems`}>
                        {problems.slice(0, 4).map((p) => (
                            <li key={p}>{p}</li>
                        ))}
                        {problems.length > 4 && <li>{__('…y %d más').replace('%d', String(problems.length - 4))}</li>}
                    </ul>
                )}
            </div>
            <Button size="sm" className="imcrm-ml-auto imcrm-h-8 imcrm-shrink-0" onClick={onPublish} disabled={busy} data-testid={`${prefix}-share-publish`}>
                {problems.length > 0 ? __('Ver qué falta') : __('Publicar ahora')}
            </Button>
        </div>
    );
}

function LinkView({
    kind,
    url,
    name,
    testId,
    highlightQr,
    onRegenerate,
}: {
    kind: 'form' | 'booking';
    url: string;
    name: string;
    testId: string;
    highlightQr: boolean;
    onRegenerate?: () => void;
}): JSX.Element {
    const [copied, setCopied] = useState(false);
    const text = shareMessage(kind, name, url);
    const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const copy = (): void => {
        void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        });
    };
    return (
        <>
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Tu enlace')}</p>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-py-1.5 imcrm-pl-3 imcrm-pr-1.5 focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring">
                    <Globe className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <input
                        readOnly
                        value={url}
                        aria-label={__('Tu enlace')}
                        onFocus={(e) => e.currentTarget.select()}
                        className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-bg-transparent imcrm-text-sm imcrm-outline-none"
                        data-testid={testId}
                    />
                    <Button size="sm" className="imcrm-h-9 imcrm-shrink-0 imcrm-gap-1.5 imcrm-rounded-lg" onClick={copy} data-testid={`${testId}-copy`}>
                        {copied ? <CheckIcon className="imcrm-h-4 imcrm-w-4" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
                        {copied ? __('Copiado') : __('Copiar')}
                    </Button>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {kind === 'booking'
                        ? __('Quien lo abra elige su horario y agenda; cada cita crea un registro en la lista.')
                        : __('Quien lo abra puede responderlo; cada respuesta crea un registro en la lista.')}
                </p>
            </section>

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Mándalo por')}</p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                    <ShareAction
                        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
                        label={__('WhatsApp')}
                        icon={<IntegrationLogo integrationKey="whatsapp" size={40} />}
                        testId={`${testId}-whatsapp`}
                    />
                    <ShareAction
                        href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(text)}`}
                        label={__('Correo')}
                        icon={<Tile icon={Mail} className="imcrm-bg-[#2563eb] imcrm-text-white" />}
                        testId={`${testId}-email`}
                        sameTab
                    />
                    <ShareAction href={url} label={__('Abrir')} icon={<Tile icon={ExternalLink} className="imcrm-bg-muted imcrm-text-foreground" />} testId={`${testId}-open`} />
                    {canNativeShare && (
                        <ShareAction
                            label={__('Más apps')}
                            icon={<Tile icon={Share2} className="imcrm-bg-muted imcrm-text-foreground" />}
                            onClick={() => void navigator.share({ title: name, text, url }).catch(() => undefined)}
                            testId={`${testId}-native`}
                        />
                    )}
                </div>
            </section>

            <PublicQrCard url={url} name={name} kind={kind} highlight={highlightQr} />

            {onRegenerate && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('¿Se compartió donde no debía? La dirección actual deja de funcionar y se crea otra.')}</p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-8 imcrm-gap-1.5 imcrm-text-xs"
                        onClick={onRegenerate}
                        data-testid={kind === 'booking' ? 'booking-regenerate' : 'form-regenerate'}
                    >
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Cambiar la dirección')}
                    </Button>
                </div>
            )}
        </>
    );
}

function Tile({ icon: Icon, className }: { icon: LucideIcon; className: string }): JSX.Element {
    return (
        <span aria-hidden="true" className={cn('imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-[10px] imcrm-shadow-sm', className)}>
            <Icon className="imcrm-h-[18px] imcrm-w-[18px]" />
        </span>
    );
}

function ShareAction({
    href,
    onClick,
    label,
    icon,
    testId,
    sameTab,
}: {
    href?: string;
    onClick?: () => void;
    label: string;
    icon: ReactNode;
    testId: string;
    sameTab?: boolean;
}): JSX.Element {
    const cls =
        'imcrm-flex imcrm-w-[76px] imcrm-flex-col imcrm-items-center imcrm-gap-1.5 imcrm-rounded-xl imcrm-px-1 imcrm-py-2 imcrm-text-xs imcrm-text-foreground imcrm-transition-colors hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring';
    if (href)
        return (
            <a href={href} target={sameTab ? undefined : '_blank'} rel="noreferrer" className={cls} data-testid={testId}>
                {icon}
                <span className="imcrm-truncate">{label}</span>
            </a>
        );
    return (
        <button type="button" onClick={onClick} className={cls} data-testid={testId}>
            {icon}
            <span className="imcrm-truncate">{label}</span>
        </button>
    );
}

/** Los sitios que pueden insertarlo: plegados, porque casi nadie los necesita. */
function DomainsSection({ kind, domains, testId }: { kind: 'form' | 'booking'; domains: { value: string[]; onChange: (v: string[]) => void; unsaved: boolean }; testId: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    const n = domains.value.length;
    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border" data-testid={`${testId}-section`}>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-px-3 imcrm-py-2.5 imcrm-text-left hover:imcrm-bg-muted/50"
                data-testid={`${testId}-toggle`}
            >
                <ShieldCheck className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm imcrm-font-medium">{__('Sitios que pueden insertarlo')}</span>
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                    {n === 0 ? __('Cualquiera') : n === 1 ? __('1 sitio') : __('%d sitios').replace('%d', String(n))}
                </span>
                {domains.unsaved && <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-warning" title={__('Sin guardar')} />}
                <ChevronDown className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform', open && 'imcrm-rotate-180')} />
            </button>
            {open && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-3">
                    <DomainChips value={domains.value} onChange={domains.onChange} testId={testId} />
                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Escribe un sitio y pulsa Enter (ej.: tusitio.com o *.tusitio.com). Sin sitios, se puede insertar en cualquiera.')}
                    </p>
                    {domains.unsaved && (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium">
                            <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-warning" />
                            {__('Guarda los cambios para que valgan.')}
                        </p>
                    )}
                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground" data-testid="embed-test-hint">
                        {kind === 'booking'
                            ? __('Para probarla de verdad, pégala en una página de tu sitio: las páginas para probar HTML en línea la muestran dentro de un marco protegido donde ningún navegador deja cargar una agenda de otro sitio.')
                            : __('Para probarlo de verdad, pégalo en una página de tu sitio: las páginas para probar HTML en línea lo muestran dentro de un marco protegido donde ningún navegador deja cargar un formulario de otro sitio.')}
                    </p>
                </div>
            )}
        </div>
    );
}

/** Un sitio por etiqueta: se agrega con Enter, coma o espacio; Retroceso borra el último. */
export function DomainChips({ value, onChange, testId, autoFocus = true, max = 50 }: { value: string[]; onChange: (v: string[]) => void; testId: string; autoFocus?: boolean; max?: number }): JSX.Element {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (autoFocus) input.current?.focus();
    }, [autoFocus]);
    const add = (raw: string): void => {
        const parts = raw.split(/[\s,;]+/).filter(Boolean);
        if (parts.length === 0) {
            setDraft('');
            return;
        }
        const next = [...value];
        const bad: string[] = [];
        for (const p of parts) {
            const d = cleanEmbedDomain(p);
            if (!d) bad.push(p);
            else if (!next.includes(d)) next.push(d);
        }
        if (next.length !== value.length) onChange(next.slice(0, max));
        setDraft(bad.join(' '));
        setError(bad.length ? __('«%s» no parece un sitio: escribe algo como tusitio.com.').replace('%s', bad[0]!) : null);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <div
                className="imcrm-flex imcrm-min-h-9 imcrm-cursor-text imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-py-1 focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring"
                onClick={() => input.current?.focus()}
            >
                {value.map((d) => (
                    <span key={d} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-py-0.5 imcrm-pl-2 imcrm-pr-1 imcrm-text-xs imcrm-font-medium" data-domain={d}>
                        {d}
                        <button
                            type="button"
                            aria-label={__('Quitar %s').replace('%s', d)}
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange(value.filter((x) => x !== d));
                            }}
                            className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-background hover:imcrm-text-foreground"
                        >
                            <X className="imcrm-h-3 imcrm-w-3" />
                        </button>
                    </span>
                ))}
                <input
                    ref={input}
                    value={draft}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (/[\s,;]/.test(v)) add(v);
                        else {
                            setDraft(v);
                            setError(null);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || (e.key === 'Tab' && draft.trim())) {
                            e.preventDefault();
                            add(draft);
                        } else if (e.key === 'Backspace' && !draft && value.length) {
                            onChange(value.slice(0, -1));
                        }
                    }}
                    onBlur={() => draft.trim() && add(draft)}
                    placeholder={value.length ? __('Agregar otro') : 'tusitio.com'}
                    aria-label={__('Sitios que pueden insertarlo')}
                    className="imcrm-h-7 imcrm-min-w-[120px] imcrm-flex-1 imcrm-bg-transparent imcrm-text-sm imcrm-outline-none"
                    data-testid={testId}
                />
            </div>
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </div>
    );
}
