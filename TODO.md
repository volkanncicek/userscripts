# TODO

## Instagram Toolkit, second release

- Move the gallery counter (`instagram-gallery-photo-counter.user.js`) into the Toolkit, then remove the old script from the repo and README.
- Reimplement "Instagram: Arrow Keys for Multi-Image Posts" (left/right between images, Shift+arrows between posts, Esc closes a post) after checking its licence; drop it from `third-party.md`.
- Reimplement "Instagram non-English link redirector" (strip the `hl` language parameter), fixing upstream's habit of stripping any query that merely contains "hl"; drop it from `third-party.md`.
- Check whether "Instagram Download Button" still works; if not, decide between replacing it and relying on "Download Original Picture".

## Footprint cleaners for other platforms

Same shape as the Instagram cleaner: a cutoff, count first, oldest year first, paced batches under run and daily caps, stop on any sign of a restriction, ask before any trial deletion. Each starts with a design conversation.

- X (Twitter): its web UI has no date-filtered bulk delete; research whether the account archive plus the web UI is the way.
- Facebook: Activity Log appears to offer date filters and bulk actions; verify live.

## Known limits of the Instagram cleaner

- The 429 hook has never fired live, so whether Instagram signals limits that way is unverified.
- Reposts show no age in the list; the cleaner relies on Instagram's date filter for them, which was not checked against an item of known date.
