import { useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Wraps a <video> (live or recorded) with scroll-to-zoom, pinch-to-zoom and
 * drag-to-pan, since the RLC-810A has no optical zoom -- this is a purely
 * client-side digital zoom over the rendered frame.
 */
export function ZoomableMedia({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchState = useRef<{ startDist: number; startScale: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null
  );

  function clampTranslate(nextScale: number, t: { x: number; y: number }) {
    const el = containerRef.current;
    if (!el || nextScale <= 1) return { x: 0, y: 0 };
    const maxX = (el.clientWidth * (nextScale - 1)) / 2;
    const maxY = (el.clientHeight * (nextScale - 1)) / 2;
    return { x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) };
  }

  function zoomAt(clientX: number, clientY: number, nextScaleRaw: number) {
    const el = containerRef.current;
    if (!el) return;
    const nextScale = clamp(nextScaleRaw, MIN_SCALE, MAX_SCALE);
    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const ratio = nextScale / scale;

    setScale(nextScale);
    setTranslate(
      clampTranslate(nextScale, {
        x: translate.x * ratio - cx * (ratio - 1),
        y: translate.y * ratio - cy * (ratio - 1),
      })
    );
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, scale * factor);
  }

  function handlePointerDown(e: PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchState.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y), startScale: scale };
      dragState.current = null;
    } else if (pointers.current.size === 1 && scale > 1) {
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: translate.x,
        originY: translate.y,
      };
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchState.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, b.y - a.y);
      const nextScale = (pinchState.current.startScale * dist) / pinchState.current.startDist;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, nextScale);
    } else if (dragState.current && scale > 1) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setTranslate(
        clampTranslate(scale, { x: dragState.current.originX + dx, y: dragState.current.originY + dy })
      );
    }
  }

  function handlePointerUp(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchState.current = null;
    if (pointers.current.size === 0) dragState.current = null;
  }

  function reset() {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={reset}
    >
      <div
        className="h-full w-full"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: "center center",
          cursor: scale > 1 ? "grab" : "default",
        }}
      >
        {children}
      </div>
      {scale > 1 && (
        <button
          onClick={reset}
          className="absolute bottom-2 right-2 rounded-lg bg-surface/90 px-2.5 py-1 text-xs font-medium text-text backdrop-blur"
        >
          Réinitialiser le zoom ({scale.toFixed(1)}×)
        </button>
      )}
    </div>
  );
}
