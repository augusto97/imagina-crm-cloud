/**
 * Capturas del módulo «Consola de la plataforma» (sólo para el operador).
 *
 * La cuenta de ejemplo no es superadmin, así que estas demos entran en un
 * contexto aparte con la cuenta de operador de desarrollo
 * (`HC_SUPERADMIN_EMAIL` / `HC_SUPERADMIN_PASSWORD`, por defecto la de los
 * E2E). En el release, `ci.sh` la crea con `prepare-operator.mjs`. Si la
 * cuenta no existe, la demo falla rápido y el manual muestra su animación de
 * respaldo.
 *
 * Nada se guarda: sólo se navega y se abren paneles.
 */

const EMAIL = process.env.HC_SUPERADMIN_EMAIL || 'e2e@test.local';
const PASSWORD = process.env.HC_SUPERADMIN_PASSWORD || 'Superadmin-pass-1';

let operator = null; // { context } compartido entre demos
let lastPage = null;

async function operatorContext(page, base) {
    if (operator) return operator;
    const browser = page.context().browser();
    const context = await browser.newContext({
        viewport: { width: 1100, height: 700 },
        deviceScaleFactor: 1.5,
        locale: 'es-CO',
        timezoneId: 'America/Bogota',
        colorScheme: 'light',
    });
    await context.addInitScript(() => {
        try {
            localStorage.setItem('imcrm:theme', 'light');
        } catch {
            /* nada */
        }
    });
    const login = await context.newPage();
    await login.goto(`${base}/login`);
    await login.fill('#email', EMAIL);
    await login.fill('#password', PASSWORD);
    await login.click('button[type=submit]');
    try {
        await login.waitForFunction(() => location.hash.startsWith('#/'), null, {
            timeout: 8000,
        });
    } catch {
        await context.close();
        throw new Error(`no se pudo entrar como operador (${EMAIL})`);
    }
    // Que nada tape la consola (igual que la empresa de ejemplo): bienvenida,
    // primeros pasos y novedades sin ver.
    const me = await (await login.request.get(`${base}/api/v1/auth/me`)).json().catch(() => null);
    const tenantId = me?.memberships?.[0]?.tenant_id;
    if (tenantId) {
        const headers = {
            'x-tenant-id': String(tenantId),
            'content-type': 'application/json',
        };
        const send = (method, url, body) =>
            login.request
                .fetch(`${base}/api/v1${url}`, {
                    method,
                    headers,
                    data: JSON.stringify(body),
                })
                .catch(() => {});
        await send('PATCH', '/me/guides', { welcome_offered: true });
        await send('PATCH', '/onboarding', {
            hidden: true,
            welcome_dismissed: true,
        });
        await send('POST', '/me/whats-new/seen', { all: true });
    }
    await login.close();
    operator = { context };
    return operator;
}

/** Cambia la página de la demo por una del operador. */
async function asOperator(ctx) {
    const { context } = await operatorContext(ctx.page, ctx.base);
    if (lastPage) await lastPage.close().catch(() => {});
    lastPage = await context.newPage();
    ctx.page = lastPage;
}

export default [
    {
        key: 'plat-consola',
        title: 'La consola de la plataforma',
        setup: asOperator,
        steps: [
            {
                go: '/platform?tab=tenants',
                wait: 'text=Consola del operador',
                caption: 'Plataforma es la consola del operador: sólo la ven los superadmins.',
            },
            {
                shot: 'text=Consola del operador',
                caption: 'Arriba, las cifras de toda la plataforma: empresas, activas, impagas, usuarios y registros.',
            },
            {
                hover: 'a[href$="tab=backups"]',
                caption: 'En el panel de la izquierda, una sección por tema: empresas, planes, cobros, correo, copias, actualizaciones…',
            },
            {
                click: 'a[href$="tab=updates"]',
                then: 'text=Sistema · Actualizaciones',
                caption: 'Por ejemplo, Actualizaciones.',
            },
            {
                shot: 'text=Sistema · Actualizaciones',
                caption: 'La versión instalada y si hay una nueva, lista para instalar con un clic.',
            },
        ],
    },
    {
        key: 'plat-empresas',
        title: 'Empresas de la plataforma',
        setup: asOperator,
        steps: [
            {
                go: '/platform?tab=tenants',
                wait: 'button[aria-label^="Detalle de"]',
                caption: 'En Empresas ves todas, con su admin, plan, estado y uso.',
            },
            {
                hover: 'text=Nueva empresa',
                caption: '«Nueva empresa» da de alta la empresa y su admin en un paso.',
            },
            {
                click: 'button[aria-label^="Detalle de"] >> nth=0',
                then: '[data-testid="tenant-members"]',
                caption: 'El botón de detalle de cada fila muestra sus miembros y su uso contra el plan.',
            },
            {
                shot: '[data-testid="tenant-members"]',
                caption: 'Desde aquí invitas, cambias roles o quitas personas, aunque la empresa esté en el límite de su plan.',
            },
        ],
    },
    {
        key: 'plat-planes',
        title: 'Planes y precios',
        setup: asOperator,
        steps: [
            {
                go: '/platform?tab=plans',
                wait: 'button[aria-label^="Editar"]',
                caption: 'En Planes, una fila por plan con sus límites y sus precios.',
            },
            {
                click: 'button[aria-label^="Editar"] >> nth=1',
                then: 'text=Límites (vacío = ilimitado)',
                caption: 'Toca «Editar» en un plan.',
            },
            {
                shot: 'text=Límites (vacío = ilimitado)',
                caption: 'Los límites (vacío es ilimitado) y el precio por mes en dólares y en pesos. Sin precio, el plan no se vende solo.',
            },
        ],
    },
    {
        key: 'plat-integraciones',
        title: 'Registrar las integraciones',
        setup: asOperator,
        steps: [
            {
                go: '/platform?tab=integraciones',
                wait: '[data-testid="imcrm-platform-integrations"]',
                caption: 'En Integraciones registras una vez las apps de Google, Microsoft y Slack.',
            },
            {
                shot: '[data-testid="imcrm-platform-provider"] >> nth=0',
                caption: 'Cada proveedor trae su guía paso a paso, la dirección de redirección para copiar y dónde pegar el ID y el secreto.',
            },
            {
                hover: 'text=Páginas públicas',
                caption: 'Más abajo, las páginas públicas (inicio, privacidad y condiciones) que piden para verificar la app.',
            },
        ],
    },
    {
        key: 'plat-copias',
        title: 'Copias de seguridad',
        setup: asOperator,
        steps: [
            {
                go: '/platform?tab=backups',
                wait: 'text=Copias automáticas',
                caption: 'En Copias de seguridad programas las copias completas del servidor.',
            },
            {
                shot: 'text=Copias automáticas',
                caption: 'Todos los días, a la hora que elijas, conservando las últimas N copias.',
            },
            {
                hover: 'text=Copia fuera del servidor · Google Drive',
                caption: 'Con Google Drive conectado, cada copia sale cifrada fuera del servidor: si el servidor se pierde, otro la restaura.',
            },
        ],
    },
];
