# Imagina Base — Textos de la landing (imagina.cloud/base)

> Español neutro, tuteando. Todo lo que dice este documento es verdad hoy en la app
> (versión 0.1.337), con estas decisiones comerciales: **prueba gratis de 15 días sin
> tarjeta**, precios Starter $59.000 y Pro $199.000 (los puedes cambiar después), y
> **asistente IA y soporte solo en los planes de pago**. Lo que sigue marcado con
> **[CONFIRMAR]** (medios de pago activos, redes) revísalo antes de publicar.
> Lo marcado con **[CUANDO EXISTA]** son espacios para prueba social real: no los llenes
> con cifras inventadas.

**Enlace de los botones de registro** (la app ya registra de dónde vino cada alta):
`https://base.imagina.cloud/registro?utm_source=sitio&utm_medium=landing&utm_campaign=<seccion>`
— cambia `<seccion>` por `hero`, `precios`, `cta-final`, etc. Los enlaces internos del
sitio NO llevan `utm`.

**Enlace de «Entrar»:** `https://base.imagina.cloud/`

---

## 0. Barra superior (fija)

- Logo: Imagina Base (archivo `marca/logo.png`; sobre fondo oscuro, `marca/logo-oscuro.png`).
- Menú:
  - **Producto ▾** — Vistas · Automatizaciones · Tableros · Portal y formularios · Cobros y documentos · Inteligencia artificial · Integraciones · WordPress y SEO · SMS · App en el celular
  - **Soluciones ▾** — Ventas y CRM · Cobros y cartera · Proyectos y tareas · Agenda de citas · Mesa de ayuda · Tienda online e inventario · Agencias y sitios web
  - **Precios**
  - **Aprende**
- A la derecha: **Entrar** (texto) · **Prueba gratis** (botón principal; lleva a /registro)

---

## 1. Hero

**Antetítulo (eyebrow):**
CRM y base de datos sin código para pymes de Latinoamérica

**H1 (elige uno; recomendado el primero):**
1. **Organiza tu negocio a tu manera, sin programar**
2. Una base para todo tu negocio: clientes, ventas, cobros y proyectos
3. El sistema a la medida de tu negocio, listo en minutos

**Subtítulo:**
Clientes, ventas, cobros, proyectos y soporte en un solo lugar. Sube tu Excel o elige
una plantilla y tu sistema queda listo en minutos; conéctalo a WhatsApp y cobra en pesos
con PSE, Nequi o tarjeta.

**Botón principal:** Probar gratis 15 días
**Botón secundario:** Ver cómo funciona (2 min)

**Debajo de los botones (micro-texto, con íconos de check):**
15 días gratis · Sin tarjeta de crédito · En español · Precios en pesos

**Selector «¿Qué quieres organizar?» (chips sobre la demo del hero):**
Clientes · Ventas · Cobros · Proyectos · Citas · Soporte · Inventario
→ Al tocar un chip, la demo del hero cambia a esa lista (ver `04-MOTION.md`, idea 3).

**Visual:** la app real dentro de un marco de navegador: el embudo de ventas en kanban con
totales en pesos (`capturas/escritorio/01-ventas-pipeline-kanban.png`) que se transforma en
tabla, calendario y Gantt (`motion/animaciones/vistas-hero.mp4`).

---

## 2. Franja de confianza

Íconos pequeños en línea:
- Hecho en Colombia
- 100 % en español
- Precios en pesos
- PSE, Nequi y tarjeta
- Tus datos siempre exportables

**[CUANDO EXISTA]** «Empresas que ya organizan su negocio con Imagina Base» + logos de
clientes reales (con su permiso).

---

## 3. El problema

**H2:** ¿Tu negocio vive entre Excel, WhatsApp y cinco apps que no se hablan?

**Texto:** Los clientes en una hoja, las ventas en otra, los cobros en la libreta, las
tareas en el chat del equipo y los reportes armados a mano cada fin de mes. Funciona…
hasta que no.

Tres tarjetas:
1. **La información se pierde.** Cada quien tiene su versión del archivo y nadie sabe cuál
   es la buena.
2. **Lo repetitivo te come el día.** Recordar pagos, avisar al equipo, copiar datos de un
   lado a otro.
