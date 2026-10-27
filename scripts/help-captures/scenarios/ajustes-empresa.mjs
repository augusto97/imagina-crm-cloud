/**
 * Capturas del módulo «Ajustes de la empresa» del centro de aprendizaje.
 *
 * Ninguna demo guarda cambios de configuración: la marca, el correo y el
 * formato se muestran sin tocar «Guardar». La de la papelera manda a la
 * papelera un registro de Clientes en el `setup` y lo restaura en la propia
 * demo, así la empresa queda como estaba.
 */

const TRASH_LIST = 'Clientes';

export default [
    {
        key: 'empresa-marca',
        title: 'Personalizar la marca',
        steps: [
            {
                go: '/settings?s=marca',
                wait: '[data-tour="branding-card"]',
                caption: 'En Ajustes → Marca están el nombre, los colores y el logo de tu empresa.',
            },
            {
                fill: '[data-tour="branding-card"] input[placeholder="El nombre de tu empresa"]',
                text: 'Aurora Pedidos',
                caption: 'Escribe el nombre que quieres que vea tu equipo y tus clientes.',
            },
            {
                fill: '[data-tour="branding-card"] input[placeholder^="#0c7e97"]',
                text: '#7A3E1D',
                caption: 'Elige el color primario con el selector o pegando su código.',
            },
            {
                hover: '[data-testid="branding-sidebar-color"]',
                caption: 'Si quieres, dale a la barra lateral un color propio (gris, carbón…).',
            },
            {
                shot: '[data-tour="branding-card"]',
                caption: 'Sube tu logo y toca «Guardar»: la app, el portal y los correos de acceso cambian al instante.',
            },
        ],
    },
    {
        key: 'empresa-correo',
        title: 'Elegir por dónde salen los correos',
        steps: [
            {
                go: '/settings?s=correo',
                wait: '[data-testid="tenant-mail"]',
                caption: 'En Ajustes → Correo eliges una de las tres formas de envío.',
            },
            {
                click: '[role="tablist"][aria-label="Forma de envío"] [role="tab"]:has-text("Google o Microsoft")',
                then: '[data-testid="mail-section-account"]',
                caption: 'La recomendada: tu cuenta de Gmail, Google Workspace u Outlook.',
            },
            {
                shot: '[data-testid="mail-section-account"]',
                caption: 'Conéctala en Integraciones como conexión del equipo y elígela aquí. Verás sus límites diarios antes de usarla.',
            },
            {
                click: '[role="tablist"][aria-label="Forma de envío"] [role="tab"]:has-text("SMTP")',
                then: '[data-testid="mail-section-smtp"]',
                caption: 'O tu propio servidor de correo.',
            },
            {
                shot: '[data-testid="mail-section-smtp"]',
                caption: 'Host, puerto, usuario y contraseña; después «Probar envío» y, si algo falla, «Diagnosticar conexión».',
            },
        ],
    },
    {
        key: 'empresa-formato',
        title: 'Formato regional y zona horaria',
        steps: [
            {
                go: '/settings?s=formato',
                wait: '#fmt-number',
                caption: 'En Ajustes → Formato regional decides cómo se ven números, fechas y horas.',
            },
            {
                hover: '#fmt-number',
                caption: 'Números: punto para miles y coma decimal, como se usa en Colombia.',
            },
            {
                hover: '#fmt-tz',
                caption: 'La zona horaria decide cuándo corren las automatizaciones programadas y qué es «hoy».',
            },
            {
                run: async ({ page }) => {
                    await page.locator('#fmt-time').selectOption('h24');
                },
            },
            {
                shot: '[data-testid="format-preview"]',
                caption: 'La vista previa muestra al instante la fecha de hoy y la hora actual en esa zona. Si se ve bien, «Guardar».',
            },
        ],
    },
    {
        key: 'empresa-plan',
        title: 'Ver el plan y el uso',
        steps: [
            {
                go: '/settings?s=plan',
                wait: 'text=Plan actual',
                caption: 'En Ajustes → Plan y uso ves tu plan y su estado.',
            },
            {
                shot: true,
                caption: 'Una barra por cada límite: registros, usuarios, invitados, automatizaciones, espacio, correos y asistente.',
            },
            {
                hover: 'nav >> text=Suscripción',
                caption: 'Para pagar varios meses o activar la renovación automática, entra a Suscripción.',
            },
        ],
    },
    {
        key: 'empresa-papelera',
        title: 'Recuperar algo de la papelera',
        setup: async ({ api, lists, page, base, tenantId }) => {
            const list = lists[TRASH_LIST];
            if (!list) throw new Error(`no existe la lista «${TRASH_LIST}»`);
            const res = await api.get(`/lists/${list.slug}/records?limit=1`);
            const rec = (res.data ?? [])[0];
            if (!rec) throw new Error(`${TRASH_LIST} no tiene registros`);
            // `api.del` manda content-type sin cuerpo y el servidor lo rechaza:
            // se borra con un pedido sin cabecera de contenido.
            const r = await page.request.delete(`${base}/api/v1/lists/${list.slug}/records/${rec.id}`, { headers: { 'x-tenant-id': String(tenantId) } });
            if (!r.ok()) throw new Error(`no se pudo mandar a la papelera: ${r.status()}`);
        },
        steps: [
            {
                go: '/settings?s=papelera',
                wait: '[data-testid="trash-panel"]',
                caption: 'Lo borrado queda 30 días en Ajustes → Papelera.',
            },
            {
                shot: '[data-trash-item] >> nth=0',
                caption: 'Cada elemento dice quién lo borró, hace cuánto y cuántos días le quedan.',
            },
            {
                click: '[data-testid="trash-restore"] >> nth=0',
                caption: 'Toca «Restaurar»: vuelve a su lista con todo lo que tenía.',
            },
            { wait: 800 },
            {
                shot: '[data-testid="trash-panel"]',
                caption: 'Listo: ya no está en la papelera y el registro volvió a su lugar.',
            },
        ],
    },
];
