/**
 * Capturas del módulo «Importar, exportar y plantillas» (centro de
 * aprendizaje). No importan ni cambian nada: cada diálogo se cierra antes de
 * confirmar.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NEW_CLIENTS = path.join(tmpdir(), 'ie-clientes-nuevos.csv');
const FEES = path.join(tmpdir(), 'ie-cuotas-noviembre.csv');

function writeFiles() {
    writeFileSync(
        NEW_CLIENTS,
        'Razón social,NIT,Teléfono,Ciudad\n' +
            'Panadería Trigo Dorado,901234567,3104567890,Medellín\n' +
            'Hotel Mar Azul,900765432,3159876543,Santa Marta\n' +
            'Droguería San Jorge,830112233,3001112233,Bogotá\n',
    );
    writeFileSync(FEES, 'NIT,Cuota mensual\n811072722,450000\n855427456,380000\n950865626,520000\n999999999,100000\n');
}

const IMPORT_DLG = '[role="dialog"]:has-text("Importar desde CSV o Excel")';
const UPDATE_DLG = '[role="dialog"]:has-text("Actualizar desde un archivo")';
const EXPORT_DLG = '[role="dialog"]:has-text("Formato")';

const openCustomize = { click: '[data-tour="records-customize"]', caption: 'Abre «Personalizar» (el ícono de ajustes junto al buscador).', then: 'role=dialog' };

export default [
    {
        key: 'ie-importar',
        title: 'Importar un archivo a una lista',
        setup: writeFiles,
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-customize"]', caption: 'Abre la lista donde quieres cargar los datos.' },
            openCustomize,
            { click: '[role="dialog"] button:has-text("Importar registros")', caption: 'Al final del panel, toca «Importar registros».', then: IMPORT_DLG },
            { shot: IMPORT_DLG, caption: 'Elige el archivo de Excel o CSV (o arrástralo). Hasta 5.000 filas por vez.' },
            {
                run: async ({ page }) => {
                    await page.setInputFiles(`${IMPORT_DLG} input[type=file]`, NEW_CLIENTS);
                    await page.locator(`${IMPORT_DLG} >> text=Columna del archivo`).first().waitFor({ timeout: 15000 });
                },
            },
            { shot: IMPORT_DLG, caption: 'Cada columna del archivo se empareja con un campo. Las que coinciden por nombre ya vienen elegidas.' },
            {
                run: async ({ page }) => {
                    const sel = page.locator(`${IMPORT_DLG} select`).nth(3);
                    await sel.selectOption({ label: '+ Crear campo nuevo' });
                    await page.waitForTimeout(600);
                },
            },
            { shot: IMPORT_DLG, caption: 'Para una columna que la lista no tiene, elige «+ Crear campo nuevo»: el tipo se sugiere solo. Después, «Importar».' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'ie-actualizar',
        title: 'Actualizar registros desde un archivo',
        setup: writeFiles,
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-customize"]', caption: null },
            openCustomize,
            { click: '[role="dialog"] button:has-text("Actualizar desde un archivo")', caption: 'Toca «Actualizar desde un archivo».', then: UPDATE_DLG },
            {
                run: async ({ page }) => {
                    await page.setInputFiles(`${UPDATE_DLG} input[type=file]`, FEES);
                    await page.locator(`${UPDATE_DLG} >> text=Qué columnas actualizar`).first().waitFor({ timeout: 15000 });
                },
            },
            { shot: UPDATE_DLG, caption: 'Arriba eliges cómo se reconoce cada registro (aquí, por el NIT). Abajo, qué campo cambia cada columna.' },
            { click: `${UPDATE_DLG} button:has-text("Ver vista previa")`, caption: 'Toca «Ver vista previa»: todavía no cambia nada.', then: `${UPDATE_DLG} >> text=Cambian` },
            { shot: UPDATE_DLG, caption: 'Ves cuántos cambian, cuántos ya estaban así y qué filas no encontraron su registro, con un ejemplo de antes y después.' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'ie-exportar',
        title: 'Exportar a Excel o CSV',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-customize"]', caption: null },
            openCustomize,
            { click: '[role="dialog"] button:has-text("Exportar registros")', caption: 'Toca «Exportar registros».', then: EXPORT_DLG },
            { shot: EXPORT_DLG, caption: 'Excel lleva los montos y las fechas como números y fechas de verdad. Eliges las columnas y si incluyes subtareas o el ID.' },
            { click: `${EXPORT_DLG} button:has-text("CSV")`, caption: 'Con CSV eliges además el separador y la codificación.' },
            { shot: EXPORT_DLG, caption: 'Para abrirlo en Excel en español, usa punto y coma y deja la codificación UTF-8 con BOM.' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'ie-plantilla',
        title: 'Guardar una lista como plantilla',
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=general', wait: 'text=Duplicar o guardar como plantilla', caption: 'En la configuración de la lista, pestaña General, está «Duplicar o guardar como plantilla».' },
            { click: 'button:has-text("Guardar como plantilla")', caption: 'Toca «Guardar como plantilla».', then: 'role=dialog' },
            { shot: '[role="dialog"]', caption: 'Ponle nombre, descripción y categoría, y elige qué incluir. Queda en «Mis plantillas» para toda la empresa.' },
            { press: 'Escape', caption: null },
        ],
    },
    {
        key: 'ie-duplicar',
        title: 'Duplicar una lista',
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=general', wait: 'text=Duplicar o guardar como plantilla', caption: null },
            { click: 'button:has-text("Duplicar lista")', caption: 'En la configuración de la lista, toca «Duplicar lista».', then: 'role=dialog' },
            { shot: '[role="dialog"]', caption: 'Pon el nombre de la copia y elige si llevas vistas, automatizaciones, ajustes y registros.' },
            { press: 'Escape', caption: null },
        ],
    },
];
