/**
 * Capturas del módulo «Listas y campos» (centro de aprendizaje).
 * Corren sobre la empresa de ejemplo y no crean nada: cada diálogo se
 * cierra sin guardar.
 */

const scrollTo = (sel) => async ({ page }) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
};

export default [
    {
        key: 'lc-crear',
        title: 'Crear una lista',
        steps: [
            { go: '/lists', wait: '[data-tour="panel-new-list"]', caption: 'Las listas se crean desde el panel lateral o desde la página de Listas.' },
            { click: '[data-tour="panel-new-list"]', caption: 'Toca «Nueva lista».', then: 'role=dialog' },
            { click: '[role="dialog"] button:has-text("Facturación")', caption: 'En «Plantilla» eliges una lista lista para usar. Toca una para ver qué trae.' },
            { shot: '[role="dialog"]', caption: 'La vista previa muestra los campos, las vistas, las automatizaciones y si trae tablero o registros de ejemplo.' },
            { click: '[role="dialog"] button:has-text("En blanco")', caption: '«En blanco» arranca de cero.' },
            { shot: '[role="dialog"]', caption: 'Sólo le pones nombre y, si quieres, una descripción; los campos los agregas después.' },
            { click: '[role="dialog"] button:has-text("Duplicar")', caption: '«Duplicar» copia una lista que ya tienes.' },
            { shot: '[role="dialog"]', caption: 'Eliges la lista, el nombre de la copia y qué incluir: vistas, automatizaciones, ajustes y registros.' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'lc-ajustes',
        title: 'Los ajustes de una lista',
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=general', wait: 'text=Dirección web', caption: 'En la configuración de la lista, «General» guarda el nombre, el ícono, la dirección web y la descripción.' },
            { click: '[role="tablist"] >> text=Apariencia', caption: 'Las pestañas de arriba ordenan el resto: campos, apariencia, permisos, compartir, documentos y más.' },
            { shot: true, caption: '«Apariencia» define cómo se ve la ficha de cada registro.' },
            { click: '[role="tablist"] >> text=Permisos', caption: '«Permisos» decide quién ve y quién edita esta lista.' },
            { shot: true, caption: 'Cada pestaña guarda lo suyo: no hay un botón general que guarde todo junto.' },
        ],
    },
    {
        key: 'lc-campos',
        title: 'El administrador de campos',
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=campos', wait: 'text=Todos los campos', caption: 'En «Campos» ves todos los campos de la lista, agrupados por tipo.' },
            { shot: 'text=Por tipo', caption: 'A la izquierda filtras por tipo o saltas a los campos de otra lista.' },
            { click: 'text=NIT / RUT', caption: 'Toca un campo para abrir todos sus ajustes.', then: 'role=dialog' },
            { shot: '[role="dialog"]', caption: 'Nombre, descripción, tipo, configuración, valor por defecto, validaciones y quién lo ve.' },
        ],
    },
    {
        key: 'lc-agregar-campo',
        title: 'Agregar un campo desde la tabla',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-testid="floating-add-column"] button', caption: 'En la tabla, el botón «+» de la derecha agrega una columna.' },
            { click: '[data-testid="floating-add-column"] button', caption: 'Tócalo.', then: 'role=dialog' },
            { click: '[role="dialog"] >> text=Selección >> nth=0', caption: 'Arriba están los tipos más usados y abajo todos. Elige uno, por ejemplo «Selección».' },
            { shot: '[role="dialog"]', caption: 'Ponle nombre y, en una selección, sus opciones con color. Al tocar «Crear campo» aparece como columna.' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'lc-formula',
        title: 'Un campo con fórmula',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-testid="floating-add-column"] button', caption: null },
            { wait: 1200 },
            { click: '[data-testid="floating-add-column"] button', caption: null, then: 'role=dialog' },
            { click: '[role="dialog"] >> text=Fórmula', caption: 'En el catálogo de campos elige «Fórmula».', then: '[role="dialog"] textarea' },
            { fill: '[role="dialog"] input[placeholder="Ej. Estado"]', text: 'Estado de pago', caption: 'Ponle nombre.' },
            { fill: '[role="dialog"] textarea', text: 'SI({Saldo pendiente} > 0, "Debe", "Al día")', caption: 'Escribe la fórmula. Los campos van entre llaves, con su nombre.' },
            { run: scrollTo('[role="dialog"] >> text=Mostrar el resultado como') },
            { shot: '[role="dialog"]', caption: 'La vista previa la calcula con un registro real antes de crearla.' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'lc-reglas',
        title: 'Validaciones y valor por defecto',
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=campos', wait: 'text=Todos los campos', caption: null },
            { click: 'text=NIT / RUT', caption: 'Abre el campo que quieres controlar.', then: 'role=dialog' },
            { run: scrollTo('[role="dialog"] >> text=Valor por defecto') },
            { shot: '[role="dialog"]', caption: '«Valor por defecto» se pone solo cuando un registro nace sin ese dato.' },
            { run: scrollTo('[role="dialog"] >> text=Formato') },
            { shot: '[role="dialog"]', caption: '«Validaciones» revisa el dato al guardar: largo, formato (NIT, cédula, placa…) y obligatorio sólo en ciertos casos.' },
            { press: 'Escape', caption: null },
        ],
    },
];
