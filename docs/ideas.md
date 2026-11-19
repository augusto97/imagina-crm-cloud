# Banco de ideas — Imagina Base

> **Para qué sirve.** Reúne todas las ideas que todavía no se hicieron y que el
> usuario **no descartó**, para retomarlas cuando surja la necesidad o cuando
> pida ideas otra vez. Pedido del usuario (2026-10-26): "coloca todas las ideas
> posibles que yo no haya descartado totalmente para hacerlas en un futuro
> cuando te vuelva a pedir ideas".
>
> **Reglas de mantenimiento**
> - Cuando el usuario pida ideas, **empezar por aquí**: proponer desde este
>   documento (y sumar lo nuevo que aparezca), no desde cero.
> - Al hacer una idea, **sacarla** de aquí y anotarla en `CLAUDE.md` §5.
> - Si el usuario descarta una, moverla a «Descartado por el usuario» con la
>   fecha y sus palabras; esas **no se vuelven a proponer**.
> - El detalle de cada opción con código (A1, D5…) está en
>   `docs/estudio-funcionalidades-2026-10.md`, junto con el valor, el esfuerzo
>   y quién la tiene en la competencia.
>
> Última revisión: 2026-11-18 (v0.1.440).

---

## 0. Elegido el 2026-11-18 (plan para estabilizar y mejorar)

El usuario pidió "estabilizar y mejorar la app" y aprobó todo el plan ("Ok, has
todos los que propones"): v0.1.435 a v0.1.440 de estabilidad (hechas; detalle
en `CONTINUIDAD.md` §10) y después estos módulos, que salen de este banco al
publicarse: **G2** en parte (la API con tokens salió en v0.1.441, los webhooks
de eventos en v0.1.442 y la app de n8n en v0.1.443; quedan Make y Zapier),
**E1 + E2** en parte («buscar registros», «crear o actualizar por un dato» y
«cuando se agrega un comentario» salieron en v0.1.444), **A14** (duplicados y fusionar: salió en v0.1.445), **D6**
(firma electrónica: salió completa en v0.1.446, v0.1.447 —automatizaciones,
portal, verificar con el archivo y asistente/MCP— y v0.1.448 —el código por SMS
o WhatsApp—) y **G8** (facturación DIAN: falta elegir proveedor y tener
credenciales de prueba) e **I3** (modo agencia: decisiones tomadas el
2026-11-18, ver §2; la base salió en v0.1.449 —consola de la agencia, entrar
con rastro, pausar, plan gestionado—, la marca de la agencia en v0.1.450 y
sus planes con pagos registrados a mano en v0.1.451 y el cobro en línea con
la cuenta de la agencia en v0.1.452; siguen el débito automático para los
clientes de la agencia en v0.1.453 y el cobro de la plataforma a la agencia en
v0.1.454).

---

## 1. Pospuesto por el usuario (fase 4, 2026-10-26)

Eran parte de la fase 4 «Hacia afuera». El usuario eligió sólo la agenda de
citas (D5) y pidió guardar el resto para después.

| Idea | Qué es | Qué hay hoy | Decisiones pendientes |
|---|---|---|---|
| **G2 · Apps oficiales en Make y Zapier** | Disparadores y acciones de Imagina Base en esos catálogos. | API REST con tokens (v0.1.441), webhooks de eventos firmados (v0.1.442) y la app de n8n (v0.1.443). | Make y Zapier piden cuentas de desarrollador del usuario y pasan revisión. Publicar la de n8n en npm (secreto `NPM_TOKEN`) y pedir su verificación. |
| **G8 · Facturación electrónica DIAN** | Factura y nota crédito desde la ficha con los ítems existentes, vía un proveedor autorizado. Vuelven el CUFE, el XML y el PDF validado. Después: México (CFDI), Perú, Ecuador y Chile. | «Factura (no electrónica)» en PDF (v0.1.290). | Proveedor (Factus, Alegra, Siigo, The Factory HKA…); cuenta por empresa (recomendado). Hacen falta credenciales de prueba para probar de verdad. |

---

## 2. Próximas oleadas propuestas en el estudio