3. **Las herramientas de afuera salen caras.** Se cobran en dólares, por cada usuario, y
   casi siempre en inglés.

**Cierre:** Imagina Base junta todo en un solo lugar que se adapta a tu forma de trabajar,
no al revés.

---

## 4. Una base. Todo tu negocio.

**H2:** Una base. Todo tu negocio.
**Bajada:** No es solo un CRM: es una base de datos flexible donde armas exactamente lo
que tu empresa necesita. Empieza con un caso y suma los demás cuando quieras.

Pestañas (cada una con su captura, 3 viñetas y un botón «Usar esta plantilla»):

### Pestaña 1 · Ventas y CRM
**Título:** Ve todo tu embudo de ventas de un vistazo
- Arrastra cada oportunidad entre etapas y mira el total en pesos de cada columna.
- Cada cliente con su historial: conversaciones, archivos, tareas y lo que compró.
- Recordatorios automáticos para que ningún seguimiento se quede quieto.
Captura: `01-ventas-pipeline-kanban.png` · Botón: Usar la plantilla de ventas

### Pestaña 2 · Cobros y cartera
**Título:** Cobra a tiempo sin perseguir a nadie
- Cuentas de cobro y cotizaciones en PDF con tu logo y numeración consecutiva.
- Links de pago con Mercado Pago o Wompi: tu cliente paga con PSE, Nequi o tarjeta y la
  factura se marca pagada sola.
- Recordatorios por correo o WhatsApp antes y después del vencimiento.
Capturas: `04-tablero-cartera.png`, `22-documento-pdf-editor.png` · Botón: Usar la plantilla de facturación

### Pestaña 3 · Proyectos y tareas
**Título:** Cada proyecto, con fecha, responsable y avance
- Tablero, calendario, cronograma (Gantt) con dependencias y carga de trabajo por persona.
- Subtareas, checklists, comentarios con @menciones y registro de tiempo.
- «Mi trabajo»: cada persona ve lo suyo, ordenado por lo que vence primero.
Capturas: `07-gantt-cronograma.png`, `08-carga-de-trabajo-equipo.png` · Botón: Usar la plantilla de proyectos

### Pestaña 4 · Agenda de citas
**Título:** Que tus clientes agenden solos
- Una página pública para reservar, con tus servicios, tu horario y los festivos de Colombia.
- Reparte las citas entre tu equipo y evita los cruces de horario.
- Confirmaciones y recordatorios automáticos por correo.
Capturas: `20-agenda-publica-horario.png`, `06-calendario-citas-semana.png` · Botón: Usar la plantilla de citas

### Pestaña 5 · Mesa de ayuda
**Título:** Atiende cada solicitud a tiempo
- Los correos de tu buzón de soporte se vuelven tickets, y las respuestas siguen el hilo.
- Tiempos de respuesta (SLA) en horas hábiles, con avisos antes de que se venzan.
- Formularios para que tus clientes reporten desde tu sitio web.
Captura: `09-mesa-de-ayuda-sla.png`, `05-tablero-soporte.png` · Botón: Usar la plantilla de soporte

### Pestaña 6 · Tienda online e inventario
**Título:** Tu tienda WooCommerce, sincronizada y bajo control
- Pedidos, clientes, productos y variaciones se traen solos y se mantienen al día.
- Inventario con alertas de stock bajo y edición masiva de precios y existencias.
- Cambia precios o estados desde aquí y viajan a tu tienda.
Animación: `motion/animaciones/tienda-sync.mp4` (no hay captura de una tienda real en el kit) · Botón: Conectar mi tienda

### Pestaña 7 · Tu sitio WordPress
**Título:** Tu sitio WordPress, en una tabla que se edita
- Entradas, páginas, tus tipos de contenido y sus campos (ACF, Meta Box, JetEngine) como
  listas que se filtran, se ordenan y se editan.
- El SEO de todo el sitio a la vista: títulos y descripciones tal como los ve Google, con
  los demasiado largos y los vacíos marcados.
- Cambias aquí y llega a WordPress en segundos; edita cientos a la vez y deshazlo si te
  equivocaste.
Capturas: `32-wordpress-revision-seo.png`, `35-wordpress-recetas-campos-acf.png` · Botón: Conectar mi sitio

