# n8n-nodes-imagina-base

Nodos de [n8n](https://n8n.io) para Imagina Base: crea, lee, busca, cambia y
borra registros de tus listas, agrega comentarios, y corre un flujo cuando se
crea, cambia o borra un registro, se envía un formulario o entra un pago.

## Qué trae

**Imagina Base** (acciones)

| Recurso | Operaciones |
|---|---|
| Registro | Crear · Leer · Buscar (con texto, filtro y subtareas) · Cambiar · Borrar (va a la papelera 30 días) |
| Comentario | Agregar (nota interna o visible para el cliente) · Listar |
| Lista | Listar |

Los campos se eligen de la lista (el mismo tipo que en la app: texto, número,
moneda, fecha, selección, casilla…). Las opciones de una selección se pueden
escribir por su etiqueta («Pagado»), los números como se escriben en cada país
(«1.250,5») y las fechas como fecha de n8n. También sirve como herramienta de
los agentes de IA de n8n.

**Imagina Base Trigger** (disparador)

Al activar el flujo, registra un webhook en la app (Ajustes → API → Webhooks,
«Lo registró un programa») con la dirección de n8n; al desactivarlo, lo borra.
Eventos: se crea, cambia o borra un registro, se envía un formulario, se recibe
un pago y (desde la versión 0.1.1 del paquete) alguien firma un documento,
firman todos (con el enlace al PDF firmado) o alguien no quiere firmar.
Cada aviso se comprueba con su firma antes de correr el flujo y uno sin firma
válida recibe 401. El aviso de prueba («Probar» en la app) responde sin correr
el flujo.

## Instalar

- **Desde n8n** (cuando el paquete esté publicado en npm): Ajustes → Community
  nodes → Install → `n8n-nodes-imagina-base`.
- **En un n8n propio, desde tu servidor de la app** (no depende de npm):

  ```bash
  cd ~/.n8n/nodes
  npm install https://TU-APP/api/v1/public/n8n/n8n-nodes-imagina-base.tgz
  ```

  y reinicia n8n. Con Docker, la carpeta es el volumen de `/home/node/.n8n`.

## Conectar

1. En la app: **Ajustes → API → Crear token** (alcance «Leer y escribir» si
   vas a crear o cambiar registros, o usar el disparador).
2. En n8n: credencial **Imagina Base API** con la dirección de tu app
   (`https://tu-app.com`) y el token. «Test» llama a `/whoami`.

El token actúa como la persona que lo creó: ve y cambia lo mismo que ella
puede ver y cambiar en la app.

## Desarrollo

```bash
npm ci
npm run typecheck
npm test        # piezas puras: valores, columnas, firma
npm run build   # dist/ con los nodos, la credencial y los íconos
npm pack        # el .tgz que viaja en cada release de la app
```

Probado contra n8n 2.48 con un flujo de las 8 operaciones y el disparador
(registrar, recibir firmado, rechazar firma falsa, reiniciar sin duplicar y
borrar al despublicar).

Licencia MIT.
