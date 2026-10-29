import type { LearnModuleMeta } from '../types';

export const meta: LearnModuleMeta = {
    id: 'sms',
    group: 'connect',
    order: 2.5,
    title: 'Mensajes de texto (SMS)',
    tagline: 'Manda SMS con tu cuenta de Twilio, BulkGate, Infobip, LabsMobile u Onurix y ve en cada registro si se entregó.',
    icon: 'MessageSquareText',
    tone: 'cyan',
    hero: 'sms-hero',
    highlights: [
        'Conectar tu proveedor de SMS con su clave, revisada antes de guardarla',
        'Mandar desde un registro, a varios a la vez o con una automatización',
        'Saber cuántos SMS vas a pagar y quitar las tildes para gastar menos',
        'Respetar el horario de la Ley 2300 para cobros y mensajes comerciales',
        'Ver el estado de entrega de cada SMS en el registro',
    ],
    articles: [
        {
            id: 'sms-conectar',
            title: 'Conectar tu proveedor de SMS',
            summary: 'Qué datos pide cada proveedor (Twilio, BulkGate, Infobip, LabsMobile y Onurix), cómo se comprueban y cómo llega el estado de entrega con cada uno.',
            minutes: 7,
            level: 'intermediate',
            keywords: 'conectar sms twilio bulkgate infobip labsmobile onurix clave token api remitente pais saldo credito',
            needs: 'manage_automations',
        },
        {
            id: 'sms-enviar',
            title: 'Mandar SMS: desde un registro, a varios y en automatizaciones',
            summary: 'El contador de SMS, «Quitar tildes», el botón de la ficha, el envío a una selección, la acción «Enviar SMS» y los recordatorios de citas.',
            minutes: 8,
            level: 'basic',
            keywords: 'enviar sms registro ficha seleccion varios masivo automatizacion accion contador segmentos tildes probar prueba recordatorio cita',
        },
        {
            id: 'sms-horario-estado',
            title: 'El horario de la Ley 2300 y el estado de entrega',
            summary: 'Cuándo se puede mandar un SMS de cobro o comercial en Colombia, qué pasa fuera de horario y cómo se ven «Enviado», «Entregado» y «Fallido».',
            minutes: 6,
            level: 'intermediate',
            keywords: 'ley 2300 horario cobranza comercial programado festivos estado entrega entregado fallido columnas actividad problemas',
        },
    ],
};
