# Imagina Base — SEO de la landing (imagina.cloud/base)

> Investigación de octubre de 2026: autocompletado real de Google (~180 consultas
> semilla, y 80 más el 29 de octubre para SMS y WordPress, desde Colombia y México),
> páginas de la competencia y la documentación vigente de Google. Los volúmenes
> son **estimados** (no hubo acceso a Keyword Planner ni Semrush): valídalos con Keyword
> Planner y con Search Console 6-8 semanas después del lanzamiento.

## 1. La estrategia en 6 ideas

1. **No pelees por «crm» ni por «crm gratis» de entrada.** Ahí están HubSpot, Zoho,
   Bitrix24, Capterra y Salesforce. El hueco está en el término medio:
   **«crm con whatsapp»**, **«cuánto cuesta un crm en Colombia»**, **«crm para
   inmobiliarias»**, **«plantilla crm excel gratis»**, **«cómo crear un crm (con IA)»** y
   **«airtable en español»**.
2. **Cuidado con palabras trampa.** «Base de datos online» se busca para aprender SQL;
   «mesa de ayuda» trae portales del SENA y de universidades; «gestor de proyectos» es un
   cargo; «cotizaciones» trae al IMSS y la seguridad social; «portal de clientes» trae los
   de Siigo o Interrapidísimo. No las uses como palabra principal.
3. **En Colombia hay mucha demanda de documentos y plantillas**: cuentas de cobro,
   cotizaciones y bases de datos de clientes en Excel. La app ya genera esos PDF y exporta
   a Excel: plantillas descargables y herramientas gratis traen tráfico y enlaces a la vez.
4. **El tesoro escondido:** el centro de aprendizaje de la app (191 guías, ~120.000
   palabras) y las 39 «Ideas para tu negocio» viven detrás del inicio de sesión. Una versión
   pública en `/base/ayuda/` y `/base/ideas/` cubriría cientos de búsquedas largas y es justo
   el contenido que citan las IA (ChatGPT, Perplexity, Google AI Mode).
5. **Una sola versión en español neutro, sin hreflang por ahora** (Google no admite
   `es-419`). Metas de rendimiento con margen: LCP ≤ 2,0 s, INP ≤ 150 ms, CLS ≤ 0,05.
6. **Hoy imagina.cloud está cerrado a los buscadores a propósito** (WordPress recién
   instalado, sin contenido). Ábrelo el día que publiques la landing, no antes: lista de
   lanzamiento en la sección 6 («Checklist del día de lanzamiento»).
---

## 2. Etiquetas de la landing principal

### `<title>` (≤ 60 caracteres) — elige uno
1. `Imagina Base: CRM y gestión sin código para pymes` (49) ← recomendado
2. `CRM para pymes con WhatsApp, sin código | Imagina Base` (54)
3. `CRM, cobros y proyectos en un solo lugar | Imagina Base` (55)

Haz que el H1 diga lo mismo que el título: si el H1 es más claro, Google reescribe el
título con él.

### Meta description (≤ 155 caracteres) — elige una
1. `Arma tu CRM, cobros, proyectos e inventario sin programar. WhatsApp oficial y automatizaciones. En español y con precios en pesos. Prueba 15 días gratis.` (153)
2. `Deja Excel: sube tu archivo y organiza clientes, ventas, cobros y tareas sin código, con WhatsApp y automatizaciones. Prueba 15 días gratis, sin tarjeta.` (153)
3. `Tu CRM en minutos: sube tu Excel o elige una plantilla. Kanban, cobros con PSE y Nequi, WhatsApp y portal de clientes. Prueba 15 días gratis.` (141)

### Jerarquía de encabezados
- **H1** (uno solo): «Organiza tu negocio a tu manera, sin programar»
  (alternativa con la palabra clave más explícita: «Organiza tu negocio a tu manera: CRM,
  cobros y proyectos sin programar»).
