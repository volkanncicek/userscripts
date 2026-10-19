// ==UserScript==
// @name         Instagram Toolkit
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.19.3
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @description  Cleans up your old Instagram activity: removes your comments, likes, reposts, story replies and reviews from before a date you pick, slowly and only when you start it.
// @author       volkan.cicek
// @match        https://www.instagram.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
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
    scrollPauseMs: 2000,
    loadTimeoutMs: 600000,
    scrollStableChecks: 3,
    selectStepMs: 400,
    confirmTimeoutMs: 20000,
    batchSize: 20,
    batchPauseMs: 20000,
    pauseJitter: 0.15,
    longPauseEveryBatches: 10,
    longPauseMinMs: 180000,
    longPauseMaxMs: 300000,
    runCap: 300,
    dailyCap: 1000,
  };
  const SELECTORS = {
    panel: "#igtk-panel",
    button: '[role="button"], button',
    dialog: '[role="dialog"]',
    tab: 'a[role="tab"]',
    rowToggle: '[aria-label="Toggle checkbox"]',
    loading: '[role="progressbar"]',
  };
  const LABELS = {
    sortFilter: "Sort & Filter",
    oldestFirst: "Oldest to Newest",
    apply: "Apply",
    noResults: "No results",
    select: "Select",
    cancel: "Cancel",
    reset: "Reset",
  };
  // `action` is the bottom-bar button and its confirmation button; `done` is the toast Instagram shows once the items are gone. Likes were measured live; the other types assume Instagram's "Delete" wording, and a missing button or toast stops the run rather than guessing.
  const TYPES = [
    { key: "comments", path: "comments", label: "Comments", action: "Delete", done: /^You deleted (\d+)/ },
    { key: "likes", path: "likes", label: "Likes", action: "Unlike", done: /^You unliked (\d+)/ },
    { key: "reposts", path: "reposts", label: "Reposts", action: "Delete", done: /^You deleted (\d+)/ },
    {
      key: "storyReplies",
      path: "story_replies",
      label: "Story replies",
      action: "Delete",
      done: /^You deleted (\d+)/,
    },
    { key: "reviews", path: "reviews", label: "Reviews", action: "Delete", done: /^You deleted (\d+)/ },
  ];
  // Counts what was removed today across runs so a second run the same day respects the daily cap; it is never used to resume a run.
  const DAILY_KEY = "dailyDeleted";
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
      // The previous tab's toolbar lingers for a moment after the URL changes, so wait for the new tab to be selected and its list to settle before using the toolbar.
      await waitFor(
        () => location.pathname.replace(/\/$/, "") === path && tab.getAttribute("aria-selected") === "true",
      );
      await sleep(CONFIG.listSettleMs);
    }
    return waitFor(() => buttonWithText(document, LABELS.sortFilter));
  }

  const textElement = (text, root = document) =>
    [...root.querySelectorAll("span, div")].find((el) => el.childElementCount === 0 && el.innerText?.trim() === text);

  // The dialog holds two Month/Day/Year triples, start then end. Reset restores the widest range (the account's creation date to today) without applying it, so starting from it every date that is set is valid and the creation date can be read.
  async function openResetFilterDialog(type) {
    (await openType(type)).click();
    const dialog = await waitFor(() =>
      [...document.querySelectorAll(SELECTORS.dialog)].find((el) => el.querySelectorAll("select").length === 6),
    );
    (await waitFor(() => textElement(LABELS.reset, dialog))).click();
    await sleep(CONFIG.uiStepMs);
    return dialog;
  }

  const datesIn = (dialog) => {
    const values = [...dialog.querySelectorAll("select")].map((select) => select.value);
    return [toLocalDate(values[2], values[0], values[1]), toLocalDate(values[5], values[3], values[4])];
  };

  async function accountStartDate(type) {
    const dialog = await openResetFilterDialog(type);
    const [start] = datesIn(dialog);
    closeDialog(dialog);
    await waitFor(() => !document.contains(dialog));
    return start;
  }

  // One calendar year at a time, oldest first: a single year keeps the list short enough to load completely, and a run cut short by a cap has always removed the oldest items.
  function yearRanges(accountStart, cutoff) {
    const ranges = [];
    for (let year = accountStart.getFullYear(); year <= cutoff.getFullYear(); year++) {
      ranges.push({
        year,
        start: year === accountStart.getFullYear() ? accountStart : new Date(year, 0, 1),
        end: year === cutoff.getFullYear() ? cutoff : new Date(year, 11, 31),
      });
    }
    return ranges;
  }

  async function setDate(selects, offset, date) {
    await setSelect(selects()[offset + 2], date.getFullYear());
    await setSelect(selects()[offset], date.getMonth() + 1);
    await setSelect(selects()[offset + 1], date.getDate());
  }

  async function applyRange(type, start, end) {
    const dialog = await openResetFilterDialog(type);
    const selects = () => [...dialog.querySelectorAll("select")];
    buttonWithText(dialog, LABELS.oldestFirst).click();
    await sleep(CONFIG.uiStepMs);
    await setDate(selects, 0, start);
    await setDate(selects, 3, end);
    // React re-renders the selects after each change, so the values are read back once they settle rather than straight away.
    const wanted = [start, end].map((date) => date.toDateString()).join();
    await waitFor(
      () =>
        datesIn(dialog)
          .map((date) => date.toDateString())
          .join() === wanted,
      CONFIG.uiStepMs * 10,
    ).catch(() => {
      closeDialog(dialog);
      throw new Error(`Instagram did not accept the range ${start.toLocaleDateString()}–${end.toLocaleDateString()}.`);
    });
    // Apply stays disabled when the filter already matches, in which case the list is already the one wanted and only the dialog needs closing.
    const apply = buttonWithText(dialog, LABELS.apply);
    if (apply.getAttribute("aria-disabled") === "true") closeDialog(dialog);
    else apply.click();
    await waitFor(() => !document.contains(dialog));
    await sleep(CONFIG.listSettleMs);
  }
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

  // The list lazy-loads slowly while a progress bar shows; stopping when the count merely paused undercounted a year several times over, so it is done only once the bar is gone and the count has held. Reading a long list quickly is itself what Instagram treats as automation, hence the walking pace.
  async function loadAllRows() {
    const deadline = Date.now() + CONFIG.loadTimeoutMs;
    let seen = -1;
    let quiet = 0;
    while (quiet < CONFIG.scrollStableChecks) {
      if (Date.now() > deadline) throw new Error("The list did not finish loading, so nothing was counted.");
      scrollableAncestor(rowToggles().at(-1))?.scrollTo(0, Number.MAX_SAFE_INTEGER);
      await sleep(CONFIG.scrollPauseMs);
      const now = rowToggles().length;
      const loading = Boolean(document.querySelector(SELECTORS.loading));
      quiet = !loading && now === seen ? quiet + 1 : 0;
      seen = now;
    }
    return seen;
  }

  async function countRange(type, range) {
    await applyRange(type, range.start, range.end);
    if (listIsEmpty()) return 0;
    await enterSelectMode();
    const count = await loadAllRows();
    await exitSelectMode();
    return count;
  }

  async function countAll(types, cutoff, showStatus) {
    const ranges = yearRanges(await checkedAccountStart(types[0], cutoff), cutoff);
    const lines = [];
    for (const type of types) {
      const perYear = [];
      for (const range of ranges) {
        showStatus(`Counting ${type.label.toLowerCase()} from ${range.year}…`);
        const count = await countRange(type, range);
        if (count) perYear.push(`${range.year}: ${count}`);
      }
      lines.push(`${type.label}: ${perYear.join(", ") || "none"}`);
    }
    showStatus(`On or before ${cutoff.toLocaleDateString()}:\n${lines.join("\n")}`);
  }

  async function checkedAccountStart(type, cutoff) {
    const accountStart = await accountStartDate(type);
    const error = validateCutoff(cutoff, accountStart, new Date());
    if (error) throw new Error(error);
    return accountStart;
  }

  const localDay = () => new Date().toLocaleDateString("sv");

  function dailyState() {
    const saved = GM_getValue(DAILY_KEY, null);
    return saved?.date === localDay() ? saved : { date: localDay(), count: 0 };
  }

  const remainingDailyAllowance = () => Math.max(0, CONFIG.dailyCap - dailyState().count);

  function recordDeleted(count) {
    const state = dailyState();
    GM_setValue(DAILY_KEY, { date: state.date, count: state.count + count });
  }

  function pause(ms) {
    return sleep(ms * (1 + (Math.random() * 2 - 1) * CONFIG.pauseJitter));
  }

  function textsMatching(regex) {
    return [...document.querySelectorAll("span, div")].filter(
      (el) => el.childElementCount === 0 && regex.test(el.innerText?.trim() ?? ""),
    );
  }

  // Rows are always taken from the top of the oldest-first list, never from wherever the list happens to be scrolled, so a batch is always the oldest items left.
  async function deleteBatch(type, size) {
    await enterSelectMode();
    for (let index = 0; index < size; index++) {
      const toggle = rowToggles()[index];
      if (!toggle) break;
      toggle.click();
      await sleep(CONFIG.selectStepMs);
    }
    const selected = Number(textsMatching(/^\d+ selected$/)[0]?.innerText.match(/\d+/)[0] ?? 0);
    if (selected === 0) {
      await exitSelectMode();
      return { selected: 0, removed: 0 };
    }
    const earlierToasts = new Set(textsMatching(type.done));
    (await waitFor(() => textElement(type.action))).click();
    const confirm = await waitFor(() =>
      [...document.querySelectorAll(SELECTORS.dialog)]
        .map((dialog) => buttonWithText(dialog, type.action))
        .find(Boolean),
    );
    confirm.click();
    const toast = await waitFor(
      () => textsMatching(type.done).find((el) => !earlierToasts.has(el)),
      CONFIG.confirmTimeoutMs,
    );
    await waitFor(() => !textElement(LABELS.cancel));
    await sleep(CONFIG.listSettleMs);
    return { selected, removed: Number(toast.innerText.match(type.done)[1]) };
  }

  // The year's range is re-applied before every batch: Instagram reloads the list after each deletion, and a filter lost in that reload would put newer items at the top of the list.
  async function runType(type, ranges, budget, showStatus) {
    let deleted = 0;
    let batches = 0;
    for (const range of ranges) {
      while (deleted < budget) {
        await applyRange(type, range.start, range.end);
        if (listIsEmpty()) break;
        const size = Math.min(CONFIG.batchSize, budget - deleted);
        const { selected, removed } = await deleteBatch(type, size);
        recordDeleted(removed);
        deleted += removed;
        showStatus(`${type.label} from ${range.year}: ${deleted} removed so far…`);
        if (removed < selected) return { deleted, stoppedBy: `Instagram removed ${removed} of ${selected} selected` };
        batches += 1;
        if (deleted >= budget) break;
        if (batches % CONFIG.longPauseEveryBatches === 0) {
          await sleep(CONFIG.longPauseMinMs + Math.random() * (CONFIG.longPauseMaxMs - CONFIG.longPauseMinMs));
        } else {
          await pause(CONFIG.batchPauseMs);
        }
        if (selected < size) break;
      }
    }
    return { deleted, stoppedBy: null };
  }

  async function runAll(types, cutoff, showStatus) {
    const ranges = yearRanges(await checkedAccountStart(types[0], cutoff), cutoff);
    let budget = Math.min(CONFIG.runCap, remainingDailyAllowance());
    const results = {};
    for (const type of types) {
      if (budget === 0) break;
      results[type.key] = await runType(type, ranges, budget, showStatus);
      budget -= results[type.key].deleted;
      if (results[type.key].stoppedBy) break;
    }
    showStatus(
      types
        .filter((type) => results[type.key])
        .map((type) => `${type.label}: ${results[type.key].deleted} removed`)
        .join("\n"),
    );
    return results;
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
    control("start").addEventListener("click", async () => {
      control("count").disabled = true;
      control("start").disabled = true;
      try {
        await runAll(readTypes(), readCutoff(), showStatus);
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
