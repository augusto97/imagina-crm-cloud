# Runbook — Dominios de las empresas (equipo y portal de clientes)

Cada empresa puede usar hasta **dos dominios propios** (Ajustes → Marca):

| Dominio | Para quién | Qué abre |
|---|---|---|
| **Dominio personalizado** (`crm.acme.com`) | Su equipo | La app, con su marca desde el login |
| **Dominio del portal de clientes** (`clientes.acme.com`) — v0.1.245 | Sus clientes | Directo el portal, con su logo, color y nombre. Nunca muestra la app del equipo |

La empresa hace todo desde Ajustes → Marca: escribe el dominio, crea en SU DNS
el **TXT** de verificación (prueba que el dominio es suyo) y el **CNAME** hacia
`app.tu-dominio.com`. Lo que falta para que el dominio funcione es que **tu
servidor web lo atienda con certificado HTTPS**. Eso depende de cómo está
armado el servidor, y hay dos caminos.

> **Nada se rompe mientras tanto.** Los enlaces de acceso que reciben los
> clientes salen por el dominio de la empresa **sólo si responde de verdad**
> (la app lo prueba: pide `/api/v1/public/boot` por ese dominio y exige que
> conteste esa misma empresa). Si todavía no responde, salen por el dominio
> de la plataforma como siempre. El panel de la empresa le dice "el dominio
> todavía no responde: falta que el administrador lo habilite en el servidor".

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

## Camino B — ServerAvatar por panel (sin consola)

Por **cada** empresa que configure un dominio, después de que ella lo verifique:

1. ServerAvatar → tu servidor → **Applications** → la app de Imagina Base.
2. En los dominios de la aplicación, **agregá el dominio de la empresa como
   alias** (por ejemplo `clientes.acme.com`). El alias usa la misma
   configuración de nginx que el dominio principal, incluidos los `location`
   que pegaste para el API y el portal.
3. En **SSL**, volvé a emitir el certificado Let's Encrypt incluyendo el alias.
4. Abrí `https://clientes.acme.com/portal` y comprobá que carga con la marca
   de la empresa. En la app, el botón **«Comprobar apuntamiento»** del panel
   de la empresa pasa a decir "El dominio responde".

Cuidados:
- El DNS del dominio (el CNAME) tiene que apuntar a tu servidor **antes** de
  emitir el certificado, o Let's Encrypt lo rechaza.
- ServerAvatar suele emitir **un solo certificado para todos los dominios de
  la app**. Si más adelante una empresa deja de apuntar su dominio a tu
  servidor, la **renovación de todo el certificado** puede fallar. Cuando una
  empresa quite su dominio en la app, sacá también el alias en ServerAvatar.
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
- **Dominio de la plataforma** (`app.tu-dominio.com/portal`): el portal neutro
  —sin la marca de la plataforma ni la de nadie— hasta que el cliente entra;
  después, la marca de la empresa de su cuenta.

Los enlaces de acceso que salen por correo usan, en orden: el dominio del
portal → el del equipo → el de la plataforma, salteando el que no responda.
