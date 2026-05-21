# Changelog

All notable changes to this project are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

## 1.3.0 - 2026-05-21
### Changed
- Each body sensor (door, window, hood, trunk) is now its own accessory with a
  HomeKit **Door** or **Window** category, instead of one grouped "Body" accessory
  of generic contact sensors. They now show with the correct door/window type/icon.
  The old "${vehicleName} Body" accessory is replaced automatically on upgrade.

## 1.2.0 - 2026-05-21
### Changed
- Body sensors (doors, windows, hood, trunk) now show **by default** (`showBody`
  defaults to `true`). Set `showBody: false` to hide them.

## 1.1.1 - 2026-05-21
### Fixed
- Password and PIN fields are now actually masked in the config UI. The form
  renderer honours the `layout` field type over `format`, so both are now set to
  `type: password`. (Restart Homebridge after updating so the UI reloads the schema.)

## 1.1.0 - 2026-05-21
### Added
- Odometer / mileage support. HomeKit has no mileage field, so it's surfaced as a
  `LightSensor` whose reading is the mileage in km (e.g. 12500), shown as a
  "${vehicleName} Mileage" accessory. Toggle with `showMileage` (default on).
  Refreshed roughly once a day to limit API calls; caps at 100,000.

## 1.0.6 - 2026-05-21
### Added
- `CHANGELOG.md` and GitHub Releases so release notes appear in the Homebridge UI
  (the "Release Notes" prompt on update and the plugin's "Changelog" menu).

## 1.0.5 - 2026-05-21
### Changed
- The config UI now masks the **Password** and **PIN** fields instead of showing
  them in plain text (`format: password`).

## 1.0.4 - 2026-05-21
### Fixed
- Self-heal on an expired session / `Invalid deviceId` (resCode 4002): the plugin
  now re-authenticates once and retries, instead of failing every poll until a
  manual Homebridge restart. PIN errors (4003) are deliberately **not** retried so
  limited PIN attempts aren't wasted.

## 1.0.3 - 2026-05-20
### Fixed
- Apple Home now shows per-service names (via `ConfiguredName`) instead of
  repeating the accessory name on every tile (e.g. "Front Left Door", "Tire
  Pressure Warning").
### Removed
- The outside-temperature and fuel-percentage sensors, which the EU API never
  provides (they always read 0). Stale copies are cleaned off existing accessories
  on upgrade. Low-fuel warning, engine, and tire sensors remain.

## 1.0.2 - 2026-05-20
### Changed
- Default `pollIntervalMinutes` lowered from 30 to 15.

## 1.0.1 - 2026-05-20
### Fixed
- Lock/unlock/climate commands are no longer reported as failed because of a
  post-command "Duplicate request" (resCode 4004). State is now reflected
  optimistically and confirmed on the next poll.

## 1.0.0 - 2026-05-20
### Added
- Initial release. EU adaptation of `jfriend615/homebridge-kia`, backed by
  [bluelinky](https://github.com/Hacksore/bluelinky) (region EU, brand Kia):
  door lock/unlock, remote climate (Celsius), EV battery charge + charging state,
  low-fuel / engine / tire-pressure sensors, and door/window/hood/trunk sensors.