### Pestaña 8 · A tu medida
**Título:** ¿Tu negocio es distinto? Ármalo como es
- Más de 30 tipos de campo: moneda, fechas, personas, archivos, fórmulas, relaciones…
- Vincula listas entre sí (clientes ↔ facturas ↔ proyectos) y resume lo de una en la otra.
- Plantillas para inmobiliarias, reclutamiento, eventos, inventario, contratos y más.
Captura: `25-plantillas-de-listas.png` · Botón: Ver todas las plantillas

---

## 5. Cómo empiezas (3 pasos)

**H2:** Listo en minutos, no en meses

1. **Sube tu Excel o elige una plantilla.** La app reconoce tus columnas y su tipo
   (montos, fechas, teléfonos, opciones) y arma la lista sola. O arranca con una plantilla
   de ventas, cobros, proyectos, citas y más. Con un plan de pago, también puedes
   contarle tu negocio a la IA y ella arma todo.
2. **Elige cómo verlo.** Tabla tipo Excel, tablero kanban, calendario, cronograma o
   tarjetas: los mismos datos, la forma que necesites.
3. **Deja que trabaje solo.** Activa recordatorios, avisos y cobros automáticos con un clic
   desde las ideas listas para usar.

Visual: un archivo de Excel que entra en la pantalla y se convierte en la lista, con el
tipo de cada columna marcado (`motion/animaciones/lote-pegar.mp4`, `pp-empezar.mp4`).

---

## 6. Vistas

**H2:** Los mismos datos, la forma que necesites
**Bajada:** Cambia de vista con un clic. Nada se copia, nada se pierde.

Selector con 6 opciones (cada una muestra su captura):
- **Tabla tipo Excel** — Copia y pega desde Excel, rellena hacia abajo, deshaz, suma lo
  que selecciones y fija columnas. (`02-clientes-tabla-tipo-excel.png`)
- **Kanban** — Arrastra entre etapas, con totales en pesos y límites por columna.
  (`01-ventas-pipeline-kanban.png`)
- **Calendario** — Mes, semana, día y agenda; arrastra para reprogramar.
  (`06-calendario-citas-semana.png`)
- **Cronograma (Gantt)** — Dependencias entre tareas y reprogramación en cadena.
  (`07-gantt-cronograma.png`)
- **Carga de trabajo** — Quién está saturado y quién tiene espacio, semana a semana.
  (`08-carga-de-trabajo-equipo.png`)
- **Tarjetas** — Fichas visuales con foto, ideales para productos o inmuebles.

Línea final: Filtra, agrupa, colorea por reglas y guarda cada vista para tu equipo.

---

## 7. Automatizaciones

**H2:** Que el trabajo repetitivo se haga solo
**Bajada:** Arma flujos visuales sin escribir código: cuando pasa algo, la app hace lo que
le digas.

Ejemplo animado (el flujo se dibuja):
> **Cuando** una factura está a 3 días de vencer → **envía** un recordatorio al cliente →
> **espera** 3 días → **si** sigue pendiente, márcala vencida y vuelve a escribirle →
> **si** ya pagó, avisa al equipo.

Viñetas:
- Esperas, condiciones, ramas sí/no y pasos que se repiten por cada registro vinculado.
- Correos con diseño, mensajes de WhatsApp, SMS, webhooks, PDF y edición en lote.
- SMS de cobranza que respetan el horario de la Ley 2300: lo que cae fuera de hora queda
  programado para el siguiente momento permitido.
- **Pruébala paso a paso** antes de activarla, con un registro real y sin enviar nada.
- Historial de cada corrida y versiones para volver atrás.
- **39 ideas listas para activar con un clic**: recordatorios de pago, bienvenida a
  clientes, avisos de stock bajo, seguimiento de cotizaciones…

Capturas: `11-automatizacion-flujo.png`, `12-automatizacion-lienzo.png`, `13-ideas-para-tu-negocio.png`
Video: `motion/app/automatizacion-flujo-a-lienzo.mp4`, `motion/animaciones/auto-lienzo.mp4`

---

## 8. Tableros

**H2:** Tus números, siempre al día
**Bajada:** Indicadores, embudos, gráficos y tablas dinámicas que se calculan solos con
tus datos.

