# TODO

## Instagram Toolkit

- The story download needs the story's id in the address, which the viewer adds only after stepping to another story, so the story it opens on asks the user to step away and back. Reading the opening story's id would mean the user's id for `/api/v1/feed/reels_media/?reel_ids=`, and `/api/v1/users/web_profile_info/` answered 429 after three requests on 2026-10-20. Highlights are left out because their address carries the highlight's id.

## Footprint cleaners for other platforms

Same shape as the Instagram cleaner: a cutoff, count first, oldest year first, paced batches under run and daily caps, stop on any sign of a restriction, ask before any trial deletion. Each starts with a design conversation.

- X (Twitter): its web UI has no date-filtered bulk delete; research whether the account archive plus the web UI is the way.
- Facebook: Activity Log appears to offer date filters and bulk actions; verify live.

## Known limits of the Instagram cleaner

- Count still stopped with "Instagram did not refresh the list after the filter was applied" on 2026.10.20.1, after the fix that waits for the old "No results" element to go. The message now names the list, the range, whether the dialog closed and what the list showed; change the turnover check only once a stop has reported those.
- On 2026-10-20 Story replies showed that empty state on every load, shortly after a few replies had been deleted by hand; check whether any were left and the list is failing to load, or the tab is genuinely empty.
- The 429 hook has never fired live, so whether Instagram signals limits that way is unverified.
- Reposts show no age in the list; the cleaner relies on Instagram's date filter for them, which was not checked against an item of known date.
