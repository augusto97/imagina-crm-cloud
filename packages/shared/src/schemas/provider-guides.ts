import type { IntegrationProvider } from './integrations';

/**
 * Guías COMPLETAS para registrar la app de cada proveedor (v0.1.247).
 *
 * La guía anterior (v0.1.203) cubría sólo la parte técnica —crear el
 * cliente OAuth y pegar el id— y callaba lo que de verdad frena una
 * integración en producción: publicar la app, verificarla (sin eso Google y
 * Microsoft le muestran a cada empresa «app no verificada»), las páginas
 * públicas que piden los proveedores y los vencimientos (tokens de 7 días en
 * modo de prueba de Google, secretos de Microsoft que caducan).
 *
 * Cada paso puede llevar un enlace directo a la pantalla exacta y valores
 * para COPIAR que la consola completa con los datos reales de la instalación
 * (`GuideValue`): la persona no tiene que adivinar qué pegar dónde.
 */

/** Valores que la consola resuelve con los datos de esta instalación. */
export type GuideValue =
    | 'redirect_uri'
    | 'origin'
    | 'domain'
    | 'scopes'
    | 'scopes_lines'
    | 'home_url'
    | 'privacy_url'
    | 'terms_url'
    | 'app_name'
    | 'support_email'
    | 'scope_justification'
    | 'video_script'
    | 'app_description';

export interface GuideStep {
    text: string;
    link?: { label: string; url: string };
    copy?: GuideValue[];
}

export interface GuidePhase {
    key: string;
    title: string;
    /** Una línea: para qué sirve la fase. */
    summary: string;
    steps: GuideStep[];
    /** Algo que, si se ignora, rompe las conexiones (rojo/ámbar). */
    warning?: string;
    tip?: string;
}

export interface ProviderGuide {
    /** Resumen de una línea de lo que implica el proveedor. */
    intro: string;
    phases: GuidePhase[];
}

const G = 'https://console.cloud.google.com';

