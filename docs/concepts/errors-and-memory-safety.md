# 🛡️ Errors and memory safety

## One error type

All package-level errors are represented by `H3Error`.

```ts
import {
  H3Error,
  latLngToCell,
} from 'react-native-nitro-h3'

try {
  latLngToCell(37.7749, -122.4194, 99)
} catch (error) {
  if (error instanceof H3Error) {
    console.log(error.message)
    console.log(error.code)
  }
}
```

`code` is the stable half of the contract. It carries H3's numeric error code when H3 reported the
failure, and is `undefined` when the package refused the input before H3 saw it.

`message` is informational. It comes from H3's `describeH3Error`, or from this package's own wording
for an input it refused itself, and may change when the vendored H3 version changes, so branch on
`code` rather than on the text.

- **Native codes.** Standard H3 errors append `(code: N)` to the message and expose the `.code`
  property. The numbers are H3's own, listed in the
  [H3 error table](https://h3geo.org/docs/library/errors#table-of-error-codes).
- **Binding exceptions.** Errors this package raises itself, before the call reaches the H3 C
  library (argument validation such as a non-integer resolution, or a breach of a configured cell
  ceiling), also throw `H3Error`, but leave the `.code` property `undefined`.
- **Async parity.** Async variants throw the exact same errors and messages as their synchronous
  siblings.

The contract in full, with the messages `h3-js` has already drifted from, is
[The error contract](../h3-js-divergences.md#the-error-contract). The same guide lists every
deliberate divergence from `h3-js`, including the strict validation this package applies at the C++
boundary, with the `h3-js` answer beside it and what proves each one.

## The optional cell ceiling

Cell-producing H3 operations can return very large result sets.

For applications where unexpectedly large allocations should be rejected, configure an optional cell limit:

```ts
import { configure } from 'react-native-nitro-h3'

configure({
  maxCellCount: 4_000_000,
})
```

A request exceeding the configured limit throws a catchable `H3Error` before the result is allocated.

The limit is disabled by default to preserve `h3-js` behavior.
