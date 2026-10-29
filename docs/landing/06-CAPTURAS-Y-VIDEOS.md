# Índice de capturas y videos

Todo sale de la app real (versión 0.1.331) con la empresa de ejemplo **«Distribuidora
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
| `14-integraciones.png` | Galería de integraciones: WhatsApp, Telegram, Slack, Gmail, Google Calendar/Sheets/Drive, Outlook, WooCommerce, Mercado Pago, Wompi, SQL Server, S3 | Integraciones |
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

## Modo oscuro — `capturas/oscuro/`

`01-ventas-pipeline-kanban-oscuro.png`, `02-clientes-tabla-tipo-excel-oscuro.png`,
`03-tablero-ventas-oscuro.png`, `07-gantt-cronograma-oscuro.png`,
`10-ficha-del-cliente-oscuro.png`, `12-automatizacion-lienzo-oscuro.png`.
Úsalas en la sección oscura (automatizaciones / IA) y en el botón claro/oscuro de la demo.

## Celular — `capturas/celular/`

`01-ventas-pipeline-kanban-celular.png`, `02-clientes-tabla-tipo-excel-celular.png`,
`03-tablero-ventas-celular.png`, `06-calendario-citas-semana-celular.png`,
`10-ficha-del-cliente-celular.png`, `15-mi-trabajo-celular.png`,
`18-formulario-publico-celular.png`, `20-agenda-publica-horario-celular.png`.
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
