// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Dialog } from "../src/Dialog";
it("focuses the input, traps Tab, handles Escape cancellation and restores the opener", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const opener = document.createElement("button");
  opener.textContent = "open";
  document.body.append(opener);
  opener.focus();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  const visible = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as any);
  try {
    await act(async () =>
      root.render(
        <Dialog title="Settings" onClose={close}>
          <input aria-label="Path" />
          <button>Save</button>
        </Dialog>,
      ),
    );
    const input = host.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    const buttons = host.querySelectorAll("button");
    buttons[1].focus();
    await act(async () =>
      buttons[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () =>
      buttons[0].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(buttons[1]);
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    await act(async () => host.querySelector("dialog")!.dispatchEvent(cancel));
    expect(close).toHaveBeenCalledTimes(1);
    expect(cancel.defaultPrevented).toBe(true);
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
  } finally {
    visible.mockRestore();
    host.remove();
    opener.remove();
  }
});
