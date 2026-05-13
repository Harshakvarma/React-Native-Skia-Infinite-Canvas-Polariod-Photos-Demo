import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

/**
 * Web-specific loader: defers importing InfiniteCanvas until after
 * CanvasKit WASM is fully initialized, preventing "PictureRecorder undefined" errors.
 * Metro automatically picks this file on web over CanvasLoader.tsx.
 */
export default function CanvasLoader() {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file: string) => `/${file}` }}
      getComponent={() => import('./InfiniteCanvas')}
    />
  );
}