export const PROVIDER_GUIDES: Record<IntegrationProvider, ProviderGuide> = {
    google: {
        intro:
            'Son cinco fases. Las tres primeras dejan la conexión funcionando para tus usuarios de prueba; la 4 y la 5 hacen que cualquier empresa pueda conectarse sin el aviso de «Google no verificó esta app». Usá una cuenta de Google de la plataforma (no personal): va a ser la dueña del proyecto.',
        phases: [
            {
                key: 'project',
                title: '1. Proyecto y APIs',
                summary: 'Un proyecto de Google Cloud para la plataforma, con las tres APIs encendidas.',
                steps: [
                    {
                        text: 'Creá un proyecto nuevo (por ejemplo, con el nombre de tu plataforma). No hace falta facturación: estas APIs son gratuitas.',
                        link: { label: 'Crear proyecto', url: `${G}/projectcreate` },
                    },
                    {
                        text: 'Con el proyecto elegido arriba, habilitá Gmail API.',
                        link: { label: 'Gmail API', url: `${G}/apis/library/gmail.googleapis.com` },
                    },
                    {
                        text: 'Habilitá Google Calendar API.',
                        link: { label: 'Calendar API', url: `${G}/apis/library/calendar-json.googleapis.com` },
                    },
                    {
                        text: 'Habilitá Google Sheets API.',
                        link: { label: 'Sheets API', url: `${G}/apis/library/sheets.googleapis.com` },
                    },
                ],
            },
            {
                key: 'branding',
                title: '2. Pantalla de consentimiento (Google Auth Platform)',
                summary: 'Lo que ve cada empresa cuando aprieta «Conectar»: nombre, logo, enlaces y permisos.',
                steps: [
                    {
                        text: 'Abrí Google Auth Platform y tocá «Comenzar». Tipo de usuario (Público): Externo. Si ya estaba creada como Interna, cambiala a Externa en «Público».',
                        link: { label: 'Google Auth Platform', url: `${G}/auth/overview` },
                    },
                    {
                        text: 'En «Desarrollo de la marca» (Branding): nombre de la app, correo de asistencia y el logo (cuadrado, 120×120 px, PNG o JPG). El nombre y el logo tienen que ser los mismos que ve la gente en tu plataforma.',
                        link: { label: 'Desarrollo de la marca', url: `${G}/auth/branding` },
                        copy: ['app_name', 'support_email'],
                    },
                    {
                        text: 'En la misma pantalla: página principal, política de privacidad y condiciones del servicio. Podés usar las páginas públicas que arma esta plataforma (sección «Páginas públicas» de arriba) o las de tu sitio.',
                        copy: ['home_url', 'privacy_url', 'terms_url'],
                    },
                    {
                        text: 'En «Dominios autorizados» agregá tu dominio principal (sin https ni subdominio).',
                        copy: ['domain'],
                    },
                    {
                        text: 'En «Acceso a los datos» (Data access) → «Agregar o quitar permisos»: pegá estos permisos en «Agregar permisos manualmente» y guardá. Los tres de Google aparecen como «sensibles»; ninguno es «restringido», así que NO hace falta la auditoría de seguridad paga (CASA).',
                        link: { label: 'Acceso a los datos', url: `${G}/auth/scopes` },
                        copy: ['scopes_lines'],
                    },
                ],
            },
            {
                key: 'client',
                title: '3. Cliente OAuth y prueba',
                summary: 'Las credenciales que se pegan abajo, y una prueba real con un usuario de prueba.',
                steps: [
                    {
                        text: 'En «Clientes» → «Crear cliente»: tipo «Aplicación web». En «URI de redireccionamiento autorizados» pegá esta URI exacta (no hace falta «Orígenes de JavaScript»).',
                        link: { label: 'Clientes', url: `${G}/auth/clients` },
                        copy: ['redirect_uri'],
                    },
                    {
                        text: 'Copiá el ID de cliente y el secreto en el formulario de abajo y guardá. Google muestra el secreto completo SÓLO al crearlo: si lo perdés, generá uno nuevo en el mismo cliente.',
                    },
                    {
                        text: 'En «Público» → «Usuarios de prueba» agregá tu propio correo (y el de las empresas que quieras dejar probar). Mientras la app esté «En prueba», sólo esas cuentas pueden conectarse (máximo 100).',
                        link: { label: 'Público', url: `${G}/auth/audience` },
                    },
                    {
                        text: 'Probala: entrá a una empresa → Ajustes → Integraciones → Gmail → Conectar. Vas a ver «Google no verificó esta app»: tocá «Avanzado» → «Ir a … (no seguro)» y aceptá. Mandá un correo de prueba desde una automatización.',
                    },
                ],
                warning:
                    'En modo «En prueba» Google vence cada conexión a los 7 días: cada empresa tendría que reconectar todas las semanas. Por eso no te quedes en esta fase: pasá a la 4 apenas confirmes que funciona.',
            },
            {
                key: 'publish',
                title: '4. Publicar la app',
                summary: 'Saca el límite de 7 días y de usuarios de prueba.',
                steps: [
                    {
                        text: 'En «Público» → «Estado de publicación» tocá «Publicar app» y confirmá. Queda «En producción».',
                        link: { label: 'Público', url: `${G}/auth/audience` },
                    },
                    {
                        text: 'Desde ahora las conexiones ya no vencen a los 7 días y cualquier cuenta de Google puede conectarse. Hasta que termine la verificación (fase 5) siguen viendo el aviso de «app no verificada» y Google limita la app a 100 cuentas en total.',
                    },
                ],
                tip: 'Publicar no requiere esperar la verificación: conviene publicar YA y pedir la verificación en paralelo.',
            },
            {
                key: 'verify',
                title: '5. Verificación (pantalla segura, con tu logo)',
                summary: 'Es lo que hace que la pantalla de Google muestre tu nombre y logo sin advertencias.',
                steps: [
                    {
                        text: 'Verificá que el dominio es tuyo en Google Search Console con una propiedad de tipo «Dominio» (un registro TXT en el DNS). Hacelo con la MISMA cuenta de Google que es dueña del proyecto: si no, Google no lo reconoce.',
                        link: { label: 'Search Console', url: 'https://search.google.com/search-console' },
                        copy: ['domain'],
                    },
                    {
                        text: 'Revisá que la página principal sea pública (sin login), describa la app y enlace a la política de privacidad, y que la política explique qué hace la app con los datos de Google e incluya la frase de «uso limitado» de Google. Las páginas públicas de esta plataforma ya cumplen las dos cosas.',
                        copy: ['home_url', 'privacy_url'],
                    },
                    {
                        text: 'Grabá un video corto (subilo a YouTube como «No listado»): la pantalla de consentimiento de Google mostrando la barra de direcciones con el client_id, y después la app usando cada permiso (mandar un correo, crear un evento, agregar una fila a una hoja). Este guion te sirve:',
                        copy: ['video_script'],
                    },
                    {
                        text: 'En «Centro de verificación» tocá «Preparar para la verificación» y completá el formulario. Para cada permiso te pide justificar el uso: estos textos ya están escritos para lo que hace la app.',
                        link: { label: 'Centro de verificación', url: `${G}/auth/verification` },
                        copy: ['scope_justification', 'app_description'],
                    },
                    {
                        text: 'Google responde por correo (a la dirección de contacto del desarrollador). La revisión de marca suele tardar 2-3 días hábiles y la de permisos sensibles entre unos días y algunas semanas; si piden cambios, respondé ese mismo correo. Cuando aprueban, la pantalla muestra tu logo y el aviso desaparece solo: no hay que tocar nada acá.',
                    },
                ],
                tip: 'Si cambiás el nombre, el logo o los permisos después de verificar, Google vuelve a revisar la app.',
            },
        ],
    },
    microsoft: {
        intro:
            'Una sola app sirve para Outlook personal (outlook.com, hotmail) y para las cuentas de trabajo de cualquier empresa con Microsoft 365. Lo que cambia la experiencia es la verificación del publicador (fase 4).',
        phases: [
            {
                key: 'register',
                title: '1. Registrar la app',
                summary: 'El registro en Microsoft Entra, abierto a cualquier cuenta.',
                steps: [
                    {
                        text: 'En Microsoft Entra → «Registros de aplicaciones» → «Nuevo registro». Nombre: el de tu plataforma.',
                        link: {
                            label: 'Registros de aplicaciones',
                            url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
                        },
                        copy: ['app_name'],
                    },
                    {
                        text: 'Tipos de cuenta admitidos: «Cuentas de cualquier directorio organizativo y cuentas personales de Microsoft». Con otra opción, las cuentas personales o las de otras empresas no pueden conectarse.',
                    },
                    {
                        text: 'URI de redirección: plataforma «Web», pegá esta URI exacta. Tocá «Registrar».',
                        copy: ['redirect_uri'],
                    },
                    {
                        text: 'En «Información general» copiá el «Id. de aplicación (cliente)» al formulario de abajo.',
                    },
                ],
            },
            {
                key: 'permissions',
                title: '2. Permisos y secreto',
                summary: 'Qué puede hacer la app en nombre de cada persona, y la clave que la identifica.',
                steps: [
                    {
                        text: 'En «Permisos de API» → «Agregar un permiso» → Microsoft Graph → «Permisos delegados»: marcá openid, email, offline_access, User.Read, Mail.Send y Calendars.ReadWrite. No hace falta «Conceder consentimiento de administrador»: cada persona los acepta al conectar.',
                        copy: ['scopes_lines'],
                    },
                    {
                        text: 'En «Certificados y secretos» → «Nuevo secreto de cliente»: elegí el vencimiento más largo (24 meses). Copiá la columna VALOR (no el «Id. de secreto») al formulario de abajo: Microsoft la muestra una sola vez.',
                    },
                ],
                warning:
                    'El secreto de Microsoft VENCE. El día que vence, todas las conexiones de Outlook dejan de renovarse. Anotá la fecha y, un mes antes, creá un secreto nuevo y pegalo acá (el viejo puede convivir hasta que lo borres).',
            },
            {
                key: 'branding',
                title: '3. Marca y enlaces',
                summary: 'Lo que ve la gente en la pantalla de permisos de Microsoft.',
                steps: [
                    {
                        text: 'En «Personalización de marca y propiedades»: logo, URL de la página principal, condiciones del servicio y declaración de privacidad.',
                        copy: ['home_url', 'terms_url', 'privacy_url'],
                    },
                    {
                        text: 'Dominio del publicador: verificá tu dominio. Microsoft te da un archivo `microsoft-identity-association.json` que tiene que quedar publicado en https://TU-DOMINIO/.well-known/ — subilo a tu sitio web principal.',
                        copy: ['domain'],
                    },
                    {
                        text: 'Probala: en una empresa → Ajustes → Integraciones → Outlook → Conectar, con una cuenta personal y con una de trabajo.',
                    },
                ],
            },
            {
                key: 'publisher',
                title: '4. Verificación del publicador',
                summary: 'Cambia «no comprobado» por la insignia azul de publicador verificado.',
                steps: [
                    {
                        text: 'Necesitás una cuenta del Microsoft AI Cloud Partner Program (gratis) verificada a nombre de tu empresa. Con su Partner ID, en «Personalización de marca y propiedades» → «Agregar un id. de MPN para comprobar el publicador».',
                        link: { label: 'Partner Center', url: 'https://partner.microsoft.com/dashboard/account/v3/enrollment/introduction/partnership' },
                    },
                    {
                        text: 'El dominio del publicador (fase 3) tiene que coincidir con el dominio del correo de la cuenta de Partner Center.',
                    },
                ],
                warning:
                    'Sin publicador verificado, muchas empresas con Microsoft 365 tienen bloqueado que sus empleados acepten apps de terceros: verán «Se necesita la aprobación del administrador» y su administrador de TI tendrá que aprobarla una vez. Las cuentas personales (outlook.com) se conectan igual.',
            },
        ],
    },
    slack: {
        intro:
            'Slack no exige verificación para funcionar, pero sí activar la distribución pública: sin eso la app sólo se instala en tu propio workspace.',
        phases: [
            {
                key: 'create',
                title: '1. Crear la app',
                summary: 'La app de Slack de la plataforma.',
                steps: [
                    {
                        text: 'En api.slack.com/apps → «Create New App» → «From scratch». Nombre: el de tu plataforma; workspace: el tuyo (es sólo el «dueño» de la app).',
                        link: { label: 'Slack API', url: 'https://api.slack.com/apps' },
                        copy: ['app_name'],
                    },
                    {
                        text: 'En «Basic Information» → «Display Information»: ícono (cuadrado, 512 a 2000 px), descripción corta y color de fondo. Es lo que ve cada empresa al instalarla.',
                        copy: ['app_description'],
                    },
                ],
            },
            {
                key: 'oauth',
                title: '2. Permisos y redirección',
                summary: 'Dónde vuelve Slack después de autorizar y qué puede hacer el bot.',
                steps: [
                    {
                        text: 'En «OAuth & Permissions» → «Redirect URLs» → «Add New Redirect URL»: pegá esta URI y tocá «Save URLs».',
                        copy: ['redirect_uri'],
                    },
                    {
                        text: 'En «Scopes» → «Bot Token Scopes» agregá chat:write y chat:write.public.',
                        copy: ['scopes_lines'],
                    },
                    {
                        text: 'Dejá APAGADO «Token Rotation» (las conexiones de bot quedan sin vencimiento).',
                    },
                    {
                        text: 'En «Basic Information» → «App Credentials» copiá el Client ID y el Client Secret al formulario de abajo.',
                    },
                ],
            },
            {
                key: 'distribute',
                title: '3. Distribución pública',
                summary: 'Lo que permite que OTRAS empresas instalen la app.',
                steps: [
                    {
                        text: 'En «Manage Distribution» completá la lista: marcá «Remove Hard Coded Information» y verificá que la redirección usa https.',
                    },
                    {
                        text: 'Tocá «Activate Public Distribution». Sin esto, una empresa que toque «Conectar» ve un error de Slack.',
                    },
                    {
                        text: 'Probala: en una empresa → Ajustes → Integraciones → Slack → Conectar, y mandá un mensaje de prueba a un canal.',
                    },
                ],
                tip: 'No hace falta publicarla en el Slack Marketplace. Si un workspace tiene activada la aprobación de apps, su administrador la aprueba una vez.',
            },
        ],
    },
};

