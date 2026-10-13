// ==UserScript==
// @name         Bitwarden Icon Enabler (e-Devlet & GTU)
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.13.1
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/bitwarden-icon-enabler.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/bitwarden-icon-enabler.user.js
// @description  Makes the Bitwarden icon appear by changing the attributes of the real login fields.
// @author       volkan.cicek
// @match        https://giris.turkiye.gov.tr/Giris/*
// @match        https://obs.gtu.edu.tr/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  // e-Devlet in particular resets the fields after load, so they are corrected again on every tick.
  const CHECK_INTERVAL_MS = 1000;

  const SITE_FIELDS = [
    { urlPart: "turkiye.gov.tr", usernameId: "tridField", passwordId: "egpField" },
    { urlPart: "gtu.edu.tr", usernameId: "txtParamT01", passwordId: "txtParamT02" },
  ];

  const unblockField = (field) => {
    field.removeAttribute("readonly");
    field.removeAttribute("disabled");
  };

  const prepareUsernameField = (id) => {
    const field = document.getElementById(id);
    if (!field) return;
    // Bitwarden shows no icon on a number field.
    if (field.getAttribute("type") !== "text") field.setAttribute("type", "text");
    field.setAttribute("autocomplete", "username");
    field.setAttribute("data-bwautofill", "true");
    unblockField(field);
  };

  const preparePasswordField = (id) => {
    const field = document.getElementById(id);
    if (!field) return;
    field.setAttribute("autocomplete", "current-password");
    unblockField(field);
  };

  const site = SITE_FIELDS.find(({ urlPart }) => window.location.href.includes(urlPart));
  if (!site) return;

  setInterval(() => {
    prepareUsernameField(site.usernameId);
    preparePasswordField(site.passwordId);
  }, CHECK_INTERVAL_MS);
})();
