# Kit de landing — Imagina Base (imagina.cloud/base)

Todo lo necesario para que Claude Design diseñe la landing y para publicarla en WordPress
bien posicionada.

## Qué hay en la carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `01-PROMPT-CLAUDE-DESIGN.md` | **Empieza aquí.** Pasos, qué archivos subir, el prompt principal para pegar y 7 prompts de seguimiento |
| `02-TEXTOS-LANDING.md` | Todos los textos de la página, sección por sección, listos para usar (y preguntas frecuentes) |
| `03-SEO.md` | Título, meta descripción, encabezados, JSON-LD, palabras clave, arquitectura del sitio, las primeras 15 páginas, SEO técnico en WordPress y visibilidad en las IA |
| `04-MOTION.md` | Dirección de animaciones: 15 ideas, tiempos, curvas, rendimiento y accesibilidad, y qué video usar en cada sección |
| `05-COMPETENCIA.md` | Cómo venden ClickUp, Airtable, monday, Notion, HubSpot, Pipedrive, Bitrix24 y otros, y la oportunidad que dejan |
| `06-CAPTURAS-Y-VIDEOS.md` | Índice de cada captura y video, y dónde usarlo |
| `capturas/escritorio/` | 27 capturas reales de la app (2880×1800) |
| `capturas/oscuro/` | 6 capturas en modo oscuro |
| `capturas/celular/` | 8 capturas de celular (1170×2532) |
| `motion/animaciones/` | 18 animaciones de la marca (MP4 + WebM, loops de 7 s) |
| `motion/app/` | Clips de la app en uso con cursor (MP4 + WebM) |
| `marca/` | Logo (claro y oscuro) e ícono, del servidor de producción |

## Antes de publicar, confirma

Busca **[CONFIRMAR]** en `02-TEXTOS-LANDING.md`:
1. **Plan gratis**: en la configuración inicial el plan «Trial» no vence (500 registros,
   3 personas, 3 automatizaciones). Si vas a limitarlo en el tiempo, cambia «gratis» por
   «prueba gratis de N días».
2. **Precios** (Plataforma → Planes): los del documento son los de la configuración
   inicial (Starter $59.000 COP / US$15, Pro $199.000 COP / US$49).
3. **Medios de pago activos** (Plataforma → Cobros): PSE, Nequi, tarjeta y efectivo
   dependen de tener Mercado Pago configurado; dólares, de PayPal.
4. **IA de la plataforma** activa y compartida con las empresas (Plataforma → Asistente IA).
5. **Canal de soporte** (WhatsApp / correo) y si ofreces ayuda para migrar datos.

## Tres tareas técnicas que conviene hacer ya

1. **Plataforma → Marca → «Sitio del producto»** = `https://imagina.cloud/base` (aparece
   «Conoce Imagina Base» en el login).
2. Botones del sitio a
   `https://base.imagina.cloud/registro?utm_source=sitio&utm_medium=landing&utm_campaign=<seccion>`
   (la consola muestra «Desde sitio» en cada alta).
3. **Cloudflare de imagina.cloud**: revisa que no bloquee a Googlebot, OAI-SearchBot ni
   PerplexityBot (en la investigación, el sitio respondió 403 a un cliente automático).