- H2 por sección (ver `02-TEXTOS-LANDING.md`), cada uno con su palabra secundaria:
  - «Una base. Todo tu negocio.» → CRM, base de datos sin código
  - «Que el trabajo repetitivo se haga solo» → automatizar procesos, WhatsApp
  - «Cobra más rápido» → cuentas de cobro, cotizaciones, control de cartera, links de pago
  - «Tus clientes también lo usan» → portal de clientes, formularios, agenda de citas
  - «Hecho para cómo trabajamos aquí» → precios en pesos, PSE, Nequi, Ley 1581
  - «Lo que cambia para una pyme en Latinoamérica» → alternativa a Excel / Airtable
  - «Precios simples, en pesos» → cuánto cuesta un CRM
  - «Preguntas frecuentes»

**Dónde va la palabra principal** («CRM sin código / para pymes»): título, H1, primeras
100 palabras, nombre del archivo de la imagen del hero y su `alt`. **Texto real de la
página: 1.200-1.800 palabras** — las animaciones no reemplazan al texto.

### Textos alternativos (alt) sugeridos
- Hero: «Embudo de ventas en Imagina Base con totales por etapa en pesos colombianos»
- Tabla: «Lista de clientes tipo Excel con suma de la selección»
- Tablero: «Tablero de ventas con embudo, monto por etapa y ventas por responsable»
- Automatización: «Automatización de cobro: recordatorio, espera de 3 días y condición»
- Portal: «Portal del cliente con estado de cuenta y facturas»
- PDF: «Cuenta de cobro en PDF generada desde una factura»
- WordPress: «Entradas de un sitio WordPress en una tabla con el largo del título que ve Google»
- Medios: «Biblioteca de medios de WordPress con el texto alternativo sugerido por IA»
- SMS: «Envío de SMS a un cliente con el contador de mensajes y el horario de la Ley 2300»

### Open Graph
- `og:type=website`, `og:locale=es_LA`, `og:image` 1200×630 **JPG o PNG** con el producto
  real (las redes no siempre leen AVIF), `og:title` y `og:description` más cortos que la
  meta, `twitter:card=summary_large_image`.

---

## 3. Datos estructurados (JSON-LD)

**Lo vigente a octubre de 2026 (verificado en la documentación de Google):**
- **Las FAQ ya no dan resultado enriquecido** desde el 7 de mayo de 2026. El marcado
  `FAQPage` no hace daño y ayuda a entender la página: mantenlo **solo si las preguntas se
  ven en la página**.
- **SoftwareApplication** necesita `name`, `offers.price` y además `aggregateRating` o
  `review` para el resultado enriquecido. **No marques las notas de G2 o Capterra** («Don't
  aggregate reviews or ratings from other websites»). Agrega `aggregateRating` solo cuando
  tengas reseñas reales recogidas y visibles en tu propia página.
- **BreadcrumbList** sigue valiendo (en celular ya no se ven las migas en los resultados).
- Los datos estructurados tienen que coincidir con el texto visible (precios incluidos).

