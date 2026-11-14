# Reparación automática del servidor, avisos y monitoreo externo (ADR-S104, v0.1.431)

Tres piezas que se complementan:

| Pieza | Dónde corre | Qué hace | Qué NO puede hacer |
|---|---|---|---|
| **Guardián** (reparación automática) | En el servidor, como **root**, cada minuto (timer de systemd) | Revisa la app, Postgres, Redis, Nginx/Caddy, la entrada por el dominio y el disco; reinicia, vuelve a la versión anterior, repone el Nginx que reescribe ServerAvatar, libera espacio | Avisar por correo (no tiene SMTP): lo hace la app cuando vuelve |
| **Avisos al operador** | Dentro de la app (cola `platform-watch`, cada minuto) | Correo a `PLATFORM_SUPERADMINS` cuando falla o se atrasa una copia, hay que reconectar Drive, una actualización no se instaló o se revirtió, vence el certificado, la app no abre desde afuera, y con lo que reparó (o no pudo) el guardián | Avisar si el servidor entero está apagado |
| **Monitoreo externo** (Better Stack) | Fuera del servidor | Te avisa cuando deja de recibir el latido de la app o cuando la app no responde por el dominio | — |

La consola lo muestra todo en **Plataforma → Diagnóstico** (tarjetas *Avisos
del servidor*, *Reparación automática del servidor* y *Monitoreo externo*).

---

## 1. Instalar el guardián (una vez, como root)

Requiere una versión ≥ v0.1.431 instalada. Por SSH:

```bash
sudo -i                                   # o entrar como root
bash /opt/imagina-base/current/deploy/install-guardian.sh
```

Detecta solo:

- el dominio (de `APP_BASE_URL` en `shared/.env.production`) y el puerto del API;
- el contenedor de Postgres y el servicio de Redis;
- el usuario del servicio `imagina-api` (el que puede dejar pedidos de «Reparar ahora»);
- el servidor web: **Caddy** si está activo; si no, Nginx — si el sitio ya usa
  `include /etc/nginx/imagina-base.locations` es **ServerAvatar**; si el sitio
  todavía tiene la configuración PHP de ServerAvatar, la repara en el momento.

Si el dominio no sale bien, pásalo: `bash …/install-guardian.sh base.tu-dominio.com`.

Al terminar imprime el informe (`status.json`). En la consola, la tarjeta pasa a
**Activa** en menos de un minuto.

**Volver a correrlo** es seguro (idempotente). Se vuelve a correr cuando la
consola avisa «Hay una versión nueva de la reparación automática».

### Qué instala

| Ruta | Qué es |
|---|---|
| `/usr/local/lib/imagina-base/imagina-guardian.sh` | El guardián (root, 0755) |
| `/usr/local/lib/imagina-base/serveravatar-nginx.sh` | El que repone el Nginx de ServerAvatar |
| `/etc/imagina-base/guardian.conf` | Lo detectado (dominio, puertos, modo del servidor web) |
| `/var/lib/imagina-base/guardian/status.json`, `events.jsonl` | El informe que lee la app (0644) |
| `/var/lib/imagina-base/guardian/requests/` | Pedidos de «Reparar ahora» (del usuario de la app, 0700). El guardián los borra **sin leerlos** |
| `imagina-guardian.service` / `.timer` / `.path` | Cada minuto + al instante cuando hay un pedido |

La app **nunca** ejecuta nada como root: sólo lee el informe y deja un archivo
vacío para pedir una revisión.

### Qué repara y con qué límites

| Problema | Qué hace | Límite |
|---|---|---|
| Postgres detenido | `docker start` | — |
| Redis detenido | `systemctl restart` | 3 por hora |
| La app no responde (3 minutos seguidos, o al instante con «Reparar ahora») | Si la versión tiene menos de 30 minutos, **vuelve a la anterior** (una sola vez); si no, reinicia | 3 reinicios por hora; después avisa «necesita que lo revises» |
| Nginx/Caddy detenido | Lo inicia (Nginx sólo si `nginx -t` pasa) | — |
| La app no abre por el dominio (ServerAvatar) | Repone la configuración de Nginx | 6 por hora; después avisa |
| Disco lleno (< 1 GB o 5 %, o pocos inodos) | Borra versiones viejas (deja la actual + 2), copias previas a actualizaciones (deja 5), restos de actualizaciones, el journal, la caché de apt y las imágenes de Docker sin usar | 2 por hora |

