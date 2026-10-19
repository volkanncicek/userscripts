// ==UserScript==
// @name         Instagram Toolkit
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.19.7
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @description  Cleans up your old Instagram activity: removes your comments, likes, reposts, story replies and reviews from before a date you pick, slowly and only when you start it.
// @author       volkan.cicek
// @match        https://www.instagram.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
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
    watchIntervalMs: 500,
    maxAncestorSteps: 6,
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
    notice: '[role="dialog"], [role="alert"]',
    main: 'main, [role="main"]',
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
  // Instagram's own wording when it limits activity, plus a lost session; any of these stops a run at once.
  const RESTRICTION_TEXT =
    /try again later|we restrict certain activity|we limit how often|something went wrong|log in/i;
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

  let stopReason = null;
  let running = false;
  // The tab a run is working on; another activity tab has another filter, so landing there is as much a reason to stop as leaving.
  let activePath = null;
  const requestStop = (reason) => {
    stopReason ??= reason;
  };
  const currentPath = () => location.pathname.replace(/\/$/, "");

  // Every wait goes through here, so a stop, a restriction or leaving the page takes effect before the next click rather than after the batch.
  function checkStop() {
    if (!location.pathname.startsWith(ACTIVITY_PATH)) requestStop("You left the activity page.");
    else if (activePath && currentPath() !== activePath) requestStop("The page switched to another tab.");
    if (stopReason) throw new Error(stopReason);
  }

  async function waitEvenIfStopped(probe, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = probe();
      if (found) return found;
      await sleep(150);
    }
    return null;
  }

  async function waitFor(probe, timeoutMs = CONFIG.uiTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      checkStop();
      const found = probe();
      if (found) return found;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for the page (${probe.name || "condition"})`);
  }

  async function pause(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      checkStop();
      await sleep(Math.min(500, until - Date.now()));
    }
  }

  const jittered = (ms) => ms * (1 + (Math.random() * 2 - 1) * CONFIG.pauseJitter);

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

  function validateCutoff(cutoff, today) {
    if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) return "Pick a valid date.";
    if (cutoff > today) return "The date is in the future.";
    return null;
  }

  async function openType(type) {
    const path = `${ACTIVITY_PATH}${type.path}`;
    if (currentPath() !== path) {
      activePath = null;
      const tab = await waitFor(() => document.querySelector(`${SELECTORS.tab}[href="${path}"]`));
      tab.click();
      // The previous tab's toolbar lingers for a moment after the URL changes, so wait for the new tab to be selected and its list to settle before using the toolbar.
      await waitFor(() => currentPath() === path && tab.getAttribute("aria-selected") === "true");
      await sleep(CONFIG.listSettleMs);
    }
    activePath = path;
    return waitFor(() => buttonWithText(document, LABELS.sortFilter));
  }

  const textElement = (text, root = document) =>
    [...root.querySelectorAll("span, div")].find((el) => el.childElementCount === 0 && el.innerText?.trim() === text);

  // The dialog holds two Month/Day/Year triples, start then end. Reset restores the widest range (the account's creation date to today) without applying it, so starting from it every date that is set is valid and the creation date can be read; it is only offered once a filter differs from that default, which is the state a fresh page starts in.
  async function openResetFilterDialog(type) {
    (await openType(type)).click();
    const dialog = await waitFor(() =>
      [...document.querySelectorAll(SELECTORS.dialog)].find((el) => el.querySelectorAll("select").length === 6),
    );
    const reset = textElement(LABELS.reset, dialog);
    if (reset) {
      reset.click();
      await sleep(CONFIG.uiStepMs);
    }
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

  // One calendar year at a time, oldest first: a single year keeps the list short enough to load completely, and a run cut short by a cap has always removed the oldest items. The filter stops a day short of the cutoff because it is unknown whether Instagram reads its end date in local time or UTC; a day's margin keeps every removed item on or before the cutoff in either reading, at the price of leaving the cutoff day itself for a later run.
  function yearRanges(accountStart, cutoff) {
    const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() - 1);
    const ranges = [];
    for (let year = accountStart.getFullYear(); year <= lastDay.getFullYear(); year++) {
      ranges.push({
        year,
        start: year === accountStart.getFullYear() ? accountStart : new Date(year, 0, 1),
        end: year === lastDay.getFullYear() ? lastDay : new Date(year, 11, 31),
      });
    }
    return ranges.filter((range) => range.start <= range.end);
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
    if (apply.getAttribute("aria-disabled") === "true") {
      closeDialog(dialog);
      await waitFor(() => !document.contains(dialog));
    } else {
      // Measured: Apply empties the list within about 100 ms and the filtered list arrives 1-3 s later. The old list's first row going away is the proof it was replaced, so no row of it can be selected; a long list keeps a load-more spinner at its foot, so a spinner proves nothing unless the old list was empty. A list that never visibly turns over stops the run.
      const firstRowBefore = listRow();
      apply.click();
      await waitFor(
        () => (firstRowBefore ? listRow() !== firstRowBefore : document.querySelector(SELECTORS.loading) || listRow()),
        CONFIG.uiTimeoutMs,
      ).catch(() => {
        throw new Error("Could not confirm that Instagram applied the filter, so nothing was selected.");
      });
    }
    // An empty list shows no load-more spinner, so "No results" counts only once loading has stopped; a non-empty list is ready as soon as its first row is there.
    await waitFor(
      () => listRow() || (listIsEmpty() && !document.querySelector(SELECTORS.loading)),
      CONFIG.loadTimeoutMs,
    );
    await sleep(CONFIG.uiStepMs);
  }
  const listRow = () => listArea()?.querySelector("img");
  const listArea = () => document.querySelector(SELECTORS.main);
  const rowToggles = () => [...document.querySelectorAll(SELECTORS.rowToggle)];
  const listIsEmpty = () => (listArea()?.innerText ?? "").includes(LABELS.noResults);

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
    checkStop();
    showStatus(`On or before ${cutoff.toLocaleDateString()}:\n${lines.join("\n")}`);
  }

  async function checkedAccountStart(type, cutoff) {
    const accountStart = await accountStartDate(type);
    if (cutoff < accountStart) {
      throw new Error(`The date is before your account existed (${accountStart.toLocaleDateString()}).`);
    }
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

  function textsMatching(regex) {
    return [...document.querySelectorAll("span, div")].filter(
      (el) => el.childElementCount === 0 && regex.test(el.innerText?.trim() ?? ""),
    );
  }

  function selectionBarButton(counter, text) {
    for (
      let node = counter?.parentElement, step = 0;
      node && step < CONFIG.maxAncestorSteps;
      node = node.parentElement, step++
    ) {
      const button = textElement(text, node);
      if (button) return button;
    }
    return null;
  }

  function countRemoved(type, progress, count) {
    recordDeleted(count);
    progress.total += count;
    progress.byType[type.key] = (progress.byType[type.key] ?? 0) + count;
  }

  // Rows are always taken from the top of the oldest-first list, never from wherever the list happens to be scrolled, so a batch is always the oldest items left.
  async function deleteBatch(type, size, progress) {
    await enterSelectMode();
    for (let index = 0; index < size; index++) {
      const toggle = rowToggles()[index];
      if (!toggle) break;
      toggle.click();
      await pause(CONFIG.selectStepMs);
    }
    const counter = textsMatching(/^\d+ selected$/)[0];
    const selected = Number(counter?.innerText.match(/\d+/)[0] ?? 0);
    if (selected === 0) throw new Error("Nothing could be selected although the list is not empty.");
    const earlierToasts = new Set(textsMatching(type.done));
    // The action button shares the selection bar with the "N selected" counter; searching only there keeps a comment that happens to read "Delete" from being clicked instead.
    (await waitFor(() => selectionBarButton(counter, type.action))).click();
    const confirm = await waitFor(() =>
      [...document.querySelectorAll(SELECTORS.dialog)]
        .map((dialog) => buttonWithText(dialog, type.action))
        .find(Boolean),
    );
    confirm.click();
    // Once confirmed the items may already be gone, so the outcome is waited for even through a stop and counted before the stop is honoured; an unconfirmed batch is counted as fully removed so the daily cap never runs low.
    const toast = await waitEvenIfStopped(
      () => textsMatching(type.done).find((el) => !earlierToasts.has(el)),
      CONFIG.confirmTimeoutMs,
    );
    if (!toast) {
      countRemoved(type, progress, selected);
      throw new Error(`Instagram did not confirm the last batch; up to ${selected} items may have been removed.`);
    }
    const removed = Math.min(selected, Number(toast.innerText.match(type.done)[1]));
    countRemoved(type, progress, removed);
    if (removed < selected) requestStop(`Instagram removed only ${removed} of ${selected} selected items.`);
    await waitFor(() => !textElement(LABELS.cancel));
  }

  // The daily allowance is re-read before every batch rather than once per run, so two tabs running on the same day cannot each spend the whole of it.
  const batchBudget = (progress) =>
    Math.min(CONFIG.batchSize, CONFIG.runCap - progress.total, remainingDailyAllowance());

  // The year's range is re-applied before every batch: Instagram reloads the list after each deletion, and a filter lost in that reload would put newer items at the top of the list. A year counts as done only when its filtered list says it is empty.
  async function runType(type, ranges, progress, showStatus) {
    let batches = 0;
    for (const range of ranges) {
      while (batchBudget(progress) > 0) {
        await applyRange(type, range.start, range.end);
        if (listIsEmpty()) break;
        await deleteBatch(type, batchBudget(progress), progress);
        showStatus(`${type.label} from ${range.year}: ${progress.byType[type.key]} removed so far…`);
        batches += 1;
        if (batchBudget(progress) === 0) break;
        await pause(
          batches % CONFIG.longPauseEveryBatches === 0
            ? CONFIG.longPauseMinMs + Math.random() * (CONFIG.longPauseMaxMs - CONFIG.longPauseMinMs)
            : jittered(CONFIG.batchPauseMs),
        );
      }
    }
  }

  async function runAll(types, cutoff, progress, showStatus) {
    const ranges = yearRanges(await checkedAccountStart(types[0], cutoff), cutoff);
    for (const type of types) {
      if (batchBudget(progress) === 0) break;
      progress.current = type;
      await runType(type, ranges, progress, showStatus);
    }
    checkStop();
    // Only a run that still had budget left has emptied every selected year; one that hit a cap says which, since more may remain.
    if (remainingDailyAllowance() === 0) return "Daily cap reached: continue tomorrow.";
    if (progress.total >= CONFIG.runCap) return "Run cap reached: start again to continue.";
    return `Nothing left on or before ${cutoff.toLocaleDateString()} in the selected types.`;
  }

  // A dialog or banner is either one of the three this flow expects (the filter, the confirmation, the done toast) or a reason to stop: anything Instagram shows that the script cannot place may be a warning in disguise.
  function judgeNotice(element, type) {
    const text = element.innerText.trim();
    if (RESTRICTION_TEXT.test(text)) {
      return `Instagram said: “${text.slice(0, 120)}”. Wait at least 24 hours before running again.`;
    }
    if (text.includes(LABELS.sortFilter) || type?.done.test(text)) return null;
    if (type && buttonWithText(element, type.action) && buttonWithText(element, LABELS.cancel)) return null;
    return `Instagram showed something unexpected: “${text.slice(0, 120)}”.`;
  }

  // Watches for the first sign of a restriction while a run is active: notices in the page, and any HTTP 429 from Instagram's own requests, which only unsafeWindow can see.
  // A notice is judged again whenever its text changes, since Instagram can reuse one toast container for a done message and then a warning.
  function watchRestrictions(progress) {
    const judgedText = new WeakMap();
    const timer = setInterval(() => {
      for (const element of document.querySelectorAll(SELECTORS.notice)) {
        const text = element.innerText?.trim();
        if (!text || judgedText.get(element) === text || element.closest(SELECTORS.panel)) continue;
        judgedText.set(element, text);
        const reason = judgeNotice(element, progress.current);
        if (reason) requestStop(reason);
      }
    }, CONFIG.watchIntervalMs);
    const page = unsafeWindow;
    const tooManyRequests = "Instagram answered 429 Too Many Requests. Wait at least 24 hours before running again.";
    let watching = true;
    const originalFetch = page.fetch;
    const watchedFetch = function (...args) {
      return originalFetch.apply(this, args).then((response) => {
        if (watching && response.status === 429) requestStop(tooManyRequests);
        return response;
      });
    };
    page.fetch = watchedFetch;
    const originalSend = page.XMLHttpRequest.prototype.send;
    const watchedSend = function (...args) {
      this.addEventListener("loadend", () => {
        if (watching && this.status === 429) requestStop(tooManyRequests);
      });
      return originalSend.apply(this, args);
    };
    page.XMLHttpRequest.prototype.send = watchedSend;
    // Something else may have wrapped these after us; restoring over its wrapper would undo it, so ours is only unhooked when still on top and otherwise left in place as a pass-through.
    return () => {
      watching = false;
      clearInterval(timer);
      if (page.fetch === watchedFetch) page.fetch = originalFetch;
      if (page.XMLHttpRequest.prototype.send === watchedSend) page.XMLHttpRequest.prototype.send = originalSend;
    };
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
    panel.querySelector('[data-igtk="close"]').addEventListener("click", () => {
      requestStop("You closed the panel.");
      panel.remove();
    });
    const control = (name) => panel.querySelector(`[data-igtk="${name}"]`);
    const showStatus = (text) => (control("status").textContent = text);
    const readCutoff = () => toLocalDate(...control("cutoff").value.split("-"));
    const readTypes = () => TYPES.filter((type) => panel.querySelector(`[data-igtk-type="${type.key}"]`).checked);
    const inputs = () => panel.querySelectorAll("input");
    const removedSummary = (progress) =>
      TYPES.filter((type) => progress.byType[type.key])
        .map((type) => `${type.label}: ${progress.byType[type.key]} removed\n`)
        .join("");
    // A run cut short by closing the panel may still be finishing a wait; a second run started from a reopened panel would clear its stop and both would click at once. The inputs are frozen for the run because the run reads them only once, at its start.
    const runFromPanel = (task) => async () => {
      if (running) {
        showStatus("The previous run is still stopping; try again in a moment.");
        return;
      }
      const cutoff = readCutoff();
      const types = readTypes();
      const invalid = types.length === 0 ? "Tick at least one type." : validateCutoff(cutoff, new Date());
      if (invalid) {
        showStatus(invalid);
        return;
      }
      running = true;
      stopReason = null;
      const progress = { total: 0, byType: {}, current: null };
      control("count").disabled = true;
      control("start").disabled = true;
      control("stop").disabled = false;
      inputs().forEach((input) => (input.disabled = true));
      const stopWatching = watchRestrictions(progress);
      try {
        await task(types, cutoff, progress);
      } catch (error) {
        // A stop surfaces as whatever wait it interrupted, which may rewrap it, so the recorded reason wins over the error's own message.
        showStatus(`${removedSummary(progress)}Stopped: ${stopReason ?? error.message}`);
      } finally {
        stopWatching();
        running = false;
        activePath = null;
        control("count").disabled = false;
        control("start").disabled = false;
        control("stop").disabled = true;
        inputs().forEach((input) => (input.disabled = false));
      }
    };
    control("count").addEventListener(
      "click",
      runFromPanel((types, cutoff) => countAll(types, cutoff, showStatus)),
    );
    control("start").addEventListener(
      "click",
      runFromPanel(async (types, cutoff, progress) => {
        const ending = await runAll(types, cutoff, progress, showStatus);
        showStatus(`${removedSummary(progress)}${ending}`);
      }),
    );
    showStatus(
      `Today's allowance: ${remainingDailyAllowance()} of ${CONFIG.dailyCap}. The chosen day itself is kept as a time-zone margin.`,
    );
    control("stop").addEventListener("click", () => requestStop("Stopped by you."));
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
