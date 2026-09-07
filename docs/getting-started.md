# 🚀 Getting started

[![npm version](https://img.shields.io/npm/v/react-native-nitro-h3.svg)](https://www.npmjs.com/package/react-native-nitro-h3)
[![CI](https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml/badge.svg)](https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/vgorte/react-native-nitro-h3/blob/main/LICENSE)
[![Vendored H3 v4.5.0](https://img.shields.io/badge/h3-v4.5.0-blue.svg)](https://github.com/uber/h3/releases/tag/v4.5.0)

> **Audience: package users installing `react-native-nitro-h3` for the first time.** This page
> takes you from an empty project to a first cell: install, one call, and the requirements the
> build has to meet.

## What you get

- **Native execution.** H3 4.5.0 runs as compiled C++ on iOS and Android, called directly through
  Nitro Modules.
- **`bigint` cell indexes.** H3's 64-bit indexes stay numeric, so no hexadecimal strings cross the
  JavaScript boundary.
- **Typed-array results.** A cell set arrives as one `BigUint64Array` over the buffer C++ produced,
  viewed in place instead of copied per element.
- **Batch calls.** `latLngsToCells`, `cellsToLatLngs` and `cellsToBoundaries` process a whole
  coordinate or cell array in a single native call.
- **Async variants.** Four async variants move the expensive calls to a background thread and
  resolve with the same typed arrays.
- **Optional cell ceiling.** `configure()` sets a ceiling that rejects an unexpectedly large result
  before allocation, off by default.

## 📦 Installation

<!-- tabs -->
<!-- tab: bun -->

<!-- steps -->
1. Add the package together with Nitro Modules.

   ```bash
   bun add react-native-nitro-h3 react-native-nitro-modules
   ```

2. Install the iOS pods.

   ```bash
   cd ios && pod install
   ```

3. Rebuild the app so the native module is linked, with `npx react-native run-ios` or `npx react-native run-android`.
<!-- /steps -->

<!-- tab: npm -->

<!-- steps -->
1. Add the package together with Nitro Modules.

   ```bash
   npm install react-native-nitro-h3 react-native-nitro-modules
   ```

2. Install the iOS pods.

   ```bash
   cd ios && pod install
   ```

3. Rebuild the app so the native module is linked, with `npx react-native run-ios` or `npx react-native run-android`.
<!-- /steps -->

<!-- tab: Expo -->

<!-- steps -->
1. Add the package with the Expo CLI.

   ```bash
   npx expo install react-native-nitro-h3 react-native-nitro-modules
   ```

2. Generate the native projects.

   ```bash
   npx expo prebuild
   ```

   Expo Go cannot load native modules. Use a development build with `npx expo run:ios` or `npx expo run:android`.
<!-- /steps -->

<!-- /tabs -->

## 👇 First call

```ts
import {
  latLngToCell,
  gridDisk,
  cellToString,
} from 'react-native-nitro-h3'

// H3 cell for San Francisco at resolution 9
const cell = latLngToCell(37.7749, -122.4194, 9)

// Get neighboring cells
const neighbours = gridDisk(cell, 1)

console.log(neighbours.length) // 7
console.log(cellToString(cell)) // "89283082803ffff"
```

`latLngToCell` returns a `bigint`, and `gridDisk` returns a `BigUint64Array`. Both are explained in
[Cell indexes and bigint](./concepts/cells-and-bigint.md).

## 📱 Requirements

| Platform      | Requirement                    |
| ------------- | ------------------------------ |
| React Native  | **0.76+**                      |
| Nitro Modules | **0.37.0 or newer**            |
| C++           | C++20-compatible toolchain     |
| iOS           | React Native deployment target |
| Xcode         | recent stable release          |
| Android       | **minSdk 24**                  |
| Android SDK   | **compileSdk 36**              |
| Android NDK   | **27.1.12297006**              |
| H3 C library  | **4.5.0**, vendored            |

The package requires the New Architecture, the default since React Native 0.76. The iOS and Android build workflows compile the example app against React Native 0.87.0.

## Next steps

- [Migrating from h3-js](./migrating-from-h3-js.md) if you are replacing `h3-js`.
- [Typed arrays and batch calls](./concepts/typed-arrays-and-batch.md) for workloads over many cells.
- [API reference](../packages/react-native-nitro-h3/docs/api.md) for every exported function.
