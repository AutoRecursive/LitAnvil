import React, { useEffect, useRef } from "react";
export function ResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  onChange,
  defaultValue,
  step = 10,
  direction = 1,
  pixelsPerUnit = () => 1,
  startValue,
  className = "",
}: {
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  defaultValue: number;
  step?: number;
  direction?: number;
  pixelsPerUnit?: () => number;
  startValue?: () => number;
  className?: string;
}) {
  const drag = useRef<{
    position: number;
    value: number;
    unit: number;
    cursor: string;
    selection: string;
  } | null>(null);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const finish = () => {
    if (!drag.current) return;
    document.body.style.cursor = drag.current.cursor;
    document.body.style.userSelect = drag.current.selection;
    drag.current = null;
  };
  useEffect(() => finish, []);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title={`${label} · 拖动调整，双击还原`}
      className={`resize-handle ${orientation} ${className}`}
      onDoubleClick={() => onChange(defaultValue)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = {
          position: orientation === "vertical" ? event.clientX : event.clientY,
          value: startValue?.() ?? value,
          unit: Math.max(0.01, pixelsPerUnit()),
          cursor: document.body.style.cursor,
          selection: document.body.style.userSelect,
        };
        document.body.style.cursor =
          orientation === "vertical" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const position =
          orientation === "vertical" ? event.clientX : event.clientY;
        onChange(
          clamp(
            drag.current.value +
              ((position - drag.current.position) * direction) /
                drag.current.unit,
          ),
        );
      }}
      onPointerUp={(event) => {
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const negative = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const positive =
          orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (event.key === "Home") {
          event.preventDefault();
          onChange(defaultValue);
        } else if (event.key === negative || event.key === positive) {
          event.preventDefault();
          onChange(
            clamp(value + (event.key === positive ? step : -step) * direction),
          );
        }
      }}
    />
  );
}
