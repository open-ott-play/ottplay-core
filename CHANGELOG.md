# Changelog

## Unreleased

### Security

- Require OpenSSL security level 2 or an explicitly stronger configured policy
  in the FOSS2 Node relay and EPG downloader. Weak upstream certificates and CA
  chains now fail before HTTP or authentication data is sent. Keep isolated TLS
  handshakes for every request; operators must renew weak upstream certificates
  rather than disabling verification. This changes no shared-core wire schema.

- Refuse to create or change a parental PIN when secure randomness is missing,
  fails or returns invalid bytes. Existing PIN verification remains available;
  older browsers need Web Crypto before setting a new PIN. Remove the predictable
  clock/counter salt fallback and explain the requirement in the interface.
- Build FOSS2 relay transport destinations from operator-approved origins;
  only the path/query comes from the validated request. Existing exact-origin,
  redirect, DNS pinning and private-address checks remain required.
- Return a fixed error code from the loopback SWOP test server, keeping exception
  details in the local test log.
- Refresh FOSS2 `source-map-js` to 1.2.2 and pin Kotlin/JS test-tool dependencies
  `serialize-javascript` to 7.0.5 and `diff` to 8.0.3. Regenerate/install the
  checked-in npm lockfiles before testing. The core wire schema is unchanged.

### Maintenance

- Document contribution/testing rules, security boundaries and partial OpenSSF
  evidence, including the remaining license-scope and legacy parental-PIN
  cryptography questions. No certification or consumer rollout is implied.