- Arma un tablero en minutos con plantillas de ventas, cartera, soporte, inventario y más.
- Compártelo con un enlace público o recíbelo por correo cada lunes en PDF.
- Toca una barra y ve los registros que hay detrás.

Capturas: `03-tablero-ventas.png`, `04-tablero-cartera.png`, `05-tablero-soporte.png`

---

## 9. De cara a tus clientes

**H2:** Tus clientes también lo usan (y no pagan usuario)
**Bajada:** Dales una experiencia profesional con tu marca, sin que tengas que programar
nada.

Cuatro tarjetas:
1. **Portal del cliente** — Cada cliente entra con un enlace a su correo y ve solo lo suyo:
   su estado de cuenta, sus pedidos, sus solicitudes. Puede pagar desde ahí.
   (`24-portal-editor.png`)
2. **Formularios** — Formularios públicos para tu sitio web que crean registros: varias
   páginas, preguntas condicionales y protección contra robots. (`18-formulario-publico.png`)
3. **Agenda en línea** — Tu página para reservar citas, lista para compartir por WhatsApp
   o Instagram. (`20-agenda-publica-horario.png`)
4. **Documentos PDF** — Cotizaciones y cuentas de cobro con tu logo, numeración
   consecutiva y valores en letras. (`22-documento-pdf-editor.png`)

Nota pequeña: Las cuentas de cobro y cotizaciones no reemplazan la factura electrónica de
la DIAN.

---

## 10. Cobros (bloque destacado, fondo de color)

**H2:** Cobra más rápido, sin perseguir a nadie
**Texto:** Genera la cuenta de cobro, envía el link de pago por WhatsApp o SMS y deja que la app
marque la factura como pagada cuando entre el dinero. Con Mercado Pago o Wompi, a tu
propia cuenta y sin comisión de la plataforma.

Mini-flujo animado (ver `04-MOTION.md`, idea 6): factura → PDF «CC-0042» → burbuja de
WhatsApp con link → «Pagado ✓» con monto en pesos.

Botón: Empieza a cobrar con Imagina Base

---

## 11. Inteligencia artificial

**H2:** Inteligencia artificial que trabaja con tus permisos
**Bajada:** La IA te ayuda de verdad, pero nunca hace cambios sin que tú lo decidas.

Tres columnas:
1. **Asistente** — Pídele en español «créame una lista de proveedores con su NIT y un
   tablero de compras» y te muestra la propuesta antes de aplicarla.
2. **Agentes** — Compañeros que trabajan solos sobre tus registros: clasifican tickets,
   resumen casos cerrados o completan datos faltantes. Proponen y una persona aprueba.
3. **Campos con IA** — Una columna que resume, clasifica, extrae datos o traduce a partir
   de otros campos, incluso de PDF e imágenes. Por ejemplo: la meta descripción que le falta
   a cada entrada de tu blog o el texto alternativo de cada imagen de tu sitio.

Línea extra: ¿Usas Claude? Conéctalo a tu negocio y pregúntale por tus ventas, tus
clientes o tus cobros directamente desde el chat.
Nota pequeña: Incluida en los planes de pago, con pedidos de IA cada mes según el plan
(o con tu propia clave).

Captura: `16-agentes-de-ia.png` · Videos: `motion/animaciones/ia-asistente.mp4`, `ia-agente.mp4`

---

## 12. Integraciones

**H2:** Conecta lo que ya usas
**Bajada:** Conéctalas una vez y úsalas en todas tus automatizaciones.

Logos en movimiento (marquee): WhatsApp Business · Telegram · Slack · Gmail · Google
Calendar · Google Sheets · Google Drive · Outlook · WordPress · WooCommerce · Rank Math ·
Yoast SEO · ACF · Twilio · Infobip · BulkGate · LabsMobile · Onurix · Mercado Pago · Wompi ·
SQL Server · Amazon S3 · Claude

Viñetas:
- **WhatsApp Business oficial** (API de Meta): plantillas aprobadas, respuestas de tus
  clientes y estado de cada envío.
- **Tu sitio WordPress** en tiempo real: entradas, páginas, campos personalizados, medios y
  SEO (ver el bloque siguiente).
- **SMS con tu propia cuenta**: Twilio, Infobip, BulkGate, LabsMobile u Onurix.
- **Tu base de datos SQL Server** sincronizada con una lista, cada hora o cada día.
- **¿Tu sistema no está?** Conéctalo con su API o con webhooks.

