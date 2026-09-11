# 🚀 Release guide

> [!CAUTION]
> **Never publish from a local machine.**
> Production releases are dispatched through the `Release` workflow on GitHub Actions, which is the
> only way npm provenance attestations are produced. The very first release is the single documented
> exception, and it is spelled out under Trusted publishing.

## Quick release checklist

1. **CI is green on `main`.** All nine core workflows on the last push to `main`.
2. **The iOS harness suite is validated locally.** `bun example pods` first, then
   `scripts/device-ios.sh default|asan|tsan`. CI covers the framework variants.
3. **Benchmarks are current**, if performance may have shifted. Release build, physical phone only.
4. **Generated assets and the tarball check out.**
   ```sh
   bun run docs:api --check
   bun run icons --check
   bun run vendor:h3 --check
   bun run build && cd packages/react-native-nitro-h3 && npm pack --dry-run
   ```
5. **The release workflow is dispatched.** GitHub Actions tab, `Release` workflow, target version as
   input, `dry_run` unchecked. Rehearse first with `bun release --dry-run --ci`.
6. **The result is verified.** `npm view react-native-nitro-h3 version` reports the new version with
   its provenance attestation, and the GitHub Release carries the generated changelog.

## Detailed procedure

### 1. Verify CI is green

The `main` branch must be completely green. Path filters apply to pull requests only, so the last
push to `main` reports the true status of all nine core workflows: `CI`, `Nitrogen drift`,
`Lint C++`, `C++ tests`, `Parity`, `Build Android`, `Harness Android`, `iOS pod lockfile`, and
`Build iOS`.

A tenth workflow, `Fuzz nightly`, runs on a schedule rather than on push, so it never appears in
that status. Check its latest run in the Actions tab before releasing. GitHub disables a scheduled
workflow after 60 days without repository activity; if it shows as disabled, re-enable it and
dispatch a run by hand.

### 2. Local iOS validation

CI checks the pod lockfile and builds both framework linkages on macOS, but the harness suite is
not part of it (see After going public below), so it is run locally prior to release.

Start with a pod install, so the example app picks up any C++ files added since the last one:

```sh
bun example pods
```

> **Why:** CocoaPods expands the podspec's `cpp/**/*.{hpp,cpp}` glob into a static file list at
> `pod install` time. A `Pods/` tree generated before a new source file existed links without it,
> and the failure surfaces as an undefined-symbol error from `ld`, not as a missing file.

Run the three device checks (targeting the `iPhone 17 Pro` simulator, iOS 26.5) to guarantee the
harness suite runs clean across all sanitizer flavors:

```sh
scripts/device-ios.sh default
scripts/device-ios.sh asan
scripts/device-ios.sh tsan
```

Next, verify framework linking. This builds the app twice (with static frameworks ON and OFF)
because a podspec that only works one way is a silent failure for consumers:

```sh
scripts/build-ios-variants.sh
```

> **Note:** `build-ios-variants.sh` refuses to start while `apps/example/ios` has uncommitted
> changes, because it restores that directory with a hard `git checkout` at the end.

> **Cleanup tip:** Each run keeps its own derived-data tree under `apps/example/ios/build`
> (~1.5 GB per sanitizer flavor, ~0.8 GB per framework variant). Once the release is out, delete
> this directory to reclaim ~6 GB of space.

### 3. Regenerate benchmarks (if required)

If performance characteristics might have shifted, regenerate the benchmarks. CI does not produce
these figures and cannot.

> **Hardware rule:** A published figure comes from a **Release** build on a physical phone. The
> README carries the iPhone XS run, and
> [docs/benchmark.md](https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/benchmark.md)
> carries that run beside a Samsung Galaxy S23 one. A run on a simulator or an emulator serves for
> comparison only and is never published.

