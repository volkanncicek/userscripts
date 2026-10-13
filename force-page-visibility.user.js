// ==UserScript==
// @name         Force Page Visibility
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/force-page-visibility.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/force-page-visibility.user.js
// @description  Makes chosen sites believe their tab is always visible, so they keep working in the background. Turn it on per site from the Tampermonkey menu.
// @author       volkan.cicek
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @noframes     true
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "enabledHosts";
  const host = location.hostname;
  const enabledHosts = GM_getValue(STORAGE_KEY, []);
  const enabled = enabledHosts.includes(host);

  // The override has to land before the page's own code reads visibility, so a change takes a reload.
  GM_registerMenuCommand(
    enabled ? `Stop forcing visibility on ${host}` : `Keep ${host} visible in the background`,
    () => {
      GM_setValue(STORAGE_KEY, enabled ? enabledHosts.filter((h) => h !== host) : [...enabledHosts, host]);
      location.reload();
    },
  );

  if (!enabled) return;

  // The page reads these from its own document, which only unsafeWindow reaches once GM APIs are granted.
  const pageDocument = unsafeWindow.document;
  Object.defineProperty(pageDocument, "hidden", { value: false });
  Object.defineProperty(pageDocument, "visibilityState", { value: "visible" });
  pageDocument.dispatchEvent(new Event("visibilitychange"));
})();