Captura: `14-integraciones.png` (arriba se ven las conexiones activas: SMS y WordPress)

---

## 12-A. Tu sitio WordPress (bloque destacado)

**H2:** Tu sitio WordPress, en una tabla que se edita
**Bajada:** Trae las entradas, páginas, tipos de contenido y el SEO de tu sitio. Edítalos
como en una hoja de cálculo y el cambio llega a WordPress en segundos.

Tres pasos en línea (con flecha entre cada uno):
1. **Escribe la dirección de tu sitio** y aprueba la conexión en tu propio WordPress. No
   copias ninguna clave. (`28-wordpress-conectar-un-clic.png` → `29-wordpress-autorizar-en-wordpress.png`)
2. **Elige qué traer**: entradas, páginas, tus tipos de contenido con sus campos, la
   biblioteca de medios y el SEO. Tú decides qué columnas se pueden cambiar desde aquí.
   (`30-wordpress-elegir-que-traer.png`)
3. **Edita aquí, se guarda allá.** Lo que cambies viaja a WordPress; lo que cambien en
   WordPress llega al instante. (`31-wordpress-pagina-del-sitio.png`)

Cuatro tarjetas:
1. **Auditoría SEO lista** — Con Rank Math, Yoast SEO, SEOPress o All in One SEO. Ve el
   título y la descripción tal como los muestra Google y encuentra en un clic los que pasan
   de 60 o 160 caracteres, los que no tienen descripción y los que no tienen palabra clave.
   (`32-wordpress-revision-seo.png`)
2. **La IA escribe lo que falta** — Meta descripciones y textos alternativos sugeridos para
   cada entrada e imagen. Los revisas, los aplicas en lote y, si no te convencen, lo
   deshaces. (`33-wordpress-sin-descripcion-sugerida-con-ia.png`,
   `34-wordpress-medios-texto-alternativo.png`)
3. **Tus campos personalizados, con su tipo** — Los campos de ACF, Meta Box y JetEngine
   llegan como columnas de número, fecha, opción o sí/no: se filtran, se ordenan y se
   suman. (`35-wordpress-recetas-campos-acf.png`)
4. **Siempre al día** — Si alguien agrega un campo o un tipo de contenido en WordPress, la
   app te avisa y lo traes con un clic. Lo que se borra allá se marca o sale de la lista,
   como prefieras. (`31-wordpress-pagina-del-sitio.png`)

Franja de confianza (íconos pequeños): Un complemento liviano · No carga nada en las páginas
de tus visitantes · Respeta los permisos de cada usuario de WordPress · Puedes conectarlo
con un usuario Editor · Sin el complemento también funciona con lo básico.
(`36-wordpress-complemento-en-el-sitio.png`)

Ideal para: agencias que administran los sitios de sus clientes, equipos de marketing y
empresas con un blog o un catálogo en WordPress.

Botón: Conectar mi sitio WordPress

---

## 12-B. Mensajes de texto (SMS)

**H2:** Mensajes de texto que llegan, con tu propia cuenta
**Bajada:** Para cuando un correo no se abre: recordatorios de pago, confirmaciones de cita
y avisos que se leen aunque el cliente no tenga internet.

Viñetas (con la captura `37-sms-desde-la-ficha.png` al lado):
- **Con el proveedor que elijas**: Twilio, Infobip, BulkGate, LabsMobile u Onurix. Usas tu
  cuenta y tu precio; la app no cobra por mensaje.
- **Cuenta lo que vas a pagar**: te dice cuántos SMS ocupa el mensaje y quita las tildes
  para que entre en uno en vez de dos.
- **Con los datos de cada cliente**: «Hola Panadería La Espiga, tu cobro de $1.610.000 vence
  mañana». Desde la ficha, a una selección o en una automatización.
  (`38-sms-envio-masivo.png`, `39-sms-automatizacion.png`)
- **Respeta el horario de la Ley 2300 («Dejen de fregar»)**: lo que caiga fuera de lunes a
  viernes de 7 a. m. a 7 p. m. o de sábados de 8 a. m. a 3 p. m. queda programado; nunca
  domingos ni festivos.
