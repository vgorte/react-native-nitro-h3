# 🤝 Contributing

This is the working guide for changing the code in this repository.
Bug reports, new H3 operations and documentation fixes are all welcome.
Thanks for taking the time.

## Quick Start

Install the workspace and run the four gates every change has to pass:

```sh
bun install
bun run lint
bun run typecheck
bun run build
bun test
```

The host C++ tests and the `h3-js` parity suite build outside the app and are not run by `bun test`:

```sh
cmake -S packages/react-native-nitro-h3/cpp/test -B build/host -DCMAKE_BUILD_TYPE=Release
cmake --build build/host --target tests -j
./build/host/tests

cmake -S packages/react-native-nitro-h3/cpp/test -B build/parity -DCMAKE_BUILD_TYPE=Release
cmake --build build/parity --target parity_probe -j
H3_PARITY_PROBE="$PWD/build/parity/parity_probe" bun run --cwd packages/react-native-nitro-h3 parity
```

## Repository Structure

The repository is a bun workspace: the package lives in `packages/react-native-nitro-h3` and the app that exercises it in `apps/example`.
The showcase app in `apps/showcase` sits outside the workspace and installs its own dependencies.

The example app runs on the iOS simulator and on the Android emulator:

```sh
bun run example:ios
bun run example:android -- --deviceId emulator-5554
```

Benchmark figures come from the app's Benchmark screen in a Release build, never from a Debug build.
[Benchmark Report](https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/benchmark.md) holds the method and the reproduction steps.
The release process is in the [Release guide](https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/releasing.md).

## Testing

`bun test` runs the TypeScript suites under `packages/react-native-nitro-h3/__tests__`.
The two suites above it do not, because both need a compiled binary:

- Host C++ tests (`build/host/tests`) exercise `cpp/ops/`, `cpp/core/` and `cpp/shapes/` on the host, including under AddressSanitizer through the `tests_asan` target.
- The parity suite drives that same Nitro-free operations layer over a host executable and compares it against `h3-js` 4.5.0 over every resolution 0 cell, all sixteen resolutions, all 192 pentagons, the poles and the antimeridian.
  A difference it finds is a difference in what ships.

## Fuzzing

Four libFuzzer targets under `packages/react-native-nitro-h3/cpp/fuzz` drive the Nitro-free layer with raw bytes: cell arrays, polygon rings, scalar arguments and index strings.
They are off by default, because `-fsanitize=fuzzer` is a Clang feature and AppleClang ships no libFuzzer runtime, so a Mac needs Homebrew's LLVM.
Configuring without it fails at CMake time with the same advice.

```sh
brew install llvm
cmake -S packages/react-native-nitro-h3/cpp/test -B build/fuzz -DH3_BUILD_FUZZERS=ON \
  -DCMAKE_C_COMPILER="$(brew --prefix llvm)/bin/clang" \
  -DCMAKE_CXX_COMPILER="$(brew --prefix llvm)/bin/clang++"
cmake --build build/fuzz -j --target \
  fuzz_cell_buffers fuzz_polygon_rings fuzz_scalar_ops fuzz_cell_strings
```

Pass a scratch directory as the first corpus argument and the committed seeds as the second.
libFuzzer writes every input it keeps into the first directory, and the seed directory is part of the checkout:

```sh
mkdir -p /tmp/h3-fuzz/fuzz_scalar_ops
./build/fuzz/fuzz_scalar_ops /tmp/h3-fuzz/fuzz_scalar_ops \
  packages/react-native-nitro-h3/cpp/fuzz/corpus/fuzz_scalar_ops \
  -max_total_time=60 -max_len=4096 -rss_limit_mb=4096 -timeout=25
```

The seeds matter: nearly every operation checks its index first, and random bytes are almost never a valid one, so an unseeded run barely gets past the front door.

A run ends clean or it does not.
A `std::runtime_error` is how the binding refuses an input and the harnesses swallow it; every other exception and every sanitizer report is a finding, and libFuzzer writes the input that produced it into the working directory.
A finding that reproduces only inside `third_party/h3` under an input the binding accepts is an upstream bug: archive the input, report it at uber/h3, and drop the affected operation from the harness until the fix lands.

Continuous integration runs a 60-second pass per target on every pull request that touches `cpp/` (`.github/workflows/cpp-tests.yml`).
A nightly workflow runs ten minutes per target against a corpus that carries over between runs (`.github/workflows/fuzz-nightly.yml`).

## Adding an H3 Operation

Every operation crosses seven places, in this order.
Each one has a reason to exist, and skipping any of them fails a gate rather than merely leaving a gap.

