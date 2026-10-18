import { CLS_ID, ClsServiceManager } from 'nestjs-cls';
import { RequestContext } from './request-context';

describe('RequestContext', () => {
  const cls = ClsServiceManager.getClsService();
  const context = new RequestContext(cls);

  it('returns the request ID and the actor set by the guard inside a request', async () => {
    await cls.run(async () => {
      cls.set(CLS_ID, 'req-1');
      expect(context.actorId).toBeUndefined();
      context.setActorId('user-7');
      expect(context.requestId).toBe('req-1');
      expect(context.actorId).toBe('user-7');
      await Promise.resolve();
    });
  });

  it('keeps actors of concurrent requests apart', async () => {
    const actorAfterTick = (actor: string) =>
      cls.run(async () => {
        context.setActorId(actor);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return context.actorId;
      });
    await expect(Promise.all([actorAfterTick('a'), actorAfterTick('b')])).resolves.toEqual([
      'a',
      'b',
    ]);
  });

  it('has neither outside a request, and refuses to set an actor there', () => {
    expect(context.requestId).toBeUndefined();
    expect(context.actorId).toBeUndefined();
    expect(() => context.setActorId('user-7')).toThrow(/outside a request context/);
  });
});
