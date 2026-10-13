// ==UserScript==
// @name         Google Search Map Preview → Google Maps
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/google-map-preview-to-maps.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/google-map-preview-to-maps.user.js
// @description  Opens Google Maps when you click the map preview in search results
// @author       volkan.cicek
// @include      https://www.google.tld/search*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const OVERLAY_ATTRIBUTE = "data-maps-overlay";
  const SELECTORS = {
    mapsLinks: [
      'a.XaCzsb[href*="/maps?"]',
      'a[href^="https://www.google.com/maps?q="]',
      'a[href*="/maps/search/"]:not(.iwb-detected)',
    ],
    tileImages: 'img[src^="blob:"]',
    legacyMapImages: 'img.hoverZoomLink[src*="maps/vt"], img[src*="maps/vt"]',
  };
  const MAP_ATTRIBUTION = /Harita verileri|Map data|©\s?\d{4}/i;
  const CONFIG = {
    mutationDebounceMs: 250,
    cardMinWidth: 150,
    cardMaxWidth: 380,
    cardMinHeight: 100,
    cardMaxHeight: 420,
    tileMinSize: 200,
    overlayMinWidth: 120,
    overlayMinHeight: 80,
    samePositionTolerancePx: 5,
  };

  function buildMapsUrl() {
    for (const selector of SELECTORS.mapsLinks) {
      const link = document.querySelector(selector);
      if (link) return link.href || searchMapsUrl();
    }
    return searchMapsUrl();
  }

  function searchMapsUrl() {
    const query = new URLSearchParams(location.search).get("q") || "";
    return `${location.origin}/maps/search/${encodeURIComponent(query)}`;
  }

  const isCardSized = ({ width, height }) =>
    width > CONFIG.cardMinWidth &&
    width < CONFIG.cardMaxWidth &&
    height > CONFIG.cardMinHeight &&
    height < CONFIG.cardMaxHeight;

  // The map widget renders several parallel layers, so the card is the topmost card-sized ancestor carrying the map
  // attribution text: that one covers every layer.
  function findCardForTile(tile) {
    let card = null;
    for (let element = tile; element && element !== document.body; element = element.parentElement) {
      if (isCardSized(element.getBoundingClientRect()) && MAP_ATTRIBUTION.test(element.textContent || "")) {
        card = element;
      }
    }
    return card;
  }

  function findMapCards() {
    const cards = new Set();
    for (const tile of document.querySelectorAll(SELECTORS.tileImages)) {
      if (tile.width < CONFIG.tileMinSize || tile.height < CONFIG.tileMinSize) continue;
      const card = findCardForTile(tile);
      if (card) cards.add(card);
    }
    for (const image of document.querySelectorAll(SELECTORS.legacyMapImages)) {
      let card = image;
      for (let step = 0; step < 4 && card.parentElement; step++) card = card.parentElement;
      cards.add(card);
    }
    return cards;
  }

  function ensureOverlay(card, url) {
    // Google re-renders the card's inner DOM and drops the overlay, so its presence is checked every time.
    const existing = card.querySelector(`:scope > a[${OVERLAY_ATTRIBUTE}]`);
    if (existing) {
      if (existing.href !== url) existing.href = url;
      return;
    }
    if (getComputedStyle(card).position === "static") card.style.position = "relative";

    const overlay = document.createElement("a");
    overlay.href = url;
    overlay.title = "Open in Google Maps";
    overlay.target = "_blank";
    overlay.rel = "noopener";
    overlay.setAttribute(OVERLAY_ATTRIBUTE, "1");
    // The 44px gap on the right keeps the map's own "expand map" button clickable.
    overlay.style.cssText =
      "position:absolute;left:0;top:0;right:44px;bottom:0;z-index:99999;display:block;cursor:pointer;background:transparent;";
    card.appendChild(overlay);
  }

  function addOverlays() {
    const url = buildMapsUrl();
    const coveredPositions = [];
    for (const card of findMapCards()) {
      const rect = card.getBoundingClientRect();
      if (rect.width < CONFIG.overlayMinWidth || rect.height < CONFIG.overlayMinHeight) continue;
      const tolerance = CONFIG.samePositionTolerancePx;
      if (coveredPositions.some(({ x, y }) => Math.abs(x - rect.x) < tolerance && Math.abs(y - rect.y) < tolerance)) {
        continue;
      }
      coveredPositions.push({ x: rect.x, y: rect.y });
      ensureOverlay(card, url);
    }
  }

  addOverlays();

  let debounceTimer = 0;
  new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(addOverlays, CONFIG.mutationDebounceMs);
  }).observe(document.body, { childList: true, subtree: true });
})();
