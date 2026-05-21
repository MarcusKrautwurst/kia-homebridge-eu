import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KiaApiClient, mapRawStatus } from '../src/kia/client.js';
import { AuthenticationError, KiaApiError } from '../src/kia/types.js';

// Shared, hoisted state so the bluelinky mock and the tests can coordinate.
const h = vi.hoisted(() => ({
  readyVehicles: [] as unknown[],
  emitError: null as unknown,
  lastConfig: null as Record<string, unknown> | null,
}));

vi.mock('bluelinky', () => {
  class MockBlueLinky {
    private handlers: Record<string, (arg: unknown) => void> = {};
    constructor(config: Record<string, unknown>) {
      h.lastConfig = config;
      // bluelinky auto-logs-in and emits on a later tick
      setTimeout(() => {
        if (h.emitError) {
          this.handlers.error?.(h.emitError);
        } else {
          this.handlers.ready?.(h.readyVehicles as never);
        }
      }, 0);
    }
    on(event: string, fn: (arg: unknown) => void): this {
      this.handlers[event] = fn;
      return this;
    }
    getVehicles(): Promise<unknown[]> {
      return Promise.resolve(h.readyVehicles);
    }
  }
  return { BlueLinky: MockBlueLinky };
});

const stubLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
  success: () => {},
  prefix: 'test',
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function fakeVehicle(overrides: Record<string, unknown> = {}) {
  return {
    vin: () => (overrides.vin as string) ?? 'VIN1',
    id: () => (overrides.id as string) ?? 'ID1',
    nickname: () => (overrides.nickname as string) ?? 'My EV6',
    name: () => (overrides.name as string) ?? 'EV6',
    status: vi.fn().mockResolvedValue(overrides.status ?? {}),
    lock: vi.fn().mockResolvedValue('locked'),
    unlock: vi.fn().mockResolvedValue('unlocked'),
    start: vi.fn().mockResolvedValue('started'),
    stop: vi.fn().mockResolvedValue('stopped'),
    odometer: vi.fn().mockResolvedValue(overrides.odometer ?? { value: 12345, unit: 1 }),
  };
}

function makeClient() {
  return new KiaApiClient(stubLog, {
    username: 'user@example.com',
    password: 'secret',
    pin: '1234',
    language: 'en',
  });
}

beforeEach(() => {
  h.readyVehicles = [];
  h.emitError = null;
  h.lastConfig = null;
});

describe('mapRawStatus', () => {
  it('maps a full EU raw status payload', () => {
    const raw = {
      doorLock: true,
      doorOpen: { frontLeft: 0, frontRight: 1, backLeft: 0, backRight: 0 },
      windowOpen: { frontLeft: 0, frontRight: 0, backLeft: 1, backRight: 0 },
      hoodOpen: false,
      trunkOpen: true,
      engine: false,
      airCtrlOn: true,
      defrost: false,
      lowFuelLight: false,
      battery: { batSoc: 80 },
      dte: { value: 320, unit: 1 },
      tirePressureLamp: { tirePressureWarningLampAll: 0, tirePressureWarningLampFrontLeft: 1 },
      evStatus: {
        batteryCharge: true,
        batteryStatus: 64,
        batteryPlugin: 1,
        drvDistance: [{ rangeByFuel: { evModeRange: { value: 300 }, totalAvailableRange: { value: 300 } } }],
      },
      lastStatusDate: '20250115100000',
    };

    const state = mapRawStatus(raw);

    expect(state.locked).toBe(true);
    expect(state.frontRightDoorOpen).toBe(true);
    expect(state.frontLeftDoorOpen).toBe(false);
    expect(state.rearLeftWindowOpen).toBe(true);
    expect(state.trunkOpen).toBe(true);
    expect(state.hoodOpen).toBe(false);
    expect(state.engineRunning).toBe(false);
    expect(state.airControlOn).toBe(true);

    expect(state.batteryPercentage).toBe(80);
    expect(state.evBatteryPercentage).toBe(64);
    expect(state.evCharging).toBe(true);
    expect(state.evPluggedIn).toBe(true);
    expect(state.evRange).toBe(300);

    expect(state.fuelLevel).toBeNull();
    expect(state.fuelLevelLow).toBe(false);
    expect(state.fuelDrivingRange).toBe(320);

    expect(state.tirePressureWarning).toBe(true);
    expect(state.outsideTemperature).toBeNull();
    expect(state.lastUpdated).toBe('20250115100000');
  });

  it('returns safe defaults for an empty or null payload', () => {
    const state = mapRawStatus(null);
    expect(state.locked).toBe(false);
    expect(state.frontLeftDoorOpen).toBe(false);
    expect(state.engineRunning).toBe(false);
    expect(state.airControlOn).toBe(false);
    expect(state.batteryPercentage).toBeNull();
    expect(state.evBatteryPercentage).toBeNull();
    expect(state.evCharging).toBe(false);
    expect(state.evPluggedIn).toBe(false);
    expect(state.fuelLevel).toBeNull();
    expect(state.fuelDrivingRange).toBeNull();
    expect(state.tirePressureWarning).toBe(false);
    expect(state.outsideTemperature).toBeNull();
    expect(state.lastUpdated).toBeNull();
  });

  it('treats a not-plugged EV as not charging', () => {
    const state = mapRawStatus({ evStatus: { batteryCharge: false, batteryStatus: 50, batteryPlugin: 0 } });
    expect(state.evBatteryPercentage).toBe(50);
    expect(state.evCharging).toBe(false);
    expect(state.evPluggedIn).toBe(false);
  });
});

