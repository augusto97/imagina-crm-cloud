import { z } from 'zod';
import { idSchema } from './common';
import {
    connectorActionSchema,
    connectorVisibilitySchema,
    type ConnectorAction,
    type ConnectorPair,
} from './connector';

/**
 * Integraciones (v0.1.203, ADR-S22 fase 4) — la galería de apps.
 *
 * Las fases 1-3 dejaron el MOTOR (credenciales cifradas, acciones con nombre,
 * OAuth como cliente) pero la cara era una herramienta de desarrollador: para
 * conectar algo había que saber qué es una cabecera, un scope o una URL de
 * tokens. Lo que hacen ClickUp o Zapier es otra cosa: la persona ve el logo,
 * toca «Conectar», autoriza con SU cuenta y listo. Eso sólo es posible porque
 * la parte técnica la resolvió UNA vez el dueño de la plataforma.
 *
 * Por eso este archivo separa dos cosas:
 *  - **Proveedores OAuth** (Google, Microsoft, Slack): el OPERADOR registra una
 *    app en la consola de cada uno (client id + secret) desde Plataforma →
 *    Integraciones. Eso NO es una cuenta compartida: identifica a la app. Cada
 *    empresa sigue conectando su propia cuenta y sus tokens quedan cifrados y
 *    separados (la decisión de F11 se mantiene).
 *  - **Integraciones** (las tarjetas de la galería): cada una dice cómo se
 *    conecta —OAuth con un proveedor y qué permisos pide, o una clave que la
 *    empresa pega— y qué ACCIONES ofrece ya armadas. Las acciones usan el mismo
 *    shape que las acciones con nombre de la fase 2, así el editor de
 *    automatizaciones las muestra con el mismo formulario.
 *
 * Lo que va en las peticiones (URL, método, cuerpo) NO vive aquí: lo arma el
 * backend en código, una función por acción. Una API externa no se describe
 * bien con filas clave/valor (Gmail quiere un mensaje RFC 2822 en base64, Sheets
 * un arreglo de filas, Calendar objetos anidados), y el usuario nunca tiene que
 * verlo.
 */

// --- Proveedores OAuth (los registra el operador) -----------------------

export const INTEGRATION_PROVIDERS = ['google', 'microsoft', 'slack'] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export interface IntegrationProviderDef {
    key: IntegrationProvider;
    label: string;
    authorize_url: string;
    token_url: string;
    /** Parámetros extra del paso de autorización (refresh token, etc.). */
    extra_params: ConnectorPair[];
    /** Permisos que se piden SIEMPRE (identidad de la cuenta, renovación). */
    base_scopes: string;
    /** Microsoft exige repetir los scopes en el canje y en la renovación. */
    scope_on_token: boolean;
    /** Separador de scopes que espera el proveedor. */
    scope_separator: ' ' | ',';
    /** Dónde se registra la app. */
    console_url: string;
}

export const INTEGRATION_PROVIDER_DEFS: Record<IntegrationProvider, IntegrationProviderDef> = {
    google: {
        key: 'google',
        label: 'Google',
        authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        // Sin estos dos Google entrega un access token y NINGÚN refresh: la
        // conexión anda una hora y después se cae sola.
        extra_params: [
            { key: 'access_type', value: 'offline' },
            { key: 'prompt', value: 'consent' },
            { key: 'include_granted_scopes', value: 'true' },
        ],
        base_scopes: 'openid email',
        scope_on_token: false,
        scope_separator: ' ',
        console_url: 'https://console.cloud.google.com/apis/credentials',
    },
    microsoft: {
        key: 'microsoft',
        label: 'Microsoft 365',
        authorize_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        extra_params: [{ key: 'prompt', value: 'select_account' }],
        // `offline_access` es lo que habilita el refresh; `User.Read`, saber
        // qué cuenta se conectó.
        base_scopes: 'openid email offline_access User.Read',
        scope_on_token: true,
        scope_separator: ' ',
        console_url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    },
    slack: {
        key: 'slack',
        label: 'Slack',
        authorize_url: 'https://slack.com/oauth/v2/authorize',
        token_url: 'https://slack.com/api/oauth.v2.access',
        extra_params: [],
        base_scopes: '',
        scope_on_token: false,
        // Slack separa los scopes de bot con comas.
        scope_separator: ',',
        console_url: 'https://api.slack.com/apps',
    },
};

// --- Integraciones (las tarjetas de la galería) --------------------------

export const INTEGRATION_KEYS = [
    'whatsapp',
    'telegram',
    'slack',
    'gmail',
    'google_calendar',
    'google_sheets',
    'google_drive',
    'outlook',
    'woocommerce',
    'sqlserver',
    'mercadopago',
    'wompi',
    's3',
] as const;
export const integrationKeySchema = z.enum(INTEGRATION_KEYS);
export type IntegrationKey = z.infer<typeof integrationKeySchema>;

export function isIntegrationKey(value: unknown): value is IntegrationKey {
    return typeof value === 'string' && (INTEGRATION_KEYS as readonly string[]).includes(value);
}

export const INTEGRATION_CATEGORY_LABEL = {
    mensajeria: 'Mensajería',
    correo: 'Correo',
    calendario: 'Calendario',
    datos: 'Hojas de cálculo',
    comercio: 'Tiendas online',
    bases_datos: 'Bases de datos',
    pagos: 'Cobros y pagos',
    almacenamiento: 'Almacenamiento',
} as const;
export type IntegrationCategory = keyof typeof INTEGRATION_CATEGORY_LABEL;

