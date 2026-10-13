// ==UserScript==
// @name         GitHub AVIF Inline Preview
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/github-avif-preview.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/github-avif-preview.user.js
// @description  Shows AVIF images inline in GitHub's file view, sized to fit the page instead of only offering a download.
// @author       volkan.cicek
// @match        https://github.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const PREVIEW_ID = "tm-avif-preview";
  const SELECTORS = {
    fileName: ["#file-name-id", "#sticky-file-name-id"],
    rawButton: 'a[data-testid="raw-button"]',
    anchor: [".BlobViewHeader-module__Box_1__jQZ88Uz", "#repos-sticky-header"],
  };
  const RENDER_DELAY_MS = 300;

  const firstMatch = (selectors) =>
    selectors.reduce((found, selector) => found || document.querySelector(selector), null);

  function isAvifFile() {
    const fileName = firstMatch(SELECTORS.fileName);
    return Boolean(fileName) && fileName.textContent.trim().toLowerCase().endsWith(".avif");
  }

  function buildPreview(rawUrl) {
    const preview = document.createElement("div");
    preview.id = PREVIEW_ID;
    preview.style.cssText = `
      margin: 16px auto;
      padding: 16px;
      max-width: 1000px;
      border: 1px solid var(--borderColor-default);
      border-radius: 6px;
      background: var(--bgColor-default);
      text-align: center;
    `;

    const label = document.createElement("div");
    label.textContent = "inline preview (avif)";
    label.style.cssText = `
      font-size: 11px;
      color: var(--fgColor-muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    `;

    const image = document.createElement("img");
    image.src = rawUrl;
    image.loading = "lazy";
    image.style.cssText = `
      max-width: min(100%, 900px);
      max-height: 70vh;
      width: 100%;
      height: auto;
      object-fit: contain;
      border-radius: 6px;
    `;

    preview.append(label, image);
    return preview;
  }

  function renderPreview() {
    if (!isAvifFile()) return;
    const rawUrl = document.querySelector(SELECTORS.rawButton)?.href;
    if (!rawUrl || document.getElementById(PREVIEW_ID)) return;
    firstMatch(SELECTORS.anchor)?.after(buildPreview(rawUrl));
  }

  // GitHub navigates as a SPA, so a URL change waits for the new view before rendering.
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) {
      renderPreview();
      return;
    }
    lastUrl = location.href;
    setTimeout(renderPreview, RENDER_DELAY_MS);
  }).observe(document.body, { childList: true, subtree: true });

  setTimeout(renderPreview, RENDER_DELAY_MS);
})();
