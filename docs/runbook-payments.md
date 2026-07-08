# Runbook — Pagos (ADR-S12)

> Cobro de suscripciones con **PayPal** (USD) y **Mercado Pago** (COP). Stripe no
> opera en Colombia. Arquitectura: interfaz común `PaymentGateway`; el dominio
> (billing) no conoce el proveedor. Enchufar credenciales alcanza para
> habilitar cada medio.

## Habilitar un proveedor

Cada gateway se habilita al setear sus credenciales (ver `.env.example`). Sin
ellas, el proveedor aparece deshabilitado en la UI y `POST /billing/checkout`
lo rechaza.

### PayPal
```
PAYPAL_ENV=live            # o sandbox para pruebas
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...       # id del webhook creado en el dashboard
```
- Crear la app en https://developer.paypal.com → obtener client id/secret.
- Registrar un webhook apuntando a
  `https://<API_PUBLICA>/api/v1/billing/webhook/paypal` y suscribir los eventos
  `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED`,
  `BILLING.SUBSCRIPTION.ACTIVATED/SUSPENDED/CANCELLED`. Copiar el **Webhook ID**
  a `PAYPAL_WEBHOOK_ID` (se usa para verificar la firma vía API oficial).

### Mercado Pago
```
MERCADOPAGO_ACCESS_TOKEN=...    # Access Token de producción
MERCADOPAGO_WEBHOOK_SECRET=...  # "Clave secreta" de la config de webhooks
```
- Credenciales en https://www.mercadopago.com.co/developers.
- Configurar el webhook a
  `https://<API_PUBLICA>/api/v1/billing/webhook/mercadopago` (evento *Pagos*).
  La **clave secreta** firma el header `x-signature` (HMAC-SHA256) que el
  gateway verifica.

## Flujo de checkout

1. El admin entra a **Ajustes → Suscripción**, elige plan (starter/pro) y medio.
2. `POST /billing/checkout {plan, provider}` crea la orden/preferencia con la
   referencia `tenantId:plan` y devuelve la URL del proveedor.
3. El SPA redirige; el cliente paga y vuelve a `/settings?checkout=success`.
4. El proveedor dispara el webhook → el gateway verifica firma → mapea a
   `plan/status` → `BillingService.setBilling`. El plan se refleja en el resumen.

> El estado NO se cambia en el retorno del navegador (falsificable), sólo por el
> webhook verificado. Por eso el banner de "success" dice "estamos confirmando".

## Precios

Definidos en `packages/shared/src/schemas/payment.ts` (`PLAN_PRICES`): starter y
pro, con monto en USD (PayPal) y COP (Mercado Pago). `enterprise` es "contactar
ventas" (sin checkout self-serve).

## Prueba de humo (sandbox)

1. Setear credenciales sandbox (PayPal) / test (Mercado Pago).
2. `GET /billing/payments/config` debe listar el/los proveedores habilitados.
3. Iniciar checkout desde Ajustes, pagar con una cuenta de prueba.
4. Confirmar que llega el webhook (logs `PaymentsService`) y que
   `GET /billing` muestra `status: active` y el nuevo plan.
