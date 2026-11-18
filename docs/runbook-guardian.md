# Reparación automática del servidor, avisos y monitoreo externo (ADR-S104, v0.1.431 / v0.1.432 / v0.1.435)

Tres piezas que se complementan:

| Pieza | Dónde corre | Qué hace | Qué NO puede hacer |
|---|---|---|---|
| **Guardián** (reparación automática) | En el servidor, como **root**, cada minuto (timer de systemd) | Revisa la app, Postgres, Redis, Nginx/Caddy, la entrada por el dominio y el disco; reinicia, vuelve a la versión anterior, repone el Nginx que reescribe ServerAvatar, libera espacio | Avisar por correo (no tiene SMTP): lo hace la app cuando vuelve |
| **Avisos al operador** | Dentro de la app (cola `platform-watch`, cada minuto) | Correo a `PLATFORM_SUPERADMINS` cuando falla o se atrasa una copia, hay que reconectar Drive, una actualización no se instaló o se revirtió, vence el certificado, la app no abre desde afuera, y con lo que reparó (o no pudo) el guardián | Avisar si el servidor entero está apagado |
| **Monitoreo externo** (Better Stack) | Fuera del servidor | Te avisa cuando deja de recibir el latido de la app o cuando la app no responde por el dominio | — |

La consola lo muestra todo en **Plataforma → Diagnóstico** (tarjetas *Avisos
del servidor*, *Reparación automática del servidor* y *Monitoreo externo*).

Y si la app no abre (v0.1.432), dos salidas que no dependen de ella:

- **Comandos por SSH** (como root): `imagina-estado`, `imagina-reparar`,
  `imagina-rescate` (§1.1).
- **Página de rescate**: `https://tu-dominio:8899`, un servicio aparte con
  clave (§1.2).

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
Opciones: `--puerto 8898` (otro puerto para la página de rescate),
`--sin-rescate` (no instalarla; los comandos por SSH sí), `--un-proceso` y
`--procesos-separados` (§1.3).

Al terminar imprime el informe (`status.json`), los comandos por SSH y la
dirección y **la clave de la página de rescate — se muestra UNA vez**: guárdala
en tu gestor de contraseñas. En la consola, la tarjeta pasa a **Activa** en
menos de un minuto.

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
| `imagina-guardian.service` / `.timer` / `.path` | Cada minuto + al instante cuando hay un pedido (de la app o de la página de rescate) |
| `/usr/local/bin/imagina-estado`, `imagina-reparar`, `imagina-rescate` | Los comandos por SSH (v0.1.432) |
| `/usr/local/lib/imagina-base/imagina-rescue.mjs` + `imagina-rescue.service` | La página de rescate (v0.1.432) |
| `/etc/imagina-base/rescue.conf` (root, 0600) | Puerto, hash de la clave (scrypt) y secreto de las sesiones |
| `/etc/imagina-base/rescue-tls.conf` | Qué certificado usa la página (lo escribe el guardián) |
| `/var/lib/imagina-base/guardian/rescue/` (root:imagina-rescue, 0750) | Pedidos de la página (`requests/`), quién entró (`audit.jsonl`) y lo último que dijo la app (`app-log.txt`) |
| `imagina-worker.service` (v0.1.435) | El proceso de los trabajos en segundo plano (§1.3) |
| `/etc/systemd/system/imagina-api.service.d/10-imagina.conf` (v0.1.435) | El papel del proceso de la app (`IMAGINA_ROLE=api` con procesos separados) y `KillMode=process` |
| `/etc/sudoers.d/imagina-base` (0440, v0.1.435) | Deja que el usuario de la app haga `systemctl restart\|start\|stop` de **sus dos** servicios (nada más). Se valida con `visudo` |

La app **nunca** ejecuta nada como root: sólo lee el informe y deja un archivo
vacío para pedir una revisión.

### 1.1 Comandos por SSH (v0.1.432)

Entrar por SSH al servidor (como lo haces siempre) y, como root:

| Comando | Qué hace |
|---|---|
| `imagina-estado` | Dice en palabras cómo está todo: ✓ lo que funciona, ✗ lo que no. **No cambia nada.** |
| `imagina-reparar` | Revisa todo y arregla lo que encuentre, **ya** y sin los límites por hora del guardián |
| `imagina-reparar reiniciar` | Reinicia la app |
| `imagina-reparar version-anterior` | Vuelve a la versión anterior (sólo el código; pide escribir `SI`) |
| `imagina-reparar espacio` | Libera espacio aunque el disco no esté lleno |
| `imagina-rescate` | La dirección de la página de rescate y si funciona |
| `imagina-rescate clave` | Clave nueva para la página (la anterior deja de servir y se cierran las sesiones) |
| `imagina-rescate apagar` / `encender` | Apaga o prende la página de rescate |

Son atajos al mismo guardián (`imagina-guardian.sh --check --human`,
`--force`, `--restart`, `--rollback`, `--cleanup`): lo que hacen queda en sus
eventos y llega por correo como «Se hizo lo que pediste en el servidor».

### 1.2 Página de rescate (v0.1.432)

`https://tu-dominio:8899` — un servicio aparte (`imagina-rescue`) que **no pasa
por la app ni por Nginx**: si la app no abre (o Nginx quedó roto), esta página
sí. Con la clave muestra lo que ve el guardián, lo último que hizo, lo último
que dijo la app, y deja **Reparar ahora**, **Reiniciar la app**, **Volver a la
versión anterior** (con confirmación) y **Liberar espacio**.

