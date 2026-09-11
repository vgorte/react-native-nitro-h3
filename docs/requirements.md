# 📱 Requirements

The package compiles the vendored H3 C sources as part of the app build, so a project needs the platform and toolchain versions below before it links.

| Platform      | Requirement                    |
| ------------- | ------------------------------ |
| React Native  | `0.76` or newer                |
| Nitro Modules | `0.37.0` or newer              |
| C++           | C++20-compatible toolchain     |
| iOS           | `15.1` or newer, the floor React Native `0.87.1` sets |
| Xcode         | `16.1` or newer, the floor React Native `0.87.1` sets |
| Android       | `minSdk 24`                    |
| Android SDK   | `compileSdk 36`                |
| Android NDK   | `27.1.12297006`                |
| H3 C library  | `4.5.0`, vendored              |

The package requires the New Architecture, the default since React Native 0.76.
The `build-ios.yml` and `build-android.yml` workflows compile the example app against React Native 0.87.1.

> [!PLATFORM]
> The package has no web implementation, so importing it on the `web` platform throws instead of falling back.
> Use `h3-js` there.

[Getting Started](./getting-started.md) installs the package once these versions are in place.
