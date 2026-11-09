import { ClipboardList, Copy, Link2 } from 'lucide-react';

import { At, C, Cursor, Keyframes, Pill, Stage, T, anim, tone } from '../kit';

/**
 * v0.1.388 — Duplicar un formulario: un clic en «Duplicar» y aparece la copia
 * sin publicar, con su propio enlace, lista para cambiarle lo que la hace
 * distinta (el nombre, la etiqueta de conversión, la página de gracias).
 */

const CSS = `
@keyframes fd-cur{0%,10%{transform:translate(120px,280px)}26%,34%{transform:translate(334px,79px)}50%,100%{transform:translate(120px,280px)}}
@keyframes fd-ring{0%,29%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}37%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fd-row{0%,36%{opacity:0;transform:translateY(-6px)}44%,94%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fd-hi{0%,40%{background:var(--fd-hit)}70%,100%{background:transparent}}
@keyframes fd-note{0%,52%{opacity:0;transform:translateY(6px)}60%,94%{opacity:1;transform:none}100%{opacity:0}}
`;

function FormRow({ name, status, live, a }: { name: string; status: string; live: boolean; a?: string }): JSX.Element {
    const row = (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderTop: `1px solid ${C.border}` }}>
            <span style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: tone('blue', 0.14), color: tone('blue') }}>
                <ClipboardList size={11} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <T size={8} weight={700}>
                    {name}
                </T>
                <span style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: '1px 6px', borderRadius: 4, background: live ? tone('mint', 0.16) : C.muted, color: live ? tone('mint') : C.mutedFg, fontSize: 6.5, fontWeight: 700 }}>
                    {status}
                </span>
            </span>
            <span style={{ display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 5, border: `1px solid ${C.border}`, color: C.mutedFg }}>
                <Copy size={9} />
            </span>
            <span style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${C.border}` }}>
                <T size={7}>Editar</T>
            </span>
        </span>
    );
    return a ? <span {...anim(a, { display: 'block', opacity: 0 })}>{row}</span> : row;
}

export default function FormDuplicate(): JSX.Element {
    return (
        <Stage label="Un clic en Duplicar crea una copia del formulario, sin publicar y con su propio enlace, lista para cambiarle la etiqueta de conversión o lo que la haga distinta." tint="mint" cycle={9}>
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2, ['--fd-hit' as string]: tone('mint', 0.14) }}>
                <At x={60} y={34} w={360} style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <span style={{ padding: '8px 10px', background: C.muted }}>
                        <T size={8} weight={700}>
                            Formularios
                        </T>
                    </span>
                    <FormRow name="Cotización" status="Publicado" live />
                    <span {...anim('fd-hi', { display: 'block' })}>
                        <FormRow name="Cotización (copia)" status="Sin publicar" live={false} a="fd-row" />
                    </span>
                </At>
                <At x={60} y={170} w={360} a="fd-note" style={{ opacity: 0, display: 'flex', gap: 8 }}>
                    <Pill t="mint" icon={<Link2 size={9} />} label="Su propio enlace" />
                    <Pill t="blue" icon={<ClipboardList size={9} />} label="Mismas preguntas, diseño y ajustes" />
                </At>
                <Cursor a="fd-cur" click="fd-ring" rest={[120, 280]} />
            </At>
        </Stage>
    );
}
