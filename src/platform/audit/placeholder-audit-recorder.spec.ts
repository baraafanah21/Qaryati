import { Logger } from '@nestjs/common';
import type { TransactionHost } from '@nestjs-cls/transactional';
import { FixedClock } from '../../shared/kernel';
import type { RequestContext } from '../context/request-context';
import type { PgTransactionalAdapter } from '../database/pg-transactional-adapter';
import { PlaceholderAuditRecorder } from './placeholder-audit-recorder';

const entry = {
  action: 'widget.created',
  entityType: 'Widget',
  entityId: 'w1',
  after: { name: 'secret-ish' },
};

function recorder(inTransaction: boolean) {
  const txHost = {
    isTransactionActive: () => inTransaction,
  } as TransactionHost<PgTransactionalAdapter>;
  const context = { actorId: 'u1', requestId: 'r1' } as RequestContext;
  return new PlaceholderAuditRecorder(txHost, context, new FixedClock('2026-10-18T10:00:00Z'));
}

describe('PlaceholderAuditRecorder', () => {
  it('rejects a call outside a transaction, as the port contract requires', async () => {
    await expect(recorder(false).record(entry)).rejects.toThrow(/inside @Transactional\(\)/);
  });

  it('logs the entry at warn, with actor and time but without snapshots', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await recorder(true).record(entry);
      expect(warn).toHaveBeenCalledWith(
        {
          action: 'widget.created',
          entityType: 'Widget',
          entityId: 'w1',
          villageId: undefined,
          actorId: 'u1',
          occurredAt: '2026-10-18T10:00:00.000Z',
        },
        'audit persistence not implemented yet (#20)',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
