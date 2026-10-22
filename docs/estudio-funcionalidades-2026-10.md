# Estudio de funcionalidades — Imagina Base frente a la competencia

> Octubre 2026 · versión de la app al momento del estudio: **v0.1.295**.
> Cada opción tiene un código (A1, B4, G8…) para que puedas responder
> simplemente «haz A1, B1 y C5».

---

## 1. Resumen en una página

**Dónde estamos.** Imagina Base ya cubre lo que la mayoría de las apps
parecidas venden como núcleo: listas con 22 tipos de campo, relaciones con
lookup/rollup, cuatro tipos de vista, tabla tipo hoja de cálculo,
automatizaciones con esperas, bucles y prueba paso a paso, formularios
públicos, portal del cliente diseñable, tableros con enlace público y envío
programado, documentos PDF numerados, cobros con Mercado Pago y Wompi,
WooCommerce y SQL Server, asistente de IA y servidor MCP. Además tiene cosas
que la competencia cobra aparte o no tiene: **portal del cliente completo,
white-label con dominio propio, español y formatos de Latinoamérica, cobros
locales e instalación propia con recuperación desde Drive.**

**Lo que más se nota que falta** (lo tienen casi todos los competidores):

1. **Fórmulas de verdad** (A1). El campo «Calculado» sólo sabe 8 operaciones.
   Airtable, Notion, ClickUp, Baserow, NocoDB, SmartSuite y Grist tienen un
   lenguaje de fórmulas completo.
2. **Papelera** para recuperar lo borrado (A2).
3. **Gantt con dependencias** y **calendario de semana/día con arrastrar**
   (B1, A8, B4).
4. **Equipos, roles personalizados e invitados externos** (C1, C2, C3).
5. **Aprobaciones** (C5) y **plantillas de registro con subtareas** (C6).
6. **API pública + webhooks + apps en n8n/Make/Zapier** (G1, G2).
7. **Exportar/importar Excel (.xlsx)** (G6) e **importadores desde
   Airtable/Notion/ClickUp** (G5).
8. **App instalable en el celular con notificaciones** (H1).

**Lo que más valor tendría para tus clientes de Latinoamérica:**
facturación electrónica DIAN vía proveedor (G8), firma electrónica de
cotizaciones (D6), agenda de citas pública (D5), WhatsApp oficial de Meta (D3),
**autorización de tratamiento de datos (Ley 1581)** en formularios y portal
(I10) y modo agencia para revender la plataforma (I3).

**Propuesta de orden** (sección 6): seis oleadas de ~4 entregas cada una,
empezando por lo que los usuarios notan a diario (papelera, autonumérico,
campos de sistema, valores por defecto, Excel, botón, consentimiento de datos).

---

## 2. Qué se comparó

| Tipo | Apps revisadas |
|---|---|
| Bases de datos no-code (premium) | Airtable, SmartSuite, Smartsheet, Fibery, Coda |
| Gestión de trabajo | ClickUp, monday.com, Notion, Asana |
| CRM | HubSpot, Pipedrive, Attio, Kommo (fuerte en WhatsApp y LatAm), Zoho |
| Código abierto | NocoDB, Baserow, Teable, Grist, NocoBase, Twenty CRM, Odoo |

### Hacia dónde se movió el mercado en 2025-2026

- **Agentes de IA que hacen trabajo, no sólo responden.** Airtable reemplazó
  los campos con IA por *Field Agents* y lanzó *Superagent*; ClickUp lanzó
  *Brain2* y *Super Agents* (se asignan a tareas y se mencionan en
  comentarios); monday lanzó *agents* y *Sidekick*; Notion tiene agentes y
  *External Agents*; Baserow 2.0 trae el asistente *Kuma*.
- **Apps desde una descripción.** Airtable *Omni*, monday *Vibe* (más de
  17.000 apps creadas) y ClickUp Brain2 arman tablas, automatizaciones e
  interfaces a partir de un pedido en lenguaje natural.
- **MCP en todos lados.** NocoDB, monday y Notion abrieron servidores MCP.
  Imagina Base ya lo tiene, con OAuth para conectar desde claude.ai.
- **Sincronizar datos entre bases y con fuentes externas.** NocoDB *Sync*
  (una vista de una base como tabla en otra), Airtable *HyperDB* (hasta 100
  millones de filas conectadas a Snowflake/Databricks/Salesforce).
- **Código dentro de la plataforma.** NocoDB y Airtable permiten scripts en
  JavaScript.
- **Gantt con línea base** (ClickUp 4.04, mayo 2026) y **aprobaciones desde
  Slack** (SmartSuite, agosto 2026).
- **IA cobrada por créditos** (monday desde mayo 2026), un modelo parecido a
  la cuota de IA por plan que ya tiene Imagina Base.
- **WhatsApp**: Meta cobra por plantilla entregada desde julio 2025 y, según
  varias fuentes, desde el 1 de octubre de 2026 también cobra los mensajes de
  servicio dentro de la ventana de 24 h. Conviene confirmarlo en la tabla
  oficial de Meta antes de presupuestar.

---

## 3. Lo que ya tienes y conviene cuidar

Antes de sumar, vale tener claro qué ya diferencia a la app:

- **Portal del cliente** diseñable con pagos, documentos, contraseña, varias
  cuentas por persona y marca propia. En Airtable eso exige otra herramienta
  de pago (Softr, Stacker).
- **Documentos PDF** con numeración, congelado al emitir, cotización y factura
  con IVA. **Cobros** con Mercado Pago y Wompi, y cobro de planes con
  renovación automática.
- **WooCommerce como espejo** con edición en lote y deshacer, **SQL Server**
  sincronizado y **conectores** con OAuth.
