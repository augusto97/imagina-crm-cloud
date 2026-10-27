import type { browserName, DeviceInfo } from './platform';

/**
 * v0.1.321 — cómo se instala la app EN ESTE navegador, cuando el navegador no
 * ofrece su propia ventana de instalar (`beforeinstallprompt`): Firefox y
 * Safari nunca la ofrecen, y Chrome/Edge la dejan de ofrecer si la persona
 * cerró el aviso o si la app ya está instalada en el equipo. Antes, en esos
 * casos, «Instalar la app» no aparecía en ningún lado.
 *
 * Funciones puras (sin DOM): el texto usa `**negrita**`, que dibuja
 * `boldSegments`.
 */

export type BrowserName = ReturnType<typeof browserName>;

export interface InstallGuide {
    /** «Chrome en el computador», «Safari en el iPhone»… */
    where: string;
    steps: string[];
    /** Una aclaración debajo de los pasos (o null). */
    note: string | null;
    /** Este navegador no instala apps web: se sugiere otro. */
    unsupported: boolean;
}

const ALREADY =
    'Si ya la instalaste, ábrela desde su ícono. En Chrome y Edge, el ícono de la barra de direcciones cambia a **Abrir en la app**.';

export function installGuide(info: DeviceInfo, browser: BrowserName): InstallGuide {
    if (info.ios) {
        const steps = [
            'Toca el botón **Compartir** (el cuadrado con una flecha hacia arriba: abajo en el iPhone, arriba en el iPad).',
            'Elige **Agregar a inicio** (si no lo ves, desliza la lista hacia abajo).',
            'Toca **Agregar** y abre la app desde el ícono nuevo.',
        ];
        if (!info.iosSafari) {
            const name = browser === 'chrome' ? 'Chrome' : browser === 'edge' ? 'Edge' : browser === 'firefox' ? 'Firefox' : 'Este navegador';
            return {
                where: `${name} en el iPhone o iPad`,
                steps,
                note: 'Si no aparece **Agregar a inicio**, abre esta misma dirección en Safari y repite los pasos. Las notificaciones del iPhone y el iPad sólo funcionan con la app instalada, en iOS 16.4 o más nuevo.',
                unsupported: false,
            };
        }
        return {
            where: 'Safari en el iPhone o iPad',
            steps,
            note: 'Las notificaciones del iPhone y el iPad sólo funcionan con la app instalada así, en iOS 16.4 o más nuevo. Después actívalas en Ajustes → Cuenta → Avisos, desde la app instalada.',
            unsupported: false,
        };
    }

    if (info.android) {
        switch (browser) {
            case 'samsung':
                return {
                    where: 'Samsung Internet',
                    steps: ['Toca el menú **☰** (abajo a la derecha).', 'Elige **Agregar página a** → **Pantalla de inicio**.', 'Confirma con **Agregar**.'],
                    note: null,
                    unsupported: false,
                };
            case 'firefox':
                return {
                    where: 'Firefox en Android',
                    steps: ['Toca el menú **⋮**.', 'Elige **Instalar** (o **Agregar a la pantalla de inicio**).', 'Confirma con **Agregar**.'],
                    note: null,
                    unsupported: false,
                };
            case 'edge':
                return {
                    where: 'Edge en Android',
                    steps: ['Toca el menú **···** (abajo).', 'Elige **Agregar al teléfono** (o **Instalar aplicación**).', 'Confirma con **Instalar**.'],
                    note: null,
                    unsupported: false,
                };
            default:
                return {
                    where: 'Chrome en Android',
                    steps: [
                        'Toca el menú **⋮** (arriba a la derecha).',
                        'Elige **Instalar app** (o **Agregar a la pantalla principal**).',
                        'Confirma con **Instalar**: el ícono queda en la pantalla de inicio.',
                    ],
                    note: 'Si ya la instalaste, ábrela desde su ícono.',
                    unsupported: false,
                };
        }
    }

    switch (browser) {
        case 'edge':
            return {
                where: 'Edge en el computador',
                steps: [
                    'Haz clic en el ícono **Aplicación disponible** a la derecha de la barra de direcciones.',
                    'Si no lo ves: menú **···** → **Aplicaciones** → **Instalar este sitio como una aplicación**.',
                    'Confirma con **Instalar**: se abre en su propia ventana y queda en el menú Inicio.',
                ],
                note: ALREADY,
                unsupported: false,
            };
        case 'safari':
            return {
                where: 'Safari en el Mac',
                steps: [
                    'En la barra de menús, abre **Archivo** → **Agregar al Dock** (o el botón **Compartir** → **Agregar al Dock**).',
                    'Confirma con **Agregar**: la app queda en el Dock y se abre en su propia ventana.',
                ],
                note: 'Hace falta Safari 17 (macOS Sonoma) o más nuevo.',
                unsupported: false,
            };
        case 'firefox':
            return {
                where: 'Firefox en el computador',
                steps: [],
                note: 'Firefox no instala apps web en el computador. Abre esta misma dirección en Chrome, Edge o Safari (en Mac) para instalarla. Las notificaciones sí funcionan en Firefox.',
                unsupported: true,
            };
        case 'chrome':
            return {
                where: 'Chrome en el computador',
                steps: [
                    'Haz clic en el ícono **Instalar** (una pantalla con una flecha) a la derecha de la barra de direcciones.',
                    'Si no lo ves: menú **⋮** → **Enviar, guardar y compartir** → **Instalar página como app**.',
                    'Confirma con **Instalar**: se abre en su propia ventana y queda con las demás aplicaciones.',
                ],
                note: ALREADY,
                unsupported: false,
            };
        default:
            return {
                where: 'Este navegador',
                steps: ['Busca en el menú del navegador la opción **Instalar** o **Agregar a la pantalla de inicio**.'],
                note: 'Si no la encuentras, abre esta dirección en Chrome, Edge o Safari: los tres instalan la app.',
                unsupported: false,
            };
    }
}

/** `**negrita**` → tramos para dibujar sin `innerHTML`. */
export function boldSegments(text: string): Array<{ text: string; bold: boolean }> {
    return text
        .split('**')
        .map((t, i) => ({ text: t, bold: i % 2 === 1 }))
        .filter((s) => s.text !== '');
}
