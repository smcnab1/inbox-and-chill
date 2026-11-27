# Security policy

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/smcnab1/inbox-and-chill/security/advisories/new). [Sam McNab](https://github.com/smcnab1) maintains this fork. Use the private report for companion pairing, token handling, unintended inbox access and distribution integrity concerns.

Include the commit or build, macOS and iOS versions if relevant, the affected configuration and the impact. Use synthetic data and omit tokens, live pairing codes and private network names. Coordinate disclosure in the private report while the issue is assessed.

Security fixes target the current source on the fork’s `main` branch. If a report also affects upstream, the maintainer can coordinate privately with the upstream project. There is no separate backport policy.

The fork is installed from source. Review the source before building and keep the relay on a private Tailscale network. For a lost phone, [revoke companion sessions](companion/README.md#privacy-and-operation). Revoke exposed provider credentials at their source.

[Credential handling](docs/security.md) · [Privacy](PRIVACY.md)
