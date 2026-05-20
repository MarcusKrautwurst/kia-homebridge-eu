import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  readFileSync(new URL('../config.schema.json', import.meta.url), 'utf-8'),
) as {
  pluginAlias: string;
  schema: {
    properties: Record<string, {
      default?: unknown;
      required?: boolean;
      pattern?: string;
      minimum?: number;
      maximum?: number;
    }>;
  };
};

describe('config.schema.json', () => {
  it('uses the EU plugin alias', () => {
    expect(schema.pluginAlias).toBe('KiaConnectEU');
  });

  it('requires credentials and a PIN', () => {
    const properties = schema.schema.properties;
    expect(properties.username.required).toBe(true);
    expect(properties.password.required).toBe(true);
    expect(properties.pin.required).toBe(true);
    expect(properties.pin.pattern).toBe('^[0-9]{4,6}$');
  });

  it('includes category visibility fields with the documented defaults', () => {
    const properties = schema.schema.properties;

    expect(properties.showLock.default).toBe(true);
    expect(properties.showClimate.default).toBe(true);
    expect(properties.showStatus.default).toBe(true);
    expect(properties.showBody.default).toBe(false);
    expect(properties.showBattery.default).toBe(true);
  });

  it('uses a Celsius climate temperature range', () => {
    const temp = schema.schema.properties.climateTemperature;
    expect(temp.default).toBe(21);
    expect(temp.minimum).toBe(14);
    expect(temp.maximum).toBe(30);
  });

  it('does not include accessoryLayout', () => {
    const properties = schema.schema.properties;
    expect(properties).not.toHaveProperty('accessoryLayout');
  });
});
