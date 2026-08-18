# MobiGPT

MobiGPT is a minimal React Native mobile chat client for **OpenAI-compatible APIs**. It keeps the existing mobile shell and user-visible branding while removing local GGUF models, llama.cpp, native inference, model downloads, device benchmarking, PalsHub, TTS, image analysis, Firebase, and the associated native/service layers.

> MobiGPT sends messages to the API endpoint configured by the user. It does not download, inspect, package, or execute local model files.

## Features

The app provides a single chat surface with conversation history, streaming assistant responses, cancellation, configurable API base URL, bearer API key, model name, system prompt, temperature, and maximum output tokens. Settings and chat history persist locally. The API key is stored through the platform keychain when available.

The default endpoint is `https://api.openai.com/v1`, but the base URL is editable for compatible gateways, self-hosted proxies, or local-network services. The client uses the OpenAI Chat Completions request shape and Server-Sent Events (`stream: true`), which is supported by many OpenAI-compatible providers. The streaming transport is `react-native-sse`, a React Native EventSource implementation that supports POST bodies and custom headers.[1]

## Security

A mobile application cannot keep a provider key secret if it calls a third-party API directly. MobiGPT stores the key in the platform keychain and displays a recommendation to use a trusted proxy for production deployments. Do not ship a shared organization key inside a public mobile build. The custom base URL exists so a proxy can enforce authentication, rate limits, user identity, and provider isolation.[2]

## Repository size

The original fork contained more than 1,500 tracked files because it inherited a full on-device AI product: over 1,200 frontend files, E2E/device-farm suites, Android and iOS native bridges, model-download persistence, benchmark assets, PalsHub/auth flows, TTS and multimodal assets, release tooling, mocks, and documentation. The clean branch removes those product areas rather than merely hiding them from navigation.

The remaining structure is intentionally small:

```text
App.tsx                 Single-screen chat UI and settings
src/api/openai.ts       OpenAI-compatible SSE adapter
src/storage/index.ts    AsyncStorage transcript/settings + Keychain API key
src/types.ts            Chat and settings types
android/                Minimal React Native Android wrapper
auto-linked AsyncStorage, Keychain, and SSE only
ios/                    Minimal React Native iOS wrapper
__tests__/api.test.ts   Focused transport contract test
.github/workflows/      Focused JavaScript CI workflow
```

## Development

Use Node.js `22.21.0` or newer and Yarn Classic `1.22.22`.

```bash
git clone https://github.com/BinaryRahul/pocketpal-ai.git
cd pocketpal-ai
git checkout openai-only-clean
yarn install
yarn start
yarn android     # Android emulator/device
yarn ios         # macOS + Xcode only
```

Run the local quality gates before pushing changes:

```bash
yarn typecheck
yarn lint
yarn test
```

Android release builds remain CI responsibilities. The app uses the stable internal React Native registration name `PocketPal` and preserves the Android application ID `com.pocketpallite` for installation compatibility, while the visible label remains **MobiGPT**.

## API contract

MobiGPT sends a request equivalent to:

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful, concise assistant."},
    {"role": "user", "content": "Hello"}
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": true
}
```

The endpoint is `<baseUrl>/chat/completions` unless the configured base URL already ends with `/chat/completions`. Each streamed `data:` frame is parsed from `choices[0].delta.content`; `data: [DONE]` completes the response. Providers that use the newer Responses API can be supported later through a separate adapter without changing the UI or persistence boundary.[3]

## License

Licensed under the [MIT License](LICENSE).

## References

[1]: https://github.com/binaryminds/react-native-sse "React Native EventSource (Server-Sent Events)"
[2]: https://github.com/backmesh/openai-react-native "OpenAI API React Native Client security guidance"
[3]: https://developers.openai.com/api/docs/guides/streaming-responses "OpenAI — Streaming API responses"
