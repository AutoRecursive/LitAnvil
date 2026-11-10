import { expect, it } from "vitest";
import { pdfTitle } from "../server/library";
it("uses meaningful PDF metadata and repairs numeric arXiv titles without treating authors as title text", () => {
  expect(pdfTitle("A Useful Paper", "body", "1234.56789")).toBe(
    "A Useful Paper",
  );
  const content =
    "Causal Forcing++: Scalable Few-Step Autoregressive Diffusion\nDistillation for Real-Time Interactive Video Generation\nMin Zhao1,2, Hongzhou Zhu1,2\nAbstract";
  expect(pdfTitle(undefined, content, "2605.15141")).toBe(
    "Causal Forcing++: Scalable Few-Step Autoregressive Diffusion Distillation for Real-Time Interactive Video Generation",
  );
  expect(
    pdfTitle("Untitled", "First sentence\nsecond sentence", "Personal notes"),
  ).toBe("Personal notes");
});
it("does not mistake a PDF license preamble for the paper title", () => {
  const license =
    "Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works.";
  const content =
    "Provided proper attribution is provided, Google hereby grants permission to\nreproduce the tables and figures in this paper solely for use in journalistic or\nscholarly works.\nAttention Is All You Need\nAshish Vaswani∗\nAbstract";
  expect(pdfTitle(license, content, "1706.03762")).toBe(
    "Attention Is All You Need",
  );
  expect(pdfTitle(undefined, content, license)).toBe(
    "Attention Is All You Need",
  );
});
