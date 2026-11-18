import { CheckCircle2, GitMerge } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * v0.1.445 (A14) — Duplicados: el panel muestra un grupo («Mismo correo»),
 * «Fusionar» abre la ventana con «Cuál queda» y el valor de cada campo, y al
 * terminar queda un solo registro con el aviso «Deshacer».
 */

const CSS = `
@keyframes df-group{0%,4%{opacity:0;transform:translateY(6px)}8%,40%{opacity:1;transform:translateY(0)}44%,100%{opacity:0;transform:translateY(-4px)}}
@keyframes df-merge{0%,40%{opacity:0;transform:scale(.96)}45%,74%{opacity:1;transform:scale(1)}78%,100%{opacity:0;transform:scale(.98)}}
@keyframes df-pick{0%,52%{background:transparent;border-color:${C.border}}55%,100%{background:${primary(0.1)};border-color:${primary(0.7)}}}
@keyframes df-result{0%,76%{opacity:0;transform:translateY(8px)}80%,96%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes df-cur{0%{transform:translate(430px,260px);opacity:0}6%{opacity:1}22%,34%{transform:translate(376px,148px)}50%,58%{transform:translate(150px,118px)}66%,72%{transform:translate(340px,232px);opacity:1}78%,100%{transform:translate(340px,232px);opacity:0}}
@keyframes df-ring{0%,32%{opacity:0;transform:scale(.4)}33%{opacity:1;transform:scale(1)}37%,54%{opacity:0;transform:scale(1.6)}55%{opacity:1;transform:scale(1)}59%,69%{opacity:0;transform:scale(1.6)}70%{opacity:1;transform:scale(1)}74%,100%{opacity:0;transform:scale(1.6)}}
`;

function RecordRow({ name, mail, y }: { name: string; mail: string; y: number }): JSX.Element {
    return (
        <At x={12} y={y} w={300} h={28} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', borderRadius: 6, background: C.muted }}>
            <T size={9.5} weight={700}>
                {name}
            </T>
            <T size={8.5} color={C.mutedFg}>
                {mail}
            </T>
        </At>
    );
}

export default function DuplicadosFusionar(): JSX.Element {
    return (
        <Stage
            label="El panel «Duplicados» muestra dos clientes con el mismo correo; «Fusionar» abre una ventana donde se elige cuál queda y el valor de cada campo, y al terminar queda un solo cliente con un aviso para deshacer."
            tint="amber"
            cycle={9}
        >
            <Keyframes css={CSS} />

            {/* 1. El grupo del panel «Duplicados» */}
            <Win x={40} y={34} w={400} h={170} title="Duplicados · Clientes" a="df-group">
                <At x={12} y={12} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Chip label="Mismo correo" t="amber" style={{ height: 16, fontSize: 8 }} />
                    <T size={8.5} color={C.mutedFg}>
                        2 registros
                    </T>
                </At>
                <RecordRow y={38} name="Café Aurora" mail="ventas@cafeaurora.co" />
                <RecordRow y={72} name="Cafe Aurora SAS" mail="VENTAS@cafeaurora.co" />
                <At x={12} y={112} style={{ display: 'flex', gap: 6 }}>
                    <Btn label={<><GitMerge size={9} /> Fusionar</>} />
                    <Btn label="No son duplicados" kind="outline" />
                </At>
            </Win>

            {/* 2. La ventana de fusionar */}
            <Win x={40} y={30} w={400} h={230} title="Fusionar 2 registros" a="df-merge">
                <At x={12} y={10}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Cuál queda
                    </T>
                </At>
                <At x={12} y={28} w={180} h={34} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 9px', borderRadius: 7, border: `1.5px solid ${primary(0.7)}`, background: primary(0.1) }}>
                    <T size={9.5} weight={700}>
                        Café Aurora
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        Creado hace 2 años
                    </T>
                </At>
                <At x={204} y={28} w={180} h={34} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 9px', borderRadius: 7, border: `1px solid ${C.border}` }}>
                    <T size={9.5} weight={700}>
                        Cafe Aurora SAS
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        Creado ayer
                    </T>
                </At>
                <At x={12} y={74}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Qué valor se conserva
                    </T>
                </At>
                <At x={12} y={92} w={372} h={26} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 70 }}>
                        <T size={8.5} color={C.mutedFg}>
                            Teléfono
                        </T>
                    </span>
                    <At x={78} y={2} w={140} h={22} a="df-pick" style={{ display: 'flex', alignItems: 'center', padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                        <T size={8.5}>+57 300 123 4567</T>
                    </At>
                    <At x={226} y={2} w={140} h={22} style={{ display: 'flex', alignItems: 'center', padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                        <T size={8.5} color={C.mutedFg}>
                            (vacío)
                        </T>
                    </At>
                </At>
                <At x={12} y={126} w={372} h={26} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 70 }}>
                        <T size={8.5} color={C.mutedFg}>
                            Etiquetas
                        </T>
                    </span>
                    <At x={78} y={2} w={288} h={22} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', borderRadius: 6, border: `1px solid ${primary(0.5)}`, background: primary(0.06) }}>
                        <T size={8} weight={700} color={primary()}>
                            Juntar todos:
                        </T>
                        <Chip label="VIP" t="violet" style={{ height: 14, fontSize: 7.5 }} />
                        <Chip label="Mayorista" t="blue" style={{ height: 14, fontSize: 7.5 }} />
                    </At>
                </At>
                <At x={12} y={164}>
                    <T size={8} color={C.mutedFg}>
                        Pasan al que queda: 4 comentarios, 3 facturas vinculadas
                    </T>
                </At>
                <At x={248} y={180}>
                    <Btn label="Fusionar 1 en «Café Aurora»" />
                </At>
            </Win>

            {/* 3. Queda uno solo */}
            <Win x={40} y={50} w={400} h={92} title="Clientes · Tabla" a="df-result">
                <RecordRow y={14} name="Café Aurora" mail="ventas@cafeaurora.co" />
            </Win>
            <At
                x={186}
                y={170}
                w={254}
                h={44}
                a="df-result"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderRadius: 10, background: C.card, border: `1px solid ${tone('mint', 0.45)}`, boxShadow: '0 16px 32px -16px rgba(15,23,42,.55)' }}
            >
                <CheckCircle2 size={13} color={tone('mint')} />
                <span style={{ flex: 1, minWidth: 0 }}>
                    <T size={9} weight={700}>
                        Se fusionaron 2 registros
                    </T>
                </span>
                <T size={8.5} weight={700} color={primary()}>
                    Deshacer
                </T>
            </At>

            <Cursor a="df-cur" click="df-ring" />
        </Stage>
    );
}
