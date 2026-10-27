import { useMemo } from 'react';
import { BookOpen, CircleHelp, Compass, type LucideIcon } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';

import { searchGuides } from './guideAccess';
import { help, useHelpAvailability } from './helpBus';
import { useHelpGuides } from './useHelpGuides';

/** Lo mismo que un comando de la paleta global (Ctrl+K). */
export interface PaletteHelpCommand {
    id: string;
    label: string;
    description?: string;
    icon: LucideIcon;
    section: string;
    keywords?: string;
    action: () => void;
}

const MAX_GUIDES = 4;

/** Se ejecuta cuando la paleta terminó de cerrarse (si no, le devuelve el foco a su botón). */
function afterClose(fn: () => void): () => void {
    return () => window.setTimeout(fn, 0);
}

/**
 * Fase 7 — la ayuda dentro de la búsqueda global: las guías que coinciden con
 * lo escrito (sección «Ayuda») y dos acciones fijas, «Abrir la ayuda» y el
 * recorrido por la app. El catálogo de guías se pide recién al abrir la
 * paleta. Sin el centro de ayuda montado, no devuelve nada.
 */
export function usePaletteHelpCommands(
    query: string,
    open: boolean,
): { guides: PaletteHelpCommand[]; actions: PaletteHelpCommand[] } {
    const availability = useHelpAvailability();
    const guides = useHelpGuides(open && availability.help);
    const q = query.trim();

    const guideCommands = useMemo<PaletteHelpCommand[]>(() => {
        if (!availability.help || !guides || q.length < 2) return [];
        return searchGuides(guides, q, MAX_GUIDES).map(({ guide, restricted }) => ({
            id: `help-${guide.id}`,
            label: guide.title,
            description: restricted ? __('Guía · Lo hace un administrador') : sprintf(__('Guía · %d min'), guide.minutes),
            icon: BookOpen,
            section: __('Ayuda'),
            action: afterClose(() => help.openHelp({ guideId: guide.id })),
        }));
    }, [availability.help, guides, q]);

    const actions = useMemo<PaletteHelpCommand[]>(() => {
        if (!availability.help) return [];
        const out: PaletteHelpCommand[] = [
            {
                id: 'help-open',
                label: __('Abrir la ayuda'),
                description: __('Guías rápidas, recorridos y soporte'),
                icon: CircleHelp,
                section: __('Acciones'),
                keywords: 'ayuda guias como hago soporte tutorial manual preguntas',
                action: afterClose(() => help.openHelp()),
            },
        ];
        if (help.hasTour('welcome')) {
            out.push({
                id: 'help-welcome-tour',
                label: __('Recorrido por la app'),
                description: __('2 minutos por lo principal'),
                icon: Compass,
                section: __('Acciones'),
                keywords: 'recorrido tour bienvenida guia mostrar ensenar',
                action: afterClose(() => help.startTour('welcome')),
            });
        }
        return out;
    }, [availability]);

    return useMemo(() => ({ guides: guideCommands, actions }), [guideCommands, actions]);
}
