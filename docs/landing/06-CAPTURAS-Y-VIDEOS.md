# Índice de capturas y videos

Todo sale de la app real (versión 0.1.337) con la empresa de ejemplo **«Distribuidora
Andina»** (datos ficticios: nombres, montos en pesos colombianos, correos @ejemplo.com).
Formato regional de Colombia: punto para miles, fechas DD/MM/AAAA, zona horaria de Bogotá.

- **Escritorio:** 1440×900 a doble resolución (archivos de 2880×1800 px, PNG).
- **Celular:** 390×844 a triple resolución (1170×2532 px, PNG).
- Para la web, convierte a AVIF/WebP y redimensiona (por ejemplo 1600 px de ancho).

## Escritorio — `capturas/escritorio/`

| Archivo | Qué se ve | Úsala en |
|---|---|---|
| `01-ventas-pipeline-kanban.png` | Embudo de ventas en kanban: etapas con color, total en pesos por columna, monto, responsable y fecha de cierre en cada tarjeta | **Hero**, pestaña Ventas, vista Kanban |
| `02-clientes-tabla-tipo-excel.png` | Lista de clientes como hoja de cálculo, con 14 celdas de montos seleccionadas y la barra «Suma: 33.570.000 · Promedio…» | Vista Tabla tipo Excel |
| `03-tablero-ventas.png` | Tablero de ventas: indicadores, embudo, monto por etapa, por origen y por responsable | Tableros |
| `04-tablero-cartera.png` | Tablero de cartera: facturado, pendiente de cobro, dona por estado de pago, vencimientos por mes y próximas facturas | Pestaña Cobros, Tableros |
| `05-tablero-soporte.png` | Tablero de soporte: tickets abiertos, SLA vencido, medidor de satisfacción, por canal y prioridad | Mesa de ayuda |
| `06-calendario-citas-semana.png` | Calendario semanal de citas por horas | Agenda de citas, vista Calendario |
| `07-gantt-cronograma.png` | Cronograma (Gantt) de tareas agrupadas por responsable, con avance y la línea de «Hoy» | Proyectos, vista Gantt |
| `08-carga-de-trabajo-equipo.png` | Carga de trabajo por persona y semana (horas estimadas vs. capacidad) | Proyectos, vista Carga |
| `09-mesa-de-ayuda-sla.png` | Tickets en kanban por estado del SLA (a tiempo, en riesgo, vencido, cumplido) | Mesa de ayuda |
| `10-ficha-del-cliente.png` | Ficha de un cliente: descripción con checklist, campos, facturas vinculadas y comentarios del equipo | Ventas y CRM, «cada cliente con su historial» |
| `11-automatizacion-flujo.png` | Editor de automatizaciones (vista de pasos): recordatorio de cobro → espera 3 días → condición | Automatizaciones |
| `12-automatizacion-lienzo.png` | El mismo flujo en el lienzo con ramas Sí/No | Automatizaciones (**recomendada**) |
| `13-ideas-para-tu-negocio.png` | Galería de 39 ideas listas para activar | Automatizaciones, Aprende |
| `14-integraciones.png` | Integraciones: arriba las **conectadas** (Onurix y Twilio para SMS, el sitio WordPress con «Sincronizar sitio») y abajo la galería (WhatsApp, Telegram, Slack, Gmail, Google Calendar/Sheets/Drive, Outlook, SMS, WordPress, WooCommerce, Mercado Pago, Wompi, SQL Server, S3) | Integraciones |
| `15-mi-trabajo.png` | «Mi trabajo»: lo asignado a la persona, agrupado en Vencido / Hoy / Próximos 7 días | Proyectos, En el celular |
| `16-agentes-de-ia.png` | Agentes de IA con plantillas (clasificar tickets, resumir, completar datos, sugerir respuesta, asignar por tema) | Inteligencia artificial |
| `17-busqueda-global.png` | Búsqueda global (Ctrl+K) encontrando registros en varias listas | Detalle de usabilidad |
| `18-formulario-publico.png` | Formulario público de soporte con secciones | De cara a tus clientes |
| `19-agenda-publica-servicio.png` | Agenda pública: elegir el servicio | Agenda de citas |
| `20-agenda-publica-horario.png` | Agenda pública: elegir el día en el calendario | Agenda de citas (**recomendada**) |
| `21-centro-de-aprendizaje.png` | Centro de aprendizaje con módulos y recorridos | Aprende y soporte |
| `22-documento-pdf-editor.png` | Editor de documentos con una cuenta de cobro: «Son: UN MILLÓN CINCUENTA MIL PESOS M/CTE.» | Cobros, Documentos PDF |
| `23-portal-activar.png` | Tarjeta para activar el portal del cliente y elegir qué listas ve | Portal (detalle) |
| `24-portal-editor.png` | Editor del portal del cliente con el estado de cuenta (saldo, pagado, total, próximo vencimiento) | De cara a tus clientes |
| `25-plantillas-de-listas.png` | Galería de plantillas: CRM, pipeline, facturación, proyectos, mesa de ayuda, inventario, reclutamiento, eventos… | Pestaña «A tu medida», Cómo empiezas |
| `26-facturas-tabla.png` | Tabla de facturas con estados de pago en color | Cobros |
| `27-tareas-kanban.png` | Tareas en tablero por estado | Proyectos |

