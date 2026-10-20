# TODO

## YouTube Subscription Tracker

- On 2026-10-20 the Resume box was drawn at the bottom right instead of beside the shelf's subscribe button, which is the floating fallback `_initWhenReady` uses when `SELECTORS.shelfSubscribeButton` has not appeared within `maxPollAttempts` polls. Check on the live page whether the selector no longer matches or the shelf header simply rendered late.

## Instagram Toolkit

- The story download needs the story's id in the address, which the viewer adds only after stepping to another story, so the story it opens on asks the user to step away and back. Reading the opening story's id would mean the user's id for `/api/v1/feed/reels_media/?reel_ids=`, and `/api/v1/users/web_profile_info/` answered 429 after three requests on 2026-10-20. Highlights are left out because their address carries the highlight's id.

## Footprint cleaners for other platforms

Same shape as the Instagram cleaner: a cutoff, count first, oldest year first, paced batches under run and daily caps, stop on any sign of a restriction, ask before any trial deletion. Each starts with a design conversation.

- X (Twitter): its web UI has no date-filtered bulk delete; research whether the account archive plus the web UI is the way.
- Facebook: Activity Log appears to offer date filters and bulk actions; verify live.

## Known limits of the Instagram cleaner

- Count still stopped with "Instagram did not refresh the list after the filter was applied" on 2026.10.20.1, after the fix that waits for the old "No results" element to go. The message now names the list, the range, whether the dialog closed and what the list showed; change the turnover check only once a stop has reported those.
- Count also stopped with "Instagram stopped loading more items" on 2026.10.20.6. A list request that never settled kept the loop from asking for more, which 2026.10.20.7 fixes by giving such a request up after 30 s; the message now names the list and year, the items loaded, and the answered and unanswered requests since the last growth. Whether the `unsafeWindow.fetch` wrapper sees Instagram's requests inside Tampermonkey (rather than in a page-level test) is still unverified; an "answered 0" in that message would say it does not.
- On 2026-10-20 Story replies showed that empty state on every load, shortly after a few replies had been deleted by hand; check whether any were left and the list is failing to load, or the tab is genuinely empty.
- The 429 hook has never fired live, so whether Instagram signals limits that way is unverified.
- Reposts show no age in the list; the cleaner relies on Instagram's date filter for them, which was not checked against an item of known date.