No toca nunca datos: ni la base, ni los archivos subidos, ni las copias de
seguridad diarias.

### Revisarlo por consola

```bash
systemctl status imagina-guardian.timer
cat /var/lib/imagina-base/guardian/status.json
tail -n 20 /var/lib/imagina-base/guardian/events.jsonl
journalctl -u imagina-guardian.service -n 50
```

### Desinstalarlo

```bash
systemctl disable --now imagina-guardian.timer imagina-guardian.path
rm -f /etc/systemd/system/imagina-guardian.{service,timer,path}
systemctl daemon-reload
rm -rf /usr/local/lib/imagina-base /etc/imagina-base /var/lib/imagina-base/guardian
```

---

## 2. Avisos por correo

Llegan a cada correo de `PLATFORM_SUPERADMINS` por el **correo de la
plataforma** (Plataforma → Correo). Si no está configurado, la tarjeta
*Avisos del servidor* lo dice y los avisos quedan sólo en el panel.

| Aviso | Gravedad | Cada cuánto se recuerda |
|---|---|---|
| La copia de seguridad falló | Urgente | 24 h |
| No hay una copia reciente (más de 36 h con las automáticas encendidas) | Revisar | 24 h |
| Las copias automáticas están apagadas / no salen del servidor | Revisar | Una sola vez |
| Hay que reconectar Google Drive / la última subida falló | Urgente | (el correo lo manda la subida a Drive, cada 12 h) |
| La actualización no se pudo instalar / se revirtió | Urgente / Revisar | 72 h |
| El certificado vence en menos de 14 días (urgente con menos de 3) | Revisar / Urgente | 72 h / 12 h |
| La app no abre desde afuera (3 minutos seguidos) | Urgente | 6 h |
| La reparación automática no está instalada / dejó de revisar | Revisar | 72 h / 24 h |
| La reparación automática no pudo arreglar algo | Urgente | 6 h |
| El servidor se reparó solo | Para saber | — (un correo por tanda) |

Cuando algo avisado se arregla, llega «Ya está bien: …». **Ya lo vi** en el
panel cierra un aviso sin correo y la misma clave no vuelve por 30 días.

---

## 3. Better Stack (Better Uptime)

Con dos monitores cubres los dos casos que la app no puede avisar sola.

### 3.1 Heartbeat — el servidor entero se apagó o algo interno falla

1. En Better Stack → **Uptime → Heartbeats → Create heartbeat**.
2. Nombre: «Servidor de la app». **Expected every**: 1 minute.
   **Grace period**: 3-5 minutes (evita avisos por un reinicio).
3. Elige a quién avisar (correo, SMS, llamada, app).
4. Copia la **URL del heartbeat** (`https://uptime.betterstack.com/api/v1/heartbeat/…`).
5. En la app: **Plataforma → Diagnóstico → Monitoreo externo**, pégala,
   **Guardar** y **Probar**. En Better Stack el heartbeat pasa a *Up*.

La app late cada minuto mientras todo está bien. Si la base no responde, la app
no abre por el dominio o el disco está lleno, en vez de latir le avisa la
**falla** al momento (`…/fail`). Si el servidor se apaga, simplemente deja de
latir y Better Stack avisa al pasar el *grace period*.

### 3.2 Monitor por el dominio — la app no abre desde afuera

1. Better Stack → **Uptime → Monitors → Create monitor**.
2. **Alert us when**: *URL doesn't contain keyword*.
3. **URL**: `https://<tu-dominio>/api/v1/health/ready` (la tarjeta la muestra
   para copiar). **Keyword**: `"status":"ready"`.
4. **Check frequency**: 3 minutes. **Confirmation period** (o *recovery*):
   2-3 minutes, así un reinicio del guardián no te despierta.
5. Activa **SSL certificate expiration** (avisa ~14 días antes) y,
   opcionalmente, un segundo monitor tipo *Status code 200* sobre
   `https://<tu-dominio>/` para la página de entrada.

Si usas Cloudflare delante de lo insertado (ADR-S102), monitorea también la
dirección rápida: `https://w.<tu-dominio>/api/v1/public/f/embed.js` con *status 200*.

### Otros servicios

Healthchecks.io también entiende `…/fail`. Cualquier otro servicio de
heartbeat que reciba un GET sirve: si no entiende `/fail`, la app deja de latir
cuando algo falla y el servicio avisa igual (unos minutos más tarde).