Esqueleto (reemplaza lo que está entre `< >`):

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://imagina.cloud/#org",
      "name": "Imagina",
      "url": "https://imagina.cloud/",
      "logo": "https://imagina.cloud/<ruta>/logo-512.png",
      "sameAs": ["<LinkedIn>", "<YouTube>", "<Instagram>"]
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://imagina.cloud/base/#app",
      "name": "Imagina Base",
      "description": "Plataforma sin código para que las pymes de Latinoamérica organicen clientes, ventas, cobros, proyectos y soporte, con automatizaciones, WhatsApp y portal de clientes.",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, Android, iOS (app instalable)",
      "inLanguage": "es",
      "url": "https://imagina.cloud/base/",
      "publisher": { "@id": "https://imagina.cloud/#org" },
      "offers": [
        { "@type": "Offer", "name": "Starter", "price": "<59000>", "priceCurrency": "COP" },
        { "@type": "Offer", "name": "Pro", "price": "<199000>", "priceCurrency": "COP" }
      ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Imagina", "item": "https://imagina.cloud/" },
        { "@type": "ListItem", "position": 2, "name": "Imagina Base", "item": "https://imagina.cloud/base/" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "¿Qué es Imagina Base?",
          "acceptedAnswer": { "@type": "Answer", "text": "<la respuesta visible en la página>" } }
      ]
    }
  ]
}
```

Suma `VideoObject` si el video de la demo se aloja con miniatura propia.

---

## 4. Palabras clave por grupo

Escala estimada: Vol./Dif. = MA (muy alto), A, M, B.

### A. CRM
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| crm para pymes (+ colombia / méxico), mejor crm para pymes | Comercial | A | A | `/base/crm/` |
| crm gratis, crm gratis en español | Comercial | MA | MA | Entrada de blog «CRM gratis o prueba gratis: qué conviene» |
| crm con whatsapp, crm para whatsapp business, crm whatsapp api | Comercial | A | A | `/base/crm-whatsapp/` |
| **cuánto cuesta un crm en colombia**, crm precios colombia | Comercial | M | M | `/base/precios/` + blog |
| crm en español, software crm en español | Comercial | M | M | `/base/crm/` |
| qué es un crm (y para qué sirve, ejemplos) | Informacional | MA | A | Página pilar del blog |
| crm excel gratis, plantilla crm excel, crm vs excel | Info-transaccional | A | M | `/base/plantillas/crm/` |
| cómo crear un crm (desde cero, con IA, con Claude) | Informacional, en alza | M | B-M | Blog + `/base/ia/` |

### B. Base de datos sin código / alternativa a Airtable o Excel
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| base de datos de clientes (Excel, gratis, para descargar) | Info-transaccional | A | M | `/base/plantillas/base-de-datos-de-clientes/` |
| airtable en español, qué es airtable, alternativa a airtable | Info / comercial | B-M | B | `/base/alternativas/airtable/` |
| alternativa a excel, excel compartido entre varios usuarios | Mixta | M | M | `/base/alternativas/excel/` |
| app para administrar mi negocio, sistema para mi negocio | Comercial | M-A | A | Palabra secundaria de la landing |
| crear app sin programar (con IA), plataforma no code | Info-comercial | M | M-A | Blog |

Airtable no tiene sitio comercial en español (airtable.com/es da 404) y ClickUp solo tiene
la versión de España: hay espacio para «la alternativa hecha en Latinoamérica».

### C. Proyectos y tareas
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| software de gestión de proyectos (y tareas, gratuito) | Comercial | A | MA | `/base/proyectos/` |
| tablero kanban online, diagrama de gantt online gratis | Transaccional | M | M | `/base/proyectos/` + plantillas |
| alternativa a clickup / monday / notion | Comercial | B | M | `/base/alternativas/<x>/` |
| clickup vs notion, monday vs clickup, airtable vs notion | Info-comercial | B-M | M | Comparativas en el blog |

### D. Automatización
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| automatizar whatsapp (business, con IA) | Info-comercial | M-A | A | `/base/automatizaciones/` + guías |
| cómo automatizar mensajes en whatsapp business | Informacional | M | M | Guía en el blog |
| recordatorio de pago por whatsapp (ejemplos) | Informacional | B-M | B | Blog → `/base/cobros/` |

### E. Documentos y verticales (Colombia pesa más)
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| **cuenta de cobro** (formato, persona natural 2026, ejemplo), generador de cuentas de cobro | Transaccional | MA en CO | M | `/base/herramientas/generador-cuenta-de-cobro/` |
| plantilla de cotización, programa para hacer cotizaciones gratis | Transaccional | M-A | M | `/base/herramientas/generador-de-cotizaciones/` |
| control de cartera (en Excel), software de cartera, software de cobranza | Comercial / info | M | B-M | `/base/cobros/` |
| crm para inmobiliarias (colombia), software para inmobiliarias | Comercial | M | M | `/base/soluciones/inmobiliarias/` |
| software / app para agendar citas | Comercial | M | M-A | `/base/agenda-de-citas/` |
| sistema de tickets, software de tickets, software help desk | Comercial | M | A | `/base/mesa-de-ayuda/` (no uses «mesa de ayuda» a secas) |
| control de inventarios (Excel), software de inventario para pymes | Info / comercial | MA / A | A | `/base/inventario/` + plantilla |

**No compitas por «facturación electrónica»**: no corresponde y genera reclamos. Dilo
claro en la página: «no reemplaza la factura electrónica de la DIAN».

### F. WordPress y SEO (agencias y equipos de marketing)
Lo que muestra el autocompletado: «wordpress bulk edit» (y «… image alt text», «… media»,
«… posts»), «meta descripción caracteres / ejemplos / wordpress», «texto alternativo para
imágenes», «yoast seo vs rank math», «acf wordpress», «campos personalizados wordpress
plugin», «conectar wordpress con claude / n8n / odoo / base de datos», «crm para wordpress»,
«wordpress google sheets», «mantenimiento wordpress para agencias». En español la búsqueda
de edición masiva casi no existe: se busca en inglés. Hay espacio para ser la página en
español.
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| editar entradas de wordpress en masa, wordpress bulk edit (posts, media, alt text) | Transaccional | B-M | M | `/base/integraciones/wordpress/` |
| auditoría seo wordpress, revisar seo de todo el sitio | Comercial | B-M | M | `/base/integraciones/wordpress/` + guía |
| meta descripción (caracteres, ejemplos, wordpress), cuántos caracteres debe tener un título seo | Informacional | M-A | M | Herramienta `/base/herramientas/revisor-de-titulo-y-descripcion/` + blog |
| texto alternativo para imágenes (wordpress, con ia) | Informacional | M | B-M | Blog «Texto alternativo: qué es y cómo ponerlo a todo el sitio» |
| yoast seo vs rank math | Info-comercial | M | M | Blog (comparativa honesta: la app lee los dos) |
| acf wordpress, campos personalizados wordpress | Informacional | M | M | Guía «Edita tus campos de ACF como en Excel» |
| conectar wordpress con (claude, base de datos, google sheets) | Info-comercial | B-M | B | Blog + `/base/integraciones/wordpress/` |
| crm para wordpress, crm wordpress gratis | Comercial | M | M-A | `/base/integraciones/wordpress/` (el formulario del sitio crea registros) |
| wordpress para agencias, mantenimiento wordpress para agencias | Comercial | B | B-M | `/base/soluciones/agencias/` |

### G. SMS y mensajes de cobranza
Lo que muestra el autocompletado: «sms masivos colombia», «enviar sms masivos desde excel»,
«mensajes de texto masivos colombia (gratis)», «plataforma de sms masivos», «api sms
colombia», «sms de cobranza», «ejemplo sms de cobranza», «modelos de sms de cobranzas»,
«mensajes de cobranza (por whatsapp, efectivos, ejemplos)», «mensaje recordatorio de pago
(ejemplo, vencido, corto)», «cuántos caracteres tiene un sms», «labsmobile precios /
colombia / opiniones», «onurix sms», «recordatorio de citas por sms gratis». Y sobre la ley:
**«ley 2300 de 2023 (resumen, ¿está vigente?, artículo 3)»** y **«ley dejen de fregar
(horarios, 2026)»** — la gente la conoce por el apodo: úsalo en títulos y textos.
| Palabra clave | Intención | Vol. | Dif. | Página |
|---|---|---|---|---|
| sms masivos colombia, mensajes de texto masivos colombia, enviar sms masivos desde excel | Comercial | M-A | A | `/base/integraciones/sms/` |
| plataforma de sms masivos, api sms colombia | Comercial | M | A | `/base/integraciones/sms/` (con tu cuenta del proveedor) |
| ley 2300 de 2023 resumen, ley dejen de fregar horarios, horarios de cobranza en colombia | Informacional | M-A | M | Blog pilar «Ley Dejen de Fregar: horarios para cobrar por SMS, WhatsApp y llamadas» → `/base/cobros/` |
| sms de cobranza, modelos de sms de cobranzas, mensajes de cobranza ejemplos | Informacional | M | B-M | Blog «20 mensajes de cobranza por SMS y WhatsApp (que respetan la ley)» |
| mensaje recordatorio de pago (ejemplo, vencido, corto) | Informacional | M | B | Blog → `/base/cobros/` |
| cuántos caracteres tiene un sms, sms con tildes | Informacional | M | B | Herramienta `/base/herramientas/contador-de-sms/` |
| recordatorio de citas por sms | Comercial | B-M | M | `/base/agenda-de-citas/` |

**No compitas por «sms gratis» ni «enviar sms gratis desde pc»**: buscan mandar un mensaje
suelto sin pagar, y la app usa la cuenta (paga) del proveedor de cada empresa.

### H. Marca y comparaciones (a partir del segundo trimestre)
`hubspot vs pipedrive`, `alternativas a hubspot`, `bitrix24 vs hubspot`, `alternativa a
zapier`. Volumen bajo-medio, intención alta. «Imagina Base» todavía no tiene búsquedas de
marca: hay que construir la entidad (sección 7).

---

## 5. Arquitectura del sitio

```
imagina.cloud/base/                         Landing principal
├── precios/
├── crm/                                    CRM para pymes
├── crm-whatsapp/                           CRM con WhatsApp Business (API oficial)
├── cobros/                                 Cotizaciones, cuentas de cobro, cartera, links de pago
├── proyectos/   agenda-de-citas/   mesa-de-ayuda/   inventario/
├── automatizaciones/   ia/
├── soluciones/  inmobiliarias/ agencias/ clinicas-y-consultorios/ educacion/ …
├── plantillas/                             Hub (descarga Excel + «Abrir en Imagina Base»)
│   ├── crm/  base-de-datos-de-clientes/  control-de-inventario/
│   └── cuenta-de-cobro/  cotizacion/  seguimiento-de-proyectos/ …
├── alternativas/   airtable/ excel/ clickup/ monday/ notion/ hubspot/
├── herramientas/   generador-cuenta-de-cobro/ generador-de-cotizaciones/ calculadora-dias-habiles-colombia/
│                   contador-de-sms/ revisor-de-titulo-y-descripcion/
├── integraciones/  whatsapp/ wordpress/ sms/ woocommerce/ mercado-pago/ sql-server/
├── ideas/<caso>/                           Las 39 ideas, versión pública
├── ayuda/<modulo>/<articulo>/              El manual «Aprende», versión pública
├── seguridad/                              Ley 1581, exportación, copias
└── blog/<entrada>/
```

Reglas de URL: minúsculas, con guiones, sin tildes ni fechas, máximo dos niveles bajo
`/base/`.

### Las primeras 15 páginas, en orden
| # | Página | Palabra objetivo |
|---|---|---|
| 1 | `/base/` | CRM y gestión sin código para pymes |
| 2 | `/base/precios/` | cuánto cuesta un crm en colombia |
| 3 | `/base/crm/` | crm para pymes, crm en español |
| 4 | `/base/crm-whatsapp/` | crm con whatsapp business / api |
| 5 | `/base/cobros/` | control de cartera, software de cobranza, cotizaciones |
| 6 | `/base/herramientas/generador-cuenta-de-cobro/` | formato / generador de cuenta de cobro |
| 7 | `/base/plantillas/` | plantillas crm gratis |
| 8 | `/base/plantillas/crm/` | plantilla crm excel gratis |
| 9 | `/base/plantillas/base-de-datos-de-clientes/` | base de datos de clientes en excel |
| 10 | `/base/alternativas/airtable/` | airtable en español, alternativa a airtable |
| 11 | `/base/alternativas/excel/` | alternativa a excel para gestionar mi negocio |
| 12 | `/base/soluciones/inmobiliarias/` | crm para inmobiliarias colombia |
| 13 | `/base/blog/cuanto-cuesta-un-crm-en-colombia/` | (igual) |
| 14 | `/base/blog/como-crear-un-crm-sin-programar/` | cómo crear un crm (con IA) |
| 15 | `/base/proyectos/` | software de gestión de proyectos y tareas |

### Las siguientes 7 (SMS y WordPress)
| # | Página | Palabra objetivo |
|---|---|---|
| 16 | `/base/integraciones/wordpress/` | editar wordpress en masa, auditoría seo wordpress |
| 17 | `/base/soluciones/agencias/` | wordpress para agencias, administrar los sitios de tus clientes |
| 18 | `/base/integraciones/sms/` | sms masivos colombia, enviar sms desde excel |
| 19 | `/base/blog/ley-dejen-de-fregar-horarios/` | ley 2300 de 2023, ley dejen de fregar horarios |
| 20 | `/base/blog/mensajes-de-cobranza-ejemplos/` | sms de cobranza, mensajes de cobranza ejemplos |
| 21 | `/base/herramientas/contador-de-sms/` | cuántos caracteres tiene un sms (cuenta segmentos y tildes en vivo) |
| 22 | `/base/herramientas/revisor-de-titulo-y-descripcion/` | cuántos caracteres meta descripción / título seo |

Las dos herramientas son baratas de construir porque la lógica ya existe en la app: el
contador de SMS (`smsSegments`, GSM-7 y Unicode, quitar tildes) y el largo de título y
descripción que usa la auditoría SEO. Son las que más enlaces atraen de este grupo.

### Enlazado interno
- La home de **imagina.cloud** debe enlazar `/base/` de forma visible: así hereda autoridad.
- Esquema de hub y radios: cada página de solución enlaza 3-5 plantillas, una alternativa,
  precios y 2 entradas del blog. Cada entrada del blog enlaza **una** vez a su página
  comercial con texto descriptivo («CRM con WhatsApp»), nunca «aquí».
- Migas de pan visibles y un bloque «Relacionado» en plantillas, ideas y ayuda.
- Los botones hacia la app llevan `utm` (`base.imagina.cloud/registro?utm_source=sitio&utm_medium=landing&utm_campaign=<seccion>`),
  **los enlaces internos del sitio no** (crean URL duplicadas).

---

## 6. SEO técnico (WordPress en la raíz, landing en /base/)

- WordPress vive en la raíz de imagina.cloud, así que **/base/ es una página madre del
  mismo WordPress** (las páginas de la tabla de la sección 5 van como hijas:
  `/base/precios/`, `/base/crm-whatsapp/`…). Un solo sitio, un solo sitemap y un solo
  `robots.txt`, el de la raíz: deja que el plugin de SEO lo genere y confirma que incluye
  `Sitemap: https://imagina.cloud/sitemap_index.xml`.