### Sitio WordPress (versión 0.1.333 a 0.1.336)

El sitio de ejemplo es **distribuidoraandina.co**, un WordPress real con Rank Math, ACF y
el complemento de la app: blog, páginas y un tipo de contenido «Recetas» con campos ACF.

| Archivo | Qué se ve | Úsala en |
|---|---|---|
| `28-wordpress-conectar-un-clic.png` | «Conectar un sitio WordPress»: solo la dirección del sitio y «Continuar en WordPress» | WordPress, paso 1 |
| `29-wordpress-autorizar-en-wordpress.png` | La pantalla «Autorizar aplicación» del propio WordPress («Sí, apruebo esta conexión») | WordPress, paso 2 (muestra que no se copia ninguna clave) |
| `30-wordpress-elegir-que-traer.png` | El asistente: campos ACF de las recetas con su tipo, cuáles se editan desde la app, «Al instante» y qué hacer con lo que se borra | WordPress, paso 3 |
| `30b-wordpress-columnas-seo.png` | El mismo asistente en las columnas de SEO de Rank Math (título, descripción, palabra clave, lo que ve Google) | Bloque SEO |
| `31-wordpress-pagina-del-sitio.png` | La página del sitio: complemento activo con Rank Math, **«Novedades en tu sitio»** (un campo ACF nuevo con «Traer»), «Al día», «Al instante · Escuchando al sitio» con los avisos recibidos | WordPress (**recomendada**) |
| `32-wordpress-revision-seo.png` | Las entradas del blog como tabla: palabra clave, largo del título que ve Google (en rojo los de más de 60) y el título en Google | Bloque SEO (**recomendada**) |
| `33-wordpress-sin-descripcion-sugerida-con-ia.png` | La vista «Sin descripción» con la columna «Meta descripción sugerida» escrita por la IA | Bloque SEO, Inteligencia artificial |
| `34-wordpress-medios-texto-alternativo.png` | La biblioteca de medios con miniaturas: «Sin texto alternativo», la sugerencia de la IA y dónde se usa cada imagen | Bloque SEO / accesibilidad |
| `35-wordpress-recetas-campos-acf.png` | Un tipo de contenido propio (Recetas) con sus campos ACF como columnas editables, y el aviso de la columna nueva | WordPress, campos personalizados |
| `36-wordpress-complemento-en-el-sitio.png` | El complemento dentro de WordPress (Herramientas → Imagina Base): versión, Rank Math, ACF y avisos en tiempo real | Confianza: «un complemento liviano» |

### Mensajes de texto (SMS) (versión 0.1.332)

