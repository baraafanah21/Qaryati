import { ClaimTypeRegistry, type PreferredClaimChange } from './claim-type-registry';

const change: PreferredClaimChange = {
  villageId: 'village-1',
  groupKey: 'location|village-1',
  newPreferredClaimId: 'claim-2',
  previousPreferredClaimId: 'claim-1',
};

describe('ClaimTypeRegistry', () => {
  it('calls the hook of the registered claim type only', async () => {
    const registry = new ClaimTypeRegistry();
    const location = jest.fn().mockResolvedValue(undefined);
    const population = jest.fn().mockResolvedValue(undefined);
    registry.register({ claimType: 'LOCATION', onPreferredChanged: location });
    registry.register({ claimType: 'POPULATION', onPreferredChanged: population });

    await registry.notifyPreferredChanged('LOCATION', change);

    expect(location).toHaveBeenCalledWith(change);
    expect(population).not.toHaveBeenCalled();
  });

  it('does nothing for a type without a handler or without a hook', async () => {
    const registry = new ClaimTypeRegistry();
    registry.register({ claimType: 'MEASURE' });

    await expect(registry.notifyPreferredChanged('MEASURE', change)).resolves.toBeUndefined();
    await expect(registry.notifyPreferredChanged('FACILITY', change)).resolves.toBeUndefined();
  });

  it('refuses a second handler for the same claim type', () => {
    const registry = new ClaimTypeRegistry();
    registry.register({ claimType: 'LOCATION' });

    expect(() => registry.register({ claimType: 'LOCATION' })).toThrow(/already registered/);
  });

  it('propagates a failing hook so the review transaction rolls back', async () => {
    const registry = new ClaimTypeRegistry();
    registry.register({
      claimType: 'LOCATION',
      onPreferredChanged: () => Promise.reject(new Error('projection failed')),
    });

    await expect(registry.notifyPreferredChanged('LOCATION', change)).rejects.toThrow(
      'projection failed',
    );
  });
});
