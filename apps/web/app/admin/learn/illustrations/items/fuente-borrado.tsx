import { RotateCcw, Trash2 } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Lo que se borró en WordPress (o en la tienda) queda marcado «Papelera»; la
 * barra de la lista lo cuenta y «Quitarlos de la app» lo manda a la papelera
 * de la app, donde se puede recuperar 30 días. Si vuelve en el sitio, vuelve.
 */

const CSS = `
@keyframes fb-cur{0%{transform:translate(260px,280px);opacity:0}6%{opacity:1}22%,28%{transform:translate(392px,86px)}52%,100%{transform:translate(420px,262px);opacity:0}}
@keyframes fb-ring{0%,26%{opacity:0;transform:scale(.4)}27%{opacity:1;transform:scale(1)}31%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fb-bar{0%,30%{opacity:1;max-height:30px}36%,100%{opacity:0;max-height:0}}
@keyframes fb-row{0%,32%{opacity:1;max-height:28px}40%,100%{opacity:0;max-height:0}}
@keyframes fb-trash{0%,40%{opacity:0;transform:translateY(8px)}46%,90%{opacity:1;transform:translateY(0)}96%,100%{opacity:0}}
@keyframes fb-back{0%,62%{opacity:0;transform:translateY(6px)}68%,90%{opacity:1;transform:translateY(0)}96%,100%{opacity:0}}
`;

const COLS = '1.6fr 0.9fr 0.8fr';

function Row({ name, state, price, gone = false }: { name: string; state: string; price: string; gone?: boolean }): JSX.Element {
    return (
        <div
            data-a={gone ? '' : undefined}
            style={{
                display: 'grid',
                gridTemplateColumns: COLS,
                gap: 6,
                height: 26,
                alignItems: 'center',
                padding: '0 10px',
                borderBottom: `1px solid ${C.border}`,
                overflow: 'hidden',
                ...(gone ? { animationName: 'fb-row', background: tone('rose', 0.05) } : null),
            }}
        >
            <T size={8.5} weight={600}>
                {name}
            </T>
            <span
                style={{
                    display: 'inline-flex',
                    width: 'fit-content',
                    alignItems: 'center',
                    height: 15,
                    padding: '0 6px',
                    borderRadius: 4,
                    fontSize: 7.5,
                    fontWeight: 700,
                    color: '#fff',
                    background: gone ? tone('rose') : tone('mint'),
                }}
            >
                {state}
            </span>
            <T size={8.5}>{price}</T>
        </div>
    );
}

export interface GoneSceneProps {
    integrationKey: 'wordpress' | 'woocommerce';
    source: string;
    listTitle: string;
    label: string;
    gone: { name: string; state: string; price: string };
    rows: Array<{ name: string; price: string }>;
}

/** La escena con sus datos: la usan la versión del sitio y la de la tienda. */
export function GoneScene({ integrationKey, source, listTitle, label, gone, rows }: GoneSceneProps): JSX.Element {
    return (
        <Stage label={label} tint="rose">
            <Keyframes css={CSS} />

            <Win x={16} y={10} w={448} h={214} title={listTitle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', background: primary(0.06), borderBottom: `1px solid ${C.border}` }}>
                    <IntegrationLogo integrationKey={integrationKey} size={13} />
                    <T size={8.5} weight={600}>
                        Sincronizada con {source}
                    </T>
                </div>
                <div
                    data-a=""
                    style={{
                        animationName: 'fb-bar',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        height: 30,
                        padding: '0 10px',
                        background: C.muted,
                        borderBottom: `1px solid ${C.border}`,
                    }}
                >
                    <Trash2 size={10} color={C.mutedFg} />
                    <T size={8.5} weight={600}>
                        1 registro ya se borró en {source}.
                    </T>
                    <span
                        style={{
                            marginLeft: 'auto',
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: 18,
                            padding: '0 8px',
                            borderRadius: 5,
                            border: `1px solid ${C.border}`,
                            background: C.card,
                            fontSize: 8,
                            fontWeight: 600,
                        }}
                    >
                        Quitarlos de la app
                    </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 22, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Título', 'Estado', 'Precio'].map((l) => (
                        <T key={l} size={8} weight={700} color={C.mutedFg}>
                            {l}
                        </T>
                    ))}
                </div>
                <Row name={rows[0]!.name} state="Publicado" price={rows[0]!.price} />
                <Row name={gone.name} state={gone.state} price={gone.price} gone />
                {rows.slice(1).map((r) => (
                    <Row key={r.name} name={r.name} state="Publicado" price={r.price} />
                ))}
            </Win>

            <At
                x={40}
                y={238}
                w={190}
                a="fb-trash"
                style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)' }}
            >
                <Trash2 size={11} color={tone('rose')} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={8.5} weight={700}>
                        Papelera de la app
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        30 días para recuperarlo · no cuenta para tu plan
                    </T>
                </span>
            </At>

            <At
                x={250}
                y={238}
                w={190}
                a="fb-back"
                style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)' }}
            >
                <RotateCcw size={11} color={primary()} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={8.5} weight={700}>
                        ¿Lo restauran en {source}?
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        Vuelve sola, el mismo registro
                    </T>
                </span>
            </At>

            <Cursor a="fb-cur" click="fb-ring" />
        </Stage>
    );
}

export default function FuenteBorrado(): JSX.Element {
    return (
        <GoneScene
            integrationKey="wordpress"
            source="WordPress"
            listTitle="Propiedades"
            label="Una propiedad que se borró en WordPress queda marcada Papelera. La barra de la lista la cuenta y, al tocar Quitarlos de la app, sale de la lista y pasa a la papelera de la app, donde se puede recuperar durante 30 días. Si la restauran en WordPress, vuelve sola."
            gone={{ name: 'Penthouse con vista', state: 'Papelera', price: '$1.100 M' }}
            rows={[
                { name: 'Casa en El Poblado', price: '$860 M' },
                { name: 'Apartamento Laureles', price: '$420 M' },
                { name: 'Finca en Rionegro', price: '$1.200 M' },
            ]}
        />
    );
}
