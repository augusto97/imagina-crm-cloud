import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { AutomationsService } from '../automations/automations.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { ViewsService } from '../views/views.service';

/**
 * Seed de demo: crea un usuario + workspace con datos realistas para explorar
 * la app. Idempotente por email (si ya existe, aborta con un aviso).
 *
 *   pnpm --filter @imagina-base/api seed
 */
async function seed(): Promise<void> {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
    const auth = app.get(AuthService);
    const lists = app.get(ListsService);
    const fields = app.get(FieldsService);
    const records = app.get(RecordsService);
    const views = app.get(ViewsService);
    const automations = app.get(AutomationsService);

    const email = 'demo@imagina.base';
    const password = 'demo1234';

    try {
        const session = await auth.register({
            email,
            password,
            name: 'Demo',
            workspace_name: 'Imagina Base Demo',
        });
        const tenantId = session.memberships[0]!.tenant_id;
        const actor: Actor = { userId: session.user.id, role: 'admin' };

        // --- Lista: Clientes ---
        const clientes = await lists.create(tenantId, { name: 'Clientes', icon: '👥', color: '#3b82f6' });
        const cNombre = await fields.create(tenantId, clientes.slug, { label: 'Nombre', type: 'text', is_required: true });
        const cMonto = await fields.create(tenantId, clientes.slug, { label: 'Valor cuenta', type: 'currency' });
        const cEstado = await fields.create(tenantId, clientes.slug, {
            label: 'Estado',
            type: 'select',
            config: {
                options: [
                    { value: 'prospecto', label: 'Prospecto', color: 'amber' },
                    { value: 'activo', label: 'Activo', color: 'green' },
                    { value: 'perdido', label: 'Perdido', color: 'rose' },
                ],
            },
        });
        await views.create(tenantId, clientes.slug, {
            name: 'Tabla',
            type: 'table',
            is_default: true,
            config: { visible_field_ids: [cNombre.id, cMonto.id, cEstado.id] },
        });
        await views.create(tenantId, clientes.slug, {
            name: 'Pipeline',
            type: 'kanban',
            config: { group_by_field_id: cEstado.id, kanban_title_field_id: cNombre.id },
        });

        const clientesSeed = [
            { nombre: 'ACME Corp', monto: 12000, estado: 'activo' },
            { nombre: 'Globex', monto: 3500, estado: 'prospecto' },
            { nombre: 'Initech', monto: 800, estado: 'perdido' },
            { nombre: 'Umbrella', monto: 25000, estado: 'activo' },
            { nombre: 'Soylent', monto: 5000, estado: 'prospecto' },
        ];
        for (const c of clientesSeed) {
            await records.create(tenantId, actor, clientes.slug, {
                data: {
                    [`f${cNombre.id}`]: c.nombre,
                    [`f${cMonto.id}`]: c.monto,
                    [`f${cEstado.id}`]: c.estado,
                },
            });
        }

        // --- Lista: Tareas ---
        const tareas = await lists.create(tenantId, { name: 'Tareas', icon: '✅', color: '#22c55e' });
        const tTitulo = await fields.create(tenantId, tareas.slug, { label: 'Título', type: 'text', is_required: true });
        await fields.create(tenantId, tareas.slug, { label: 'Vence', type: 'date' });
        await views.create(tenantId, tareas.slug, { name: 'Tabla', type: 'table', is_default: true });

        // --- Automatización: cliente activo grande → crear tarea de follow-up ---
        await automations.create(tenantId, clientes.slug, {
            name: 'Follow-up de cuentas grandes',
            trigger: { type: 'record_created' },
            condition: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: cMonto.id, op: 'gte', value: 10000 }],
            },
            actions: [
                { type: 'create_record', list_id: tareas.id, data: { [`f${tTitulo.id}`]: 'Llamar a la cuenta nueva' } },
            ],
        });

        console.log('\n✔ Seed listo. Workspace: "Imagina Base Demo"');
        console.log(`  Login:  ${email}  /  ${password}`);
        console.log('  2 listas (Clientes con Kanban + Tareas), 5 clientes, 1 automatización.\n');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Ya existe una cuenta')) {
            console.log(`\nEl usuario demo ya existe (${email} / ${password}). Nada que sembrar.\n`);
        } else {
            console.error('Seed falló:', message);
            process.exitCode = 1;
        }
    } finally {
        await app.close();
    }
}

void seed();
