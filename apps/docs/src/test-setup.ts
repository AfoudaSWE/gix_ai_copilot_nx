// jsdom gaps used by the site: scrolling APIs and the async clipboard.
window.scrollTo = () => undefined;
Element.prototype.scrollIntoView = () => undefined;