/** Justificación de cada permiso, para el formulario de verificación. */
export const SCOPE_JUSTIFICATIONS: Record<string, string> = {
    'https://www.googleapis.com/auth/gmail.send':
        'gmail.send: la app manda correos DESDE la cuenta de Gmail que conecta la empresa cuando una de sus automatizaciones lo indica (por ejemplo, avisarle a un cliente que su factura venció). Sólo envía: no lee, no busca ni guarda correos de la casilla. El usuario define el destinatario, el asunto y el texto en el editor de automatizaciones.',
    'https://www.googleapis.com/auth/calendar.events':
        'calendar.events: la app crea un evento en el calendario de la cuenta conectada cuando una automatización lo indica (por ejemplo, agendar una cita al registrar una reserva). No lee ni modifica otros eventos del calendario.',
    'https://www.googleapis.com/auth/spreadsheets':
        'spreadsheets: la app agrega una fila a la hoja de cálculo que el usuario elige (pegando su enlace) cuando una automatización lo indica, para exportar registros a Google Sheets. No lista ni abre otras hojas del usuario.',
};

export function scopeJustificationText(scopes: string[]): string {
    return scopes
        .map((s) => SCOPE_JUSTIFICATIONS[s])
        .filter((s): s is string => Boolean(s))
        .join('\n\n');
}

