import { Coffee, Home, LayoutDashboard, List, Plus, Settings, Star, Upload } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La marca de la empresa (white-label): se elige otro color primario, otro
 * color para la barra lateral y se sube el logo; toda la app se re-tiñe.
 */

const P0 = 'hsl(var(--imcrm-primary))';
const P1 = tone('mint');
const R0 = 'color-mix(in srgb, hsl(var(--imcrm-primary)) 62%, #0b1220)';
const R1 = tone('violet');

const CSS = `
@keyframes ebr-p{0%,24%{background:${P0}}30%,90%{background:${P1}}97%,100%{background:${P0}}}
@keyframes ebr-pt{0%,24%{color:${P0}}30%,90%{color:${P1}}97%,100%{color:${P0}}}
@keyframes ebr-ps{0%,24%{background:${primary(0.14)}}30%,90%{background:${tone('mint', 0.14)}}97%,100%{background:${primary(0.14)}}}
@keyframes ebr-rail{0%,46%{background:${R0}}52%,90%{background:${R1}}97%,100%{background:${R0}}}
@keyframes ebr-logo{0%,62%{opacity:0;transform:scale(.5)}68%,90%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ebr-dflt{0%,62%{opacity:1}68%,90%{opacity:0}97%,100%{opacity:1}}
@keyframes ebr-cursor{0%{transform:translate(460px,290px);opacity:0}6%{opacity:1}18%,24%{transform:translate(377px,121px)}40%,46%{transform:translate(393px,165px)}58%,64%{transform:translate(394px,214px)}76%,88%{transform:translate(420px,268px);opacity:1}95%,100%{transform:translate(420px,268px);opacity:0}}
@keyframes ebr-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%{opacity:0;transform:scale(1.6)}42%{opacity:0;transform:scale(.4)}44%{opacity:1;transform:scale(1)}48%{opacity:0;transform:scale(1.6)}60%{opacity:0;transform:scale(.4)}62%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ebr-sel1{0%,24%{box-shadow:0 0 0 2px ${C.card},0 0 0 3.5px transparent}28%,90%{box-shadow:0 0 0 2px ${C.card},0 0 0 3.5px ${C.fg}}97%,100%{box-shadow:0 0 0 2px ${C.card},0 0 0 3.5px transparent}}
@keyframes ebr-sel2{0%,46%{box-shadow:0 0 0 2px ${C.card},0 0 0 3.5px transparent}50%,90%{box-shadow:0 0 0 2px ${C.card},0 0 0 3.5px ${C.fg}}97%,100%{box-shadow:0 0 0 2px ${C.card},0 0 0 3.5px transparent}}
`;

const a = (name: string): { 'data-a': ''; style: { animationName: string } } => ({
    'data-a': '',
    style: { animationName: name },
});

function Swatch({ color, sel }: { color: string; sel?: 'ebr-sel1' | 'ebr-sel2' }): JSX.Element {
    return (
        <span
            data-a={sel ? '' : undefined}
            style={{
                width: 16,
                height: 16,
                borderRadius: 99,
                background: color,
                display: 'inline-block',
                animationName: sel,
                boxShadow: sel ? `0 0 0 2px ${C.card},0 0 0 3.5px ${C.fg}` : undefined,
            }}
        />
    );
}

