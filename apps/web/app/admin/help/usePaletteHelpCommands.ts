import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, CircleHelp, Compass, GraduationCap, Lightbulb, type LucideIcon } from 'lucide-react';

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
const MAX_ARTICLES = 4;

type LearnRegistry = typeof import('@/admin/learn/content/registry');
type IdeasCatalog = typeof import('@/admin/ideas/catalog');
const MAX_IDEAS = 3;

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
    const navigate = useNavigate();
    const q = query.trim();

    // v0.1.322 — el índice del centro de aprendizaje se baja recién al abrir
    // la paleta (no viaja en la carga inicial).
    const [learn, setLearn] = useState<LearnRegistry | null>(null);
    useEffect(() => {
        if (!open || learn) return;
        let alive = true;
        void import('@/admin/learn/content/registry').then((m) => alive && setLearn(m));
        return () => {
            alive = false;
        };
    }, [open, learn]);

    // v0.1.323 — las ideas también aparecen al buscar («cobrar», «whatsapp»…).
    const [ideas, setIdeas] = useState<IdeasCatalog | null>(null);
    useEffect(() => {
        if (!open || ideas) return;
        let alive = true;
        void import('@/admin/ideas/catalog').then((m) => alive && setIdeas(m));
        return () => {
            alive = false;
        };
    }, [open, ideas]);

    const ideaCommands = useMemo<PaletteHelpCommand[]>(() => {
        if (!ideas || q.length < 3) return [];
        return ideas
            .searchIdeas(q)
            .slice(0, MAX_IDEAS)
            .map((i) => ({
                id: `idea-${i.id}`,
                label: i.title,
                description: __('Idea para tu negocio · se activa con un clic'),
                icon: Lightbulb,
                section: __('Ayuda'),
                action: afterClose(() => navigate(`/ideas/${i.id}`)),
            }));
    }, [ideas, q, navigate]);

    const learnCommands = useMemo<PaletteHelpCommand[]>(() => {
        if (!learn || q.length < 2) return [];
        return learn
            .searchManual(q, null, (m, a) => !m.operatorOnly && !a?.operatorOnly)
            .slice(0, MAX_ARTICLES)
            .map((h) => ({
                id: `learn-${h.article.id}`,
                label: h.article.title,
                description: sprintf(__('Centro de aprendizaje · %s'), h.module.title),
                icon: GraduationCap,
                section: __('Ayuda'),
                action: afterClose(() => navigate(`/aprende/${h.module.id}/${h.article.id}`)),
            }));
    }, [learn, q, navigate]);

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
                id: 'help-learn-center',
                label: __('Centro de aprendizaje'),
                description: __('Guías completas con animaciones y capturas'),
                icon: GraduationCap,
                section: __('Acciones'),
                keywords: 'aprender aprende manual curso tutorial guias completas capacitacion',
                action: afterClose(() => navigate('/aprende')),
            },
            {
                id: 'help-ideas',
                label: __('Ideas para tu negocio'),
                description: __('Casos de uso listos para activar'),
                icon: Lightbulb,
                section: __('Acciones'),
                keywords: 'ideas recetas ejemplos casos de uso inspiracion automatizar que puedo hacer',
                action: afterClose(() => navigate('/ideas')),
            },
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
    }, [availability, navigate]);

    return useMemo(() => ({ guides: [...ideaCommands, ...learnCommands, ...guideCommands], actions }), [ideaCommands, learnCommands, guideCommands, actions]);
}
