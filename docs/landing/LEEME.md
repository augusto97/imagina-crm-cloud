# Kit de landing — Imagina Base (imagina.cloud/base)

Todo lo necesario para que Claude Design diseñe la landing y para publicarla en WordPress
bien posicionada.

## Qué hay en la carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `01-PROMPT-CLAUDE-DESIGN.md` | **Empieza aquí.** Pasos, qué archivos subir, el prompt principal para pegar y 8 prompts de seguimiento |
| `02-TEXTOS-LANDING.md` | Todos los textos de la página, sección por sección, listos para usar (y preguntas frecuentes) |
| `03-SEO.md` | Título, meta descripción, encabezados, JSON-LD, palabras clave, arquitectura del sitio, las primeras 15 páginas, SEO técnico en WordPress y visibilidad en las IA |
| `04-MOTION.md` | Dirección de animaciones: 17 ideas, tiempos, curvas, rendimiento y accesibilidad, y qué video usar en cada sección |
| `05-COMPETENCIA.md` | Cómo venden ClickUp, Airtable, monday, Notion, HubSpot, Pipedrive, Bitrix24 y otros, y la oportunidad que dejan |
| `06-CAPTURAS-Y-VIDEOS.md` | Índice de cada captura y video, y dónde usarlo |
| `capturas/escritorio/` | 42 capturas reales de la app (2880×1800), incluidas WordPress (28-36) y SMS (37-41) |
| `capturas/oscuro/` | 9 capturas en modo oscuro |
| `capturas/celular/` | 11 capturas de celular (1170×2532) |
| `motion/animaciones/` | 18 animaciones de la marca (MP4 + WebM, loops de 7 s) |
| `motion/app/` | Clips de la app en uso con cursor (MP4 + WebM) |
| `marca/` | Logo (claro y oscuro) e ícono, del servidor de producción |

## Decisiones ya tomadas (están en los textos)

- **Prueba gratis de 15 días, sin tarjeta.** Durante la prueba: 500 registros, 3 personas y
  3 automatizaciones.
- **Precios:** Starter $59.000 COP / US$15 y Pro $199.000 COP / US$49 al mes, por empresa
  (los vas a ajustar: cámbialos en Plataforma → Planes y en `02-TEXTOS-LANDING.md`).
- **Asistente IA y soporte en español: solo en los planes de pago.** Los textos lo dicen
  así, sin esconderlo.
- **Importador de Excel casi automático:** es el camino principal de «Cómo empiezas».
- **WordPress y SMS (versiones 0.1.332 a 0.1.336)** entran como dos bloques propios
  (12-A y 12-B en `02-TEXTOS-LANDING.md`), una pestaña en «Una base. Todo tu negocio.»,
  cinco preguntas frecuentes nuevas y dos grupos de palabras clave en `03-SEO.md`.

## Antes de publicar, confirma

Busca **[CONFIRMAR]** en `02-TEXTOS-LANDING.md`:
1. **Medios de pago activos** (Plataforma → Cobros): PSE, Nequi, tarjeta y efectivo
   dependen de tener Mercado Pago configurado; dólares, de PayPal.
2. **Redes sociales** del pie y del JSON-LD (LinkedIn, YouTube, Instagram…).
3. **No prometas «actualizaciones firmadas» del complemento de WordPress** hasta cargar el
   secreto `RELEASE_SIGNING_KEY` en GitHub (hoy los releases salen sin firma). Los textos
   ya lo evitan: hablan de un complemento liviano que respeta los permisos.
4. **El video «Ver cómo funciona (2 min)» del hero todavía no existe.** Se puede armar con
   los clips de `motion/app/` (ver «Ideas para sumar», punto 6).

## Tareas en la app y en el sitio

1. **Plataforma → Marca → «Sitio del producto»** = `https://imagina.cloud/base` (aparece
   «Conoce Imagina Base» en el login).
2. Botones del sitio a
   `https://base.imagina.cloud/registro?utm_source=sitio&utm_medium=landing&utm_campaign=<seccion>`
   (la consola muestra «Desde sitio» en cada alta).
3. **Plataforma → Planes → Trial:** pon «IA/mes» en **0** para que la IA quede solo en los
   planes de pago (hoy la semilla le da 20). Ojo: con 0, la opción «Cuéntanos de tu
   negocio» de la bienvenida aparece deshabilitada en la prueba; quedan las plantillas y
   el Excel, que es justo lo que la landing promete.
4. **Los 15 días todavía no los aplica la app:** hoy el plan Trial no vence. Hasta que se
   implemente el vencimiento, la prueba sigue abierta (ver el hilo en `CONTINUIDAD.md`).
5. **El día del lanzamiento**, abre el sitio a los buscadores: checklist en `03-SEO.md`,
   sección 6 (hoy está cerrado a propósito).

## Ideas para sumar a la landing (propuestas, no están en los textos)

1. **Página para agencias** (`/base/soluciones/agencias/`): el público que más gana con
   WordPress + marca blanca. Mensaje: «Los sitios de tus clientes, su CRM y sus cobros, desde
   un solo lugar y con tu marca». Bloques: conectar varios sitios, auditoría SEO de todos,
   textos alternativos con IA, portal con la marca de la agencia, una empresa por cliente.
2. **Dos herramientas gratis** que atraen visitas y enlaces, baratas porque la lógica ya
   está en la app: el **contador de SMS** (cuántos mensajes ocupa un texto, qué letras lo
   pasan a Unicode, botón «quitar tildes») y el **revisor de título y meta descripción**
   (largo en caracteres y cómo se vería en Google).
3. **Guía «Ley Dejen de Fregar»** (Ley 2300 de 2023): horarios para cobrar por SMS,
   WhatsApp y llamadas, con ejemplos de mensajes. La gente la busca por el apodo; enlaza
   a `/base/cobros/` y a `/base/integraciones/sms/`.
4. **Plantillas descargables de mensajes de cobranza** (SMS y WhatsApp, del recordatorio
   amable al aviso de mora) con el botón «Úsalas en Imagina Base».
5. **Página del complemento de WordPress** en el sitio: qué hace, qué plugins reconoce
   (Rank Math, Yoast, SEOPress, All in One SEO, ACF, Meta Box, JetEngine), por qué no pone
   lento el sitio y la captura `36-wordpress-complemento-en-el-sitio.png`. A mediano plazo,
   publicarlo en el directorio de wordpress.org (revisar antes sus reglas).
6. **El video del hero (60-90 s)** con los clips de `motion/app/`: subir un Excel → kanban
   → automatización de cobro → SMS que sale → la entrada de WordPress que se corrige → el
   tablero. Sin voz, con subtítulos cortos.
7. **Casos por industria que usan WordPress:** inmobiliaria (fichas de inmuebles con
   campos ACF editadas en lote), restaurante o marca de alimentos (recetas y menú), tienda
   con blog (SEO de las entradas y del catálogo).
8. **Contador «tiempo que ahorras»** en la sección WordPress: «revisar el SEO de 200
   entradas a mano: una tarde; aquí: una vista». Solo si se puede respaldar con una prueba
   real; si no, déjalo fuera.
