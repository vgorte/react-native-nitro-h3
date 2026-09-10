# 🚀 Getting started

[![npm version](https://img.shields.io/npm/v/react-native-nitro-h3.svg)](https://www.npmjs.com/package/react-native-nitro-h3)
[![CI](https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml/badge.svg)](https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/vgorte/react-native-nitro-h3/blob/main/LICENSE)
[![Vendored H3 v4.5.0](https://img.shields.io/badge/h3-v4.5.0-blue.svg)](https://github.com/uber/h3/releases/tag/v4.5.0)

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

The build needs the New Architecture, React Native 0.76 or newer and a C++20 toolchain, and
[Requirements](./requirements.md) lists every version in full.

## Next steps

- [Migrating from h3-js](./migrating-from-h3-js.md) if you are replacing `h3-js`.
- [Typed arrays and batch calls](./concepts/typed-arrays-and-batch.md) for workloads over many cells.
- [API reference](../packages/react-native-nitro-h3/docs/api.md) for every exported function.
