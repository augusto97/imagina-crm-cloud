import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { OnboardingApplyResult } from '@imagina-base/shared';

import { useToastOptional } from '@/components/ui/toast';
import { help } from '@/admin/help/helpBus';
import { __ } from '@/lib/i18n';

/** Lo que la pantalla tarda en asentarse antes de arrancar el recorrido. */
const SETTLE_MS = 700;

/**
 * Qué pasa después de crear el espacio: se abre la primera lista y, si la
 * entrega de guías registró el recorrido de bienvenida, arranca; si no,
 * se abre «Primeros pasos». Cualquiera de las dos piezas puede faltar.
 */
export function useFinishWelcome(): (res: OnboardingApplyResult) => void {
    const navigate = useNavigate();
    const toast = useToastOptional();
    return useCallback(
        (res: OnboardingApplyResult) => {
            const first = res.lists[0];
            if (first) navigate(`/lists/${first.slug}/records`);
            // Sin aviso de «listo»: lo dice la lista abierta y «Primeros pasos»
            // (un aviso en la esquina tapaba justo ese panel). Sólo lo que falló.
            if (res.warnings.length > 0) toast?.warning(__('Algunas cosas no se pudieron crear'), res.warnings.slice(0, 3).join(' · '));
            window.setTimeout(() => {
                if (help.hasTour('welcome') && help.startTour('welcome')) return;
                help.openGettingStarted();
            }, SETTLE_MS);
        },
        [navigate, toast],
    );
}
