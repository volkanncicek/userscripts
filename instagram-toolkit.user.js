// ==UserScript==
// @name         Instagram Toolkit
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.20.7
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @description  Cleans up your old Instagram activity (comments, likes, reposts, story replies and reviews from before a date you pick, slowly and only when you start it), shows "3 of 5" in galleries, steps through gallery photos and posts with the arrow keys, downloads photos and videos at full size, and keeps links in your own language.
// @author       volkan.cicek
// @match        https://www.instagram.com/*
// @connect      fbcdn.net
// @connect      cdninstagram.com
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
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
    loadStallMs: 180000,
    requestGiveUpMs: 30000,
    emptyPagesToFinish: 2,
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
    minFrameWidth: 150,
    heightTolerancePx: 2,
    pageUpdateDebounceMs: 100,
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
    post: "article",
    // The gallery dots are one button per photo with the active one carrying aria-current="step". The classes around them are obfuscated and change between builds, and the buttons' aria-label follows the UI language, so only the ARIA state is relied on.
    activeDot: 'button[aria-current="step"]',
    media: "img, video",
    like: 'svg[aria-label="Like"], svg[aria-label="Unlike"]',
    comment: 'svg[aria-label="Comment"]',
    download: ".igtk-download",
    storyDownload: ".igtk-story-download",
  };
  const LABELS = {
    sortFilter: "Sort & Filter",
    oldestFirst: "Oldest to Newest",
    apply: "Apply",
    noResults: "No results",
    select: "Select",
    cancel: "Cancel",
    reset: "Reset",
    next: "Next",
    previous: "Go back",
  };
  // Instagram's own wording when it limits activity, plus a lost session; any of these stops a run at once.
  const RESTRICTION_TEXT =
    /try again later|we restrict certain activity|we limit how often|something went wrong|log in/i;
  // Reviews says "No review activity"; Story replies words its own empty state differently.
  const EMPTY_TAB_TEXT = /^No .+ activity$|^You haven't responded to any stickers$/;
  // `action` is the bottom-bar button and its confirmation button; `done` is the toast Instagram shows once the items are gone. Likes, comments and story replies were measured live and reposts showed the same Delete button; reviews held nothing to measure, and a missing button or toast stops the run rather than guessing.
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
    #igtk-panel { position: fixed; top: 16px; right: 16px; z-index: 2147483000; width: 320px; padding: 14px; border-radius: 10px; background: #1c1c1e; color: #f5f5f5; font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); color-scheme: dark; }
    #igtk-panel h2 { margin: 0 0 10px; font-size: 15px; }
    #igtk-panel label { display: block; margin: 4px 0; }
    #igtk-panel input[type="date"] { margin-left: 6px; padding: 2px 6px; border: 1px solid #555; border-radius: 6px; background: #2c2c2e; color: #f5f5f5; font: inherit; }
    #igtk-panel .igtk-buttons { display: flex; gap: 6px; margin: 10px 0; }
    #igtk-panel button { flex: 1; padding: 6px; border: 0; border-radius: 6px; background: #0095f6; color: #fff; cursor: pointer; }
    #igtk-panel button:disabled { background: #555; cursor: default; }
    #igtk-panel .igtk-close { position: absolute; top: 8px; right: 10px; flex: none; padding: 0 6px; background: none; color: #aaa; }
    #igtk-panel .igtk-status { white-space: pre-line; color: #ccc; }
  `;
  const COUNTER_CLASS = "ig-gallery-counter";
  const COUNTER_CSS = `
    .${COUNTER_CLASS} { position: absolute; top: 15px; right: 15px; z-index: 10; padding: 5px 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.85); color: #fff; font: bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); pointer-events: none; }
    .igtk-download { display: flex; padding: 8px; border: 0; background: none; color: inherit; cursor: pointer; }
    .igtk-download:disabled { opacity: 0.4; cursor: progress; }
    .igtk-download[data-failed] { color: #ed4956; }
    .igtk-story-download { position: fixed; top: 16px; right: 72px; z-index: 2147483000; color: #fff; }
  `;
  const DOWNLOAD_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3"/></svg>`;
  // A post's address carries a shortcode, which is its numeric media id written in this base-64 alphabet.
  const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // The reels feed keeps the reel on screen in the address as /reels/<code>/, and its "original audio" links use /reels/audio/<id>/, which is not a post.
  const POST_PATH = /^\/(?:[\w.]+\/)?(?:p|reels?)\/(?!audio\/)([\w-]+)/;
  // A highlight's address carries the highlight's id rather than a story's, so highlights are left out.
  const STORY_VIEWER_PATH = /^\/stories\/(?!highlights\/)[\w.]+\//;
  const STORY_PATH = /^\/stories\/(?!highlights\/)[\w.]+\/(\d+)/;
  // The web client's app id, which Instagram's own requests carry; without it the media endpoint answers 400 "useragent mismatch".
  const IG_APP_ID = "936619743392459";

  // The cleaner matches Instagram's English labels and its restriction warnings, so any other UI language could hide a warning it must stop on.
  const isEnglishUi = () => document.documentElement.lang.toLowerCase().startsWith("en");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let stopReason = null;
  let running = false;
  let pageUpdateTimer;
  // Instagram's list pages arrive through this endpoint; tracking them is what tells a list that is still loading from one that is complete.
  const PAGE_REQUEST = /\/async\/wbloks\/fetch/;
  const pageRequests = { inFlight: new Set(), completed: 0 };
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
    // A tab that has never held anything (measured on Reviews: "No review activity") shows no toolbar at all, so it is reported as empty instead of waiting for a Sort & Filter button that will not come.
    const found = await waitFor(
      () =>
        buttonWithText(document, LABELS.sortFilter) ||
        textsMatching(EMPTY_TAB_TEXT).find((el) => listArea()?.contains(el)),
    );
    return found.matches(SELECTORS.button) ? found : null;
  }

  const textElement = (text, root = document) =>
    [...root.querySelectorAll("span, div")].find((el) => el.childElementCount === 0 && el.innerText?.trim() === text);

  // The dialog holds two Month/Day/Year triples, start then end. Reset restores the widest range (the account's creation date to today) without applying it, so starting from it every date that is set is valid and the creation date can be read; it is only offered once a filter differs from that default, which is the state a fresh page starts in.
  async function openResetFilterDialog(type) {
    const toolbar = await openType(type);
    if (!toolbar) return null;
    toolbar.click();
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
    if (!dialog) return null;
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

  // Returns false when the tab has nothing at all, which callers treat like an empty year.
  async function applyRange(type, start, end) {
    const dialog = await openResetFilterDialog(type);
    if (!dialog) return false;
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
      // Measured: Apply replaces the list's content within about 100 ms and the filtered list arrives 1-3 s later. The old list's first row, or its "No results" element when it was empty, going away is the proof it was replaced, so no row of it can be selected. The spinner in between can be shown for only 300 ms, which a background tab's throttled timers miss, and a long list keeps a load-more spinner at its foot anyway, so it is the fallback only for a list that showed neither. A list that never visibly turns over stops the run.
      const before = listRow() || textElement(LABELS.noResults, listArea() ?? document);
      apply.click();
      await waitFor(
        () => (before ? !before.isConnected : document.querySelector(SELECTORS.loading) || listRow()),
        CONFIG.uiTimeoutMs,
      ).catch(() => {
        // This stop has not been reproduced by hand, so the message carries what tells its causes apart: which list and range, whether the dialog took the click, and what the list showed before.
        const range = `${start.toLocaleDateString()}–${end.toLocaleDateString()}`;
        const dialogState = document.contains(dialog) ? "the filter dialog stayed open" : "the filter dialog closed";
        const shown = before
          ? `the old ${before.matches("img") ? "first row" : '"No results"'} stayed`
          : "nothing was shown";
        throw new Error(
          `Instagram did not refresh the ${type.label} list for ${range} (${dialogState}; ${shown}), so nothing was selected. It may be slowing down activity; try again later.`,
        );
      });
    }
    // An empty list shows no load-more spinner, so "No results" counts only once loading has stopped; a non-empty list is ready as soon as its first row is there.
    await waitFor(
      () => listRow() || (listIsEmpty() && !document.querySelector(SELECTORS.loading)),
      CONFIG.loadTimeoutMs,
    );
    await sleep(CONFIG.uiStepMs);
    return true;
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

  // Measured on the likes list: each next page is a request to Instagram that takes 1-6 s, and a new one is only sent when the list is scrolled from well above its foot back down to it, which is what scrolling by hand does; scrolling to a foot it is already at sends nothing. The load-more spinner also stays after the last page, so it cannot say when the list is complete. So the list is asked for more only while no page request is in flight, it counts as complete once pages come back adding nothing, and it stops the count if nothing new arrives for too long. A request left unanswered past its give-up time no longer counts as in flight, since waiting on it would keep the list from ever being asked again. Reading a long list quickly is itself what Instagram treats as automation, hence the walking pace.
  async function loadAllRows(where) {
    const deadline = Date.now() + CONFIG.loadTimeoutMs;
    let seen = rowToggles().length;
    let lastGrowth = Date.now();
    let completedAtGrowth = pageRequests.completed;
    const pendingSince = () =>
      [...pageRequests.inFlight]
        .map((request) => request.startedAt)
        .filter((startedAt) => Date.now() - startedAt < CONFIG.requestGiveUpMs);
    while (pageRequests.completed - completedAtGrowth < CONFIG.emptyPagesToFinish || pendingSince().length > 0) {
      if (Date.now() > deadline) throw new Error(`The ${where} list did not finish loading, so nothing was counted.`);
      const scroller = scrollableAncestor(rowToggles().at(-1));
      if (scroller && pendingSince().length === 0) {
        scroller.scrollTop = 0;
        await pause(CONFIG.uiStepMs);
        scroller.scrollTop = scroller.scrollHeight;
      }
      await pause(CONFIG.scrollPauseMs);
      const now = rowToggles().length;
      if (now > seen) {
        seen = now;
        lastGrowth = Date.now();
        completedAtGrowth = pageRequests.completed;
      }
      if (Date.now() - lastGrowth > CONFIG.loadStallMs) {
        // This stop has not been reproduced by hand, so the message carries what tells its causes apart.
        const unanswered = pageRequests.inFlight.size;
        const seconds = Math.round((Date.now() - lastGrowth) / 1000);
        throw new Error(
          `Instagram stopped loading the ${where} list after ${seen} items: nothing new for ${seconds} s, ${pageRequests.completed - completedAtGrowth} list requests answered since, ${unanswered} unanswered. Nothing was counted; it may be slowing down activity, so try again later.`,
        );
      }
    }
    return seen;
  }

  async function countRange(type, range) {
    if (!(await applyRange(type, range.start, range.end)) || listIsEmpty()) return 0;
    await enterSelectMode();
    const count = await loadAllRows(`${type.label} ${range.year}`);
    await exitSelectMode();
    return count;
  }

  async function countAll(types, cutoff, showStatus) {
    const ranges = await checkedRanges(types, cutoff);
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

  // The creation date is read from the first selected tab that has a filter at all; if none has, there is nothing to clean.
  async function checkedRanges(types, cutoff) {
    for (const type of types) {
      const accountStart = await accountStartDate(type);
      if (!accountStart) continue;
      if (cutoff < accountStart) {
        throw new Error(`The date is before your account existed (${accountStart.toLocaleDateString()}).`);
      }
      return yearRanges(accountStart, cutoff);
    }
    return [];
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
        if (!(await applyRange(type, range.start, range.end)) || listIsEmpty()) break;
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
    const ranges = await checkedRanges(types, cutoff);
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
    pageRequests.inFlight.clear();
    pageRequests.completed = 0;
    const originalFetch = page.fetch;
    const watchedFetch = function (...args) {
      const isPage = PAGE_REQUEST.test(String(args[0]?.url ?? args[0]));
      const request = { startedAt: Date.now() };
      if (isPage) pageRequests.inFlight.add(request);
      return originalFetch.apply(this, args).then(
        (response) => {
          if (watching && response.status === 429) requestStop(tooManyRequests);
          if (pageRequests.inFlight.delete(request)) pageRequests.completed += 1;
          return response;
        },
        (error) => {
          pageRequests.inFlight.delete(request);
          throw error;
        },
      );
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

  // The dots sit below the photo, and the nearest ancestor holding any media only holds the "liked by" avatars, so the frame is found from the photo itself: climb from the first full-size media through the wrappers that share its height, which ends at the carousel viewport.
  function findFrame(dotRow) {
    let node = dotRow.parentElement;
    for (let step = 0; node && step < CONFIG.maxAncestorSteps; step++, node = node.parentElement) {
      const photo = [...node.querySelectorAll(SELECTORS.media)].find(
        (media) => media.getBoundingClientRect().width >= CONFIG.minFrameWidth,
      );
      if (!photo) continue;
      const photoHeight = photo.getBoundingClientRect().height;
      let frame = photo.parentElement;
      while (
        frame.parentElement !== node &&
        Math.abs(frame.parentElement.getBoundingClientRect().height - photoHeight) <= CONFIG.heightTolerancePx
      ) {
        frame = frame.parentElement;
      }
      return frame;
    }
    return null;
  }

  function labelGallery(activeDot) {
    const dotRow = activeDot.parentElement;
    const allDots = [...dotRow.children].filter((element) => element.tagName === "BUTTON");
    const activeIndex = allDots.indexOf(activeDot);
    if (allDots.length < 2 || activeIndex < 0) return;
    const frame = findFrame(dotRow);
    if (!frame) return;

    if (getComputedStyle(frame).position === "static") frame.style.position = "relative";
    let counter = frame.querySelector(`:scope > .${COUNTER_CLASS}`);
    if (!counter) {
      counter = document.createElement("div");
      counter.className = COUNTER_CLASS;
      frame.append(counter);
    }
    const text = `${activeIndex + 1} of ${allDots.length}`;
    // Writing only on change keeps the gallery observer from re-triggering itself.
    if (counter.textContent !== text) counter.textContent = text;
  }

  const log = (...args) => console.log("[Instagram Toolkit]", ...args);
  const twoDigits = (number) => String(number).padStart(2, "0");

  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  // Photos and videos are already compressed, so entries are stored rather than deflated; that keeps the zip writer small enough to inline instead of depending on a library. Layout follows PKWARE's APPNOTE: a local header before each file, then the central directory, then the end record.
  function buildZip(files) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const { name, bytes } of files) {
      const nameBytes = encoder.encode(name);
      const crc = crc32(bytes);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      localParts.push(local, nameBytes, bytes);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, bytes.length, true);
      central.setUint32(24, bytes.length, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint32(42, offset, true);
      centralParts.push(central, nameBytes);

      offset += 30 + nameBytes.length + bytes.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  // The media sit on Instagram's CDN, another origin, which a page fetch cannot read; GM_xmlhttpRequest can, for the hosts in @connect.
  const fetchBytes = (url) =>
    new Promise((resolve, reject) =>
      GM_xmlhttpRequest({
        url,
        responseType: "arraybuffer",
        onload: (response) =>
          response.status === 200
            ? resolve(new Uint8Array(response.response))
            : reject(new Error(`The file answered ${response.status}.`)),
        onerror: () => reject(new Error("The file could not be fetched.")),
        ontimeout: () => reject(new Error("Fetching the file timed out.")),
      }),
    );

  // A link with a download attribute keeps the chosen name, which GM_download loses whenever a download-manager extension is installed; a gallery goes as one zip because Chrome holds back repeated downloads from a page until the site is allowed to download multiple files, a refusal the page cannot see.
  function saveBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href, download: name }).click();
    // The browser reads the blob after the click returns, so revoking at once would cancel the save.
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }

  const shortcodeToId = (code) =>
    [...code].reduce((id, char) => id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(char)), 0n).toString();

  // One request per click, the same one Instagram's own client makes when it opens a post, so a download looks like viewing a post rather than like scraping. It answers for a story's id as well.
  async function mediaInfo(mediaId) {
    const response = await fetch(`/api/v1/media/${mediaId}/info/`, {
      headers: { "x-ig-app-id": IG_APP_ID },
      credentials: "include",
    });
    if (!response.ok) throw new Error(`Instagram answered ${response.status} for media ${mediaId}.`);
    const item = (await response.json()).items?.[0];
    if (!item) throw new Error(`Instagram returned nothing for media ${mediaId}.`);
    return item;
  }

  const dateStamp = (item) => {
    const taken = new Date(item.taken_at * 1000);
    return `${taken.getFullYear()}-${twoDigits(taken.getMonth() + 1)}-${twoDigits(taken.getDate())}`;
  };
  const extensionOf = (url) => new URL(url).pathname.split(".").pop();

  const largest = (versions) => versions.reduce((best, version) => (version.width > best.width ? version : best));
  const mediaUrl = (media) =>
    media.video_versions?.length ? largest(media.video_versions).url : largest(media.image_versions2.candidates).url;

  async function downloadPost(code, index, wholeGallery) {
    const item = await mediaInfo(shortcodeToId(code));
    const parts = item.carousel_media ?? [item];
    const positions = wholeGallery ? parts.map((_, position) => position) : [parts[index] ? index : 0];
    const stem = `${item.user.username}-${dateStamp(item)}-${code}`;
    const files = await Promise.all(
      positions.map(async (position) => {
        const url = mediaUrl(parts[position]);
        return { name: `${stem}-${twoDigits(position + 1)}.${extensionOf(url)}`, bytes: await fetchBytes(url) };
      }),
    );
    if (files.length === 1) saveBlob(new Blob([files[0].bytes]), files[0].name);
    else saveBlob(buildZip(files), `${stem}.zip`);
  }

  // Measured: the story viewer puts the story's id in the address only once you step to another story; the story it opens on has none, and its video plays from a blob, so there is nothing else on the page to download it by.
  async function downloadStory() {
    const storyId = location.pathname.match(STORY_PATH)?.[1];
    if (!storyId) {
      throw new Error(
        "Instagram has not put this story in the address yet. Step to the next story and back, then download.",
      );
    }
    const item = await mediaInfo(storyId);
    const url = mediaUrl(item);
    saveBlob(
      new Blob([await fetchBytes(url)]),
      `${item.user.username}-${dateStamp(item)}-story-${storyId}.${extensionOf(url)}`,
    );
  }

  // An opened post and a post page show the post in the address; a post in the feed links to itself.
  function postCode(root) {
    if (root.closest(SELECTORS.dialog) || !root.matches(SELECTORS.post)) {
      return location.pathname.match(POST_PATH)?.[1] ?? null;
    }
    for (const link of root.querySelectorAll("a[href]")) {
      const code = link.getAttribute("href").match(POST_PATH)?.[1];
      if (code) return code;
    }
    return null;
  }

  // The feed marks the photo on show with its dots; an opened post and a post page have no such dots and keep it in the address instead.
  function shownIndex(root) {
    const dot = root.querySelector(SELECTORS.activeDot);
    if (dot) return [...dot.parentElement.children].filter((element) => element.tagName === "BUTTON").indexOf(dot);
    const position = Number(new URL(location.href).searchParams.get("img_index"));
    return position > 0 ? position - 1 : 0;
  }

  // A failure turns the icon red and puts the reason in its tooltip, so a click that saved nothing does not pass silently.
  function createDownloadButton(idleTitle, download) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "igtk-download";
    button.innerHTML = DOWNLOAD_ICON;
    button.title = idleTitle;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      button.title = idleTitle;
      delete button.dataset.failed;
      try {
        await download(event);
      } catch (error) {
        log(error);
        button.dataset.failed = "";
        button.title = `Download failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  const createPostDownloadButton = (root) =>
    createDownloadButton("Download (Shift+click: the whole gallery as one zip)", (event) => {
      const code = postCode(root);
      if (!code) throw new Error("This post's address was not found.");
      return downloadPost(code, shownIndex(root), event.shiftKey);
    });

  // The story viewer has no action row to sit in, so its button is fixed beside the viewer's close button and leaves with the viewer.
  function updateStoryButton() {
    const existing = document.querySelector(SELECTORS.storyDownload);
    if (!STORY_VIEWER_PATH.test(location.pathname)) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const button = createDownloadButton("Download this story", downloadStory);
    button.classList.add("igtk-story-download");
    document.body.append(button);
  }

  // The like button's nearest ancestor that also holds the comment button is the post's action row. A comment's own like heart has no comment button beside it, so its nearest such ancestor is the whole post, which holds more than one like button and is skipped.
  function addDownloadButtons() {
    if (!isEnglishUi()) return;
    for (const like of document.querySelectorAll(SELECTORS.like)) {
      let row = like.parentElement;
      while (row && !row.querySelector(SELECTORS.comment)) row = row.parentElement;
      if (!row || row.querySelectorAll(SELECTORS.like).length !== 1 || row.querySelector(SELECTORS.download)) continue;
      row.append(createPostDownloadButton(row.closest(SELECTORS.post) ?? document.querySelector(SELECTORS.main)));
    }
  }

  function schedulePageUpdate() {
    clearTimeout(pageUpdateTimer);
    pageUpdateTimer = setTimeout(() => {
      document.querySelectorAll(SELECTORS.activeDot).forEach(labelGallery);
      addDownloadButtons();
      updateStoryButton();
    }, CONFIG.pageUpdateDebounceMs);
  }

  const isTyping = (target) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  // A post opened over a page is the one the keys belong to; otherwise it is the post nearest the middle of the screen. A post page has no article around its post, so there the page itself is the post.
  function postInView() {
    const opened = [...document.querySelectorAll(SELECTORS.dialog)]
      .map((dialog) => dialog.querySelector(SELECTORS.post))
      .find(Boolean);
    if (opened) return opened;
    const middle = innerHeight / 2;
    const distance = (post) => {
      const box = post.getBoundingClientRect();
      return Math.abs((box.top + box.bottom) / 2 - middle);
    };
    const nearest = [...document.querySelectorAll(SELECTORS.post)].sort((a, b) => distance(a) - distance(b))[0];
    if (nearest) return nearest;
    return POST_PATH.test(location.pathname) ? document.querySelector(SELECTORS.main) : null;
  }

  const buttonsLabelled = (root, label) =>
    [...root.querySelectorAll(`[aria-label="${label}"]`)].map((element) => element.closest("button")).filter(Boolean);

  // A gallery's own arrows are inside the post; an opened post's arrows to its neighbours are outside it, in the dialog.
  function stepPost(post, forward) {
    const dialog = post.closest(SELECTORS.dialog);
    if (dialog) {
      const button = buttonsLabelled(dialog, forward ? LABELS.next : LABELS.previous).find((el) => !post.contains(el));
      button?.click();
      return Boolean(button);
    }
    // The feed keeps empty placeholder posts with no height between real ones; stepping onto one would not move the page.
    const posts = [...document.querySelectorAll(SELECTORS.post)].filter((el) => el.getBoundingClientRect().height > 0);
    const position = posts.indexOf(post);
    const target = position < 0 ? null : posts[position + (forward ? 1 : -1)];
    target?.scrollIntoView({ block: "start" });
    return Boolean(target);
  }

  // Measured: in an opened post Instagram's own Left/Right go to the neighbouring post and skip the post's other photos, Shift+arrows do nothing and Esc already closes it; the feed has no arrow keys at all. So the arrows step through the photos of the post in view and, past its first or last photo, are left to Instagram, while Shift+arrows step between posts. The buttons are found by their English labels, so another UI language is left to Instagram's own keys.
  function onArrowKey(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.ctrlKey || event.altKey || event.metaKey || isTyping(event.target) || !isEnglishUi()) return;
    const post = postInView();
    if (!post) return;
    const forward = event.key === "ArrowRight";
    let handled;
    if (event.shiftKey) {
      handled = stepPost(post, forward);
    } else {
      const photoButton = buttonsLabelled(post, forward ? LABELS.next : LABELS.previous)[0];
      photoButton?.click();
      handled = Boolean(photoButton);
    }
    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  // Instagram renders a page in whatever language an `hl` parameter names, which links from search engines carry, overriding the user's own setting and the English UI the cleaner needs. Only the parameter named exactly `hl` goes, so other query values that merely contain those letters survive.
  function dropLanguageParameter() {
    const url = new URL(location.href);
    if (!url.searchParams.has("hl")) return false;
    url.searchParams.delete("hl");
    location.replace(url.href);
    return true;
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

  // The script starts at document-start so a language parameter is dropped before Instagram renders the page in that language; everything else waits for the body.
  if (dropLanguageParameter()) return;
  GM_registerMenuCommand("Clean up old activity…", openPanel);
  function start() {
    GM_addStyle(COUNTER_CSS);
    // Swiping only moves aria-current between the dots, and the feed adds galleries as it scrolls, so both kinds of change count.
    new MutationObserver(schedulePageUpdate).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    schedulePageUpdate();
    // Capture on window runs before Instagram's own key handlers, which is what lets a photo step replace its post step.
    window.addEventListener("keydown", onArrowKey, true);
    if (sessionStorage.getItem(REOPEN_FLAG) === "1" && location.pathname.startsWith(ACTIVITY_PATH)) {
      sessionStorage.removeItem(REOPEN_FLAG);
      openPanel();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
