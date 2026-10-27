import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    {
        id: 'primeros-pasos-piezas',
        route: '/lists',
        related: [],
        blocks: [
            { t: 'p', md: 'Piensa en la app como una hoja de cálculo con superpoderes. Cada **lista** guarda un tipo de cosa (clientes, facturas, tareas), cada **registro** es una fila y cada **campo** es una columna.' },
            { t: 'anim', key: 'kanban-drag', caption: 'La misma lista de oportunidades vista como tablero por etapa.' },
            { t: 'h', text: 'Una lista, muchas formas de verla' },
            { t: 'p', md: 'Los mismos registros se pueden ver como **tabla**, **tablero**, **calendario** o **Gantt**. Cambiar de vista no cambia los datos: sólo cómo los miras.' },
            { t: 'demo', key: 'records-open', caption: 'Abrir un registro desde la tabla.', fallback: 'kanban-drag' },
            { t: 'settings', title: 'Lo que tiene cada campo', rows: [
                { name: 'Tipo', what: 'Texto, número, moneda, fecha, selección, persona, archivo… define qué se puede escribir.', tip: 'Elige el tipo correcto desde el principio: así filtrar y sumar funciona solo.' },
                { name: 'Obligatorio', what: 'No deja guardar un registro sin ese dato.' },
            ] },
            { t: 'callout', tone: 'tip', md: 'Empieza con una **plantilla**: trae la lista armada con campos, vistas y datos de ejemplo.' },
            { t: 'example', title: 'Una agencia de viajes', md: 'Una lista **Clientes**, otra **Viajes** vinculada a cada cliente y otra **Pagos**. En la ficha del cliente ves sus viajes y cuánto debe.' },
            { t: 'faq', items: [{ q: '¿Cuántas listas puedo tener?', a: 'Las que necesites; tu plan define cuántos registros en total.' }] },
            { t: 'actions', items: [{ label: 'Ir a mis listas', to: '/lists' }, { label: 'Ver el recorrido', tour: 'lists-and-records' }] },
        ],
    },
];
