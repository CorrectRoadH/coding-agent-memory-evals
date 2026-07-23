import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";

import { expectCurrentImageToBe, lightbox } from "./test-utils.js";
import { Inline } from "../../src/plugins/index.js";

const slides = [{ src: "image1" }, { src: "image2" }, { src: "image3" }];

function getContainer() {
  return document.querySelector(".yarl__container") as HTMLElement;
}

function pressArrowLeft() {
  act(() => {
    fireEvent.keyDown(getContainer(), { key: "ArrowLeft" });
  });
  act(vi.runAllTimers);
}

function pressArrowRight() {
  act(() => {
    fireEvent.keyDown(getContainer(), { key: "ArrowRight" });
  });
  act(vi.runAllTimers);
}

function renderLightbox(props?: Parameters<typeof lightbox>[0]) {
  return render(lightbox({ slides, carousel: { finite: true }, ...props }));
}

function renderInlineLightbox(props?: Parameters<typeof lightbox>[0]) {
  return renderLightbox({ plugins: [Inline], ...props });
}

/**
 * Mock getComputedStyle to return "rtl" direction for elements that have
 * a `dir="rtl"` ancestor, since jsdom doesn't support CSS direction inheritance.
 */
function mockComputedStyleRTL() {
  const original = window.getComputedStyle;
  return vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElt) => {
    const result = original(element, pseudoElt);
    if (element instanceof HTMLElement && element.closest("[dir='rtl']")) {
      return new Proxy(result, {
        get(target, prop) {
          if (prop === "direction") return "rtl";
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    return result;
  });
}

function testLTRKeyboardNavigation() {
  it("ArrowRight navigates to the next slide", () => {
    expectCurrentImageToBe("image2");

    pressArrowRight();
    expectCurrentImageToBe("image3");
  });

  it("ArrowLeft navigates to the previous slide", () => {
    expectCurrentImageToBe("image2");

    pressArrowLeft();
    expectCurrentImageToBe("image1");
  });
}

function testRTLKeyboardNavigation() {
  it("ArrowLeft navigates to the next slide", () => {
    expectCurrentImageToBe("image2");

    pressArrowLeft();
    expectCurrentImageToBe("image3");
  });

  it("ArrowRight navigates to the previous slide", () => {
    expectCurrentImageToBe("image2");

    pressArrowRight();
    expectCurrentImageToBe("image1");
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

describe("RTL", () => {
  describe("LTR (default)", () => {
    beforeEach(() => {
      renderLightbox({ index: 1 });
    });

    testLTRKeyboardNavigation();
  });

  describe("html dir attribute", () => {
    beforeEach(() => {
      document.documentElement.setAttribute("dir", "rtl");
      const spy = mockComputedStyleRTL();

      renderLightbox({ index: 1 });

      return () => {
        document.documentElement.removeAttribute("dir");
        spy.mockRestore();
      };
    });

    testRTLKeyboardNavigation();
  });

  describe("inline dir attribute", () => {
    beforeEach(() => {
      renderInlineLightbox({ inline: { dir: "rtl" }, index: 1 });
    });

    testRTLKeyboardNavigation();
  });

  describe("inline with RTL ancestor", () => {
    beforeEach(() => {
      const spy = mockComputedStyleRTL();

      render(
        React.createElement(
          "div",
          { dir: "rtl" },
          lightbox({ slides, carousel: { finite: true }, plugins: [Inline], index: 1 }),
        ),
      );
      return () => spy.mockRestore();
    });

    testRTLKeyboardNavigation();
  });

  describe("dir changes after mount", () => {
    // These assert observable keyboard behaviour only. Any mechanism that makes the
    // lightbox pick up the current direction is fine; the awaited act() below gives
    // asynchronous mechanisms (observers, microtask-deferred updates) a chance to
    // settle before the assertion, so this does not lock in one implementation.
    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
      });
    };

    it("switches to RTL navigation when dir changes from ltr to rtl", async () => {
      const spy = mockComputedStyleRTL();

      const { rerender } = renderInlineLightbox({ inline: { dir: "ltr" }, index: 1 });

      // LTR: ArrowLeft goes to the previous slide
      expectCurrentImageToBe("image2");
      pressArrowLeft();
      expectCurrentImageToBe("image1");

      // back to the middle slide, so the next assertion is not decided by a carousel boundary
      pressArrowRight();
      expectCurrentImageToBe("image2");

      rerender(lightbox({ slides, carousel: { finite: true }, plugins: [Inline], inline: { dir: "rtl" }, index: 1 }));
      await flush();

      // RTL: the same key must now go to the NEXT slide
      pressArrowLeft();
      expectCurrentImageToBe("image3");

      spy.mockRestore();
    });

    it("switches back to LTR navigation when dir changes from rtl to ltr", async () => {
      const spy = mockComputedStyleRTL();

      const { rerender } = renderInlineLightbox({ inline: { dir: "rtl" }, index: 1 });

      // RTL: ArrowLeft goes to the next slide
      expectCurrentImageToBe("image2");
      pressArrowLeft();
      expectCurrentImageToBe("image3");

      // back to the middle slide
      pressArrowRight();
      expectCurrentImageToBe("image2");

      rerender(lightbox({ slides, carousel: { finite: true }, plugins: [Inline], inline: { dir: "ltr" }, index: 1 }));
      await flush();

      // LTR: the same key must now go back to the PREVIOUS slide
      pressArrowLeft();
      expectCurrentImageToBe("image1");

      spy.mockRestore();
    });
  });

  describe("portal container dir attribute", () => {
    beforeEach(() => {
      renderLightbox({ portal: { container: { dir: "rtl" } }, index: 1 });
    });

    testRTLKeyboardNavigation();
  });
});
