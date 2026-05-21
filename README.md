# homebridge-kia-eu

Homebridge plugin for **Kia Connect (UVO) vehicles in Europe**, powered by
[bluelinky](https://github.com/Hacksore/bluelinky).

This is an EU adaptation of [`jfriend615/homebridge-kia`](https://github.com/jfriend615/homebridge-kia)
(which targets the US Kia Connect API). The HomeKit accessory layer is shared; the
Kia API client was replaced with `bluelinky` so it speaks to Kia's European servers
(OAuth2 + control PIN + request stamping), and remote climate uses Celsius.

> ⚠️ The EU Kia/Hyundai API is unofficial and occasionally changes. `bluelinky`'s EU
> support is community-maintained and can break when Kia updates its app. If logins
> suddenly fail, check for a newer `bluelinky` release.

## Features

- Door lock / unlock
- Remote climate start / stop (Celsius)
- EV battery charge level and charging state (or 12V battery for combustion cars)
- Low fuel warning, engine/ignition state, tire pressure warning
- Door, window, hood, and trunk sensors
- Odometer / mileage (shown as a light-sensor reading — see notes)

## Requirements

- Node.js `20.18.0` or newer
- Homebridge `1.8.0` or newer
- A **Kia (European) account** with an **active Kia Connect / UVO subscription**
- Your Kia Connect **PIN** (set in the Kia app) — the EU API requires it for status reads and remote commands

> ℹ️ The PIN is validated server-side and has a limited number of attempts before a
> temporary lockout. Make sure it is correct before starting Homebridge.

## Installation

Install through the Homebridge UI (search for `homebridge-kia-eu`), or with npm:

```bash
npm install -g homebridge-kia-eu
```

Then restart Homebridge.

## Configuration

Configure through the Homebridge UI, or add a platform block to `config.json`:

```json
{
  "platform": "KiaConnectEU",
  "name": "Kia Connect EU",
  "username": "you@example.com",
  "password": "your-password",
  "pin": "1234",
  "language": "en",
  "vehicleIndex": 0,
  "pollIntervalMinutes": 15,
  "showLock": true,
  "showClimate": true,
  "showStatus": true,
  "showBody": false,
  "showBattery": true,
  "showMileage": true,
  "climateTemperature": 21
}
```

| Setting | Description |
| --- | --- |
| `username` | Kia Connect email |
| `password` | Kia Connect password |
| `pin` | Kia Connect PIN (numeric). Required for status reads and commands |
| `language` | EU UI language (`en`, `de`, `fr`, …). Default `en` |
| `vehicleIndex` | Which vehicle to use if the account has several (0 = first) |
| `pollIntervalMinutes` | Status refresh interval, minimum `5` |
| `showLock` | Show the HomeKit lock service |
| `showClimate` | Show the HomeKit climate switch |
| `showStatus` | Show low-fuel, engine, and tire-warning sensors |
| `showBody` | Show door, window, hood, and trunk sensors |
| `showBattery` | Show the battery service (EV charge, or 12V) |
| `showMileage` | Show the odometer (as a light-sensor reading) |
| `climateTemperature` | Remote climate target temperature in °C (14–30) |

## HomeKit services

Up to five accessories are created per vehicle:

- `${vehicleName} Lock` — `LockMechanism`
- `${vehicleName} Climate` — `Switch`
- `${vehicleName} Status` — `LeakSensor` (low fuel), `OccupancySensor` (engine),
  `LeakSensor` (tire pressure)
- `${vehicleName} Body` — `ContactSensor` services for doors, windows, hood, trunk
- `${vehicleName} Battery` — `Battery` (EV charge + charging state, or 12V battery)
- `${vehicleName} Mileage` — `LightSensor` whose lux reading is the odometer in km

> ℹ️ HomeKit has no odometer field, so mileage is exposed through a light sensor — the
> "lux" value is your mileage in km (e.g. 12500). It's refreshed about once a day and
> caps at 100,000 (a HomeKit light-sensor limit). Disable it with `showMileage: false`.

## EU API limitations

The European API does **not** expose a few things the US API does, so these are
intentionally **not** shown (they would always read empty):

- **Ambient outside temperature** — no temperature sensor is created.
- **Fuel percentage** — no fuel-level sensor; only a low-fuel warning is exposed.

For EVs, the battery service reports the high-voltage traction battery's charge and
whether it is charging.

> ℹ️ HomeKit bundles each accessory's services into one tile group. The plugin sets
> each service's `ConfiguredName` so the Apple Home app shows individual names (e.g.
> "Front Left Door", "Tire Pressure Warning") rather than repeating the accessory name.

## Rate limiting & battery care

The EU API is rate limited (roughly 200 calls/day) and waking the car to refresh
status repeatedly can drain its 12V battery. This plugin:

- polls **cached** server status (does not wake the car) on the configured interval;
- only forces a live refresh immediately after you issue a lock/climate command.

Keep `pollIntervalMinutes` conservative (the default is 15).

## Authentication notes

Unlike the US plugin, there is **no OTP step**. The plugin logs in with your email,
password, and PIN on Homebridge start. If you change your password in the Kia app,
update it here and restart Homebridge.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

## Credits

- Original US plugin: [jfriend615/homebridge-kia](https://github.com/jfriend615/homebridge-kia)
- EU API library: [Hacksore/bluelinky](https://github.com/Hacksore/bluelinky)

## License

ISC