- **White-label completo**: logo, colores, dominio del equipo y del portal,
  correo por SMTP propio o por la cuenta de Google/Microsoft de la empresa.
- **IA**: asistente que propone y aplica, campos con IA, MCP con OAuth.
- **Instalación propia** en un comando, con copias cifradas en Drive y
  recuperación de un servidor nuevo con unos clics.
- **Pensada para Latinoamérica**: formato de números y fechas, zona horaria
  por empresa, pesos y números en letras en los PDF.

---

## 4. Opciones por área

**Escala de esfuerzo**

| Código | Tamaño | Equivale a |
|---|---|---|
| S | Chica | Parte de una entrega |
| M | Mediana | Una entrega completa, con servidor, interfaz y pruebas |
| L | Grande | Dos entregas |
| XL | Muy grande | Tres o más, es un módulo nuevo |

**Valor**: alto, medio o bajo, pensando en tus clientes (pymes de
Latinoamérica, agencias, facturación, soporte, ventas y tiendas).

### A. Datos y campos

**A1 · Fórmulas de verdad** — Valor **alto** · Esfuerzo **L**
- Un campo «Fórmula» con lenguaje propio:
  - Lógica: `SI`, `Y`, `O`, `SWITCH`.
  - Texto: `CONCATENAR`, `MAYUSC`, `EXTRAER`, `REGEX`.
  - Números: `REDONDEAR`, `MAX`, `MIN`.
  - Fechas: `HOY`, `DIAS_ENTRE`, `SUMAR_DIAS_HABILES`, `FORMATO_FECHA`.
  - Referencias a campos por nombre: `{Precio} * {Cantidad}`.
- El editor autocompleta funciones y campos, y dice dónde está el error.
- Se compila a SQL cuando se puede, así la fórmula filtra, ordena y se suma
  en el pie y en los tableros.
- El mismo evaluador corre en la interfaz y en el servidor, sin `eval`.
- Lo tienen: Airtable, Notion, ClickUp, Baserow, NocoDB, SmartSuite y Grist
  (este último con Python).
- Hoy: el campo «Calculado» tiene 8 operaciones fijas. Es la brecha funcional
  más grande frente a todos.

**A2 · Papelera** — Valor **alto** · Esfuerzo **M**
- Registros, listas, campos, vistas, automatizaciones y tableros borrados van
  a una Papelera.
- Se restauran con sus vínculos, archivos y comentarios durante 30 días (la
  cantidad de días puede depender del plan), y se puede vaciar.
- Lo tienen todos.
- Hoy: los registros se borran de forma lógica y el borrado en lote se puede
  deshacer, pero no hay dónde recuperar un borrado suelto ni una lista o un
  campo.

**A3 · Autonumérico / ID legible** — Valor **alto** · Esfuerzo **S**
- `TCK-0001`, `PED-2026-0042`: prefijo, dígitos y reinicio por año opcional.
- Atómico, con el mismo mecanismo que la numeración de documentos.
- Lo tienen: Airtable, ClickUp (IDs personalizados), SmartSuite, Baserow.
- Muy pedido en soporte, pedidos y radicados.

**A4 · Campos de sistema como columnas** — Valor **medio** · Esfuerzo **S**
- Creado por, fecha de creación, última modificación, modificado por, último
  comentario.
- Visibles, filtrables y ordenables como cualquier campo.
- Lo tienen: Airtable, Notion, Baserow.

**A5 · Campo Botón** — Valor **alto** · Esfuerzo **M**
- Un botón en la tabla y en la ficha que puede:
  - abrir un enlace armado con variables (WhatsApp con el mensaje listo, un
    mapa, otra app);
  - correr una automatización (disparador nuevo «Al presionar el botón»);
  - generar un PDF, o cambiar un campo («Marcar como pagado»).
- Lo tienen: Airtable, Notion, ClickUp, SmartSuite.

**A6 · Valores por defecto y validaciones** — Valor **alto** · Esfuerzo **M**
- Valor por defecto: fijo, hoy, «yo», o la primera opción.
- Reglas: mínimo y máximo, largo, expresión regular (por ejemplo, NIT o placa).
- Obligatorio sólo si otro campo tiene cierto valor.
- «Sin repetidos» combinado entre dos campos.
- Lo tienen: SmartSuite, Zoho Creator, NocoBase, y en parte Baserow.

**A7 · Campos condicionales en la ficha y en el alta** — Valor **medio** · Esfuerzo **M**
- Mostrar «NIT» sólo si «Tipo = Empresa».
- Los formularios públicos ya tienen condiciones; falta llevarlas a la ficha y
  al alta del equipo.
- Lo tienen: SmartSuite, Zoho, ClickUp.

**A8 · Dependencias entre registros** — Valor **alto** · Esfuerzo **M**
- Relaciones «bloquea» y «bloqueado por», con aviso al cerrar algo que tiene
  pendientes y reprogramación opcional de lo que depende.
- Es la base del Gantt (B1).
- Lo tienen: ClickUp, monday, SmartSuite, Asana, Jira.

**A9 · Checklist dentro del registro** — Valor **medio-alto** · Esfuerzo **M**
- Pasos con casilla, responsable y fecha por ítem, progreso en %, y plantillas
  de checklist.
- Se puede disparar «cuando se completa el checklist».
- Lo tienen: ClickUp, Trello, SmartSuite.

**A10 · Campo Firma** — Valor **medio** · Esfuerzo **S-M**
- Dibujar la firma en la ficha, en un formulario o en el portal.
- Guarda la imagen, la fecha, la IP y quién firmó.
- Lo tienen: SmartSuite y Jotform.
- Ver también D6 (firmar documentos).