**Oleada 5 · Canales y celular** — el usuario la aprobó el 2026-10-26 SIN F3:
H1 + H3 (PWA, push y escáner), D2 + E5 (mesa de ayuda por correo con SLA) y
D3 (WhatsApp oficial) pasan a la fase 5 y salen de este banco al publicarse.
**F3 · De documento a registro** quedó aquí, pospuesto por el usuario ("lo
dejaría en ideas"): subir o reenviar una factura, un RUT o una orden de
compra y que la IA cree o actualice el registro, con pantalla de revisión.

**Oleada 6 · Crecer** — el usuario eligió el 2026-10-26 SÓLO **E6 · Agentes de
IA** para la fase 6 ("por el momento solo me interesaría la de Agentes de IA,
los otros por el momento ponlos en ideas"); E6 se publicó en v0.1.317. Quedan
aquí, pospuestos:
- **I1 · Interfaz en inglés y portugués.** La pieza de traducción ya existe
  (`lib/i18n.ts`, ~7.000 textos marcados en la interfaz, hoy sólo español).
  Falta traducir todo (también errores del API, correos, portal, páginas
  públicas, PDF, plantillas y el asistente) e idioma por persona con default
  por empresa. Costo que queda: cada texto nuevo en tres idiomas. Decisión
  pendiente: quién revisa las traducciones (conviene un nativo para el
  portugués).
- **I3 · Modo agencia / revendedor** (estilo GoHighLevel). Un socio administra
  varias empresas cliente con su marca, plantillas, planes y precios. Encaja
  con el negocio del usuario. Base: consola de plataforma, white-label,
  dominios propios, planes editables e impersonación. **Decidido por el
  usuario (2026-11-18)**: la agencia le cobra a su cliente con su propia
  pasarela; la plataforma le cobra a la agencia un plan base con N empresas
  incluidas más un valor por cada empresa extra; la agencia entra a los datos
  de sus clientes como administradora, con rastro en la bitácora que el
  cliente puede ver; y los clientes de una agencia sólo ven la marca de la
  agencia (white-label completo, sin la marca de la plataforma). **Hecho en
  v0.1.449**: el modelo, la consola de la agencia y el acceso con rastro;
  **en v0.1.450** la marca de la agencia en sus clientes; **en v0.1.451** los
  planes de la agencia, el «pagado hasta» de cada cliente y los pagos
  registrados a mano; **en v0.1.452** el cobro en línea con la cuenta de la
  agencia (Mercado Pago, Wompi o PayPal: link por cliente, «Pagar ahora» y el
  pago que se registra solo). **Queda**: el débito automático de los clientes
  de la agencia (v0.1.453) y el cobro de la plataforma a la agencia (v0.1.454).
- **G5 · Importadores**, Airtable primero (base completa con vínculos y
  adjuntos, por token de la persona); después Notion, ClickUp, Trello y monday.
- **G3 · Google Sheets sincronizado en los dos sentidos.** La integración de
  Sheets ya tiene el permiso `spreadsheets` (lectura y escritura): no hace falta
  pedir uno nuevo a Google.

**Oleada 7 · el usuario eligió el 2026-10-26 sólo «Empezar fácil»**, ampliado
con guías y recorridos interactivos, centro de ayuda y novedades (F7 + I7 +
I9 se publicaron en v0.1.318-v0.1.320 y salieron de este banco). Siguen aquí, sin
elegir: E1 + E2 + E3 (automatizaciones completas), F1 + F2 + E7 + mejoras de agentes (IA en el día a día) y G4
(calendario en dos sentidos).

---

## 3. Todas las ideas pendientes, por área

Valor y esfuerzo según el estudio (S < M < L < XL).

### A. Datos y campos
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| A7 · Campos condicionales en la ficha y en el alta («NIT» sólo si «Tipo = Empresa») | medio · M | Los formularios públicos ya tienen condiciones. |
| A10 · Campo Firma (dibujar la firma en la ficha, un formulario o el portal) | medio · S-M | Ver D6. **En parte hecho en v0.1.355**: un formulario público pide una firma con el dedo o el mouse (se guarda como imagen en un campo de archivos). Queda firmar desde la ficha y el portal. |
| A11 · Ubicación / dirección con autocompletado, latitud y longitud | medio · M | Base de B3 (mapa). OpenStreetMap o la clave de Google de cada empresa. |
| A12 · Código de barras / QR como campo | medio · S | Con H3 se escanea con la cámara. **En parte hecho en v0.1.344**: cada registro tiene su QR (enlace o el valor del campo «Código»), con etiquetas en PDF y variables para correos y documentos. Lo que queda es un tipo de campo que dibuje el código de barras (EAN/Code 128) dentro de la tabla. |
| A13 · Moneda múltiple con conversión y tasa del día | medio · M | |
| A15 · Etiquetas compartidas entre listas | medio · S-M | |
| A16 · Punto de restauración de una lista («volver a como estaba ayer») | medio · M | Hoy hay copias del servidor y de una empresa, y deshacer de ediciones masivas. |

### B. Vistas
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| B3 · Mapa (pines por estado) | medio · M | Necesita A11. |
| B6 · Árbol y mapa mental | bajo-medio · M | |
| B7 · Vista de lista compacta tipo gestor de tareas | medio · S-M | |
| B8 · Interfaces o páginas de app por rol | alto · XL | El editor de la ficha y el de tableros son media base. |

### C. Trabajo en equipo
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| C4 · Campos de sólo lectura por rol («lo ve pero no lo cambia») | medio · S-M | Revisar si la entrega de roles propios (v0.1.311) ya lo cubre. |
| C7 · Documentos / wiki del workspace, publicables | medio-alto · L | Reusa el editor de la descripción. |
| C8 · Revisión sobre archivos (comentar un punto de una imagen o un PDF; aprobar desde el portal) | medio (agencias) · M | |
| C9 · Sprints (puntos, burndown) | bajo-medio · M | Nicho de software. |
| C10 · Metas con avance automático desde los registros | medio · M | Existe la plantilla OKR. |

### D. Clientes y canales
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| D1 · El correo de cada registro (Gmail/Outlook de cada persona en la ficha) | alto (CRM) · L | Opt-in por persona; sólo hilos con contactos de la lista. |
| D8 · Encuesta NPS / satisfacción de un clic | medio · S-M | **En parte hecho en v0.1.355**: los formularios tienen la escala NPS (0 a 10) y la matriz para calificar varios aspectos. Queda responder con un clic desde el correo (cada número es un enlace). |
| D9 · Seguimientos 1 a 1 desde una vista | medio · M | Choca con ADR-S18: sólo con correo propio y con límites. |

### E. Automatizaciones
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| E1 · Disparadores que faltan | alto · M | «Cuando un registro empieza a cumplir una condición» y «cuando se sube un archivo». Ya existen: botón, aprobación, checklist, formulario, pago, correo entrante y comentario (v0.1.444). |
| E2 · Acciones que faltan | alto · M-L | «Asignar por turno», «notificar en la app», «copiar a otra lista», «preguntarle a la IA». Ya existen: pedir aprobación, subtareas desde plantilla, buscar registros y crear o actualizar por un dato (v0.1.444). |
| E3 · Varias ramas («según el valor de…»), subflujos, manejo de errores por paso, reintento de webhooks | medio · M | |
| E4 · Scripts en JavaScript aislado | medio-bajo · L | Necesita un sandbox serio. |
| E7 · «Describe la automatización y la armo» dentro del editor | medio · S | El asistente ya sabe crearlas. |

### F. Inteligencia artificial
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| F1 · Resumen del registro («¿qué pasó con este cliente?») | medio-alto · S | |
| F2 · IA al escribir (/ia en la descripción, sugerir respuestas) | medio · S-M | |
| F3 · De documento a registro | alto · M | Pospuesto por el usuario al armar la fase 5 (2026-10-26). Los campos con IA ya leen PDF; reenviar por correo depende de D2. |
| F4 · Preguntas sobre los datos que arman el widget del tablero | medio · M | |
| F5 · Notas de voz a texto | medio · M | |
| F6 · Búsqueda por significado (embeddings, pgvector) | medio · L | |

### G. Integraciones y ecosistema
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| G2, G8 | — | Ver §1 (pospuestos). |
| G3 · Google Sheets sincronizado en los dos sentidos | alto · M-L | Pospuesto por el usuario al armar la fase 6 (2026-10-26). El permiso `spreadsheets` ya está. |
| G4 · Google Calendar / Outlook sincronizado en los dos sentidos | medio-alto · M | **En parte hecho en v0.1.350**: en la agenda de citas, mover o borrar el evento en el calendario de quien atiende mueve o cancela la cita. Falta para la vista Calendario de cualquier lista. |
| G5 · Importadores (Airtable, Notion, ClickUp, Trello, monday) | alto · M c/u | Pospuesto por el usuario al armar la fase 6. Excel con varias hojas ya existe (v0.1.299). |
| G7 · Sincronizar PostgreSQL y MySQL | medio · M | Como la de SQL Server. |
| G9 · Contabilidad (Siigo, Alegra, World Office, QuickBooks, Xero) | medio-alto · M c/u | |
| G10 · Más pasarelas (ePayco, PayU, Bold, Stripe fuera de Colombia, Nequi directo) | medio · S-M c/u | Hoy: Mercado Pago, Wompi y PayPal. |
| G11 · Más tiendas (Mercado Libre, Shopify, Tiendanube) | alto (comercio) · L c/u | Reusa el motor de WooCommerce. |
| G12 · Avisos a Google Chat y Discord | bajo-medio · S c/u | Slack y Microsoft Teams ya existen (Teams desde v0.1.348). |
| G13 · OneDrive / SharePoint y Dropbox como almacenamiento | medio · M | S3 y Google Drive ya existen. |
| G14 · Enriquecimiento y validación (datos por dominio, email que existe) | bajo-medio · M | |
| G15 · Días hábiles y festivos por país en todo | medio · S | **En parte hecho en v0.1.349**: la agenda de citas usa los festivos de 33 países. El SLA de la mesa de ayuda, las fórmulas de días hábiles y las plantillas siguen con los de Colombia. |

### H. Celular
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| H2 · Sin conexión (capturar sin señal y sincronizar al volver) | medio-alto · L | |
| H4 · Foto y ubicación al cargar | medio · S-M | |
| H5 · Apps nativas iOS/Android | medio · XL | Sólo después de la PWA y si los clientes lo piden. |

### I. Plataforma, administración y negocio
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| I1 · Interfaz en inglés y portugués | alto · L | Pospuesto por el usuario al armar la fase 6. `lib/i18n.ts` ya existe. |
| I2 · SSO corporativo (Google Workspace, Entra, SAML, OIDC) y SCIM | medio · M | |
| I3 · Modo agencia / revendedor | alto · L | Pospuesto por el usuario al armar la fase 6. Ver §2. |
| I4 · Cobro por usuario y complementos (más IA, correos, almacenamiento) | medio · M | |
| I5 · Cupones, pruebas gratis y referidos | medio · M | |
| I6 · Copia automática de cada empresa a SU Drive o S3 | medio · S-M | Hoy existen el almacenamiento propio y la exportación de una empresa. |
| I8 · Métricas de uso para el operador | medio · M | |
| I9 · Página de estado pública (la franja de avisos ya existe desde v0.1.319) | bajo-medio · S | |

### J. Reportes
| Idea | Valor · esfuerzo | Nota |
|---|---|---|
| J1 · Informes armados (texto, tablas y gráficos de varias listas, exportables y programables) | medio · M | |
| J2 · Comparar períodos en cualquier gráfico | medio · S-M | Hoy sólo el KPI con variación. |
| J3 · Pronóstico de ventas (embudo ponderado) | medio · S-M | |

---

## 4. Paquetes por tipo de negocio

Combinaciones que se pueden vender como solución completa, con su plantilla:

| Paquete | Opciones | Para quién |
|---|---|---|
| Mesa de ayuda | D2 + E5 + D8 + A3 + portal | Soporte y servicio al cliente |
| CRM de ventas | B5 + A14 + D1 + D6 + J3 + D3 | Equipos comerciales |
| Facturación y cobranza | G8 + G9 + D6 + lo existente | Servicios y suscripciones |
| Servicios con citas | D5 + D3 + I10 + portal | Clínicas, consultorios, asesorías |
| Inventario y activos | H3 + A12 + B3 + H4 | Bodegas, TI, alquiler de equipos |
| Agencias | C8 + B2 + C6 + portal + registro de tiempo | Marketing, diseño, desarrollo |
| Talento humano | C5 + C6 + A9 + C3 | Vacaciones, permisos, incorporación |
| Proyectos | B1 + A8 + B2 + C10 | Constructoras, consultoras, eventos |

---

## 5. Mejoras a lo que ya existe (quedó afuera de cada versión)

- **Carga de trabajo (v0.1.307)**: arrastrar en el tiempo para mover fechas;
  capacidad por día puntual (vacaciones, incapacidades); recurrencias
  proyectadas.
- **Aprobaciones (v0.1.309)**: verlas y decidirlas desde el portal del
  cliente; delegar, recordar y escalar por plazo; poner campos en cada paso.
- **Checklists (v0.1.310)**: verlos en el portal (sólo lectura); mover un ítem
  a otro checklist desde la interfaz (la API ya lo permite).
- **Calendario (v0.1.301)**: mostrar las ocurrencias futuras de las
  recurrencias (hoy sólo el icono).
- **Dependencias y Gantt (v0.1.302)**: dependencias entre listas distintas en
  la interfaz (la API está lista); recalcular por desfase al reprogramar; ruta
  crítica.
- **Campo Botón (v0.1.303)**: botones en el kanban y en las tarjetas.
- **Widget de contacto (v0.1.394-v0.1.396, D7 hecha)**: atender por equipo
  (repartir entre las personas de un equipo, no una lista fija); botones del
  widget en el portal; estadísticas que viajen al migrar una empresa.
- **App instalable y push (v0.1.314)**: modo offline (H2); push e
  instalación para el portal del cliente (junto con su dominio); el logo de la
  empresa como ícono de la app; re-vincular la suscripción con la app cerrada
  (`pushsubscriptionchange`); bitácora de dispositivos; que el asistente/MCP
  administre push; llenar con la cámara otros campos además del «Código».
- **Guías y recorridos (v0.1.320)**: que el operador edite el texto de una
  guía del sistema (hoy la oculta o le pone video y escribe la suya);
  recorridos dentro del constructor de formularios y del flujo de dar acceso
  al portal (hoy «forms» tiene 2 pasos y «portal» 3); guías en otros idiomas;
  métricas de qué guías se abren y qué recorridos se terminan; que el
  asistente IA busque en las guías para responder «¿cómo hago…?».
- **Novedades (v0.1.319)**: avisarlas por correo o push; traducirlas; pedir
  opinión («¿te sirvió?»); novedades por empresa (que una empresa le cuente
  algo a su equipo); incluir lo visto en la descarga de datos de la cuenta;
  limpiar imágenes subidas que nunca se guardaron; volver a enfocar una
  novedad con el panel ya abierto.
- **Empezar fácil (v0.1.318)**: llevar el registro de datos de ejemplo en la
  migración de empresa (hoy, tras migrar, quedan como datos normales); que los
  toasts no tapen el botón flotante de «Primeros pasos»; reusar `TemplateCard`
  en la galería por tipo de negocio.
- **Agentes de IA (v0.1.317)**: un botón «Pedir al agente» en la ficha (hoy
  sólo trabaja cuando lo llama una automatización); correr un agente en lote
  sobre registros que ya existen; memoria entre corridas (hoy cada corrida
  arranca de cero); elegir el modelo por agente (hoy usa el del asistente de
  la empresa); que el asistente/MCP cambie o pause un agente (hoy sólo lo
  crea).
- **Mesa de ayuda (v0.1.316)**: entrar al buzón por OAuth (Gmail/Microsoft)
  en vez de contraseña de aplicación; horario hábil por equipo (hoy uno por
  lista); que un Problema abierto mire la papelera (hoy el de un buzón cuya
  lista está en la papelera queda abierto hasta restaurarla o «Ya lo
  arreglé»).
- **WhatsApp oficial (v0.1.315)**: bandeja o historial de la conversación
  (hoy, a propósito, sólo el último mensaje); guardar el último adjunto en un
  campo Archivo (los medios no se descargan); crear y editar plantillas desde
  la app (hoy en Meta, con enlace); una acción propia del campo Botón (hoy:
  «Al presionar el botón» + «Enviar plantilla»); probar con una cuenta real de
  Meta en el servidor.
- **Agenda de citas (v0.1.313)**: «quién atiende» por equipo; calendario propio
  de un recurso; ver y gestionar las citas desde el portal del cliente;
  recordatorios nativos por WhatsApp (los de correo y SMS ya existen). Ya se
  hicieron: cobrar al agendar (v0.1.387), citas grupales y margen por servicio
  (v0.1.349), la vuelta desde el calendario (v0.1.350) y los recordatorios por
  SMS (v0.1.332).
- **Fórmulas (v0.1.304)**: operadores propios en las condiciones de las
  automatizaciones; funciones que agreguen registros vinculados.
- **Tableros (v0.1.292)**: que el asistente/MCP publique o programe envíos;
  que un destinatario externo se dé de baja solo.
- **Documentos PDF**: numeración que reinicia por año (`CC-2026-0001`); QR que
  apunte a una versión pública verificable del documento.
- **Integraciones OAuth**: revocar en el proveedor al desconectar.
- **Kanban, tarjetas y ficha**: «Crear subtarea» del menú de fila podría perder
  el foco del título como el bug corregido en «Nuevo registro» (revisar).
- **Realtime**: si una edición propia dispara una automatización que cambia el
  registro, la ficha abierta no lo muestra hasta recargar (ventana de eco de
  2,5 s de v0.1.253). Arreglo propuesto: llenar el `origin` de `RtInvalidate`.

---

## 6. Pendientes técnicos (no urgentes)

- **Migrar a Zod 4** (~100 archivos). Cierra la excepción de auditoría de zod
  (ADR-S38, v0.1.308). Conviene hacerla sin agentes trabajando en paralelo.
- Dependencias de desarrollo con versión mayor nueva (vite, vitest).
- Rol de Postgres no superusuario para la conexión base (necesita BYPASSRLS y
  migrar cada instalación por consola).
- `style-src 'unsafe-inline'` en la CSP (React escribe `style=""`).
- Dominios propios por Caddy (`on_demand_tls`) cuando haya muchos clientes.
- Firma de los releases (opcional; `docs/runbook-updates.md`).
- Un contexto por request en el servidor (baja prioridad desde v0.1.257).

---

## 7. No recomendado por ahora (el usuario NO lo descartó)

Ideas que se analizaron y no se recomiendan todavía, por costo o por riesgo.
Se pueden retomar si cambia la necesidad.

- **Chat interno tipo Slack**: mucho trabajo y mantenimiento para algo que ya
  cubren los comentarios, las menciones y la integración con Slack o Teams.
- **Pizarras (whiteboards)** y **grabación de pantalla**: nicho y enormes.
- **Correo masivo y campañas**: choca con ADR-S18 (la reputación del correo
  compartido). Alternativa: sincronizar una vista con Mailchimp, Brevo o
  MailerLite.
- **Generar apps con código a partir de un prompt**: riesgo de seguridad y de
  mantenimiento; F7 da casi todo el valor.
- **Apps nativas antes que la PWA**: la PWA resuelve el 80 % por una fracción
  del costo.
- **Bases de cientos de millones de filas**: todavía no hace falta (los
  presupuestos de rendimiento están holgados con 100 mil registros por lista).

---

## 8. Descartado por el usuario (no volver a proponer)

- **PSE propio (ACH Colombia)** — 2026-10-06: "ya no lo planeo implementar".
  Los pagos por PSE siguen disponibles vía Mercado Pago y Wompi.
