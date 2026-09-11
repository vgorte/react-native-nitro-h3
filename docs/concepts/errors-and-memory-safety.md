# 🛡️ Errors and Memory Safety

## One Error Type

[`H3Error`](../../packages/react-native-nitro-h3/docs/api.md#h3error) is the one error type every function in this package throws, native failure and refused input alike.

```ts
import {
  H3Error,
  latLngToCell,
} from 'react-native-nitro-h3'

try {
  latLngToCell(37.7749, -122.4194, 99)
} catch (error) {
  if (error instanceof H3Error) {
    error.code // 4
    error.message // 'Resolution argument was outside of acceptable range (code: 4)'
  }
}
```

`code` is the stable half of the contract.
It carries H3's numeric error code when H3 reported the failure, and is `undefined` when the package refused the input before H3 saw it.

`message` is informational.
It comes from H3's `describeH3Error`, or from this package's own wording for an input it refused itself, and may change when the vendored H3 version changes, so branch on `code` rather than on the text.

- A standard H3 error appends `(code: N)` to the message and exposes the `.code` property, and the numbers are H3's own, listed in the [H3 error table](https://h3geo.org/docs/library/errors#table-of-error-codes).
- An error this package raises itself, before the call reaches the H3 C library (argument validation such as a non-integer resolution, or a breach of a configured cell ceiling), is an [`H3Error`](../../packages/react-native-nitro-h3/docs/api.md#h3error) with `.code` left `undefined`.
- An async variant throws the same error as its synchronous sibling, which [Sync and Async](sync-and-async.md#guarantees) states in full.

The contract in full, with the messages `h3-js` has already drifted from, is [The Error Contract](../h3-js-divergences.md#the-error-contract).
The same guide lists every deliberate divergence from `h3-js`, including the strict validation this package applies at the C++ boundary, with the `h3-js` answer beside it and what proves each one.

## The Optional Cell Ceiling

Cell-producing H3 operations can return very large result sets.

Set a ceiling when an oversized request should be refused rather than allowed to exhaust memory:

```ts
import { configure } from 'react-native-nitro-h3'

configure({
  maxCellCount: 4_000_000,
})
```

A request above the limit throws an [`H3Error`](../../packages/react-native-nitro-h3/docs/api.md#h3error) naming the requested size and the limit, before anything is allocated.

The limit is disabled by default to preserve `h3-js` behaviour.

> [!WARNING]
> Without a ceiling a cell-producing call allocates whatever H3 reports it needs, and an allocation the device cannot satisfy kills the process instead of throwing.

[Performance Guide](../performance.md#the-cell-ceiling-in-detail) sizes the requests a ceiling is meant to catch, and shows how to remove one.
