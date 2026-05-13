# Copilot Instructions — react-native-skia-infinite-canvas

An Expo demo app for a GPU-accelerated infinite canvas using React Native Skia, Reanimated, and Gesture Handler. Reference: [README.md](./README.md).

## Commands

```bash
npm install          # install deps
npm start            # start Expo dev server (press i/a for iOS/Android)
npm run ios          # run on iOS simulator
npm run android      # run on Android emulator
npm run lint         # ESLint via expo lint
```

## Architecture

- **`components/InfiniteCanvas.tsx`** — the entire canvas implementation; single component, no sub-components
- **`app/index.tsx`** — mounts `InfiniteCanvas` below a static header
- **`app/_layout.tsx`** — Expo Router root layout
- Path alias `@/*` resolves to the workspace root (e.g. `@/components/InfiniteCanvas`)

## Core Patterns

### Transform state
All coordinate transforms use three `useSharedValue`s: `panX`, `panY`, `scalePrevious`. These are composed into a `transform` array via `useDerivedValue` and passed to a Skia `<Group>`.

### Gesture composition
Pan, Pinch, and Tap gestures are combined with `Gesture.Simultaneous(panGesture, pinchGesture, tapGesture)` and wrapped in a single `<GestureDetector>`.

### Content culling
`useAnimatedReaction` watches pan/zoom shared values and calls `runOnJS(setVisibleItemsState)` to push filtered items to React state. **Do not** use `useDerivedValue` for this — `.value` reads in the render function create static snapshots that don't update during gestures.

### Coordinate conversion (screen → world)
```ts
const worldX = (screenX - panX.value) / scale;
const worldY = (screenY - panY.value) / scale;
```

### Focal-point zoom
When zooming, adjust pan so the world point under the pinch focal stays fixed:
```ts
const worldX = (focalX - panX) / oldScale;
panX = focalX - worldX * newScale;
```

## Key Constraints

- **Babel**: `react-native-reanimated/plugin` must be listed in `babel.config.js` plugins — removing it breaks all Reanimated worklets.
- **Zoom bounds**: Scale clamped to `[0.1, 5.0]`.
- **Pan momentum**: `withDecay({ deceleration: 0.998, clamp: [-5000, 5000] })`.
- **Culling margin**: 300 world-units (divided by zoom) beyond viewport edges to avoid pop-in.
- **Font**: SpaceMono-Regular.ttf loaded via `useFont` — required for Skia `<Text>` nodes.
- **TypeScript**: `strict: true`; use explicit types for Skia/Reanimated callbacks.

## Tech Versions

| Package | Version |
|---|---|
| `@shopify/react-native-skia` | `^2.0.0-next.4` |
| `react-native-reanimated` | `~3.17.4` |
| `react-native-gesture-handler` | `~2.24.0` |
| `expo-router` | `~5.1.5` |
| `react-native` | `^0.79.5` |
| TypeScript | `~5.8.3` |