**A11 · Ubicación / dirección** — Valor **medio** · Esfuerzo **M**
- Autocompletado de direcciones, latitud y longitud, y enlace a Google Maps.
- Es la base de la vista Mapa (B3).
- Necesita un proveedor de mapas: OpenStreetMap gratis, o Google con la clave
  de cada empresa.

**A12 · Código de barras / QR** — Valor **medio** · Esfuerzo **S**
- Un campo que muestra el código y se puede imprimir.
- Con H3, se escanea con la cámara para buscar o llenar un registro.
- Lo tienen: Airtable y Zoho.

**A13 · Moneda múltiple con conversión** — Valor **medio** · Esfuerzo **M**
- Montos en USD, COP o MXN con tasa del día y el total en la moneda de la
  empresa.
- Lo tienen: Odoo, HubSpot, Pipedrive.

**A14 · Duplicados: detectar y fusionar** — Valor **alto (CRM)** · Esfuerzo **M-L**
- Avisa al crear si ya existe alguien con ese email, teléfono, NIT o un nombre
  parecido.
- Herramienta «Fusionar» que junta dos registros y mueve vínculos,
  comentarios, archivos e historial.
- Lo tienen: HubSpot, Attio, Pipedrive, Zoho.

**A15 · Etiquetas compartidas entre listas** — Valor **medio** · Esfuerzo **S-M**
- Un catálogo de opciones reutilizable: las mismas etiquetas o estados en
  varias listas, editables en un solo lugar.
- Lo tienen: ClickUp y Notion.

**A16 · Punto de restauración de una lista** — Valor **medio** · Esfuerzo **M**
- «Volver esta lista a como estaba ayer a las 9», por ejemplo después de una
  importación que salió mal.
- Lo tiene Airtable (snapshots).
- Hoy existen las copias del servidor completo y las de una empresa, pero no
  una por lista que se use sola.

### B. Vistas

**B1 · Gantt / línea de tiempo** — Valor **alto** · Esfuerzo **L**
- Barras con fecha de inicio y fin; se arrastran para mover y se estiran para
  cambiar la duración.
- Flechas de dependencia (A8) con reprogramación automática, hitos, línea
  base, agrupar por persona o estado, y zoom de día, semana o mes.
- Exportar a PDF.
- Lo tienen: ClickUp, monday, SmartSuite, Notion (timeline) y Airtable
  (timeline).

**B2 · Carga de trabajo** — Valor **medio-alto** · Esfuerzo **M-L**
- Por persona y por semana: horas estimadas o cantidad de registros frente a
  su capacidad, con alerta en rojo.
- Se arrastra para reasignar. Usa el registro de tiempo que ya existe.
- Lo tienen: ClickUp, monday, Asana, Smartsheet.

**B3 · Mapa** — Valor **medio** · Esfuerzo **M**
- Los registros como pines con color por estado; un clic abre la ficha.
- Sirve para visitas, instalaciones, inmobiliarias y rutas.
- Lo tienen: Airtable, SmartSuite, ClickUp. Necesita A11.

**B4 · Calendario completo** — Valor **alto** · Esfuerzo **M**
- Vistas de semana, día y agenda.
- Arrastrar para reprogramar y estirar la duración (inicio y fin).
- Clic en un hueco para crear, colores por regla y varios campos de fecha.
- Hoy: sólo vista de mes y sin arrastrar.

**B5 · Kanban para ventas** — Valor **alto** · Esfuerzo **M**
- Carriles por un segundo campo, por ejemplo por vendedor.
- Totales por columna: la suma de montos del embudo.
- Límite de tarjetas por columna.
- Reglas al mover: pedir «Motivo de pérdida» al pasar a «Perdido».
- Tarjetas con los campos elegidos.
- Lo tienen: Pipedrive, Kommo, monday, ClickUp.

**B6 · Árbol y mapa mental** — Valor **bajo-medio** · Esfuerzo **M**
- Subtareas y relaciones dibujadas como árbol.
- Lo tienen: ClickUp y Fibery.

**B7 · Vista de lista compacta** — Valor **medio** · Esfuerzo **S-M**
- Registros como renglones con casilla de «completar», agrupados, para quien
  usa la app como gestor de tareas y no como base de datos.
- Lo tienen: ClickUp (List) y Todoist.

**B8 · Interfaces o páginas de app** — Valor **alto** · Esfuerzo **XL**
- Armar pantallas para un rol (por ejemplo «Mesa de ayuda» o «Bodega») con
  bloques: lista filtrada, ficha, botones, gráficos y formularios. Quien las
  usa no ve las tablas.
- Lo tienen: Airtable Interfaces, Baserow Application Builder y Softr.
- El editor de la ficha (v3) y el de tableros ya son media base.
- Es grande, y sólo vale la pena si hay clientes con equipos operativos que se
  pierden en la tabla.

### C. Trabajo en equipo

**C1 · Equipos** — Valor **alto** · Esfuerzo **M-L**
- Grupos como «Ventas» o «Soporte».
- Asignar un registro a un equipo, mencionar a @equipo, dar permisos de una
  lista a un equipo y ver la carga por equipo.
- Lo tienen: ClickUp, monday, Airtable y Notion.
- Hoy: los permisos son por rol del workspace o por persona.

**C2 · Roles personalizados** — Valor **alto** · Esfuerzo **M**
- Crear roles además de admin, manager, agent y viewer.
- Permisos por módulo: ver tableros, crear automatizaciones, exportar,
  importar, ver Ajustes, usar la IA, etc.
- Lo tienen: ClickUp Enterprise, monday, Odoo y NocoBase.