export function videoScriptText(appName: string, appUrl: string): string {
    return [
        `Guion del video de verificación (${appName}):`,
        `1. Mostrá ${appUrl} y entrá con una cuenta de prueba.`,
        '2. Andá a Ajustes → Integraciones → Gmail → Conectar.',
        '3. En la pantalla de Google, mostrá la barra de direcciones completa (se tiene que ver el client_id) y los permisos que pide. Aceptá.',
        '4. Volvé a la app: la conexión aparece como conectada.',
        '5. Abrí una automatización con la acción «Enviar correo con Gmail», tocá «Probar ahora» y mostrá el correo recibido.',
        '6. Igual con «Crear evento en Google Calendar» (mostrá el evento en el calendario) y «Agregar fila en Google Sheets» (mostrá la fila nueva en la hoja).',
        '7. Explicá en voz alta o con subtítulos para qué se usa cada permiso.',
    ].join('\n');
}

export function appDescriptionText(appName: string): string {
    return `${appName} es una plataforma para que las empresas armen sus propias bases de datos (clientes, ventas, proyectos, facturación) con vistas, tableros y automatizaciones. Las integraciones con Google permiten que esas automatizaciones manden un correo desde Gmail, creen un evento en Google Calendar o agreguen una fila a Google Sheets cuando ocurre algo en sus datos.`;
}

/**
 * Dominio registrable de un host, para «Dominios autorizados» / Search
 * Console. Heurística deliberadamente simple: los dos últimos rótulos, o
 * tres si el penúltimo es un sufijo de segundo nivel conocido (com.co, co.uk).
 */
export function registrableDomain(host: string): string {
    const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
    if (labels.length <= 2) return labels.join('.');
    const sld = labels[labels.length - 2]!;
    const tld = labels[labels.length - 1]!;
    const twoLevel = tld.length === 2 && ['com', 'co', 'net', 'org', 'gov', 'edu', 'gob', 'ac'].includes(sld);
    return labels.slice(twoLevel ? -3 : -2).join('.');
}
