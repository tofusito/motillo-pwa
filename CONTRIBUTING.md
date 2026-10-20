# Contributing

Thanks for helping improve Motillo. Small, focused changes are easiest to review.

## Before opening a change

- Describe the behavior you are changing and why.
- Keep device credentials, tokens, personal hostnames, IP addresses and real device identifiers out of commits and screenshots.
- Use synthetic fixtures in tests. Do not make tests sign in to Meross or send commands to a physical device.
- Preserve the separation between the web service and the private read-only connector. The web service must not receive Meross account credentials.
- Treat missing measurements and prices as unknown. Do not invent zeroes, historical readings or invoice totals.
- Document uncertainty where a protocol or tariff source is not authoritative.

## Local checks

Use Bun 1.3.9 or compatible. From the repository root:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

For Compose changes, also run `docker compose config --quiet` with a private local `.env` populated with non-production placeholder values. Never paste that file into a pull request or issue.

## Pull requests

Explain the user-visible change, any data migration or compatibility impact, and checks performed. Include screenshots only when useful, with private information removed. Do not claim support for a Meross device, country, currency, or tariff source without evidence for that exact scope.
