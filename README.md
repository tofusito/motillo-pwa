# Motillo

Motillo is a self-hosted dashboard for monitoring an electric motorcycle's charging energy and estimating its energy cost. It runs locally with Docker Compose, Bun, Preact and SQLite. It has no built-in user login, analytics service, or cloud database.

## Features

- Live power, energy and charging status from one explicitly selected Meross device.
- Charging sessions, monthly summaries, CSV export, and sparse daily and hourly history when the device provides it.
- Monthly fixed-price and three-period contracts, plus hourly PVPC energy prices for Spain; missing contract prices remain unknown.
- A separate read-only Meross connector. Meross account credentials are used only by that service; the dashboard never receives them.
- Local SQLite storage. Unknown readings, missing history and missing prices remain unknown instead of being filled with zeroes.

PVPC hours come from REData's public series id 1001, published in EUR/MWh and converted to EUR/kWh by dividing by 1000. Values are for Peninsular Spain and the Balearic Islands in Europe/Madrid time, in EUR, with taxes excluded. After selecting PVPC and importing a month in Settings, the current month refreshes hourly. Select and import each new month explicitly; absent or unpublished hours stay unpriced. PVPC is an energy-price reference, not a complete electricity bill: it excludes contracted power, other fixed charges, discounts, taxes and invoice-specific adjustments. PVPC does not invent peak/flat/valley comparisons. Motillo does not claim support for tariff markets, countries or currencies beyond this Spanish use case.

## Requirements

- Docker Engine and Docker Compose v2.
- A Meross device compatible with the connector's read-only protocol and reachable on the same trusted LAN as the connector. Compatibility depends on model and firmware; it is not guaranteed for every Meross device.
- The device UUID and Meross account credentials.

The connector uses an undocumented Meross app protocol ([protocol reference](https://github.com/krahabb/meross_lan)). Meross does not provide a supported public API for this integration, so vendor or firmware changes can break it. The connector verifies the selected UUID and exposes only fixed read operations. It cannot control the plug.

Each installation currently supports one selected device. Compatibility is limited to Meross plugs that support the LAN `Electricity` and `ConsumptionX` read messages without extra encryption. `ConsumptionH` hourly history is optional and depends on the model and firmware.

## Install with Docker Compose

1. Clone the public repository and enter its directory:

   ```sh
   git clone https://github.com/tofusito/motillo-pwa.git
   cd motillo-pwa
   ```
2. Create a private environment file and set your values:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

   Set `MEROSS_EMAIL` and `MEROSS_PASSWORD`. Enclose passwords containing `$`, `#` or spaces in single quotes in `.env` to avoid Compose interpolation. `MEROSS_REGION` defaults to `eu`; supported connector regions are `eu`, `us`, and `ap`. Keep `.env` private and never commit it.

3. Discover your device UUID. If the account requires MFA, set `MEROSS_MFA_CODE` in `.env` and retry:

   ```sh
   docker compose build meross-connector
   docker compose run --rm --no-deps meross-connector bun discover.ts
   ```

   Choose the intended device and copy its UUID to `MEROSS_DEVICE_ID`. The CLI prints only UUID, optional name and model. Set `MEROSS_HOST` to that device's current private LAN IPv4 address.

4. Generate a long random `CONNECTOR_TOKEN` in `.env` (for example, `openssl rand -hex 32`). The same value is passed only to the dashboard and the internal connector API. Do not reuse a Meross password as this token.
5. Create the bind-mount directories and make them writable only by the container user. The images run as Bun UID 1000; on Linux, for example: `mkdir -p data connector-data && sudo chown 1000:1000 data connector-data && chmod 700 data connector-data`. Adjust ownership for your Docker host if needed.
6. Review `APP_ORIGIN`. For a local-only install, leave it as `http://127.0.0.1:3060`. Then validate and start:

   ```sh
   docker compose config --quiet
   docker compose up -d --build
   ```

7. Open <http://127.0.0.1:3060>. The connector’s logical sensors are configured automatically on a new installation; you can adjust them in Settings. Enter your own contracted energy prices by month. Motillo does not infer a contract from an appliance or silently carry prices into a new month.

The Compose file binds the web port to loopback by default. The web application has no built-in login. Before making it reachable from another device or network, put HTTPS and an authentication layer such as a trusted identity-aware proxy in front of it, set `APP_ORIGIN` to the exact public origin, and configure the proxy to reach the web service. Same-origin protections reduce cross-site writes; they do not authenticate users. Do not expose the unauthenticated service directly to the Internet. Keep the connector on the trusted LAN; it has no published host port.

### Environment variables

`.env.example` is a template, not a secret store. Compose reads it for variable substitution and injects each service only with the values it needs. The Meross email, password and optional MFA code are injected only into `meross-connector`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `MEROSS_EMAIL`, `MEROSS_PASSWORD` | Connector | Meross account sign-in |
| `MEROSS_REGION` | Connector | Meross account region: `eu`, `us` or `ap`; defaults to `eu` |
| `MEROSS_MFA_CODE` | Connector | Optional one-time MFA code when requested |
| `MEROSS_DEVICE_ID` | Connector and dashboard | Explicit device UUID; selects the device and enables optional daily history |
| `MEROSS_HOST` | Connector | Private LAN IPv4 address for the selected device |
| `CONNECTOR_TOKEN` | Connector and dashboard | Shared bearer token for the private connector API |
| `MEROSS_CONNECTOR_URL` | Dashboard | Internal connector URL; already set in Compose |
| `DATA_DIR`, `HOST`, `PORT` | Dashboard | Storage directory, bind address and web port; set for the container in Compose |
| `APP_ORIGIN` | Dashboard | Exact origin used for same-origin checks |
| `DAILY_ENERGY_RESET` | Dashboard | Whether a daily counter reset at Madrid midnight is expected |

### Data and backups

All durable application and connector state lives under `./data` and `./connector-data`. Back up both directories, along with your private `.env` and the Compose file. Protect backups as personal data. For SQLite, use a consistent SQLite backup or stop the dashboard before copying its database; do not copy only the main database file while WAL writes may be active. Keep at least one backup outside the host running Motillo and periodically check that it can be restored.

The connector keeps a private Meross session cache in its data directory. It is recoverable: if lost, the connector may need to sign in again. Preserve the directory with restricted filesystem permissions because it contains authentication material. The dashboard database contains readings, charging history and configured rates.

### Updating

Back up the data directories, `.env`, and Compose file before updating. Then fetch the release or commit you intend to run and rebuild:

```sh
git pull --ff-only
docker compose config --quiet
docker compose up -d --build
```

Read release notes before upgrading. Keep a known-good source revision or image available for rollback, and restore a database backup only when the newer schema or behavior cannot safely be used with the previous release. Do not delete the persistent data directories during an update.

## Development

Install Bun 1.3.9 or compatible, then run:

```sh
bun install
bun run build
bun run typecheck
bun test
```

For local development, the web server needs a reachable connector and the private variables listed in `.env.example`. The Compose setup is the simplest complete development environment. Do not use real credentials or device data in automated tests.

See [connector/README.md](connector/README.md) for connector behavior and [server/README.md](server/README.md) for data, rates and historical accuracy.

## Data sources and license

Hourly regulated energy data comes from [Red Eléctrica REData](https://www.ree.es/es/datos/apidatos), PVPC series 1001 in the real-time market-prices widget. The separate spot-price series is never substituted for PVPC. Reuse of upstream data remains subject to its provider terms.

Motillo code is available under the [MIT License](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and contribution guidance.
