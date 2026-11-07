# Custom Match History for Deadlock

Deadlock doesn't list private lobby matches in your match history. This mod adds a **Custom Matches** button to the in-game match history page. Clicking a match opens the game's own match screen with the full stats.

**Version:** 1.0.0

## Using it

- Open a profile, go to **Match History** and click **Custom Matches**. Click it again to go back to the normal list.
- Click a card to open that match.
- To open any match by its ID, paste the ID in the box and click **Open**. The match ID is the number at the top right of a match screen. A player's account ID won't work there.
- To take a match off your list, click **Remove** on its card, then **Confirm**. To add it back, paste its ID and open it.

## How it works

1. When a custom match ends, the mod reads the match ID and mode from the end-of-match screen and saves the ID under your account. It skips a match you weren't in. Opening an older custom match you played saves it the same way.
2. The Custom Matches view lists saved matches, plus any the [Deadlock API](https://deadlock-api.com) already knows for that account. On another player's profile, it lists what the API knows for them.
3. Clicking a match, or pasting a match ID, asks the game to open its own match screen.

The game has disabled direct web requests from mods, so saving and listing go through the small page in `docs/index.html`, opened in a hidden in-game browser panel and hosted on GitHub Pages.

## Privacy

- Saved and removed match IDs stay in this PC's in-game browser storage, stored per account.
- Listing matches sends the account ID of the profile you're viewing to the Deadlock API, a third-party service.
- Loading the helper page contacts GitHub Pages.

## Files the mod changes

It replaces two game layouts and keeps all of Valve's panels in both:

- `panorama/layout/citadel_db_page_profile_match_history.vxml_c`
- `panorama/layout/citadel_db_page_private_lobby.vxml_c`

It doesn't inject code, change game binaries or write to Steam's cache. Another mod that replaces either layout will conflict with it. QoL Lite doesn't replace either one, and the mod works with or without it.

## Limits

- Stats on a card come from the Deadlock API. A new match shows as a plain card until the API has it, which can take hours, and some matches never get stats there. Clicking the card still opens the game's match screen.
- Custom matches played before installing the mod only show if the Deadlock API knows them.
- Other players' lists only show what the Deadlock API knows.
- Saved matches stay on the PC that saved them.
- Custom match detection relies on the "(Lobby)" label, and only the English game text has been tested.
- A game update that changes the match history or private lobby page can break the mod until it's updated.

## Build

```
npm install
npm run build
```

This writes `build/pak90_dir.vpk`. To check the logic outside the game:

```
node tools/simulate.mjs <account id> <match id>
```

## License

MIT. See [LICENSE](LICENSE).

This mod isn't affiliated with Valve or the Deadlock API.