**C3 · Invitados externos** — Valor **alto** · Esfuerzo **M**
- Compartir UNA lista o UN registro con un proveedor, un freelancer o un
  contador, sin que vea el resto y sin que ocupe un usuario del plan.
- Lo tienen: ClickUp, Notion, Airtable.
- El portal sirve para clientes finales; esto es para colaboradores que
  trabajan sobre la tabla.

**C4 · Campos de sólo lectura por rol** — Valor **medio** · Esfuerzo **S-M**
- Hoy un campo es oculto o editable para cada rol; falta «lo ve pero no lo
  cambia» (por ejemplo, el vendedor ve el descuento aprobado pero no lo
  toca).
- Lo tienen: Airtable y SmartSuite.

**C5 · Aprobaciones** — Valor **alto** · Esfuerzo **M-L**
- Pedir la aprobación de un registro (gasto, descuento, cotización,
  vacaciones, compra) a una o varias personas, en serie o en paralelo.
- Se puede aprobar, rechazar o devolver con motivo, desde la ficha, el correo
  o «Mi trabajo».
- Paso «Esperar aprobación» en automatizaciones y bitácora de quién aprobó.
- Lo tienen: monday, Smartsheet, NocoBase, ClickUp y Kissflow.
- Muy pedido en empresas medianas.

**C6 · Plantillas de registro** — Valor **alto** · Esfuerzo **M**
- «Nuevo cliente» crea el registro con sus valores y 8 subtareas de
  incorporación, cada una con responsable y fecha relativa.
- Se usan desde el alta, desde una automatización o desde un formulario.
- Lo tienen: ClickUp, Asana y monday.

**C7 · Documentos / wiki del workspace** — Valor **medio-alto** · Esfuerzo **L**
- Páginas con el mismo editor de la descripción, en jerarquía, con menciones
  a registros y vistas de una lista embebidas en vivo.
- Con permisos, y publicables como página pública (base de conocimiento,
  manual del cliente).
- Lo tienen: Notion, ClickUp Docs y Coda.

**C8 · Revisión sobre archivos (proofing)** — Valor **medio (agencias)** · Esfuerzo **M**
- Comentar sobre un punto de una imagen o de una página de PDF, con hilos y
  «aprobado/cambios».
- También desde el portal (el cliente aprueba la pieza).
- Lo tienen: ClickUp, Smartsheet y Filestage.

**C9 · Sprints** — Valor **bajo-medio** · Esfuerzo **M**
- Sprints, puntos, gráfico de avance (burndown) y pasar lo pendiente al
  siguiente sprint.
- Lo tienen: ClickUp, Jira y Linear. Es un nicho de desarrollo de software.

**C10 · Metas** — Valor **medio** · Esfuerzo **M**
- Metas con avance automático desde los registros (ventas del trimestre
  contra la meta), responsables y seguimiento.
- Lo tienen: ClickUp Goals y monday.
- Hoy existe la plantilla OKR, pero no un módulo de metas.

### D. Clientes y canales

**D1 · El correo de cada registro** — Valor **alto (CRM)** · Esfuerzo **L**
- Cada persona conecta su Gmail u Outlook (el OAuth ya existe); los correos
  intercambiados con un contacto aparecen en su ficha.
- Se responde desde la ficha, con plantillas.
- Disparador «Cuando llega un correo de un contacto».
- Por privacidad: opt-in por persona y sólo los hilos con contactos de la
  lista.
- Lo tienen: Twenty, Attio, HubSpot y Pipedrive.

**D2 · Mesa de ayuda por correo** — Valor **alto (soporte)** · Esfuerzo **L**
- Una dirección por lista (soporte@tuempresa reenvía ahí): cada correo nuevo
  crea un ticket y las respuestas se suman como comentarios.
- Se contesta desde la ficha y sale por el correo de la empresa.
- Con SLA (E5) y encuesta (D8) se completa un helpdesk.
- Lo tienen: Zendesk, Freshdesk, HubSpot y ClickUp (correo a tarea).

**D3 · WhatsApp oficial (Meta Cloud API)** — Valor **alto en LatAm** · Esfuerzo **L**
- Plantillas aprobadas por Meta con botones.
- Disparador «Cuando llega un mensaje», que puede crear o actualizar un
  registro.
- Atendiendo tu preocupación de no convertir la app en un chat:
  - no se guarda la conversación completa, sólo el último mensaje, el estado y
    un resumen opcional hecho con IA;
  - la conversación sigue viviendo en WhatsApp.
- Lo tienen: Kommo, Respond.io y HubSpot.
- Hoy existe el envío por WAS/Zender, que no es la API oficial: no tiene
  plantillas aprobadas ni respaldo de Meta.

**D4 · SMS** — Valor **medio** · Esfuerzo **S**
- Acción «Enviar SMS» con Twilio, Infobip o un proveedor local.

**D5 · Agenda de citas pública** — Valor **alto (servicios)** · Esfuerzo **L**
- Un enlace estilo Calendly con la disponibilidad por persona o recurso.
- La reserva crea el registro y confirma por correo o WhatsApp.
- Recordatorio, reprogramar y cancelar desde el mismo enlace.
- Consulta los horarios ocupados en Google Calendar.
- Lo tienen: Calendly, HubSpot Meetings, Zoho Bookings y Odoo.
- Sirve a clínicas, consultorios, asesorías y talleres.

**D6 · Firma electrónica de documentos** — Valor **alto** · Esfuerzo **M-L**
- La cotización o el contrato (los PDF que ya genera la app) se envía para
  firmar desde un enlace o el portal.
- Queda la trazabilidad: IP, fecha, hash del documento y sello en el PDF.
- Al firmar cambia el estado del registro («Aceptada») y puede seguir la
  factura.