- Search Console: una propiedad de dominio + una de prefijo `https://imagina.cloud/base/`.
- Canonical propio en cada página, barra final consistente, https y una sola variante de www.
- **hreflang: no por ahora.** Una sola versión en español neutro no lo necesita. No crees
  copias por país (`/co/`, `/mx/`) con el mismo texto. La moneda se resuelve con un
  selector, sin cambiar de URL.
- **Core Web Vitals** (medido en un Android de gama media con 4G):
  - Metas: LCP ≤ 2,0 s · INP ≤ 150 ms · CLS ≤ 0,05.
  - JavaScript propio ≤ 150 KB gzip; imagen del hero ≤ 100 KB en AVIF.
  - **El elemento LCP tiene que ser el H1 o un póster estático.** Un H1 con fundido de
    entrada (`opacity:0`) atrasa el LCP: anima lo que está alrededor, no el H1.
  - Videos con póster AVIF, `muted playsinline loop`, `preload="none"` debajo del pliegue y
    arranque al entrar en pantalla (IntersectionObserver). YouTube con «fachada».
  - Solo `transform` y `opacity`; respetar `prefers-reduced-motion`.
  - Cada imagen con `width`/`height` o `aspect-ratio`. Fuente Inter autoalojada (woff2,
    subconjunto latino), una sola precarga, `font-display: swap`.
  - Etiquetas de analítica, chat y píxeles después del consentimiento o de la primera
    interacción. `content-visibility:auto` en secciones lejanas.
