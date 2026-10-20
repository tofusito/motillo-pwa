# Motillo web service

The web service serves the dashboard and stores readings, sessions, monthly prices, and device history in SQLite. It talks to the private Meross connector over the Compose network. It does not receive Meross account credentials and has no built-in user login.

Set `APP_ORIGIN` to the exact origin used by the browser, including scheme and any non-default port. The service checks request origins and a Motillo-specific header for mutations. These protections do not authenticate users. Keep the service on loopback or a trusted private network; before sharing it beyond that boundary, place HTTPS and an authentication layer in front of it. Persist the complete `DATA_DIR`, including SQLite write-ahead log files.

## Sensors and readings

The dashboard lists only the configured device's compatible power, cumulative-energy and plug-state measurements. A user selects the sensors explicitly. Readings with missing, unsupported or invalid values remain unknown. Cumulative energy is preferred when available; power integration is an estimate. Long gaps, counter resets, restarts, daylight-saving changes and tariff boundaries affect allocation and may make a session incomplete. See the dashboard's quality labels before treating an estimate as a measured charge.

Historical daily and hourly device records are sparse and can be incomplete. They are kept separate from live sessions; they are never filled with zeroes or summed into session totals. Missing data cannot be recovered by Motillo if the device no longer provides it.

## Energy prices and cost estimates

The interface supports monthly single fixed prices, three contract periods (valley, flat and peak), and Spain's hourly PVPC energy-price reference. Empty contract prices stay unknown. Prices are not automatically carried forward. Check the applicable contract or invoice before entering them.

PVPC is imported from REData's public series id 1001, which reports hourly energy prices in EUR/MWh; Motillo divides by 1000 to store EUR/kWh. Values cover Peninsular Spain and the Balearic Islands, use Europe/Madrid time and EUR, and exclude taxes. The current month refreshes once per hour. PVPC is an energy-price series, not an electricity contract or complete bill.

PVPC describes an hourly energy-price component, not the complete electricity bill. It does not reconstruct contracted power charges, other fixed charges, taxes, discounts, compensation, meter rental, or adjustments on a particular invoice. It does not create fictional peak/flat/valley comparisons. The currently documented tariff behavior is for the Spanish context and euro-denominated prices; Motillo does not claim support for other countries, tariff markets or currencies.

A daily history without hour-by-hour allocation can only produce an estimated range across possible periods. Reference prices applied to old consumption are comparisons, not the price historically paid. A tax-inclusion flag is descriptive; Motillo does not calculate taxes or reproduce an invoice. Consumption costs and theoretical savings must not be presented as bill totals or guaranteed savings.

## API notes

The browser-facing API exposes dashboard data, sensor choices, monthly rates, settings, CSV export, and separate daily and hourly history. Mutations are same-origin protected. The connector's bearer token and URL are server-side configuration only. The connector API is internal and should never be exposed through a public reverse proxy.

See [connector/README.md](../connector/README.md) for Meross protocol and privacy details.
