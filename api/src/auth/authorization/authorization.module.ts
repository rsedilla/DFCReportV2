import { Module } from '@nestjs/common';

import { HierarchyModule } from '../../hierarchy/hierarchy.module';
import { NetworksModule } from '../../networks/networks.module';

import { AuthorizationService } from './authorization.service';
import { CapabilityGuard } from './capability.guard';

/**
 * The capability and scope guard, on its own (SKILL.md section 7).
 *
 * **Split out of `AuthModule` so that asking an authorization question does not
 * mean importing accounts, tokens and controllers.** `people` needs
 * `AuthorizationService` and nothing else from `auth`; before this it imported the
 * whole module, which made `auth → people` a cycle and left `auth` reading
 * `persons` directly rather than through the module that owns it (section 2).
 *
 * The dependency now runs `people → authorization` and `auth → people`, with
 * nothing pointing back. `AccessTokenGuard` stays in `AuthModule`, because it needs
 * `TokensService` and `AccountsRepository` — it authenticates, which is a different
 * question from what an authenticated actor may do.
 *
 * This module imports `hierarchy` and `networks` because a scope is evaluated by
 * walking the tree and reading a Network; neither imports back.
 */
@Module({
  imports: [HierarchyModule, NetworksModule],
  providers: [AuthorizationService, CapabilityGuard],
  // `CapabilityGuard` is registered globally in `AppModule`, so its dependencies
  // must be resolvable from there. Nest resolves a provider's dependencies in the
  // context of the module that registers it.
  exports: [AuthorizationService, CapabilityGuard],
})
export class AuthorizationModule {}
