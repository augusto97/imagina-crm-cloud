/**
 * Capturas del módulo «Equipo y permisos» del centro de aprendizaje.
 *
 * Deja la empresa como estaba salvo por UN miembro invitado (Mateo Castro),
 * que se borra y se vuelve a invitar en cada corrida: así la demo de
 * invitar siempre muestra «Invitación pendiente» y el resto tiene a alguien
 * a quien compartirle cosas. Los roles, equipos, permisos y accesos se
 * muestran sin guardar.
 */

const MATEO = 'mateo.castro@cafeaurora.co';

async function removeMember({ api, page, base, tenantId }, email) {
    const res = await api.get('/workspaces/current/members').catch(() => null);
    const list = Array.isArray(res) ? res : (res?.data ?? []);
    for (const m of list) {
        if (String(m.email ?? '').toLowerCase() === email) {
            // `api.del` manda content-type sin cuerpo y el servidor lo rechaza.
            await page.request
                .delete(`${base}/api/v1/workspaces/current/members/${m.user_id}`, {
                    headers: { 'x-tenant-id': String(tenantId) },
                })
                .catch(() => {});
        }
    }
}

export default [
    {
        key: 'equipo-invitar',
        title: 'Invitar a una persona',
        setup: async (ctx) => {
            await removeMember(ctx, MATEO);
        },
        steps: [
            {
                go: '/settings?s=miembros',
                wait: '[data-tour="members-invite"]',
                caption: 'En Ajustes → Miembros ves a tu equipo y el formulario para invitar.',
            },
            {
                fill: '#member-email',
                text: MATEO,
                caption: 'Escribe el correo de la persona.',
            },
            {
                fill: '#member-name',
                text: 'Mateo Castro',
                caption: 'Si todavía no tiene cuenta, ponle también el nombre.',
            },
            {
                hover: '[data-testid="member-role-select"]',
                caption: 'Elige su rol: Admin, Manager, Agente, Lector o uno de tus roles propios.',
            },
            {
                click: '[data-testid="member-invite-form"] button[type=submit]',
                then: '[data-testid="member-pending"]',
                caption: 'Toca «Invitar».',
            },
            {
                shot: '[data-tour="members-list"]',
                caption:
                    'Listo: aparece con «Invitación pendiente» hasta que defina su contraseña. Desde su fila puedes reenviar el correo, cambiarle el rol o quitarla.',
            },
        ],
    },
    {
        key: 'equipo-roles',
        title: 'Crear un rol propio',
        steps: [
            {
                go: '/settings?s=roles',
                wait: '[data-testid="imcrm-roles-panel"]',
                caption: 'En Ajustes → Roles están los cuatro roles fijos y los que crees tú.',
            },
            {
                click: '[data-testid="imcrm-role-new"]',
                then: '[data-testid="imcrm-role-editor"]',
                caption: 'Toca «Nuevo rol».',
            },
            {
                fill: '#role-name',
                text: 'Supervisor',
                caption: 'Ponle un nombre que todos entiendan.',
            },
            {
                shot: '[data-testid="imcrm-role-editor"]',
                caption: 'Elige en qué rol se basa y prende o apaga lo que puede hacer en cada módulo. Luego, «Crear rol».',
            },
        ],
    },
    {
        key: 'equipo-equipos',
        title: 'Crear un equipo',
        steps: [
            {
                go: '/settings?s=equipos',
                wait: '[data-testid="imcrm-teams-panel"]',
                caption: 'En Ajustes → Equipos agrupas a las personas de tu empresa.',
            },
            {
                click: '[data-testid="imcrm-team-new"]',
                then: '[data-testid="imcrm-team-editor"]',
                caption: 'Toca «Nuevo equipo».',
            },
            {
                fill: '#imcrm-team-name',
                text: 'Ventas',
                caption: 'Ponle un nombre: Ventas, Soporte, Sede Norte…',
            },
            {
                fill: '[data-testid="imcrm-team-member-search"]',
                text: 'Laura',
                caption: 'Busca a cada persona para sumarla.',
            },
            {
                click: '[data-testid="imcrm-team-member-search"] ~ div button >> nth=0',
                caption: 'Elígela de la lista.',
            },
            {
                shot: '[data-testid="imcrm-team-editor"]',
                caption: 'Puedes marcar a alguien como líder y darle color e ícono al equipo. Luego, «Crear equipo».',
            },
        ],
    },
    {
        key: 'equipo-permisos',
        title: 'Permisos de una lista',
        steps: [
            {
                go: '/lists/{list:Oportunidades}/edit?s=permisos',
                wait: '[role="radiogroup"]',
                caption: 'En los ajustes de la lista, la pestaña Permisos tiene una tarjeta por rol.',
            },
            {
                click: '[role="radiogroup"][aria-label$="Agente"] [role="radio"]:has-text("Colaborar")',
                caption: 'Elige el nivel del rol: aquí, los agentes pasan a «Colaborar».',
            },
            {
                click: '[role="radiogroup"][aria-label$="Agente"] ~ details summary',
                caption: 'Abre «Ajuste fino» para ver o cambiar el detalle.',
            },
            {
                shot: '[role="radiogroup"][aria-label$="Agente"] ~ details',
                caption: 'Qué ve, qué edita, qué borra, si crea, y los campos que ese rol no debe ver. Al terminar, «Guardar permisos».',
            },
        ],
    },
    {
        key: 'equipo-compartir',
        title: 'Dar acceso a una persona o a un equipo',
        steps: [
            {
                go: '/lists/{list:Oportunidades}/records',
                wait: '[data-tour="records-table"]',
                caption: 'Abre la lista que quieres compartir.',
            },
            {
                click: '[data-tour="records-share"]',
                then: 'text=Personas con acceso',
                caption: 'Toca «Compartir».',
            },
            {
                fill: '[role="dialog"] input[aria-label="Buscar una persona"]',
                text: 'Mateo',
                caption: 'En «Personas con acceso» busca a alguien de tu equipo.',
            },
            { wait: 1200 },
            {
                shot: '[role="dialog"]',
                caption: 'Eliges su nivel sólo para esta lista. Más abajo están «Equipos con acceso» y las «Personas de afuera».',
            },
        ],
    },
    {
        key: 'equipo-invitado',
        title: 'Compartir un registro con alguien de afuera',
        steps: [
            {
                go: '/lists/{list:Facturas}/records',
                wait: '[data-tour="records-table"]',
                caption: 'Abre la lista donde está el registro.',
            },
            {
                click: '[data-tour="records-row"] >> nth=0',
                then: '[data-testid="record-share-button"]',
                caption: 'Abre el registro que quieres compartir.',
            },
            {
                click: '[data-testid="record-share-button"]',
                then: '[data-testid="record-share-dialog"]',
                caption: 'Toca el botón de compartir de la barra del registro.',
            },
            {
                fill: '[data-testid="record-share-dialog"] input[type=email]',
                text: 'contador@estudiocontable.co',
                caption: 'Escribe el correo de la persona de afuera.',
            },
            {
                shot: '[data-testid="record-share-dialog"]',
                caption: 'Elige si puede ver, comentar o editar y toca «Invitar»: verá sólo este registro y no ocupa un usuario de tu plan.',
            },
        ],
    },
];
