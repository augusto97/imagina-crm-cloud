import type { OnboardingStatus, OnboardingStepId } from '@imagina-base/shared';
import {
    BellRing,
    Bot,
    Inbox,
    LayoutGrid,
    ListPlus,
    Mail,
    MessageSquare,
    Palette,
    Pin,
    Sparkles,
    Upload,
    UserPlus,
    Zap,
    type LucideIcon,
} from 'lucide-react';

/**
 * F7 — El catálogo de «Primeros pasos»: qué dice cada paso, por qué sirve,
 * qué recorrido lo muestra (si la entrega de guías lo registró) y adónde
 * lleva «Hacerlo». Puro: se prueba sin montar nada.
 */
export interface StepMeta {
    title: string;
    why: string;
    icon: LucideIcon;
    /** Id canónico del recorrido (helpBus); «Muéstrame» sólo si existe. */
    tour: string | null;
}

export const STEP_META: Record<OnboardingStepId, StepMeta> = {
    create_list: {
        title: 'Crea tu primera lista',
        why: 'Una lista guarda tus registros: clientes, tareas, pedidos… lo que necesites.',
        icon: ListPlus,
        tour: 'create-list',
    },
    add_records: {
        title: 'Agrega o importa tus registros',
        why: 'Carga tus datos reales a mano o desde un Excel o CSV.',
        icon: Upload,
        tour: 'import',
    },
    create_view: {
        title: 'Crea una vista: tablero, calendario…',
        why: 'Mira los mismos registros como tablero, calendario o tarjetas.',
        icon: LayoutGrid,
        tour: 'views',
    },
    invite_team: {
        title: 'Invita a tu equipo',
        why: 'Trabajen juntos, cada persona con su rol.',
        icon: UserPlus,
        tour: 'invite-team',
    },
    automation: {
        title: 'Crea una automatización',
        why: 'Que la app haga sola las tareas que se repiten.',
        icon: Zap,
        tour: 'automation-basics',
    },
    branding: {
        title: 'Ponle tu marca',
        why: 'Tu logo y tus colores en la app y en lo que ven tus clientes.',
        icon: Palette,
        tour: 'branding',
    },
    company_mail: {
        title: 'Conecta el correo de la empresa',
        why: 'Los avisos y correos salen desde tu propia dirección.',
        icon: Mail,
        tour: null,
    },
    install_app: {
        title: 'Instala la app y activa las notificaciones',
        why: 'Tenla a un toque y entérate al instante de lo importante.',
        icon: BellRing,
        tour: 'install-app',
    },
    assistant: {
        title: 'Pregúntale al asistente IA',
        why: 'Pídele en tus palabras una lista, un tablero o un dato.',
        icon: Bot,
        tour: 'assistant',
    },
    comment_record: {
        title: 'Abre un registro y deja un comentario',
        why: 'Conversa con tu equipo dentro de cada registro, con todo a la vista.',
        icon: MessageSquare,
        tour: 'record',
    },
    my_work: {
        title: 'Mira «Mi trabajo»',
        why: 'Todo lo que tienes asignado y lo que vence, en un solo lugar.',
        icon: Inbox,
        tour: null,
    },
    save_view: {
        title: 'Guarda una vista o un favorito',
        why: 'Ten a mano lo que más usas, con tus filtros y tu orden.',
        icon: Pin,
        tour: 'views',
    },
};

/** El ícono de la entrada «Agrega más con IA». */
export const ADD_MORE_ICON = Sparkles;

/** Adónde lleva «Hacerlo» (o qué hace en el lugar). */
export type StepAction =
    | { kind: 'navigate'; to: string }
    | { kind: 'create-list' }
    | { kind: 'open-assistant' }
    | { kind: 'install' };

export function stepAction(
    id: OnboardingStepId,
    status: Pick<OnboardingStatus, 'first_list' | 'has_lists' | 'welcome'>,
    opts: { canPromptInstall: boolean },
): StepAction {
    const list = status.first_list;
    const records = (suffix = ''): StepAction => (list ? { kind: 'navigate', to: `/lists/${list.slug}/records${suffix}` } : { kind: 'navigate', to: '/lists' });
    switch (id) {
        case 'create_list':
            // Sin listas y con la bienvenida pendiente, a la bienvenida; si no, el diálogo de lista nueva.
            return !status.has_lists && status.welcome ? { kind: 'navigate', to: '/lists' } : { kind: 'create-list' };
        case 'add_records':
            return records('?import=1');
        case 'create_view':
        case 'comment_record':
        case 'save_view':
            return records();
        case 'invite_team':
            return { kind: 'navigate', to: '/settings?s=miembros' };
        case 'automation':
            return list ? { kind: 'navigate', to: `/lists/${list.slug}/automations` } : { kind: 'navigate', to: '/lists' };
        case 'branding':
            return { kind: 'navigate', to: '/settings?s=marca' };
        case 'company_mail':
            return { kind: 'navigate', to: '/settings?s=correo' };
        case 'install_app':
            return opts.canPromptInstall ? { kind: 'install' } : { kind: 'navigate', to: '/settings?s=seguridad' };
        case 'assistant':
            return { kind: 'open-assistant' };
        case 'my_work':
            return { kind: 'navigate', to: '/my-work' };
    }
}

/** «3 de 8»: los hechos sobre los que no se saltaron (saltar uno lo saca de la cuenta). */
export function stepProgress(steps: OnboardingStatus['steps']): { done: number; total: number; ratio: number } {
    const total = steps.filter((s) => !s.skipped).length;
    const done = steps.filter((s) => s.done).length;
    return { done, total, ratio: total === 0 ? 1 : Math.min(1, done / total) };
}
