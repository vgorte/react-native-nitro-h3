<div align="center">
  <img src="https://raw.githubusercontent.com/vgorte/react-native-nitro-h3/main/img/logo.svg" alt="react-native-nitro-h3" width="132" height="132" />
  <h1>react-native-nitro-h3</h1>
  <p><b>Fast H3 geospatial indexing for React Native, powered by Nitro Modules.</b></p>
  <p>
    <a href="https://www.npmjs.com/package/react-native-nitro-h3"><img src="https://img.shields.io/npm/v/react-native-nitro-h3.svg" alt="npm version" /></a>
    <a href="https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml"><img src="https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/vgorte/react-native-nitro-h3/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey.svg" alt="Platforms: iOS and Android" />
    <a href="https://github.com/uber/h3/releases/tag/v4.5.0"><img src="https://img.shields.io/badge/h3-v4.5.0-blue.svg" alt="Vendored H3 v4.5.0" /></a>
  </p>
</div>

<table>
<tr>
<td>

`react-native-nitro-h3` brings [H3](https://h3geo.org/) to native iOS and Android applications. It vendors the H3 C library (v4.5.0) and calls it directly from native code instead of running it through JavaScript or WebAssembly.

The result is a native H3 binding designed for performance-sensitive React Native workloads.

⚡ Up to **862×** faster than `h3-js`. [See the benchmark →](https://vgorte.github.io/react-native-nitro-h3/benchmark/)

> 📚 **[Read the documentation](https://vgorte.github.io/react-native-nitro-h3/)** for the guides, the API reference and the migration from `h3-js`.

> **Native mobile only.** For web applications, use [`h3-js`](https://github.com/uber/h3-js).

</td>
<td width="300" align="center">
<a href="https://vgorte.github.io/react-native-nitro-h3/showcase/"><img src="https://raw.githubusercontent.com/vgorte/react-native-nitro-h3/showcase-video/img/showcase-portrait-hero.gif" alt="The showcase app: a hexagon grid follows the map, a cell splits into its children, a million points fold into cells" width="280" /></a>
</td>
</tr>
</table>

---

## 🚀 Installation

Install the package together with Nitro Modules:

```bash
bun add react-native-nitro-h3 react-native-nitro-modules
```

Or:

```bash
npm install react-native-nitro-h3 react-native-nitro-modules
```

For iOS:

```bash
cd ios && pod install
```

### Expo

```bash
npx expo install react-native-nitro-h3 react-native-nitro-modules
npx expo prebuild
```

Expo Go cannot load native modules. Use a development build with `npx expo run:ios` or `npx expo run:android`.

---

## 👇 Usage

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

Coming from `h3-js`? Read the **[migration guide](https://vgorte.github.io/react-native-nitro-h3/migrating-from-h3-js/)**: the `h3-js` names with unit suffixes instead of a unit argument, cells as `bigint`, cell sets as `BigUint64Array`.

---

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

`react-native-nitro-h3` versions independently from H3. The exact vendored version is recorded in `third_party/h3/H3_VERSION`, which also ships in the published npm tarball.

---

## 📚 Documentation

Full documentation lives at **[vgorte.github.io/react-native-nitro-h3](https://vgorte.github.io/react-native-nitro-h3/)**.

**Start here**

* 🚀 **[Getting started](https://vgorte.github.io/react-native-nitro-h3/getting-started/)**: install, first call, requirements.
* 🎬 **[Showcase](https://vgorte.github.io/react-native-nitro-h3/showcase/)**: five acts of one app, every cell computed on the phone.
* 🔄 **[Migrating from h3-js](https://vgorte.github.io/react-native-nitro-h3/migrating-from-h3-js/)**: every change at the call site, before and after.

**Core concepts**

* 🔢 **[Cell indexes and bigint](https://vgorte.github.io/react-native-nitro-h3/concepts/cells-and-bigint/)**: why a cell is a `bigint` and how the surface matches `h3-js`.
* 📦 **[Typed arrays and batch calls](https://vgorte.github.io/react-native-nitro-h3/concepts/typed-arrays-and-batch/)**: `BigUint64Array` results and the three batch calls.
* 🧵 **[Sync and async](https://vgorte.github.io/react-native-nitro-h3/concepts/sync-and-async/)**: the four async variants and what the hop costs.
* 🛡️ **[Errors and memory safety](https://vgorte.github.io/react-native-nitro-h3/concepts/errors-and-memory-safety/)**: `H3Error` and the optional cell ceiling.

**Performance**

* 🧮 **[Performance guide](https://vgorte.github.io/react-native-nitro-h3/performance/)**: where the speed comes from, when a batch call pays, and the cell ceiling.
* 📊 **[Benchmark report](https://vgorte.github.io/react-native-nitro-h3/benchmark/)**: methodology, devices, measurements and complete results.

**Reference**

* 📖 **[API reference](https://vgorte.github.io/react-native-nitro-h3/api/)**: every exported function by category.
* ⚙️ **[H3 function table](https://vgorte.github.io/react-native-nitro-h3/h3-function-table/)**: every parity export mapped to its H3 C counterpart.
* 📖 **[h3-js divergences](https://vgorte.github.io/react-native-nitro-h3/h3-js-divergences/)**: compatibility differences, with the test or the vendored source that proves each one.

**Repository**

* 📱 **[Example app](https://github.com/vgorte/react-native-nitro-h3/tree/main/apps/example)**: the benchmark and harness app.
* 🤝 **[Contributing](https://github.com/vgorte/react-native-nitro-h3/blob/main/CONTRIBUTING.md)**: build, test and add an operation.
* 🚀 **[Releasing](https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/releasing.md)**: the maintainer runbook.

---

## 🤝 Contributing

Contributions are welcome!

See [`CONTRIBUTING.md`](https://github.com/vgorte/react-native-nitro-h3/blob/main/CONTRIBUTING.md) for:

* development setup
* test commands
* adding new H3 operations
* native implementation details

---

## 📄 License

`react-native-nitro-h3` is released under the **MIT License**.

The vendored H3 C sources are released under the **Apache-2.0 License** and retain their original `LICENSE` and `NOTICE` files.
