import { useEffect, useState } from 'react';
import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

/**
 * Web-specific loader: defers importing InfiniteCanvas until after
 * CanvasKit WASM is fully initialized, preventing "PictureRecorder undefined" errors.
 * Metro automatically picks this file on web over CanvasLoader.tsx.
 */
export default function CanvasLoader() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  return (
    <WithSkiaWeb
      opts={{
        locateFile: (file: string) => new URL(`/${file}`, window.location.origin).toString(),
      }}
      getComponent={() => import('./InfiniteCanvas')}
    />
  );
}