/** Un dato que la empresa carga al conectar una app por clave. */
export interface IntegrationFieldDef {
    key: string;
    label: string;
    /** Se guarda cifrado y nunca vuelve (a lo sumo un hint de 4). */
    secret: boolean;
    required: boolean;
    placeholder: string;
    help: string;
    /** Va plegado bajo «Opciones avanzadas» (casi nadie lo toca). */
    advanced: boolean;
    default: string;
    /** El servidor puede listar los valores posibles («Buscar mis cuentas»). */
    lookup: boolean;
    /**
     * Lo completa el SERVIDOR al verificar, nunca la persona (v0.1.205): cómo
     * habla la tienda de WooCommerce —si acepta la clave en la cabecera o hay
     * que mandarla en la URL, si tiene enlaces permanentes— se descubre
     * probando, y preguntárselo a alguien que sólo quiere «Conectar» es
     * exactamente la jerga que la galería vino a sacar.
     */
    hidden: boolean;
    /**
     * Cómo se pide (v0.1.243): texto o una casilla (`'true'`/`'false'`). Las
     * conexiones a una base de datos tienen opciones de sí/no —cifrar,
     * confiar en el certificado— que como texto libre serían una trampa.
     */
    type: 'text' | 'boolean' | 'number';
    /**
     * Dónde se guarda un dato SECRETO (v0.1.251). Casi todas las apps tienen
     * una sola clave (`token`); Wompi tiene dos —la llave privada para crear
     * links y el secreto de eventos para verificar sus avisos— y la segunda va
     * al lugar del secreto de firma.
     */
    secret_slot: 'token' | 'signing_secret';
}

export type IntegrationAuth =
    | { kind: 'oauth'; provider: IntegrationProvider; scopes: string }
    | {
          kind: 'key';
          fields: IntegrationFieldDef[];
          how_to: string[];
          /** Mensaje de prueba real antes de guardar: a quién se le manda. */
          test?: { label: string; placeholder: string; help: string };
      };

export interface IntegrationDef {
    key: IntegrationKey;
    name: string;
    /** Una línea para la tarjeta. */
    tagline: string;
    description: string;
    category: IntegrationCategory;
    /** Color de marca de la tarjeta. */
    color: string;
    auth: IntegrationAuth;
    actions: ConnectorAction[];
}

function field(def: Partial<IntegrationFieldDef> & { key: string; label: string }): IntegrationFieldDef {
    return {
        secret: false,
        required: false,
        placeholder: '',
        help: '',
        advanced: false,
        default: '',
        lookup: false,
        hidden: false,
        type: 'text',
        secret_slot: 'token',
        ...def,
    };
}

/**
 * Las acciones usan el shape de las acciones con nombre (fase 2) para que el
 * editor de automatizaciones las pinte con el MISMO formulario. `method`,
 * `path` y `content_type` quedan en sus defaults: aquí no significan nada, la
 * petición la arma el backend.
 */
function action(def: {
    key: string;
    label: string;
    description: string;
    params: Array<Record<string, unknown>>;
}): ConnectorAction {
    return connectorActionSchema.parse(def);
}

/** Zonas horarias ofrecidas para los eventos (el resto se escribe a mano). */
export const EVENT_TIMEZONES: Array<{ value: string; label: string }> = [
    { value: 'America/Bogota', label: 'Bogotá / Lima / Quito (UTC−5)' },
    { value: 'America/Mexico_City', label: 'Ciudad de México (UTC−6)' },
    { value: 'America/Guatemala', label: 'Centroamérica (UTC−6)' },
    { value: 'America/Panama', label: 'Panamá (UTC−5)' },
    { value: 'America/Caracas', label: 'Caracas (UTC−4)' },
    { value: 'America/Santo_Domingo', label: 'Santo Domingo (UTC−4)' },
    { value: 'America/La_Paz', label: 'La Paz (UTC−4)' },
    { value: 'America/Santiago', label: 'Santiago de Chile' },
    { value: 'America/Asuncion', label: 'Asunción' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (UTC−3)' },
    { value: 'America/Montevideo', label: 'Montevideo (UTC−3)' },
    { value: 'America/Sao_Paulo', label: 'São Paulo (UTC−3)' },
    { value: 'America/New_York', label: 'Nueva York / Miami' },
    { value: 'America/Los_Angeles', label: 'Los Ángeles' },
    { value: 'Europe/Madrid', label: 'Madrid' },
    { value: 'UTC', label: 'UTC' },
];

const eventParams: Array<Record<string, unknown>> = [
    { key: 'title', label: 'Título', required: true },
    {
        key: 'date',
        label: 'Fecha',
        required: true,
        help: 'AAAA-MM-DD o una variable como {{fecha}}. Si el campo trae hora, el evento se crea a esa hora.',
    },
    { key: 'time', label: 'Hora de inicio', help: 'HH:MM (24 h). Vacío = evento de todo el día.' },
    { key: 'duration', label: 'Duración (minutos)', type: 'number', default: '60' },
    {
        key: 'timezone',
        label: 'Zona horaria',
        type: 'select',
        default: 'America/Bogota',
        options: EVENT_TIMEZONES,
    },
    { key: 'description', label: 'Descripción', type: 'long_text' },
    { key: 'attendees', label: 'Invitados', help: 'Correos separados por coma. Reciben la invitación.' },
];

const emailParams: Array<Record<string, unknown>> = [
    { key: 'to', label: 'Para', required: true, help: 'Uno o varios correos separados por coma.' },
    { key: 'subject', label: 'Asunto', required: true },
    { key: 'body', label: 'Mensaje', type: 'long_text', required: true },
    { key: 'cc', label: 'Cc' },
    { key: 'bcc', label: 'Cco' },
    { key: 'html', label: 'El mensaje es HTML', type: 'boolean', default: 'false' },
];

const WAS_DEFAULT_SERVER = 'https://was.imagina.cloud';

/** Estados de pedido de WooCommerce (los del núcleo; un plugin puede sumar otros). */
export const WOO_ORDER_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'pending', label: 'Pendiente de pago' },
    { value: 'processing', label: 'Procesando' },
    { value: 'on-hold', label: 'En espera' },
    { value: 'completed', label: 'Completado' },
    { value: 'cancelled', label: 'Cancelado' },
    { value: 'refunded', label: 'Reembolsado' },
    { value: 'failed', label: 'Fallido' },
    { value: 'checkout-draft', label: 'Borrador' },
    { value: 'trash', label: 'En la papelera' },
];

