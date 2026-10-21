# TODO

## Instagram Toolkit

- Resume removing likes on or before 2016-12-31. On 2026-10-21 about 140 were removed, all from the oldest end of 2015, and Instagram began slowing down: the done message took 45 s, then 3.5 min, and still 80 s several hours later. Resume after at least 12 h with the tab in front; if the first batch's done message takes more than a few seconds, stop for the day. The user approved deleting everything on or before 2016-12-31.
- The story download needs the story's id in the address, which the viewer adds only after stepping to another story, so the story it opens on asks the user to step away and back. Reading the opening story's id would mean the user's id for `/api/v1/feed/reels_media/?reel_ids=`, and `/api/v1/users/web_profile_info/` answered 429 after three requests on 2026-10-20. Highlights are left out because their address carries the highlight's id.

## Footprint cleaners for other platforms

Same shape as the Instagram cleaner: a cutoff, count first, oldest year first, paced batches under run and daily caps, stop on any sign of a restriction, ask before any trial deletion. Each starts with a design conversation.

- X (Twitter): its web UI has no date-filtered bulk delete; research whether the account archive plus the web UI is the way.
- Facebook: Activity Log appears to offer date filters and bulk actions; verify live.

## Known limits of the Instagram cleaner

- Count's numbers are lower bounds and say so. Instagram loads a long list in bursts with long pauses, so the same list (Likes 2016) read 27, 162, 198 and 207 on 2026-10-20 and 21 depending on how long it was scrolled; a year shown as "none" is exact. An exact count would have to come from Instagram's data export ("Download your information"). Start does not depend on it: it removes from the top until Instagram shows "No results".
- Instagram does not reliably update a page whose tab is hidden, which caused every stop that would not reproduce in a tab in front; runs hold while the tab is hidden. A stop with the tab in front would be a new cause.
- On 2026-10-20 Story replies showed that empty state on every load, shortly after a few replies had been deleted by hand; check whether any were left and the list is failing to load, or the tab is genuinely empty.
- The 429 hook has never fired live, so whether Instagram signals limits that way is unverified.
- Confirm a batch from the network rather than the toast, as dodosack/instagram-activity-cleaner (MIT with attribution) and LeandreBl/instagram-cleaner (Unlicense) do: the response status of the `/async/wbloks/fetch` request with `type=action` (a URL with `_next` is pagination). First prove inside Tampermonkey that the `unsafeWindow.fetch` wrapper sees those requests; counting all wbloks requests already misled the list loader once.
- Prior art reports Reposts' bulk delete showing a "deleted" toast while the repost stays; check the list after a Reposts batch before trusting the toast there.
- Reposts show no age in the list; the cleaner relies on Instagram's date filter for them, which was not checked against an item of known date.
