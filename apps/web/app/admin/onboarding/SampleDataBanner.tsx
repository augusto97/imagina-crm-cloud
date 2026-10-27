import { FlaskConical, Loader2 } from 'lucide-react';

import { useDeleteSamples, useOnboardingStatus } from '@/hooks/useOnboarding';
import { useIsGuest } from '@/lib/guest';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';

/**
 * F7 — el aviso discreto de una lista que tiene datos de ejemplo de la
 * bienvenida. Desaparece solo cuando ya no queda ninguno (borrados con el
 * botón, uno por uno o desde la papelera).
 */
export function SampleDataBanner({ listId }: { listId: number | undefined }): JSX.Element | null {
    const isGuest = useIsGuest();
    const canDelete = useCan(CAP.DELETE_RECORDS);
    const status = useOnboardingStatus(!isGuest && listId !== undefined);
    const samples = useDeleteSamples();
    const entry = listId !== undefined ? status.data?.samples.find((s) => s.list_id === listId) : undefined;
    if (!entry || entry.count === 0) return null;
    return (
        <div
            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-[13px]"
            data-testid="sample-data-banner"
        >
            <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                <FlaskConical className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                {__('Estos son datos de ejemplo para que veas cómo funciona.')}
            </span>
            {canDelete && (
                <button
                    type="button"
                    onClick={() => void samples.run(listId)}
                    disabled={samples.pending}
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-semibold imcrm-text-primary hover:imcrm-underline disabled:imcrm-opacity-60 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40 focus-visible:imcrm-rounded"
                    data-testid="sample-data-delete"
                >
                    {samples.pending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />}
                    {__('Borrar los datos de ejemplo')}
                </button>
            )}
        </div>
    );
}
