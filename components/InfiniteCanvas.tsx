import { Canvas, Group, Image, Rect, Skia, Text, useFont } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useDerivedValue,
  useSharedValue,
  useAnimatedReaction,
  withDecay,
  runOnJS
} from 'react-native-reanimated';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Polaroid item layout constants
const ITEM_WIDTH = 160;
const ITEM_PAD = 8;          // padding on all four sides inside the white frame
const IMG_SIZE = ITEM_WIDTH - ITEM_PAD * 2;  // 144 — square photo area
const CAPTION_H = 44;        // space below the photo for name + date
const ITEM_HEIGHT = ITEM_PAD + IMG_SIZE + CAPTION_H; // 200

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eva', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack'];
const LAST_NAMES  = ['Smith', 'Jones', 'Lee', 'Brown', 'Davis', 'Wilson', 'Taylor', 'Clark', 'Hall', 'Young'];

function seededDate(id: number): string {
  const year  = 2018 + (id % 7);
  const month = String(((id * 3) % 12) + 1).padStart(2, '0');
  const day   = String(((id * 7) % 28) + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Interface for canvas items
 */
interface CanvasItem {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  date: string;
  color: string;
}

/**
 * 1000 Polaroid-style items distributed across the canvas (25 columns × 40 rows)
 */
const COLS = 25;
const sampleItems: CanvasItem[] = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  x: (i % COLS) * (ITEM_WIDTH + 20) - (COLS / 2) * (ITEM_WIDTH + 20),
  y: Math.floor(i / COLS) * (ITEM_HEIGHT + 20) - 500,
  width: ITEM_WIDTH,
  height: ITEM_HEIGHT,
  text: `${FIRST_NAMES[i % 10]} ${LAST_NAMES[(i * 3) % 10]}`,
  date: seededDate(i),
  color: `hsl(${(i * 137.5) % 360}, 60%, 80%)`,
}));

/**
 * InfiniteCanvas component demonstrating the concepts from the blog post:
 * - Transform matrix for coordinate management
 * - Multi-touch gesture handling with focal point tracking
 * - Performance optimization through content culling
 * - Smooth 60fps rendering with Skia
 */
