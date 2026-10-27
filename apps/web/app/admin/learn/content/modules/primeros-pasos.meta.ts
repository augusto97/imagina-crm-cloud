import type { LearnModuleMeta } from '../types';

export const meta: LearnModuleMeta = {
    id: 'primeros-pasos',
    group: 'start',
    order: 1,
    title: 'Primeros pasos',
    tagline: 'Las piezas de la app y cómo moverte por ella en cinco minutos.',
    icon: 'Compass',
    tone: 'blue',
    hero: 'kanban-drag',
    highlights: ['Qué son las listas, los registros y los campos', 'Cómo moverte por el menú, buscar y usar atajos', 'Dónde quedan tus avisos y tu trabajo pendiente'],
    articles: [
        {
            id: 'primeros-pasos-piezas',
            title: 'Las tres piezas: listas, registros y campos',
            summary: 'Todo en la app se arma con listas. Entiende cómo se relacionan y qué puedes construir con ellas.',
            minutes: 3,
            level: 'basic',
            keywords: 'conceptos base de datos tabla fila columna',
        },
    ],
};
