# Custom Match History for Deadlock

Deadlock doesn't list private lobby matches in your match history. This mod adds a **Custom Matches** view to the in-game match history page, and clicking a match opens the game's own match screen.

**Status:** test build. Not ready for release.

## How it works

1. When a custom match ends, the mod reads the match ID and mode from the post-game screen and saves the ID under your account. It skips a match you weren't in.
2. The Custom Matches view lists saved matches, plus any the [Deadlock API](https://deadlock-api.com) already knows for that account. On another player's profile, it lists what the API knows for them.
3. Clicking a match, or pasting a match ID, asks the game to open its own match screen.

The game has disabled direct web requests from mods, so saving and listing go through the small page in `docs/index.html`, opened in a hidden in-game browser panel and hosted on GitHub Pages.

## Privacy

- Saved match IDs stay in this PC's in-game browser storage, stored per account.
- The list request sends the account ID of the profile you're viewing to the Deadlock API, a third-party service.
- Loading the helper page contacts GitHub Pages.

## Files the mod changes

It replaces two game layouts and keeps Valve's panels in both:

- `panorama/layout/citadel_db_page_profile_match_history.vxml_c`
- `panorama/layout/citadel_db_page_private_lobby.vxml_c`

It doesn't inject code, change game binaries or write to Steam's cache. Another mod that replaces either layout will conflict with it.

## Limits

- Only matches played with the mod installed are saved automatically. Older matches need a pasted match ID.
- Saved matches stay on the PC that saved them.
- Custom match detection relies on the "(Lobby)" label, and only the English wording has been tested.

## Build

```
npm install
npm run build
```

This writes `build/pak90_dir.vpk`. To check the logic outside the game:

```
node tools/simulate.mjs <account id> <match id>
```

This mod isn't affiliated with Valve or the Deadlock API.