- Lo tienen: PandaDoc, DocuSign, Odoo Sign y HubSpot Quotes.
- En Colombia la firma electrónica simple es válida para la mayoría de los
  contratos comerciales (Ley 527 de 1999 y Decreto 2364 de 2012); no es firma
  digital certificada.

**D7 · Chat para el sitio web** — Valor **medio** · Esfuerzo **M-L**
- Un widget que crea el lead y avisa al equipo.
- Tiene el mismo cuidado que WhatsApp: guardar sólo lo necesario.

**D8 · Encuesta NPS / satisfacción de un clic** — Valor **medio** · Esfuerzo **S-M**
- Al cerrar un ticket se envía «¿Cómo te atendimos?» con caritas o números;
  el clic guarda la nota en el registro.

**D9 · Seguimientos 1 a 1 desde una vista** — Valor **medio** · Esfuerzo **M**
- Correos personalizados a una lista filtrada, de a uno y con tope, para
  hacer seguimientos.
- **Riesgo:** choca con ADR-S18 (que la app no se use para envíos masivos).
  Sólo con el correo propio de la empresa y con límites. La alternativa
  segura es sincronizar una vista con Mailchimp, Brevo o MailerLite.

### E. Automatizaciones

**E1 · Disparadores nuevos** — Valor **alto** · Esfuerzo **M**
- «Cuando un registro empieza a cumplir una condición» (entra a una vista).
- «Cuando se agrega un comentario».
- «Al presionar un botón» (A5).
- «Cuando llega un correo» (D2).
- «Cuando se aprueba o rechaza» (C5).
- «Cuando se sube un archivo».

**E2 · Acciones nuevas** — Valor **alto** · Esfuerzo **M-L**
- «Buscar registros» y usar el resultado (con el bucle que ya existe).
- «Crear o actualizar» por una clave.
- «Asignar por turno» (round-robin o por carga).
- «Notificar en la app».
- «Crear subtareas desde una plantilla» (C6).
- «Copiar a otra lista».
- «Pedir aprobación» (C5).
- «Preguntarle a la IA»: un texto con variables que devuelve texto o datos
  para los pasos siguientes.

**E3 · Varias ramas y manejo de errores** — Valor **medio** · Esfuerzo **M**
- «Según el valor de…» con N ramas (hoy sólo hay sí/no).
- Subflujos reutilizables.
- Por paso: continuar, reintentar o detenerse si falla.
- Reintento automático de webhooks que fallaron.
- Lo tienen: n8n y Make.

**E4 · Scripts** — Valor **medio-bajo** · Esfuerzo **L**
- JavaScript aislado, con tiempo y memoria limitados, para los casos que no
  cubren las acciones.
- Lo tienen: Airtable y NocoDB.
- Riesgo de seguridad: necesita un sandbox serio (isolated-vm o QuickJS).

**E5 · SLA y escalamiento** — Valor **medio-alto (soporte)** · Esfuerzo **M**
- Tiempo de primera respuesta y de resolución según la prioridad, con reloj
  que se pausa «esperando al cliente».
- Avisa antes de vencer y escala al jefe.
- Días hábiles y festivos por país (G15).

**E6 · Agentes de IA** — Valor **alto (tendencia)** · Esfuerzo **L-XL**
- Un agente con un nombre y una tarea («Clasifica los tickets nuevos y deja un
  borrador de respuesta»), que corre en un disparador con herramientas
  limitadas.
- Deja cada paso en la Actividad y, si lo eliges, pide aprobación antes de
  cambiar algo.
- La base ya existe: el registro de herramientas y el modelo
  «propone → aplica» del asistente.
- Lo tienen: ClickUp Super Agents, monday agents, Airtable Field Agents y
  Notion agents.

**E7 · «Describe la automatización y la armo» dentro del editor** — Valor **medio** · Esfuerzo **S**
- El asistente ya sabe crearlas; falta la entrada directa desde el editor
  vacío.

### F. Inteligencia artificial

**F1 · Resumen del registro** — Valor **medio-alto** · Esfuerzo **S**
- Botón «¿Qué pasó con este cliente?»: resume la actividad, los comentarios y
  los vinculados.

**F2 · IA al escribir** — Valor **medio** · Esfuerzo **S-M**
- En la descripción (comando /ia: escribir, resumir, traducir, cambiar el
  tono).
- En comentarios y correos: sugerir una respuesta.

**F3 · De documento a registro** — Valor **alto** · Esfuerzo **M**
- Subes o reenvías por correo una factura, un RUT, una cédula o una orden de
  compra; la IA extrae los datos y crea o actualiza el registro, con una
  pantalla de revisión antes de guardar.
- Los campos con IA ya leen PDF; falta el flujo de entrada completo.

**F4 · Preguntas sobre los datos en el tablero** — Valor **medio** · Esfuerzo **M**
- «Ventas por ciudad del último trimestre» crea el widget.

**F5 · Notas de voz a texto** — Valor **medio** · Esfuerzo **M**
- Grabar un audio desde el celular en un comentario o un registro y obtener
  la transcripción.

**F6 · Búsqueda por significado** — Valor **medio** · Esfuerzo **L**
- Encontrar «clientes molestos por demoras» aunque no usen esas palabras.
- Necesita embeddings y pgvector.

**F7 · «Describe tu negocio» al empezar** — Valor **alto (activación)** · Esfuerzo **M**
- En el primer uso, una propuesta completa: listas, tableros,
  automatizaciones, portal y formularios.
- Las piezas ya existen en el asistente; falta el flujo guiado de bienvenida.

### G. Integraciones y ecosistema

