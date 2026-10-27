import { Check, ChevronDown, ShieldCheck } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Permisos de una lista: la tarjeta del rol Agente pasa de «Solo mirar» a
 * «Colaborar» y el ajuste fino de abajo se actualiza solo (ahora edita y crea).
 */

const LEVELS = ['Sin acceso', 'Solo mirar', 'Solo lo suyo', 'Colaborar', 'Control total'];
const SEG_W = 78;

const CSS = `
@keyframes ell-sel{0%,28%{transform:translateX(${SEG_W}px)}38%,90%{transform:translateX(${SEG_W * 3}px)}98%,100%{transform:translateX(${SEG_W}px)}}
@keyframes ell-cursor{0%{transform:translate(420px,270px);opacity:0}8%{opacity:1}24%,32%{transform:translate(318px,128px)}50%,88%{transform:translate(316px,266px);opacity:1}95%,100%{transform:translate(316px,266px);opacity:0}}
@keyframes ell-ring{0%,27%{opacity:0;transform:scale(.4)}29%{opacity:1;transform:scale(1)}34%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ell-old{0%,34%{opacity:1}40%,90%{opacity:0}97%,100%{opacity:1}}
@keyframes ell-new{0%,34%{opacity:0}40%,90%{opacity:1}97%,100%{opacity:0}}
@keyframes ell-flash{0%,34%{background:transparent}40%,52%{background:${primary(0.12)}}64%,100%{background:transparent}}
@keyframes ell-hint{0%,34%{opacity:1}40%,90%{opacity:0}97%,100%{opacity:1}}
@keyframes ell-hint2{0%,34%{opacity:0}40%,90%{opacity:1}97%,100%{opacity:0}}
`;

function Value({ before, after }: { before: string; after: string }): JSX.Element {
    if (before === after) {
        return <Select text={after} />;
    }
    return (
        <span
            style={{
                position: 'relative',
                display: 'inline-block',
                width: 120,
                height: 20,
            }}
        >
            <span
                data-a=""
                style={{
                    position: 'absolute',
                    inset: 0,
                    animationName: 'ell-old',
                    opacity: 0,
                }}
            >
                <Select text={before} />
            </span>
            <span data-a="" style={{ position: 'absolute', inset: 0, animationName: 'ell-new' }}>
                <Select text={after} strong />
            </span>
        </span>
    );
}

function Select({ text, strong }: { text: string; strong?: boolean }): JSX.Element {
    return (
        <span
            style={{
                width: 120,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 7px',
                border: `1px solid ${strong ? primary(0.6) : C.border}`,
                borderRadius: 5,
                fontSize: 9,
                fontWeight: strong ? 700 : 500,
                color: C.fg,
                background: C.card,
            }}
        >
            {text}
            <ChevronDown size={9} />
        </span>
    );
}

function FineRow({ label, before, after }: { label: string; before: string; after: string }): JSX.Element {
    return (
        <div
            data-a={before !== after ? '' : undefined}
            style={{
                display: 'flex',
                alignItems: 'center',
                height: 27,
                borderRadius: 5,
                padding: '0 6px',
                animationName: before !== after ? 'ell-flash' : undefined,
            }}
        >
            <T size={9} color={C.mutedFg} style={{ width: 70 }}>
                {label}
            </T>
            <Value before={before} after={after} />
        </div>
    );
}