export default function EmpresaBranding(): JSX.Element {
    return (
        <Stage
            label="En Ajustes, Marca, se elige un color primario verde, una barra lateral violeta y se sube el logo de la empresa: los botones, enlaces, la barra lateral y el nombre de la app cambian en toda la app."
            tint="mint"
        >
            <Keyframes css={CSS} />
            {/* La app */}
            <At
                x={16}
                y={22}
                w={300}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)',
                    display: 'flex',
                }}
            >
                {/* Riel */}
                <div
                    {...a('ebr-rail')}
                    style={{
                        width: 46,
                        background: R1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 13,
                        paddingTop: 10,
                        animationName: 'ebr-rail',
                    }}
                >
                    <span style={{ position: 'relative', width: 26, height: 26 }}>
                        <span
                            {...a('ebr-dflt')}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: 7,
                                background: 'rgba(255,255,255,.22)',
                                opacity: 0,
                                animationName: 'ebr-dflt',
                            }}
                        />
                        <span
                            {...a('ebr-logo')}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: 7,
                                background: '#fff',
                                color: tone('amber'),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                animationName: 'ebr-logo',
                            }}
                        >
                            <Coffee size={15} />
                        </span>
                    </span>
                    {[Home, List, LayoutDashboard, Star, Settings].map((I, i) => (
                        <span
                            key={i}
                            style={{
                                width: 26,
                                height: 22,
                                borderRadius: 6,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                background: i === 1 ? 'rgba(255,255,255,.2)' : 'transparent',
                                opacity: i === 1 ? 1 : 0.75,
                            }}
                        >
                            <I size={13} />
                        </span>
                    ))}
                </div>
                {/* Contenido */}
                <div style={{ flex: 1, position: 'relative' }}>
                    <div
                        style={{
                            height: 34,
                            borderBottom: `1px solid ${C.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 12px',
                            gap: 8,
                        }}
                    >
                        <span style={{ position: 'relative', width: 70, height: 14 }}>
                            <span
                                {...a('ebr-dflt')}
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    opacity: 0,
                                    animationName: 'ebr-dflt',
                                }}
                            >
                                <T size={10.5} weight={700} color={C.mutedFg}>
                                    Mi empresa
                                </T>
                            </span>
                            <span
                                {...a('ebr-logo')}
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    animationName: 'ebr-logo',
                                }}
                            >
                                <T size={10.5} weight={700}>
                                    Café Aurora
                                </T>
                            </span>
                        </span>
                        <span style={{ flex: 1 }} />
                        <Avatar initials="AG" t="violet" size={20} />
                    </div>
                    <div
                        style={{
                            padding: 12,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 9,
                        }}
                    >
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <T size={12} weight={700}>
                                Clientes
                            </T>
                            <span
                                {...a('ebr-p')}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    height: 22,
                                    padding: '0 9px',
                                    borderRadius: 6,
                                    background: P1,
                                    color: '#fff',
                                    fontSize: 9.5,
                                    fontWeight: 600,
                                    animationName: 'ebr-p',
                                }}
                            >
                                <Plus size={11} /> Nuevo registro
                            </span>
                        </span>
                        <span
                            style={{
                                display: 'flex',
                                gap: 14,
                                borderBottom: `1px solid ${C.border}`,
                            }}
                        >
                            {['Todos', 'Por ciudad', 'Activos'].map((v, i) => (
                                <span key={v} style={{ position: 'relative', paddingBottom: 6 }}>
                                    <T size={9.5} weight={600} color={i === 0 ? C.fg : C.mutedFg}>
                                        {v}
                                    </T>
                                    {i === 0 && (
                                        <span
                                            {...a('ebr-p')}
                                            style={{
                                                position: 'absolute',
                                                left: 0,
                                                right: 0,
                                                bottom: -1,
                                                height: 2,
                                                background: P1,
                                                animationName: 'ebr-p',
                                            }}
                                        />
                                    )}
                                </span>
                            ))}
                        </span>
                        {[
                            ['Hotel Brisas', 'Bogotá', 70],
                            ['Clínica Norte', 'Medellín', 45],
                            ['Óptica Visión', 'Cali', 85],
                            ['Colegio Andino', 'Bogotá', 30],
                        ].map(([n, c, p]) => (
                            <span
                                key={n as string}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    height: 22,
                                    borderBottom: `1px solid ${C.border}`,
                                }}
                            >
                                <T size={9.5} weight={600} style={{ width: 80 }}>
                                    {n}
                                </T>
                                <span
                                    {...a('ebr-ps')}
                                    style={{
                                        height: 16,
                                        padding: '0 6px',
                                        borderRadius: 99,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        fontSize: 8.5,
                                        fontWeight: 600,
                                        background: tone('mint', 0.14),
                                        animationName: 'ebr-ps',
                                    }}
                                >
                                    <span {...a('ebr-pt')} style={{ color: P1, animationName: 'ebr-pt' }}>
                                        {c}
                                    </span>
                                </span>
                                <span
                                    style={{
                                        flex: 1,
                                        height: 5,
                                        borderRadius: 99,
                                        background: C.muted,
                                        overflow: 'hidden',
                                    }}
                                >
                                    <span
                                        {...a('ebr-p')}
                                        style={{
                                            display: 'block',
                                            width: `${p as number}%`,
                                            height: '100%',
                                            background: P1,
                                            animationName: 'ebr-p',
                                        }}
                                    />
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            </At>

            {/* Ajustes · Marca */}
            <At
                x={330}
                y={22}
                w={136}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 11,
                    boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                }}
            >
                <T size={11} weight={700}>
                    Marca
                </T>
                <T size={8} color={C.mutedFg}>
                    Nombre de la app
                </T>
                <span
                    style={{
                        height: 20,
                        border: `1px solid ${C.border}`,
                        borderRadius: 5,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 6px',
                    }}
                >
                    <T size={9}>Café Aurora</T>
                </span>
                <T size={8} color={C.mutedFg} style={{ marginTop: 4 }}>
                    Color primario
                </T>
                <span style={{ display: 'flex', gap: 7 }}>
                    <Swatch color={P0} />
                    <Swatch color={P1} sel="ebr-sel1" />
                    <Swatch color={tone('rose')} />
                    <Swatch color={tone('amber')} />
                </span>
                <T size={8} color={C.mutedFg} style={{ marginTop: 4 }}>
                    Color de la barra lateral
                </T>
                <span style={{ display: 'flex', gap: 7 }}>
                    <Swatch color={R0} />
                    <Swatch color={tone('blue')} />
                    <Swatch color={R1} sel="ebr-sel2" />
                    <Swatch color={C.muted} />
                </span>
                <T size={8} color={C.mutedFg} style={{ marginTop: 4 }}>
                    Logo
                </T>
                <span
                    style={{
                        height: 34,
                        border: `1px dashed ${C.border}`,
                        borderRadius: 7,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                    }}
                >
                    <span style={{ position: 'relative', width: 20, height: 20 }}>
                        <span
                            {...a('ebr-dflt')}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: C.mutedFg,
                                opacity: 0,
                                animationName: 'ebr-dflt',
                            }}
                        >
                            <Upload size={13} />
                        </span>
                        <span
                            {...a('ebr-logo')}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: 5,
                                background: tone('amber', 0.16),
                                color: tone('amber'),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                animationName: 'ebr-logo',
                            }}
                        >
                            <Coffee size={13} />
                        </span>
                    </span>
                    <T size={8.5} weight={600} color={C.mutedFg}>
                        logo.png
                    </T>
                </span>
                <span style={{ flex: 1 }} />
                <span
                    {...a('ebr-p')}
                    style={{
                        alignSelf: 'flex-end',
                        height: 22,
                        padding: '0 10px',
                        borderRadius: 6,
                        background: P1,
                        color: '#fff',
                        fontSize: 9.5,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        animationName: 'ebr-p',
                    }}
                >
                    Guardar
                </span>
            </At>
            <Cursor a="ebr-cursor" click="ebr-ring" rest={[420, 268]} />
        </Stage>
    );
}
