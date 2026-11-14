# Runbook — Dominios de las empresas (equipo, portal de clientes y tiendas)

Cada empresa puede usar hasta **dos dominios propios** (Ajustes → Marca):

| Dominio | Para quién | Qué abre |
|---|---|---|
| **Dominio personalizado** (`crm.acme.com`) | Su equipo | La app, con su marca desde el login |
| **Dominio del portal de clientes** (`clientes.acme.com`) — v0.1.245 | Sus clientes | Directo el portal, con su logo, color y nombre. Nunca muestra la app del equipo |
| **Dominio de una tienda** (`tienda.acme.com`) — v0.1.423 | Quien compra | La tienda, con una dirección por producto (`/p/camiseta-azul-12`), mapa del sitio y lista para aparecer en Google. Se pide en el editor de la tienda → «Dominio y Google» |

La empresa hace todo desde Ajustes → Marca: escribe el dominio, crea en SU DNS
el **TXT** de verificación (prueba que el dominio es suyo) y el **CNAME** hacia
`app.tu-dominio.com`. Lo que falta para que el dominio funcione es que **tu
servidor web lo atienda con certificado HTTPS**. Eso depende de cómo está
armado el servidor, y hay dos caminos.

> **Camino elegido hoy: ServerAvatar (Camino B).** Con pocas empresas usando
> dominio propio, agregar cada alias a mano es manejable y no hace falta entrar
> por consola. La app avisa por correo al operador cuando una empresa verifica o
> quita un dominio, y **Plataforma → Dominios** es la lista de trabajo (qué
> habilitar, qué ya funciona, qué sacar del servidor). Cuando haya muchas
> empresas con dominio propio, conviene pasar a Caddy (Camino A).

> **Nada se rompe mientras tanto.** Los enlaces de acceso que reciben los
> clientes salen por el dominio de la empresa **sólo si responde de verdad**
> (la app lo prueba: pide `/api/v1/public/boot` por ese dominio y exige que
> conteste esa misma empresa). Si todavía no responde, salen por el dominio
> de la plataforma como siempre. El panel de la empresa le dice "el dominio
> todavía no responde: falta que el administrador lo habilite en el servidor".

### Tiendas con dominio propio: un paso UNA vez en el servidor (v0.1.423)

Una tienda en su dominio responde en la RAÍZ (`/`), en `/p/…`, `/sitemap.xml`
y `/robots.txt`. En el servidor esas rutas hoy las sirve la app del equipo, así
que hay que pasárselas al API **una sola vez** (después, cero pasos por tienda
además del alias del dominio). Si el dominio no es de una tienda, el API
contesta 404 y se sirve la app como siempre: el dominio de la plataforma y los
de las empresas no cambian.

- **Caddy**: ya viene en el `Caddyfile` de cada release (`@site` +
  `handle_response`). Si copiaste el Caddyfile antes de v0.1.423, vuelve a
  copiarlo (paso 2 del Camino A) y recarga.
- **ServerAvatar / nginx**: ya los pone `deploy/serveravatar-nginx.sh` (ver el
  Camino B, paso 3). A mano: pega estos dos `location` junto a los del paso 6 de
  `docs/runbook-serveravatar.md` (también están, listos para copiar, en
  **Plataforma → Dominios → «Tiendas con dominio propio»**):

```nginx
location = / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_intercept_errors on;
    error_page 404 502 503 504 = /cloud/index.html;
}
location ~ ^/(?:p/|sitemap\.xml$|robots\.txt$|_imagina/) {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_intercept_errors on;
    error_page 404 502 503 504 = /cloud/index.html;
}
```

  Si el API se cae, `error_page` sirve la app: nadie ve un error de nginx.

**Cómo saber si quedó**: Plataforma → Dominios muestra la tarjeta «Tiendas con
dominio propio» en **«Listo en este servidor»** (la app pide
`/_imagina/site` por el dominio de la plataforma y comprueba que contesta el
API). Mientras falte el paso, una tienda en su dominio igual abre —la raíz
redirige a la dirección de siempre de la tienda—, pero sin direcciones por
producto ni nada para Google; y los enlaces de los pedidos siguen saliendo por
la dirección de la plataforma.

**Por tienda** es lo mismo que cualquier dominio: la empresa lo verifica, te
llega el correo, lo agregas como alias (o Caddy lo atiende solo) y «Comprobar»
dice «Responde» cuando el dominio ya abre ESA tienda.

**Google**: sólo se indexa el dominio propio de una tienda (si la tienda tiene
encendido «Dejar que Google muestre la tienda»). La dirección de la plataforma
(`/api/v1/public/s/…`) y todo lo demás de la app siguen con `noindex`.

---

## Camino A — Caddy (recomendado si vas a tener varias empresas con dominio)

**Una vez por consola (~15 min). Después, cero pasos por empresa:** cuando una
empresa verifica su dominio, Caddy emite el certificado solo la primera vez que
alguien entra. Antes de emitir le pregunta a la app
(`/api/v1/public/domains/check`) si ese dominio está verificado por alguna
empresa — un dominio cualquiera apuntado a tu servidor no consigue certificado.
Cada dominio tiene su propio certificado: uno roto no afecta a los demás.