export default function EquipoListLevels(): JSX.Element {
    return (
        <Stage
            label="En los permisos de una lista, el rol Agente pasa de «Solo mirar» a «Colaborar»: el ajuste fino se actualiza solo y ahora puede editar todos los registros y crear nuevos, pero no eliminar."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <Win x={18} y={18} w={444} h={262} title="Oportunidades · Ajustes · Permisos">
                <At x={14} y={10} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShieldCheck size={13} color={primary()} />
                    <T size={11} weight={700}>
                        Quién puede hacer qué
                    </T>
                </At>
                <At
                    x={14}
                    y={34}
                    w={416}
                    style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 9,
                        padding: 10,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <T size={10.5} weight={700}>
                            Agente
                        </T>
                        <span
                            style={{
                                position: 'relative',
                                display: 'inline-block',
                                width: 220,
                                height: 12,
                            }}
                        >
                            <T size={8.5} color={C.mutedFg} style={{ position: 'absolute', left: 0, top: 0 }}>
                                <span data-a="" style={{ animationName: 'ell-hint', opacity: 0 }}>
                                    Ve todos los registros, no puede tocarlos.
                                </span>
                            </T>
                            <T size={8.5} color={C.mutedFg} style={{ position: 'absolute', left: 0, top: 0 }}>
                                <span data-a="" style={{ animationName: 'ell-hint2' }}>
                                    Ve y edita todo, pero no elimina.
                                </span>
                            </T>
                        </span>
                    </span>
                    {/* Control segmentado de niveles */}
                    <div
                        style={{
                            position: 'relative',
                            display: 'flex',
                            marginTop: 8,
                            height: 26,
                            borderRadius: 7,
                            background: C.muted,
                            padding: 2,
                        }}
                    >
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 2,
                                top: 2,
                                width: SEG_W - 4,
                                height: 22,
                                borderRadius: 5,
                                background: C.card,
                                boxShadow: `0 1px 3px rgba(15,23,42,.18), 0 0 0 1.5px ${primary(0.7)}`,
                                transform: `translateX(${SEG_W * 3}px)`,
                                animationName: 'ell-sel',
                            }}
                        />
                        {LEVELS.map((l) => (
                            <span
                                key={l}
                                style={{
                                    position: 'relative',
                                    width: SEG_W - 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <T size={8.5} weight={600}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </div>
                </At>
                <At
                    x={14}
                    y={112}
                    w={416}
                    style={{
                        border: `1px dashed ${C.border}`,
                        borderRadius: 9,
                        padding: '6px 6px',
                    }}
                >
                    <T size={8.5} weight={700} color={C.mutedFg} style={{ display: 'block', margin: '2px 6px 4px' }}>
                        Ajuste fino
                    </T>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                            <FineRow label="Puede ver" before="Todos los registros" after="Todos los registros" />
                            <FineRow label="Puede editar" before="Ninguno" after="Todos los registros" />
                        </div>
                        <div style={{ flex: 1 }}>
                            <FineRow label="Puede eliminar" before="Ninguno" after="Ninguno" />
                            <div
                                data-a=""
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 7,
                                    height: 27,
                                    padding: '0 6px',
                                    borderRadius: 5,
                                    animationName: 'ell-flash',
                                }}
                            >
                                <span style={{ position: 'relative', width: 12, height: 12 }}>
                                    <span
                                        style={{
                                            position: 'absolute',
                                            inset: 0,
                                            borderRadius: 3,
                                            border: `1.5px solid ${C.border}`,
                                        }}
                                    />
                                    <span
                                        data-a=""
                                        style={{
                                            position: 'absolute',
                                            inset: 0,
                                            borderRadius: 3,
                                            background: primary(),
                                            color: '#fff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            animationName: 'ell-new',
                                        }}
                                    >
                                        <Check size={9} strokeWidth={3} />
                                    </span>
                                </span>
                                <T size={9}>Puede crear registros nuevos</T>
                            </div>
                        </div>
                    </div>
                </At>
                <At x={14} y={204} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(['Manager · Control total', 'Lector · Solo mirar'] as const).map((r, i) => (
                        <span
                            key={r}
                            style={{
                                height: 20,
                                padding: '0 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                fontSize: 8.5,
                                fontWeight: 600,
                            }}
                        >
                            <span
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 99,
                                    background: tone(i === 0 ? 'blue' : 'slate'),
                                }}
                            />
                            {r}
                        </span>
                    ))}
                </At>
                <At x={330} y={204}>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: 22,
                            padding: '0 10px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 9.5,
                            fontWeight: 600,
                        }}
                    >
                        Guardar permisos
                    </span>
                </At>
            </Win>
            <Cursor a="ell-cursor" click="ell-ring" rest={[316, 266]} />
        </Stage>
    );
}
