import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ───────────────────────────── 1. Qué son ─────────────────────────────
    {
        id: 'automatizaciones-que-son',
        route: '/lists',
        related: ['automatizaciones-editor', 'automatizaciones-disparadores', 'automatizaciones-recetas'],
        blocks: [
            {
                t: 'p',
                md: 'Una **automatización** es una regla que trabaja sola: «**cuando** pasa esto, **si** se cumple aquello, **haz** esto otro». Por ejemplo: *cuando* una factura vence, *si* sigue pendiente, *envía* un recordatorio al cliente y *cambia* su estado a «Vencida». La escribes una vez y la app la cumple con cada registro, de día y de noche, sin que nadie se acuerde.',
            },
            { t: 'anim', key: 'auto-flujo', caption: 'Vence una factura, la app revisa que siga pendiente y hace tres cosas sola: correo, WhatsApp y cambio de estado.' },
            { t: 'h', text: 'Las tres piezas' },
            {
                t: 'cards',
                items: [
                    { icon: 'Zap', title: 'Cuando (el disparador)', md: 'Lo que pone a correr la automatización: se crea un registro, cambia un campo, llega una fecha, es lunes a las 7:30, alguien llena un formulario, llega un pago o un WhatsApp…', tone: 'amber' },
                    { icon: 'Filter', title: 'Si (las condiciones)', md: 'Filtros opcionales: sólo sigue si el registro cumple **todas** las condiciones. «Estado es Pendiente», «Monto mayor a $ 1.000.000».', tone: 'violet' },
                    { icon: 'Send', title: 'Entonces (las acciones)', md: 'Uno o varios pasos en orden: enviar un correo, cambiar campos, crear un registro en otra lista, esperar tres días, llamar a otra app, generar un PDF…', tone: 'blue' },
                ],
            },
            {
                t: 'p',
                md: 'Cada automatización vive **dentro de una lista** y trabaja sobre sus registros. El registro que la disparó es «el registro» de esa corrida: sus campos se pueden usar en los pasos como variables ({{cliente}}, {{monto}}), y cualquier cambio que hagan los pasos queda en su actividad, como si lo hubiera hecho una persona.',
            },
            { t: 'h', text: 'Dónde están' },
            {
                t: 'steps',
                items: [
                    'Abre la lista (por ejemplo **Facturas**).',
                    'Arriba, junto al nombre de la lista, toca **Automatizaciones**.',
                    'Verás una tarjeta por automatización con su resumen en palabras («Cuando «Vencimiento» llega (1 día después) → Envía un correo…») y su interruptor **Activa / Pausada**.',
                    'Para crear una, toca **Desde plantilla** (recetas listas) o **En blanco**.',
                ],
            },
            { t: 'demo', key: 'auto-abrir', caption: 'De la lista a sus automatizaciones y de ahí al editor.', fallback: 'auto-flujo' },
            {
                t: 'settings',
                title: 'Lo que tiene cada tarjeta de la lista de automatizaciones',
                rows: [
                    { name: 'Nombre y descripción', what: 'Lo que escribiste arriba del editor.', tip: 'Ponle un nombre que diga qué hace: «Recordatorio de pago a los 20 días», no «Automatización 3».' },
                    { name: 'Resumen del flujo', what: 'El disparador y las acciones en lenguaje claro, como chips unidos por flechas.' },
                    { name: 'Interruptor Activa / Pausada', what: 'Pausada no corre, pero se conserva tal cual. Las corridas que estaban esperando se cancelan al pausar.', tip: 'Pausa en vez de borrar cuando quieras frenarla un tiempo (temporada baja, vacaciones).' },
                    { name: 'Reloj (Historial)', what: 'Abre el historial de ejecuciones: cada corrida con su resultado.' },
                    { name: '«…» → Duplicar', what: 'Crea una copia **pausada** para que la ajustes sin tocar la original.' },
                    { name: '«…» → Guardar como plantilla', what: 'La deja entre las recetas de tu empresa para usarla en otras listas.' },
                    { name: '«…» → Eliminar', what: 'Deja de correr al instante y va a la **papelera** con su historial; puedes recuperarla durante 30 días.' },
                    { name: '«N corridas en espera»', what: 'Aparece cuando hay corridas pausadas en un paso «Esperar».' },
                    { name: '«Falló la última vez»', what: 'Aviso en rojo con el motivo cuando la última corrida no terminó bien.', tip: 'Ábrela y revisa el historial; también te llega un aviso en «Problemas».' },
                ],
            },
            { t: 'h', text: 'Activa, pausada y los límites del plan' },
            {
                t: 'p',
                md: 'Una automatización nueva nace **Activa**. Si al guardarla le falta algo (un destinatario, un campo de fecha), el editor marca qué falta en cada paso y te ofrece **Dejarla pausada** para terminarla después. Tu plan define cuántas automatizaciones **activas** puedes tener al mismo tiempo (las pausadas no cuentan): si llegas al tope, pausa otra o guárdala pausada. Lo ves en **Ajustes → Plan y uso**.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Quién puede hacerlas',
                md: 'Crear y editar automatizaciones lo hacen las personas con el permiso de administrar automatizaciones (por defecto, administradores y gerentes). Los demás ven los resultados (correos, cambios en los registros), pero no la sección.',
            },
            { t: 'h', text: 'Ideas para empezar' },
            {
                t: 'example',
                title: 'Una ferretería',
                md: 'Cuando el campo **Stock** de un producto baja de 5, le llega un correo al encargado de compras con el producto y las unidades. Y cada lunes a las 7:00 sale un resumen de lo que hay que pedir.',
            },
            {
                t: 'example',
                title: 'Una clínica odontológica',
                md: 'Un día antes de cada cita, el paciente recibe un WhatsApp con la hora y el enlace para reprogramar. Si la cita queda en «No asistió», se crea solo un registro en **Seguimientos** para llamarlo.',
            },
            {
                t: 'example',
                title: 'Una agencia de marketing',
                md: 'Cuando un proyecto pasa a **Entregado**, la app genera el acta en PDF, se la envía al cliente con un enlace a una encuesta y crea la factura en la lista **Facturas**.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Una automatización puede afectar otras listas?', a: 'Sí: puede crear registros en otra lista, y «Repetir por cada registro vinculado» recorre los registros relacionados (las facturas de un cliente). El disparador, en cambio, siempre es de la lista donde está la automatización.' },
                    { q: '¿Se disparan cuando cambio muchos registros a la vez?', a: 'Sí: si importas o editas en lote, cada registro que cumple dispara su corrida. Las ediciones en lote que hace una automatización (acción «Editar en lote») no vuelven a disparar otras, para evitar cadenas sin fin.' },
                    { q: '¿Una automatización puede disparar otra?', a: 'Sí: si una crea o cambia un registro, eso puede disparar otras automatizaciones, hasta tres niveles seguidos. Más allá se corta para que nunca quede un círculo infinito.' },
                    { q: '¿Corren si cierro el navegador?', a: 'Sí. Corren en el servidor, no en tu computador.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido', tour: 'automation-basics' },
                    { label: 'Siguiente: el editor', article: 'automatizaciones-editor' },
                ],
            },
        ],
    },

    // ───────────────────────────── 2. Editor ─────────────────────────────
    {
        id: 'automatizaciones-editor',
        route: '/lists',
        related: ['automatizaciones-que-son', 'automatizaciones-logica', 'automatizaciones-probar-historial'],
        blocks: [
            {
                t: 'p',
                md: 'El editor de automatizaciones ocupa toda la pantalla. Arriba van el **nombre** y la **descripción** (se escriben directamente sobre el título), y una barra con **Flujo / Lienzo**, el interruptor **Activa**, **Probar**, **Historial**, **Versiones**, **Duplicar** y **Guardar**. Debajo, la automatización se lee de arriba abajo: la tarjeta **Cuando** y después cada **Paso**.',
            },
            { t: 'demo', key: 'auto-crear', caption: 'Crear una automatización en blanco y abrir el menú de acciones.', fallback: 'auto-lienzo' },
            { t: 'h', text: 'Crear una paso a paso' },
            {
                t: 'steps',
                items: [
                    'En las automatizaciones de la lista toca **En blanco**.',
                    'Escribe el nombre donde dice **Nombre de la automatización** y, si quieres, una descripción.',
                    'En la tarjeta **Cuando**, elige el disparador en el desplegable. Debajo aparece una explicación de cuándo corre y sus ajustes (por ejemplo, qué campo de fecha mirar).',
                    'Si quieres filtrar, toca **Añadir filtro**: la automatización solo se dispara si el registro cumple **todas** esas condiciones.',
                    'Toca **Añadir la primera acción** y elige qué hacer. Se agrega la tarjeta **Paso 1**, abierta para configurarla.',
                    'Agrega más pasos con **Añadir acción** al final o con el **«+»** que hay entre dos tarjetas (inserta justo ahí).',
                    'Toca **Probar** para ver qué haría con un registro real, y después **Guardar**.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Mientras tengas cambios sin guardar, debajo de la barra aparece **Cambios sin guardar** y, si intentas salir, la app te avisa para que no los pierdas.',
            },
            { t: 'h', text: 'Cada paso, en su tarjeta' },
            {
                t: 'p',
                md: 'Cada tarjeta muestra en una línea lo que hace («Envía un correo a {{email}}», «Actualiza «Estado»») y se abre o se cierra con un toque. Al pasar el mouse aparecen sus botones: **Subir**, **Bajar**, **Duplicar** y **Eliminar acción**. Dentro, el primer selector es **el tipo de acción**: puedes cambiarlo sin borrar la tarjeta. Si le falta algo para poder correr, la tarjeta lo dice en rojo aunque esté cerrada.',
            },
            {
                t: 'settings',
                title: 'El menú de acciones',
                rows: [
                    { name: 'Enviar email', what: 'Un correo con asunto, texto o diseño visual, firma y PDF adjuntos.', tip: 'Ver el artículo de correos.' },
                    { name: 'Llamar webhook externo', what: 'Le manda los datos a otro sistema por internet (Zapier, Make, tu propia API).' },
                    { name: 'Actualizar un campo', what: 'Cambia uno o varios campos del registro.' },
                    { name: 'Crear un registro', what: 'Crea un registro en esta lista o en otra, con valores del registro que disparó.' },
                    { name: 'Editar en lote', what: 'Cambia muchos registros a la vez (sumar, porcentajes, poner valores…).' },
                    { name: 'Generar un PDF', what: 'Arma un documento con una plantilla (cuenta de cobro, cotización…).' },
                    { name: 'Si / sino (condicional)', what: 'Divide el flujo en dos ramas según una condición.' },
                    { name: 'Esperar', what: 'Pausa la corrida un tiempo o hasta una fecha del registro.' },
                    { name: 'Repetir por cada registro vinculado', what: 'Corre unos pasos por cada registro relacionado.' },
                    { name: 'Pedir aprobación / Esperar aprobación', what: 'Inicia un flujo de aprobación y espera la decisión.' },
                    { name: 'Crear subtareas desde una plantilla', what: 'Agrega al registro las subtareas de una plantilla de registro.' },
                    { name: 'Pedirle a un agente', what: 'Le encarga a un agente de IA que trabaje sobre el registro.' },
                    { name: 'Responder por correo al hilo del registro', what: 'Sólo en listas con buzón de soporte: contesta en el hilo del ticket.' },
                    { name: 'Apps conectadas', what: 'Debajo, las acciones de cada app que conectaste (Enviar WhatsApp, Mensaje a Slack, Crear evento en Google Calendar…). Si no ves la que buscas, toca **Conectar otra app**.' },
                ],
            },
            { t: 'h', text: 'Flujo o Lienzo: dos formas de ver lo mismo' },
            { t: 'anim', key: 'auto-lienzo', caption: 'En el Lienzo se toca el «+» de una conexión para insertar un paso, y las ramas Sí / No se ven lado a lado.' },
            {
                t: 'p',
                md: '**Flujo** muestra los pasos como una lista de tarjetas y es la forma más rápida de editar. **Lienzo** dibuja la automatización como un diagrama: las ramas de un **Si / Si no** se abren en columnas paralelas, y los pasos de **Repetir por cada registro vinculado** quedan dentro de un marco. En el Lienzo:',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'MousePointerClick', title: 'Clic en un paso', md: 'Se abre un panel a la derecha con su configuración.', tone: 'blue' },
                    { icon: 'Layers', title: '«+» sobre una conexión', md: 'Inserta un paso justo en ese lugar, también dentro de una rama. En una rama vacía aparece «Añadir».', tone: 'violet' },
                    { icon: 'Compass', title: 'Moverte', md: 'Arrastra el fondo para desplazarte; Ctrl + rueda para acercar o alejar; abajo a la derecha, **Alejar**, **Acercar** y **Ajustar a la vista**.', tone: 'mint' },
                    { icon: 'Copy', title: 'Duplicar o eliminar', md: 'Al pasar el mouse sobre un paso aparecen sus botones.', tone: 'slate' },
                ],
            },
            { t: 'demo', key: 'auto-lienzo', caption: 'La misma automatización en Flujo y en Lienzo.', fallback: 'auto-lienzo' },
            { t: 'callout', tone: 'info', md: 'La app recuerda en tu navegador si prefieres Flujo o Lienzo, así la próxima vez abre como la dejaste.' },
            { t: 'h', text: 'Guardar, activar y pausar' },
            {
                t: 'settings',
                rows: [
                    { name: 'Activa / Pausada', what: 'El interruptor de la barra. Se aplica al guardar.', tip: 'Pausada es la forma segura de guardar algo a medio armar.' },
                    { name: 'Guardar', what: 'Valida todo. Si falta algo, lo marca en el paso y te ofrece guardarla pausada.' },
                    { name: 'Ejecutar ahora', what: 'Sólo en las programadas: corre ya, sin esperar al horario. El resultado aparece en el historial en unos segundos.', tip: 'Guarda antes de ejecutar.' },
                    { name: 'Duplicar', what: 'Crea una copia pausada y la abre en el editor.' },
                    { name: '¿Cómo funciona?', what: 'Arriba a la derecha: abre la ayuda de esta pantalla.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiar el disparador de una automatización que ya existe?', a: 'Sí. Al cambiarlo se reinician sus ajustes (el campo de fecha, los filtros); revísalos antes de guardar. Queda una versión anterior por si quieres volver.' },
                    { q: '¿Cuántos pasos puede tener?', a: 'Los que necesites. Los «Si / Si no» se pueden anidar hasta cuatro niveles; si ves que la automatización crece demasiado, suele ser más claro partirla en dos.' },
                    { q: 'Cambié algo y ahora no anda, ¿cómo vuelvo atrás?', a: 'Toca **Versiones**: cada guardado queda guardado y puedes cargar uno anterior. Ver el artículo de probar e historial.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'Todos los disparadores', article: 'automatizaciones-disparadores' },
                    { label: 'Ramas y esperas', article: 'automatizaciones-logica' },
                ],
            },
        ],
    },

    // ───────────────────────────── 3. Disparadores ─────────────────────────────
    {
        id: 'automatizaciones-disparadores',
        route: '/lists',
        related: ['automatizaciones-editor', 'automatizaciones-variables', 'formularios-automatizar', 'wab-automatizaciones'],
        blocks: [
            {
                t: 'p',
                md: 'El **disparador** es la tarjeta **Cuando** del editor: decide en qué momento corre la automatización. Hay disparadores de los propios registros, de fechas y horarios, de cosas que llegan desde afuera y de otras partes de la app. Todos se pueden combinar con **Añadir filtro** para que sólo corra con los registros que cumplen ciertas condiciones.',
            },
            { t: 'anim', key: 'auto-disparadores', caption: 'Quince disparadores, agrupados por familia.' },
            { t: 'h', text: 'Cuando cambian los registros' },
            {
                t: 'settings',
                rows: [
                    { name: 'Cuando se crea un registro', what: 'Corre con cada registro nuevo de la lista, venga de donde venga: a mano, importado, desde un formulario, por la API o creado por otra automatización.', tip: 'Ideal para bienvenidas, asignar un responsable o crear las tareas de arranque.' },
                    { name: 'Cuando se actualiza un registro', what: 'Corre cada vez que el registro cambia. Con **Disparar solo si cambian estos campos** eliges qué campos importan (vacío = cualquier cambio).', tip: 'Casi siempre conviene elegir los campos: si no, correrá con cada corrección menor.' },
                    { name: 'Cuando cambia un campo', what: 'Mira un solo campo (**Campo a observar**) y, si quieres, el paso exacto: **De (valor anterior)** y **A (valor nuevo)**. Vacío = cualquier valor. En una casilla: Marcada / Desmarcada.', tip: '«Cuando Etapa pasa de Propuesta a Ganado» es el ejemplo típico.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'En los disparadores de cambios tienes la variable {{before.campo}} con el valor que había **antes** del cambio. Sirve para mensajes como «el estado pasó de {{before.estado|label}} a {{estado|label}}».',
            },
            { t: 'h', text: 'Cuando llega una fecha' },
            {
                t: 'p',
                md: '**Cuando se alcanza una fecha** mira un campo de fecha de cada registro y corre cuando esa fecha llega, se acerca o ya pasó. Es el disparador de los recordatorios y los cobros. La app revisa las fechas cada pocos minutos y considera la zona horaria de la empresa (una fecha sin hora «llega» a la medianoche de tu país).',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Campo de fecha', what: 'Qué fecha del registro mirar (Vencimiento, Fecha de la cita, Próximo contacto…).' },
                    { name: 'Cuándo disparar', what: 'Cuando llega la fecha (mismo día), 1 hora antes, 1 día antes, 3 días antes, 1 semana antes, 1 día después, 3 días después o 1 semana después.' },
                    { name: 'Personalizado…', what: 'Escribe los días: negativo = antes, positivo = después. Por ejemplo 20, 45 o 70 para una secuencia de cobro.', tip: 'Para una secuencia, haz una automatización por cada momento (a los 20, a los 45 y a los 70 días).' },
                    { name: 'Incluir las fechas que ya pasaron antes de crear esta automatización', what: 'Apagado (por defecto): sólo cuenta lo que llega desde ahora. Encendido: también corre con los registros cuya fecha ya había pasado.', tip: 'Déjalo apagado para no escribirles de golpe a todos los clientes con facturas vencidas hace meses.' },
                    { name: 'Filtros', what: 'Con **Añadir filtro**: «Estado es Pendiente» para recordar sólo lo que no está pagado.' },
                ],
            },
            { t: 'demo', key: 'auto-probar', caption: 'La prueba también te dice si el disparador de fecha coincidiría con un registro y cuándo.', fallback: 'auto-probar' },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si alguien cambia la fecha del registro, la automatización vuelve a dispararse para la fecha nueva. Si el registro ya no cumple el filtro (por ejemplo, la factura se pagó), no corre y no queda anotado: si vuelve a cumplir, se dispara.',
            },
            { t: 'h', text: 'De forma programada' },
            { t: 'anim', key: 'auto-horario', caption: 'Cada lunes a las 7:30 la automatización sube los precios un 5 % y los redondea.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Frecuencia', what: 'Cada hora, Dos veces al día, Todos los días, Una vez por semana o Una vez por mes.' },
                    { name: 'Día y hora', what: 'Según la frecuencia: el minuto, la hora, el día de la semana («los lunes») o el día del mes.' },
                    { name: 'Zona horaria', what: '**La de la empresa** (recomendado) o una en particular. Si la empresa no tiene zona, corre en hora UTC: elígela en **Ajustes → Formato regional**.' },
                    { name: 'Avanzado: horario personalizado (cron)', what: 'Para horarios especiales (minuto hora día mes día-de-semana). Si lo completas, manda sobre la frecuencia de arriba.', tip: 'Si la expresión no es válida, el editor lo dice: así la automatización no correría nunca.' },
                    { name: 'Ejecutar una vez por cada registro que cumpla…', what: 'Sin marcar: corre UNA vez, sin registro en particular (ideal para **Editar en lote** o un correo de resumen). Marcado: corre las acciones para cada registro que cumpla el filtro, hasta 1.000 por disparo.', tip: '«Cada mañana, un recordatorio a cada cliente con factura vencida».' },
                ],
            },
            { t: 'h', text: 'Desde afuera: webhook entrante' },
            { t: 'anim', key: 'auto-webhook-entrante', caption: 'Alguien llena el formulario de tu página web y el prospecto aparece solo en la lista.' },
            {
                t: 'p',
                md: '**Webhook entrante (URL pública)** le da a la automatización una dirección propia en internet. Cualquier sistema que le envíe datos a esa dirección (el formulario de tu página web, una tienda, Zapier o Make) la pone a correr. Al **guardar** se genera la **URL pública del webhook**; tócala para **Copiar** y pégala en el otro sistema.',
            },
            {
                t: 'steps',
                items: [
                    'Elige **Webhook entrante (URL pública)** como disparador y guarda.',
                    'Copia la URL y configúrala en el otro sistema para que envíe los datos con el método POST.',
                    'En **Probar el webhook**, toca **Escuchar datos de prueba** y envía una prueba desde el otro sistema: en segundos ves el **Último dato recibido**, clave por clave.',
                    'Toca la variable de cada dato para copiarla y úsala en las acciones: los datos cuyo nombre coincide con un campo de la lista se usan directo como {{campo}}; el resto queda como {{payload.nombre_del_dato}}.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'La URL es la llave: quien la tenga puede disparar la automatización. No la publiques en lugares abiertos. Si se filtró, toca **Regenerar URL**: la anterior deja de funcionar al guardar. Para crear registros desde un formulario de tu página, los **formularios** de la app son más seguros (traen protección contra robots).',
            },
            { t: 'h', text: 'Desde otras partes de la app' },
            {
                t: 'settings',
                rows: [
                    { name: 'Cuando se envía un formulario', what: 'Alguien llenó un formulario público de la lista; el registro ya está creado. Elige **Cualquier formulario de esta lista** o uno. Variable: {{formulario.nombre}}.' },
                    { name: 'Al presionar el botón', what: 'Alguien presionó un campo **Botón** (en la tabla, la ficha o el portal). El botón tiene que tener la acción «Correr una automatización». Variables: {{boton.nombre}}, {{boton.persona}}, {{boton.email}}.' },
                    { name: 'Cuando se aprueba o se rechaza', what: 'Se resolvió una solicitud de aprobación: aprobada, rechazada, devuelta o cancelada. Variables: {{aprobacion.resultado}}, {{aprobacion.motivo}}…' },
                    { name: 'Cuando se completa un checklist', what: 'Se marcó el último ítem pendiente: cualquier checklist, uno con un nombre («Documentación») o cuando el registro tiene **todos** completos. Variable: {{checklist.nombre}}.' },
                    { name: 'Cuando se agenda, reprograma o cancela una cita', what: 'Para listas con agenda de citas. Variables: {{cita.servicio}}, {{cita.inicio}}, {{cita.enlace_reprogramar}}…' },
                    { name: 'Cuando se recibe un pago', what: 'Un cliente pagó un link de cobro (Mercado Pago o Wompi) de un registro de la lista; la app lo confirma con el proveedor antes de disparar. Variables: {{pago.monto_pagado}}, {{pago.metodo}}, {{pago.fecha}}.' },
                    { name: 'Cuando llega un mensaje de WhatsApp', what: 'Un contacto le escribió a tu número de WhatsApp Business; el registro ya se encontró (o creó) por su teléfono. Variables: {{whatsapp.texto}}, {{whatsapp.nombre}}, {{whatsapp.de}}.' },
                    { name: 'Cuando llega un correo', what: 'Para listas con buzón de soporte: un ticket nuevo o la respuesta del cliente. Variables: {{correo.de}}, {{correo.asunto}}, {{correo.texto}}…' },
                    { name: 'Cuando un SLA está en riesgo o se vence', what: 'El plazo de primera respuesta o de resolución de un ticket. Una sola vez por alerta. Variables: {{sla.alerta}}, {{sla.vence}}…' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si la lista todavía no tiene lo que el disparador necesita (un formulario, un botón, un flujo de aprobación, una agenda, una conexión de WhatsApp), el editor te dice dónde crearlo.',
            },
            {
                t: 'example',
                title: 'Un gimnasio',
                md: '**Cuando cambia un campo** «Plan» **de** «Prueba gratis» **a** «Mensual» → correo de bienvenida al plan y tarea para el entrenador. **Cuando se alcanza una fecha** «Vence el plan», 3 días antes → WhatsApp para renovar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué diferencia hay entre «Cuando se actualiza un registro» y «Cuando cambia un campo»?', a: 'El primero puede mirar varios campos a la vez; el segundo mira uno solo pero permite decir «de» qué valor «a» qué valor.' },
                    { q: '¿Puedo disparar con «se borra un registro»?', a: 'No hay ese disparador. Lo borrado va a la papelera durante 30 días y se puede restaurar.' },
                    { q: 'Mi automatización programada corrió a otra hora', a: 'Revisa la **Zona horaria** del disparador y la de la empresa en **Ajustes → Formato regional**: sin zona, las horas son UTC (en Colombia, 5 horas antes).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir la zona horaria de la empresa', to: '/settings?s=formato' },
                    { label: 'Formularios y automatizaciones', article: 'formularios-automatizar' },
                    { label: 'Variables', article: 'automatizaciones-variables' },
                ],
            },
        ],
    },

    // ───────────────────────────── 4. Acciones ─────────────────────────────
    {
        id: 'automatizaciones-acciones',
        route: '/lists',
        related: ['automatizaciones-variables', 'lote-editar-en-lote', 'fichas-subtareas-y-checklists', 'aprobaciones-automatizaciones', 'ia-agentes'],
        blocks: [
            {
                t: 'p',
                md: 'Las **acciones** son lo que hace la automatización. Este artículo cubre las que trabajan con tus propios registros: cambiar campos, crear registros, editar muchos a la vez, generar documentos, crear subtareas, pedir aprobaciones y encargarle trabajo a la IA. Los correos y las conexiones con otras apps tienen su propio artículo.',
            },
            { t: 'h', text: 'Actualizar un campo' },
            {
                t: 'p',
                md: 'Cambia uno o varios campos del registro que disparó la automatización. Con **Añadir valor** sumas una fila **Campo a actualizar** → valor. El valor puede ser fijo (elegido de las opciones del campo, una fecha, un número) o una **variable**: {{monto_mensual}}, {{date.today}}, {{before.proximo_cobro|+1m}}.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Selección', what: 'Eliges la opción de la lista (o usas una variable).' },
                    { name: 'Fecha', what: 'AAAA-MM-DD o una variable. Con aritmética: {{date.today|+7d}} = dentro de una semana.' },
                    { name: 'Número y moneda', what: 'Un número o una variable: {{subtotal}}.' },
                    { name: 'Persona y equipo', what: 'Eliges a alguien o usas una variable.' },
                    { name: 'Texto', what: 'Texto con variables: «Cerrado el {{date.today|larga}}».' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'El valor se valida igual que si lo escribiera una persona: una fecha inválida o una opción que no existe no se guarda y queda anotado en el historial. Sólo se escribe lo que cambia, así no pisa lo que otra persona editó en el mismo momento.',
            },
            { t: 'h', text: 'Crear un registro (en esta lista o en otra)' },
            { t: 'anim', key: 'auto-crear-registro', caption: 'Cuando el cliente llega a su fecha de cobro, se crea su factura con los valores mapeados.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Lista destino', what: 'Dónde se crea el registro.' },
                    { name: 'Plantilla', what: 'Opcional: una plantilla de registro de esa lista, con sus subtareas y checklists. Lo que mapees abajo pisa lo de la plantilla.' },
                    { name: 'Campo del registro nuevo → valor', what: 'Una fila por campo. El valor acepta variables del registro que disparó.', tip: 'Para vincular el registro nuevo al que disparó, en el campo de relación pon {{record.id}}.' },
                    { name: 'Selecciones', what: 'Elige el valor de la lista desplegable. Si usas una variable de otra selección, usa el valor ({{estado}}), no la etiqueta.' },
                ],
            },
            {
                t: 'example',
                title: 'Una empresa de software que factura mensualidades',
                md: 'En **Clientes** hay un campo **Próximo cobro** que se corre un mes cada vez que llega (con una recurrencia). Una automatización «**Cuando cambia** Próximo cobro» crea en **Facturas** un registro con **Cliente** = {{record.id}}, **Monto** = {{monto_mensual}}, **Período** = {{before.proximo_cobro}} (la fecha que se está cobrando), **Vence** = {{date.today|+15d}} y **Estado** = Pendiente.',
            },
            { t: 'h', text: 'Editar en lote' },
            {
                t: 'p',
                md: 'Cambia muchos registros de la lista de una vez, con las mismas operaciones que la edición masiva a mano: poner o vaciar, sumar, restar, subir o bajar un porcentaje, redondear, calcular con otras columnas, agregar opciones, correr fechas… Pensada para el disparador **De forma programada** sin registro en particular.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Qué registros', what: 'Todos, o **Sólo los que cumplan…** un filtro que se evalúa en el momento en que corre.', tip: 'Sin filtro edita TODA la lista (hasta 5.000 registros) cada vez que corre.' },
                    { name: 'Qué cambiar', what: 'Una o varias operaciones, en orden; cada una parte del valor de cada registro. **Agregar otro cambio** suma una.' },
                    { name: 'Historial', what: 'Cada corrida queda en el historial de ediciones masivas de la lista, con **Deshacer**, y no vuelve a disparar automatizaciones.' },
                ],
            },
            { t: 'h', text: 'Generar un PDF' },
            {
                t: 'settings',
                rows: [
                    { name: 'Plantilla del documento', what: 'La plantilla (cuenta de cobro, cotización, recibo…). **Diseñar** la abre en el editor; **Nueva plantilla** crea una.' },
                    { name: 'Guardarlo en el registro (opcional)', what: 'En un campo **Archivo**: queda adjunto al registro. **Si ya hay archivos**: sumarlo o reemplazar.', tip: 'Guardado ocupa espacio del plan, salvo que la empresa use su propio almacenamiento.' },
                    { name: 'Sin guardar', what: 'No ocupa espacio: queda {{pdf.link}}, un enlace de 30 días que arma el PDF al abrirlo.' },
                    { name: 'Nombre del archivo (opcional)', what: 'Por defecto, el de la plantilla. Acepta variables: «Cuenta {{numero}}».' },
                ],
            },
            {
                t: 'p',
                md: 'Después de este paso tienes {{pdf.link}}, {{pdf.nombre}} y {{pdf.numero}} (si la plantilla numera) para un correo o un WhatsApp. También puedes adjuntar el PDF directamente en **Enviar email**.',
            },
            { t: 'h', text: 'Subtareas, aprobaciones, agentes y respuestas' },
            { t: 'anim', key: 'aprob-automatizacion', caption: 'Un gasto grande pide la aprobación, la espera y sigue por un camino distinto según la decisión.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Crear subtareas desde una plantilla', what: 'Agrega al registro las subtareas de una plantilla de registro, con sus responsables y fechas relativas. Opción: **Agregar también los checklists de la plantilla al registro**.', tip: '«Cuando un cliente pasa a Firmado, crear las 8 tareas del arranque del proyecto».' },
                    { name: 'Pedir aprobación', what: 'Inicia un flujo de aprobación de la lista (**Flujo que se pide**) con una **Nota para quienes aprueban** que acepta variables. Si ya hay una pendiente de ese flujo, no pide otra.' },
                    { name: 'Esperar aprobación', what: 'Pausa la corrida hasta que alguien aprueba, rechaza o devuelve, con un tope de días opcional (si se cumple, sigue con el resultado «vencida»).' },
                    { name: 'Pedirle a un agente', what: 'Le encarga a un agente de IA que trabaje sobre el registro (clasificar, resumir, completar datos), con una **Instrucción extra** opcional. Corre aparte y, según su modo, cambia el registro o deja una propuesta.' },
                    { name: 'Responder por correo al hilo del registro', what: 'Sólo en listas con buzón de soporte: contesta al cliente en el hilo del ticket.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si la lista llega al límite de registros del plan?', a: '«Crear un registro» no crea más y la corrida queda fallida con el motivo; te llega un aviso en «Problemas».' },
                    { q: '¿Puedo actualizar un registro de otra lista?', a: 'Sí, a través de **Repetir por cada registro vinculado**: dentro de la repetición, «Actualizar un campo» puede cambiar el registro vinculado de esa vuelta.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Enviar correos', article: 'automatizaciones-correos' },
                    { label: 'Ramas, esperas y repeticiones', article: 'automatizaciones-logica' },
                    { label: 'Edición en lote a mano', article: 'lote-editar-en-lote' },
                ],
            },
        ],
    },

    // ───────────────────────────── 5. Correos ─────────────────────────────
    {
        id: 'automatizaciones-correos',
        route: '/lists',
        related: ['automatizaciones-variables', 'automatizaciones-acciones', 'automatizaciones-recetas'],
        blocks: [
            {
                t: 'p',
                md: '**Enviar email** es la acción más usada: bienvenidas, recordatorios, avisos al equipo, cuentas de cobro adjuntas. Lo escribes una vez con variables y cada registro sale con sus datos: «Hola Hotel Brisas, tu factura FAC-1042 por $ 1.250.000 venció el 26 de octubre».',
            },
            { t: 'anim', key: 'auto-correo', caption: 'Destinatario y asunto con variables, PDF adjunto y el correo real que recibe el cliente.' },
            { t: 'h', text: 'Los datos del correo' },
            {
                t: 'settings',
                rows: [
                    { name: 'Para', what: 'Uno o varios correos separados por coma. Acepta variables: un campo Email ({{email}}), el correo de un campo Persona ({{responsable.email}}) o direcciones fijas.', tip: 'Máximo 25 destinatarios por correo.' },
                    { name: 'Asunto', what: 'Con variables: «Tu factura {{numero}} está por vencer».' },
                    { name: 'Formato del correo', what: '**Diseño visual** (recomendado), **Texto** o **HTML**.' },
                    { name: 'Texto de vista previa', what: 'Sólo en diseño visual: lo que se lee junto al asunto en la bandeja de entrada.' },
                    { name: 'Avanzado: remitente, Cc, Cco', what: '**Nombre remitente**, **Cc** y **Cco** (separados por coma).' },
                    { name: 'Agregar la firma al final del correo', what: 'Agrega la firma de quien elijas en **Firma de**. Cada persona edita la suya en **Ajustes → Firma de email**.' },
                    { name: 'Adjuntar PDF', what: 'Hasta 5 plantillas de documento (cuenta de cobro, recibo) armadas con los datos del registro.' },
                    { name: 'Enviarme una prueba', what: 'Te llega a **tu correo**, con los datos del último registro de la lista. Ábrela en Gmail y en Outlook para ver cómo queda.' },
                ],
            },
            { t: 'h', text: 'Diseño visual, texto o HTML' },
            {
                t: 'cards',
                items: [
                    { icon: 'Palette', title: 'Diseño visual', md: 'Toca **Diseñar el correo**: armas el correo con bloques (título, texto con formato, botón, imagen, datos del registro, columnas, firma) y ves el resultado real, en computador y celular. Se ve bien en Gmail y Outlook sin que hagas nada.', tone: 'violet' },
                    { icon: 'Type', title: 'Texto', md: 'Un mensaje simple, como un correo escrito a mano. La firma va sin formato.', tone: 'blue' },
                    { icon: 'Code', title: 'HTML', md: 'Para quien trae su propio diseño. Usa tablas y estilos en línea para que Outlook y Gmail lo muestren bien.', tone: 'slate' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'En el diseño visual, el bloque **Datos del registro** muestra los campos que elijas ya con su formato (montos con puntos de miles, fechas en tu formato, etiquetas de las opciones). Y **Ver con datos de un registro** te muestra el correo como le llegaría a un cliente real.',
            },
            { t: 'anim', key: 'auto-variables', caption: 'Asunto y mensaje con variables: cada cliente recibe su nombre, su monto y su fecha ya formateados.' },
            { t: 'h', text: 'Desde qué correo sale y cuántos puedes enviar' },
            {
                t: 'p',
                md: 'Los correos salen por la forma de envío que la empresa eligió en **Ajustes → Correo**: el correo de la plataforma, una cuenta de **Google o Microsoft** de la empresa o su propio servidor de correo. Con el de la plataforma, tu plan tiene una **cuota de correos al mes** (cuenta cada destinatario) y la dirección remitente es la de la plataforma, con el nombre de tu empresa y las respuestas dirigidas a ti. Con cuenta o servidor propio no hay cuota de la app y sale desde tu dirección.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Una automatización no es para campañas masivas de marketing: los proveedores de correo frenan los envíos de muchos destinatarios de golpe. Úsala para avisos uno a uno.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'Cuando un inmueble pasa a **Arrendado**, sale un correo con diseño al inquilino: título «Bienvenido a tu nuevo hogar», los datos del contrato (dirección, canon, fecha de pago), un botón al portal y el contrato en PDF adjunto. Con copia oculta al asesor.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'El correo de prueba no me llega', a: 'Revisa la carpeta de spam y que la empresa tenga una forma de envío configurada en **Ajustes → Correo**. Si un correo falla en una corrida real, el historial dice por qué y te llega un aviso en «Problemas».' },
                    { q: '¿Puedo mandarle al responsable del registro?', a: 'Sí: en **Para** usa {{responsable.email}} (el nombre del campo Persona seguido de .email).' },
                    { q: '¿Y si el registro no tiene correo?', a: 'El paso falla con el motivo («sin destinatario»), queda en el historial y se avisa en «Problemas». Para evitarlo, agrega un filtro «Email no está vacío» en el disparador o una condición en el paso.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir desde qué correo salen', to: '/settings?s=correo' },
                    { label: 'Editar mi firma', to: '/settings?s=firma' },
                    { label: 'Todas las variables', article: 'automatizaciones-variables' },
                ],
            },
        ],
    },

    // ───────────────────────────── 6. Webhooks y apps ─────────────────────────────
    {
        id: 'automatizaciones-webhooks-y-apps',
        route: '/settings?s=conectores',
        related: ['integraciones-en-automatizaciones', 'integraciones-webhooks', 'wab-automatizaciones', 'portal-pagos'],
        blocks: [
            {
                t: 'p',
                md: 'Las automatizaciones pueden hablar con otras apps de dos maneras: con las **acciones de las apps conectadas** (WhatsApp, Slack, Gmail, Google Calendar…), que se eligen por su nombre y te piden los datos con nombres claros, o con **Llamar webhook externo**, que le envía los datos a cualquier sistema que tenga una dirección en internet.',
            },
            { t: 'anim', key: 'automation-whatsapp', caption: 'Vence una factura, sigue pendiente y sale un WhatsApp al cliente con el enlace de pago.' },
            { t: 'h', text: 'Acciones de apps conectadas' },
            {
                t: 'p',
                md: 'Primero conecta la app en **Ajustes → Integraciones**. Después, en el menú de acciones del editor, aparece la sección **Apps conectadas** con el logo de cada una. Cada acción pide sus datos con nombres claros y acepta variables; muchas traen **Probar ahora**, que la ejecuta de verdad con el último registro de la lista.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'WhatsApp (WAS)', what: '**Enviar mensaje de WhatsApp** y **Enviar archivo por WhatsApp** (imagen, video, audio o PDF por enlace).' },
                    { name: 'WhatsApp Business (oficial)', what: '**Enviar plantilla de WhatsApp** (aprobada en Meta, con sus variables y encabezado) y **Enviar mensaje de texto de WhatsApp** (sólo dentro de las 24 h desde que el contacto escribió).', tip: 'Para avisos que inicias tú, usa una plantilla.' },
                    { name: 'Telegram', what: '**Enviar mensaje de Telegram** a un chat, grupo o canal.' },
                    { name: 'Slack', what: '**Enviar mensaje a Slack** en un canal.' },
                    { name: 'Gmail y Outlook', what: '**Enviar correo con Gmail** / **con Outlook** desde la cuenta conectada.' },
                    { name: 'Google Calendar y Outlook', what: '**Crear evento** con título, fecha, hora, duración, zona horaria e invitados.' },
                    { name: 'Google Sheets', what: '**Agregar fila en Google Sheets**: un valor por renglón, en la pestaña que elijas.' },
                    { name: 'WooCommerce', what: '**Actualizar producto**, **Cambiar el estado de un pedido**, **Agregar una nota al pedido** y **Crear un cupón**.' },
                    { name: 'Mercado Pago y Wompi', what: '**Crear link de pago**: deja {{pago.link}} y {{pago.monto}} para el mensaje siguiente. Su prueba no crea un cobro real.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si una conexión se borra o pierde la autorización, la acción no se ejecuta a ciegas: la tarjeta lo avisa en el editor y la corrida falla con el motivo, con aviso en «Problemas».',
            },
            { t: 'h', text: 'Llamar webhook externo' },
            { t: 'anim', key: 'auto-webhook', caption: 'Se arma la petición, se prueba, la otra app responde y el paso siguiente guarda su respuesta.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Conexión', what: 'Opcional: una API personalizada de **Ajustes → Integraciones**. La conexión pone la credencial y el secreto de firma; la URL puede ser relativa a la suya.', tip: 'Mejor que escribir claves en la acción: quedan cifradas y se cambian en un solo lugar.' },
                    { name: 'Método HTTP', what: 'POST, GET, PUT, PATCH o DELETE.' },
                    { name: 'URL', what: 'La dirección del otro sistema. Acepta variables.' },
                    { name: 'Tipo de contenido', what: 'application/json, Datos de formulario codificados (x-www-form-urlencoded), Form-data (multipart, sólo campos de texto), Texto plano, XML o HTML.' },
                    { name: 'Cuerpo — datos que pide la API', what: 'Una fila por dato (nombre → valor con variables). **Escribir el cuerpo a mano** para mandarlo tal cual.' },
                    { name: 'Cabeceras (headers)', what: 'Por ejemplo «Authorization: Bearer tu-token».' },
                    { name: 'Parámetros de la URL (query)', what: 'Se agregan a la dirección.' },
                    { name: 'Secreto para firmar (opcional)', what: 'Se envía la cabecera «x-imagina-signature» con una firma del cuerpo: el destino puede comprobar que el pedido salió de aquí.' },
                    { name: 'Probar ahora', what: 'Manda la petición de verdad usando el último registro de la lista y te muestra lo que **Se envió** y lo que **Respondió**.' },
                    { name: 'Usar la respuesta en los pasos siguientes', what: 'Los pasos de abajo leen {{webhook.status}} y {{webhook.body.campo}}. Si hay varios webhooks, ponle un **Nombre de la respuesta** y usa {{respuestas.nombre.body.campo}}.', tip: 'Se guardan hasta 64 KB de la respuesta, también si en el medio hay una espera.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si el otro sistema responde con un error (por ejemplo 500), el paso queda como fallido en el historial con su respuesta. Por seguridad, la app no llama a direcciones de redes internas.',
            },
            {
                t: 'example',
                title: 'Una tienda que usa un sistema de facturación electrónica',
                md: 'Cuando un pedido pasa a **Pagado**, **Llamar webhook externo** envía cliente, NIT y valor al sistema de facturación. La respuesta trae el número de la factura electrónica: el paso siguiente lo guarda en el campo **Factura DIAN** con {{webhook.body.numero}} y otro le manda el PDF al cliente.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo usar Zapier o Make?', a: 'Sí: en Zapier o Make crea un «webhook» que reciba datos y pega su dirección en **Llamar webhook externo**. Para el camino contrario (que ellos disparen una automatización), usa el disparador **Webhook entrante**.' },
                    { q: '¿Dónde conecto WhatsApp?', a: 'En **Ajustes → Integraciones**. El artículo de WhatsApp Business explica cuál conviene.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Integraciones en automatizaciones', article: 'integraciones-en-automatizaciones' },
                    { label: 'WhatsApp en automatizaciones', article: 'wab-automatizaciones' },
                ],
            },
        ],
    },

    // ───────────────────────────── 7. Lógica ─────────────────────────────
    {
        id: 'automatizaciones-logica',
        route: '/lists',
        related: ['automatizaciones-editor', 'automatizaciones-recetas', 'aprobaciones-automatizaciones'],
        blocks: [
            {
                t: 'p',
                md: 'Con cuatro piezas una automatización deja de ser una lista fija de pasos y empieza a decidir: hacer algo distinto según el caso, saltarse un paso, esperar unos días antes de seguir o repetir unos pasos por cada factura de un cliente.',
            },
            { t: 'h', text: 'Si / sino (condicional)' },
            {
                t: 'p',
                md: 'Divide el flujo en dos ramas. En **Si** pones las condiciones (deben cumplirse **todas**); en **Entonces** los pasos que corren si se cumplen y en **Si no** los que corren si no. Cada rama puede tener los pasos que quieras, incluso otro «Si / sino» adentro (hasta cuatro niveles). Al terminar la rama, la automatización sigue con el paso de abajo.',
            },
            {
                t: 'p',
                md: 'Las condiciones usan los mismos operadores que los filtros de las vistas: es, no es, contiene, mayor que, menor que, está vacío, hoy, esta semana… En el Lienzo, las ramas Sí y No se ven lado a lado y se editan ahí mismo.',
            },
            { t: 'h', text: 'Condición de ejecución de un paso' },
            {
                t: 'p',
                md: 'Cada paso tiene, al final de su tarjeta, una **Condición de ejecución (opcional)**: si el registro no la cumple, **ese paso** se salta y la automatización sigue con el siguiente. En la tarjeta cerrada se ve como «N cond.». Es la forma rápida de «hacer esto sólo en ciertos casos» sin abrir una rama.',
            },
            {
                t: 'example',
                title: 'Una empresa de servicios con dos modalidades de cobro',
                md: 'Una sola automatización de facturación con dos pasos **Crear un registro**: el primero con la condición «Modalidad es Anticipado» (período del mes que empieza) y el segundo con «Modalidad es Vencido» (período del mes que terminó). A cada cliente le corre sólo el que corresponde.',
            },
            { t: 'h', text: 'Esperar' },
            { t: 'anim', key: 'auto-espera', caption: 'Sale el recordatorio, la corrida espera tres días, vuelve a leer la factura y, como sigue pendiente, la marca vencida.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Un tiempo', what: '**Cuánto esperar** en minutos, horas o días (hasta un año).' },
                    { name: 'Hasta una fecha del registro', what: 'Un **Campo de fecha**, con un desplazamiento opcional («1 día antes de») y **A una hora fija de ese día** (en la zona de la empresa).', tip: 'Si la fecha cambia mientras espera, la espera se mueve sola. Si el campo está vacío, la automatización termina ahí.' },
                    { name: 'Continuar sólo si… (opcional)', what: 'Al terminar la espera se vuelve a leer el registro: si ya no cumple estas condiciones (por ejemplo, la factura ya se pagó), la automatización termina ahí.', tip: 'Casi siempre quieres esto en un recordatorio: no le escribas a quien ya pagó.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Mientras espera, la corrida aparece **En espera** en el historial (con hasta cuándo) y se puede **Cancelar espera**. Si se borra el registro o se pausa la automatización, las esperas se cancelan y no se retoman al reactivarla.',
            },
            { t: 'h', text: 'Repetir por cada registro vinculado' },
            { t: 'anim', key: 'auto-repetir', caption: 'El correo de cobro sale una vez por cada factura pendiente del cliente; la pagada se salta.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Por cada registro vinculado de', what: 'La relación a recorrer, en cualquier sentido: un campo de relación de esta lista o los registros de otra lista que apuntan aquí.' },
                    { name: 'Sólo los de «…» que cumplan…', what: 'Un filtro sobre los vinculados (por ejemplo, Estado es Pendiente).' },
                    { name: 'Por cada uno', what: 'Los pasos que se repiten. Usa {{item.campo}} para los datos del vinculado de esa vuelta y {{campo}} para los del registro que disparó.' },
                    { name: '¿Qué registro cambia?', what: 'Dentro de la repetición, **Actualizar un campo** puede cambiar el registro que disparó o **el vinculado de esta vuelta**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Procesa hasta 200 vinculados por corrida (si hay más, queda anotado en el historial). Dentro de una repetición no se puede esperar ni repetir otra vez: pon la espera antes o después.',
            },
            {
                t: 'example',
                title: 'Una distribuidora',
                md: 'Cada lunes, para cada cliente con saldo, **Repetir por cada registro vinculado** de **Facturas** que cumplan «Estado es Vencida» → agrega una línea al **Estado de cuenta** y marca la factura como «Notificada». Al final, un solo correo al cliente con el resumen.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Es mejor un filtro en el disparador o un «Si / sino»?', a: 'Si en los otros casos no hay que hacer nada, el filtro del disparador es más simple. Si hay algo distinto que hacer en cada caso, usa «Si / sino».' },
                    { q: '¿Cuántas corridas pueden estar esperando a la vez?', a: 'Todas las que hagan falta: cada registro tiene su propia corrida y su propia espera.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Recetas con esperas', article: 'automatizaciones-recetas' },
                    { label: 'Esperar una aprobación', article: 'aprobaciones-automatizaciones' },
                ],
            },
        ],
    },

    // ───────────────────────────── 8. Variables ─────────────────────────────
    {
        id: 'automatizaciones-variables',
        route: '/lists',
        related: ['automatizaciones-correos', 'automatizaciones-acciones', 'automatizaciones-disparadores'],
        blocks: [
            {
                t: 'p',
                md: 'Las **variables** son los campos entre llaves dobles: {{cliente}}, {{monto}}. Las escribes una vez en un asunto, un mensaje o un valor, y en cada corrida se reemplazan por los datos de ese registro. No hace falta saberlas de memoria: debajo de cada cuadro que las acepta hay chips con los **Campos** de la lista y un botón **Más variables** con todo lo demás, con buscador.',
            },
            { t: 'anim', key: 'auto-variables', caption: 'El mensaje se escribe una vez y cada envío sale con sus datos ya formateados.' },
            { t: 'h', text: 'Las básicas' },
            {
                t: 'settings',
                rows: [
                    { name: '{{campo}}', what: 'El valor del campo del registro (el nombre interno del campo, sin espacios ni tildes; los chips lo escriben por ti).' },
                    { name: '{{campo|label}}', what: 'En selecciones: la **etiqueta** («Pendiente de pago») en vez del valor interno («pendiente»). En casillas: Sí / No.', tip: 'Usa la etiqueta en mensajes para personas; el valor en webhooks y al copiar a otra selección.' },
                    { name: '{{before.campo}}', what: 'El valor que tenía el campo **antes** del cambio (disparadores de cambios).' },
                    { name: '{{record.id}}', what: 'El número del registro. En un campo de relación vincula al registro que disparó.' },
                    { name: '{{date.today}} / {{date.now}}', what: 'La fecha de hoy y la fecha y hora del disparo, en la zona de la empresa.' },
                    { name: '{{responsable.email}} / {{responsable.nombre}}', what: 'El correo y el nombre de la persona de un campo Persona (cambia «responsable» por el nombre de tu campo).' },
                    { name: '{{equipo.nombre}}', what: 'El nombre de un campo Equipo.' },
                ],
            },
            { t: 'h', text: 'Fechas con suma y resta' },
            {
                t: 'p',
                md: 'A una fecha le puedes sumar o restar días («d»), meses («m») o años («y»), encadenando: {{vencimiento|+15d}}, {{proximo_cobro|+1m|-1d}}. Los meses respetan el fin de mes (31 de enero + 1 mes = 28 de febrero). Con {{date.today|+7d}} tienes «dentro de una semana».',
            },
            {
                t: 'example',
                title: 'Período de una mensualidad',
                md: 'Si el cobro rodó del 16/11 al 16/12, {{before.proximo_cobro}} es el 16/11 (el que se cobra) y {{before.proximo_cobro|+1m|-1d}} es el 15/12: «Período del 16/11 al 15/12».',
            },
            { t: 'anim', key: 'auto-crear-registro', caption: 'Las variables también llenan los valores de un registro nuevo: cliente, monto y período de la factura.' },
            {
                t: 'p',
                md: 'Las variables no son sólo para mensajes. En **Actualizar un campo** y **Crear un registro**, cada valor puede ser una variable o una mezcla de texto y variables: «Factura de {{cliente|label}}», un monto {{monto_mensual}}, una fecha {{date.today|+30d}}. La app convierte el resultado al tipo del campo destino (un número, una fecha, una opción) y, si no encaja, salta ese valor y lo dice en el historial.',
            },
            { t: 'h', text: 'Formatos para que se lean bien' },
            {
                t: 'settings',
                rows: [
                    { name: '|moneda', what: 'Monto con el formato de la empresa: COP 1.250.000.' },
                    { name: '|numero', what: 'Número con separadores: 1.250.000.' },
                    { name: '|fecha / |fechahora', what: 'Fecha (21/10/2026) o fecha y hora en la zona de la empresa.' },
                    { name: '|larga', what: 'Fecha en palabras: 8 de octubre de 2026.' },
                    { name: '|letras', what: 'Un número en palabras: un millón quinientos mil.' },
                    { name: '|pesos', what: 'Un monto en palabras con «pesos»: un millón quinientos mil pesos.' },
                    { name: '|mayusculas', what: 'Todo en mayúsculas. Se encadena: {{monto|pesos|mayusculas}}.' },
                ],
            },
            { t: 'h', text: 'Variables de cada situación' },
            {
                t: 'cards',
                items: [
                    { icon: 'FileText', title: 'Después de «Generar un PDF»', md: '{{pdf.link}} (vale 30 días), {{pdf.nombre}}, {{pdf.numero}}.', tone: 'rose' },
                    { icon: 'Webhook', title: 'Después de un webhook', md: '{{webhook.status}}, {{webhook.body.dato}}, {{respuestas.nombre.body.dato}}.', tone: 'mint' },
                    { icon: 'Repeat', title: 'Dentro de una repetición', md: '{{item.campo}}, {{item.record.id}}.', tone: 'violet' },
                    { icon: 'Globe', title: 'Webhook entrante', md: '{{payload.dato}} (también datos anidados: {{payload.contacto.email}}).', tone: 'blue' },
                    { icon: 'CreditCard', title: 'Pagos', md: '{{pago.link}}, {{pago.monto}}, {{pago.monto_pagado}}, {{pago.metodo}}, {{pago.fecha}}.', tone: 'amber' },
                    { icon: 'MessageCircle', title: 'WhatsApp, correo y SLA', md: '{{whatsapp.texto}}, {{correo.asunto}}, {{sla.vence}}…', tone: 'mint' },
                    { icon: 'CalendarCheck', title: 'Citas', md: '{{cita.servicio}}, {{cita.inicio}}, {{cita.enlace_reprogramar}}, {{cita.enlace_cancelar}}.', tone: 'blue' },
                    { icon: 'ClipboardCheck', title: 'Aprobaciones, botones, formularios y checklists', md: '{{aprobacion.resultado}}, {{boton.persona}}, {{formulario.nombre}}, {{checklist.nombre}}.', tone: 'slate' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Una variable que no tiene valor (un campo vacío) se reemplaza por nada. Revisa con **Probar** cómo queda el mensaje con un registro real antes de activar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué mi mensaje dice «pendiente» y no «Pendiente de pago»?', a: 'Usaste el valor interno de la selección. Cambia {{estado}} por {{estado|label}}.' },
                    { q: '¿Las variables funcionan en el asunto, en la URL y en los valores?', a: 'Sí: en todo cuadro que muestre los chips de variables.' },
                    { q: '¿Puedo usar un campo de otra lista vinculada?', a: 'Dentro de **Repetir por cada registro vinculado**, con {{item.campo}}. Fuera de una repetición, trae el dato a esta lista con un campo de búsqueda (lookup) o de resumen (rollup) y revisa con **Probar** que llegue con valor.' },
                    { q: 'Escribí la variable a mano y sale vacía.', a: 'Seguramente el nombre interno no es el que crees (no lleva espacios ni tildes). Usa los chips de **Campos** o el buscador de **Más variables**: escriben el nombre exacto.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Enviar correos', article: 'automatizaciones-correos' },
                    { label: 'Probar con un registro real', article: 'automatizaciones-probar-historial' },
                ],
            },
        ],
    },

    // ───────────────────────────── 9. Probar e historial ─────────────────────────────
    {
        id: 'automatizaciones-probar-historial',
        route: '/settings?s=problemas',
        related: ['automatizaciones-editor', 'automatizaciones-variables', 'mi-dia-avisos'],
        blocks: [
            {
                t: 'p',
                md: 'Antes de activar una automatización conviene **probarla**, y después de activarla, mirar de vez en cuando su **historial**. Si algo falla, la app te avisa en **Problemas** y te lleva a arreglarlo; y si un cambio salió mal, las **versiones** te dejan volver atrás.',
            },
            { t: 'anim', key: 'auto-probar', caption: 'La prueba muestra lo que haría cada paso con un registro real, sin enviar ni cambiar nada.' },
            { t: 'h', text: 'Probar paso a paso' },
            {
                t: 'steps',
                items: [
                    'En el editor toca **Probar** (no hace falta guardar: prueba lo que estás editando).',
                    'Deja **El último registro de la lista** o toca **Elegir otro** y búscalo.',
                    'Toca **Probar**.',
                    'Lee el resultado: si **El disparador coincidiría** (y qué regla no se cumple, si no), y por cada paso lo que haría: el correo armado con su vista previa, hasta cuándo esperaría, qué campos cambiaría (antes → después), qué rama tomaría, cuántos registros editaría el lote.',
                ],
            },
            { t: 'demo', key: 'auto-probar', caption: 'Probar una automatización con una factura pendiente.', fallback: 'auto-probar' },
            {
                t: 'callout',
                tone: 'tip',
                md: 'La prueba no envía, no escribe ni llama a nada. Los webhooks y acciones de apps traen **Ejecutar de verdad**: márcalo si quieres ver qué responde el otro sistema (los pasos siguientes usan esa respuesta). Los secretos se muestran tapados.',
            },
            { t: 'h', text: 'El historial de ejecuciones' },
            { t: 'anim', key: 'auto-historial', caption: 'Cada corrida queda con su resultado; una falla abre un problema y avisa en la campana.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Éxito', what: 'Todos los pasos terminaron bien. Ábrela para ver el detalle de cada paso.' },
                    { name: 'Fallida', what: 'Algún paso no pudo hacerse; dice cuál y por qué (sin destinatario, valor inválido, la otra app respondió con error…).' },
                    { name: 'En espera', what: 'Está en un paso «Esperar» o «Esperar aprobación». Muestra hasta cuándo y trae **Cancelar espera**.' },
                    { name: 'Ejecutando / Pendiente', what: 'Está corriendo o en cola.' },
                    { name: 'Cancelada', what: 'Se canceló la espera, se borró el registro o se pausó la automatización.' },
                ],
            },
            {
                t: 'p',
                md: 'El historial se abre con **Historial** en el editor o con el reloj de cada tarjeta. Trae **Refrescar** y **Cargar más**. En una repetición por vinculados muestra el estado de cada vinculado.',
            },
            { t: 'h', text: 'Problemas: cuando algo falla' },
            {
                t: 'p',
                md: 'Cuando una automatización falla, la app abre un **problema**: aparece la pastilla roja **N problemas** arriba, llega un aviso a la campana (y por correo, si lo tienes activado) a los administradores y a quien la creó, y la tarjeta muestra **Falló la última vez**. En **Ajustes → Problemas** ves qué falló, cuántas veces y desde cuándo, con **Ir a arreglarlo** y **Ya lo arreglé**. Cuando vuelve a funcionar, el problema se cierra solo.',
            },
            { t: 'h', text: 'Versiones, duplicar y plantillas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Versiones', what: 'Cada guardado deja una versión (se conservan las últimas 50) con quién y cuándo y qué cambió en palabras. **Ver** la muestra en sólo lectura; **Restaurar** la carga en el editor: revísala y guarda para aplicarla.', tip: 'Los secretos (claves, contraseñas) no se guardan en las versiones: al restaurar se conservan los actuales.' },
                    { name: 'Duplicar', what: 'Crea una copia **pausada** y la abre. Ideal para hacer una variante para otra lista o para probar un cambio grande.' },
                    { name: 'Guardar como plantilla', what: 'En el «…» de la tarjeta: la deja entre las recetas de tu empresa, con nombre, descripción y categoría.' },
                    { name: 'Ejecutar ahora', what: 'En las programadas: corre ya, sin esperar al horario.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: 'La prueba dice que el disparador NO coincidiría', a: 'Lee la regla marcada con una ✕ (por ejemplo «Estado = pendiente · tiene: pagada») o la fecha en la que dispararía. Prueba con otro registro que sí cumpla.' },
                    { q: '¿Cuánto tiempo se guarda el historial?', a: 'Se conserva junto a la automatización; si la borras, va con ella a la papelera.' },
                    { q: '¿La prueba manda los correos o llama a los webhooks?', a: 'No. Muestra el correo armado y la petición con las claves tapadas. Sólo los webhooks y las acciones de apps que marques **Ejecutar de verdad** salen en la prueba, por si necesitas ver la respuesta real.' },
                    { q: 'Arreglé la automatización. ¿Tengo que cerrar el problema?', a: 'No hace falta: el problema se cierra solo cuando vuelve a funcionar. Si ya no aplica, ciérralo con **Ya lo arreglé**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver los problemas abiertos', to: '/settings?s=problemas' },
                    { label: 'Avisos y correos', article: 'mi-dia-avisos' },
                ],
            },
        ],
    },

    // ───────────────────────────── 10. Recetas ─────────────────────────────
    {
        id: 'automatizaciones-recetas',
        route: '/lists',
        related: ['automatizaciones-logica', 'automatizaciones-webhooks-y-apps', 'automatizaciones-acciones'],
        blocks: [
            {
                t: 'p',
                md: 'La forma más rápida de empezar es una **plantilla**: en las automatizaciones de la lista toca **Desde plantilla**, elige una receta, indica qué campo de tu lista cumple cada rol (la app sugiere los que coinciden por nombre y tipo) y toca **Abrir en el editor**. La receta llega armada; revisa los textos y guarda.',
            },
            { t: 'demo', key: 'auto-plantilla', caption: 'Elegir una receta, asignar los campos y abrirla en el editor.', fallback: 'auto-flujo' },
            {
                t: 'callout',
                tone: 'tip',
                md: '¿Quieres algo todavía más directo? En **Aprende → Ideas para tu negocio** hay casi 40 casos de uso (recordatorios de pago, avisos por WhatsApp, agendas, tableros) que se **activan con un clic**: la app elige la lista y los campos, te pregunta lo justo y la automatización queda funcionando, sin pasar por el editor.',
            },
            { t: 'actions', items: [{ label: 'Ver las ideas para tu negocio', to: '/ideas' }] },
            {
                t: 'settings',
                title: 'Las recetas incluidas',
                rows: [
                    { name: 'Correo de bienvenida al crear', what: 'Correo al contacto cuando se crea el registro.' },
                    { name: 'Avisar al equipo cuando se crea un registro', what: 'Correo interno con el título del registro.' },
                    { name: 'Avisar por correo cuando cambia el estado', what: 'Con el valor nuevo y el anterior.' },
                    { name: 'Encuesta de satisfacción al cerrar', what: 'Cuando el estado pasa al valor de cierre, le pide su opinión al contacto.' },
                    { name: 'Recordatorio 3 días antes de la fecha', what: 'Correo de aviso antes de una fecha límite.' },
                    { name: 'Recordatorio de pago a los 20 días', what: 'Si sigue pendiente 20 días después de la emisión.' },
                    { name: 'Escalar la prioridad al vencer', what: 'Sube la prioridad si la fecha llega y sigue abierto.' },
                    { name: 'Fijar el próximo contacto a 7 días', what: 'Al crear, deja la fecha de seguimiento una semana adelante.' },
                    { name: 'Al cerrar, avance al 100 %', what: 'Completa el avance cuando el estado pasa a cierre.' },
                    { name: 'Enviar a un webhook cuando cambia el estado', what: 'Para Zapier, Make o tu propia API.' },
                    { name: 'WhatsApp de confirmación al crear', what: 'Llama a tu proveedor de WhatsApp o SMS con el teléfono del contacto.' },
                    { name: 'Aviso de stock bajo o agotado', what: 'Para tiendas sincronizadas: correo para reponer.' },
                    { name: 'Mis plantillas', what: 'Las que tu empresa guardó con **Guardar como plantilla**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Algunas recetas traen a propósito un valor vacío (el destinatario, el estado de cierre) para que lo completes: el editor lo marca antes de guardar.',
            },
            { t: 'h', text: 'Receta: cobro por WhatsApp al vencer una factura' },
            { t: 'anim', key: 'automation-whatsapp', caption: 'El día del vencimiento, si sigue pendiente, sale un WhatsApp con el enlace de pago.' },
            {
                t: 'steps',
                items: [
                    'Lista **Facturas**. Disparador **Cuando se alcanza una fecha** → **Vencimiento**, **Cuando llega la fecha (mismo día)**, con el filtro **Estado es Pendiente**.',
                    'Paso 1: **Crear link de pago** (Mercado Pago o Wompi) con el concepto «Factura {{numero}}» y el monto {{monto}}.',
                    'Paso 2: **Enviar plantilla de WhatsApp** al teléfono del cliente con las variables nombre, número, monto ({{monto|moneda}}) y {{pago.link}}.',
                    'Paso 3: **Esperar** 3 días con **Continuar sólo si…** «Estado es Pendiente».',
                    'Paso 4: **Actualizar un campo** → Estado = Vencida, y **Enviar email** a cartera.',
                    'En otra automatización, **Cuando se recibe un pago** → Estado = Pagada y un WhatsApp de agradecimiento.',
                ],
            },
            { t: 'h', text: 'Receta: aviso al equipo de un cliente importante' },
            {
                t: 'p',
                md: 'Lista **Oportunidades**, disparador **Cuando se crea un registro** con el filtro «Monto mayor a 10.000.000». Paso: **Enviar mensaje a Slack** al canal #ventas («Nueva oportunidad de {{cliente}} por {{monto|moneda}}, la lleva {{responsable.nombre}}») y **Actualizar un campo** → Prioridad = Alta.',
            },
            { t: 'h', text: 'Receta: encuesta al cerrar un ticket' },
            {
                t: 'p',
                md: 'Lista **Tickets**, **Cuando cambia un campo** Estado **a** «Resuelto». Paso 1: **Esperar** 2 horas. Paso 2: **Enviar email** al cliente con diseño visual y un botón a un formulario de la app que guarda la calificación. Paso 3 con condición «Prioridad es Alta»: **Pedirle a un agente** que resuma el ticket en una nota interna.',
            },
            { t: 'h', text: 'Receta: recordatorio de cita' },
            {
                t: 'p',
                md: 'Lista **Citas**, **Cuando se alcanza una fecha** → Fecha de la cita, **1 día antes**, filtro «Estado es Programada». Paso: WhatsApp o correo con «Te esperamos mañana a las {{fecha|fechahora}}». Si la cita viene de la agenda en línea, usa el disparador de citas y {{cita.enlace_reprogramar}}.',
            },
            { t: 'h', text: 'Receta: alerta de stock bajo' },
            {
                t: 'p',
                md: 'Lista **Productos**, **Cuando se actualiza un registro** con **Disparar solo si cambian estos campos** = Stock y el filtro «Stock menor o igual que 5». Paso: **Enviar email** a compras con {{nombre}} y {{stock}}. Cada lunes, otra automatización **De forma programada** manda el resumen de todo lo que está bajo.',
            },
            { t: 'h', text: 'Receta: facturación recurrente' },
            {
                t: 'p',
                md: 'En **Clientes**, el campo **Próximo cobro** con una recurrencia mensual. Una automatización **Cuando cambia un campo** (Próximo cobro) hace **Crear un registro** en Facturas (Cliente = {{record.id}}, Monto = {{monto_mensual}}, Período = {{before.proximo_cobro}}, Estado = Pendiente). Después, en Facturas, otra automatización **Cuando se crea un registro** → **Generar un PDF** con la cuenta de cobro y **Enviar email** con el PDF adjunto.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo compartir una receta con otra empresa?', a: 'Las plantillas guardadas son de tu empresa. En otra empresa tendrías que armarla de nuevo (o pedirle al asistente de IA que la cree).' },
                    { q: '¿Puedo pedirle al asistente que me arme una automatización?', a: 'Sí: el asistente ✨ propone automatizaciones completas a partir de lo que le pidas, y tú decides si se aplican.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'El asistente de IA', article: 'ia-asistente' },
                    { label: 'Ramas y esperas', article: 'automatizaciones-logica' },
                ],
            },
        ],
    },
];
