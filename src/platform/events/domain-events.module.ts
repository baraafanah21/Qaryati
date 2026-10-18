import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DOMAIN_EVENT_PUBLISHER } from '../../shared/kernel';
import { EventEmitterDomainEventPublisher } from './domain-event-publisher';

/**
 * Provides `DOMAIN_EVENT_PUBLISHER` to every module and registers the
 * `@OnDomainEvent` listeners. Needs DatabaseModule, whose transactions hold
 * the events until commit.
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [{ provide: DOMAIN_EVENT_PUBLISHER, useClass: EventEmitterDomainEventPublisher }],
  exports: [DOMAIN_EVENT_PUBLISHER],
})
export class DomainEventsModule {}