export const INTEGRATIONS: readonly IntegrationDef[] = [
    {
        key: 'whatsapp',
        name: 'WhatsApp',
        tagline: 'Manda mensajes de WhatsApp desde tus automatizaciones.',
        description:
            'Usa tu cuenta de Imagina WAS: avisos de vencimiento, confirmaciones, recordatorios de pago. El número de destino lo toma del registro.',
        category: 'mensajeria',
        color: '#25D366',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'secret',
                    label: 'Clave de API',
                    secret: true,
                    required: true,
                    placeholder: 'Pega la clave',
                    help: 'En tu panel de WAS: Herramientas → Claves de API.',
                }),
                field({
                    key: 'account',
                    label: 'Cuenta de WhatsApp',
                    required: true,
                    lookup: true,
                    placeholder: 'Elige la cuenta',
                    help: 'El número conectado en WAS desde el que salen los mensajes.',
                }),
                field({
                    key: 'server',
                    label: 'Servidor',
                    advanced: true,
                    default: WAS_DEFAULT_SERVER,
                    placeholder: WAS_DEFAULT_SERVER,
                    help: 'Sólo si usas un servidor de WAS propio.',
                }),
            ],
            how_to: [
                'Entra a tu panel de WhatsApp (WAS).',
                'Ve a Herramientas → Claves de API y copia la clave.',
                'Pégala aquí y toca «Buscar mis cuentas» para elegir el número. Si tu clave no tiene permiso para listar cuentas, escribe a mano el identificador de la cuenta (el mismo que ya usas en tus envíos).',
                'Mándate un mensaje de prueba a tu propio número: si llega, quedó conectado.',
            ],
            test: {
                label: 'Número para el mensaje de prueba',
                placeholder: '+573001234567',
                help: 'Con indicativo de país. Llega un WhatsApp real desde la cuenta elegida.',
            },
        },
        actions: [
            action({
                key: 'send_text',
                label: 'Enviar mensaje de WhatsApp',
                description: 'Un mensaje de texto a un número.',
                params: [
                    {
                        key: 'recipient',
                        label: 'Número de destino',
                        required: true,
                        help: 'Con indicativo de país, por ejemplo +573001234567. Puedes usar {{telefono}}.',
                    },
                    { key: 'message', label: 'Mensaje', type: 'long_text', required: true },
                ],
            }),
            action({
                key: 'send_media',
                label: 'Enviar archivo por WhatsApp',
                description: 'Una imagen, video, audio o PDF con un texto opcional.',
                params: [
                    { key: 'recipient', label: 'Número de destino', required: true },
                    {
                        key: 'url',
                        label: 'Enlace del archivo',
                        required: true,
                        help: 'Dirección pública del archivo (https://…).',
                    },
                    {
                        key: 'kind',
                        label: 'Tipo de archivo',
                        type: 'select',
                        default: 'image',
                        options: [
                            { value: 'image', label: 'Imagen' },
                            { value: 'video', label: 'Video' },
                            { value: 'audio', label: 'Audio' },
                            { value: 'document', label: 'Documento PDF' },
                        ],
                    },
                    { key: 'caption', label: 'Texto que lo acompaña', type: 'long_text' },
                ],
            }),
        ],
    },
    {
        key: 'telegram',
        name: 'Telegram',
        tagline: 'Avisos a un chat, grupo o canal de Telegram.',
        description:
            'Conecta un bot de Telegram y manda mensajes a tu equipo o a tus clientes cuando pase algo en una lista.',
        category: 'mensajeria',
        color: '#26A5E4',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'token',
                    label: 'Token del bot',
                    secret: true,
                    required: true,
                    placeholder: '123456789:AA…',
                    help: 'Lo entrega @BotFather cuando creas el bot.',
                }),
            ],
            how_to: [
                'En Telegram abre @BotFather y escribe /newbot.',
                'Elige un nombre y copia el token que te devuelve.',
                'Agrega el bot al grupo o canal donde quieras recibir los avisos.',
            ],
            test: {
                label: 'Chat para el mensaje de prueba',
                placeholder: '-1001234567890 o @mi_canal',
                help: 'El ID del chat, grupo o canal donde está el bot.',
            },
        },
        actions: [
            action({
                key: 'send_message',
                label: 'Enviar mensaje de Telegram',
                description: 'Un mensaje a un chat, grupo o canal.',
                params: [
                    {
                        key: 'chat_id',
                        label: 'Chat, grupo o canal',
                        required: true,
                        help: 'El @nombre de un canal público, o el número del chat (por ejemplo -1001234567890). El bot tiene que estar adentro.',
                    },
                    { key: 'text', label: 'Mensaje', type: 'long_text', required: true },
                    { key: 'silent', label: 'Enviar sin sonido', type: 'boolean', default: 'false' },
                ],
            }),
        ],
    },
    {
        key: 'slack',
        name: 'Slack',
        tagline: 'Mensajes a los canales de tu equipo.',
        description:
            'Avisa en un canal cuando se crea un registro, cambia un estado o vence una fecha.',
        category: 'mensajeria',
        color: '#4A154B',
        auth: { kind: 'oauth', provider: 'slack', scopes: 'chat:write,chat:write.public' },
        actions: [
            action({
                key: 'send_message',
                label: 'Enviar mensaje a Slack',
                description: 'Publica un mensaje en un canal.',
                params: [
                    {
                        key: 'channel',
                        label: 'Canal',
                        required: true,
                        help: 'El nombre (#ventas) o el ID del canal. En canales privados, invita primero la app con /invite.',
                    },
                    { key: 'text', label: 'Mensaje', type: 'long_text', required: true },
                ],
            }),
        ],
    },
    {
        key: 'gmail',
        name: 'Gmail',
        tagline: 'Envia correos desde tu propia cuenta de Gmail.',
        description:
            'Los correos salen desde tu dirección de Gmail o Google Workspace y quedan en tus enviados.',
        category: 'correo',
        color: '#EA4335',
        auth: { kind: 'oauth', provider: 'google', scopes: 'https://www.googleapis.com/auth/gmail.send' },
        actions: [
            action({
                key: 'send_email',
                label: 'Enviar correo con Gmail',
                description: 'Sale desde la cuenta de Gmail conectada.',
                params: emailParams,
            }),
        ],
    },
    {
        key: 'google_calendar',
        name: 'Google Calendar',
        tagline: 'Crea eventos en tu calendario.',
        description:
            'Agenda reuniones, visitas o vencimientos a partir de las fechas de tus registros.',
        category: 'calendario',
        color: '#4285F4',
        auth: {
            kind: 'oauth',
            provider: 'google',
            scopes: 'https://www.googleapis.com/auth/calendar.events',
        },
        actions: [
            action({
                key: 'create_event',
                label: 'Crear evento en Google Calendar',
                description: 'Con fecha, hora, duración e invitados.',
                params: [
                    {
                        key: 'calendar',
                        label: 'Calendario',
                        help: 'Vacío = tu calendario principal. Para otro, su ID (está en la configuración del calendario).',
                    },
                    ...eventParams,
                ],
            }),
        ],
    },
    {
        key: 'google_sheets',
        name: 'Google Sheets',
        tagline: 'Agrega filas a una hoja de cálculo.',
        description:
            'Cada vez que pase algo en una lista, suma una fila a tu planilla: un registro de ventas, un respaldo, un reporte.',
        category: 'datos',
        color: '#34A853',
        auth: {
            kind: 'oauth',
            provider: 'google',
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        },
        actions: [
            action({
                key: 'append_row',
                label: 'Agregar fila en Google Sheets',
                description: 'Suma una fila al final de la hoja.',
                params: [
                    {
                        key: 'spreadsheet',
                        label: 'Hoja de cálculo',
                        required: true,
                        help: 'Pega el enlace de la planilla (https://docs.google.com/spreadsheets/d/…).',
                    },
                    { key: 'sheet', label: 'Pestaña', help: 'Nombre de la pestaña. Vacío = la primera.' },
                    {
                        key: 'values',
                        label: 'Valores de la fila',
                        type: 'long_text',
                        required: true,
                        help: 'Uno por renglón, en el orden de las columnas (A, B, C…). Por ejemplo {{nombre}}, después {{email}}, después {{monto}}.',
                    },
                ],
            }),
        ],
    },
    {
        // v0.1.269 (ADR-S36) — almacenamiento propio en Google Drive. Pide
        // `drive.file`: la app SÓLO ve lo que ella misma crea (una carpeta
        // «Imagina Base»), nunca el resto del Drive. Es un permiso NO sensible.
        key: 'google_drive',
        name: 'Google Drive',
        tagline: 'Guarda los archivos de tu empresa en tu Google Drive.',
        description:
            'Conecta la cuenta de Google de la empresa y elígela en Ajustes → Almacenamiento: los archivos que se suban y los PDF que se guarden van a una carpeta de tu Drive y no ocupan el espacio de tu plan. La app sólo ve los archivos que ella misma crea ahí.',
        category: 'almacenamiento',
        color: '#1FA463',
        auth: {
            kind: 'oauth',
            provider: 'google',
            scopes: 'https://www.googleapis.com/auth/drive.file',
        },
        actions: [],
    },
    {
        key: 'outlook',
        name: 'Outlook',
        tagline: 'Correo y calendario de Microsoft 365.',
        description:
            'Envia correos desde tu cuenta de Outlook y crea eventos en tu calendario de Microsoft 365.',
        category: 'correo',
        color: '#0078D4',
        auth: { kind: 'oauth', provider: 'microsoft', scopes: 'Mail.Send Calendars.ReadWrite' },
        actions: [
            action({
                key: 'send_email',
                label: 'Enviar correo con Outlook',
                description: 'Sale desde la cuenta de Outlook conectada.',
                params: emailParams,
            }),
            action({
                key: 'create_event',
                label: 'Crear evento en Outlook',
                description: 'En el calendario de la cuenta conectada.',
                params: eventParams,
            }),
        ],
    },
    {
        key: 'woocommerce',
        name: 'WooCommerce',
        tagline: 'Tu tienda online: pedidos, clientes y productos.',
        description:
            'Conecta tu tienda de WordPress para actualizar productos, precios y stock, cambiar el estado de los pedidos y crear cupones desde tus automatizaciones.',
        category: 'comercio',
        color: '#7F54B3',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'store_url',
                    label: 'Dirección de la tienda',
                    required: true,
                    placeholder: 'https://mitienda.com',
                    help: 'La dirección de tu sitio de WordPress. Tiene que tener HTTPS (candado).',
                }),
                field({
                    key: 'consumer_key',
                    label: 'Clave del cliente',
                    required: true,
                    placeholder: 'ck_…',
                    help: 'Empieza con ck_.',
                }),
                field({
                    key: 'consumer_secret',
                    label: 'Clave secreta',
                    secret: true,
                    required: true,
                    placeholder: 'cs_…',
                    help: 'Empieza con cs_. Se guarda cifrada.',
                }),
                // Los completa la verificación (ver `hidden`).
                field({ key: 'auth_mode', label: 'Autenticación', hidden: true, default: 'header' }),
                field({ key: 'api_style', label: 'Rutas', hidden: true, default: 'pretty' }),
            ],
            how_to: [
                'En el panel de WordPress ve a WooCommerce → Ajustes → Avanzado → API REST.',
                'Toca «Añadir clave», pon una descripción (por ejemplo «Imagina Base») y en Permisos elige «Lectura/Escritura».',
                'Toca «Generar clave API» y copia la clave del cliente (ck_…) y la clave secreta (cs_…) aquí. La secreta sólo se muestra esa vez.',
            ],
        },
        actions: [
            action({
                key: 'update_product',
                label: 'Actualizar producto en WooCommerce',
                description: 'Precio, rebaja, stock, estado o campos de otros plugins.',
                params: [
                    {
                        key: 'product_id',
                        label: 'ID del producto',
                        required: true,
                        help: 'El número del producto en WooCommerce. En una lista sincronizada es la columna «ID WooCommerce» ({{woo_id}}).',
                    },
                    {
                        key: 'variation_id',
                        label: 'ID de la variación',
                        help: 'Sólo para productos variables: para cambiar el precio o el stock de UNA variante (talla, color).',
                    },
                    { key: 'name', label: 'Nombre', help: 'Vacío = no se cambia.' },
                    { key: 'regular_price', label: 'Precio normal', help: 'Vacío = no se cambia.' },
                    {
                        key: 'sale_price',
                        label: 'Precio rebajado',
                        help: 'Vacío = no se cambia. Escribe «quitar» para sacar la rebaja.',
                    },
                    {
                        key: 'stock_quantity',
                        label: 'Stock (unidades)',
                        type: 'number',
                        help: 'Activa la gestión de inventario del producto.',
                    },
                    {
                        key: 'stock_status',
                        label: 'Estado del inventario',
                        type: 'select',
                        options: [
                            { value: '', label: 'No cambiar' },
                            { value: 'instock', label: 'Hay existencias' },
                            { value: 'outofstock', label: 'Agotado' },
                            { value: 'onbackorder', label: 'Se puede reservar' },
                        ],
                    },
                    {
                        key: 'status',
                        label: 'Publicación',
                        type: 'select',
                        options: [
                            { value: '', label: 'No cambiar' },
                            { value: 'publish', label: 'Publicado' },
                            { value: 'draft', label: 'Borrador' },
                            { value: 'pending', label: 'Pendiente de revisión' },
                            { value: 'private', label: 'Privado' },
                        ],
                    },
                    {
                        key: 'meta',
                        label: 'Campos personalizados (meta)',
                        type: 'long_text',
                        help: 'Uno por renglón, con el formato clave=valor. Sirve para los campos que agregan otros plugins (ACF, Yoast, etc.).',
                    },
                ],
            }),
            action({
                key: 'update_order_status',
                label: 'Cambiar el estado de un pedido',
                description: 'WooCommerce manda al cliente el correo que corresponda al estado nuevo.',
                params: [
                    {
                        key: 'order_id',
                        label: 'ID del pedido',
                        required: true,
                        help: 'El número del pedido en WooCommerce ({{woo_id}} en una lista sincronizada).',
                    },
                    {
                        key: 'status',
                        label: 'Estado nuevo',
                        type: 'select',
                        required: true,
                        default: 'completed',
                        // Los que se ELIGEN a mano: el borrador del checkout y la
                        // papelera no son estados que se pongan con un PUT.
                        options: WOO_ORDER_STATUS_OPTIONS.filter(
                            (o) => o.value !== 'checkout-draft' && o.value !== 'trash',
                        ),
                    },
                ],
            }),
            action({
                key: 'add_order_note',
                label: 'Agregar una nota al pedido',
                description: 'Una nota interna, o una nota que le llega al cliente por correo.',
                params: [
                    { key: 'order_id', label: 'ID del pedido', required: true },
                    { key: 'note', label: 'Nota', type: 'long_text', required: true },
                    {
                        key: 'customer_note',
                        label: 'Enviársela al cliente',
                        type: 'boolean',
                        default: 'false',
                        help: 'Si está activo, WooCommerce le manda la nota al cliente por correo.',
                    },
                ],
            }),
            action({
                key: 'create_coupon',
                label: 'Crear un cupón',
                description: 'Un cupón de descuento, por ejemplo para un cliente puntual.',
                params: [
                    { key: 'code', label: 'Código', required: true, help: 'Lo que el cliente escribe al pagar.' },
                    {
                        key: 'discount_type',
                        label: 'Tipo de descuento',
                        type: 'select',
                        default: 'percent',
                        options: [
                            { value: 'percent', label: 'Porcentaje' },
                            { value: 'fixed_cart', label: 'Monto fijo sobre el carrito' },
                            { value: 'fixed_product', label: 'Monto fijo por producto' },
                        ],
                    },
                    { key: 'amount', label: 'Valor del descuento', type: 'number', required: true },
                    { key: 'date_expires', label: 'Vence el', help: 'AAAA-MM-DD. Vacío = no vence.' },
                    { key: 'usage_limit', label: 'Usos en total', type: 'number' },
                    { key: 'usage_limit_per_user', label: 'Usos por cliente', type: 'number' },
                    {
                        key: 'email_restrictions',
                        label: 'Sólo para estos correos',
                        help: 'Separados por coma. Vacío = cualquiera.',
                    },
                    { key: 'minimum_amount', label: 'Compra mínima', type: 'number' },
                    { key: 'free_shipping', label: 'Incluye envío gratis', type: 'boolean', default: 'false' },
                    { key: 'individual_use', label: 'No se combina con otros cupones', type: 'boolean', default: 'false' },
                    { key: 'description', label: 'Descripción interna' },
                ],
            }),
        ],
    },
    {
        key: 'mercadopago',
        name: 'Mercado Pago',
        tagline: 'Cobra con links de pago y entérate solo cuando te pagan.',
        description:
            'Crea links de pago desde un registro o una automatización (PSE, Nequi, tarjeta, efectivo), mándalos por WhatsApp o correo, y la lista se actualiza sola cuando el cliente paga: estado, fecha, monto y medio.',
        category: 'pagos',
        color: '#00B1EA',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'access_token',
                    label: 'Access Token',
                    secret: true,
                    required: true,
                    placeholder: 'APP_USR-…',
                    help: 'El de producción empieza con APP_USR-. Para probar, el de prueba (TEST-). Se guarda cifrado.',
                }),
            ],
            how_to: [
                'Entra a mercadopago.com.co/developers → Tus integraciones y crea una aplicación (o abre la que ya tengas).',
                'En «Credenciales de producción» copia el Access Token (empieza con APP_USR-) y pégalo aquí. Para probar sin dinero real, usa el de prueba (TEST-).',
                'Listo: los pagos te llegan a TU cuenta de Mercado Pago, sin comisión de Imagina Base. Cada link le avisa a la app cuando se paga; no hay que configurar nada más.',
            ],
        },
        actions: [
            action({
                key: 'create_payment_link',
                label: 'Crear link de pago (Mercado Pago)',
                description: 'Un link para que el cliente pague; queda en el registro y se actualiza solo cuando paga.',
                params: [
                    { key: 'title', label: 'Concepto', required: true, help: 'Lo que ve el cliente al pagar. Ej.: Factura {{numero}}.' },
                    { key: 'amount', label: 'Monto', type: 'number', required: true, help: 'Un número o una variable como {{total}}.' },
                    {
                        key: 'currency',
                        label: 'Moneda',
                        type: 'select',
                        default: 'COP',
                        options: [
                            { value: 'COP', label: 'Peso colombiano (COP)' },
                            { value: 'MXN', label: 'Peso mexicano (MXN)' },
                            { value: 'ARS', label: 'Peso argentino (ARS)' },
                            { value: 'CLP', label: 'Peso chileno (CLP)' },
                            { value: 'PEN', label: 'Sol peruano (PEN)' },
                            { value: 'UYU', label: 'Peso uruguayo (UYU)' },
                            { value: 'BRL', label: 'Real (BRL)' },
                        ],
                        help: 'La de tu cuenta de Mercado Pago.',
                    },
                    { key: 'payer_email', label: 'Correo del cliente', help: 'Opcional: Mercado Pago lo usa para precompletar el pago.' },
                    { key: 'expires_days', label: 'Vence en (días)', type: 'number', help: 'Vacío = no vence.' },
                ],
            }),
        ],
    },
    {
        key: 'wompi',
        name: 'Wompi',
        tagline: 'Links de pago de Bancolombia: PSE, Nequi, tarjeta y efectivo.',
        description:
            'Crea links de pago de Wompi desde un registro o una automatización, y la lista se actualiza sola cuando el cliente paga: estado, fecha, monto y medio.',
        category: 'pagos',
        color: '#2C2A29',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'public_key',
                    label: 'Llave pública',
                    required: true,
                    placeholder: 'pub_prod_…',
                    help: 'Empieza con pub_prod_ (o pub_test_ para probar).',
                }),
                field({
                    key: 'private_key',
                    label: 'Llave privada',
                    secret: true,
                    required: true,
                    placeholder: 'prv_prod_…',
                    help: 'Empieza con prv_prod_ (o prv_test_). Se guarda cifrada.',
                }),
                field({
                    key: 'events_secret',
                    label: 'Secreto de eventos',
                    secret: true,
                    secret_slot: 'signing_secret',
                    placeholder: 'prod_events_…',
                    help: 'Para verificar los avisos de pago que manda Wompi. Se guarda cifrado.',
                }),
            ],
            how_to: [
                'Entra a comercios.wompi.co → Desarrolladores → Programadores.',
                'Copia la llave pública (pub_prod_…), la llave privada (prv_prod_…) y el secreto de Eventos (prod_events_…) y pégalos aquí. Para probar sin dinero real, usa las de Sandbox (test).',
                'Después de conectar, abre «Cobros» en esta conexión, copia la URL de eventos y pégala en Wompi → Desarrolladores → «URL de Eventos». Así la app se entera sola de cada pago.',
            ],
        },
        actions: [
            action({
                key: 'create_payment_link',
                label: 'Crear link de pago (Wompi)',
                description: 'Un link para que el cliente pague; queda en el registro y se actualiza solo cuando paga.',
                params: [
                    { key: 'title', label: 'Concepto', required: true, help: 'Lo que ve el cliente al pagar. Ej.: Factura {{numero}}.' },
                    { key: 'amount', label: 'Monto (COP)', type: 'number', required: true, help: 'Un número o una variable como {{total}}.' },
                    { key: 'payer_email', label: 'Correo del cliente', help: 'Opcional.' },
                    { key: 'expires_days', label: 'Vence en (días)', type: 'number', help: 'Vacío = no vence.' },
                ],
            }),
        ],
    },
    {
        key: 'sqlserver',
        name: 'SQL Server / Azure SQL',
        tagline: 'Trae datos de tu base de datos a una lista, cada hora o cada día.',
        description:
            'Conecta una base de SQL Server o Azure SQL con un usuario de solo lectura y carga el resultado de una consulta o de un procedimiento almacenado en una lista, actualizando por una columna clave (NIT, número de factura) en vez de duplicar.',
        category: 'bases_datos',
        color: '#CC2927',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'server',
                    label: 'Servidor',
                    required: true,
                    placeholder: 'miservidor.database.windows.net',
                    help: 'El nombre o la IP del servidor, sin «https://». Tiene que ser accesible desde internet.',
                }),
                field({ key: 'database', label: 'Base de datos', required: true, placeholder: 'Ventas' }),
                field({
                    key: 'user',
                    label: 'Usuario',
                    required: true,
                    placeholder: 'imagina_lectura',
                    help: 'Te recomendamos un usuario de SOLO LECTURA (db_datareader).',
                }),
                field({ key: 'password', label: 'Contraseña', secret: true, required: true, help: 'Se guarda cifrada.' }),
                field({ key: 'port', label: 'Puerto', advanced: true, default: '1433', type: 'number' }),
                field({
                    key: 'encrypt',
                    label: 'Conexión cifrada (TLS)',
                    advanced: true,
                    default: 'true',
                    type: 'boolean',
                    help: 'Azure SQL la exige. Apágala sólo si tu servidor no tiene TLS configurado.',
                }),
                field({
                    key: 'trust_server_certificate',
                    label: 'Confiar en el certificado del servidor',
                    advanced: true,
                    default: 'false',
                    type: 'boolean',
                    help: 'Sólo para servidores propios con un certificado autofirmado. En Azure déjalo apagado.',
                }),
            ],
            how_to: [
                'Pídele a quien administra la base un usuario de solo lectura (rol db_datareader y, si vas a usar un procedimiento, permiso EXECUTE sobre él).',
                'Si es Azure SQL: en el portal de Azure → tu servidor SQL → Redes, agrega la IP de este servidor a las reglas del firewall.',
                'Si es un servidor propio: tiene que aceptar conexiones en el puerto 1433 desde la IP de este servidor (o por una VPN).',
                'Después de conectar, arma la sincronización con «Sincronizaciones».',
            ],
        },
        actions: [],
    },
    {
        // v0.1.268 (ADR-S36) — almacenamiento propio de la empresa. Una sola
        // integración cubre a todos los que hablan S3: Amazon, Backblaze B2,
        // Cloudflare R2, Wasabi, DigitalOcean Spaces, MinIO…
        key: 's3',
        name: 'Almacenamiento S3',
        tagline: 'Guarda los archivos de tu empresa en tu propio bucket (Amazon S3, Backblaze, Cloudflare R2…).',
        description:
            'Conecta un bucket compatible con S3 y elígelo en Ajustes → Almacenamiento: los archivos que se suban y los PDF que se guarden van ahí, no ocupan el espacio de tu plan y se descargan directo desde tu bucket.',
        category: 'almacenamiento',
        color: '#E25444',
        auth: {
            kind: 'key',
            fields: [
                field({
                    key: 'endpoint',
                    label: 'Dirección del servicio (endpoint)',
                    placeholder: 'https://s3.us-east-005.backblazeb2.com',
                    help: 'Vacío = Amazon S3. Backblaze: https://s3.<región>.backblazeb2.com · Cloudflare R2: https://<cuenta>.r2.cloudflarestorage.com · Wasabi: https://s3.<región>.wasabisys.com · DigitalOcean: https://<región>.digitaloceanspaces.com',
                }),
                field({
                    key: 'region',
                    label: 'Región',
                    placeholder: 'us-east-1',
                    default: 'us-east-1',
                    help: 'La del bucket (us-east-005, eu-central-1…). En Cloudflare R2 pon «auto».',
                }),
                field({ key: 'bucket', label: 'Bucket', required: true, placeholder: 'mi-empresa-archivos' }),
                field({
                    key: 'access_key_id',
                    label: 'ID de la clave de acceso',
                    required: true,
                    placeholder: 'AKIA… / 005a1b2c…',
                    help: 'En Backblaze se llama keyID; en R2, Access Key ID.',
                }),
                field({
                    key: 'secret_access_key',
                    label: 'Clave secreta',
                    secret: true,
                    required: true,
                    help: 'En Backblaze se llama applicationKey. Se guarda cifrada.',
                }),
                field({
                    key: 'prefix',
                    label: 'Carpeta dentro del bucket',
                    advanced: true,
                    placeholder: 'imagina/',
                    help: 'Opcional: los archivos se guardan bajo esta carpeta.',
                }),
                field({
                    key: 'path_style',
                    label: 'Estilo de ruta (path-style)',
                    advanced: true,
                    type: 'boolean',
                    default: 'false',
                    help: 'Enciéndelo para MinIO o servidores propios. Amazon, Backblaze, R2 y Wasabi funcionan apagado.',
                }),
            ],
            how_to: [
                'Crea un bucket PRIVADO en tu proveedor (no hace falta que sea público: los archivos se entregan con enlaces temporales).',
                'Crea una clave de acceso que pueda leer, escribir y borrar en ese bucket (en Backblaze: «Application Key» con acceso a ese bucket; en R2: un token de API «Object Read & Write»).',
                'Pega aquí la dirección, la región, el bucket y la clave. Al conectar probamos subir, leer y borrar un archivo chiquito.',
                'Después elígelo en Ajustes → Almacenamiento y, si quieres, mueve ahí los archivos que ya tienes.',
            ],
        },
        actions: [],
    },
];