**Abrir el puerto** (una vez): el instalador abre `8899/tcp` en `ufw` si está
activo, pero el firewall del panel y el del proveedor se abren aparte:

- **ServerAvatar**: el servidor → **Firewall** → agregar regla TCP, puerto `8899`.
- Hetzner Cloud / AWS / DigitalOcean / Vultr: en el firewall de la nube, si lo usas.

**Certificado**: usa el del dominio (lo encuentra en la configuración de Nginx,
en el almacén de Caddy o en `/etc/letsencrypt`) y se reinicia sola cuando se
renueva. Si no lo encuentra usa uno propio y el navegador avisa «no es seguro»
(ábrela igual: Avanzado → Continuar).

**Seguridad**:

- No puede ejecutar nada: deja un archivo **vacío** con el nombre del pedido
  (`repair-`, `restart-`, `rollback-`, `cleanup-`) y el guardián lo hace. El
  contenido nunca se lee.
- Arranca como root sólo para leer el certificado y abrir el puerto, y
  enseguida pasa al usuario `imagina-rescue` (sin permisos; systemd además le
  pone `ProtectSystem=strict` y sólo puede escribir en su carpeta).
- Clave con hash scrypt; cookie `HttpOnly`, `Secure`, `SameSite=Strict`, 2 h;
  token en cada formulario; 5 claves equivocadas bloquean esa IP 15 minutos.
- **Cada vez que alguien entra te llega un correo** («Entraron a la página de
  rescate del servidor», con la IP). Si no fuiste tú: `imagina-rescate clave`.
- Sin JavaScript; CSP `default-src 'none'`; no se indexa.

Si la página no arranca, el guardián la vuelve a levantar y, si sigue sin
arrancar, llega un aviso «La página de rescate del servidor no arranca» (la app
no se ve afectada). `journalctl -u imagina-rescue -n 20` dice por qué (lo más
común: el puerto lo usa otro programa → reinstala con `--puerto 8898`).

### 1.3 Dos procesos: la app y los trabajos en segundo plano (v0.1.435)

Hasta v0.1.434 un solo proceso atendía a las personas **y** corría las
automatizaciones, los correos, las sincronizaciones, las copias y los
barridos. Un trabajo pesado (una sincronización grande, un PDF largo) le
quitaba tiempo a las pantallas; y si ese proceso se caía, se caía todo.

Ahora el instalador los separa:

| Servicio | Papel | Puerto |
|---|---|---|
| `imagina-api` | Atiende a las personas (la app, el API, lo público). **No** corre trabajos | el de siempre (3900) |
| `imagina-worker` | Corre las colas y los barridos. No atiende a nadie | `127.0.0.1:3901` (sólo para que el guardián le pregunte si está bien) |

- **Se separan solo si el servidor tiene al menos 1,5 GB de RAM** (cada uno
  usa unos 300-500 MB). Con menos, queda en un solo proceso como antes.
- `--un-proceso` lo deja (o lo vuelve) a un solo proceso; `--procesos-separados`
  lo fuerza. La elección se recuerda al volver a correr el instalador.
- Si el proceso nuevo no arranca, el instalador lo apaga, deja todo en un solo
  proceso y muestra por qué.
- **Al actualizar** se reinician los dos (el de los trabajos, además, se da
  cuenta solo cuando cambia la versión y se reinicia). **Al restaurar una
  copia** se detienen los dos y se arrancan al terminar, así nada escribe en
  una base a medio restaurar.
- **El guardián** también revisa el de los trabajos: si no responde dos
  minutos seguidos lo reinicia (3 por hora; después «necesita que lo
  revises»). `imagina-reparar reiniciar` reinicia los dos.
- **La app avisa** si no ve ningún proceso de trabajos durante 3 minutos
  («Los trabajos en segundo plano están detenidos»), y Plataforma →
  Diagnóstico → Reparación automática muestra «Procesos separados» o «Un solo
  proceso».

Por consola:

```bash
systemctl status imagina-worker
journalctl -u imagina-worker -n 50
```

### Qué repara y con qué límites

| Problema | Qué hace | Límite |
|---|---|---|
| Postgres detenido | `docker start` | — |
| Redis detenido | `systemctl restart` | 3 por hora |
| La app no responde (3 minutos seguidos, o al instante con «Reparar ahora») | Si la versión tiene menos de 30 minutos, **vuelve a la anterior** (una sola vez); si no, reinicia | 3 reinicios por hora; después avisa «necesita que lo revises» |
| Los trabajos en segundo plano no responden (2 minutos seguidos; sólo con procesos separados) | Reinicia `imagina-worker` (no durante una actualización) | 3 por hora; después avisa |
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
systemctl disable --now imagina-guardian.timer imagina-guardian.path imagina-rescue imagina-worker
rm -f /etc/systemd/system/imagina-guardian.{service,timer,path} /etc/systemd/system/imagina-{rescue,worker}.service
rm -rf /etc/systemd/system/imagina-api.service.d /etc/sudoers.d/imagina-base
systemctl daemon-reload && systemctl restart imagina-api   # vuelve a un solo proceso
rm -f /usr/local/bin/imagina-estado /usr/local/bin/imagina-reparar /usr/local/bin/imagina-rescate
rm -rf /usr/local/lib/imagina-base /etc/imagina-base /var/lib/imagina-base/guardian
userdel imagina-rescue
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
| Se hizo lo que pediste en el servidor (por SSH o la página de rescate) | Para saber | — |
| Entraron a la página de rescate / claves equivocadas | Revisar | — (cada vez) |
| La página de rescate no arranca | Revisar | 24 h |

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
