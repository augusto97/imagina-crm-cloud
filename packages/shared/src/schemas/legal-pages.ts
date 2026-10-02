import { z } from 'zod';

/**
 * Páginas públicas de la plataforma (v0.1.247): inicio, política de
 * privacidad y condiciones. Google, Microsoft y Slack las piden para
 * publicar/verificar la app de integraciones, y la de Google exige que la
 * página principal sea PÚBLICA (sin login), describa la app y enlace a una
 * política que explique qué se hace con los datos de Google — incluida la
 * frase de «uso limitado». Sin eso la verificación se rechaza.
 *
 * Los textos son plantillas con marcadores (`{{app_name}}`, `{{company}}`…)
 * que se resuelven al servir la página, así editar el nombre de la empresa
 * actualiza las tres páginas. Formato: un markdown mínimo (`## título`,
 * `- ítem`, `**negrita**`, `[texto](https://…)`) que el servidor escapa.
 */

const httpsUrl = z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/i.test(v), { message: 'Tiene que empezar con https://' });

export const platformLegalSchema = z.object({
    app_name: z.string().trim().min(1).max(80).default('Imagina Base'),
    company_name: z.string().trim().max(160).default(''),
    contact_email: z
        .string()
        .trim()
        .max(254)
        .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: 'Correo inválido' })
        .default(''),
    /** Sitio web de la empresa operadora (opcional, se enlaza en el pie). */
    website_url: httpsUrl.default(''),
    /** Descripción de la app para la página principal. Vacío = la sugerida. */
    description: z.string().trim().max(3000).default(''),
    /** `null` = usar el texto sugerido (y recibir sus mejoras con cada versión). */
    privacy_md: z.string().max(60000).nullable().default(null),
    terms_md: z.string().max(60000).nullable().default(null),
});
export type PlatformLegal = z.infer<typeof platformLegalSchema>;

export const updatePlatformLegalSchema = z
    .object({
        app_name: z.string().trim().min(1).max(80),
        company_name: z.string().trim().max(160),
        contact_email: platformLegalSchema.shape.contact_email,
        website_url: httpsUrl,
        description: z.string().trim().max(3000),
        privacy_md: z.string().max(60000).nullable(),
        terms_md: z.string().max(60000).nullable(),
    })
    .partial();
export type UpdatePlatformLegalInput = z.infer<typeof updatePlatformLegalSchema>;

export const platformLegalViewSchema = z.object({
    settings: platformLegalSchema,
    urls: z.object({ home: z.string(), privacy: z.string(), terms: z.string() }),
    defaults: z.object({ description: z.string(), privacy_md: z.string(), terms_md: z.string() }),
    /** Qué falta para que las páginas sirvan para una verificación. */
    missing: z.array(z.string()),
});
export type PlatformLegalView = z.infer<typeof platformLegalViewSchema>;

export function legalMissing(s: PlatformLegal): string[] {
    const out: string[] = [];
    if (s.company_name === '') out.push('Nombre de la empresa responsable');
    if (s.contact_email === '') out.push('Correo de contacto');
    return out;
}

export const DEFAULT_APP_DESCRIPTION =
    '{{app_name}} es una plataforma para que cada empresa arme sus propias bases de datos —clientes, ventas, proyectos, facturación, inventario— con vistas de tabla, tablero, calendario y tarjetas, paneles con indicadores y automatizaciones. Cada empresa trabaja en su propio espacio, separado del resto.\n\nLas integraciones son opcionales y las activa cada empresa: con Gmail, Outlook, Google Calendar, Google Sheets o Slack, sus automatizaciones pueden mandar un correo, crear un evento, agregar una fila a una hoja o publicar un mensaje cuando cambia algo en sus datos.';

