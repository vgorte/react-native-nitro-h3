# 📱 Requirements

The package compiles the vendored H3 C sources as part of the app build, so a project needs the
platform and toolchain versions below before it links.

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