- **WordPress:** tema de bloques o liviano (GeneratePress + GenerateBlocks, o Kadence
  Blocks) mejor que Elementor. **SEO:** Rank Math o Yoast (uno solo; desactiva su FAQ
  automático si duplica el tuyo). Caché de página (Cloudflare APO o la del hosting) y
  AVIF/WebP. WordPress 6.5+ ya sube AVIF.
- **La app (base.imagina.cloud) queda con noindex** y `robots.txt` abierto (así lo lee
  Google). Desde la versión 0.1.331 ya está así; lo que publican las empresas (formularios,
  agendas, portales) tampoco se indexa.
- **Idea de crecimiento:** una insignia «Hecho con Imagina Base» en los formularios y
  agendas públicas de los planes sin marca blanca (menciones y referidos).

### Checklist del día de lanzamiento

Hoy el sitio está cerrado a los buscadores a propósito. El día que publiques:
1. **WordPress → Ajustes → Lectura:** desmarca «Disuadir a los motores de búsqueda de
   indexar este sitio» (si queda marcado, WordPress responde `noindex` y el `robots.txt`
   bloquea todo).
2. Abre `https://imagina.cloud/robots.txt` y confirma que **no** dice `Disallow: /` y que
   trae la línea `Sitemap:`.
3. Que ninguna capa bloquee a los robots: el modo «en construcción» o «mantenimiento» del
   tema o de un plugin, una contraseña del hosting y, si usas Cloudflare, «Bot Fight Mode»
   o reglas de WAF (Security → Events). Deben pasar Googlebot, Bingbot, OAI-SearchBot y
   PerplexityBot.
