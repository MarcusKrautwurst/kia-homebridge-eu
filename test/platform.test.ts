import { describe, it, expect, vi, afterEach } from 'vitest';
import { KiaConnectPlatform } from '../src/platform.js';
import { KiaApiClient } from '../src/kia/client.js';

class MockCharacteristicHandle {
  onSet(): this {
    return this;
  }
}

class MockService {
  constructor(
    public readonly type: string,
    public readonly name: string,
    public readonly subtype?: string,
  ) {}

  setCharacteristic(): this {
    return this;
  }

  getCharacteristic(): MockCharacteristicHandle {
    return new MockCharacteristicHandle();
  }

  updateCharacteristic(): this {
    return this;
  }

  testCharacteristic(): boolean {
    return false;
  }

  addOptionalCharacteristic(): void {
    // no-op for tests
  }
}

class MockPlatformAccessory {
  public readonly services: MockService[] = [];

  constructor(
    public displayName: string,
    public readonly UUID: string,
  ) {}

  getService(type: string): MockService | undefined {
    return this.services.find((service) => service.type === type && !service.subtype);
  }

  getServiceById(type: string, subtype: string): MockService | undefined {
    return this.services.find((service) => service.type === type && service.subtype === subtype);
  }

  addService(type: string, name?: string, subtype?: string): MockService {
    const service = new MockService(type, name ?? type, subtype);
    this.services.push(service);
    return service;
  }

  removeService(service: MockService): void {
    const index = this.services.indexOf(service);
    if (index >= 0) {
      this.services.splice(index, 1);
    }
  }
}

