import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-que-son',
        route: '/lists',
        related: ['documentos-pdf-galeria', 'documentos-pdf-generar', 'documentos-pdf-automatizar'],
        blocks: [
            {
                t: 'p',
                md: 'Un **documento PDF** es una plantilla que convierte cualquier registro de una lista en un archivo listo para mandar: una **cuenta de cobro** con el monto en letras y tus datos bancarios, una **cotización** con sus ítems, IVA y validez, una **factura**, un recibo, una orden de servicio o un certificado. La diseñas una vez; después cada registro tiene su PDF con sus propios datos, en un clic.',
            },
            { t: 'anim', key: 'pdf-hero', caption: 'Una cuenta de cobro armada con los datos del registro, con su número, lista para descargar o enviar.' },
            { t: 'h', text: 'Dónde se crean' },
            {
                t: 'p',
                md: 'Las plantillas son **de cada lista**: una lista de Facturas tiene sus cuentas de cobro, una de Cotizaciones sus cotizaciones. Se crean en **Ajustes de la lista → Documentos** (la sección **Documentos PDF**). Ahí ves cada plantilla con su próximo número, si se congela al emitirla, si está en el portal del cliente y cuándo se editó, con los botones **Editar** y **Eliminar**.',
            },
            {
                t: 'steps',
                items: [
                    'Abre la lista (por ejemplo **Facturas**) y entra a sus ajustes.',
                    'Ve a la sección **Documentos**.',
                    'Toca **Nueva plantilla** (o **Crear la primera** si todavía no hay ninguna).',
                    'Elige un punto de partida de la galería y completa los datos que pide.',
                    'Ajusta lo que quieras en el editor y toca **Guardar**.',
                ],
            },
            { t: 'h', text: 'Todo lo que puedes hacer' },
            {
                t: 'cards',
                items: [
                    { icon: 'LayoutTemplate', title: 'Partir de una plantilla', md: 'Cuenta de cobro, cuenta de cobro con detalle, cotización, factura no electrónica o en blanco.', tone: 'amber' },
                    { icon: 'PenLine', title: 'Diseñar a tu gusto', md: 'Encabezado con logo, datos, tabla de ítems, totales, código QR, imágenes, columnas y firma, con tus fuentes y colores.', tone: 'violet' },
                    { icon: 'Calculator', title: 'Calcular solo', md: 'Totales por línea, descuentos, IVA, retenciones y el total en letras, siempre cuadrados.', tone: 'blue' },
                    { icon: 'Hash', title: 'Numerar', md: 'Un consecutivo propio (CC-0001, COT-0001) que no se repite ni se salta.', tone: 'rose' },
                    { icon: 'Lock', title: 'Congelar al emitir', md: 'El PDF emitido queda guardado y se entrega siempre igual, aunque después cambien los datos.', tone: 'slate' },
                    { icon: 'Send', title: 'Enviarlo solo', md: 'Una automatización lo genera y lo manda adjunto por correo, o comparte un enlace por WhatsApp.', tone: 'mint' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'No es factura electrónica',
                md: 'Estos documentos sirven para cuentas de cobro, recibos, cotizaciones y órdenes de servicio. **No reemplazan la factura electrónica de la DIAN**, que exige un formato y una validación especiales. La plantilla «Factura (no electrónica)» lo dice en el pie del documento.',
            },
            { t: 'h', text: 'Ideas para tu negocio' },
            {
                t: 'example',
                title: 'Un diseñador independiente',
                md: 'Cada mes le cobra a sus clientes de mantenimiento web. En la lista **Clientes** tiene el valor mensual y el próximo cobro. Con la plantilla **Cuenta de cobro** y una automatización, el día 1 de cada mes le llega a cada cliente su cuenta de cobro numerada (CC-0057, CC-0058…) con el valor en letras, sus datos bancarios y la nota «No responsable de IVA».',
            },
            {
                t: 'example',
                title: 'Un taller de mantenimiento industrial',
                md: 'La lista **Cotizaciones** tiene una lista vinculada **Ítems** (repuestos y mano de obra). La plantilla **Cotización** arma la tabla con cantidad, precio y descuento por línea, suma, aplica el IVA 19 % y escribe «Válida hasta el 22/10/2026». El asesor la descarga desde la ficha y la manda por WhatsApp.',
            },
            {
                t: 'example',
                title: 'Un colegio',
                md: 'Una plantilla **en blanco** con el escudo, un título «Certificado de estudios», un texto con variables («Se certifica que {{estudiante}} cursó {{grado}} en el año {{año}}…») y dos firmas. La secretaría genera el certificado desde la ficha de cada estudiante.',
            },
            { t: 'h', text: 'Quién puede hacer qué' },
            {
                t: 'settings',
                rows: [
                    { name: 'Diseñar plantillas', what: 'Quien tiene permiso para gestionar plantillas de documentos (por defecto, los administradores).' },
                    { name: 'Ver y descargar un PDF', what: 'Cualquiera que pueda ver el registro.' },
                    { name: 'Guardar el PDF en un campo del registro', what: 'Quien puede editar ese registro.' },
                    { name: 'Anular un documento emitido y emitir otro', what: 'Sólo un administrador.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cuántas plantillas puede tener una lista?', a: 'Las que necesites: por ejemplo «Cuenta de cobro», «Recibo de pago» y «Paz y salvo» en la misma lista de clientes.' },
                    { q: '¿El PDF ocupa espacio de mi plan?', a: 'Sólo si lo guardas como archivo en el registro (o si la plantilla congela al emitir). Ver, descargar o mandar un enlace no ocupa espacio. Si tu empresa usa su propio almacenamiento, tampoco cuenta.' },
                    { q: '¿Qué pasa si borro una plantilla?', a: 'Los PDF que ya se guardaron en registros no se borran. Si una automatización la usa, la app no te deja borrarla hasta que la quites de ahí.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Crear una plantilla', article: 'documentos-pdf-galeria' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-galeria',
        route: '/lists',
        related: ['documentos-pdf-editor', 'documentos-pdf-items-totales', 'documentos-pdf-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'La forma más rápida de tener un documento profesional es partir de la **galería**. Cada punto de partida trae el diseño completo (encabezado, datos, totales, firma, pie) y te pregunta sólo lo necesario: qué campo de tu lista va en cada lugar y tus datos de cobro.',
            },
            { t: 'anim', key: 'pdf-galeria', caption: 'Eliges «Cuenta de cobro», la app sugiere qué campo va en cada lugar y cargas tus datos.' },
            { t: 'h', text: 'Los puntos de partida' },
            {
                t: 'settings',
                rows: [
                    { name: 'Cuenta de cobro', what: 'Un concepto y un valor, con el monto en letras, tus datos bancarios y la firma.', tip: 'La de todos los meses para independientes y servicios.' },
                    { name: 'Cuenta de cobro con detalle', what: 'Con una tabla de ítems (servicios, horas, cuotas) sacada de los registros vinculados y el total sumado solo.', tip: 'Necesita que la lista tenga un campo de relación con la lista de los ítems.' },
                    { name: 'Cotización', what: 'Ítems con cantidad, precio y descuento por línea, el total de cada línea calculado, IVA, validez y condiciones comerciales.' },
                    { name: 'Factura (no electrónica)', what: 'Ítems con el total de cada línea, descuentos, base gravable, IVA, forma de pago y tus datos bancarios. Lleva el aviso «No es factura electrónica DIAN».' },
                    { name: 'En blanco', what: 'Una hoja con un encabezado para armar el documento desde cero.', tip: 'Para certificados, actas, órdenes de servicio o paz y salvos.' },
                ],
            },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes de la lista → Documentos**, toca **Nueva plantilla**.',
                    'Elige el punto de partida (por ejemplo **Cuenta de cobro**).',
                    'En **Datos de esta lista**, revisa qué campo va en cada lugar: el nombre del cliente, su NIT o cédula, el concepto, el valor, las fechas. La app lo sugiere por el nombre y el tipo de cada campo; elige **— Sin usar —** si tu lista no lo tiene.',
                    'Si elegiste un modelo con detalle, en **Ítems del detalle** elige de qué lista vinculada salen las líneas y qué campo es la descripción, la cantidad y el precio.',
                    'Completa **Quién cobra** y **Dónde te pagan**.',
                    'Ajusta **Impuestos y descuentos** y la **Nota tributaria al pie**.',
                    'Toca **Crear y abrir el editor**. Revisa el PDF y toca **Guardar**.',
                ],
            },
            { t: 'demo', key: 'pdf-crear-plantilla', caption: 'Crear una cuenta de cobro para la lista de facturas.', fallback: 'pdf-galeria' },
            { t: 'h', text: 'Los datos que pide' },
            {
                t: 'settings',
                rows: [
                    { name: 'Datos de esta lista', what: 'Qué campo de tu lista va en cada lugar del documento: cliente, NIT o cédula, número, fecha, fecha límite de pago, concepto, valor… Los obligatorios se marcan con asterisco.', tip: 'Un campo que viene de otra lista (por ejemplo el NIT del cliente traído a la factura) también sirve.' },
                    { name: 'Ítems del detalle', what: '**Las líneas salen de** una lista vinculada «por» un campo de relación, y qué campo es la descripción, la cantidad, el precio y el descuento por línea.', tip: 'Si tu lista no está vinculada con otra, usa la cuenta de cobro simple o crea un campo «Relación».' },
                    { name: 'Quién cobra', what: '**Nombre**, **Tipo de documento**, **Número de documento**, **Teléfono**, **Correo**, **Dirección** y **Ciudad**. Van en el encabezado y en la firma.', tip: 'La app los recuerda para tu próxima plantilla.' },
                    { name: 'Dónde te pagan (opcional)', what: '**Banco**, **Tipo de cuenta** (Ahorros o Corriente), **Número de cuenta** y **Titular**.' },
                    { name: 'Cobro IVA y Tarifa de IVA', what: 'Si cobras IVA y con qué tarifa (19 % por defecto). Sin IVA, el documento sale con la nota de no responsable de IVA.' },
                    { name: 'Descuento global fijo (opcional)', what: 'Un porcentaje de descuento sobre todo el documento, además de los descuentos por línea.' },
                    { name: 'Válida por (días, sin campo de vencimiento)', what: 'En la cotización: cuántos días es válida si la lista no tiene un campo con la fecha de vencimiento.' },
                    { name: 'Congelar el documento al emitirlo', what: 'Con su número se guarda el PDF y se entrega siempre ese, aunque cambien los datos.', tip: 'Recomendado para todo lo que se cobra.' },
                    { name: 'Nota tributaria al pie', what: 'La declaración que suelen pedir las empresas para pagar una cuenta de cobro. Ajústala a tu régimen.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo que falta queda marcado',
                md: 'Si no eliges un campo o dejas un dato vacío, el documento lo muestra entre corchetes, por ejemplo **[Nombre del cliente]**, para que lo completes en el editor. Nada se inventa.',
            },
            {
                t: 'example',
                title: 'Una fisioterapeuta independiente',
                md: 'Su lista **Sesiones** tiene el paciente, la EPS, la fecha y el valor. Elige **Cuenta de cobro**: el cliente es la EPS, el concepto es «Sesiones de fisioterapia de {{mes}}» y el valor es el total. Carga su cédula, su cuenta de ahorros y la nota de no responsable de IVA. En dos minutos tiene la cuenta de cobro que antes armaba en un procesador de texto.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiar el mapeo después?', a: 'Sí. En el editor, cada bloque muestra qué campo usa y lo cambias ahí. La galería sólo te ahorra el primer armado.' },
                    { q: '¿La cotización sirve sin ítems?', a: 'Necesita una lista vinculada con las líneas. Si cotizas un solo servicio, usa la cuenta de cobro simple y cámbiale el título a «Cotización».' },
                    { q: '¿Puedo usar mi logo?', a: 'Sí: el encabezado usa el logo de tu empresa (Ajustes → Marca) o uno que subas en la plantilla.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'El editor de documentos', article: 'documentos-pdf-editor' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-editor',
        route: '/lists',
        related: ['documentos-pdf-items-totales', 'documentos-pdf-variables', 'documentos-pdf-galeria'],
        blocks: [
            {
                t: 'p',
                md: 'El editor de documentos ocupa toda la pantalla y tiene tres partes: a la izquierda las pestañas **Agregar**, **Estructura** y **Hoja y estilo**; al centro **el PDF real**, dibujado igual que el que se descarga; y a la derecha los ajustes del bloque que elegiste. Lo que ves es exactamente lo que va a salir.',
            },
            { t: 'anim', key: 'pdf-editor', caption: 'Se arrastra un «Código QR» a la hoja y a la derecha aparecen sus opciones.' },
            { t: 'h', text: 'La barra de arriba' },
            {
                t: 'settings',
                rows: [
                    { name: 'Nombre de la plantilla', what: 'Cómo se llama en el menú «Generar PDF» y en las automatizaciones.' },
                    { name: 'Deshacer y Rehacer', what: 'Vuelve atrás cualquier cambio (Ctrl+Z, Ctrl+Shift+Z).' },
                    { name: 'Ver con datos de un registro', what: 'El PDF se llena con un registro real de la lista; eliges cuál (por defecto, el último).', tip: 'Prueba con un registro con muchos ítems para ver cómo corta la página.' },
                    { name: 'Ver las variables', what: 'Muestra los nombres de las variables en vez de los datos: así ves qué dato va en cada lugar.' },
                    { name: 'Abrir PDF', what: 'Abre el PDF en otra pestaña, como lo vería quien lo recibe.' },
                    { name: 'Guardar', what: 'Guarda la plantilla. Si cierras con cambios sin guardar, la app te pregunta.' },
                ],
            },
            { t: 'h', text: 'Los bloques' },
            {
                t: 'p',
                md: 'En **Agregar** toca un bloque para sumarlo al final del documento. En **Estructura** ves el orden de arriba hacia abajo y tocas cualquiera para editarlo. También puedes tocar un bloque directamente en el PDF.',
            },
            {
                t: 'settings',
                title: 'Qué hace cada bloque',
                rows: [
                    { name: 'Encabezado', what: 'Logo, tus datos, el título del documento, el número y la fecha. **Forma**: Logo y título, Centrado o Franja; **Logo**: ninguno, el de tu marca, uno subido o un enlace, con su ancho; **Quién emite** (un dato por renglón, el primero en negrita), **Título del documento**, **Número** y **Ciudad y fecha**.' },
                    { name: 'Título', what: 'Un título o subtítulo de sección, en tamaño Grande, Mediano o Rótulo.' },
                    { name: 'Texto', what: 'Párrafos con negrita, listas y variables del registro.', tip: 'Las condiciones comerciales, una carta, la forma de pago.' },
                    { name: 'Datos del registro', what: 'Campos del registro en una tabla prolija, con el valor como se lee en la ficha (montos, fechas y opciones legibles). **Disposición**: Tabla o Etiqueta arriba, en una o dos columnas.' },
                    { name: 'Tabla de ítems', what: 'Las líneas del documento, sacadas de registros vinculados (productos, servicios, cuotas). Lo ves en detalle en el artículo de ítems y totales.' },
                    { name: 'Totales', what: 'Subtotal, impuestos y total, calculados solos.' },
                    { name: 'Imagen', what: 'Un logo, un sello o una foto. PNG o JPG (los formatos que acepta un PDF).' },
                    { name: 'Separador', what: 'Una línea: color, grosor, tipo (continua, rayada, punteada) y largo.' },
                    { name: 'Espacio', what: 'Aire entre bloques, con el alto que elijas.' },
                    { name: 'Salto de página', what: 'Lo que viene después arranca en una página nueva.', tip: 'Para separar los términos y condiciones en su propia hoja.' },
                    { name: 'Firma', what: 'Línea de firma con **Nombre** y lo que va **Debajo del nombre** (cargo o documento). **Agregar otra firma** para varias; **Firma escaneada (opcional)** pone la imagen de tu firma.' },
                    { name: 'Columnas', what: 'Dos o tres columnas lado a lado; cada una con sus propios bloques.', tip: 'Tus datos bancarios a la izquierda y el QR de pago a la derecha.' },
                    { name: 'Código QR', what: 'Un código para escanear: el link de pago, una dirección o un texto, con variables. **Texto debajo (opcional)**. Si queda vacío para un registro, el código no se dibuja.' },
                ],
            },
            { t: 'h', text: 'Contenido y estilo de cada bloque' },
            {
                t: 'p',
                md: 'Al elegir un bloque, el panel derecho tiene dos pestañas: **Contenido** (qué dice) y **Estilo** (cómo se ve). Arriba están los botones **Subir**, **Bajar**, **Duplicar** y **Eliminar**. En **Estilo** eliges la fuente, el tamaño, el grosor, la alineación, el color del texto, el espaciado, el fondo y el borde del bloque.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'El PDF dibuja esquinas rectas y no tiene sombras: por eso esas opciones no aparecen en los documentos (sí en los correos).',
            },
            { t: 'h', text: 'Hoja y estilo' },
            {
                t: 'settings',
                rows: [
                    { name: 'Tamaño de la hoja', what: '**Carta**, **A4** u **Oficio**.' },
                    { name: 'Orientación', what: '**Vertical** u **Horizontal**.' },
                    { name: 'Márgenes', what: '**Angostos**, **Normales** o **Anchos**.' },
                    { name: 'Tipografía', what: '**Fuente del documento**, **Fuente de los títulos**, **Tamaño del texto** e **Interlineado**. Las fuentes van incluidas dentro del PDF: se ve igual en cualquier computador o celular, y al imprimirlo.' },
                    { name: 'Colores', what: '**Acento** (títulos, tabla y total), **Texto**, **Texto secundario** y **Líneas**.', tip: 'Pon el acento en el color de tu marca.' },
                    { name: 'Pie de página', what: '**Numerar las páginas («Página 1 de 2»)** y un **Texto del pie (opcional)**.' },
                    { name: 'Numeración', what: 'El consecutivo propio del documento: prefijo, dígitos y número inicial.' },
                    { name: 'Congelar el documento al emitirlo', what: 'Guarda el PDF la primera vez que se emite su número.' },
                    { name: 'Portal del cliente', what: '**Disponible en el portal del cliente**: el cliente lo descarga con los datos de su registro.' },
                    { name: 'Archivo', what: 'El nombre del archivo, con variables: «Cuenta de cobro {{record.id}} - {{cliente}}». Se le agrega .pdf solo.' },
                ],
            },
            { t: 'demo', key: 'pdf-editor-recorrido', caption: 'Elegir un bloque, editarlo y ajustar la hoja.', fallback: 'pdf-editor' },
            {
                t: 'keys',
                items: [
                    { keys: ['Ctrl', 'Z'], what: 'Deshacer el último cambio.' },
                    { keys: ['Ctrl', 'Shift', 'Z'], what: 'Rehacer.' },
                ],
            },
            {
                t: 'example',
                title: 'Una agencia de eventos',
                md: 'Su cotización tiene un **Encabezado** en forma **Franja** con el color de la marca, un **Texto** de bienvenida con el nombre del evento, la **Tabla de ítems** (salón, catering, sonido), **Totales**, **Columnas** con las condiciones de pago a la izquierda y un **Código QR** al portafolio a la derecha, un **Salto de página** y los términos y condiciones en la segunda hoja, firmada por la gerente.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿En el celular se puede editar?', a: 'Sí: el editor pasa a pestañas (**Bloques**, **Documento** y **Editar**). Para diseños largos es más cómodo el computador.' },
                    { q: '¿Puedo poner el logo de mi empresa sin subirlo de nuevo?', a: 'Sí: en el Encabezado o en una Imagen elige **Logo de la marca**: usa el que cargaste en Ajustes → Marca.' },
                    { q: '¿Las fuentes se verán bien en otro computador?', a: 'Sí, van dentro del PDF. Las fuentes del sistema (Arial, Georgia, Times) se reemplazan por equivalentes de las mismas medidas.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ítems y totales', article: 'documentos-pdf-items-totales' },
                    { label: 'Variables y modificadores', article: 'documentos-pdf-variables' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-items-totales',
        route: '/lists',
        related: ['documentos-pdf-editor', 'documentos-pdf-variables', 'documentos-pdf-galeria'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando un documento tiene líneas (productos, servicios, horas, cuotas), esas líneas no se escriben a mano: salen de una **lista vinculada** al registro. Una cotización tiene sus ítems en una lista **Ítems de cotización** unida por un campo de relación. La **Tabla de ítems** los dibuja y los **Totales** hacen las cuentas.',
            },
            { t: 'anim', key: 'pdf-totales', caption: 'Cada línea calcula su total y los totales encadenan subtotal, descuentos, base, IVA y total.' },
            { t: 'h', text: 'La tabla de ítems' },
            {
                t: 'settings',
                rows: [
                    { name: 'Filas: registros vinculados de', what: 'Por qué relación se traen las líneas. Sólo aparecen los registros vinculados a ESE registro.' },
                    { name: 'Columnas', what: 'Qué campo va en cada columna, en el orden en que aparecen. Cada una con su **Encabezado**, **Alineación** (izquierda, centro, derecha) y **Ancho**: **Justa** o **Llena** (toma el ancho que sobra, ideal para la descripción).' },
                    { name: 'Ocultarla (sólo para calcular los totales)', what: 'Una columna que no se ve pero se usa en los cálculos.' },
                    { name: 'Columna calculada', what: 'Una columna que hace una cuenta con otras, sin escribir fórmulas: elige la forma y los operandos.' },
                    { name: 'Mostrar como', what: '**Como en la lista**, **Moneda** o **Número**, con **Decimales** y texto **Antes del número**.' },
                    { name: 'Ordenar por', what: '**Como se crearon** o por un campo, ascendente o descendente.' },
                    { name: 'Numerar las filas (#)', what: 'Agrega una columna con 1, 2, 3…' },
                    { name: 'Filas alternadas', what: 'Pinta una fila sí y otra no para que se lea mejor.' },
                    { name: 'Si no hay ítems', what: 'El texto que aparece cuando el registro no tiene líneas.' },
                ],
            },
            {
                t: 'settings',
                title: 'Formas de la columna calculada',
                rows: [
                    { name: 'A × B', what: 'Cantidad por precio unitario.' },
                    { name: 'A × B − descuento %', what: 'Cantidad por precio menos el descuento de la línea.', tip: 'La que usa la cotización.' },
                    { name: 'A + B y A − B', what: 'Suma o resta de dos columnas o de una columna y un número fijo.' },
                    { name: 'A ÷ B', what: 'División (por ejemplo, precio por unidad).' },
                    { name: 'B % de A', what: 'Un porcentaje de otra columna (la comisión, el impuesto de la línea).' },
                    { name: 'A − B %', what: 'Restar un porcentaje.' },
                    { name: 'Igual a A', what: 'Copia otra columna (útil para mostrarla con otro formato).' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Cada línea se redondea a los decimales que elijas y el total suma **lo que se ve**. Así nunca pasa que la suma de las líneas del PDF no coincide con el total por un peso.',
            },
            { t: 'h', text: 'Los totales' },
            {
                t: 'p',
                md: 'El bloque **Totales** es una lista de filas que se calculan solas y se pueden encadenar. Cada fila tiene su **Nombre de la fila** y una variable propia (**{{totales.id}}**) para usarla en cualquier texto.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Suma de una columna de la tabla', what: 'El subtotal: suma la columna que elijas.' },
                    { name: 'Un campo del registro', what: 'Un valor que ya está en el registro (un anticipo, un costo de envío).' },
                    { name: 'Porcentaje de otra fila (IVA, retención)', what: 'Un porcentaje fijo o **desde un campo** de otra fila. Con **Restarlo (es un descuento)** se resta.', tip: 'IVA 19 % de la base; retención en la fuente 11 % restada.' },
                    { name: 'Suma de otras filas', what: 'Suma (y resta) filas anteriores: base gravable, total.' },
                    { name: 'Texto escrito', what: 'Una fila con texto fijo, por ejemplo «Forma de pago: transferencia».' },
                    { name: 'Destacada (el total)', what: 'Se pinta más grande y con el color de acento.' },
                    { name: 'Ocultarla (sólo para otros cálculos)', what: 'Un paso intermedio que no se muestra.' },
                    { name: 'No mostrarla si da 0', what: 'Por ejemplo, la fila de descuentos cuando no hay descuento.' },
                    { name: 'Ancho', what: '**A la derecha** (lo clásico) o **Todo el ancho**.' },
                ],
            },
            {
                t: 'example',
                title: 'Una cotización con IVA, paso a paso',
                md: '1. **Subtotal** = suma de la columna Bruto (cantidad × precio).\n2. **Descuentos** = suma de la columna de descuento de cada línea, restada (no se muestra si da 0).\n3. **Base gravable** = subtotal − descuentos.\n4. **IVA 19 %** = 19 % de la base.\n5. **TOTAL** = base + IVA, destacada.\n\nDebajo, un texto «Son: {{totales.total|pesos}} M/CTE.» escribe el total en letras.',
            },
            {
                t: 'example',
                title: 'Una cuenta de cobro de un contratista con retención',
                md: 'Honorarios $ 4.000.000 (un campo del registro), **Retención en la fuente 11 %** restada ($ 440.000), **Total a pagar** $ 3.560.000 destacado, y el total en letras. Si el cliente no retiene, la fila de retención se apaga con **No mostrarla si da 0** usando un campo de porcentaje en 0.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo tener dos tablas de ítems?', a: 'Sí, por ejemplo productos y servicios de dos listas vinculadas distintas. Cada fila de totales elige de qué tabla suma.' },
                    { q: '¿Qué pasa si un ítem no tiene precio?', a: 'Cuenta como cero en las cuentas. Revisa la vista previa con un registro real antes de usar la plantilla.' },
                    { q: '¿Los ítems se editan desde el documento?', a: 'No: se editan en la ficha del registro (en la tabla de vinculados). El documento siempre muestra lo que hay en ese momento, salvo que esté congelado.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Variables y modificadores', article: 'documentos-pdf-variables' },
                    { label: 'Ir a mis listas', to: '/lists' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-variables',
        route: '/lists',
        related: ['documentos-pdf-editor', 'documentos-pdf-items-totales', 'correos-enviar'],
        blocks: [
            {
                t: 'p',
                md: 'Una **variable** es un dato del registro puesto dentro de un texto. Se escribe entre llaves dobles con el nombre del campo, por ejemplo **{{cliente}}**, y en el PDF de cada registro aparece su valor. Los editores tienen un botón para insertarlas sin escribirlas a mano.',
            },
            { t: 'anim', key: 'pdf-variables', caption: 'Cada variable se convierte en el dato, escrito como lo pide un documento.' },
            { t: 'h', text: 'Cómo se ven los valores' },
            {
                t: 'p',
                md: 'Por defecto cada valor sale **como se lee en la ficha**: los montos con los separadores de tu empresa ($ 1.250.000), las fechas en tu formato (08/10/2026), las opciones con su etiqueta («Pendiente de pago», no el valor interno) y las casillas como Sí o No.',
            },
            { t: 'h', text: 'Modificadores' },
            {
                t: 'p',
                md: 'Un **modificador** se agrega después de una barra vertical y cambia cómo se escribe el valor. Se pueden encadenar: **{{valor|pesos|mayusculas}}**.',
            },
            {
                t: 'settings',
                rows: [
                    { name: '|letras', what: 'Un número escrito en palabras: 1250 → «mil doscientos cincuenta».' },
                    { name: '|pesos', what: 'Un monto en palabras con la moneda: 1.250.000 → «un millón doscientos cincuenta mil pesos» (con centavos «con 50/100»).', tip: 'Para el clásico «Son: … M/CTE.».' },
                    { name: '|larga', what: 'Una fecha larga: 08/10/2026 → «8 de octubre de 2026».' },
                    { name: '|mayusculas', what: 'Todo en mayúsculas: «HOTEL BRISAS DEL MAR».' },
                    { name: '|+1m, |-1d, |+1y', what: 'Corre una fecha: un mes después, un día antes, un año después. Se encadenan: **{{fecha|+1m|-1d}}**.', tip: 'Para el período de una cuenta de cobro: del {{fecha}} al {{fecha|+1m|-1d}}.' },
                ],
            },
            { t: 'h', text: 'Variables especiales' },
            {
                t: 'settings',
                rows: [
                    { name: '{{date.today}}', what: 'La fecha de hoy (en la zona de tu empresa). Con **|larga**: «8 de octubre de 2026».' },
                    { name: '{{record.id}}', what: 'El número interno del registro.' },
                    { name: '{{documento.numero}}', what: 'El consecutivo del documento (CC-0042), si la plantilla numera.' },
                    { name: '{{totales.id}}', what: 'El valor de una fila de totales: **{{totales.total}}**, **{{totales.iva}}**.' },
                ],
            },
            {
                t: 'example',
                title: 'El encabezado de una cuenta de cobro',
                md: '**Ciudad y fecha**: «Bogotá, {{date.today|larga}}»\n**Texto**: «{{cliente|mayusculas}}, NIT {{nit_cliente}}, DEBE A: Laura Gómez, C.C. 52.345.678, la suma de {{valor|pesos}} ({{valor}}) por concepto de {{concepto}} del período {{fecha|larga}} al {{fecha|+1m|-1d|larga}}.»',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Las variables y los modificadores funcionan igual en los documentos, en los correos y en los mensajes de las automatizaciones. Lo que aprendas aquí te sirve en todos lados.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si el campo está vacío?', a: 'La variable queda vacía (no aparece el nombre entre llaves). En la vista previa usa **Ver con datos de un registro** para comprobarlo.' },
                    { q: '¿Cómo sé el nombre de la variable de un campo?', a: 'Usa el botón para insertar variables del editor: muestra cada campo con su nombre y lo escribe por ti. **Ver las variables** en la vista previa te muestra dónde va cada una.' },
                    { q: '¿Funciona en el nombre del archivo?', a: 'Sí: «Cotización {{documento.numero}} - {{cliente}}» da «Cotización COT-0017 - Hotel Brisas.pdf».' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'El editor de documentos', article: 'documentos-pdf-editor' },
                    { label: 'Diseñar correos', article: 'correos-enviar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-generar',
        route: '/lists',
        related: ['documentos-pdf-automatizar', 'documentos-pdf-que-son', 'documentos-pdf-editor'],
        blocks: [
            {
                t: 'p',
                md: 'Con la plantilla guardada, cada registro de la lista tiene su botón **Generar PDF**: el ícono de documento en la barra de arriba de la ficha completa y de la ventana del registro. El menú muestra **Documentos de esta lista**; pasa el mouse (o toca) sobre una plantilla y aparecen sus opciones: verla, descargarla, copiar un enlace o guardarla como archivo del registro.',
            },
            { t: 'anim', key: 'pdf-emitir', caption: '«Descargar» emite el número CC-0042 y lo congela; después se anula y se emite el CC-0043.' },
            { t: 'h', text: 'Las opciones de cada plantilla' },
            {
                t: 'settings',
                rows: [
                    { name: 'Ver', what: 'Abre el PDF **con los datos de ahora**, sin gastar ningún número.', tip: 'Para revisar antes de mandar.' },
                    { name: 'Descargar', what: 'Baja el PDF. Si la plantilla numera y congela, **la primera vez lo emite y lo congela**.' },
                    { name: 'Copiar enlace (30 días)', what: 'Un enlace que cualquiera puede abrir durante 30 días, **sin guardar archivo**: el PDF se arma al abrirlo.', tip: 'Ideal para pegarlo en un WhatsApp sin llenar tu almacenamiento.' },
                    { name: 'Guardar en «campo»', what: 'Guarda el PDF en un campo de tipo Archivo del registro (aparece si la lista tiene uno y puedes editar el registro).' },
                    { name: 'Documentos emitidos', what: 'Al final del menú, cuando ya hay números emitidos: los de ese registro, con su estado.' },
                    { name: 'Diseñar plantillas', what: 'Al final del menú: atajo a Ajustes de la lista → Documentos (si tienes permiso).' },
                ],
            },
            { t: 'demo', key: 'pdf-generar', caption: 'Generar la cuenta de cobro desde la ficha de una factura.', fallback: 'pdf-emitir' },
            { t: 'h', text: 'Numeración consecutiva' },
            {
                t: 'p',
                md: 'En **Hoja y estilo → Numeración** activa **Numerar los documentos (consecutivo)** y elige el **Prefijo** («CC-», «COT-», «FAC-»), los **Dígitos** (CC-0001 con 4, o **Sin ceros**) y en qué número **Empieza en**. El panel muestra el **Próximo número**.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Hash', title: 'Uno por registro', md: 'Cada registro recibe SU número la primera vez que el documento se genera de verdad, y lo conserva: volver a generarlo no gasta otro.', tone: 'blue' },
                    { icon: 'Eye', title: 'Mirar no gasta', md: 'La vista previa del editor y «Ver» nunca consumen números.', tone: 'slate' },
                    { icon: 'ShieldCheck', title: 'Sin huecos ni repetidos', md: 'Aunque dos personas generen a la vez, cada documento recibe un número distinto y seguido.', tone: 'mint' },
                ],
            },
            {
                t: 'p',
                md: 'Si eliges un campo de texto en **Para verlo y filtrarlo en la lista**, el número se escribe también en ese campo del registro. Para mostrarlo dentro del documento usa la variable **{{documento.numero}}**.',
            },
            { t: 'h', text: 'Congelar al emitir' },
            {
                t: 'p',
                md: 'Con **Congelar el documento al emitirlo**, la primera vez que se emite el número el PDF se guarda en el almacenamiento de la empresa y desde ahí se entrega **siempre ese**: desde la ficha, el portal, una automatización o un enlace. Si después cambias el precio en el registro, el documento emitido no cambia. Es lo que se espera de un documento contable.',
            },
            {
                t: 'p',
                md: 'En **Documentos emitidos** ves cada número con su estado: **Congelado** o **Anulado**, quién lo emitió y cuándo, con **Descargar**.',
            },
            {
                t: 'steps',
                items: [
                    'Si un documento emitido tenía un error, ábrelo en **Documentos emitidos**.',
                    'Toca **Anular y emitir de nuevo** (sólo administradores).',
                    'Escribe el **Motivo (opcional)**, por ejemplo «Se corrigió el precio de un ítem».',
                    'Confirma. El documento queda **Anulado**: conserva su número (que no se vuelve a usar) y su PDF. Se emite el número siguiente con los datos de ahora.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si la app no puede guardar el PDF al emitirlo (por ejemplo, porque se llenó el almacenamiento), la emisión falla con el motivo y **el número no se gasta**. Así nunca queda un número emitido sin su documento.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'Cada mes genera la cuenta de cobro del arriendo con el consecutivo «ARR-». El 5 de octubre un arrendatario pide corregir el valor de la administración: la gerente abre **Documentos emitidos**, anula ARR-0312 con el motivo «Administración mal calculada» y se emite ARR-0313. En la auditoría queda el rastro de los dos.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué «Ver» muestra «próximo»?', a: 'Porque todavía no se emitió: la vista previa te dice qué número tendría, pero no lo gasta.' },
                    { q: '¿Puedo volver a usar un número anulado?', a: 'No. Un número emitido, aunque se anule, no se vuelve a usar: así el consecutivo nunca se repite.' },
                    { q: '¿El enlace de 30 días muestra el documento congelado?', a: 'Sí: si el documento ya se emitió y se congeló, el enlace entrega ese PDF.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Que salgan solos', article: 'documentos-pdf-automatizar' },
                    { label: 'Ir a mis listas', to: '/lists' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'documentos-pdf-automatizar',
        route: '/lists',
        related: ['documentos-pdf-generar', 'correos-enviar', 'cobros-automatizar'],
        blocks: [
            {
                t: 'p',
                md: 'El paso siguiente es que nadie tenga que acordarse: una **automatización** genera el documento en el momento justo (al crear una factura, al aprobar una cotización, el día 1 de cada mes) y lo manda por correo o por WhatsApp. Y si activas el portal, tus clientes lo descargan solos.',
            },
            { t: 'anim', key: 'pdf-automatizar', caption: 'Al crear una factura: se genera la cuenta de cobro y sale adjunta por correo; también queda en el portal.' },
            { t: 'h', text: 'La acción «Generar un PDF»' },
            {
                t: 'settings',
                rows: [
                    { name: 'Plantilla del documento', what: 'Cuál de las plantillas de la lista. **Diseñar** abre el editor y **Nueva plantilla** crea una.' },
                    { name: 'Guardarlo en el registro (opcional)', what: 'Un campo de tipo Archivo donde dejarlo, o **No guardar: sólo para adjuntarlo o mandarlo**.', tip: 'Sin guardar no ocupa espacio de tu plan.' },
                    { name: 'Si ya hay archivos', what: '**Sumarlo a los archivos que ya tenga** o **Reemplazar lo que haya**.' },
                    { name: 'Nombre del archivo (opcional)', what: 'Vacío: **El de la plantilla**.' },
                ],
            },
            {
                t: 'p',
                md: 'Después de esta acción, los pasos siguientes pueden usar **{{pdf.link}}** (un enlace de 30 días al documento), **{{pdf.nombre}}** (el nombre del archivo) y **{{pdf.numero}}** (el consecutivo).',
            },
            { t: 'h', text: 'Adjuntarlo a un correo' },
            {
                t: 'steps',
                items: [
                    'En la acción **Enviar email**, busca **Adjuntar PDF**.',
                    'Elige hasta 5 plantillas. Si una acción anterior ya generó esa plantilla, se reutiliza ese mismo PDF.',
                    'Con **Enviarme una prueba** te llega el correo con los adjuntos, para revisarlo antes de activar.',
                ],
            },
            { t: 'h', text: 'Mandarlo por WhatsApp' },
            {
                t: 'p',
                md: 'La forma más simple de mandarlo por WhatsApp es un enlace: después de **Generar un PDF**, usa **{{pdf.link}}** en el mensaje: «Hola {{cliente}}, aquí está tu cuenta de cobro {{pdf.numero}}: {{pdf.link}}». El cliente lo abre con un toque, sin descargar nada antes.',
            },
            { t: 'h', text: 'En el portal del cliente' },
            {
                t: 'p',
                md: 'En **Hoja y estilo → Portal del cliente**, marca **Disponible en el portal del cliente**. En su portal, el cliente ve la sección **Tus documentos** y descarga el PDF, siempre con los datos de **su** registro. Si la plantilla numera, bajarlo le asigna el número igual que generarlo desde la ficha.',
            },
            {
                t: 'example',
                title: 'Facturación mensual de un gimnasio',
                md: 'Una automatización **programada** el día 1 a las 7:00 corre para cada socio activo: **Generar un PDF** (cuenta de cobro, guardada en el campo «Cuentas de cobro»), **Crear link de pago** con Mercado Pago, y **Enviar email** con el PDF adjunto y el botón «Pagar ahora» con el link. El socio también la encuentra en su portal.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Combina el documento con un **link de pago**: el cliente recibe la cuenta de cobro y paga en el mismo correo, y la app marca la factura como pagada sola cuando llega el pago.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo borrar una plantilla que usa una automatización?', a: 'No: la app te avisa qué automatizaciones la usan. Quítala de ahí primero.' },
                    { q: '¿El correo de prueba gasta números?', a: 'No. **Enviarme una prueba** arma el documento con el último registro sin emitir números reales.' },
                    { q: '¿Cuánto pesa un PDF?', a: 'Una cuenta de cobro típica pesa unos 30 KB: entra sin problema en cualquier correo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Diseñar correos', article: 'correos-enviar' },
                    { label: 'Cobrar con links de pago', article: 'cobros-automatizar' },
                ],
            },
        ],
    },
];
