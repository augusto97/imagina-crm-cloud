import { BackToIndex } from '@/components/nav/SectionIndex';
import { __ } from '@/lib/i18n';

import { MobileNavEditor } from './MobileNavEditor';

/**
 * v0.1.347 — «Más → Barra de abajo»: el editor de la barra del celular a
 * página completa (en el teléfono es donde se usa; la barra de verdad, abajo,
 * cambia mientras se edita).
 */
export function MobileNavPage(): JSX.Element {
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-xl imcrm-flex-col imcrm-gap-3 imcrm-pb-6 imcrm-pt-1" data-testid="mobilenav-page">
            <BackToIndex to="/menu" label={__('Más')} />
            <div>
                <h1 className="imcrm-text-xl imcrm-font-semibold">{__('Barra de abajo')}</h1>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Elige cuántos botones tiene y cuáles: las secciones que más usas, una lista o un tablero puntual, buscar o escanear.')}
                </p>
            </div>
            <MobileNavEditor />
        </div>
    );
}