4. Revisa con «Ver código fuente» que la página no tenga
   `<meta name="robots" content="noindex">`.
5. **Search Console:** agrega la propiedad, envía el sitemap y usa «Inspeccionar URL» →
   «Probar URL publicada» en `/base/`. Debe decir «Se puede indexar». Luego «Solicitar
   indexación».
6. **Bing Webmaster Tools:** importa la propiedad desde Search Console (Bing alimenta a
   ChatGPT).
7. Plataforma → Marca → «Sitio del producto» = `https://imagina.cloud/base` en la app.

---

## 7. Confianza, reseñas y enlaces en Latinoamérica

- **Google Business Profile:** solo si Imagina tiene oficina real que atiende clientes;
  un SaaS solo en línea no califica. No inventes uno.
- **Directorios de reseñas:** Capterra (.co, .mx, .es), GetApp y Software Advice ahora son
  de G2 (desde febrero de 2026). Además: G2 en español, ComparaSoftware (fuerte en LATAM),
  Appvizer.es, AlternativeTo (clave para «alternativa a…») y Product Hunt. Pide reseñas en
  español justo después de que la persona ve el valor (primera automatización, primer
  cobro pagado).
- **Enlaces, por valor/esfuerzo:**
  1. Herramientas gratis: generador de cuenta de cobro, generador de cotizaciones,
     calculadora de días hábiles con festivos de Colombia (la app ya los calcula).
  2. Investigación propia: «Cuánto cuesta un CRM en Colombia 2026» (tabla en COP) y
     «Cómo se organizan las pymes colombianas» con datos agregados y anónimos. Ofrecerla a
     Enter.co, Portafolio, La República, Xataka Colombia, Impacto TIC.
  3. Ecosistema propio: imagina.cloud, la comunidad de Imagina WP, el conector de
     WooCommerce y el **complemento de WordPress** (una página propia del complemento con
     su descripción, capturas y enlace a `/base/integraciones/wordpress/`; publicarlo en
     el directorio de wordpress.org sería el enlace más fuerte del grupo, pero exige
     revisar sus reglas antes).
  3-bis. Proveedores de SMS (Onurix, LabsMobile, BulkGate, Infobip, Twilio): pregúntales si
     tienen una página de integraciones o de socios donde aparecer.
  4. Programas y gremios: iNNpulsa, Centros de Transformación Digital de MinTIC, Cámara de
     Comercio de Bogotá, SENA/Fondo Emprender, universidades.
  5. Alianzas con contadores y agencias que implementen, con página de socios.