**G1 · API pública REST + webhooks de eventos** — Valor **alto** · Esfuerzo **M-L**
- Documentada con OpenAPI y tokens con permisos (los mismos tokens del MCP,
  con alcance).
- Límites por plan.
- Suscripciones a eventos (registro creado, cambiado o borrado; formulario
  enviado; pago recibido).
- Habilita todo lo demás de esta sección.
- Hoy: el MCP usa tokens, pero la API REST sólo acepta la sesión del
  navegador.

**G2 · Apps oficiales en n8n, Make y Zapier** — Valor **alto (alcance)** · Esfuerzo **M por plataforma**
- Disparadores y acciones de Imagina Base en esos catálogos: miles de apps
  conectadas sin programar.
- Requiere G1.

**G3 · Google Sheets sincronizado en los dos sentidos** — Valor **alto** · Esfuerzo **M-L**
- Una hoja conectada con una lista.
- En Latinoamérica muchísimos negocios viven en Sheets: es una puerta de
  entrada.

**G4 · Google Calendar / Outlook sincronizado** — Valor **medio-alto** · Esfuerzo **M**
- Los registros con fecha aparecen en el calendario de su responsable, y si
  se cambia la hora en el calendario, también cambia en la app.

**G5 · Importadores** — Valor **alto (captar clientes)** · Esfuerzo **M cada uno**
- Excel con varias hojas.
- Airtable: la base completa con vínculos.
- Notion, ClickUp, Trello y monday.
- Un importador bueno es el argumento para que alguien se cambie.

**G6 · Exportar a Excel (.xlsx)** — Valor **medio-alto** · Esfuerzo **S**
- Con formato de números y fechas, una hoja por vista o por lista
  relacionada.
- Hoy: sólo CSV y JSON.

**G7 · PostgreSQL y MySQL** — Valor **medio** · Esfuerzo **M**
- La misma sincronización que SQL Server, para otros motores.

**G8 · Facturación electrónica** — Valor **alto en Colombia** · Esfuerzo **L, y M por país**
- DIAN vía un proveedor tecnológico autorizado: Factus, Alegra, Siigo, The
  Factory HKA, Facture u otro.
- Factura y nota crédito desde la ficha, con los ítems que ya existen.
- Vuelven el CUFE, el XML y el PDF validado, y queda el estado.
- Después: CFDI en México (Facturama), SUNAT en Perú, SRI en Ecuador y SII en
  Chile.
- La app no se habilita ante la DIAN: integra a quien ya lo está.

**G9 · Contabilidad** — Valor **medio-alto** · Esfuerzo **M cada una**
- Enviar terceros, facturas y pagos a Siigo, Alegra, World Office, QuickBooks
  o Xero.

**G10 · Más pasarelas de pago** — Valor **medio** · Esfuerzo **S-M cada una**
- ePayco, PayU, Bold, Stripe (fuera de Colombia) y Nequi directo, además de
  Mercado Pago y Wompi.

**G11 · Más tiendas** — Valor **alto (comercio)** · Esfuerzo **L cada una**
- **Mercado Libre** (pedidos, preguntas, stock: es el marketplace de
  Latinoamérica), Shopify y Tiendanube.
- Se reusa el motor de sincronización de WooCommerce.

**G12 · Avisos a Teams, Google Chat y Discord** — Valor **bajo-medio** · Esfuerzo **S cada uno**
- Slack ya existe.

**G13 · OneDrive / SharePoint y Dropbox como almacenamiento** — Valor **medio** · Esfuerzo **M**
- S3 y Google Drive ya existen.

**G14 · Enriquecimiento y validación** — Valor **bajo-medio** · Esfuerzo **M**
- Datos de la empresa por dominio, y validación de que el email existe.

**G15 · Días hábiles y festivos por país** — Valor **medio** · Esfuerzo **S**
- «Sumar 5 días hábiles», vencimientos y SLA que no cuentan festivos de
  Colombia, México, etc.

### H. Celular

**H1 · App instalable (PWA) + notificaciones push** — Valor **alto** · Esfuerzo **M**
- Ícono en el celular, pantalla completa y apertura rápida.
- Avisos de la campana como notificación del teléfono o del navegador.

**H2 · Sin conexión** — Valor **medio-alto (terreno)** · Esfuerzo **L**
- Ver lo último y capturar registros y fotos sin señal; se sincroniza al
  volver.

**H3 · Escáner de código de barras / QR** — Valor **medio-alto** · Esfuerzo **M**
- Buscar o crear con la cámara: inventario, activos, entradas a eventos con
  QR.

**H4 · Foto y ubicación al cargar** — Valor **medio** · Esfuerzo **S-M**
- Evidencia con foto y GPS en visitas e instalaciones.

**H5 · Apps nativas (iOS/Android)** — Valor **medio** · Esfuerzo **XL**
- Recién después de la PWA, si los clientes lo piden.

### I. Plataforma, administración y negocio

**I1 · La interfaz en inglés y portugués** — Valor **alto (crecer)** · Esfuerzo **L**
- Brasil es el mercado más grande de Latinoamérica.
- La pieza de traducción ya existe (`lib/i18n.ts`); hoy sólo devuelve el
  español. Hay que extraer los textos y traducirlos, y el correo, el portal y
  los PDF también.

**I2 · Inicio de sesión corporativo (SSO) y SCIM** — Valor **medio** · Esfuerzo **M**
- Google Workspace, Microsoft Entra, SAML y OIDC.
- Altas y bajas automáticas desde el directorio de la empresa.

**I3 · Modo agencia / revendedor** — Valor **alto (tu negocio)** · Esfuerzo **L**
- Un socio administra varias empresas cliente con su marca, sus propias
  plantillas y su propio cobro, como en GoHighLevel.