export function integrationDef(key: unknown): IntegrationDef | null {
    return INTEGRATIONS.find((i) => i.key === key) ?? null;
}

/** Permisos completos que se piden al autorizar una integración OAuth. */
export function integrationScopes(def: IntegrationDef): string {
    if (def.auth.kind !== 'oauth') return '';
    const provider = INTEGRATION_PROVIDER_DEFS[def.auth.provider];
    const sep = provider.scope_separator;
    const parts = [provider.base_scopes, def.auth.scopes]
        .flatMap((s) => s.split(/[\s,]+/))
        .map((s) => s.trim())
        .filter(Boolean);
    return [...new Set(parts)].join(sep);
}

// --- API: galería de la empresa ----------------------------------------

export const integrationsOverviewSchema = z.object({
    /** Proveedores OAuth que el operador ya configuró. */
    providers: z.record(z.object({ configured: z.boolean() })),
    /** Si puede conectar apps para todo el equipo (admin). */
    can_connect_workspace: z.boolean(),
    /** Si puede conectar apps sólo para sí (conexiones privadas habilitadas). */
    can_connect_private: z.boolean(),
    /** Superadmin de plataforma: puede ir a configurar los proveedores. */
    is_platform_admin: z.boolean(),
});
export type IntegrationsOverview = z.infer<typeof integrationsOverviewSchema>;