describe('login', () => {
  it('resolves success and passes EU/kia config to bluelinky', async () => {
    h.readyVehicles = [fakeVehicle()];
    const client = makeClient();

    await expect(client.login()).resolves.toEqual({ success: true });

    expect(h.lastConfig).toMatchObject({
      brand: 'kia',
      region: 'EU',
      pin: '1234',
      language: 'en',
      username: 'user@example.com',
    });
  });

  it('resolves failure with the error message when bluelinky emits error', async () => {
    h.emitError = new Error('Invalid credentials');
    const client = makeClient();

    await expect(client.login()).resolves.toEqual({
      success: false,
      error: 'Invalid credentials',
    });
  });
});

describe('vehicle access', () => {
  it('maps vehicles to summaries keyed by VIN', async () => {
    h.readyVehicles = [fakeVehicle({ vin: 'VINABC', id: 'ID9', nickname: 'Kona', name: 'Kona Electric' })];
    const client = makeClient();
    await client.login();

    await expect(client.getVehicles()).resolves.toEqual([
      { id: 'ID9', vin: 'VINABC', key: 'VINABC', name: 'Kona', model: 'Kona Electric' },
    ]);
  });

  it('fetches and maps status for a known vehicle', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1', status: { doorLock: true, battery: { batSoc: 77 } } });
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    const state = await client.getVehicleStatus('VIN1');

    expect(vehicle.status).toHaveBeenCalledWith({ refresh: false, parsed: false });
    expect(state.locked).toBe(true);
    expect(state.batteryPercentage).toBe(77);
  });

  it('forces a refresh when requested', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1' });
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    await client.getVehicleStatus('VIN1', true);
    expect(vehicle.status).toHaveBeenCalledWith({ refresh: true, parsed: false });
  });

  it('throws for an unknown vehicle key', async () => {
    h.readyVehicles = [fakeVehicle({ vin: 'VIN1' })];
    const client = makeClient();
    await client.login();

    await expect(client.getVehicleStatus('NOPE')).rejects.toBeInstanceOf(KiaApiError);
  });

  it('caches the odometer and folds it into subsequent status', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1', odometer: { value: 54321, unit: 1 } });
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    await expect(client.refreshOdometer('VIN1')).resolves.toBe(54321);

    const state = await client.getVehicleStatus('VIN1');
    expect(state.odometer).toBe(54321);
    expect(vehicle.odometer).toHaveBeenCalledOnce();
  });
});

describe('commands', () => {
  it('locks and unlocks through the vehicle', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1' });
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    await expect(client.lockDoors('VIN1')).resolves.toBe('locked');
    await expect(client.unlockDoors('VIN1')).resolves.toBe('unlocked');
    expect(vehicle.lock).toHaveBeenCalledOnce();
    expect(vehicle.unlock).toHaveBeenCalledOnce();
  });

  it('starts climate in Celsius and clamps the temperature', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1' });
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    await client.startClimate('VIN1', { temperature: 99 });

    expect(vehicle.start).toHaveBeenCalledWith(
      expect.objectContaining({ hvac: true, unit: 'C', temperature: 30 }),
    );
  });

  it('wraps non-session failures as KiaApiError without retrying', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1' });
    vehicle.status.mockReset();
    vehicle.status.mockRejectedValue(new Error('something unexpected broke'));
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    await expect(client.getVehicleStatus('VIN1')).rejects.toBeInstanceOf(KiaApiError);
    expect(vehicle.status).toHaveBeenCalledTimes(1);
  });
});

describe('session recovery', () => {
  it('re-authenticates and retries once on an Invalid deviceId error', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1' });
    vehicle.status.mockReset();
    vehicle.status
      .mockRejectedValueOnce(new Error('[400] Bad Request ... "resCode":"4002","resMsg":"Invalid request body - Invalid deviceId."'))
      .mockResolvedValue({ doorLock: true });
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    const state = await client.getVehicleStatus('VIN1');

    expect(state.locked).toBe(true);
    expect(vehicle.status).toHaveBeenCalledTimes(2);
  });

  it('does not re-login or retry on a PIN error (avoids burning attempts)', async () => {
    const vehicle = fakeVehicle({ vin: 'VIN1' });
    vehicle.status.mockReset();
    vehicle.status.mockRejectedValue(new Error('[400] resCode 4003 user/pin Invalid values'));
    h.readyVehicles = [vehicle];
    const client = makeClient();
    await client.login();

    await expect(client.getVehicleStatus('VIN1')).rejects.toBeInstanceOf(AuthenticationError);
    expect(vehicle.status).toHaveBeenCalledTimes(1);
  });
});
