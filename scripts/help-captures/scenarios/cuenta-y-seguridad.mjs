/**
 * Capturas del módulo «Tu cuenta y seguridad» del centro de aprendizaje.
 *
 * Nada se guarda: la verificación en dos pasos se muestra hasta el código QR
 * sin confirmarla (el alta queda propuesta unos minutos y se descarta sola) y
 * la apariencia vuelve a «Claro» al final.
 */

/** Deja el elemento en el centro de la pantalla (el runner sólo lo hace visible). */
function centerOn(selector) {
    return async ({ page }) => {
        await page
            .locator(selector)
            .first()
            .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    };
}

export default [
    {
        key: 'cuenta-seguridad',
        title: 'Contraseña y dispositivos conectados',
        steps: [
            {
                go: '/settings?s=seguridad',
                wait: 'text=Dispositivos conectados',
                caption: 'En Ajustes → Seguridad cambias tu contraseña y ves dónde está abierta tu cuenta.',
            },
            {
                shot: 'section:has(button:has-text("Cambiar contraseña"))',
                caption: 'Escribe la actual y la nueva dos veces, y toca «Cambiar contraseña». Se cierran las sesiones de tus otros dispositivos.',
            },
            { run: centerOn('text=Dispositivos conectados') },
            {
                shot: 'text=Dispositivos conectados',
                caption: 'Cada computador y teléfono donde entraste, con su última actividad. Si no reconoces uno, ciérralo y cambia la contraseña.',
            },
        ],
    },
    {
        key: 'cuenta-2fa',
        title: 'Activar la verificación en dos pasos',
        steps: [
            {
                go: '/settings?s=seguridad',
                wait: 'text=Verificación en dos pasos',
                caption: 'En Ajustes → Seguridad busca «Verificación en dos pasos».',
            },
            {
                click: 'section:has-text("Verificación en dos pasos") button:text-is("Activar")',
                then: '#mfa-confirm',
                caption: 'Toca «Activar».',
            },
            { run: centerOn('#mfa-confirm') },
            {
                shot: '#mfa-confirm',
                caption: 'Escanea el código con tu app de autenticación (o copia la clave) y escribe el código de 6 dígitos que muestra.',
            },
            {
                hover: '#mfa-confirm',
                caption: 'Al confirmarlo te muestra diez códigos de respaldo: guárdalos lejos del teléfono.',
            },
        ],
    },
    {
        key: 'cuenta-avisos',
        title: 'Elegir qué avisos te llegan',
        steps: [
            {
                go: '/settings?s=avisos',
                wait: '[data-testid="notification-prefs"]',
                caption: 'En Ajustes → Avisos decides qué te llega además de la campana.',
            },
            { run: centerOn('text=Qué te llega, y por dónde') },
            {
                shot: 'text=Qué te llega, y por dónde',
                caption: 'Una fila por tipo de aviso, con una casilla para el correo y otra para las notificaciones del teléfono.',
            },
            {
                hover: '[data-testid="pref-digest"]',
                caption: 'O activa el resumen diario: lo vencido, lo de hoy y lo que no has leído, en un solo correo.',
            },
        ],
    },
    {
        key: 'cuenta-apariencia',
        title: 'Modo claro u oscuro',
        steps: [
            {
                go: '/settings?s=apariencia',
                wait: 'button[aria-pressed]:has-text("Oscuro")',
                caption: 'En Ajustes → Apariencia eliges cómo se ve la app en este dispositivo.',
            },
            {
                click: 'button[aria-pressed]:has-text("Oscuro")',
                caption: 'Toca «Oscuro».',
            },
            {
                shot: 'button[aria-pressed]:has-text("Oscuro")',
                caption: 'Superficies oscuras y menos brillo, con los colores de tu empresa ajustados para leerse bien.',
            },
            {
                click: 'button[aria-pressed]:has-text("Claro")',
                caption: 'Para volver, toca «Claro».',
            },
            {
                shot: 'button[aria-pressed]:has-text("Seguir al sistema")',
                caption: 'Con «Seguir al sistema» la app cambia sola cuando tu dispositivo pasa a modo oscuro.',
            },
        ],
    },
];
