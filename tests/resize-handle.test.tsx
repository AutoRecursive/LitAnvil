// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ResizeHandle } from "../src/ResizeHandle";
it("resizes by pointer movement, clamps bounds, restores selection, and supports keyboard/reset", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ResizeHandle
          orientation="vertical"
          label="Pane width"
          value={200}
          min={180}
          max={300}
          defaultValue={240}
          onChange={change}
        />,
      ),
    );
    const handle = host.firstElementChild as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    const pointer = (name: string, x: number) =>
      handle.dispatchEvent(
        new MouseEvent(name, { bubbles: true, clientX: x, button: 0 }),
      );
    await act(async () => {
      pointer("pointerdown", 100);
      pointer("pointermove", 160);
    });
    expect(change).toHaveBeenLastCalledWith(260);
    expect(document.body.style.userSelect).toBe("none");
    await act(async () => pointer("pointermove", 1000));
    expect(change).toHaveBeenLastCalledWith(300);
    await act(async () => pointer("pointerup", 1000));
    expect(document.body.style.userSelect).toBe("");
    await act(async () =>
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    );
    expect(change).toHaveBeenLastCalledWith(190);
    await act(async () =>
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(change).toHaveBeenLastCalledWith(240);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