- **Sabes si llegó**: entregado o fallido en cada registro, y cuántos SMS pagaste en el mes.
  (`41-sms-pagina-de-la-conexion.png`)
- **También en la agenda**: recordatorios de citas por SMS, además del correo.

Nota pequeña: La app te ayuda a cumplir el horario; el contenido y la responsabilidad del
envío son de tu empresa.

---

## 13. En el celular

**H2:** Tu negocio en el bolsillo
- Instálala en el celular como una app, sin pasar por la tienda.
- Notificaciones cuando te mencionan, te asignan algo o vence un recordatorio.
- Escanea códigos QR y de barras para encontrar un producto o registrar una entrada.

Capturas: `capturas/celular/*.png` (mostrar 3 teléfonos en abanico: kanban, ficha, Mi trabajo)

---

## 14. Tu marca

**H2:** Con tu marca, en tu dominio
**Texto:** Pon tu logo, tus colores y tu propio dominio. Tus clientes ven tu marca en el
portal, los formularios, la agenda y los correos. Ideal para agencias y consultores que
implementan para sus clientes, y que además pueden administrar desde aquí el contenido y el
SEO de los sitios WordPress de esos clientes.

Demo: el portal cambiando de color al tocar muestras de color (`04-MOTION.md`, idea 10).
Video: `motion/animaciones/empresa-branding.mp4`

---

## 15. Hecho para Latinoamérica

**H2:** Hecho para cómo trabajamos aquí
Siete tarjetas:
1. **Precio por empresa, no por usuario.** Tu plan incluye a tu equipo; los clientes del
   portal no cuentan como usuarios.
2. **Pagas en pesos.** Con PSE, Nequi, tarjeta o efectivo, por meses o con renovación
   automática. **[CONFIRMAR medios activos]**
3. **Ley 1581 de datos personales.** Pide la autorización en tus formularios y portal, y
   guarda la prueba de cada aceptación con su versión.
4. **Tus datos son tuyos.** Si dejas de pagar, nada se borra: tu cuenta queda en solo
   lectura y exportas todo a Excel cuando quieras.
5. **Todo en español.** La app, la ayuda, los correos y el soporte.
6. **Días hábiles y festivos de Colombia.** En la agenda, los tiempos de soporte y los
   vencimientos.
7. **SMS con el horario de la Ley 2300.** Los mensajes de cobranza fuera de hora quedan
   programados solos, y puedes usar proveedores con presencia local como Onurix o
   LabsMobile.

---

## 16. Seguridad y tranquilidad

**H2:** Tu información, protegida
- Cada empresa con su información aislada de las demás.
- Verificación en dos pasos y control de los dispositivos conectados.
- Permisos por rol, por lista y por campo; equipos y roles a tu medida.
- Papelera de 30 días: lo que borras se puede recuperar.
- Copias de seguridad automáticas y registro de quién hizo qué.

---

## 17. Comparativa

**H2:** Lo que cambia para una pyme en Latinoamérica

> Tabla en HTML (no imagen). Solo afirmaciones verificables en las páginas públicas de cada
> producto; pon la fecha de verificación debajo.

| | **Imagina Base** | Excel / Sheets | Herramientas internacionales (Airtable, ClickUp, monday, HubSpot) |
|---|---|---|---|
| Idioma | Español neutro, de punta a punta | Español | Interfaz traducida; sitio y soporte a menudo en inglés |
| Moneda | Pesos colombianos (y dólares) | — | Dólares o euros |
| Cómo se cobra | Por empresa, con el equipo incluido | Licencia de Office / gratis | Por usuario, al mes |
| Medios de pago | PSE, Nequi, tarjeta, efectivo **[CONFIRMAR]** | — | Tarjeta internacional o PayPal |
| WhatsApp | API oficial de Meta, en automatizaciones | No | Integración aparte o de terceros |
| SMS | Con tu cuenta de Twilio, Infobip, BulkGate, LabsMobile u Onurix; horario de la Ley 2300 | No | Integración aparte o de terceros |
| Tu sitio WordPress | Entradas, páginas, campos y SEO editables en una tabla, en tiempo real | Exportar e importar a mano | Generalmente con plugins o apps de terceros |
| Cuentas de cobro y cotizaciones en PDF | Incluidas | Plantillas manuales | Generalmente con apps externas |
| Portal y agenda para tus clientes | Incluidos, sin usuario extra | No | Según plan o con apps aparte |
| Ley 1581 (autorización con prueba) | Incluida | No | No mencionada |
| Tus datos si dejas de pagar | Solo lectura + exportar todo | Tuyos | Depende de cada producto |

