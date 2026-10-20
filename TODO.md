# TODO

## Instagram Toolkit

- "Instagram Download Button" still worked for a gallery photo in an opened post on 2026-10-20 (full size, named user-date-id); its feedback reports videos and stories failing, which was not tried. Replace it with our own only if those fail when actually needed.

## Footprint cleaners for other platforms

Same shape as the Instagram cleaner: a cutoff, count first, oldest year first, paced batches under run and daily caps, stop on any sign of a restriction, ask before any trial deletion. Each starts with a design conversation.

- X (Twitter): its web UI has no date-filtered bulk delete; research whether the account archive plus the web UI is the way.
- Facebook: Activity Log appears to offer date filters and bulk actions; verify live.

## Known limits of the Instagram cleaner

- Count still stops with "Instagram did not refresh the list after the filter was applied" on 2026.10.20.1, after the fix that waits for the old "No results" element to go; reproduce it with the run's tab and year logged before changing the turnover check again.
- An activity tab that has never held anything is recognised by `EMPTY_TAB_TEXT` (`No … activity`), but Story replies says "You haven't responded to any stickers" instead, so a run reaching that tab would wait for a toolbar that never comes.
- On 2026-10-20 Story replies showed that empty state on every load, shortly after a few replies had been deleted by hand; check whether any were left and the list is failing to load, or the tab is genuinely empty.
- The 429 hook has never fired live, so whether Instagram signals limits that way is unverified.
- Reposts show no age in the list; the cleaner relies on Instagram's date filter for them, which was not checked against an item of known date.
