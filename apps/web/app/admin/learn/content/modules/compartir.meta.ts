import type { LearnModuleMeta } from '../types';

export const meta: LearnModuleMeta = {
    id: 'compartir',
    group: 'share',
    order: 4,
    title: 'Compartir hacia afuera',
    tagline: '¿Cómo le muestro esto a alguien de afuera? Páginas públicas, tableros por enlace o por correo, invitados y enlaces para tu equipo.',
    icon: 'Share2',
    tone: 'blue',
    hero: 'comp-hero',
    highlights: [
        'Elige la forma correcta de compartir según quién mira y qué tiene que poder hacer',
        'Publica una lista de sólo lectura con los campos que elijas, filtrada por una vista y con fecha de vencimiento',
        'Comparte un tablero con un enlace o mándalo por correo cada semana',
        'Invita a un proveedor o a tu contador a una lista o a un solo registro, sin gastar usuarios',
    ],
    articles: [
        {
            id: 'compartir-opciones',
            title: '¿Cómo le muestro esto a alguien de afuera?',
            summary: 'Una guía para elegir entre página pública, portal, formulario, agenda, tablero por enlace o por correo, invitado o enlace para tu equipo.',
            minutes: 5,
            level: 'basic',
            keywords: 'compartir afuera publico cliente proveedor contador enlace link que opcion elegir',
        },
        {
            id: 'compartir-lista-publica',
            title: 'Publicar una lista en una página pública',
            summary: 'Una página de sólo lectura con los campos que elijas, filtrada por una vista, con buscador, fecha de vencimiento y lista para insertar en tu sitio.',
            minutes: 8,
            level: 'intermediate',
            keywords: 'lista publica pagina publica solo lectura enlace publico insertar iframe campos visibles vista filtros vence dominios catalogo menu',
            needs: 'manage_lists',
        },
        {
            id: 'compartir-tableros',
            title: 'Mostrar un tablero: enlace público y resumen por correo',
            summary: 'Publica un tablero para verlo sin iniciar sesión, o programa un correo con sus indicadores cada día, semana o mes.',
            minutes: 6,
            level: 'intermediate',
            keywords: 'tablero publico enlace dashboard correo programado resumen semanal pdf socios junta directiva',
            needs: 'manage_dashboards',
        },
        {
            id: 'compartir-personas',
            title: 'Compartir con tu equipo, con invitados y con un enlace a una vista',
            summary: 'Da acceso a una persona o a un equipo, invita a alguien de afuera a una lista o a un solo registro, y copia el enlace de una vista o de un registro.',
            minutes: 7,
            level: 'basic',
            keywords: 'invitado invitar proveedor contador compartir registro compartir lista personas con acceso equipos copiar vinculo a la vista enlace del registro',
        },
    ],
};
