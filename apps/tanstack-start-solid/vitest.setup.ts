import "@testing-library/jest-dom/vitest";

// jsdom does not implement HTMLFormElement.requestSubmit(), which is what
// testing-library's userEvent triggers when clicking a submit button.
// Polyfill it so form submissions work in unit tests.
if (
  typeof HTMLFormElement !== "undefined" &&
  !HTMLFormElement.prototype.requestSubmit
) {
  HTMLFormElement.prototype.requestSubmit = function (
    submitter?: HTMLElement | null,
  ) {
    this.submit();
  };
}
