# Algorithm B: the challenger

Algorithm A (`watch.js`) is the main search. Algorithm B runs next to it for the bot owner, under the **same rules**
as the owner's preferences, with one goal: find a cheaper valid trip than A. Each daily run records which one won
(stored encrypted in the owner's state). When B wins, its method is adopted into A and B moves on to the next blind spot.

## What the research says about finding cheap fares

| Technique | What it means | Use here |
|---|---|---|
| Two one-ways vs. round trip | A round trip is often cheaper, but mixing carriers per direction can beat it | A compares both |
| Mixed carriers on **one** ticket | One booking: outbound on one carrier, return on another | Adopted into A (Kiwi) |
| Search engine blind spots | Each search shows only its N cheapest results; filters shape what gets priced | B searches smaller date windows |
| Connections on the return | A 1-stop return can price lower than nonstop, even on the same airline | Adopted into A (Kayak, Kiwi) |
| Self-transfer / virtual interlining | Separate tickets combined by an agency; cheaper but no protection | B3, flagged as unprotected |
| Point of sale | The country you buy from can change the price | Kayak Israel and Australia |
| Day of week | Studies disagree (Tue/Wed, Thu, Fri) | Not used as a rule: every allowed date is searched |
| Hidden-city / throwaway tickets | Booking past your destination and skipping a leg | **Not used**: breaks airline rules |
| Basic fare + paid bag | Cheaper fares often exclude the checked bag | Bag rule: only prices with a bag can alert |

## History of improvements

1. B found single tickets with the return on any airline, and returns with one stop, that A did not search.
   Both were adopted into A.
2. B moved on to Kiwi searches in 3 × 3 date windows (each Kiwi search returns only its 15 cheapest results).
3. A data analysis of a full run (~1,200 results) found:
   - Kayak's cheapest fares are often without a checked bag ("bag fee unknown"). Kayak Israel now searches with its
     bag filter (`bfc=1`), and only prices with a known checked bag can trigger an alert.
   - Kayak's `stops=~1` means *exactly* one stop; `stops=0,1` is "up to one".
   - Kayak Israel and Kayak Australia priced the same trips within ~$1 on average.
   - The return date drove the price much more than the outbound date.

## Sources

- [Round-trip vs. two one-ways](https://farefinderai.com/blog/round-trip-vs-one-way-flights)
- [Cheapest way to fly multi-city](https://www.ratepunk.com/blog/how-to-score-the-cheapest-multi-city-flights)
- [Virtual interlining (AltexSoft)](https://www.altexsoft.com/glossary/virtual-interlining/) · [IATA: virtual interline considerations](https://www.iata.org/contentassets/e7a533819be440edbb1e49da96e0f2a8/virtual-interline-considerations-for-airlines.pdf) · [Self-transfer risks](https://www.outboundvisa.com/blog/risks-of-self-transfer-flights)
- [Cheapest day to fly: Frommers on a large fare study](https://www.frommers.com/tips/airfare/when-to-book-airfares-and-fly-to-save-the-most-a-new-and-massive-study-has-some-answers/) · [Expedia 2026 data](https://www.travelagentcentral.com/transportation/friday-now-cheapest-day-fly-and-book-2026-expedia-data)