**Antes de empezar:** si en ese servidor ServerAvatar atiende OTRAS apps con
nginx, este camino las afecta (Caddy toma los puertos 80/443). Si el servidor es
sólo para Imagina Base, adelante.

```bash
# 1. Instalar Caddy (repositorio oficial)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# 2. Copiar la config que viaja en cada release y poner TU dominio
sudo cp /opt/imagina-base/current/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/app\.tu-dominio\.com/app.TU-DOMINIO-REAL.com/g' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile

# 3. Liberar los puertos: apagar nginx y prender Caddy
sudo systemctl disable --now nginx
sudo systemctl enable --now caddy
sudo systemctl status caddy --no-pager

# 4. Probar
curl -I https://app.TU-DOMINIO-REAL.com           # 200 con certificado válido
```

**Volver atrás** (si algo falla): `sudo systemctl disable --now caddy && sudo systemctl enable --now nginx`.

ServerAvatar ya no administra el servidor web de esta app, pero la base, Redis,
el servicio del API y la auto-actualización siguen igual (la auto-actualización
no toca la config del proxy).

---

## Camino B — ServerAvatar por panel (sin consola) — el que se usa hoy

Te enteras por el correo de aviso o en **Plataforma → Dominios → «Para
habilitar»** (ahí ves si el DNS ya apunta y si el servidor ya lo atiende).
Por **cada** empresa que configure un dominio, después de que ella lo verifique:

1. ServerAvatar → tu servidor → **Applications** → la app de Imagina Base.
2. En los dominios de la aplicación, **agrega el dominio de la empresa como
   alias** (por ejemplo `clientes.acme.com`). El alias usa la misma
   configuración de nginx que el dominio principal, incluidos los `location`
   que pegaste para el API y el portal.
3. En **SSL**, vuelve a emitir el certificado Let's Encrypt incluyendo el alias.
   **Ojo:** ServerAvatar no deja sumar un dominio al certificado: hay que
   borrarlo y emitirlo de nuevo con todos, y al hacerlo **reescribe el archivo
   de Nginx de la app** con su plantilla. Se pierden los `location` de la app:
   la raíz da **403 Forbidden** y `/api` responde «File not found.» (pasó el
   2026-11-14). Arreglo, como **root** (el usuario de la aplicación que crea
   ServerAvatar no tiene `sudo`):
   `bash /opt/imagina-base/current/deploy/serveravatar-nginx.sh app.tu-dominio.com`.
   El script deja los `location` en `/etc/nginx/imagina-base.locations`, cambia
   el `location /` del panel por un `include`, prueba con `nginx -t` (si falla,
   deja todo como estaba) y recarga. Córrelo después de cada emisión.
4. En **Plataforma → Dominios**, toca **«Comprobar»** en ese dominio: cuando
   diga **«Responde»**, los enlaces de esa empresa ya salen por su dominio.
   (También puedes abrir `https://clientes.acme.com/portal` y ver la marca.)

Cuidados:
- El DNS del dominio (el CNAME) tiene que apuntar a tu servidor **antes** de
  emitir el certificado, o Let's Encrypt lo rechaza.
- ServerAvatar suele emitir **un solo certificado para todos los dominios de
  la app**. Si más adelante una empresa deja de apuntar su dominio a tu
  servidor, la **renovación de todo el certificado** puede fallar. Cuando una
  empresa quite su dominio en la app te llega un correo y aparece en
  **Plataforma → Dominios → «Para quitar del servidor»**: saca el alias,
  vuelve a emitir el SSL y toca **«Ya lo saqué»**.
- Los nombres exactos de los menús de ServerAvatar pueden variar según la
  versión del panel.

---

## Qué hace la app en cada dominio

- **Dominio del portal** (`clientes.acme.com`): la raíz redirige a `/portal`.
  Las pantallas de entrar, de enlace vencido y de "cerraste sesión" ya salen
  con el logo, el color y el nombre de la empresa (`GET /public/boot` resuelve
  el dominio). Pedir un enlace nuevo desde ese dominio sólo manda el de ESA
  empresa.
- **Dominio del equipo** (`crm.acme.com`): la app con la marca de la empresa
  desde el login. Sus clientes también pueden entrar al portal en `/portal`.
- **Dominio de una tienda** (`tienda.acme.com`): la tienda en `/`, cada
  producto en `/p/<nombre>-<id>` (una dirección vieja o con otro nombre
  redirige a la buena; un producto que ya no está responde 410), el mapa del
  sitio en `/sitemap.xml` y `robots.txt` propio. Las páginas traen el título,
  la descripción, la vista al compartir y los datos de producto (precio,
  moneda, stock) para Google. Las fotos que se piden por ese dominio se pueden
  indexar. La app del equipo no existe en ese dominio: cualquier otra ruta
  lleva a la tienda.
- **Dominio de la plataforma** (`app.tu-dominio.com/portal`): el portal neutro
  —sin la marca de la plataforma ni la de nadie— hasta que el cliente entra;
  después, la marca de la empresa de su cuenta.

Los enlaces de acceso que salen por correo usan, en orden: el dominio del
portal → el del equipo → el de la plataforma, salteando el que no responda.