---

## 8. Que las IA te citen (Google AI Overviews / AI Mode, ChatGPT, Perplexity)

- AI Overviews está en Colombia y México desde 2024; AI Mode en español en LATAM desde
  septiembre de 2025.
- Google no pide marcado especial: indexable, buen enlazado interno y lo importante **en
  texto**. `llms.txt` es opcional.
- **Permite OAI-SearchBot** (sin él no apareces en ChatGPT Search; GPTBot es solo para
  entrenamiento) y **PerplexityBot**, por user-agent y por rangos de IP en Cloudflare.
- Lo que más pesa según Ahrefs (75.000 marcas): las **menciones de la marca en la web**
  (más que los backlinks). Entra en los listados «mejores CRM para pymes en Colombia»,
  «alternativas a Airtable», directorios, YouTube en español y comunidades.
- **Cómo escribir:**
  - Una frase que defina la entidad, idéntica en todos lados: *«Imagina Base es una
    plataforma sin código para que las pymes de Latinoamérica armen su CRM, cobros y
    proyectos, con WhatsApp oficial.»*
  - Respuesta primero (2-3 frases bajo cada H2), detalle después.
  - Tablas y precios en texto HTML; fecha de «actualizado» visible.
  - Comparativas con evidencia, ventajas **y** desventajas.
