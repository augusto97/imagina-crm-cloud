import type { LearnModuleMeta } from '../types';

export const meta: LearnModuleMeta = {
    id: 'ajustes-empresa',
    group: 'admin',
    order: 2,
    title: 'Ajustes de la empresa',
    tagline: 'Tu marca, tu dominio, tu correo y tu forma de trabajar: lo que se configura una vez y vale para todos.',
    icon: 'Building2',
    tone: 'blue',
    hero: 'empresa-branding',
    highlights: [
        'Tu nombre, colores y logo en la app, el portal y los correos',
        'Tu propio dominio para el equipo y otro para tus clientes',
        'Correos que salen desde tu Gmail, Outlook o servidor',
        'Números, fechas y zona horaria como se usan en tu país',
        'Archivos en tu Google Drive o tu propio almacenamiento',
        'Autorización de datos personales con su evidencia',
        'Plan, pagos, problemas, bitácora y papelera bajo control',
    ],
    articles: [
        {
            id: 'ajustes-empresa-marca',
            title: 'Tu marca: nombre, colores y logo',
            summary:
                'Cambia el nombre de la app, el color primario, el color de la barra lateral y el logo para que tu equipo y tus clientes vean tu empresa, no la de otro.',
            minutes: 5,
            level: 'basic',
            keywords: 'marca logo color primario barra lateral nombre de la app personalizar identidad favicon white label',
        },
        {
            id: 'ajustes-empresa-dominio',
            title: 'Tu propio dominio para el equipo y el portal',
            summary:
                'Usa el subdominio incluido o conecta crm.tuempresa.com y clientes.tuempresa.com: verificar que es tuyo, apuntarlo y comprobar que responde.',
            minutes: 7,
            level: 'advanced',
            keywords: 'dominio subdominio propio dns cname txt registro verificar propiedad apuntamiento portal clientes certificado',
        },
        {
            id: 'ajustes-empresa-correo',
            title: 'Por dónde salen los correos de tu empresa',
            summary:
                'Elige entre el correo de la plataforma, tu cuenta de Google o Microsoft, o tu servidor SMTP; entiende los límites, los registros DNS y qué hacer si un correo no llega.',
            minutes: 8,
            level: 'intermediate',
            keywords: 'correo email smtp gmail outlook microsoft google remitente cuota limite spf dkim dmarc diagnosticar no llega spam',
        },
        {
            id: 'ajustes-empresa-formato',
            title: 'Formato regional y zona horaria',
            summary:
                'Decide cómo se ven los números (1.234.567,89), las fechas (31/12/2026), la hora y en qué zona horaria trabaja la empresa: afecta tablas, automatizaciones y vencimientos.',
            minutes: 4,
            level: 'basic',
            keywords: 'formato regional numeros separador miles decimales fecha hora zona horaria colombia bogota 12 horas 24 horas',
        },
        {
            id: 'ajustes-empresa-almacenamiento',
            title: 'Dónde se guardan tus archivos',
            summary:
                'El servidor de la plataforma, tu Google Drive o un almacenamiento propio: cuánto ocupa cada opción del plan y cómo mover los archivos de un lado al otro.',
            minutes: 6,
            level: 'intermediate',
            keywords: 'almacenamiento archivos espacio drive google s3 bucket backblaze cloudflare mover adjuntos plan',
        },
        {
            id: 'ajustes-empresa-datos-personales',
            title: 'Autorización de datos personales (Ley 1581)',
            summary:
                'Arma el texto de autorización de tu empresa, pídelo en formularios y portal, guarda la evidencia de cada aceptación y registra los retiros.',
            minutes: 7,
            level: 'intermediate',
            keywords: 'habeas data ley 1581 autorizacion tratamiento datos personales privacidad consentimiento evidencia retiro titular',
        },
        {
            id: 'ajustes-empresa-problemas',
            title: 'Problemas y registro de actividad',
            summary:
                'Cuando algo que corre solo deja de funcionar te avisamos y queda en Problemas; y en el Registro de actividad ves quién cambió la configuración o borró datos.',
            minutes: 5,
            level: 'basic',
            keywords: 'problemas errores falla automatizacion conector correo aviso bitacora auditoria registro de actividad quien borro',
        },
        {
            id: 'ajustes-empresa-plan',
            title: 'Plan, uso y pagos',
            summary: 'Qué incluye tu plan, cuánto llevas usado, el período de prueba, cómo pagar varios meses o activar la renovación automática, y qué pasa si un pago se atrasa.',
            minutes: 8,
            level: 'basic',
            keywords: 'plan uso limite suscripcion pagar mercado pago paypal pse tarjeta renovacion automatica vencimiento solo lectura exportar factura prueba trial dias de prueba cuenta pausada tu plan no incluye modulos',
        },
        {
            id: 'ajustes-empresa-papelera',
            title: 'La papelera: recuperar lo que se borró',
            summary: 'Registros, listas, campos, vistas, automatizaciones y tableros borrados quedan 30 días en la papelera y vuelven tal cual con un clic.',
            minutes: 4,
            level: 'basic',
            keywords: 'papelera borrado recuperar restaurar deshacer eliminar para siempre vaciar 30 dias',
        },
    ],
};
