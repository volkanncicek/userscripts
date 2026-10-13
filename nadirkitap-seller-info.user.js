// ==UserScript==
// @name         Nadirkitap Seller Info Extender
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/nadirkitap-seller-info.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/nadirkitap-seller-info.user.js
// @description  Shows extra seller info on Nadirkitap.com search, product, basket and seller pages, such as the seller's city and a Google search link.
// @author       volkan.cicek
// @match        https://www.nadirkitap.com/kitapara_sonuc.php*
// @match        https://www.nadirkitap.com/*-kitap*.html
// @match        https://www.nadirkitap.com/*-dergi*.html
// @match        https://www.nadirkitap.com/sepet.php*
// @match        https://www.nadirkitap.com/sahaf-detay.php*
// @match        https://www.nadirkitap.com/*-sahaf*.html
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const UNKNOWN_CITY = "Unknown";
  const SELECTORS = {
    // The seller page shows the city in the <small> that carries the location pin icon.
    sellerPageCity: "small:has(> i.fa-location-dot)",
    searchResults: ".productsListHover",
    searchSellerLink: "a.sellerName",
    detailSellerLink: "h6.mb-1 > a",
    basketSellerHeaders: ".text-body-in-cart",
    basketSellerLink: "a.nadir-color",
    sellerName: "h4.mb-0.text-truncate",
  };
  const STYLE = `
    .city-info { font-weight: bold; color: #931818; margin-left: 5px; font-size: 0.95em; }
    .google-search-link { font-size: 0.9em; font-weight: normal; margin-left: 8px; color: #4285F4; text-decoration: none; }
    .google-search-link:hover { text-decoration: underline; }
    .city-info.loading { color: #999; }
    .city-info.error { color: #ff0000; }
  `;

  const cityBySellerUrl = new Map();

  async function fetchSellerCity(sellerUrl) {
    if (cityBySellerUrl.has(sellerUrl)) return cityBySellerUrl.get(sellerUrl);
    const response = await fetch(sellerUrl);
    if (!response.ok) throw new Error(`Seller page returned ${response.status}`);
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const city = page.querySelector(SELECTORS.sellerPageCity)?.textContent.trim();
    if (!city) return UNKNOWN_CITY;
    cityBySellerUrl.set(sellerUrl, city);
    return city;
  }

  function createGoogleSearchLink(sellerName, city) {
    if (!sellerName || !city || city === UNKNOWN_CITY) return null;
    const link = document.createElement("a");
    link.href = `https://www.google.com/search?q=${encodeURIComponent(`"${sellerName}" ${city}`)}`;
    link.textContent = "[Search Google]";
    link.className = "google-search-link";
    link.target = "_blank";
    link.title = `Search Google for seller '${sellerName}'`;
    return link;
  }

  // The leading space separates the city from the seller name on the product page; the search list has none.
  async function showSellerCity(sellerLink, separator) {
    const container = sellerLink.parentElement;
    if (!container) return;
    const sellerName = sellerLink.textContent.trim();
    const citySpan = document.createElement("span");
    citySpan.textContent = `${separator}[...]`;
    citySpan.className = "city-info loading";
    container.appendChild(citySpan);
    try {
      const city = await fetchSellerCity(sellerLink.href);
      citySpan.textContent = `${separator}[${city}]`;
      citySpan.classList.remove("loading");
      const searchLink = createGoogleSearchLink(sellerName, city);
      if (searchLink) container.appendChild(searchLink);
    } catch {
      citySpan.textContent = `${separator}[Error]`;
      citySpan.classList.add("error");
    }
  }

  function handleSearchPage() {
    for (const result of document.querySelectorAll(SELECTORS.searchResults)) {
      const sellerLink = result.querySelector(SELECTORS.searchSellerLink);
      if (sellerLink) showSellerCity(sellerLink, "");
    }
  }

  function handleDetailPage() {
    const sellerLink = document.querySelector(SELECTORS.detailSellerLink);
    if (sellerLink) showSellerCity(sellerLink, " ");
  }

  // The basket already shows "<seller> / <city>", so no request is needed.
  function handleBasketPage() {
    for (const header of document.querySelectorAll(SELECTORS.basketSellerHeaders)) {
      const sellerLink = header.querySelector(SELECTORS.basketSellerLink);
      if (!sellerLink) continue;
      const parts = sellerLink.textContent.trim().split(" / ");
      if (parts.length !== 2) continue;
      const [sellerName, city] = parts.map((part) => part.trim());
      const searchLink = createGoogleSearchLink(sellerName, city);
      if (searchLink) sellerLink.insertAdjacentElement("afterend", searchLink);
    }
  }

  function handleSellerPage() {
    const sellerNameElement = document.querySelector(SELECTORS.sellerName);
    const cityElement = document.querySelector(SELECTORS.sellerPageCity);
    if (!sellerNameElement || !cityElement) return;

    const searchLink = createGoogleSearchLink(sellerNameElement.textContent.trim(), cityElement.textContent.trim());
    if (searchLink) cityElement.after(document.createTextNode(" "), searchLink);
  }

  GM_addStyle(STYLE);

  const url = location.href;
  if (url.includes("kitapara_sonuc.php")) handleSearchPage();
  else if (url.includes("-kitap") || url.includes("-dergi")) handleDetailPage();
  else if (url.includes("sepet.php")) handleBasketPage();
  else if (url.includes("sahaf-detay.php") || url.includes("-sahaf")) handleSellerPage();
})();
