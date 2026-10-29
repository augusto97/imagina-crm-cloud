import { GoneScene } from './fuente-borrado';

/** «Lo que se borra en la tienda»: la misma escena, con productos de WooCommerce. */
export default function TiendaBorrado(): JSX.Element {
    return (
        <GoneScene
            integrationKey="woocommerce"
            source="WooCommerce"
            listTitle="Productos"
            label="Un producto que se borró en WooCommerce queda marcado En la papelera. La barra de la lista lo cuenta y, al tocar Quitarlos de la app, sale de la lista con sus variaciones y pasa a la papelera de la app, donde se puede recuperar durante 30 días. Si lo restauran en la tienda, vuelve solo."
            gone={{ name: 'Termo edición invierno', state: 'En la papelera', price: '$89.000' }}
            rows={[
                { name: 'Taza Aurora', price: '$32.000' },
                { name: 'Café de origen 500 g', price: '$45.000' },
                { name: 'Prensa francesa', price: '$120.000' },
            ]}
        />
    );
}