| Archivo | Qué se ve | Úsala en |
|---|---|---|
| `37-sms-desde-la-ficha.png` | «Enviar SMS» desde un cliente: el mensaje con variables, el contador («1 SMS · quitar tildes: 1 SMS en vez de 2»), cómo le llega y el horario de la Ley 2300 marcado | SMS (**recomendada**) |
| `38-sms-envio-masivo.png` | «Enviar SMS a 32 registros»: cada uno con sus datos, revisión antes de enviar («Salen 32 SMS a 32 destinatarios») | SMS, Cobros |
| `39-sms-automatizacion.png` | Automatización «Aviso de cobro por SMS»: la víspera del cobro, con el formulario del SMS y el contador | SMS, Automatizaciones |
| `40-sms-automatizacion-lienzo.png` | La misma automatización en el lienzo (cuando → SMS → correo) | Automatizaciones |
| `41-sms-pagina-de-la-conexion.png` | La conexión de Twilio: enviados, entregados, fallidos y SMS cobrados del mes, estado de entrega y columnas en la lista | SMS (control de costos) |

## Modo oscuro — `capturas/oscuro/`

`01-ventas-pipeline-kanban-oscuro.png`, `02-clientes-tabla-tipo-excel-oscuro.png`,
`03-tablero-ventas-oscuro.png`, `07-gantt-cronograma-oscuro.png`,
`10-ficha-del-cliente-oscuro.png`, `12-automatizacion-lienzo-oscuro.png`,
`31-wordpress-pagina-del-sitio-oscuro.png`, `32-wordpress-revision-seo-oscuro.png`,
`37-sms-desde-la-ficha-oscuro.png`.
Úsalas en la sección oscura (automatizaciones / IA) y en el botón claro/oscuro de la demo.

## Celular — `capturas/celular/`

`01-ventas-pipeline-kanban-celular.png`, `02-clientes-tabla-tipo-excel-celular.png`,
`03-tablero-ventas-celular.png`, `06-calendario-citas-semana-celular.png`,
`10-ficha-del-cliente-celular.png`, `15-mi-trabajo-celular.png`,
`18-formulario-publico-celular.png`, `20-agenda-publica-horario-celular.png`,
`31-wordpress-pagina-del-sitio-celular.png`, `32-wordpress-revision-seo-celular.png`,
`37-sms-desde-la-ficha-celular.png`.
Para «En el celular»: tres teléfonos en abanico con kanban, ficha y Mi trabajo.

## Animaciones de la marca — `motion/animaciones/`

Ilustraciones animadas del centro de aprendizaje de la app (MP4 + WebM, loops exactos de
~7 s, 1536×960). Detalle de cada una en `04-MOTION.md`.

## Clips de la app en uso — `motion/app/`

Interacciones reales con cursor visible (MP4 + WebM, 1440×900). Detalle en `04-MOTION.md`.

## Marca — `marca/`

`logo.png` y `logo-oscuro.png` (512×512, el de tu servidor), `icono-512.png`,
`icono-original.png`. Colores sacados del logo: #00A0C7 → #00AAD5 → #00CBD3 → #00E3DF.

## Datos de la empresa de ejemplo (por si el diseño necesita números coherentes)

- Pipeline: 32 oportunidades · $66.400.000 en total · 6 etapas (Nuevo, Contactado,
  Calificado, Propuesta enviada, Ganado, Perdido).
- Cartera: 32 facturas · $75.720.000 facturado · $10.120.000 pendiente de cobro ·
  10 clientes con saldo.
- Soporte: 32 tickets · canales email, WhatsApp, teléfono, formulario web.
- Equipo: Laura Gómez (admin), Carlos Ruiz, Valentina Ríos, Andrés Mejía, Camila Torres,
  Mateo Castro.
- Sitio WordPress: 10 entradas del blog, 7 páginas, 8 recetas, 10 imágenes; 5 entradas sin
  meta descripción y 8 imágenes sin texto alternativo.
- SMS: 33 enviados a los clientes en el mes: 32 entregados y 1 fallido.
