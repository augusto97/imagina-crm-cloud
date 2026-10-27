import { Check, Download, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Actualizaciones: aparece una versión nueva, se toca «Actualizar» y el
 * servidor la instala, reinicia y verifica sola; si algo falla, vuelve a la
 * versión anterior.
 */

const CSS = `
@keyframes pup-new{0%,8%{opacity:0;transform:scale(.6)}14%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pup-cursor{0%{transform:translate(300px,290px);opacity:0}6%{opacity:1}20%,26%{transform:translate(392px,107px)}40%,88%{transform:translate(440px,160px);opacity:1}95%,100%{opacity:0;transform:translate(440px,160px)}}
@keyframes pup-ring{0%,22%{opacity:0;transform:scale(.4)}24%{opacity:1;transform:scale(1)}28%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pup-s1{0%,26%{opacity:.35}30%,100%{opacity:1}}
@keyframes pup-s2{0%,40%{opacity:.35}44%,100%{opacity:1}}
@keyframes pup-s3{0%,54%{opacity:.35}58%,100%{opacity:1}}
@keyframes pup-s4{0%,68%{opacity:.35}72%,100%{opacity:1}}
@keyframes pup-c1{0%,36%{opacity:0;transform:scale(.4)}40%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pup-c2{0%,50%{opacity:0;transform:scale(.4)}54%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pup-c3{0%,64%{opacity:0;transform:scale(.4)}68%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pup-c4{0%,74%{opacity:0;transform:scale(.4)}78%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pup-bar{0%,26%{width:0}74%,92%{width:100%}100%{width:0}}
@keyframes pup-v1{0%,74%{opacity:1}80%,92%{opacity:0}100%{opacity:1}}
@keyframes pup-v2{0%,74%{opacity:0}80%,92%{opacity:1}100%{opacity:0}}
`;

const STEPS: Array<[string, string, string]> = [
    ['Descargar el paquete y verificar su firma', 'pup-s1', 'pup-c1'],
    ['Copia de la base antes de tocar nada', 'pup-s2', 'pup-c2'],
    ['Instalar y migrar la base', 'pup-s3', 'pup-c3'],
    ['Reiniciar y verificar que responde', 'pup-s4', 'pup-c4'],
];

export default function PlatUpdates(): JSX.Element {
    return (
        <Stage
            label="En Actualizaciones aparece una versión nueva; al tocar Actualizar, el servidor descarga el paquete, hace una copia de la base, instala, reinicia y verifica que responde. Si algo falla, vuelve solo a la versión anterior."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={22}
                w={452}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <RefreshCw size={14} color={primary()} />
                    <T size={11.5} weight={700} style={{ flex: 1 }}>
                        Sistema · Actualizaciones
                    </T>
                    <span
                        data-a=""
                        style={{
                            height: 18,
                            padding: '0 8px',
                            borderRadius: 99,
                            background: tone('amber', 0.16),
                            color: tone('amber'),
                            fontSize: 8.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            animationName: 'pup-new',
                        }}
                    >
                        Hay actualización
                    </span>
                </span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                    <span
                        style={{
                            flex: 1,
                            border: `1px solid ${C.border}`,
                            borderRadius: 9,
                            padding: 9,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                        }}
                    >
                        <T size={8} color={C.mutedFg}>
                            Versión actual
                        </T>
                        <span style={{ display: 'grid' }}>
                            <span
                                data-a=""
                                style={{
                                    gridArea: '1 / 1',
                                    opacity: 0,
                                    animationName: 'pup-v1',
                                }}
                            >
                                <T size={14} weight={700}>
                                    0.1.322
                                </T>
                            </span>
                            <span data-a="" style={{ gridArea: '1 / 1', animationName: 'pup-v2' }}>
                                <T size={14} weight={700} color={C.success}>
                                    0.1.323 ✓
                                </T>
                            </span>
                        </span>
                    </span>
                    <span
                        style={{
                            flex: 1,
                            border: `1px solid ${C.border}`,
                            borderRadius: 9,
                            padding: 9,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                        }}
                    >
                        <T size={8} color={C.mutedFg}>
                            Disponible
                        </T>
                        <T size={14} weight={700}>
                            0.1.323
                        </T>
                    </span>
                    <span
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            justifyContent: 'center',
                        }}
                    >
                        <span
                            style={{
                                height: 22,
                                padding: '0 10px',
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                fontSize: 9,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            Buscar actualizaciones
                        </span>
                        <span
                            style={{
                                height: 22,
                                padding: '0 10px',
                                borderRadius: 6,
                                background: primary(),
                                color: C.primaryFg,
                                fontSize: 9,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                justifyContent: 'center',
                            }}
                        >
                            <Download size={10} /> Actualizar
                        </span>
                    </span>
                </span>
                <span
                    style={{
                        height: 6,
                        borderRadius: 99,
                        background: C.muted,
                        overflow: 'hidden',
                    }}
                >
                    <span
                        data-a=""
                        style={{
                            display: 'block',
                            height: '100%',
                            width: '100%',
                            background: primary(),
                            animationName: 'pup-bar',
                            animationTimingFunction: 'linear',
                        }}
                    />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {STEPS.map(([l, s, c]) => (
                        <span
                            key={l}
                            data-a=""
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                animationName: s,
                            }}
                        >
                            <span
                                style={{
                                    position: 'relative',
                                    width: 16,
                                    height: 16,
                                    borderRadius: 99,
                                    border: `1.5px solid ${C.border}`,
                                }}
                            >
                                <span
                                    data-a=""
                                    style={{
                                        position: 'absolute',
                                        inset: -1.5,
                                        borderRadius: 99,
                                        background: C.success,
                                        color: '#fff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        animationName: c,
                                    }}
                                >
                                    <Check size={10} strokeWidth={3} />
                                </span>
                            </span>
                            <T size={9}>{l}</T>
                        </span>
                    ))}
                </span>
                <span
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 'auto',
                    }}
                >
                    <ShieldCheck size={12} color={C.success} />
                    <T size={8} color={C.mutedFg} style={{ flex: 1 }}>
                        Si la verificación falla, vuelve solo a la versión anterior.
                    </T>
                    <RotateCcw size={11} color={C.mutedFg} />
                </span>
            </At>
            <Cursor a="pup-cursor" click="pup-ring" rest={[440, 160]} />
        </Stage>
    );
}
