# 🚀 Getting Started

`react-native-nitro-h3` binds Uber's H3 C library into a React Native app through Nitro Modules, so an H3 call runs in native code and answers a `bigint`.

## 1. Install the Package

Add the package together with Nitro Modules:

<!-- tabs -->
<!-- tab: bun -->

```bash
bun add react-native-nitro-h3 react-native-nitro-modules
```

<!-- tab: npm -->

```bash
npm install react-native-nitro-h3 react-native-nitro-modules
```

<!-- /tabs -->

`npx expo install react-native-nitro-h3 react-native-nitro-modules` installs the same versions in an Expo project, because Expo pins no version of its own for either package and hands both to the project's package manager.

## 2. Set Up the Native Projects

<!-- tabs: project-type -->
<!-- tab: React Native CLI -->

Install the iOS pods, which links the native module into the iOS project:

```bash
cd ios && pod install
```

<!-- tab: Expo -->

Expo Go cannot load a native module, so generate the native projects for a development build:

```bash
npx expo prebuild
```

<!-- /tabs -->

## 3. Rebuild the App

<!-- tabs: project-type -->
<!-- tab: React Native CLI -->

Rebuild the app so the native module is linked, with `npx react-native run-ios` or `npx react-native run-android`.

<!-- tab: Expo -->

Build and start the development build with `npx expo run:ios` or `npx expo run:android`.

<!-- /tabs -->

## First Call

One coordinate and one resolution give one cell, and that cell's ring of neighbours comes back as a typed array:

```ts
import {
  latLngToCell,
  gridDisk,
  cellToString,
} from 'react-native-nitro-h3'

// the H3 cell for San Francisco at resolution 9
const cell = latLngToCell(37.7749, -122.4194, 9) // 617700169957507071n

// the cell and its six neighbours
const neighbours = gridDisk(cell, 1) // BigUint64Array(7)

const hex = cellToString(cell) // "89283082803ffff"
```

[`latLngToCell`](../packages/react-native-nitro-h3/docs/api.md#latlngtocell) returns a `bigint`, and [`gridDisk`](../packages/react-native-nitro-h3/docs/api.md#griddisk) returns a `BigUint64Array`.
Both are explained in [Cell Indexes and bigint](./concepts/cells-and-bigint.md).

The build needs the New Architecture, React Native 0.76 or newer and a C++20 toolchain, and [Requirements](./requirements.md) lists every version in full.

From here, [Migrating from h3-js](./migrating-from-h3-js.md) covers a move off `h3-js`, [Typed Arrays and Batch Calls](./concepts/typed-arrays-and-batch.md) covers workloads over many cells, and the [API Reference](../packages/react-native-nitro-h3/docs/api.md) documents every exported function.