Pie: Información de las páginas públicas de cada producto a [mes y año]. Las marcas
pertenecen a sus dueños.

---

## 18. Precios (resumen)

**H2:** Precios simples, en pesos
**Bajada:** Un precio por empresa. Pruébala gratis 15 días y elige tu plan cuando estés
listo.

Franja arriba de los planes: **Prueba gratis de 15 días, sin tarjeta** — para conocerla
con hasta 500 registros, 3 personas y 3 automatizaciones. Botón: Probar gratis 15 días.

| Plan | Precio | Incluye |
|---|---|---|
| **Starter** | $59.000 COP / mes (US$15) | 10.000 registros · 10 personas · 20 automatizaciones · 1 GB · 1.000 correos/mes · Asistente IA (100 pedidos/mes) · Soporte en español |
| **Pro** | $199.000 COP / mes (US$49) | 200.000 registros · 50 personas · 200 automatizaciones · 10 GB · 10.000 correos/mes · Asistente IA (500 pedidos/mes) · Soporte en español |
| **Empresa** | A tu medida | Sin límites · acompañamiento |

(Los valores salen de Plataforma → Planes; si los cambias allá, cámbialos aquí.)

Debajo: Paga por meses (1, 3, 6 o 12) o con renovación automática. Con PSE, Nequi,
tarjeta o efectivo. Sin permanencia.
Botón: Ver precios completos (→ `/base/precios/`)

---

## 19. Aprende y soporte

**H2:** Nunca te quedas solo
- **Centro de aprendizaje**: guías paso a paso con animaciones de cada parte de la app.
- **Recorridos guiados** que te muestran dónde está cada cosa.
- **Ideas para tu negocio**: casos reales listos para activar.
- **Soporte en español** en los planes de pago. Durante la prueba te acompañan el centro
  de aprendizaje y los recorridos guiados.

Captura: `21-centro-de-aprendizaje.png`

---

## 20. Preguntas frecuentes

1. **¿Qué es Imagina Base?**
   Es una plataforma sin código para que las pymes de Latinoamérica organicen sus
   clientes, ventas, cobros, proyectos y soporte en un solo lugar, con automatizaciones,
   WhatsApp y portal para sus clientes.
2. **¿Es un CRM?**
   Puede serlo, y mucho más. Trae una plantilla de CRM lista, pero también puedes armar
   facturación, proyectos, inventario, agenda de citas o lo que tu negocio necesite.
3. **¿Necesito saber programar?**
   No. Subes tu Excel o eliges una plantilla y lo ajustas con clics.
4. **¿Puedo probarla gratis?**
   Sí: 15 días gratis, sin tarjeta de crédito. Al terminar eliges el plan que te sirva, y
   lo que armaste se queda.
5. **¿Cuánto cuesta?**
   Se cobra por empresa, no por usuario, y en pesos colombianos. Mira los planes en la
   página de precios.
6. **¿Cómo pago desde Colombia?**
   Con PSE, Nequi, tarjeta o efectivo a través de Mercado Pago, o en dólares con PayPal.
   Puedes pagar varios meses por adelantado o activar la renovación automática.
   **[CONFIRMAR]**
7. **¿Puedo importar mi Excel?**
   Sí, y es casi automático: subes tu .xlsx o .csv, la app reconoce las columnas y su tipo
   (montos, fechas, teléfonos, opciones), crea la lista y carga los registros. Después
   puedes actualizar registros existentes desde otro archivo.
8. **¿Se conecta con WhatsApp?**
   Sí, con la API oficial de WhatsApp Business: envía plantillas aprobadas desde la ficha
   o desde automatizaciones, y registra lo que te responden tus clientes.
9. **¿Hace factura electrónica?**
   No. Genera cotizaciones, cuentas de cobro y facturas en PDF, pero no reemplaza la
   factura electrónica de la DIAN.
