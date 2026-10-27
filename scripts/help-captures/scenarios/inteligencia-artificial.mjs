/**
 * Capturas del módulo «Inteligencia artificial» del centro de aprendizaje.
 *
 * Ninguna demo guarda nada: muestran dónde se configura la IA, cómo se arma un
 * agente desde una plantilla, cómo se agrega un campo con IA y dónde se crea
 * un token para conectar un asistente externo. (El chat del asistente necesita
 * una clave de IA de verdad, por eso se explica con su ilustración.)
 */
export default [
    {
        key: 'ia-ajustes',
        title: 'Activar el asistente y elegir la clave',
        steps: [
            { go: '/settings?s=plan', wait: 'a:has-text("Asistente IA"), button:has-text("Asistente IA")', caption: 'La IA de la empresa se configura en «Ajustes».' },
            { click: 'a:has-text("Asistente IA"), button:has-text("Asistente IA") >> nth=0', then: 'text=Activar el asistente para esta empresa', caption: 'Abre «Asistente IA» (lo ve quien administra la empresa).' },
            { wait: 1500 },
            { shot: 'text=Activar el asistente para esta empresa', caption: 'Enciende «Activar el asistente para esta empresa», elige el modelo y, si quieres, carga una clave propia: así los pedidos no cuentan para la cuota del plan.' },
        ],
    },
    {
        key: 'ia-agente-plantilla',
        title: 'Crear un agente de IA desde una plantilla',
        steps: [
            { go: '/agents', wait: '[data-testid="agent-templates"]', caption: 'En el menú de la izquierda, «Agentes». Empieza con una plantilla o en blanco.' },
            { click: '[data-agent-template="classify_tickets"], [data-testid="agent-templates"] a >> nth=0', then: 'text=Qué hace', caption: 'Toca una plantilla, por ejemplo «Clasificador de tickets».' },
            { wait: 800 },
            { shot: 'text=Qué hace', caption: 'La plantilla trae escrito qué hace. Ajusta las instrucciones con tus palabras y elige en qué listas trabaja.' },
            {
                run: async ({ page }) => {
                    await page.locator('text=Cómo aplica los cambios').first().scrollIntoViewIfNeeded();
                },
            },
            { shot: 'text=Cómo aplica los cambios', caption: 'Elige sus herramientas y cómo aplica los cambios: proponer para que una persona apruebe (recomendado al empezar) o hacerlos solo.' },
        ],
    },
    {
        key: 'ia-campo-crear',
        title: 'Agregar un campo con IA a una lista',
        steps: [
            { go: '/lists/{list:Tickets}/records', wait: '[data-tour="records-table"]', caption: 'Abre la lista donde quieres el campo, por ejemplo «Tickets».' },
            { click: '[data-testid="floating-add-column"] button, button[aria-label="Agregar columna"] >> nth=0', then: 'input[placeholder="Buscar campos"]', caption: 'Toca el «+» al final de las columnas.' },
            { fill: 'input[placeholder="Buscar campos"]', text: 'IA', caption: 'Busca «IA».' },
            { click: 'button:has-text("Campo con IA") >> nth=0', then: 'text=Qué hace', caption: 'Elige «Campo con IA».' },
            { fill: 'input[placeholder="Ej. Estado"]', text: 'Prioridad sugerida', caption: 'Ponle un nombre.' },
            { click: 'button:has-text("Clasificar") >> nth=0', caption: 'Elige qué hace: resumir, clasificar, extraer un dato, traducir o lo que le pidas. Para una prioridad, «Clasificar».' },
            { shot: 'text=Lee de estos campos', caption: 'Marca de qué campos lee y escribe las opciones (una por renglón). Se calcula solo en cada registro, y se recalcula cuando cambian esos campos.' },
        ],
    },
    {
        key: 'ia-mcp-token',
        title: 'Conectar Claude u otro asistente a tus datos',
        steps: [
            { go: '/settings?s=seguridad', wait: 'text=Conexión MCP (Claude, Cursor y otros)', caption: 'En «Ajustes» → «Seguridad» (de tu cuenta).' },
            {
                run: async ({ page }) => {
                    await page.locator('text=Conexión MCP (Claude, Cursor y otros)').first().scrollIntoViewIfNeeded();
                },
            },
            { shot: 'text=Conectar desde claude.ai, Claude Desktop o el celular (sin token)', caption: 'Para Claude: copia la dirección, pégala en Claude (Ajustes → Conectores → «Agregar conector personalizado») y autoriza. No hace falta token.' },
            { click: 'button:has-text("Nuevo token")', then: 'text=Nombre (para reconocerlo)', caption: 'Para otros asistentes, toca «Nuevo token».' },
            { shot: 'text=Nombre (para reconocerlo)', caption: 'Ponle un nombre, elige el alcance (sólo lectura o lectura y cambios) y cuándo vence. El token se muestra una sola vez.' },
        ],
    },
];