function makeApi() {
  const platformAccessory = vi.fn(function (this: unknown, displayName: string, UUID: string) {
    return new MockPlatformAccessory(displayName, UUID);
  });

  return {
    hap: {
      Service: {
        AccessoryInformation: 'AccessoryInformation',
        LockMechanism: 'LockMechanism',
        Switch: 'Switch',
        Battery: 'Battery',
        HumiditySensor: 'HumiditySensor',
        TemperatureSensor: 'TemperatureSensor',
        OccupancySensor: 'OccupancySensor',
        ContactSensor: 'ContactSensor',
        LeakSensor: 'LeakSensor',
        LightSensor: 'LightSensor',
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        ConfiguredName: 'ConfiguredName',
        LockTargetState: { SECURED: 1, UNSECURED: 0 },
        LockCurrentState: { SECURED: 1, UNSECURED: 0 },
        On: 'On',
        BatteryLevel: 'BatteryLevel',
        StatusLowBattery: {
          BATTERY_LEVEL_LOW: 1,
          BATTERY_LEVEL_NORMAL: 0,
        },
        ChargingState: {
          CHARGING: 1,
          NOT_CHARGING: 0,
        },
        CurrentRelativeHumidity: 'CurrentRelativeHumidity',
        CurrentTemperature: 'CurrentTemperature',
        CurrentAmbientLightLevel: 'CurrentAmbientLightLevel',
        OccupancyDetected: {
          OCCUPANCY_DETECTED: 1,
          OCCUPANCY_NOT_DETECTED: 0,
        },
        ContactSensorState: {
          CONTACT_DETECTED: 0,
          CONTACT_NOT_DETECTED: 1,
        },
        LeakDetected: {
          LEAK_DETECTED: 1,
          LEAK_NOT_DETECTED: 0,
        },
      },
      uuid: {
        generate: vi.fn((value: string) => `uuid-${value}`),
      },
    },
    user: {
      storagePath: () => '/tmp/kia-platform-test',
    },
    on: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    platformAccessory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeVehicle() {
  return {
    id: 'vehicle-id',
    key: 'VIN123',
    name: 'My Sorento',
    model: 'SORENTO',
    vin: 'VIN123',
  };
}

function makeState() {
  return {
    frontLeftDoorOpen: false,
    frontRightDoorOpen: false,
    rearLeftDoorOpen: false,
    rearRightDoorOpen: false,
    hoodOpen: false,
    trunkOpen: false,
    locked: true,
    engineRunning: false,
    airControlOn: false,
    defrostOn: false,
    outsideTemperature: null,
    batteryPercentage: 80,
    evBatteryPercentage: 64,
    evCharging: false,
    evPluggedIn: false,
    evRange: 300,
    fuelLevel: null,
    fuelLevelLow: false,
    fuelDrivingRange: 320,
    frontLeftWindowOpen: false,
    frontRightWindowOpen: false,
    rearLeftWindowOpen: false,
    rearRightWindowOpen: false,
    tirePressureWarning: false,
    odometer: null,
    latitude: null,
    longitude: null,
    lastUpdated: null,
  };
}

function makePlatform(configOverrides: Record<string, unknown> = {}) {
  const api = makeApi();
  const platform = new KiaConnectPlatform(makeLog(), {
    username: 'user@example.com',
    password: 'secret',
    pin: '1234',
    ...configOverrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any, api);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (platform as any).apiClient = {
    getVehicles: vi.fn().mockResolvedValue([makeVehicle()]),
    getVehicleStatus: vi.fn().mockResolvedValue(makeState()),
    refreshOdometer: vi.fn().mockResolvedValue(12345),
    lockDoors: vi.fn(),
    unlockDoors: vi.fn(),
    startClimate: vi.fn(),
    stopClimate: vi.fn(),
    waitForAction: vi.fn(),
  };

  return { api, platform };
}

function getRegisteredAccessories(api: ReturnType<typeof makeApi>): MockPlatformAccessory[] {
  return api.registerPlatformAccessories.mock.calls.flatMap((call: unknown[]) => call[2] as MockPlatformAccessory[]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KiaConnectPlatform', () => {
  it('logs in and then sets up the vehicle on success', async () => {
    const platform = new KiaConnectPlatform(makeLog(), {
      username: 'user@example.com',
      password: 'secret',
      pin: '1234',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any, makeApi());

    const loginSpy = vi.spyOn(KiaApiClient.prototype, 'login').mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setupSpy = vi.spyOn(platform as any, 'setupVehicle').mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (platform as any).discoverDevices();

    expect(loginSpy).toHaveBeenCalledOnce();
    expect(setupSpy).toHaveBeenCalledOnce();
  });

  it('does not set up the vehicle when login fails', async () => {
    const platform = new KiaConnectPlatform(makeLog(), {
      username: 'user@example.com',
      password: 'secret',
      pin: '1234',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any, makeApi());

    vi.spyOn(KiaApiClient.prototype, 'login').mockResolvedValue({ success: false, error: 'bad creds' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setupSpy = vi.spyOn(platform as any, 'setupVehicle');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (platform as any).discoverDevices();

    expect(setupSpy).not.toHaveBeenCalled();
  });

  it('unregisters cached accessories when no vehicles are returned', async () => {
    const { api, platform } = makePlatform();
    const cachedAccessory = new MockPlatformAccessory('Cached Vehicle', 'cached-uuid');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).accessories.set(cachedAccessory.UUID, cachedAccessory);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).apiClient.getVehicles.mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (platform as any).setupVehicle();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [cachedAccessory],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((platform as any).accessories.size).toBe(0);
  });

  it('unregisters cached accessories when vehicleIndex is out of range', async () => {
    const { api, platform } = makePlatform({ vehicleIndex: 2 });
    const cachedAccessory = new MockPlatformAccessory('Cached Vehicle', 'cached-uuid');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).accessories.set(cachedAccessory.UUID, cachedAccessory);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (platform as any).setupVehicle();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [cachedAccessory],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((platform as any).accessories.size).toBe(0);
  });

  it('creates only enabled grouped accessories with the recommended defaults', async () => {
    const { api, platform } = makePlatform();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (platform as any).setupVehicle();

    const registeredNames = getRegisteredAccessories(api).map((accessory) => accessory.displayName);
    expect(registeredNames).toEqual([
      'My Sorento Lock',
      'My Sorento Climate',
      'My Sorento Status',
      'My Sorento Battery',
      'My Sorento Mileage',
    ]);
  });

  it('removes stale cached accessories when category visibility changes', async () => {
    const { api, platform } = makePlatform({
      showBattery: false,
      showBody: false,
    });
    const staleBatteryAccessory = new MockPlatformAccessory('My Sorento Battery', 'uuid-VIN123:battery');
    const staleBodyAccessory = new MockPlatformAccessory('My Sorento Body', 'uuid-VIN123:body');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).accessories.set(staleBatteryAccessory.UUID, staleBatteryAccessory);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).accessories.set(staleBodyAccessory.UUID, staleBodyAccessory);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (platform as any).setupVehicle();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [staleBatteryAccessory],
    );
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [staleBodyAccessory],
    );
  });
});
