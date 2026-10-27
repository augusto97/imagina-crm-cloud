import { Check, Plug } from 'lucide-react';

import { Btn, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Campos de otros plugins»: la app descubre los datos extra que guardan los
 * plugins de WordPress en cada producto (origen, peso, fecha de tueste…). Con
 * «Traer como columna» uno se vuelve una columna de la lista, ya llena.
 */

const CSS = `
@keyframes tm-cur{0%{transform:translate(300px,280px);opacity:0}6%{opacity:1}16%,22%{transform:translate(404px,86px)}40%,100%{transform:translate(440px,140px);opacity:0}}
@keyframes tm-ring{0%,19%{opacity:0;transform:scale(.4)}20%{opacity:1;transform:scale(1)}24%,100%{opacity:0;transform:scale(1.6)}}
@keyframes tm-btn{0%,23%{opacity:1}26%,100%{opacity:0}}
@keyframes tm-ok{0%,23%{opacity:0}26%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tm-col{0%,30%{opacity:0;max-width:0}38%,92%{opacity:1;max-width:120px}97%,100%{opacity:0;max-width:0}}
@keyframes tm-v1{0%,40%{opacity:0}44%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tm-v2{0%,46%{opacity:0}50%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tm-v3{0%,52%{opacity:0}56%,92%{opacity:1}97%,100%{opacity:0}}
`;

const META = [
    { key: 'origen', ex: 'Huila', n: '18 productos', type: 'Texto', main: true },
    { key: 'peso_neto_g', ex: '500', n: '18 productos', type: 'Número' },
    { key: 'fecha_tueste', ex: '2026-10-12', n: '12 productos', type: 'Fecha' },
];

export default function TiendaMeta(): JSX.Element {
    return (
        <Stage label="La app descubre los datos extra que guardan los plugins de WordPress en cada producto, como el origen, el peso o la fecha de tueste. Con Traer como columna, uno se vuelve una columna de la lista, ya llena con el valor de cada producto." tint="cyan">
            <Keyframes css={CSS} />

            {/* El panel de campos de plugins */}
            <Win x={16} y={14} w={448} h={136} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Plug size={11} color={primary()} />Campos de otros plugins · Productos</span>}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.8fr 0.6fr 118px', gap: 6, height: 22, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Campo', 'Ejemplo', 'Lo tienen', 'Tipo', ''].map((h) => (
                        <T key={h || 'x'} size={7.5} weight={700} color={C.mutedFg}>
                            {h}
                        </T>
                    ))}
                </div>
                {META.map((m) => (
                    <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.8fr 0.6fr 118px', gap: 6, height: 29, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                            {m.key}
                        </T>
                        <T size={8.5} color={C.mutedFg}>
                            {m.ex}
                        </T>
                        <T size={8}>{m.n}</T>
                        <T size={8}>{m.type}</T>
                        {m.main ? (
                            <span style={{ position: 'relative', display: 'block', height: 22 }}>
                                <span data-a="" style={{ animationName: 'tm-btn', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', opacity: 0 }}>
                                    <Btn label="Traer como columna" kind="outline" />
                                </span>
                                <span data-a="" style={{ animationName: 'tm-ok', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 4, color: C.success }}>
                                    <Check size={11} />
                                    <T size={8.5} weight={700} color={C.success}>
                                        Se trae
                                    </T>
                                </span>
                            </span>
                        ) : (
                            <span style={{ display: 'flex' }}>
                                <Btn label="Traer como columna" kind="outline" />
                            </span>
                        )}
                    </div>
                ))}
            </Win>

            {/* La lista con la columna nueva */}
            <Win x={16} y={162} w={448} h={124} title="Productos">
                <div style={{ display: 'flex', height: 22, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}`, gap: 6 }}>
                    <span style={{ width: 160 }}>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Producto
                        </T>
                    </span>
                    <span style={{ width: 80 }}>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Precio
                        </T>
                    </span>
                    <span data-a="" style={{ animationName: 'tm-col', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 120, display: 'block', borderRadius: 4, background: tone('cyan', 0.14), padding: '2px 6px' }}>
                        <T size={7.5} weight={700} color={primary()}>
                            Origen del café
                        </T>
                    </span>
                </div>
                {[
                    ['Café de origen 500 g', '$42.000', 'Huila', 'tm-v1'],
                    ['Café de origen 250 g', '$24.000', 'Huila', 'tm-v2'],
                    ['Café especial Geisha', '$89.000', 'Nariño', 'tm-v3'],
                ].map(([n, p, o, a]) => (
                    <div key={n} style={{ display: 'flex', height: 25, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}`, gap: 6 }}>
                        <span style={{ width: 160 }}>
                            <T size={8.5} weight={600}>
                                {n}
                            </T>
                        </span>
                        <span style={{ width: 80 }}>
                            <T size={8.5}>{p}</T>
                        </span>
                        <span data-a="" style={{ animationName: a, padding: '0 6px' }}>
                            <T size={8.5}>{o}</T>
                        </span>
                    </div>
                ))}
            </Win>

            <Cursor a="tm-cur" click="tm-ring" />
        </Stage>
    );
}
