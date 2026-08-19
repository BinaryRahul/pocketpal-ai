# MobiGPT Release Validation

## Purpose

MobiGPT treats a mobile release as a runtime artifact, not merely as a successful Gradle compilation. The optimized release pipeline therefore validates the exact APK/AAB output after R8, inspects its package and native contents, installs it, launches it twice, waits for delayed startup failures, and checks app-specific logcat before the required release gate can pass.

This contract exists because the clean OpenAI-only branch previously produced an APK that compiled and passed an x86_64 emulator launch, but failed on a physical ARM64 Android device. The device log showed React Native 0.82 loading SoLoader and then failing to resolve `com.facebook.react.devsupport.CxxInspectorPackagerConnection` through `InspectorFlags`. R8 had removed a class reached through a dynamic JNI/devsupport path. The activity was subsequently force-finished.

The narrow keep rules for that React Native runtime contract are retained in `android/app/proguard-rules.pro`. The known dynamic classes are listed in `android/release-runtime-contracts.txt` and checked against the R8 seeds output for every optimized release APK.

## Main required workflow

The main workflow is `.github/workflows/mobigpt-api.yml`. It runs on pushes and pull requests targeting `openai-only-clean`, as well as manual dispatch. Its required status is `Required optimized release gate`.

| Stage | Validation |
|---|---|
| Checks | TypeScript, ESLint, Jest, shell syntax, Prettier workflow formatting, and whitespace validation |
| Standalone APKs | Optimized R8/resource-shrunk ARM64 and x86_64 APKs using explicit `targetAbi` and `reactNativeArchitectures` properties |
| APK inspection | Package ID, visible label, launcher activity, version metadata, exact ABI, React Native bundle, and required native libraries |
| R8 inspection | Runtime-contract retention in `seeds.txt`, plus mapping, usage, and missing-rule outputs uploaded as artifacts |
| AAB inspection | Pinned bundletool validation, device-specific ARM64/x86_64 APK-set generation, split inspection, and checksums |
| API 27 smoke | Two cold starts on Android 8.1/API 27 using the optimized x86_64 APK |
| API 29 smoke | Two cold starts on Android 10/API 29, matching the Oppo F9 Pro OS baseline, using the optimized x86_64 APK |
| API 35 smoke | Two cold starts on modern Android using the optimized x86_64 APK |
| AAB x86_64 smoke | Two cold starts using the x86_64 APK set generated from the AAB |
| Release gate | Fails unless all required checks above succeed |

The automatic workflow deliberately does not claim that an x86_64 emulator validates ARM64 native execution. GitHub’s standard ARM64 runner is available for ARM64 computation, but the observed runner image cannot provide the KVM/emulator toolchain required by the Android emulator action. The two automatic ARM64 emulator jobs were therefore removed from the required gate rather than leaving a permanently failing or misleading test. The exact ARM64 runtime gate is the manual physical-device workflow described below.

## Reusable validation scripts

The scripts under `scripts/` are intentionally independent of Gradle so they can be reused by emulator jobs, a physical device runner, or a device farm.

| Script | Function |
|---|---|
| `inspect-apk.sh` | Inspects a standalone APK with `aapt2` and `unzip`, checking package identity, label, launcher, version, exact ABI, JavaScript bundle, and required native libraries |
| `inspect-apks-set.sh` | Inspects APKs extracted from a bundletool `.apks` archive, checking base metadata and ABI presence across split APKs |
| `validate-r8-contracts.sh` | Verifies that all classes in `android/release-runtime-contracts.txt` appear in R8 `seeds.txt` and fails on non-empty `missing_rules.txt` |
| `smoke-test-android.sh` | Installs or reuses an installed APK, clears data, performs two cold starts, waits for delayed failures, checks process survival, and saves logcat/dumpsys diagnostics |
| `retry-gradle.sh` | Retries Gradle with exponential backoff for transient Maven/Google repository rate limits without hiding a deterministic failure |

The smoke script scans only the MobiGPT process/package and the matching `Force finishing activity` line. It does not fail on unrelated Android system-service warnings such as Settings `NoSuchMethodException` or `ClassNotFoundException` messages.

## Runtime crash signatures

A smoke test fails when the MobiGPT-related log contains any of the following signatures:

```text
FATAL EXCEPTION
ClassNotFoundException
NoSuchMethodException
UnsatisfiedLinkError
ExceptionInInitializerError
ReactNativeJS
SIGSEGV
SIGABRT
Abort message
Force finishing activity com.pocketpallite
```

