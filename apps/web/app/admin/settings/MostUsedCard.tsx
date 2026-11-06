import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useMostUsedItems, useMostUsedState, useUpdateMostUsed } from '@/hooks/useMostUsed';
import { __, sprintf } from '@/lib/i18n';

/**
 * v0.1.385 — Ajustes → Cuenta → Apariencia: mostrar u ocultar «Más usadas»
 * (encendida por defecto) y empezar de cero. Se guarda en la cuenta de la
 * persona, por empresa: vale igual en el computador y en el celular.
 */
export function MostUsedCard(): JSX.Element {
    const state = useMostUsedState();
    const { items } = useMostUsedItems();
    const update = useUpdateMostUsed();
    const confirm = useConfirm();
    const toast = useToast();
    const enabled = state.data?.enabled !== false;

    const reset = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Empezar de cero?'),
            description: __('Se borra lo que se contó hasta ahora y la sección queda vacía hasta que vuelvas a usar tus listas y tableros en dos días distintos.'),
            confirmLabel: __('Empezar de cero'),
        });
        if (!ok) return;
        update.mutate({ reset: true }, { onSuccess: () => toast.success(__('Listo: «Más usadas» empieza de cero.')) });
    };

    return (
        <section className="imcrm-flex imcrm-max-w-xl imcrm-flex-col imcrm-gap-3" id="mas-usadas" data-tour="settings-most-used">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('«Más usadas» en el menú de Listas')}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Arriba del menú de Listas (y de la pantalla de Listas del celular) aparecen las listas y tableros que más abres, para llegar de un clic.')}
                </p>
            </div>

            <label className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
                <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Mostrar «Más usadas»')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {enabled
                            ? __('Mientras esté encendida se cuenta cada vez que entras a una lista o a un tablero.')
                            : __('Oculta: no se muestra ni se cuenta nada.')}
                    </span>
                </span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={enabled}
                    disabled={state.isLoading}
                    onChange={(e) => update.mutate({ enabled: e.target.checked })}
                    data-testid="most-used-toggle"
                    className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-accent-primary"
                />
            </label>

            {enabled && (
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="most-used-now">
                    {items.length > 0
                        ? sprintf(__('Ahora se ven: %s.'), items.map((i) => i.label).join(', '))
                        : __('Todavía no hay ninguna: aparecen cuando usas una lista o un tablero en dos días distintos.')}
                </p>
            )}

            <ul className="imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-1 imcrm-pl-5 imcrm-text-[13px] imcrm-text-muted-foreground">
                <li>{__('Cuenta entrar a una lista o a un tablero, como mucho una vez cada 30 minutos. Abrir un registro, cambiar de vista o entrar a los ajustes no cuenta.')}</li>
                <li>{__('Lo que usas seguido sube y lo que dejas de usar baja solo en un par de semanas.')}</li>
                <li>{__('El orden no cambia mientras trabajas: se renueva al día siguiente o al volver a abrir la app.')}</li>
                <li>{__('Se guarda en tu cuenta: es lo mismo en el computador y en el celular. Cada empresa tiene la suya.')}</li>
            </ul>

            <Button type="button" variant="outline" onClick={() => void reset()} className="imcrm-self-start" data-testid="most-used-reset" disabled={update.isPending}>
                <RotateCcw className="imcrm-h-4 imcrm-w-4" aria-hidden />
                {__('Empezar de cero')}
            </Button>
        </section>
    );
}
