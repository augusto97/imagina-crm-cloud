/**
 * Dato mal cargado por quien armó la automatización: el mensaje es para esa
 * persona. Vive aparte para que los módulos de cada app (WooCommerce, v0.1.205)
 * lo usen sin importar `integration-calls`, que a su vez los importa a ellos.
 */
export class IntegrationInputError extends Error {
    readonly code = 'integration_input';
}