/** Conectar una app por clave (o actualizar la clave de una ya conectada). */
export const connectIntegrationKeySchema = z.object({
    fields: z.record(z.string().max(4000)).default({}),
    visibility: connectorVisibilitySchema.default('workspace'),
    /** Si viene, se actualiza esa conexión en vez de crear otra. */
    connection_id: idSchema.nullish(),
});
export type ConnectIntegrationKeyInput = z.infer<typeof connectIntegrationKeySchema>;

export const verifyIntegrationSchema = z.object({
    fields: z.record(z.string().max(4000)).default({}),
    /** Para reusar la clave ya guardada sin volver a pegarla. */
    connection_id: idSchema.nullish(),
    /**
     * Destino de un mensaje de prueba REAL (número de WhatsApp, chat de
     * Telegram). Es lo único que prueba una clave de verdad: listar cuentas
     * puede estar prohibido para una clave que envía perfecto.
     */
    test_to: z.string().trim().max(120).nullish(),
});
export type VerifyIntegrationInput = z.infer<typeof verifyIntegrationSchema>;

export const verifyIntegrationResultSchema = z.object({
    ok: z.boolean(),
    /** Con qué cuenta quedaría conectada («@mi_bot», «+57 300…»). */
    account_label: z.string().nullable(),
    error: z.string().nullable(),
    /** Aviso no bloqueante (no se pudo comprobar, pero se puede guardar). */
    warning: z.string().nullable(),
    /** Valores posibles para los campos con `lookup` (cuentas de WhatsApp). */
    options: z.record(z.array(z.object({ value: z.string(), label: z.string() }))),
    /** Se pidió un mensaje de prueba y el servicio lo aceptó. */
    test_sent: z.boolean().default(false),
});
export type VerifyIntegrationResult = z.infer<typeof verifyIntegrationResultSchema>;

