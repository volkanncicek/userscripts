# TODO

## Instagram Toolkit

- Bring downloading into the Toolkit so it is maintained here: a download button on posts, reels and stories, files fetched with `GM_xmlhttpRequest` and a gallery saved as one zip (as `sahibinden-photo-downloader` does), named user-date-id as now. "Instagram Download Button" (MIT, last updated 2024-03) still saved a gallery photo at full size on 2026-10-20, but its feedback reports videos and stories failing; finding a video's real URL is the hard part. Drop it from `third-party.md` once ours ships.

## Footprint cleaners for other platforms

Same shape as the Instagram cleaner: a cutoff, count first, oldest year first, paced batches under run and daily caps, stop on any sign of a restriction, ask before any trial deletion. Each starts with a design conversation.

- X (Twitter): its web UI has no date-filtered bulk delete; research whether the account archive plus the web UI is the way.
- Facebook: Activity Log appears to offer date filters and bulk actions; verify live.

## Known limits of the Instagram cleaner

- Count still stopped with "Instagram did not refresh the list after the filter was applied" on 2026.10.20.1, after the fix that waits for the old "No results" element to go. The message now names the list, the range, whether the dialog closed and what the list showed; change the turnover check only once a stop has reported those.
- On 2026-10-20 Story replies showed that empty state on every load, shortly after a few replies had been deleted by hand; check whether any were left and the list is failing to load, or the tab is genuinely empty.
- The 429 hook has never fired live, so whether Instagram signals limits that way is unverified.
- Reposts show no age in the list; the cleaner relies on Instagram's date filter for them, which was not checked against an item of known date.
