# Meross connector

`meross-connector` is a small, separate Bun service that signs in to a Meross account, verifies one configured device UUID, and reads measurements from that device over the local network. It is read-only: there are no plug-control routes or arbitrary device-selection endpoints.

Each installation currently supports one selected device. The connector requires a Meross plug that supports the LAN `Electricity` and `ConsumptionX` read messages without extra encryption. `ConsumptionH` hourly history is optional and model/firmware dependent.

The connector uses an undocumented Meross app protocol. This is not a supported public Meross API. Compatibility depends on the device model, firmware and LAN behavior. Changes made by Meross may cause authentication or readings to stop working. This project does not promise compatibility with every Meross product.

## Credentials and privacy

Set `MEROSS_EMAIL`, `MEROSS_PASSWORD`, and `MEROSS_REGION` in the private `.env` file used by the root Compose setup. Run `docker compose run --rm --no-deps meross-connector bun discover.ts` to list devices without configuring a UUID first. Then set `MEROSS_DEVICE_ID`, `MEROSS_HOST`, and `CONNECTOR_TOKEN` before starting the full stack. `MEROSS_MFA_CODE` is optional and only needed when sign-in requests it. Never commit `.env`, paste credentials into issues, or place them in the dashboard settings.

Compose injects the Meross email, password, region, MFA code and device UUID only into the connector. The dashboard receives the device UUID and shared internal API token, but not Meross account credentials. The connector has no published port. Its token-authenticated HTTP API is intended for the Compose network only.

The connector caches a session and key under `/data`. Treat this directory as sensitive authentication state and restrict access to it. Sign-in uses the configured regional cloud endpoint (`eu`, `us` or `ap`) only for bootstrap and metadata verification. Measurements are read from the selected device on the LAN. A failed sign-in or MFA challenge leaves the connector unavailable; it does not repeatedly submit the account password.

`bun discover.ts` is a one-shot CLI that authenticates with the same account environment variables and lists devices. It does not require `MEROSS_DEVICE_ID`, does not write the connector session cache, and prints only UUID plus an optional bounded name and model. Errors are sanitized codes. It does not print the account password, session token, key, or raw response.

## Read API

- `GET /health` reports whether the process is configured and ready.
- `GET /v1/reading` requires `Authorization: Bearer <CONNECTOR_TOKEN>` and returns normalized power, today's energy when available, plug state when available, and observation time.
- `GET /v1/history` requires the same token and returns sparse device-provided daily records.
- `GET /v1/hourly` requires the same token and returns sparse hourly records when supported by the device.

The connector requests fixed read-only namespaces and channel zero. It validates the configured device identity periodically. It does not expose account-wide device lists, account credentials, raw Meross messages, or a general proxy. Keep device traffic on a trusted LAN: the local Meross HTTP protocol is not encrypted.

## Incomplete history

Daily and hourly data depend on what the specific device retains and returns. Records can be sparse, may cover only part of the past, and are not equivalent to continuous measurements or individual charging sessions. Missing dates and hours mean unknown, not zero. Motillo keeps this history separate from live charging sessions to avoid double counting. The connector cannot reconstruct measurements that the device did not retain.

## Running checks

From the repository root:

```sh
bun test tests/cloud.test.ts tests/discovery.test.ts tests/connector.test.ts tests/connector-client.test.ts tests/hourly.test.ts
docker compose config --quiet
```

Tests use synthetic data and do not require Meross credentials or switch a physical device.
