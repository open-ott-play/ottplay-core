# Parental PIN upgrade and recovery

The PIN controls local playback and sensitive settings, including sources,
imports, exports and remote/proxy configuration. It is not a provider login or
encryption key. Browser settings and exported backups may contain source
credentials in plaintext when explicitly included. Keep such backups private.

## Browser requirement

PIN operations require standard `crypto.subtle` with PBKDF2/SHA-256 and
`crypto.getRandomValues`, plus typed arrays. Serve the player over HTTPS or use
the browser's trusted loopback context. A LAN HTTP address is generally not a
secure context. Old TV engines and legacy `msCrypto` are not supported for PIN
operations. The interface reports this condition and preserves existing
protection. Unprotected playback does not require the PIN API.

The application source remains ES5, but this does not guarantee these browser
APIs. Before upgrading a target device, check its actual HTTPS installation and
PIN workflow. No TV model's latency or hardware acceptance is asserted here.
Changing the origin or browser profile creates a separate storage area; it does
not migrate existing settings automatically.

## Verifier and migration

New or changed PINs use schema 2: `algorithm: PBKDF2-HMAC-SHA256`, 600,000
iterations, 16 random salt bytes and 32 derived bytes. The algorithm label is a
storage identifier for PBKDF2 using HMAC-SHA-256. Salts/hashes are lowercase hex.
Readers reject unknown algorithms, malformed fields and non-integral or
non-finite work factors; schema 2 allows 600,000–2,000,000 iterations. The shared
Kotlin core validates metadata and authorization; the browser owns cryptography.

Schema 1 is read for existing PIN authentication only (1,024–8,192 legacy SHA-256
rounds). Successful authentication derives a fresh schema-2 verifier and confirms
its storage before granting access. An incorrect PIN only updates the cooldown.
Cancellation, source/configuration changes and a backwards clock invalidate an
in-flight result. Closing the dialog, hiding/leaving the page or starting another
action also cancels pending work. Native computation may finish, but its result
cannot save or grant access after cancellation.

## Durable storage and downgrade behavior

Before any security-sensitive write, the player:

1. Copies the unchanged state and existing verifier to
   `ottplay2:state:secure-v2` in a `storageSchema: 2` envelope and reads it back.
2. Replaces `ottplay2:state:v1` with a valid old-format locked placeholder, with
   no sources and every sensitive configuration scope protected, and reads it
   back. It has no usable PIN. Older clients cannot open the upgraded settings.
3. Replaces the canonical envelope with the updated verifier/state, reads it
   back exactly and only then grants access or reports success.

The browser guarantees atomic replacement of each storage item; these steps do
not assume a transaction across items. A crash between steps retains the old
verifier or the new complete canonical state. On reload the new reader prefers
the canonical envelope and repairs the old placeholder before accepting writes.
Quota errors, rejected writes, mismatched read-back and detected changes from
another tab fail closed. Storage confirmation is the browser API's guarantee,
not an operating-system disk-fsync promise. An uncertain write can already have
reached storage; reload before retrying and use the actual stored PIN.
Close other player tabs before upgrading. Browser storage has no cross-tab
transaction or global session revocation; an already-running older client may
retain previously loaded data in memory. The placeholder protects subsequent
loads, not another process that already possesses that data.

Do not edit the old placeholder to regain access. Older releases do not understand
schema 2, and rollback is deliberately locked. Reinstall the current compatible
client at the same origin/profile. If storage is corrupt or repair fails, the
player preserves the original stored data and shows a locked recovery state.
Retain a private copy of both storage entries before manual recovery; seek help
through the project's support channel without posting credentials or PIN data.
Clearing browser data deletes the settings and is not a supported PIN bypass.

Export before upgrading if a rollback backup is needed. New schema-2 exports
require the current reader. Unknown KDF metadata is rejected before import
changes storage. Imports use the same durable barrier and the current PIN gate;
they do not silently discard unsupported protection. No backup is uploaded.

## Verification

`npm test` includes independent PBKDF2 vectors, legacy migration, cooldown,
unsupported APIs, single-flight/cancellation, storage failure at each barrier,
read-back mismatch, corrupt state, stale tabs and the frozen older reader.
The browser journey configures and checks the real native verifier and confirms
the old-reader lock. JVM/JS candidate-core tests validate both metadata formats.
These tests use synthetic local data; they are not target-hardware acceptance.