10. **¿Mis clientes pueden pagarme desde la app?**
    Sí. Conecta tu cuenta de Mercado Pago o Wompi, genera links de pago y la app marca la
    factura como pagada cuando el pago entra. El dinero llega directo a tu cuenta.
11. **¿Funciona en el celular?**
    Sí. Se instala como una app en Android y iPhone, con notificaciones y escáner de
    códigos.
12. **¿Qué pasa con mis datos si dejo de pagar?**
    Nada se borra. Tu cuenta queda en solo lectura y puedes exportar toda tu información
    cuando quieras.
13. **¿Cumple la Ley 1581?**
    Te da las herramientas: autorización de tratamiento de datos en formularios y portal,
    con la prueba de cada aceptación y su versión. La responsabilidad del tratamiento sigue
    siendo de tu empresa.
14. **¿La inteligencia artificial está incluida?**
    Sí, en los planes de pago: el asistente que arma listas y tableros en español, los
    agentes y los campos con IA, con pedidos incluidos cada mes según el plan.
15. **¿Tienen soporte?**
    Sí, en español, para los planes de pago. Durante la prueba tienes el centro de
    aprendizaje, los recorridos guiados y las ideas listas para activar.
16. **¿Puedo enviar SMS desde la app?**
    Sí, con tu propia cuenta de Twilio, Infobip, BulkGate, LabsMobile u Onurix: desde la
    ficha de un cliente, a una selección de registros, en automatizaciones y en los
    recordatorios de la agenda. Cada SMS lo cobra tu proveedor; la app no suma un costo por
    mensaje.
17. **¿Los SMS de cobranza respetan la Ley 2300 («Dejen de fregar»)?**
    Puedes activar el horario de la ley en cada envío: lo que caiga fuera de lunes a viernes
    de 7 a. m. a 7 p. m. o de sábados de 8 a. m. a 3 p. m. queda programado, y nunca sale
    en domingos ni festivos. Confirma con tu abogado cómo aplica a tu caso.
18. **¿Se conecta con mi sitio WordPress?**
    Sí. Escribes la dirección del sitio, apruebas la conexión en tu WordPress y eliges qué
    traer: entradas, páginas, tipos de contenido, campos personalizados, medios y SEO. Lo
    que cambies en la app llega al sitio, y lo que cambien en el sitio llega a la app.
19. **¿El complemento pone lento mi sitio o lo hace inseguro?**
    No carga nada en las páginas que ven tus visitantes: solo le responde a la app, con los
    permisos del usuario de WordPress que conectaste (puede ser un Editor creado solo para
    esto). Sin el complemento también funciona con entradas, páginas, categorías y
    etiquetas.
20. **¿Qué plugins de SEO y de campos reconoce?**
    De SEO: Rank Math, Yoast SEO, SEOPress y All in One SEO. De campos: ACF, Meta Box y
    JetEngine.

---

## 21. Llamado final

**H2:** Tu negocio, organizado desde hoy
**Texto:** Pruébala gratis 15 días y arma tu primera lista en menos de cinco minutos.
**Botón:** Probar gratis 15 días
**Debajo:** Sin tarjeta · En español · Tus datos siempre tuyos
**Secundario:** ¿Vienes de Excel? Sube tu archivo y la app arma la lista sola.

---

## 22. Pie de página

- Imagina Base es parte de **Imagina** (imagina.cloud).
- Columnas: Producto · Soluciones · Recursos (Aprende, Blog, Plantillas) · Empresa
  (Contacto, Privacidad, Términos).
- Enlaces legales: las páginas públicas de la app ya existen en
  `https://base.imagina.cloud/api/v1/public/legal/privacidad` y `/terminos`; mejor
  replicarlas en el sitio (`/base/privacidad/`, `/base/terminos/`).
- Redes sociales y contacto **[CONFIRMAR]**.

---

## Microtextos útiles

- Botón flotante en el celular: «Prueba gratis»
- Etiqueta de captura: «Así se ve la app real, con datos de ejemplo»
- Al pasar sobre una vista: «Mismos datos, otra forma de verlos»
- Insignia en precios: «El más elegido» (en Starter) **[CUANDO EXISTA el dato]**
- Bajo la captura de WordPress: «Un sitio de ejemplo conectado a la app»
- Junto al contador de SMS: «Sin tildes: 1 SMS en vez de 2»
