// @vitest-environment jsdom
import { expect, it } from "vitest";
import { currentPdfPage, scrollReaderTo } from "../src/reader-position";
it("reports the most visible page when the previous page remains partly visible", () => {
  const reader = document.createElement("article");
  reader.innerHTML =
    '<section class="pdf-page" data-page="1"></section><section class="pdf-page" data-page="2"><span>match</span></section>';
  const rect = (top: number, bottom: number) =>
    ({ top, bottom, height: bottom - top }) as DOMRect;
  reader.getBoundingClientRect = () => rect(100, 600);
  const pages = reader.querySelectorAll<HTMLElement>(".pdf-page");
  pages[0].getBoundingClientRect = () => rect(0, 200);
  pages[1].getBoundingClientRect = () => rect(214, 814);
  expect(currentPdfPage(reader)?.dataset.page).toBe("2");
  const span = reader.querySelector("span")!;
  span.getBoundingClientRect = () => rect(300, 312);
  Object.defineProperty(reader, "clientHeight", { value: 500 });
  reader.scrollTop = 800;
  scrollReaderTo(reader, span, true);
  expect(reader.scrollTop).toBe(914);
});