export default function InfiniteCanvas() {
  // Core shared values for transform state
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  
  // Track previous pan position for delta calculation
  const prevPanX = useSharedValue(0);
  const prevPanY = useSharedValue(0);
  
  // Zoom state
  const scalePrevious = useSharedValue(1);
  
  // Selection state
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  /**
   * React state for visible items.
   * This state is updated by useAnimatedReaction when SharedValues change,
   * ensuring the canvas re-renders during pan/pinch gestures.
   */
  const [visibleItemsState, setVisibleItemsState] = useState<CanvasItem[]>(sampleItems);


  const containerRef = useRef<View>(null);

  // Load a unique HD image for every item imperatively (avoids the hook-in-loop constraint).
  // picsum IDs 1–200 are all distinct photos. 480×240 = 4× the item display size for HD quality.
  const [images, setImages] = useState<Record<number, SkImage>>({});
  useEffect(() => {
    const BATCH = 20;
    (async () => {
      for (let i = 0; i < sampleItems.length; i += BATCH) {
        const batch = sampleItems.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (item) => {
            try {
              const url = `https://picsum.photos/id/${(item.id % 500) + 1}/576/576`;
              const res = await fetch(url);
              const buffer = await res.arrayBuffer();
              const data = Skia.Data.fromBytes(new Uint8Array(buffer));
              const image = Skia.Image.MakeImageFromEncoded(data);
              return { id: item.id, image };
            } catch {
              return { id: item.id, image: null };
            }
          })
        );
        setImages(prev => {
          const next = { ...prev };
          for (const { id, image } of results) {
            if (image) next[id] = image;
          }
          return next;
        });
      }
    })();
  }, []);

  // Load font (optional - fallback to default if not found)
  const font     = useFont(require('../assets/fonts/SpaceMono-Regular.ttf'), 14);
  const fontName = useFont(require('../assets/fonts/SpaceMono-Regular.ttf'), 11);
  const fontDate = useFont(require('../assets/fonts/SpaceMono-Regular.ttf'),  9);

  // Calculate transform matrix (simplified since we're not using scaleCurrent anymore)
  const transform = useDerivedValue(() => {
    return [
      { translateX: panX.value },
      { translateY: panY.value },
      { scale: scalePrevious.value },
    ];
  });

  /**
   * Content culling - only render items visible in viewport.
   *
   * Uses useAnimatedReaction to bridge Reanimated's UI thread to React's render cycle.
   * This is necessary because SharedValue changes (during pan/pinch gestures) don't
   * trigger React re-renders. By using runOnJS to update React state, we ensure
   * the canvas re-renders with the correct visible items during gestures.
   *
   * Note: A useDerivedValue approach won't work here because accessing .value
   * in the render function creates a static snapshot that only updates on React re-renders.
   */
  useAnimatedReaction(
    () => ({
      x: panX.value,
      y: panY.value,
      s: scalePrevious.value,
    }),
    (current) => {
      const currentZoom = current.s;
      const currentPanX = current.x;
      const currentPanY = current.y;

      // Calculate viewport bounds in world coordinates
      const viewportLeft = (0 - currentPanX) / currentZoom;
      const viewportRight = (screenWidth - currentPanX) / currentZoom;
      const viewportTop = (0 - currentPanY) / currentZoom;
      const viewportBottom = (screenHeight - currentPanY) / currentZoom;

      // Add margin for smooth scrolling
      const margin = 300 / currentZoom;

      const filtered = sampleItems.filter(item => {
        const itemLeft = item.x;
        const itemRight = item.x + item.width;
        const itemTop = item.y;
        const itemBottom = item.y + item.height;

        // Check if item intersects with viewport
        return !(itemRight < viewportLeft - margin ||
                 itemLeft > viewportRight + margin ||
                 itemBottom < viewportTop - margin ||
                 itemTop > viewportBottom + margin);
      });

      runOnJS(setVisibleItemsState)(filtered);
    },
    []
  );

  // Trackpad pinch-to-zoom on web — wheel events with ctrlKey are pinch gestures
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = containerRef.current as unknown as HTMLElement | null;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const focalX = event.clientX - rect.left;
      const focalY = event.clientY - rect.top;

      const currentScale = scalePrevious.value;
      const newZoom = Math.max(0.1, Math.min(5.0, currentScale * (1 - event.deltaY * 0.01)));

      const worldX = (focalX - panX.value) / currentScale;
      const worldY = (focalY - panY.value) / currentScale;

      scalePrevious.value = newZoom;
      panX.value = focalX - worldX * newZoom;
      panY.value = focalY - worldY * newZoom;
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Handles tap gestures for item selection
   * Converts screen coordinates to world coordinates and performs hit testing
   */
  const handleTap = useCallback((
    screenX: number, 
    screenY: number, 
    currentZoom: number, 
    currentPanX: number, 
    currentPanY: number
  ) => {
    // Convert screen coordinates to world coordinates
    const worldX = (screenX - currentPanX) / currentZoom;
    const worldY = (screenY - currentPanY) / currentZoom;
    
    // Hit test against items
    const tappedItem = sampleItems.find((item: CanvasItem) => {
      return worldX >= item.x && 
             worldX <= item.x + item.width &&
             worldY >= item.y && 
             worldY <= item.y + item.height;
    });
    
    setSelectedItemId(tappedItem ? tappedItem.id : null);
  }, []);

  const tapGesture = Gesture.Tap()
    .onStart((event) => {
      runOnJS(handleTap)(event.x, event.y, scalePrevious.value, panX.value, panY.value);
    });

  // Pan gesture handler - 1:1 finger tracking with momentum
  const panGesture = Gesture.Pan()
    .onStart((event) => {
      // Store the starting position
      prevPanX.value = event.translationX;
      prevPanY.value = event.translationY;
    })
    .onUpdate((event) => {
      // Calculate the change since last frame
      const deltaX = event.translationX - prevPanX.value;
      const deltaY = event.translationY - prevPanY.value;
      
      // Apply the delta to pan position
      panX.value += deltaX;
      panY.value += deltaY;
      
      // Update previous position for next frame
      prevPanX.value = event.translationX;
      prevPanY.value = event.translationY;
    })
    .onEnd((event) => {
      // Add momentum with smooth physics
      panX.value = withDecay({
        velocity: event.velocityX,
        deceleration: 0.998,
        clamp: [-5000, 5000]
      });
      
      panY.value = withDecay({
        velocity: event.velocityY,
        deceleration: 0.998,
        clamp: [-5000, 5000]
      });
    });

  // Pinch gesture handler - apply zoom continuously
  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      // Apply zoom sensitivity (slower zoom)
      const zoomSensitivity = 0.05;
      const rawScale = 1 + (event.scale - 1) * zoomSensitivity;
      const newZoom = Math.max(0.1, Math.min(5.0, scalePrevious.value * rawScale));
      
      // Get current focal point
      const currentFocalX = event.focalX;
      const currentFocalY = event.focalY;
      
      // Calculate what world point is under the focal point at current zoom
      const worldX = (currentFocalX - panX.value) / scalePrevious.value;
      const worldY = (currentFocalY - panY.value) / scalePrevious.value;
      
      // Update zoom and adjust pan to keep world point under focal point
      scalePrevious.value = newZoom;
      panX.value = currentFocalX - worldX * newZoom;
      panY.value = currentFocalY - worldY * newZoom;
    });

  // Combine gestures
  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture, tapGesture);

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View ref={containerRef} style={{ flex: 1 }}>
        <Canvas style={{ flex: 1 }}>
          <Group transform={transform}>
            {visibleItemsState.map(item => {
              const isSelected = selectedItemId === item.id;
              return (
                <Group key={item.id}>
                  {/* Polaroid white frame */}
                  <Rect
                    x={item.x}
                    y={item.y}
                    width={item.width}
                    height={item.height}
                    color="white"
                    style="fill"
                  />
                  {/* Photo placeholder (tinted while image loads) */}
                  <Rect
                    x={item.x + ITEM_PAD}
                    y={item.y + ITEM_PAD}
                    width={IMG_SIZE}
                    height={IMG_SIZE}
                    color={item.color}
                    style="fill"
                  />
                  {/* HD photo */}
                  {images[item.id] && (
                    <Image
                      image={images[item.id]}
                      x={item.x + ITEM_PAD}
                      y={item.y + ITEM_PAD}
                      width={IMG_SIZE}
                      height={IMG_SIZE}
                      fit="cover"
                    />
                  )}
                  {/* Caption — name */}
                  <Text
                    x={item.x + ITEM_PAD}
                    y={item.y + ITEM_PAD + IMG_SIZE + 16}
                    text={item.text}
                    font={fontName}
                    color="#222222"
                  />
                  {/* Caption — date */}
                  <Text
                    x={item.x + ITEM_PAD}
                    y={item.y + ITEM_PAD + IMG_SIZE + 32}
                    text={item.date}
                    font={fontDate}
                    color="#888888"
                  />
                  {/* Outer frame border — blue when selected */}
                  <Rect
                    x={item.x}
                    y={item.y}
                    width={item.width}
                    height={item.height}
                    color={isSelected ? '#007AFF' : '#d0d0d0'}
                    style="stroke"
                    strokeWidth={isSelected ? 3 : 1}
                  />
                </Group>
              );
            })}
            
            {/* Origin indicator */}
            <Group>
              <Rect
                x={-5}
                y={-5}
                width={10}
                height={10}
                color="red"
                style="fill"
              />
              <Text
                x={10}
                y={0}
                text="Origin (0,0)"
                font={font}
                color="red"
              />
            </Group>
          </Group>
        </Canvas>
      </Animated.View>
    </GestureDetector>
  );
}