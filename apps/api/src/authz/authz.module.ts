import { Global, Module } from '@nestjs/common';
import { CapabilitiesGuard } from './capabilities.guard';

@Global()
@Module({
    providers: [CapabilitiesGuard],
    exports: [CapabilitiesGuard],
})
export class AuthzModule {}