- Encaja con agencias como Imagina, que venden la herramienta a sus
  clientes.

**I4 · Cobro por usuario y complementos** — Valor **medio** · Esfuerzo **M**
- Planes por asiento y paquetes extra (más IA, más correos, más
  almacenamiento).

**I5 · Cupones, pruebas gratis y referidos** — Valor **medio** · Esfuerzo **M**

**I6 · Copia automática de cada empresa a SU Drive o S3** — Valor **medio** · Esfuerzo **S-M**
- Un export programado de sus propios datos, para su tranquilidad (ADR-S09).

**I7 · Ayuda dentro de la app** — Valor **medio-alto (activación)** · Esfuerzo **M**
- Recorridos guiados, una lista de «primeros pasos», ayuda en cada pantalla y
  un centro de ayuda.

**I8 · Métricas de uso para el operador** — Valor **medio** · Esfuerzo **M**
- Qué empresas usan qué, cuáles están activas y cuáles están por irse.

**I9 · Avisos de plataforma** — Valor **bajo-medio** · Esfuerzo **S**
- Una franja «Mantenimiento el domingo a las 2 am» y una página de estado.

**I10 · Autorización de tratamiento de datos (Ley 1581)** — Valor **alto (legal en Colombia)** · Esfuerzo **S-M**
- Casilla de autorización con el texto de la empresa en formularios, portal y
  agenda.
- Registro del consentimiento: quién, cuándo, qué texto y desde qué IP.
- Revocar la autorización y responder solicitudes de consulta o borrado.
- Es una obligación legal cuando se recolectan datos personales en Colombia
  (y hay leyes parecidas en México, Perú, Chile y Brasil).

### J. Reportes

**J1 · Informes armados** — Valor **medio** · Esfuerzo **M**
- Un documento con texto, tablas y gráficos de varias listas, exportable a
  PDF o Excel y programable por correo.

**J2 · Comparar períodos en cualquier gráfico** — Valor **medio** · Esfuerzo **S-M**
- Contra el mes anterior y contra el mismo mes del año pasado.

**J3 · Pronóstico de ventas** — Valor **medio (ventas)** · Esfuerzo **S-M**
- Embudo ponderado por la probabilidad de cada etapa.
- Lo tienen: Pipedrive y HubSpot.

---

## 5. Paquetes por tipo de negocio

Algunas opciones juntas forman una solución completa que se puede vender por
sí sola (con su plantilla):

| Paquete | Opciones | Para quién |
|---|---|---|
| **Mesa de ayuda** | D2 + E5 + D8 + A3 + portal | Soporte técnico, servicio al cliente |
| **CRM de ventas** | B5 + A14 + D1 + D6 + J3 + D3 | Equipos comerciales |
| **Facturación y cobranza** | G8 + G9 + D6 + lo que ya existe | Empresas de servicios y suscripción |
| **Servicios con citas** | D5 + D3 + I10 + portal | Clínicas, consultorios, asesorías |
| **Inventario y activos** | H3 + A12 + B3 + H4 | Bodegas, TI, alquiler de equipos |
| **Agencias** | C8 + B2 + C6 + portal + registro de tiempo | Agencias de marketing, diseño y desarrollo |
| **Talento humano** | C5 + C6 + A9 + C3 | Vacaciones, permisos, incorporación |
| **Proyectos** | B1 + A8 + B2 + C10 | Constructoras, consultoras, eventos |

---

## 6. Propuesta de orden (oleadas)

Cada oleada son unas 4 entregas, con el mismo ritual de siempre.

**Oleada 1 · Lo básico que se nota a diario**
- A2 Papelera.
- A3 Autonumérico + A4 Campos de sistema + A6 Valores por defecto y
  validaciones (una entrega).
- G6 Exportar a Excel + importar Excel con varias hojas.
- I10 Autorización de tratamiento de datos.
- A5 Botón (con el disparador «Al presionar»).

**Oleada 2 · Planificar**
- A1 Fórmulas.
- A8 Dependencias + B1 Gantt.
- B4 Calendario completo.
- B5 Kanban para ventas.

**Oleada 3 · Equipos y procesos**
- C1 Equipos + C2 Roles personalizados + C3 Invitados.
- C5 Aprobaciones (+ E1/E2 sus disparadores y acciones).
- C6 Plantillas de registro + A9 Checklist.
- B2 Carga de trabajo.

**Oleada 4 · Hacia afuera**
- G1 API pública + webhooks, y G2 apps en n8n y Make.
- D6 Firma electrónica.
- G8 Facturación electrónica DIAN.
- D5 Agenda de citas.

**Oleada 5 · Canales y celular**
- H1 PWA + notificaciones push (+ H3 escáner).
- D3 WhatsApp oficial.
- D2 Mesa de ayuda por correo + E5 SLA.
- F3 De documento a registro.

**Oleada 6 · Crecer**
- I1 Inglés y portugués.
- I3 Modo agencia.
- G5 Importadores (Airtable primero).
- G3 Google Sheets sincronizado.
- E6 Agentes de IA.

---

## 7. Lo que NO recomiendo (por ahora)

- **Chat interno tipo Slack** (lo hace ClickUp): es mucho trabajo y mucho
  mantenimiento para algo que ya cubren los comentarios, las menciones y la
  integración con Slack o Teams.
- **Pizarras (whiteboards)** y **grabación de pantalla**: nicho y enormes.
- **Correo masivo y campañas**: choca con la decisión de ADR-S18 (cuidar la
  reputación del correo compartido). Mejor sincronizar una vista con
  Mailchimp, Brevo o MailerLite.