1. `cpp/ops/<Domain>.{hpp,cpp}`: the computation, as a plain C++ function.
2. `cpp/test/<Domain>OpsTest.cpp`: the host test for it.
3. `src/specs/H3.nitro.ts`: the Nitro method declaration the codegen reads.
4. `cpp/HybridH3.{hpp,cpp}`: the binding, which converts arguments, calls `h3ops::` and converts back.
5. `src/<domain>.ts` and `src/index.ts`: the typed wrapper and its re-export.
6. `__tests__/exports.test.ts`: the exported surface, asserted by name and by count.
7. `parity/corpus.ts` and `cpp/test/ParityProbe.cpp`: the `h3-js` equivalence comparison.

What each place requires:

1. Nothing in `cpp/ops/`, `cpp/core/` or `cpp/shapes/` may include a Nitro header: that is what lets the operation be tested on the host under AddressSanitizer, and what makes it safe to run on a worker thread.
   Validation belongs here, once, at the boundary.
2. Register the test in `cpp/test/CMakeLists.txt` under `TEST_SOURCES` so both the `tests` and `tests_asan` targets pick it up.
3. After declaring the method, `bun run specs` regenerates `nitrogen/generated/**`, which is committed.
4. Implement the generated pure virtual and nothing else.
   No computation here.
5. The wrapper carries the JSDoc and `rethrowAsH3Error`; `src/index.ts` re-exports in alphabetical order.
6. A function that mirrors an `h3-js` one gains a row in `docs/h3-function-table.md` as well; an additive one does not, because that table enumerates the `h3-js` 4.5.0 surface.
7. Skip the comparison only when the operation has no `h3-js` counterpart, in which case `docs/h3-js-divergences.md` says why.
   Every export but the four `Async` variants and [`configure`](https://vgorte.github.io/react-native-nitro-h3/api/#configure) is a probe operation, which is what keeps the surface check in `parity/probe.test.ts` exact.

## Adding an Additive Operation

An operation `h3-js` does not have, [`latLngsToCells`](https://vgorte.github.io/react-native-nitro-h3/api/#latlngstocells), [`cellsToLatLngs`](https://vgorte.github.io/react-native-nitro-h3/api/#cellstolatlngs) and [`cellsToBoundaries`](https://vgorte.github.io/react-native-nitro-h3/api/#cellstoboundaries) today, crosses the same seven places with three differences.
Route it this way rather than through the parity table, which a non-parity row would misrepresent.

- No parity-table row.
  `docs/h3-function-table.md` is derived from upstream `h3-js` 4.5.0, so only `__tests__/exports.test.ts` gains the name and its count.
- Its own comparison.
  It is still a probe operation, so the surface check stays exact, but it is compared against the `h3-js` scalar it batches or replaces, in its own comparison file (`parity/batches.test.ts` for today's three), rather than as a `parity/corpus.ts` row.
- Documented as additive.
  `docs/h3-js-divergences.md` records that it exists here and not in `h3-js`, proved by a test in `parity/divergences.test.ts`, and the generated [API Reference](https://vgorte.github.io/react-native-nitro-h3/api/) carries its signature.

## Before Opening a PR

Run the gauntlet CI runs:

```sh
bun run lint
bun run typecheck
bun run build
bun test packages/react-native-nitro-h3/__tests__
```

If native code under `cpp/` or `android/src/main/cpp/` changed:

```sh
clang-format --dry-run --Werror <the files you touched>   # CI pins clang-format 21.1.*
cmake -S packages/react-native-nitro-h3/cpp/test -B build/host -DCMAKE_BUILD_TYPE=Debug
cmake --build build/host --target tests -j && ./build/host/tests
cmake --build build/host --target tests_asan -j && ./build/host/tests_asan
bun run specs && git diff --exit-code   # nitrogen output must not drift
```

If an H3 operation changed:

```sh
bun run docs:api --check   # regenerate with `bun run docs:api` when it fails
bun test packages/react-native-nitro-h3/__tests__/exports.test.ts
cmake -S packages/react-native-nitro-h3/cpp/test -B build/host -DCMAKE_BUILD_TYPE=Release
cmake --build build/host --target parity_probe -j
H3_PARITY_PROBE="$PWD/build/host/parity_probe" H3_PARITY_REQUIRED=1 \
  bun run --cwd packages/react-native-nitro-h3 parity
```

If the vendored H3 sources changed, `bun run vendor:h3 --check` has to pass too.

## Conventions

Code and comments are in English.
Commit messages follow the conventional format.
Work on a branch and open a pull request; `bun run lint` and `bun run typecheck` have to pass before review.

## Code of Conduct

Taking part here means following the [Code of Conduct](https://github.com/vgorte/react-native-nitro-h3/blob/main/CODE_OF_CONDUCT.md).
Security problems take a different route than ordinary bugs: [Security Policy](https://github.com/vgorte/react-native-nitro-h3/blob/main/SECURITY.md) explains it.
