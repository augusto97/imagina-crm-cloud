import { Global, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuthModule } from '../auth/auth.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/**
 * C1 ↔ C5 — Conecta los aprobadores «Un equipo» de las aprobaciones con los
 * equipos: las personas del equipo en el momento de decidir y el directorio
 * (nombre del equipo en el paso, validación del flujo). Exportada para los
 * tests (el módulo la llama al arrancar).
 */
export function connectTeamApprovers(approvals: ApprovalsService, teams: TeamsService): void {
    approvals.setTeamMembersResolver((tx, _tenantId, teamId) => teams.memberIds(tx, teamId));
    approvals.setTeamDirectoryResolver((tx, tenantId) => teams.infos(tx, tenantId));
}

/**
 * C1 — Global: el ACL, los avisos, «Mi trabajo», el import/export y las
 * aprobaciones leen los equipos sin tener que importar este módulo.
 */
@Global()
@Module({
    imports: [AuthModule],
    controllers: [TeamsController],
    providers: [TeamsService],
    exports: [TeamsService],
})
export class TeamsModule implements OnApplicationBootstrap {
    private readonly logger = new Logger(TeamsModule.name);

    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly teams: TeamsService,
    ) {}

    onApplicationBootstrap(): void {
        // Se resuelve en ejecución (sin importar el módulo de aprobaciones:
        // evita un ciclo de DI). Sin aprobaciones, no hay nada que conectar.
        let approvals: ApprovalsService | null = null;
        try {
            approvals = this.moduleRef.get(ApprovalsService, { strict: false });
        } catch {
            approvals = null;
        }
        if (approvals) connectTeamApprovers(approvals, this.teams);
        else this.logger.warn('Aprobaciones no disponibles: los pasos «Un equipo» no tendrán aprobadores.');
    }
}
