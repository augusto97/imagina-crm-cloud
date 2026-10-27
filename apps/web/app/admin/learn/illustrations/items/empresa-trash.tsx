import { RotateCcw, Trash2, Undo2 } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * La papelera: se borra un registro, aparece «Se movió a la papelera ·
 * Deshacer»; en Ajustes → Papelera se ve quién lo borró y cuántos días
 * quedan, y «Restaurar» lo devuelve tal cual.
 */

const CSS = `
@keyframes etr-row{0%,14%{opacity:1;transform:translateX(0);max-height:30px}22%,70%{opacity:0;transform:translateX(30px);max-height:0}78%,100%{opacity:1;transform:translateX(0);max-height:30px}}
@keyframes etr-toast{0%,18%{opacity:0;transform:translateY(10px)}24%,40%{opacity:1;transform:translateY(0)}46%,100%{opacity:0;transform:translateY(10px)}}
@keyframes etr-item{0%,40%{opacity:0;transform:translateY(8px)}48%,66%{opacity:1;transform:translateY(0)}74%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes etr-empty{0%,40%{opacity:1}48%,66%{opacity:0}74%,100%{opacity:1}}
@keyframes etr-cursor{0%{transform:translate(160px,290px);opacity:0}6%{opacity:1}10%,14%{transform:translate(224px,94px)}52%,58%{transform:translate(414px,192px)}66%,88%{transform:translate(380px,250px);opacity:1}95%,100%{opacity:0;transform:translate(380px,250px)}}
@keyframes etr-ring{0%,11%{opacity:0;transform:scale(.4)}13%{opacity:1;transform:scale(1)}17%{opacity:0;transform:scale(1.6)}54%{opacity:0;transform:scale(.4)}56%{opacity:1;transform:scale(1)}60%,100%{opacity:0;transform:scale(1.6)}}
@keyframes etr-back{0%,72%{box-shadow:inset 0 0 0 0 transparent}78%,88%{box-shadow:inset 3px 0 0 0 ${primary()};background:${primary(0.07)}}96%,100%{box-shadow:inset 0 0 0 0 transparent}}
`;

const ROWS = [
    ['Café Bahía', 'Nuevo', 'slate'],
    ['Hotel Brisas', 'Propuesta', 'blue'],
    ['Clínica Norte', 'Ganado', 'mint'],
    ['Óptica Visión', 'Nuevo', 'slate'],
] as const;

export default function EmpresaTrash(): JSX.Element {
    return (
        <Stage
            label="Se borra el registro Hotel Brisas: aparece el aviso «Se movió a la papelera» con Deshacer. En la Papelera se ve quién lo borró y cuántos días quedan; con Restaurar vuelve a la lista tal cual."
            tint="rose"
        >
            <Keyframes css={CSS} />
            <Win x={16} y={22} w={222} h={200} title="Oportunidades">
                {ROWS.map(([n, s, t], i) => (
                    <div
                        key={n}
                        data-a={i === 1 ? '' : undefined}
                        style={{
                            height: 30,
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            padding: '0 9px',
                            borderBottom: `1px solid ${C.border}`,
                            animationName: i === 1 ? 'etr-row, etr-back' : undefined,
                        }}
                    >
                        <T size={9.5} weight={600} style={{ flex: 1 }}>
                            {n}
                        </T>
                        <Chip label={s} t={t} />
                        {i === 1 && (
                            <span style={{ color: C.mutedFg, display: 'inline-flex' }}>
                                <Trash2 size={11} />
                            </span>
                        )}
                    </div>
                ))}
            </Win>
            <At x={16} y={232} w={222} a="etr-toast" style={{ opacity: 0 }}>
                <div
                    style={{
                        height: 34,
                        borderRadius: 9,
                        background: C.fg,
                        color: C.card,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '0 11px',
                        boxShadow: '0 12px 24px -12px rgba(15,23,42,.6)',
                    }}
                >
                    <Trash2 size={12} />
                    <span style={{ flex: 1, fontSize: 9, fontWeight: 600 }}>Se movió a la papelera</span>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 9,
                            fontWeight: 700,
                            color: tone('cyan'),
                        }}
                    >
                        <Undo2 size={10} /> Deshacer
                    </span>
                </div>
            </At>

            {/* Ajustes · Papelera */}
            <Win x={250} y={22} w={214} h={262} title="Ajustes · Papelera">
                <At x={11} y={10} w={192}>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35, display: 'block' }}>
                        Lo que se borra queda aquí 30 días y se restaura tal cual.
                    </T>
                </At>
                <At x={11} y={50} w={192} style={{ display: 'flex', gap: 5 }}>
                    {['Todo', 'Registros', 'Listas', 'Campos'].map((f, i) => (
                        <span
                            key={f}
                            style={{
                                height: 18,
                                padding: '0 7px',
                                borderRadius: 99,
                                border: `1px solid ${i === 0 ? primary(0.6) : C.border}`,
                                fontSize: 8,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                color: i === 0 ? primary() : C.fg,
                            }}
                        >
                            {f}
                        </span>
                    ))}
                </At>
                <At x={11} y={84} w={192} a="etr-empty" style={{ opacity: 0, textAlign: 'center', paddingTop: 30 }}>
                    <T size={9} color={C.mutedFg}>
                        La papelera está vacía.
                    </T>
                </At>
                <At x={11} y={84} w={192} a="etr-item">
                    <div
                        style={{
                            border: `1px solid ${C.border}`,
                            borderRadius: 9,
                            padding: 9,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <T size={9.5} weight={700}>
                                Hotel Brisas
                            </T>
                            <T size={8} color={C.mutedFg}>
                                en «Oportunidades»
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Avatar initials="AG" t="violet" size={14} />
                            <T size={8} color={C.mutedFg}>
                                Lo borró Ana Gómez hace un momento
                            </T>
                        </span>
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <T size={8} weight={700} color={tone('amber')}>
                                Quedan 30 días
                            </T>
                            <span
                                style={{
                                    height: 20,
                                    padding: '0 8px',
                                    borderRadius: 6,
                                    background: primary(),
                                    color: C.primaryFg,
                                    fontSize: 8.5,
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                }}
                            >
                                <RotateCcw size={9} /> Restaurar
                            </span>
                        </span>
                    </div>
                </At>
            </Win>
            <Cursor a="etr-cursor" click="etr-ring" rest={[380, 250]} />
        </Stage>
    );
}
