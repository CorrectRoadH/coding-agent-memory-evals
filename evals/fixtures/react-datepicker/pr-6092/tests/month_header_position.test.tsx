/**
 * @jest-environment jsdom
 */

import { fireEvent, render } from "@testing-library/react";
import React from "react";

import Calendar from "../calendar";
import { newDate, formatDate, addMonths } from "../date_utils";

const dateFormat = "MMMM yyyy";

const baseProps = {
  dateFormat,
  onClickOutside: () => {},
  onSelect: () => {},
  dropdownMode: "scroll" as const,
};

/**
 * These assertions describe where the month header ends up *relative to the day grid
 * it belongs to*, using only class names that already exist in this codebase
 * (`__current-month`, `__day-names`, `__month`, `__navigation--previous/next`,
 * `__header--custom`). Whatever element an implementation introduces to hold the
 * repositioned header is up to the implementation — only the resulting reading order
 * is part of the contract, because that is what a user of the library sees.
 */
function isBefore(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function panels(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      ".react-datepicker__month-container",
    ),
  );
}

function parts(panel: HTMLElement) {
  const monthLabel = panel.querySelector(".react-datepicker__current-month");
  const dayNames = panel.querySelector(".react-datepicker__day-names");
  const dayGrid = panel.querySelector(".react-datepicker__month");
  expect(monthLabel).not.toBeNull();
  expect(dayNames).not.toBeNull();
  expect(dayGrid).not.toBeNull();
  return { monthLabel: monthLabel!, dayNames: dayNames!, dayGrid: dayGrid! };
}

function expectHeaderAtTop(panel: HTMLElement) {
  const { monthLabel, dayNames } = parts(panel);
  expect(isBefore(monthLabel, dayNames)).toBe(true);
}

function expectHeaderInMiddle(panel: HTMLElement) {
  const { monthLabel, dayNames, dayGrid } = parts(panel);
  // after the weekday-name row, before the rows of days
  expect(isBefore(dayNames, monthLabel)).toBe(true);
  expect(isBefore(monthLabel, dayGrid)).toBe(true);
}

function expectHeaderAtBottom(panel: HTMLElement) {
  const { monthLabel, dayGrid } = parts(panel);
  // after the rows of days
  expect(isBefore(dayGrid, monthLabel)).toBe(true);
}

describe("monthHeaderPosition", () => {
  it("should render the month header above the day grid by default", () => {
    const { container } = render(<Calendar {...baseProps} />);

    const [panel] = panels(container);
    expectHeaderAtTop(panel!);
    expect(
      panel!.querySelector(".react-datepicker__current-month")?.textContent,
    ).toContain(formatDate(newDate(), dateFormat));
  });

  it("should render the month header above the day grid when monthHeaderPosition is 'top'", () => {
    const { container } = render(
      <Calendar {...baseProps} monthHeaderPosition="top" />,
    );

    expectHeaderAtTop(panels(container)[0]!);
  });

  it("should render the month header between the weekday names and the day rows when monthHeaderPosition is 'middle'", () => {
    const { container } = render(
      <Calendar {...baseProps} monthHeaderPosition="middle" />,
    );

    const [panel] = panels(container);
    expectHeaderInMiddle(panel!);
    expect(
      panel!.querySelector(".react-datepicker__current-month")?.textContent,
    ).toContain(formatDate(newDate(), dateFormat));
  });

  it("should render the month header below the day rows when monthHeaderPosition is 'bottom'", () => {
    const { container } = render(
      <Calendar {...baseProps} monthHeaderPosition="bottom" />,
    );

    const [panel] = panels(container);
    expectHeaderAtBottom(panel!);
    expect(
      panel!.querySelector(".react-datepicker__current-month")?.textContent,
    ).toContain(formatDate(newDate(), dateFormat));
  });

  it("should give every shown month its own header in its own panel with 'middle'", () => {
    const { container } = render(
      <Calendar {...baseProps} monthHeaderPosition="middle" monthsShown={2} />,
    );

    const shown = panels(container);
    expect(shown).toHaveLength(2);
    shown.forEach(expectHeaderInMiddle);

    expect(
      shown.map(
        (panel) =>
          panel.querySelector(".react-datepicker__current-month")?.textContent,
      ),
    ).toEqual([
      expect.stringContaining(formatDate(newDate(), dateFormat)),
      expect.stringContaining(formatDate(addMonths(newDate(), 1), dateFormat)),
    ]);
  });

  it("should give every shown month its own header in its own panel with 'bottom'", () => {
    const { container } = render(
      <Calendar {...baseProps} monthHeaderPosition="bottom" monthsShown={2} />,
    );

    const shown = panels(container);
    expect(shown).toHaveLength(2);
    shown.forEach(expectHeaderAtBottom);
  });

  it("should keep month navigation working when the header is repositioned", () => {
    const { container } = render(
      <Calendar {...baseProps} monthHeaderPosition="middle" />,
    );

    const panel = panels(container)[0]!;
    expectHeaderInMiddle(panel);

    const next = container.querySelector(
      ".react-datepicker__navigation--next",
    ) as HTMLElement | null;
    expect(next).not.toBeNull();
    fireEvent.click(next!);

    const afterNext = panels(container)[0]!;
    expect(
      afterNext.querySelector(".react-datepicker__current-month")?.textContent,
    ).toContain(formatDate(addMonths(newDate(), 1), dateFormat));
    // still in the requested position after navigating
    expectHeaderInMiddle(afterNext);
  });

  it("should keep month navigation disabled at the minDate/maxDate boundary when the header is repositioned", () => {
    const { container } = render(
      <Calendar
        {...baseProps}
        monthHeaderPosition="middle"
        minDate={newDate()}
        maxDate={newDate()}
        showDisabledMonthNavigation={false}
      />,
    );

    expectHeaderInMiddle(panels(container)[0]!);
    // both directions are out of range, so neither button may be offered
    expect(
      container.querySelector(".react-datepicker__navigation--previous"),
    ).toBeNull();
    expect(
      container.querySelector(".react-datepicker__navigation--next"),
    ).toBeNull();
  });

  it("should keep the month and year dropdowns available when the header is repositioned", () => {
    const { container } = render(
      <Calendar
        {...baseProps}
        monthHeaderPosition="middle"
        showMonthDropdown
        showYearDropdown
      />,
    );

    const panel = panels(container)[0]!;
    expectHeaderInMiddle(panel);

    const monthDropdown = panel.querySelector(
      ".react-datepicker__month-dropdown-container",
    );
    const yearDropdown = panel.querySelector(
      ".react-datepicker__year-dropdown-container",
    );
    expect(monthDropdown).not.toBeNull();
    expect(yearDropdown).not.toBeNull();

    // the dropdowns travel with the header rather than staying at the top
    const dayNames = panel.querySelector(".react-datepicker__day-names")!;
    expect(isBefore(dayNames, monthDropdown!)).toBe(true);
    expect(isBefore(dayNames, yearDropdown!)).toBe(true);
  });

  it("should render a custom header in the requested position", () => {
    const { container } = render(
      <Calendar
        {...baseProps}
        monthHeaderPosition="bottom"
        renderCustomHeader={() => <div>Custom Header</div>}
      />,
    );

    const panel = panels(container)[0]!;
    const customHeader = panel.querySelector(
      ".react-datepicker__header--custom",
    );
    expect(customHeader).not.toBeNull();
    expect(customHeader?.textContent).toContain("Custom Header");

    const dayGrid = panel.querySelector(".react-datepicker__month")!;
    expect(isBefore(dayGrid, customHeader!)).toBe(true);
  });
});
