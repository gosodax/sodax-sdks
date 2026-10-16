import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The height an element's content wants, held after that element goes away. Point it at a wrapper
 * around the content and nothing else: a scroll container's own box is the room it was given, which
 * answers a different question.
 *
 * A callback ref rather than an object one, because the element this measures mounts and unmounts
 * with the panel it belongs to, and an effect reading `ref.current` once would never see it return.
 * Keeping the last height is the point: a sibling sized by it holds still while that panel is away.
 */
export function useContentHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState<number>();
  const observer = useRef<ResizeObserver>(undefined);

  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    if (!element) return;

    const measure = () => setHeight(element.getBoundingClientRect().height);
    observer.current = new ResizeObserver(measure);
    observer.current.observe(element);
    measure();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, height] as const;
}
