// ==UserScript==
// @name         Universal Tab Title Editor
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/universal-tab-title-editor.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/universal-tab-title-editor.user.js
// @description  Sets the tab title from the page heading on Gebze Technical University pages, so saved tab lists (e.g. OneTab) stay readable. Built so more sites can be added.
// @author       volkan.cicek
// @match        https://www.gtu.edu.tr/kategori/*
// @match        https://www.gtu.edu.tr/icerik/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  // A new site needs an entry here and a matching @match line above.
  const SITES = [
    {
      urlFragment: "www.gtu.edu.tr/",
      // GTU pages use different layouts; the first selector that yields text wins.
      headerSelectors: [
        "h1.font-semibold.text-xl.text-red-500",
        "h3.text-white.font-bold",
        "p.font-semibold.text-red-500",
      ],
      titleFormat: "Gebze Technical University - {{header}}",
    },
  ];
  const INITIAL_DELAY_MS = 1000;
  const MUTATION_DELAY_MS = 500;

  let lastAppliedHeader = "";

  function findHeaderText(selectors) {
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.innerText?.trim();
      if (text) return text;
    }
    return "";
  }

  function updateTitle() {
    const site = SITES.find(({ urlFragment }) => location.href.includes(urlFragment));
    if (!site) return;

    const header = findHeaderText(site.headerSelectors);
    // Comparing against the last header rather than document.title avoids rewriting the DOM on every mutation.
    if (!header || header === lastAppliedHeader) return;

    lastAppliedHeader = header;
    const title = site.titleFormat.replace("{{header}}", header);
    if (document.title !== title) document.title = title;
  }

  new MutationObserver(() => setTimeout(updateTitle, MUTATION_DELAY_MS)).observe(document.body, {
    childList: true,
    subtree: true,
  });
  setTimeout(updateTitle, INITIAL_DELAY_MS);
})();
