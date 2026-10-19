// ==UserScript==
// @name         Instagram Toolkit
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.19.1
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @description  Cleans up your old Instagram activity: removes your comments, likes, reposts, story replies and reviews from before a date you pick, slowly and only when you start it.
// @author       volkan.cicek
// @match        https://www.instagram.com/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes     true
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    defaultCutoff: "2018-12-31",
    uiTimeoutMs: 10000,
    uiStepMs: 300,
    listSettleMs: 3000,
    scrollPauseMs: 1500,
    scrollStableChecks: 3,
  };
  const SELECTORS = {
    panel: "#igtk-panel",
    button: '[role="button"], button',
    dialog: '[role="dialog"]',
    tab: 'a[role="tab"]',
    rowToggle: '[aria-label="Toggle checkbox"]',
  };
  const LABELS = {
    sortFilter: "Sort & Filter",
    oldestFirst: "Oldest to Newest",
    apply: "Apply",
    noResults: "No results",
    select: "Select",
    cancel: "Cancel",
  };
  const TYPES = [
    { key: "comments", path: "comments", label: "Comments" },
    { key: "likes", path: "likes", label: "Likes" },
    { key: "reposts", path: "reposts", label: "Reposts" },
    { key: "storyReplies", path: "story_replies", label: "Story replies" },
    { key: "reviews", path: "reviews", label: "Reviews" },
  ];
  const ACTIVITY_PATH = "/your_activity/interactions/";
  // Opening the panel from another page needs a full navigation, which drops the panel; this flag survives it so the panel reopens on arrival.
  const REOPEN_FLAG = "igtk-reopen-panel";
  const PANEL_CSS = `
    #igtk-panel { position: fixed; top: 16px; right: 16px; z-index: 2147483000; width: 320px; padding: 14px; border-radius: 10px; background: #1c1c1e; color: #f5f5f5; font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
    #igtk-panel h2 { margin: 0 0 10px; font-size: 15px; }
    #igtk-panel label { display: block; margin: 4px 0; }
    #igtk-panel input[type="date"] { margin-left: 6px; }
    #igtk-panel .igtk-buttons { display: flex; gap: 6px; margin: 10px 0; }
    #igtk-panel button { flex: 1; padding: 6px; border: 0; border-radius: 6px; background: #0095f6; color: #fff; cursor: pointer; }
    #igtk-panel button:disabled { background: #555; cursor: default; }
    #igtk-panel .igtk-close { position: absolute; top: 8px; right: 10px; flex: none; padding: 0 6px; background: none; color: #aaa; }
    #igtk-panel .igtk-status { white-space: pre-line; color: #ccc; }
  `;

  // The cleaner matches Instagram's English labels and its restriction warnings, so any other UI language could hide a warning it must stop on.
  const isEnglishUi = () => document.documentElement.lang.toLowerCase().startsWith("en");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(probe, timeoutMs = CONFIG.uiTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = probe();
      if (found) return found;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for the page (${probe.name || "condition"})`);
  }

  const buttonWithText = (root, text) =>
    [...root.querySelectorAll(SELECTORS.button)].find((el) => el.innerText.trim() === text);

  // Instagram's selects are controlled by React, which ignores a plain .value assignment; the native setter plus a bubbling change event is what it reacts to.
  const nativeSelectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  async function setSelect(select, value) {
    nativeSelectSetter.call(select, String(value));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(CONFIG.uiStepMs);
  }

  // The filter dialog has no labelled close button; Escape is what closes it.
  const closeDialog = (dialog) =>
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));

  const toLocalDate = (year, month, day) => new Date(Number(year), Number(month) - 1, Number(day));

  function validateCutoff(cutoff, earliest, today) {
    if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) return "Pick a valid date.";
    if (cutoff < earliest) return `The date is before your account existed (${earliest.toLocaleDateString()}).`;
    if (cutoff > today) return "The date is in the future.";
    return null;
  }

  async function openType(type) {
    const path = `${ACTIVITY_PATH}${type.path}`;
    if (location.pathname.replace(/\/$/, "") !== path) {
      const tab = await waitFor(() => document.querySelector(`${SELECTORS.tab}[href="${path}"]`));
      tab.click();
      await waitFor(() => location.pathname.replace(/\/$/, "") === path);
    }
    return waitFor(() => buttonWithText(document, LABELS.sortFilter));
  }

  // The dialog holds two Month/Day/Year triples: start first, end second. Start is left at its default, the account's creation date, so the filter covers everything up to the cutoff; oldest first means a run cut short by a cap has removed the oldest items.
  async function applyCutoff(type, cutoff) {
    (await openType(type)).click();
    const dialog = await waitFor(() =>
      [...document.querySelectorAll(SELECTORS.dialog)].find((el) => el.querySelectorAll("select").length === 6),
    );
    const selects = () => [...dialog.querySelectorAll("select")];
    const [startMonth, startDay, startYear] = selects().map((select) => select.value);
    const error = validateCutoff(cutoff, toLocalDate(startYear, startMonth, startDay), new Date());
    if (error) {
      closeDialog(dialog);
      throw new Error(error);
    }
    buttonWithText(dialog, LABELS.oldestFirst).click();
    await sleep(CONFIG.uiStepMs);
    await setSelect(selects()[5], cutoff.getFullYear());
    await setSelect(selects()[3], cutoff.getMonth() + 1);
    await setSelect(selects()[4], cutoff.getDate());
    // React re-renders the selects after each change, so the values are read back once they settle rather than straight away.
    const wanted = [cutoff.getMonth() + 1, cutoff.getDate(), cutoff.getFullYear()].join();
    await waitFor(
      () =>
        selects()
          .slice(3)
          .map((select) => Number(select.value))
          .join() === wanted,
      CONFIG.uiStepMs * 10,
    ).catch(() => {
      closeDialog(dialog);
      throw new Error("Instagram did not accept the cutoff date.");
    });
    // Apply stays disabled when the filter already matches, in which case the list is already the one wanted and only the dialog needs closing.
    const apply = buttonWithText(dialog, LABELS.apply);
    if (apply.getAttribute("aria-disabled") === "true") closeDialog(dialog);
    else apply.click();
    await waitFor(() => !document.contains(dialog));
    await sleep(CONFIG.listSettleMs);
  }

  const textElement = (text) =>
    [...document.querySelectorAll("span, div")].find(
      (el) => el.childElementCount === 0 && el.innerText?.trim() === text,
    );
  const rowToggles = () => [...document.querySelectorAll(SELECTORS.rowToggle)];
  const listIsEmpty = () => document.body.innerText.includes(LABELS.noResults);

  async function enterSelectMode() {
    if (textElement(LABELS.cancel)) return;
    (await waitFor(() => textElement(LABELS.select))).click();
    await waitFor(() => textElement(LABELS.cancel));
  }

  async function exitSelectMode() {
    textElement(LABELS.cancel)?.click();
    await waitFor(() => !textElement(LABELS.cancel));
  }

  function scrollableAncestor(el) {
    for (let node = el?.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
        return node;
      }
    }
    return null;
  }

  // The list lazy-loads as it scrolls, and reading a long list quickly is itself what Instagram treats as automation, so it scrolls at a walking pace until nothing new arrives.
  async function loadAllRows() {
    let seen = rowToggles().length;
    let unchanged = 0;
    while (unchanged < CONFIG.scrollStableChecks) {
      const scroller = scrollableAncestor(rowToggles().at(-1));
      if (!scroller) break;
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(CONFIG.scrollPauseMs);
      const now = rowToggles().length;
      unchanged = now === seen ? unchanged + 1 : 0;
      seen = now;
    }
    return seen;
  }

  async function countType(type, cutoff) {
    await applyCutoff(type, cutoff);
    if (listIsEmpty()) return 0;
    await enterSelectMode();
    const count = await loadAllRows();
    await exitSelectMode();
    return count;
  }

  async function countAll(types, cutoff, showStatus) {
    const counts = {};
    for (const type of types) {
      showStatus(`Counting ${type.label.toLowerCase()}…`);
      counts[type.key] = await countType(type, cutoff);
    }
    showStatus(
      `Before ${cutoff.toLocaleDateString()}:\n${types.map((type) => `${type.label}: ${counts[type.key]}`).join("\n")}`,
    );
    return counts;
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "igtk-panel";
    panel.innerHTML = `
      <style>${PANEL_CSS}</style>
      <button class="igtk-close" data-igtk="close" title="Close">✕</button>
      <h2>Clean up old activity</h2>
      <label>Remove everything on or before <input type="date" data-igtk="cutoff" value="${CONFIG.defaultCutoff}"></label>
      ${TYPES.map((type) => `<label><input type="checkbox" data-igtk-type="${type.key}" checked> ${type.label}</label>`).join("")}
      <div class="igtk-buttons">
        <button data-igtk="count">Count</button>
        <button data-igtk="start">Start</button>
        <button data-igtk="stop" disabled>Stop</button>
      </div>
      <div class="igtk-status" data-igtk="status"></div>
    `;
    panel.querySelector('[data-igtk="close"]').addEventListener("click", () => panel.remove());
    const control = (name) => panel.querySelector(`[data-igtk="${name}"]`);
    const showStatus = (text) => (control("status").textContent = text);
    const readCutoff = () =>
      toLocalDate(
        ...control("cutoff")
          .value.split("-")
          .map((part) => part.replace(/^0/, "")),
      );
    const readTypes = () => TYPES.filter((type) => panel.querySelector(`[data-igtk-type="${type.key}"]`).checked);
    control("count").addEventListener("click", async () => {
      control("count").disabled = true;
      control("start").disabled = true;
      try {
        await countAll(readTypes(), readCutoff(), showStatus);
      } catch (error) {
        showStatus(`Stopped: ${error.message}`);
      } finally {
        control("count").disabled = false;
        control("start").disabled = false;
      }
    });
    if (!isEnglishUi()) {
      panel.querySelector('[data-igtk="count"]').disabled = true;
      panel.querySelector('[data-igtk="start"]').disabled = true;
      panel.querySelector('[data-igtk="status"]').textContent = "Switch Instagram to English to use the cleaner.";
    }
    return panel;
  }

  function openPanel() {
    if (!location.pathname.startsWith(ACTIVITY_PATH)) {
      sessionStorage.setItem(REOPEN_FLAG, "1");
      location.assign(`${ACTIVITY_PATH}${TYPES[0].path}`);
      return;
    }
    if (document.querySelector(SELECTORS.panel)) return;
    document.body.append(buildPanel());
  }

  GM_registerMenuCommand("Clean up old activity…", openPanel);
  if (sessionStorage.getItem(REOPEN_FLAG) === "1" && location.pathname.startsWith(ACTIVITY_PATH)) {
    sessionStorage.removeItem(REOPEN_FLAG);
    openPanel();
  }
})();