**Extracting logs:** Follow the steps in
[Regenerating the Benchmarks](https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/benchmark.md#regenerating-the-benchmarks).
On Android, `adb logcat` prints the chunked payload:

```sh
adb logcat | grep BENCHMARK_JSON
```

On an iOS simulator in Release mode, the chunked payload is only visible at the debug level:

```sh
xcrun simctl spawn booted log stream --level debug \
  --predicate 'eventMessage CONTAINS "BENCHMARK_JSON"'
```

A physical iOS device needs the capture set up before the run starts, because relaunching the app to
reach its log discards the results.

### 4. Verify docs, icons and the vendored C core

Ensure all generated assets match their source of truth:

```sh
bun run docs:api --check   # packages/react-native-nitro-h3/docs/api.md is up to date
bun run icons --check      # 18 generated files match img/logo.svg
bun run vendor:h3 --check  # third_party/h3 matches upstream v4.5.0
```

> **Note:** If the vendored H3 version changed, highlight this in the release notes and reference
> `packages/react-native-nitro-h3/third_party/h3/H3_VERSION`.

### 5. Dry-run the tarball

Verify that the published tarball contains exactly what a consumer's native build needs:

```sh
bun run build
cd packages/react-native-nitro-h3
npm pack --dry-run
```

The `prepack` guard runs first. Expect it to print `Pack list OK: 221 files`, the number of files in
the package tarball, before npm lists the simulated tarball contents.

`lib/` contains build outputs ignored by git, which is why `bun run build` comes first.

### 6. Rehearse the release

You can safely simulate the entire release process locally without writing a single tag or
publishing to npm.

```sh
bun install
bun run build
bun release --dry-run --ci
```

**The verification gate.** Before simulating the publish, the script strictly enforces the
verification gate. It runs: install, lint, typecheck, build, specs, and the TypeScript test suite.
Finally, it compiles the parity probe and executes the parity suite against it.

**Simulated outputs.** Because this is a dry run, release-it modifies nothing.

- **The package** prints the version and the `npm publish . --tag latest --dry-run --provenance`
  command it would perform.
- **The root** prints the changelog it would generate from conventional commits, along with the
  bump commit, tag, and GitHub Release details.

**Expected CLI quirks.** Do not be alarmed by these three omissions in the dry-run output:

- release-it does not echo what `npm publish --dry-run` prints (refer to step 5 above for the pack
  list).
- Hooks are listed but not executed. Consequently, the root hook's `pod install` will not touch
  `apps/example/ios`.
- `Writing changelog to undefined` is expected behavior. The repository keeps no `CHANGELOG.md`
  file; the changelog goes directly into the GitHub Release body.

**Post-rehearsal verification.** Confirm that the repository remains pristine and no tags were
created:

```sh
git status --short
git tag --list
```

> **No npm login required:** The package sets `npm.skipChecks` permanently, so release-it never
> runs its `npm whoami` pre-flight check. That option exists for the trusted publishing route,
> because under OIDC there is no identity to report until the publish step exchanges the token, and
> it has the welcome side effect that anyone can rehearse a release without an npm account.

### 7. Publish

The production release is exclusively dispatched manually via the GitHub Actions tab, using the
`Release` workflow with the target version as its input and `dry_run` unchecked.

**Why through CI? npm provenance.** Cryptographic provenance attestations are only produced by a
supported CI runner, and only for a public repository. Triggering the release via CI is the only way
to guarantee this supply-chain security.

### 8. Trusted publishing (one-time setup)

Authentication is npm Trusted Publishing. No `NPM_TOKEN` exists anywhere in this repository and
none is needed: the job's `id-token: write` permission is the entire credential. Configure the
counterpart once on npmjs.com:

1. Open the package page for `react-native-nitro-h3` and go to **Settings → Publishing access**.
2. Add a **GitHub Actions** trusted publisher.
3. Organization or repository owner: `vgorte`. Repository: `react-native-nitro-h3`. Workflow filename:
   `release.yml`. Set the environment field to `npm`, matching the job.

`--provenance` is passed explicitly through `npm.publishArgs` in
`packages/react-native-nitro-h3/package.json`, because release-it 21 has no provenance option of its own.
npm skips attestation generation entirely under `--dry-run`, so the flag stays inert during every
rehearsal, local ones included.

> **First release (`v0.1.0`, done):** this was the single exception to the rule above. A trusted
> publisher can only be configured on a package that already exists in the registry, so the very
> first tarball came from the maintainer's terminal on 2026-08-30:
>
> ```sh
> npm login
> bun release 0.1.0 --npm.publishArgs= --npm.allowSameVersion
> ```
>
> `--npm.publishArgs=` dropped `--provenance` for that one run, because npm refuses to generate an
> attestation outside a supported CI runner, and `--npm.allowSameVersion` was needed because
> `packages/react-native-nitro-h3/package.json` already carried `0.1.0`. That release therefore ships
> without a provenance attestation. Every release from `v0.1.1` onwards goes through the workflow and
> is attested.

## Design of the release pipeline

### Two halves of the workspace

The workspace strictly splits release responsibilities into two halves. An explicit version number
must be passed (for example `bun release 1.0.0`) so both halves stay perfectly in sync without
computing increments independently.

- **The package (`packages/react-native-nitro-h3`):** Strictly responsible for publishing the tarball
  to npm. It does absolutely no git operations.
- **The root:** Strictly handles repository management. It owns the version bump commit, updates
  the package manifests and lockfiles, creates the git tag, generates the changelog, and creates
  the GitHub Release.

### What `bun release <version>` does

Underneath, `bun release` maps directly to `scripts/release.sh`. It executes the release in three
strict phases:

1. **The verification gate (enforced parity):** The gate runs before anything is published. (Relying
   on the root release-it's `before:release` hook for this would fire too late, after the tarball
   was already on npm.) The gate explicitly compiles the parity probe and exports
   `H3_PARITY_REQUIRED`. This guarantees the parity suite runs in strict mode and cannot silently
   skip itself if the probe is missing. The root hook still runs its own
   `H3_PARITY_REQUIRED=1 bun run --cwd packages/react-native-nitro-h3 parity` afterwards, relying on
   `H3_PARITY_PROBE` already being exported by the gate; it is a cheap last check that the
   published code still matches h3-js, not a repeat of the full gate.
2. **Package publishing (`packages/react-native-nitro-h3`):** Executes a pure `npm publish` for the
   package, strictly without any git operations.
3. **Root finalization:** Runs the root release-it. This phase owns the version bump commit, the
   git tag, generating the changelog, and creating the GitHub Release. It also bumps the version in
   `packages/react-native-nitro-h3/package.json` and `apps/example/package.json`, refreshes both
   lockfiles, and stages them for the commit.

### The two jobs of `release.yml`

`Rehearse` runs on `ubuntu-latest`, `Publish` on `macos-latest` (its `after:bump` hook runs
`pod install` for the example app, and CocoaPods only ships on the macOS image). Exactly one of
them runs per dispatch, selected by the `dry_run` input (which defaults to checked).

- **`Rehearse`:** Executes `./scripts/release.sh --dry-run --ci`, which is precisely what the local
  `bun release --dry-run --ci` maps to. It needs no npm identity and no secret beyond the default
  `GITHUB_TOKEN`. It additionally runs on every
  pull request that touches `release.yml`, `scripts/release.sh`, the root `package.json` or the
  package `package.json`, which are the four files that can silently break a release.
- **`Publish`:** Dispatch only, and never selected while `dry_run` is checked. Its first step runs
  before anything is checked out and refuses the run if `version` is not a `MAJOR.MINOR.PATCH`
  string, or if the dispatch ref is not `main`. It then checks out the full history (the
  conventional-changelog plugin reads back to the previous tag), commits as `github-actions[bot]`,
  installs Bun 1.3.14 and Node 22, and finally runs `bun release <version> --ci`. The job declares
  `environment: npm`, so a required reviewer can be added on the repository's Environments page
  without editing the workflow.

> **Why Node 22 next to Bun?** Bun runs the gate, but it does not publish; `npm publish` does.
> Trusted publishing needs npm 11.5 or newer, so the job prints `npm --version` and upgrades npm
> when the runner image ships anything older.

## After going public

The repository has been public since 2026-08-30. Three of the four tasks that switch brings are done;
one is still open.

### 1. Verify assets and badges (done)

The README renders correctly on both GitHub and npm. Every image and link in it is an absolute
`https://` URL, with the logo and the two charts served from
`raw.githubusercontent.com/vgorte/react-native-nitro-h3/main/img/`, which resolves only while the
repository is public. The npm version badge (`shields.io`) reported "package not found" until the
first tarball reached the registry.

### 2. Enable macOS / iOS CI workflows (one left)

Two of the three landed. `iOS pod lockfile` runs `pod install` on a macOS runner and fails when
`apps/example/ios/Podfile.lock` has drifted, which nothing caught between releases before.
`Build iOS` builds the example app for both framework linkages, so a podspec that links only one way
can no longer reach a release unnoticed. The iOS harness workflow, covering the three flavors of
`scripts/device-ios.sh`, is still omitted.

- **The reason:** macOS runner minutes bill at 10× the Linux rate, which is why all three were left
  out while the repository was private.
- **The action:** those minutes are free for public repositories now. The harness workflow is the
  last one; until it lands, step 2 of the detailed procedure runs it by hand.

### 3. Enforce branch protection on `main` (done)

`main` carries a ruleset that refuses deletion and force pushes. It deliberately does not require a
pull request, because the `Publish` job pushes the version bump commit straight to `main`.

### 4. GitHub Pages for the documentation site (done)

`.github/workflows/pages.yml` builds `website/` on every pull request that touches the docs and
deploys to `https://vgorte.github.io/react-native-nitro-h3/` on every push to `main`. The
repository's Pages source was switched to GitHub Actions once, on 2026-09-02, with:

```sh
gh api -X POST repos/vgorte/react-native-nitro-h3/pages -f build_type=workflow
```

The `github-pages` environment the deploy job uses is created by the first deployment. The
repository's "About" homepage and the package's `homepage` field both point at the site; npm shows
the new link with the next publish, because it reads the field from the published manifest.
