import { ArrowRight, Wand2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Variables con modificadores: cada etiqueta de la plantilla se convierte en
 * el dato del registro, y el modificador lo escribe como hace falta en un
 * documento: fecha larga, monto en letras, mayúsculas.
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const ROWS: Array<{ tag: string; mod: string; out: string; t: Tn }> = [
    { tag: 'fecha', mod: '|larga', out: '8 de octubre de 2026', t: 'blue' },
    { tag: 'valor', mod: '', out: '$ 1.250.000', t: 'mint' },
    { tag: 'valor', mod: '|pesos', out: 'un millón doscientos cincuenta mil pesos', t: 'violet' },
    { tag: 'cliente', mod: '|mayusculas', out: 'HOTEL BRISAS DEL MAR', t: 'amber' },
    { tag: 'documento.numero', mod: '', out: 'CC-0042', t: 'rose' },
];

const keys = ROWS.map((_, i) => {
    const s = 10 + i * 13;
    return [
        `@keyframes pv-in${i}{0%,${s - 6}%{opacity:0;transform:translateX(-8px)}${s - 2}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}`,
        `@keyframes pv-out${i}{0%,${s + 2}%{opacity:0;transform:translateX(-10px) scale(.96)}${s + 8}%,92%{opacity:1;transform:translateX(0) scale(1)}97%,100%{opacity:0;transform:translateX(0) scale(1)}}`,
        `@keyframes pv-arr${i}{0%,${s - 2}%{opacity:0;transform:translateX(-4px)}${s + 2}%,${s + 8}%{opacity:1;transform:translateX(2px)}${s + 12}%,92%{opacity:.35;transform:translateX(0)}97%,100%{opacity:0}}`,
    ].join('\n');
}).join('\n');

export default function PdfVariables(): JSX.Element {
    return (
        <Stage label="Cada variable de la plantilla se convierte en el dato del registro, y su modificador lo escribe como pide un documento: la fecha larga, el monto en letras, el nombre en mayúsculas y el número del documento." tint="violet">
            <Keyframes css={`${keys}`} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={24} y={18} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Wand2 size={13} color={primary()} />
                    <T size={11} weight={700}>
                        En la plantilla
                    </T>
                </At>
                <At x={262} y={18}>
                    <T size={11} weight={700}>
                        En el PDF de cada registro
                    </T>
                </At>
                {ROWS.map((r, i) => (
                    <div key={i}>
                        <At
                            x={24}
                            y={48 + i * 48}
                            h={36}
                            a={`pv-in${i}`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 10px',
                                borderRadius: 9,
                                background: C.card,
                                border: `1px solid ${C.border}`,
                                boxShadow: '0 6px 16px -12px rgba(15,23,42,.4)',
                            }}
                        >
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    height: 20,
                                    padding: '0 7px',
                                    borderRadius: 6,
                                    background: tone(r.t, 0.14),
                                    border: `1px solid ${tone(r.t, 0.4)}`,
                                }}
                            >
                                <T size={9} weight={700} color={tone(r.t)} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                                    {'{{'}
                                    {r.tag}
                                    {r.mod && <span style={{ fontWeight: 800 }}>{r.mod}</span>}
                                    {'}}'}
                                </T>
                            </span>
                        </At>
                        <At x={232} y={58 + i * 48} a={`pv-arr${i}`} style={{ color: C.mutedFg }}>
                            <ArrowRight size={16} />
                        </At>
                        <At
                            x={262}
                            y={48 + i * 48}
                            w={196}
                            h={36}
                            a={`pv-out${i}`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 10px',
                                borderRadius: 9,
                                background: '#ffffff',
                                border: '1px solid #e5e7eb',
                                boxShadow: '0 6px 16px -12px rgba(15,23,42,.4)',
                            }}
                        >
                            <T size={9} weight={600} color="#1f2937" style={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
                                {r.out}
                            </T>
                        </At>
                    </div>
                ))}
            </div>
        </Stage>
    );
}
