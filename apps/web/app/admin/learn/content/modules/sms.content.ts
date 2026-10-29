import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sms-conectar',
        route: '/settings?s=conectores',
        related: ['sms-enviar', 'sms-horario-estado', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Los SMS salen con **tu** cuenta de un proveedor de SMS: cada mensaje se cobra en esa cuenta, no a través de la app. Hoy puedes conectar **Twilio**, **BulkGate**, **Infobip**, **LabsMobile** y **Onurix** pegando su clave. Al conectar, la app consulta tu cuenta (o tu saldo) con el proveedor: si la clave no sirve, te lo dice y no guarda nada.',
            },
            { t: 'anim', key: 'sms-hero', caption: 'Sale el SMS, llega al teléfono y el registro pasa de «En cola» a «Entregado».' },
            { t: 'h', text: 'Qué pide cada proveedor' },
            {
                t: 'settings',
                title: 'Los datos para conectar',
                rows: [
                    { name: 'Twilio', what: 'El **Account SID** (empieza con AC), el **Auth Token** y el remitente: un número de Twilio, un servicio de mensajería (empieza con MG) o un nombre de remitente si tu país lo permite.', tip: 'Una cuenta de prueba de Twilio sólo manda a números verificados en Twilio y antepone un texto de prueba.' },
                    { name: 'BulkGate', what: 'El **Application ID** y el **Application Token** de una API de tu cuenta. El remitente es opcional: vacío usa un número de BulkGate.' },
                    { name: 'Infobip', what: 'Tu **URL base** personal (algo como xxxxx.api.infobip.com), una **clave de API** y, si quieres, el remitente.', tip: 'Si la clave sólo tiene permiso para mandar SMS, no podemos ver el saldo: se guarda igual y conviene mandarte un SMS de prueba.' },
                    { name: 'LabsMobile', what: 'Tu **usuario** (el correo con el que entras) y el **token de API**. El remitente es opcional.' },
                    { name: 'Onurix', what: 'El **Client ID** y la **Key** de Seguridad → Datos de integración API.', tip: 'Onurix rechaza los envíos desde direcciones que no conoce: autoriza ahí mismo la IP de este servidor.' },
                ],
            },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Integraciones** y busca la sección **Mensajes de texto (SMS)**.',
                    'Toca **Conectar** en tu proveedor y pega sus datos. En **Opciones avanzadas** eliges el país para los números sin indicativo (Colombia, si no dices otro) y cuántos SMS por segundo se mandan en un envío a varios.',
                    'Toca **Conectar**. La app comprueba la clave; si el proveedor responde con un problema (clave equivocada, cuenta suspendida, IP no autorizada), lo ves en pantalla.',
                    'Si quieres, escribe tu número y mándate un **SMS de prueba** antes de usarlo con clientes.',
                ],
            },
            { t: 'h', text: 'Cómo llega el estado de entrega' },
            {
                t: 'cards',
                items: [
                    { icon: 'Zap', title: 'Solo, sin configurar nada', md: '**Twilio**, **Infobip** y **LabsMobile**: cada SMS lleva la dirección a la que el proveedor avisa cuando se entrega o falla.', tone: 'mint' },
                    { icon: 'Link2', title: 'Pegando una dirección', md: '**BulkGate**: en la página **SMS** de la conexión copias la dirección de avisos y la pegas en tu cuenta de BulkGate, una sola vez.', tone: 'amber' },
                    { icon: 'Repeat', title: 'La app pregunta', md: '**Onurix** no avisa: la app consulta el estado de cada SMS durante los tres días siguientes al envío.', tone: 'blue' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: '¿Usas otro proveedor?',
                md: 'Si tu proveedor no está en la lista, conéctalo en **Ajustes → Integraciones → Avanzado: API personalizada** con su dirección y su clave, y úsalo con la acción **Llamar webhook externo**. Pierdes el contador de SMS y el estado de entrega, pero el mensaje sale igual.',
            },
            {
                t: 'example',
                title: 'Un taller de motos en Medellín',
                md: 'Conectaron **Onurix** porque ya lo usaban para campañas. En la página **SMS** de la conexión prepararon las columnas de la lista **Órdenes de servicio**, y ahora cada orden muestra cuándo salió el aviso de «moto lista» y si se entregó.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Dónde queda guardada la clave?', a: 'Cifrada en la conexión. Nunca vuelve a mostrarse completa: para cambiarla, toca **Actualizar clave**.' },
                    { q: '¿Qué pasa si se acaba el saldo o revocan la clave?', a: 'El SMS queda **Fallido** con el motivo del proveedor y se abre un aviso en **Ajustes → Problemas**, que se cierra solo cuando la conexión vuelve a mandar.' },
                    { q: '¿Puedo tener varios proveedores?', a: 'Sí. En cada envío o automatización eliges con cuál sale.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Mandar SMS', article: 'sms-enviar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sms-enviar',
        route: '/lists',
        related: ['sms-conectar', 'sms-horario-estado', 'automatizaciones-acciones'],
        blocks: [
            {
                t: 'p',
                md: 'Hay cuatro formas de mandar un SMS: desde la ficha de un registro, a varios registros a la vez, con una automatización y como recordatorio de una cita. En todas, el mensaje acepta variables del registro como `{{nombre}}` y la app te dice cuántos SMS va a ocupar.',
            },
            { t: 'anim', key: 'sms-counter', caption: 'Con «á» o «ó» cada SMS lleva 70 caracteres; sin tildes, 160.' },
            { t: 'h', text: 'Cuántos SMS vas a pagar' },
            {
                t: 'p',
                md: 'Un SMS lleva hasta **160 caracteres**. Si el mensaje es más largo, se manda en partes de **153** y cada parte se cobra. Pero si lleva un carácter que no está en el alfabeto básico de los SMS (como **á, í, ó, ú**, comillas tipográficas o un emoji), cada parte lleva sólo **70** (o 67). Por eso el contador muestra «2 SMS · 145 caracteres» y, si hace falta, ofrece **Quitar tildes para que entre en menos SMS**: cambia «información» por «informacion» al mandarlo. La **ñ**, la **é** y los signos **¿** y **¡** sí entran en el alfabeto básico.',
            },
            { t: 'h', text: 'Desde la ficha de un registro' },
            {
                t: 'steps',
                items: [
                    'Abre el registro y toca el ícono de **Enviar SMS** en la barra de arriba.',
                    'El número sale del campo de teléfono de la lista (puedes cambiarlo para ese envío).',
                    'Escribe el mensaje: debajo ves **Así llega**, con las variables ya completadas con los datos de ese registro, y el contador.',
                    'Toca **Enviar**. En el registro quedan la fecha y el estado del último SMS, y en la actividad «envió un SMS a +57 300…, 1 segmento». El texto del mensaje no se guarda.',
                ],
            },
            { t: 'h', text: 'A varios registros a la vez' },
            {
                t: 'steps',
                items: [
                    'En la tabla, marca los registros (hasta 500 por envío).',
                    'Toca **SMS** en la barra de selección y escribe el mensaje.',
                    'Toca **Revisar**: la app te dice cuántos SMS salen, a cuántas personas, quiénes no lo reciben y por qué (sin teléfono, un número que no sirve, un registro que no puedes editar) y cómo le llega a uno.',
                    'Toca **Enviar**. Los mensajes salen uno por uno, al ritmo de tu proveedor, y ves el resultado de cada registro.',
                ],
            },
            { t: 'h', text: 'Con una automatización' },
            {
                t: 'settings',
                title: 'La acción «Enviar SMS»',
                rows: [
                    { name: 'Para (teléfono)', what: 'Normalmente la variable del campo de teléfono, como `{{telefono}}`. Un número sin indicativo toma el país de la conexión.' },
                    { name: 'Mensaje', what: 'El texto, con variables del registro y el contador de SMS.' },
                    { name: 'Remitente', what: 'Opcional. Vacío usa el de la conexión.' },
                    { name: 'Quitar tildes', what: 'Para que el mensaje ocupe menos SMS.' },
                    { name: 'Respetar el horario (Ley 2300)', what: 'Para cobros y mensajes comerciales: fuera del horario permitido, el SMS queda programado.' },
                    { name: 'Probar ahora', what: 'Completa las variables con un registro real y te muestra lo que saldría. **No manda nada.**' },
                    { name: 'Enviarme una prueba', what: 'Manda el SMS de verdad a tu número (se cobra como un SMS) sin tocar ningún registro.' },
                ],
            },
            { t: 'h', text: 'Recordatorios de citas por SMS' },
            {
                t: 'p',
                md: 'En la agenda de citas, en **Correos y recordatorios**, marca **Mandar los recordatorios también por SMS**, elige la conexión y escribe el texto con datos de la cita, como `{{cita.cliente}}`, `{{cita.inicio}}` o `{{cita.enlace_reprogramar}}`. Salen en los mismos momentos que los recordatorios por correo, al teléfono que dejó el cliente.',
            },
            {
                t: 'example',
                title: 'Una cadena de panaderías',
                md: 'Cuando un pedido de torta pasa a **Listo**, una automatización manda «Hola {{cliente}}, tu torta ya está lista en {{sede}}». Con **Quitar tildes** el aviso entra en un solo SMS, y la columna **Estado del último SMS** les muestra a quién no le llegó para llamarlo.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver las automatizaciones', to: '/lists' },
                    { label: 'El horario y el estado', article: 'sms-horario-estado' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sms-horario-estado',
        route: '/settings?s=conectores',
        related: ['sms-enviar', 'sms-conectar'],
        blocks: [
            {
                t: 'p',
                md: 'En Colombia, la **Ley 2300 de 2023** limita cuándo se puede contactar a una persona para cobrarle y, por el mismo artículo, para mandarle publicidad por mensajes: de **lunes a viernes de 7:00 a. m. a 7:00 p. m.** y los **sábados de 8:00 a. m. a 3:00 p. m.**; nunca los **domingos ni festivos**. La app te ayuda a cumplirlo, pero es una ayuda: confirma con tu abogado qué aplica a tus mensajes.',
            },
            { t: 'anim', key: 'sms-hours', caption: 'Un SMS de cobro creado el domingo queda programado para el lunes a las 7:00 a. m.' },
            { t: 'h', text: 'Qué hace «Respetar el horario»' },
            {
                t: 'steps',
                items: [
                    'Marca **Respetar el horario para mensajes comerciales y de cobranza (Ley 2300 de 2023)** en el envío o en la acción de la automatización.',
                    'Si el SMS se crea dentro del horario, sale en el acto.',
                    'Si se crea fuera, queda **Programado** para el siguiente momento permitido, en la zona horaria de la empresa y saltando los festivos de Colombia, y sale solo.',
                    'Un envío a muchos que se pasa de las 7:00 p. m. deja lo que falta para la franja siguiente.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Los avisos de servicio no esperan',
                md: 'Un recordatorio de cita, la confirmación de un pedido o un código no son cobros ni publicidad: por eso los recordatorios de la agenda salen a su hora. Marca el horario sólo en lo que sea cobro o comercial.',
            },
            { t: 'h', text: 'Los estados de un SMS' },
            {
                t: 'settings',
                title: 'Del envío a la entrega',
                rows: [
                    { name: 'Programado', what: 'Espera el horario permitido.' },
                    { name: 'En cola', what: 'Está por salir (en un envío a varios, se mandan de a uno).' },
                    { name: 'Enviado', what: 'El proveedor lo aceptó y lo pasó al operador.' },
                    { name: 'Entregado', what: 'El proveedor confirmó que llegó al teléfono.' },
                    { name: 'Fallido', what: 'No se mandó o no llegó: el motivo queda en la página **SMS** de la conexión y en la actividad.' },
                    { name: 'Cancelado', what: 'No salió porque la empresa quedó en solo lectura o el registro se borró antes.' },
                ],
            },
            {
                t: 'p',
                md: 'El estado sólo avanza: un aviso tardío de «enviado» no borra un «entregado». En la página **SMS** de cada conexión ves los enviados, entregados y fallidos de los últimos 30 días y los SMS recientes, y con **Preparar columnas** creas en una lista **Último SMS** y **Estado del último SMS** para filtrar o agrupar por ellas.',
            },
            {
                t: 'example',
                title: 'Una cartera de cobro',
                md: 'La automatización de recordatorio de pago corre todas las noches con **Respetar el horario** marcado: los SMS quedan **Programados** y salen a las 7:00 a. m. del siguiente día hábil. La vista agrupada por **Estado del último SMS** les muestra cada mañana los **Fallidos** para revisar el número.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Conectar un proveedor', article: 'sms-conectar' },
                ],
            },
        ],
    },
];
