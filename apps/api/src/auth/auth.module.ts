import { Module } from '@nestjs/common';
import { PersonalTokensService } from '../ai/tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
    controllers: [AuthController],
    // v0.1.441 — PersonalTokensService vive aquí: el SessionGuard lo usa para
    // los tokens de la API REST en cualquier módulo que importe éste.
    providers: [AuthService, SessionService, SessionGuard, PersonalTokensService],
    exports: [AuthService, SessionService, SessionGuard, PersonalTokensService],
})
export class AuthModule {}