export const DEFAULT_PRIVACY_MD = `## Quién es responsable
{{company}} opera {{app_name}} ({{app_url}}). Para cualquier consulta sobre tus datos escribinos a {{email}}.

## Qué datos tratamos
- **Datos de tu cuenta**: nombre, correo y contraseña (guardada con un hash irreversible), y los registros de inicio de sesión necesarios para proteger la cuenta.
- **Datos que cada empresa carga**: las listas, registros, archivos y comentarios que una empresa guarda en su espacio. Esos datos son de la empresa; nosotros sólo los guardamos y los procesamos para prestarle el servicio.
- **Datos técnicos**: dirección IP, navegador y registros de errores, para seguridad y para resolver fallas.

## Para qué los usamos
Sólo para prestar el servicio: mostrar y guardar los datos de cada empresa, ejecutar las automatizaciones que ella configura, enviar los correos de la cuenta (verificación, recuperación de contraseña, invitaciones) y mantener la plataforma segura. No vendemos datos ni los usamos para publicidad.

## Integraciones con Google
Si una empresa conecta su cuenta de Google, {{app_name}} recibe sólo los permisos que esa persona acepta y los usa únicamente para lo que la empresa configura en sus automatizaciones:
- **Gmail (gmail.send)**: enviar correos desde esa cuenta. No leemos, buscamos ni guardamos los correos de la casilla.
- **Google Calendar (calendar.events)**: crear eventos en su calendario.
- **Google Sheets (spreadsheets)**: agregar filas a las hojas de cálculo que la empresa indica.

Los tokens de acceso se guardan cifrados y se borran al desconectar la integración. No transferimos los datos de Google a terceros, no los usamos para publicidad ni para entrenar modelos de inteligencia artificial, y ninguna persona los lee salvo que la empresa lo pida para soporte, por seguridad o por obligación legal.

El uso que hace {{app_name}} de la información recibida de las API de Google, y su transferencia a cualquier otra aplicación, se ajusta a la [Política de Datos del Usuario de los Servicios de las API de Google](https://developers.google.com/terms/api-services-user-data-policy), incluidos los requisitos de uso limitado.

{{app_name}}'s use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Integraciones con Microsoft y Slack
Con Outlook usamos sólo los permisos para enviar correos (Mail.Send) y crear eventos (Calendars.ReadWrite) en nombre de la persona que conectó la cuenta; con Slack, sólo publicar mensajes en los canales que la empresa elige. Aplican las mismas reglas que con Google: tokens cifrados, uso limitado a lo que la empresa configura y borrado al desconectar.

## Con quién compartimos datos
Con proveedores que necesitamos para operar (servidores, envío de correo, procesamiento de pagos), bajo contrato y sólo para ese fin. Y con los servicios que cada empresa conecta por su cuenta, cuando sus automatizaciones lo indican.

## Cuánto tiempo los guardamos
Mientras la cuenta o el espacio de la empresa estén activos. Podés descargar tus datos o borrar tu cuenta desde Ajustes → Cuenta; una empresa puede exportar sus listas en cualquier momento.

## Seguridad
Conexiones cifradas (HTTPS), secretos y tokens cifrados en reposo, separación de datos entre empresas a nivel de base de datos, verificación en dos pasos opcional y copias de seguridad.

## Tus derechos
Podés pedir acceso, corrección o eliminación de tus datos escribiendo a {{email}}.

## Cambios
Si cambiamos esta política lo publicamos en esta página. Última actualización: {{updated}}.`;

export const DEFAULT_TERMS_MD = `## El servicio
{{app_name}} ({{app_url}}) es un servicio de {{company}} para que las empresas armen y gestionen sus propias bases de datos, vistas, tableros y automatizaciones.

## Tu cuenta
Sos responsable de mantener segura tu contraseña y de lo que se haga con tu cuenta. Cada empresa decide quién entra a su espacio y con qué permisos.

## Tus datos
Los datos que una empresa carga son suyos. Nos da permiso para guardarlos y procesarlos sólo para prestarle el servicio. Puede exportarlos en cualquier momento, incluso si su plan está impago (en ese caso el espacio queda en modo de sólo lectura, pero los datos no se retienen).

## Uso aceptable
No se puede usar el servicio para enviar correo no deseado, para actividades ilegales, para vulnerar la seguridad de la plataforma o de terceros, ni para cargar contenido que infrinja derechos ajenos.

## Integraciones
Las integraciones con Google, Microsoft, Slack u otros servicios las activa cada empresa con su propia cuenta y quedan sujetas también a los términos de esos servicios.

## Planes y pagos
Los planes pagos se cobran por adelantado según el período elegido. Podés cancelar cuando quieras; el servicio sigue hasta el fin del período pago.

## Disponibilidad y responsabilidad
Hacemos lo razonable para que el servicio esté disponible y para resguardar los datos con copias de seguridad, pero se presta «tal cual»: no respondemos por daños indirectos ni por pérdidas causadas por el uso que cada empresa haga de sus automatizaciones.

## Cambios
Podemos actualizar estas condiciones; los cambios se publican en esta página. Última actualización: {{updated}}.

## Contacto
{{email}}`;

export interface LegalVars {
    app_name: string;
    company: string;
    email: string;
    app_url: string;
    website: string;
    updated: string;
}

/** Reemplaza los marcadores. Lo desconocido queda tal cual. */
export function fillLegalTemplate(text: string, vars: LegalVars): string {
    return text.replace(/\{\{\s*(app_name|company|email|app_url|website|updated)\s*\}\}/g, (_m, key: keyof LegalVars) => {
        const v = vars[key];
        return v === '' ? '—' : v;
    });
}
