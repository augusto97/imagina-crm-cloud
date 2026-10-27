import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { whatsNewVideo, type WhatsNewItem } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useWhatsNewEvent, useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { useIsGuest } from '@/lib/guest';
import { __ } from '@/lib/i18n';

import { WhatsNewActionButton } from './WhatsNewActionButton';
import { WhatsNewImage, WhatsNewKindChip, WhatsNewVideo, type WhatsNewCardItem } from './WhatsNewCard';
import { WhatsNewRichText } from './WhatsNewRichText';
import { canPresentNow, isOnWhatsNewPage, rememberPresented, screenIsBusy } from './featuredGate';
import { whatsNewPanel } from './whatsNewStore';

/** Espera antes del primer intento (que la app termine de armarse). */
const FIRST_WAIT_MS = 2500;
const RETRY_MS = 4000;
const MAX_TRIES = 30;

/**
 * Destacadas: al entrar, una novedad importante se presenta en un diálogo
 * («Nuevo: …» con su imagen, texto y botón). A cada persona una sola vez (lo
 * guarda el servidor), una por sesión, nunca a un invitado ni mientras el
 * operador mira como otra persona, y nunca encima de otra cosa: si hay un
 * diálogo, un recorrido o la bienvenida, espera.
 */
export function FeaturedWhatsNewDialog(): JSX.Element | null {
    const feed = useWhatsNewFeed();
    const event = useWhatsNewEvent();
    const isGuest = useIsGuest();
    const impersonating = useSession((s) => s.impersonating);
    const [shown, setShown] = useState<WhatsNewItem | null>(null);
    const [open, setOpen] = useState(false);
    const candidate = feed.data?.featured ?? null;
    const eventRef = useRef(event);
    eventRef.current = event;

    useEffect(() => {
        if (!candidate || shown || isGuest || impersonating) return;
        if (!canPresentNow(Date.now())) return;
        let tries = 0;
        let timer = 0;
        const attempt = (): void => {
            tries += 1;
            if (!whatsNewPanel.get().open && !isOnWhatsNewPage() && !screenIsBusy()) {
                rememberPresented(Date.now());
                setShown(candidate);
                setOpen(true);
                eventRef.current.mutate({ id: candidate.id, event: 'presented' });
                return;
            }
            if (tries < MAX_TRIES) timer = window.setTimeout(attempt, RETRY_MS);
        };
        timer = window.setTimeout(attempt, FIRST_WAIT_MS);
        return () => window.clearTimeout(timer);
    }, [candidate, shown, isGuest, impersonating]);

    if (!shown) return null;

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 motion-safe:imcrm-animate-imcrm-fade-in" />
                <Dialog.Content
                    data-testid="whats-new-featured"
                    // El foco arranca en el botón principal (no en la X): Enter lo prueba, Escape lo cierra.
                    onOpenAutoFocus={(e) => {
                        const primary = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-whats-new-action], [data-whats-new-primary]');
                        if (primary) {
                            e.preventDefault();
                            primary.focus();
                        }
                    }}
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[88dvh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-lg motion-safe:imcrm-animate-imcrm-scale-in"
                >
                    <Dialog.Close
                        aria-label={__('Cerrar')}
                        className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-card/80 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                    >
                        <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </Dialog.Close>
                    <FeaturedWhatsNewContent
                        item={shown}
                        renderTitle={(children) => (
                            <Dialog.Title className="imcrm-pr-6 imcrm-text-lg imcrm-font-semibold imcrm-leading-snug imcrm-tracking-tight">{children}</Dialog.Title>
                        )}
                        renderSummary={(children) => (
                            <Dialog.Description className="imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">{children}</Dialog.Description>
                        )}
                        onLater={() => setOpen(false)}
                        onAction={() => {
                            if (!impersonating) event.mutate({ id: shown.id, event: 'clicked' });
                            setOpen(false);
                        }}
                        onSeeAll={() => {
                            setOpen(false);
                            whatsNewPanel.open(String(shown.id));
                        }}
                    />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * Lo de adentro del diálogo de una destacada. La misma pieza en el diálogo real
 * y en la vista previa del operador.
 */
export function FeaturedWhatsNewContent({
    item,
    renderTitle,
    renderSummary,
    onLater,
    onAction,
    onSeeAll,
}: {
    item: WhatsNewCardItem;
    renderTitle: (children: ReactNode) => ReactNode;
    renderSummary: (children: ReactNode) => ReactNode;
    onLater?: () => void;
    onAction?: () => void;
    onSeeAll?: () => void;
}): JSX.Element {
    const hasVideo = !item.image_url && item.video_url !== null && whatsNewVideo(item.video_url) !== null;
    return (
        <>
            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto">
                {item.image_url ? (
                    <WhatsNewImage src={item.image_url} className="imcrm-max-h-64 imcrm-rounded-none imcrm-border-0 imcrm-border-b" />
                ) : (
                    !hasVideo && <div aria-hidden className="imcrm-h-2 imcrm-bg-gradient-to-r imcrm-from-primary/70 imcrm-via-primary/40 imcrm-to-primary/10" />
                )}
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-5 sm:imcrm-p-6">
                    <WhatsNewKindChip kind={item.kind} className="imcrm-self-start" />
                    {renderTitle(
                        <>
                            <span className="imcrm-text-primary">{__('Nuevo:')}</span> {item.title}
                        </>,
                    )}
                    {renderSummary(item.summary)}
                    {hasVideo && item.video_url && <WhatsNewVideo url={item.video_url} title={item.title} />}
                    <WhatsNewRichText text={item.body} />
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-col-reverse imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-bg-canvas/40 imcrm-px-5 imcrm-py-3 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={onLater} data-testid="whats-new-featured-later">
                    {__('Más tarde')}
                </Button>
                {item.action ? (
                    <WhatsNewActionButton action={item.action} variant="default" size="sm" onActivate={onAction} />
                ) : (
                    <Button type="button" size="sm" onClick={onSeeAll} data-whats-new-primary="">
                        {__('Ver las novedades')}
                    </Button>
                )}
            </div>
        </>
    );
}