- **Cuidado al publicar a escala** (ideas, plantillas, ayuda): cada página tiene que aportar
  algo propio (capturas, pasos reales, plantilla descargable) o cae en «abuso de contenido
  a escala».
- **Medir:** Search Console, visitas desde chatgpt.com y perplexity.ai, 20 preguntas fijas
  revisadas cada mes, y las altas por origen en Plataforma → Empresas (la app ya las
  registra).

---

## 9. Fuentes principales

- Autocompletado: https://blog.google/products/search/how-google-autocomplete-predictions-work/
- FAQ sin resultado enriquecido: https://developers.google.com/search/docs/appearance/structured-data/faqpage · https://www.searchenginejournal.com/google-drops-faq-rich-results/574429/
- Software App / reseñas: https://developers.google.com/search/docs/appearance/structured-data/software-app · https://developers.google.com/search/docs/appearance/structured-data/review-snippet
- Títulos: https://developers.google.com/search/docs/appearance/title-link
- hreflang: https://developers.google.com/search/docs/specialty/international/localized-versions
- Core Web Vitals / LCP: https://web.dev/articles/vitals · https://web.dev/articles/lcp
- Funciones de IA en Google: https://developers.google.com/search/docs/appearance/ai-features
- Menciones vs. enlaces (Ahrefs): https://ahrefs.com/blog/ai-overview-brand-correlation/
- Rastreadores: https://developers.openai.com/api/docs/bots · https://docs.perplexity.ai/guides/bots
- Spam a escala: https://developers.google.com/search/docs/essentials/spam-policies
- WordPress AVIF: https://make.wordpress.org/core/2024/02/23/wordpress-6-5-adds-avif-support/
- Capterra → G2: https://www.nasdaq.com/press-release/g2-acquire-capterra-software-advice-and-getapp-gartner-2026-01-29