On failure, the workflow uploads the start result, app-specific logcat, full logcat, activity and package dumpsys output, process state, and PID information. This preserves the evidence needed to distinguish installation failure, activity-start failure, delayed Java/Kotlin exception, missing native library, Hermes/JavaScript failure, or native signal.

## R8 runtime-contract procedure

When adding or upgrading React Native, Hermes, a native module, a TurboModule/codegen package, or any JNI/reflection-based implementation, use this process:

1. Identify classes reached dynamically through JNI, reflection, generated registration, annotations, or merged native-library mappings.
2. Add the narrowest required keep rule to `android/app/proguard-rules.pro`; avoid keeping the entire React Native package unless the dependency’s official contract requires it.
3. Add the class or class prefix to `android/release-runtime-contracts.txt`.
4. Run an optimized release build through the main workflow.
5. Review the uploaded `mapping.txt`, `seeds.txt`, `usage.txt`, and `missing_rules.txt` artifacts.
6. Require API 27, API 29, and API 35 repeated startup tests to pass.
7. Run the exact ARM64 release-candidate device test before publication.

The runtime-contract file is a defense for known dynamic entry points. It is not a proof that an unreviewed future dependency has no dynamic behavior; dependency updates must still receive the complete optimized release and release-candidate validation.

## Manual exact-artifact ARM64 device validation

The workflow `.github/workflows/mobigpt-device-farm.yml` is manually dispatched and requires a self-hosted runner labeled `self-hosted`, `linux`, `arm64`, and `android-device`. The runner must have `adb`, `curl`, `jq`, `unzip`, Android SDK build-tools, and one authorized physical ARM64 Android device.

The workflow downloads the exact ARM64 artifact from a selected successful main-workflow run rather than rebuilding a different APK. It verifies the connected device ABI and API level, verifies the APK package/label/launcher/native contents, installs the artifact, performs two cold starts with a 15-second observation window, and uploads checksums and complete device diagnostics.

Example dispatch:

```bash
gh workflow run mobigpt-device-farm.yml \
  --repo BinaryRahul/pocketpal-ai \
  --ref openai-only-clean \
  -f run_id=RUN_ID \
  -f artifact_name=MobiGPT-api-release-arm64-v8a \
  -f ref=openai-only-clean
```

This workflow is the correct place to test Oppo/ColorOS, MediaTek, and other vendor-specific behavior. The final release policy should require it before publishing an ARM64 artifact, even though it is not part of every push because physical-device runners are slower and require device availability.

## Dependency-update policy

`.github/dependabot.yml` monitors npm, Gradle, and GitHub Actions dependencies weekly. React Native, Hermes, AsyncStorage, Keychain, SSE, Android Gradle Plugin, Kotlin, and workflow-action changes must pass the optimized release workflow. Any update that changes native startup, React Native code generation, R8 behavior, or Android build tooling also requires a manual ARM64 release-candidate run.

The debug and no-R8 diagnostic builds remain manual-only. They are useful for diagnosis but cannot substitute for the optimized release gate because the production APK uses R8 and resource shrinking.

## Release checklist

Before publishing a release, confirm the following table is complete.

| Check | Required result |
|---|---|
| Git commit | Release source is the intended `openai-only-clean` commit |
| ARM64 APK | Optimized, exact `arm64-v8a`, checksum recorded |
| x86_64 APK | Optimized, exact `x86_64`, checksum recorded |
| AAB | Optimized, bundletool-valid, ARM64/x86_64 generated sets inspected |
| R8 | Runtime contracts retained; no unreviewed missing rules |
| API 27/29/35 | Two cold starts pass for each emulator job |
| AAB x86_64 | Generated split APK set survives two cold starts |
| Physical ARM64 | Exact selected ARM64 artifact survives two cold starts on a real device |
| GitHub gate | `Required optimized release gate` is green |
| Logs | Startup diagnostics and artifact checksums are retained |

The repaired release that fixed the Oppo crash was validated in run `32282166031`. The hardened automatic pipeline was subsequently validated successfully in run `32291531177` at commit `8fa3eb4`, with optimized ARM64/x86_64 builds, R8 contract checks, AAB split inspection, API 27/API 29/API 35 startup, AAB x86_64 startup, and the required release gate all passing.

## References

[1]: https://developer.android.com/build/shrink-code "Android Developers: Enable app optimization with R8"

[2]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners "GitHub Actions: GitHub-hosted runners reference"

[3]: https://github.com/ReactiveCircus/android-emulator-runner "ReactiveCircus Android Emulator Runner"

[4]: https://firebase.google.com/docs/test-lab "Firebase Test Lab documentation"

[5]: https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners "GitHub Actions: About self-hosted runners"
