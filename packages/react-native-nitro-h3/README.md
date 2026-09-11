<div align="center">
  <img src="https://raw.githubusercontent.com/vgorte/react-native-nitro-h3/main/img/logo-tile.svg" alt="react-native-nitro-h3" width="132" />
  <h1>react-native-nitro-h3</h1>
  <p><b>Fast native H3 geospatial indexing for React Native.</b></p>
  <p>
    <a href="https://www.npmjs.com/package/react-native-nitro-h3"><img src="https://img.shields.io/npm/v/react-native-nitro-h3.svg" alt="npm version" /></a>
    <a href="https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml"><img src="https://github.com/vgorte/react-native-nitro-h3/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/vgorte/react-native-nitro-h3/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey.svg" alt="Platforms: iOS and Android" />
    <a href="https://github.com/uber/h3/releases/tag/v4.5.0"><img src="https://img.shields.io/badge/h3-v4.5.0-blue.svg" alt="Vendored H3 v4.5.0" /></a>
  </p>
</div>

<a href="https://vgorte.github.io/react-native-nitro-h3/showcase/"><img align="right" src="https://raw.githubusercontent.com/vgorte/react-native-nitro-h3/main/img/showcase-portrait-hero.gif" alt="The showcase app: a hexagon grid follows the map, a cell splits into its children, a million points fold into cells" width="280" /></a>

`react-native-nitro-h3` brings Uber's [H3](https://h3geo.org/), the hexagonal hierarchical geospatial index, to React Native on iOS and Android.
It vendors the H3 C sources and calls them directly from C++ instead of running them through JavaScript.

* ⚡ About **800×** faster than `h3-js` on [`compactCells`](https://vgorte.github.io/react-native-nitro-h3/api/#compactcells). [See the benchmark](https://vgorte.github.io/react-native-nitro-h3/benchmark/)
* 🧬 H3 as compiled C++, called through Nitro Modules
* 🔢 `bigint` cell indexes, no hexadecimal strings
* 📦 Typed-array results over the native buffer
* 🧵 Batch calls for whole coordinate and cell arrays
* ⏱️ Async variants on a background thread
* 🔁 The [`h3-js`](https://github.com/uber/h3-js) names and a [migration guide](https://vgorte.github.io/react-native-nitro-h3/migrating-from-h3-js/)

> 📚 [Read the documentation](https://vgorte.github.io/react-native-nitro-h3/).


<br clear="all" />

---

## 🚀 Installation

Install from npm together with Nitro Modules:

```sh
bun add react-native-nitro-h3 react-native-nitro-modules
cd ios && pod install
```

[Getting started](https://vgorte.github.io/react-native-nitro-h3/getting-started/) has the npm and Expo commands and the New Architecture note, and [Requirements](https://vgorte.github.io/react-native-nitro-h3/requirements/) has the platform and toolchain versions.

---

## 👇 Usage

One coordinate and one resolution give one cell, and one cell gives its neighbours as a typed array over the native buffer:

```ts
import { latLngToCell, gridDisk, cellToString } from 'react-native-nitro-h3'

// H3 cell for San Francisco at resolution 9
const cell = latLngToCell(37.7749, -122.4194, 9) // 617700169957507071n
const id = cellToString(cell) // '89283082803ffff'

// The cell and its six neighbours, as one BigUint64Array
const neighbours = gridDisk(cell, 1) // BigUint64Array(7)
```

Coming from `h3-js`?
Read the [migration guide](https://vgorte.github.io/react-native-nitro-h3/migrating-from-h3-js/): the `h3-js` names with unit suffixes instead of a unit argument, cells as `bigint`, cell sets as `BigUint64Array`.

---

### Links

- [Documentation](https://vgorte.github.io/react-native-nitro-h3/)
- [LLMs.txt](https://vgorte.github.io/react-native-nitro-h3/llms.txt): the docs for agents and assistants
- [Showcase](https://vgorte.github.io/react-native-nitro-h3/showcase/): five acts of one app
- [Getting started](https://vgorte.github.io/react-native-nitro-h3/getting-started/): install and first call
- [Requirements](https://vgorte.github.io/react-native-nitro-h3/requirements/): platform and toolchain versions
- [Migrating from h3-js](https://vgorte.github.io/react-native-nitro-h3/migrating-from-h3-js/)
- [API reference](https://vgorte.github.io/react-native-nitro-h3/api/): every exported function
- [Example app](https://github.com/vgorte/react-native-nitro-h3/tree/main/apps/example): the benchmark and harness app
- [Contributing](https://github.com/vgorte/react-native-nitro-h3/blob/main/CONTRIBUTING.md): build, test, add an operation

---

## 📄 License

`react-native-nitro-h3` is released under the **MIT License**. The vendored H3 C sources keep their **Apache-2.0** `LICENSE` and `NOTICE` files.
