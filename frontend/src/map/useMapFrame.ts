import { useLayoutEffect, useState, type RefObject } from 'react';
import type { MapFrame } from './TransitMap';

export interface MapContent {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Fit the schematic network into the visible part of the container. The viewBox grows to the
 * container's shape and shifts to clear overlays (the desktop panel on the left, the header on top).
 */
export function useMapFrame(
  ref: RefObject<HTMLElement | null>,
  inset: { top: number; left: number; bottom: number; bottomRatio?: number },
  CONTENT: MapContent,
) {
  const [frame, setFrame] = useState<MapFrame>({ x: CONTENT.x, y: CONTENT.y, w: CONTENT.w, h: CONTENT.h });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const visibleW = Math.max(width - inset.left, 1);
      const bottom = inset.bottom + height * (inset.bottomRatio ?? 0);
      const visibleH = Math.max(height - inset.top - bottom, 1);
      const scale = Math.min(visibleW / CONTENT.w, visibleH / CONTENT.h, 2.4);
      const w = width / scale;
      const h = height / scale;
      const x = CONTENT.x + CONTENT.w / 2 - (inset.left + visibleW / 2) / scale;
      const y = CONTENT.y + CONTENT.h / 2 - (inset.top + visibleH / 2) / scale;
      setFrame((prev) =>
        Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5 && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5
          ? prev
          : { x, y, w, h },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, inset.top, inset.left, inset.bottom, inset.bottomRatio, CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h]);

  return frame;
}