/** Autorizar una app OAuth (nueva conexión o reconectar una existente). */
export const authorizeIntegrationSchema = z.object({
    visibility: connectorVisibilitySchema.default('workspace'),
    connection_id: idSchema.nullish(),
});
export type AuthorizeIntegrationInput = z.infer<typeof authorizeIntegrationSchema>;

// --- API: apps registradas por el operador ------------------------------

export const platformIntegrationAppSchema = z.object({
    provider: integrationProviderSchema,
    configured: z.boolean(),
    client_id: z.string(),
    has_secret: z.boolean(),
    secret_hint: z.string().nullable(),
    /** El secreto existe pero no se descifra con la SECRETS_KEY actual. */
    secret_unreadable: z.boolean(),
    /** Cuántas conexiones de empresas usan hoy esta app. */
    connections: z.number().int().min(0),
});
export type PlatformIntegrationApp = z.infer<typeof platformIntegrationAppSchema>;

export const platformIntegrationsSchema = z.object({
    /** La URI que hay que registrar en cada proveedor. */
    redirect_uri: z.string(),
    apps: z.array(platformIntegrationAppSchema),
});
export type PlatformIntegrations = z.infer<typeof platformIntegrationsSchema>;

export const updatePlatformIntegrationAppSchema = z.object({
    client_id: z.string().trim().max(400).optional(),
    /** Vacío u omitido = conserva el guardado (mismo contrato que el SMTP). */
    client_secret: z.string().trim().max(4000).optional(),
    /** Borra la app registrada: las conexiones de las empresas dejan de renovarse. */
    clear: z.boolean().optional(),
});
export type UpdatePlatformIntegrationAppInput = z.infer<typeof updatePlatformIntegrationAppSchema>;
