import { forwardRef, useState, type ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckIcon, Code2, Copy, ExternalLink, Link2, Mail, MessageCircle, QrCode, RefreshCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { EmbedCodePicker } from './EmbedCodePicker';
import { PublicQrCard } from './PublicQrCard';

export type ShareTab = 'link' | 'embed' | 'qr';

/**
 * v0.1.381 — «Compartir» del formulario y de la agenda en una VENTANA (antes
 * era un bloque arriba del constructor que empujaba todo hacia abajo). Tres
 * pestañas: el enlace, insertarlo en tu sitio (con la demostración en vivo de
 * cada forma: en la página, ventana al hacer clic o botón flotante) y el
 * código QR. Todo lo de compartir vive aquí y en ningún otro lado.
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
}): JSX.Element {
    const isForm = kind === 'form';
    const prefix = isForm ? 'form' : 'booking';
    const problems = publishProblems ?? [];
    const TABS: Array<{ id: ShareTab; label: string; icon: typeof Link2 }> = [
        { id: 'link', label: __('Enlace'), icon: Link2 },
        { id: 'embed', label: __('Insertar en tu sitio'), icon: Code2 },
        { id: 'qr', label: __('Código QR'), icon: QrCode },
    ];

    return (
        <RDialog.Root open={open} onOpenChange={onOpenChange}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/45 imcrm-backdrop-blur-sm" />
                <ShareContent data-testid={`${prefix}-share-panel`}>
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4 imcrm-pr-12">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary">
                            <Link2 className="imcrm-h-4 imcrm-w-4" />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <RDialog.Title className="imcrm-text-base imcrm-font-semibold">{isForm ? __('Compartir el formulario') : __('Compartir la agenda')}</RDialog.Title>
                                <span
                                    className={cn(
                                        'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium',
                                        published ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                                    )}
                                    data-testid={`${prefix}-share-status`}
                                    data-published={published ? '' : undefined}
                                >
                                    <span className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full', published ? 'imcrm-bg-success' : 'imcrm-bg-muted-foreground/60')} />
                                    {published ? (isForm ? __('Publicado') : __('Publicada')) : isForm ? __('Sin publicar') : __('Sin publicar')}
                                </span>
                            </div>
                            <RDialog.Description className="imcrm-mt-0.5 imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                {published
                                    ? isForm
                                        ? __('«%s»: cualquiera con el enlace puede responder. Cada respuesta crea un registro en la lista.').replace('%s', name)
                                        : __('«%s»: cualquiera con el enlace puede agendar. Cada cita crea un registro en la lista.').replace('%s', name)
                                    : __('«%s»').replace('%s', name)}
                            </RDialog.Description>
                        </div>
                    </div>

                    {!published && (
                        <div
                            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-border-b imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-5 imcrm-py-2.5 imcrm-text-xs"
                            data-testid={`${prefix}-share-unpublished`}
                        >
                            <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" />
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-font-medium">
                                    {isForm
                                        ? __('Todavía no está publicado: el enlace responde «no disponible» hasta que lo publiques.')
                                        : __('Todavía no está publicada: el enlace responde «no disponible» hasta que la publiques.')}
                                </p>
                                {problems.length > 0 && (
                                    <ul className="imcrm-mt-1 imcrm-list-disc imcrm-pl-4 imcrm-text-muted-foreground" data-testid={`${prefix}-share-problems`}>
                                        {problems.slice(0, 4).map((p) => (
                                            <li key={p}>{p}</li>
                                        ))}
                                        {problems.length > 4 && <li>{__('…y %d más').replace('%d', String(problems.length - 4))}</li>}
                                    </ul>
                                )}
                            </div>
                            <Button size="sm" onClick={onPublish} disabled={publishBusy} data-testid={`${prefix}-share-publish`}>
                                {problems.length > 0 ? __('Ver qué falta') : __('Publicar ahora')}
                            </Button>
                        </div>
                    )}

                    <div role="tablist" aria-label={__('Cómo compartir')} className="imcrm-flex imcrm-gap-1 imcrm-overflow-x-auto imcrm-border-b imcrm-border-border imcrm-px-4">
                        {TABS.map((t) => {
                            const Icon = t.icon;
                            const on = t.id === tab;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    onClick={() => onTab(t.id)}
                                    className={cn(
                                        '-imcrm-mb-px imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-border-b-2 imcrm-px-2.5 imcrm-py-2.5 imcrm-text-sm',
                                        on ? 'imcrm-border-primary imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                    )}
                                    data-testid={`${prefix}-share-tab-${t.id}`}
                                >
                                    <Icon className="imcrm-h-4 imcrm-w-4" />
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4" data-testid={`${prefix}-share-body`} data-tab={tab}>
                        {tab === 'link' && <LinkTab kind={kind} url={url} name={name} testId={`${prefix}-link`} onRegenerate={onRegenerate} />}
                        {tab === 'embed' && (
                            <EmbedCodePicker
                                target={{ url, origin, title: name, kind }}
                                accent={accent}
                                testId={`${prefix}-embed`}
                                dataTour={`${prefix}-embed-mode`}
                                bare={bare}
                                demo={{ path, version, published, dirty, onPublish, onSave, busy: publishBusy }}
                                extra={<DomainsSection kind={kind} domains={domains} testId={`${prefix}-domains`} />}
                            />
                        )}
                        {tab === 'qr' && (
                            <div className="imcrm-mx-auto imcrm-max-w-2xl">
                                <PublicQrCard url={url} name={name} kind={kind} />
                            </div>
                        )}
                    </div>
                </ShareContent>
            </RDialog.Portal>
        </RDialog.Root>
    );
}

// forwardRef: el portal de Radix le pasa una ref al hijo.
const ShareContent = forwardRef<HTMLDivElement, { children: ReactNode; 'data-testid'?: string }>(function ShareContent({ children, ...rest }, ref) {
    return (
        <RDialog.Content
            ref={ref}
            {...rest}
            // En el celular ocupa toda la pantalla; en la computadora, una ventana grande al centro.
            className={cn(
                'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-bg-card imcrm-shadow-imcrm-xl',
                'sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:imcrm-h-[min(92dvh,880px)] sm:imcrm-w-[min(1140px,calc(100vw-2rem))] sm:-imcrm-translate-x-1/2 sm:-imcrm-translate-y-1/2 sm:imcrm-rounded-xl sm:imcrm-border sm:imcrm-border-border',
            )}
        >
            <RDialog.Close asChild>
                <button
                    type="button"
                    aria-label={__('Cerrar')}
                    className="imcrm-absolute imcrm-right-3 imcrm-top-3.5 imcrm-z-10 imcrm-rounded-md imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    data-testid="share-close"
                >
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </RDialog.Close>
            {children}
        </RDialog.Content>
    );
});

function LinkTab({ kind, url, name, testId, onRegenerate }: { kind: 'form' | 'booking'; url: string; name: string; testId: string; onRegenerate?: () => void }): JSX.Element {
    const text = kind === 'booking' ? __('Agenda tu cita aquí: %s').replace('%s', url) : __('%1$s: %2$s').replace('%1$s', name).replace('%2$s', url);
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-2xl imcrm-flex-col imcrm-gap-4">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Tu enlace')}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {kind === 'booking'
                        ? __('Mándalo por WhatsApp, correo o redes, o ponlo en tu biografía de Instagram: quien lo abre ve la agenda y elige su horario.')
                        : __('Mándalo por WhatsApp, correo o redes: quien lo abre ve el formulario y lo responde ahí mismo.')}
                </p>
                <CopyField value={url} testId={testId} />
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button asChild variant="outline" size="sm" className="imcrm-gap-1.5">
                    <a href={url} target="_blank" rel="noreferrer" data-testid={`${testId}-open`}>
                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Abrir en otra pestaña')}
                    </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="imcrm-gap-1.5">
                    <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" data-testid={`${testId}-whatsapp`}>
                        <MessageCircle className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Enviar por WhatsApp')}
                    </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="imcrm-gap-1.5">
                    <a href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(text)}`} data-testid={`${testId}-email`}>
                        <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Enviar por correo')}
                    </a>
                </Button>
            </div>
            {onRegenerate && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Cambiar la dirección')}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Si el enlace se compartió donde no debía: la dirección actual deja de funcionar (también donde la hayas insertado) y se crea una nueva.')}
                    </p>
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={onRegenerate} data-testid={kind === 'booking' ? 'booking-regenerate' : 'form-regenerate'}>
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Cambiar la dirección')}
                    </Button>
                </div>
            )}
        </div>
    );
}

function CopyField({ value, testId }: { value: string; testId: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <div className="imcrm-flex imcrm-gap-1.5">
            <Input readOnly value={value} className="imcrm-h-9 imcrm-font-mono imcrm-text-xs" onFocus={(e) => e.currentTarget.select()} data-testid={testId} />
            <Button
                size="sm"
                className="imcrm-h-9 imcrm-shrink-0 imcrm-gap-1"
                onClick={() =>
                    void navigator.clipboard.writeText(value).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                    })
                }
                data-testid={`${testId}-copy`}
            >
                {copied ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                {copied ? __('Copiado') : __('Copiar')}
            </Button>
        </div>
    );
}

/** Los sitios que pueden insertarlo (va con las opciones de insertar: es parte de lo mismo). */
function DomainsSection({ kind, domains, testId }: { kind: 'form' | 'booking'; domains: { value: string[]; onChange: (v: string[]) => void; unsaved: boolean }; testId: string }): JSX.Element {
    return (
        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Sitios que pueden insertarlo')}</span>
            <DomainsField value={domains.value} onChange={domains.onChange} testId={testId} />
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Uno por renglón (ej.: tusitio.com o *.tusitio.com). Vacío = cualquier sitio.')}
                {domains.unsaved && ' '}
                {domains.unsaved && <strong className="imcrm-font-medium imcrm-text-foreground">{__('Guarda los cambios para que valgan.')}</strong>}
            </p>
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="embed-test-hint">
                {kind === 'booking'
                    ? __('Para probarla de verdad, pégala en una página de tu sitio. Las páginas para probar HTML en línea muestran tu código dentro de un marco protegido y ahí ningún navegador deja cargar una agenda de otro sitio.')
                    : __('Para probarlo de verdad, pégalo en una página de tu sitio. Las páginas para probar HTML en línea muestran tu código dentro de un marco protegido y ahí ningún navegador deja cargar un formulario de otro sitio.')}
            </p>
        </div>
    );
}

function parseDomains(text: string): string[] {
    return text
        .split(/\n|,/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 50);
}

/**
 * Un sitio por renglón. El texto se guarda aparte del valor: si se derivara del
 * valor ya limpio, el Enter para escribir el segundo sitio se borraría al
 * instante (el renglón vacío no es un sitio).
 */
function DomainsField({ value, onChange, testId }: { value: string[]; onChange: (v: string[]) => void; testId: string }): JSX.Element {
    const joined = value.join('\n');
    const [text, setText] = useState(joined);
    const [seen, setSeen] = useState(joined);
    if (joined !== seen) {
        setSeen(joined);
        if (parseDomains(text).join('\n') !== joined) setText(joined);
    }
    return (
        <Textarea
            rows={3}
            value={text}
            onChange={(e) => {
                setText(e.target.value);
                const next = parseDomains(e.target.value);
                setSeen(next.join('\n'));
                onChange(next);
            }}
            placeholder={'tusitio.com\n*.tusitio.com'}
            className="imcrm-text-xs"
            data-testid={testId}
        />
    );
}
