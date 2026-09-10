import { useCallback, useState } from 'react';

/**
 * `[height, onLayout]` — attach `onLayout` to a view to track its real rendered height.
 * Used to size content around things whose height isn't a fixed constant (e.g. the Mini
 * Player, which is 0 when no track is loaded and a fixed height otherwise).
 */
export function useMeasuredHeight(initial = 0) {
  const [height, setHeight] = useState(initial);
  const onLayout = useCallback((e) => {
    const next = e.nativeEvent.layout.height;
    setHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, []);
  return [height, onLayout];
}

export default useMeasuredHeight;