- **Generar apps con código a partir de un prompt** (estilo *Vibe*): riesgo
  de seguridad y de mantenimiento. F7 (generar la estructura) da casi todo el
  valor.
- **Apps nativas antes que la PWA**: la PWA resuelve el 80 % por una fracción
  del costo.
- **Bases de cientos de millones de filas** (estilo *HyperDB*): todavía no
  hace falta; los presupuestos de rendimiento (§13) están holgados con 100
  mil registros por lista.

---

## 8. Matriz rápida (valor contra esfuerzo)

| Esfuerzo \ Valor | Alto | Medio | Bajo |
|---|---|---|---|
| **S** | A3, E7, F1, G6, I10 | A4, A12, D4, G15, I9 | G12 |
| **M** | A2, A5, A6, A8, B4, B5, C2, C3, C6, E1, F3, F7, G2, H1 | A7, A9, A10, A11, A13, A15, A16, B3, B7, C4, C8, C10, D8, D9, E3, E5, F2, F4, F5, G4, G7, G9, G10, G13, H3, H4, I2, I4, I5, I6, I7, I8, J1, J2, J3 | B6, C9, G14 |
| **L** | A1, A14, B1, B2, C1, C5, D1, D2, D3, D5, D6, E2, E6, G1, G3, G5, G8, G11, I1, I3 | C7, D7, E4, F6, H2 | — |
| **XL** | B8 | H5 | — |

Esquina de oro: valor alto con esfuerzo S o M. Es la oleada 1 más A5, B4,
B5, C2, C3 y C6.

---

## 9. Fuentes

- [Airtable · Product playback octubre 2025](https://community.airtable.com/announcements-6/product-playback-october-2025-46785) ·
  [julio 2025](https://community.airtable.com/announcements-6/product-playback-july-2025-45955) ·
  [Airtable Superagent](https://www.createwith.com/tool/airtable/updates/airtable-launches-first-buildathon-and-new-multi-agent-product) ·
  [Análisis de Sacra](https://sacra.com/chat/h/0d47c8ed-f3f9-49a2-9c75-c91c05860dee)
- [ClickUp · changelog 2026](https://clickup.com/learn/topic/project-management/tools/clickup/news/) ·
  [Release notes](https://releasebot.io/updates/clickup)
- [Notion · reseña 2026](https://eesel.ai/blog/notion-review) ·
  [Notion 2.46 (formularios, layouts, automatizaciones)](https://www.notion.com/releases/2024-10-24)
- [monday · IA 2026](https://community.monday.com/t/ai-2026-what-s-new-and-what-s-coming/123164) ·
  [Todo lo que hace monday AI](https://monday.com/blog/ai-agents/everything-monday-ai-can-do/)
- [SmartSuite · novedades agosto 2026](https://www.smartsuite.com/blog/whats-new-in-smartsuite-august-2026) ·
  [Gantt en SmartSuite](https://www.smartsuite.com/blog/gantt-charts-come-to-smartsuite)
- [Baserow 2.0](https://baserow.io/blog/baserow-2-0-release-notes) ·
  [Baserow 2025](https://baserow.io/blog/year-in-review-2025-baserow)
- [NocoDB 2025.09 (MCP, webhooks)](https://nocodb.com/docs/changelog/2025.09.0) ·
  [NocoDB 2025.06 (permisos, scripts)](https://nocodb.com/docs/changelog/2025.06.0) ·
  [NocoDB 2026.04](https://nocodb.com/comms/2026.04.0/newsletter.html) ·
  [NocoDB 2026.06 (Sync)](https://nocodb.com/comms/2026.06.0/newsletter.html)
- [Teable](https://railway.com/deploy/teable.md) ·
  [Alternativas open source a Airtable](https://www.nocobase.com/en/blog/open-source-airtable-alternatives)
- [Twenty CRM · documentación](https://docs.twenty.com/user-guide/getting-started/what-is-twenty) ·
  [Correo y calendario en Twenty](https://docs.twenty.com/getting-started/core-concepts/calendar-and-email)
- [Attio · reseña 2026](https://www.stacksync.com/blog/attio-crm-2026-review-features-pros-cons-pricing) ·
  [Attio · apps](https://attio.com/help/reference/apps)
- [Grist core](https://dev.co/databases/open-source/grist-core)
- [NocoBase · aprobaciones](https://docs.nocobase.com/workflow/triggers/approval) ·
  [NocoBase 1.9 (devolver a cualquier paso)](https://www.nocobase.com/en/blog/v1.9.0-beta.7)
- [Smartsheet · reseña 2026](https://makerstack.co/reviews/smartsheet-review/)
- [Fibery vs otras](https://fibery.com/fibery-vs-x)
- [Kommo · bandeja de WhatsApp](https://kommo.com/whatsapp/unified-inbox-with-whatsapp) ·
  [Kommo · IA](https://en.kommo.com/ai-crm)
- [Precios de la API de WhatsApp 2026](https://www.authgear.com/post/whatsapp-api-pricing) ·
  [Cambios por mensaje](https://www.unipile.com/whatsapp-business-api-pricing/)
- [DIAN · comunicado 026 de 2025](https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-026-2025.aspx) ·
  [Integración con proveedor tecnológico](https://www.brokenrubik.com/es-co/blog/netsuite-dian-facturacion-electronica) ·
  [Obligaciones de proveedores tecnológicos](https://actualicese.com/factura-electronica-obligaciones-e-infracciones-de-proveedores-tecnologicos/)

> Advertencia: buena parte de lo que se publicó en 2026 sobre la competencia
> viene de reseñas y blogs, no de notas oficiales. Antes de copiar un detalle
> conviene confirmarlo en la documentación de cada producto.
