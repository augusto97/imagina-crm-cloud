# Runbook — Cobro de los planes (ADR-S12 + ADR-S30)

> Las empresas pagan su plan con **Mercado Pago** (COP) y, opcionalmente,
> **PayPal** (USD). Stripe no opera en Colombia. Arquitectura: interfaz común
> `PaymentGateway`; el dominio (billing) no conoce el proveedor.
>
> Desde v0.1.250 hay **dos formas de pagar** y cada pago aprobado EXTIENDE el
> período pagado (`tenants.paid_until`). Vencido ese período más **5 días de
> gracia**, la empresa pasa a solo-lectura (ADR-S09: los datos nunca se
> secuestran; al pagar se reactiva al instante).
>
> - **Pagar meses**: 1, 3, 6 o 12 meses de una vez (Checkout Pro: PSE, Nequi,
>   tarjeta, efectivo; o PayPal).
> - **Renovación automática**: suscripción de Mercado Pago, cobra la tarjeta
>   todos los meses; cada cuota aprobada extiende un mes.

## Mercado Pago (desde la consola, sin tocar el servidor)

**Plataforma → Cobros**:

1. En https://www.mercadopago.com.co/developers/panel/app creá una aplicación
   (Pagos online / Checkout Pro) y copiá el **Access Token** de producción
   (`APP_USR-…`). Para probar, el de prueba (`TEST-…`): la consola marca el modo.
2. En la aplicación → **Webhooks → Configurar notificaciones**: pegá la URL que
   muestra la consola (`https://<tu-dominio>/api/v1/billing/webhook/mercadopago`)
   y marcá los eventos **Pagos** y **Planes y suscripciones** (suscripciones y
   pagos de suscripciones).
3. Copiá la **Clave secreta** que muestra Mercado Pago y pegala en la consola.
   Sin ella los avisos se rechazan (no se puede verificar la firma
   `x-signature`) y el período **no se extiende**.

Las credenciales se guardan cifradas con `SECRETS_KEY` (Redis
`platform:payments`, viajan en el snapshot de ADR-S20) y nunca vuelven al
navegador. `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_WEBHOOK_SECRET` del `.env`
siguen valiendo como respaldo si la consola está vacía.

## PayPal (opcional, por `.env`)

```
PAYPAL_ENV=live            # o sandbox para pruebas
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...       # id del webhook creado en el dashboard
```
- Webhook a `https://<dominio>/api/v1/billing/webhook/paypal` con los eventos
  `CHECKOUT.ORDER.APPROVED` (**obligatorio**: la app CAPTURA la orden al
  recibirlo, SEC-29), `PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED`.
- PayPal sólo vende períodos (sin renovación automática).

## Cómo funciona por dentro

1. Ajustes → Suscripción: el admin elige plan y "Pagar meses" o "Renovación
   automática". Funciona aunque la empresa esté en solo-lectura (`@AllowReadOnly`).
2. **Período**: `POST /billing/checkout {plan, provider, mode:'period', months}`
   crea una preference con el total (precio × meses) y la referencia
   `p:{empresa}:{plan}:{meses}:{monto}`.
   **Renovación**: `{mode:'subscription', payer_email}` crea un `preapproval`
   mensual (`s:{empresa}:{plan}`) que arranca **cuando vence lo ya pagado**
   (nadie paga dos veces el mismo mes). El admin autoriza la tarjeta en Mercado
   Pago con el correo de SU cuenta de Mercado Pago.
3. El aviso de Mercado Pago se verifica (firma) y la app **vuelve a leer** el
   pago/suscripción desde la API con su token — nunca se le cree al cuerpo.
4. Cada cobro es UNA fila en `billing_payments` (único por proveedor + id del
   pago): los reintentos y el mismo cobro que llega por dos avisos (`payment` y
   `subscription_authorized_payment`) extienden UNA vez. Un pago **pendiente**
   (PSE en proceso, efectivo sin pagar) queda en el historial y NO toca el estado
   de la empresa. Un **reembolso** le quita esos meses al período.
5. Avisos por correo a los admins (vía de correo de la plataforma): 3 días antes
   del vencimiento, al vencer y al pasar a solo-lectura. Con renovación
   automática activa sólo se avisa el corte.

> El estado NO se cambia en el retorno del navegador (falsificable), sólo por el
> aviso verificado. Por eso el banner de "success" dice "estamos confirmando".

## Precios

En la consola → **Planes** (`price_cop` / `price_usd` de cada plan). Un plan sin
precio en una moneda no se vende con el proveedor de esa moneda.

## Empresas que ya pagaban antes de v0.1.250

Quedaron `active` sin `paid_until` (el modelo viejo no tenía vencimiento) y
siguen activas. Para pasarlas al modelo nuevo basta con que paguen un período
desde Ajustes, o que el operador les fije un corte en la consola.

## Prueba de humo

1. Cargar credenciales de prueba (`TEST-…`) + clave secreta en Plataforma → Cobros.
2. Ajustes → Suscripción → pagar 1 mes con una cuenta de prueba.
3. Confirmar en la consola → Cobros → "Pagos recientes" que el pago figura
   **Aprobado** y en Ajustes → Suscripción "Pagado hasta el …".
4. Activar la renovación automática con una tarjeta de prueba y verificar que
   pase a "Renovación automática activa"; cancelarla.
