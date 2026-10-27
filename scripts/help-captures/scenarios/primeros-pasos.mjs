/** Demos de prueba del grabador (v0.1.322). */
export default [
    {
        key: 'records-open',
        title: 'Abrir un registro',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-table"]', caption: 'Esta es la lista de clientes: cada fila es un registro.' },
            { click: '[data-tour="records-row"] >> nth=0', caption: 'Haz clic en el nombre para abrir su ficha.' },
            { shot: '[data-tour="record-fields"]', caption: 'En la ficha ves y cambias todos sus datos; se guardan solos.' },
        ],
    },
];
