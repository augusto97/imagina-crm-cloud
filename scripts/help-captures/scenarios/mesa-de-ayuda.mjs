/** Capturas del módulo «Mesa de ayuda» (centro de aprendizaje). */

export default [
    {
        key: 'mesa-buzon',
        title: 'Conectar el buzón de soporte',
        steps: [
            { go: '/lists/{list:Tickets}/edit?s=correo', wait: '[data-testid="imcrm-helpdesk-mailbox"]', caption: 'En los ajustes de la lista de tickets, la pestaña «Correo entrante» conecta el buzón al que te escriben los clientes.' },
            { click: '[data-testid="imcrm-helpdesk-preset-gmail"]', caption: 'Elige dónde está el buzón: Gmail, Outlook, Zoho u otro proveedor.' },
            { shot: '[data-testid="imcrm-helpdesk-mailbox"]', caption: 'Para cada proveedor aparecen los pasos para crear la contraseña de aplicación y el servidor ya completo.' },
            { fill: '#hd-support', text: 'soporte@cafeaurora.co', caption: 'Escribe la dirección de soporte (la que ven tus clientes), el usuario y la contraseña de aplicación.' },
            { shot: '[data-testid="imcrm-helpdesk-test"]', caption: 'Con «Probar conexión» ves si el buzón responde y, si no, en qué paso falla: servidor, seguridad, usuario o carpeta.' },
        ],
    },
    {
        key: 'mesa-tickets-config',
        title: 'Cómo se crea cada ticket',
        steps: [
            { go: '/lists/{list:Tickets}/edit?s=correo', wait: '[data-testid="imcrm-helpdesk-settings"]' },
            {
                run: async ({ page }) => {
                    await page.locator('[data-testid="imcrm-helpdesk-settings"]').first().scrollIntoViewIfNeeded();
                    await page.waitForTimeout(400);
                },
            },
            { shot: 'text=Cómo se crea cada ticket', caption: 'Debajo del buzón eliges qué parte del correo va a cada campo: el asunto, quién escribió, la fecha, el texto y los adjuntos.' },
            { shot: 'text=Estados del ticket', caption: 'Después, con qué estado nace cada ticket, cuáles lo dejan esperando al cliente y cuáles lo cierran.' },
            { shot: '[data-testid="imcrm-hd-template"]', caption: 'Las respuestas guardadas son textos que el equipo inserta al responder, con variables como el nombre del cliente y el número del ticket.' },
        ],
    },
    {
        key: 'mesa-sla',
        title: 'Configurar el SLA',
        steps: [
            { go: '/lists/{list:Tickets}/edit?s=sla', wait: '[data-testid="imcrm-sla-targets"]', caption: 'En la pestaña «SLA» de la lista se activa la medición y se ponen los objetivos.' },
            { shot: '[data-testid="imcrm-sla-targets"]', caption: 'Un objetivo de primera respuesta y uno de resolución, en horas hábiles, para cada prioridad.' },
            { shot: '[data-testid="imcrm-sla-columns"]', caption: 'Las columnas del SLA las mantiene la app: se filtran, se ordenan y se agrupan, pero no se editan a mano.' },
        ],
    },
    {
        key: 'mesa-responder',
        title: 'Responder un ticket por correo',
        steps: [
            {
                // Un buzón en pausa (no lee nada) basta para que la ficha ofrezca
                // «Responder por correo». Se quita al final de la demo.
                run: async (ctx) => {
                    const slug = ctx.lists.Tickets.slug;
                    await ctx.api.post(`/lists/${slug}/helpdesk/mailbox`, {
                        preset: 'gmail',
                        host: 'imap.gmail.com',
                        port: 993,
                        security: 'tls',
                        username: 'soporte@cafeaurora.co',
                        password: 'demo demo demo demo',
                        folder: 'INBOX',
                        support_address: 'soporte@cafeaurora.co',
                        enabled: false,
                    });
                    const { data: fields } = await ctx.api.get(`/lists/${slug}/fields`);
                    const email = fields.find((f) => f.type === 'email');
                    const title = fields.find((f) => f.is_primary) ?? fields[0];
                    const { data: records } = await ctx.api.get(`/lists/${slug}/records?limit=100`);
                    const withMail = records.filter((r) => email && r.data[`f${email.id}`]);
                    const rec = withMail.find((r) => String(r.data[`f${title.id}`] ?? '').startsWith('Error al descargar')) ?? withMail[0] ?? records[0];
                    await ctx.page.goto(`${ctx.base}/#/lists/${slug}/records/${rec.id}`);
                    await ctx.page.locator('[data-testid="imcrm-ticket-mail"]').first().waitFor({ state: 'visible', timeout: 20000 });
                    await ctx.page.waitForTimeout(800);
                },
            },
            { shot: '[data-testid="imcrm-ticket-mail"]', caption: 'En la ficha de un ticket ves su número, el cliente y cómo va el SLA: cuándo vence la primera respuesta y la resolución.' },
            { click: '[data-testid="imcrm-ticket-reply-open"]', then: '[data-testid="imcrm-ticket-composer"]', caption: 'Toca «Responder por correo».' },
            { fill: '#hd-reply-to', text: 'carlos21@ejemplo.com', caption: 'Revisa a quién va. El asunto ya lleva el número del ticket: así la respuesta del cliente vuelve a este mismo registro.' },
            {
                fill: 'textarea[aria-label="Respuesta"]',
                text: 'Hola Carlos, ya revisamos tu cuenta: la factura de octubre ya se puede descargar. Si algo no quedó bien, responde a este correo y lo volvemos a abrir.',
                caption: 'Escribe la respuesta o inserta una respuesta guardada.',
            },
            { shot: '[data-testid="imcrm-ticket-composer"]', caption: 'Elige si va tu firma y en qué estado queda el ticket, y toca «Enviar»: el cliente lo recibe en la misma conversación.' },
            {
                run: async ({ page, base, lists, tenantId }) => {
                    await page.request.delete(`${base}/api/v1/lists/${lists.Tickets.slug}/helpdesk/mailbox`, { headers: { 'x-tenant-id': String(tenantId) } });
                },
            },
        ],
    },
];
