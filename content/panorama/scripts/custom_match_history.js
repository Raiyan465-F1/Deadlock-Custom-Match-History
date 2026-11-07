"use strict";
// Custom Match History 1.0.0.
//
// Loaded by two dashboard layouts, both of which can see the post-game screen:
//  - citadel_db_page_private_lobby: loaded before a custom match starts, so the match is
//    saved when it ends even if the history page was never opened.
//  - citadel_db_page_profile_match_history: adds the Custom Matches view.
//
// The game has disabled $.AsyncWebRequest and its browser panel won't open data: URLs, so
// saving and loading go through the small page in docs/index.html, opened in a hidden
// browser panel. Every step is logged with the [CMH] prefix.

(function () {
	var PAGE_URL = "https://raiyan465-f1.github.io/Deadlock-Custom-Match-History/";
	var UNKNOWN_ACCOUNT = "0";
	var STEAM64_BASE = "76561197960265728";
	var POST_GAME_POLL_SECONDS = 2;
	var POST_GAME_WAIT_POLLS = 5;
	var REQUEST_TIMEOUT_SECONDS = 15;
	var RELOAD_AFTER_MS = 15000;
	var CONFIRM_SECONDS = 4;
	var VERSION = "1.0.0";
	// Hero names from the Deadlock API's assets list. New heroes show as "Hero <id>".
	var HERO_NAMES = {
		1: "Infernus", 2: "Seven", 3: "Vindicta", 4: "Lady Geist", 6: "Abrams", 7: "Wraith", 8: "McGinnis", 10: "Paradox",
		11: "Dynamo", 12: "Kelvin", 13: "Haze", 14: "Holliday", 15: "Bebop", 16: "Calico", 17: "Grey Talon", 18: "Mo & Krill",
		19: "Shiv", 20: "Ivy", 25: "Warden", 27: "Yamato", 31: "Lash", 35: "Viscous", 50: "Pocket", 52: "Mirage", 58: "Vyper",
		60: "Sinclair", 63: "Mina", 64: "Drifter", 65: "Venator", 66: "Victor", 67: "Paige", 69: "The Doorman", 72: "Billy",
		76: "Graves", 77: "Apollo", 78: "Deadman Danny", 79: "Rem", 80: "Silver", 81: "Celeste", 84: "Rat King", 85: "Solomon",
		86: "Violet", 87: "Nurse Harrow", 88: "Baba",
	};

	// Portrait file names, from the game's scripts/heroes.vdata. Heroes not listed show no portrait.
	var HERO_ART = {
		1: "inferno", 2: "gigawatt", 3: "hornet", 4: "spectre", 6: "bull", 7: "wraith", 8: "engineer", 10: "chrono",
		11: "sumo", 12: "kelvin", 13: "haze", 14: "astro", 15: "bebop", 16: "nano", 17: "archer", 18: "digger",
		19: "shiv", 20: "tengu", 25: "warden", 27: "yamato", 31: "lash", 35: "viscous", 50: "synth", 52: "mirage",
		58: "kali", 60: "magician", 63: "vampirebat", 64: "drifter", 65: "priest", 66: "frank", 67: "bookworm",
		69: "doorman", 72: "punkgoat", 76: "necro", 77: "fencer", 78: "deadpack", 79: "familiar", 80: "werewolf",
		81: "unicorn", 84: "ratking", 85: "chessmaster", 86: "artist", 87: "nurse", 88: "baba",
	};
	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	var root = $.GetContextPanel();
	var state = {
		context: root.FindChildTraverse("CmhToggle") ? "history page" : "lobby page",
		account: "",
		localUser: null,
		listedAccount: "",
		lastLoadTime: 0,
		loading: false,
		reloadWhenDone: false,
		requestCount: 0,
		seenPostGameIds: {},
		postGameWaits: {},
		confirmRemove: "",
	};

	function log(text) {
		try {
			$.Msg("[CMH] (" + state.context + ") " + text);
		} catch (e) {}
	}

	function find(id) {
		return root.FindChildTraverse(id);
	}

	function setStatus(text) {
		var label = find("CmhStatus");
		if (label) label.text = text;
	}

	function topRoot() {
		var panel = root;
		var guard = 0;
		while (panel && panel.GetParent && panel.GetParent() && guard < 64) {
			panel = panel.GetParent();
			guard++;
		}
		return panel;
	}

	// ---- account id ----

	function toAccountId(value) {
		var text = String(value === undefined || value === null ? "" : value).replace(/[^0-9]/g, "");
		if (!text) return "";
		if (text.length >= 15) {
			try {
				text = (BigInt(text) - BigInt(STEAM64_BASE)).toString();
			} catch (e) {
				return "";
			}
		}
		var number = Number(text);
		return number >= 100000 && number <= 4294967295 ? text : "";
	}

	// A hidden name panel set to "local" reports the logged-in account from anywhere in the
	// dashboard, so it doesn't depend on the profile page being loaded.
	function localAccount() {
		if (state.account) return state.account;
		try {
			if (!state.localUser) {
				state.localUser = $.CreatePanel("CitadelUserName", root, "CmhLocalUser", { accountid: "local" });
				state.localUser.hittest = false;
				state.localUser.style.visibility = "collapse";
			}
			state.account = toAccountId(state.localUser.accountid) || toAccountId(state.localUser.steamid);
		} catch (e) {
			log("account read failed: " + e);
		}
		if (state.account) log("local account " + state.account);
		return state.account;
	}

	// The profile page can be showing someone else, and its name panel reports whose it is.
	function viewedAccount() {
		var top = topRoot();
		var name = top && top.FindChildTraverse ? top.FindChildTraverse("SelfName") : null;
		return (name && toAccountId(name.accountid)) || localAccount();
	}

	// ---- hidden browser panel ----

	function browserRequest(request, onDone, onFail) {
		state.requestCount++;
		var bridge = $.CreatePanel("CitadelHTMLPanel", root, "CmhBridge" + state.requestCount);
		if (!bridge) {
			onFail("could not create CitadelHTMLPanel");
			return;
		}
		bridge.hittest = false;
		bridge.style.width = "0px";
		bridge.style.height = "0px";
		bridge.style.opacity = "0";

		var finished = false;
		function finish() {
			finished = true;
			bridge.DeleteAsync(0);
		}

		$.RegisterEventHandler("HTMLTitle", bridge, function (panel, title) {
			var text = String(title === undefined ? panel : title);
			log("page title (" + text.length + " chars): " + text.substring(0, 60));
			if (finished || text.indexOf("CMH|") !== 0) return;
			finish();
			var body = text.substring(4);
			if (body.indexOf("ERR:") === 0) {
				onFail("page reported: " + body.substring(4));
				return;
			}
			try {
				onDone(JSON.parse(body));
			} catch (e) {
				onFail("bad page response: " + e);
			}
		});
		$.Schedule(REQUEST_TIMEOUT_SECONDS, function () {
			if (finished) return;
			finish();
			onFail("page did not answer within " + REQUEST_TIMEOUT_SECONDS + "s");
		});

		bridge.SetURL(PAGE_URL + "#" + request);
		log("page request sent: " + request);
	}

	function saveMatch(matchId, label, onDone) {
		var account = localAccount() || UNKNOWN_ACCOUNT;
		browserRequest(
			"save:" + account + ":" + matchId + ":" + encodeURIComponent(label),
			function () {
				log("saved match " + matchId + " under account " + account);
				if (onDone) onDone();
			},
			function (reason) {
				log("save failed for " + matchId + ": " + reason);
			}
		);
	}

	// ---- rendering ----

	function addLabel(parent, className, text) {
		var label = $.CreatePanel("Label", parent, "");
		if (className) label.AddClass(className);
		label.hittest = false;
		label.text = text;
		return label;
	}

	function addPanel(parent, className, id) {
		var panel = $.CreatePanel("Panel", parent, id || "");
		if (className) panel.AddClass(className);
		panel.hittest = false;
		return panel;
	}

	function addHeroImage(parent, hero) {
		if (!HERO_ART[hero]) return;
		var image = $.CreatePanel("Image", parent, "");
		image.AddClass("heroImg");
		image.hittest = false;
		image.SetImage("s2r://panorama/images/heroes/" + HERO_ART[hero] + "_card_psd.vtex");
		image.SetScaling("stretch-to-cover-preserve-aspect");
	}

	function viewDetailsText() {
		var token = "#Citadel_Profile_MatchHistory_ViewDetails";
		var text = $.Localize(token);
		return text && text !== token ? text : "View Details";
	}

	// The page sends UTC like "2026-11-01 16:50 UTC". This shows it in the player's time zone.
	function formatTime(value) {
		var text = String(value || "");
		var parts = text.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d) UTC$/);
		if (!parts) return text;
		var date = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5]));
		var minutes = date.getMinutes();
		return MONTHS[date.getMonth()] + " " + date.getDate() + ", " + (date.getHours() % 12 || 12) + ":" + (minutes < 10 ? "0" : "") + minutes + (date.getHours() < 12 ? " AM" : " PM");
	}

	function formatNumber(value) {
		// toLocaleString appears to throw in the game's script engine.
		var number = Number(value);
		return isNaN(number) ? "-" : String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	}

	function formatDuration(seconds) {
		var total = Number(seconds) || 0;
		var rest = total % 60;
		return Math.floor(total / 60) + ":" + (rest < 10 ? "0" : "") + rest;
	}

	// Each row from the page: [match id, mode label, time, won, hero, kills, deaths, assists, souls, duration].
	// Only the ID is certain. The others are null when the Deadlock API doesn't know the match.
	// The game won't let scripts create its own match card, so this copies that card's layout
	// and uses its style classes. The remove button sits beside the card, not inside it, so
	// clicking it can't also open the match.
	function addCard(list, row, removable) {
		var matchId = row[0];
		var won = row[3];
		var hero = row[4];
		var wrap = addPanel(list, "cmhCardWrap");
		var block = $.CreatePanel("Panel", wrap, "");
		block.AddClass("matchBlock");
		block.AddClass("cmhBlock");
		block.AddClass(won === 1 ? "win" : won === 0 ? "loss" : "cmhUnknown");
		// Attach the click first, so a drawing problem can't leave a dead card.
		block.hittest = true;
		block.SetPanelEvent("onactivate", function () {
			openMatch(matchId);
		});
		try {
			addPanel(block, "teamStripe");
			var content = addPanel(block, "gameContent");
			var info = addPanel(content, "gameInfo");
			var resultRow = addPanel(info, "", "gameResultRow");
			addLabel(resultRow, "gameResult", won === 1 ? "Win" : won === 0 ? "Loss" : "Custom");
			addLabel(resultRow, "gameMode", row[1] || "");
			addLabel(info, "heroName", hero === null ? "Match " + matchId : HERO_NAMES[hero] || "Hero " + hero);
			if (row[5] !== null) addLabel(info, "cmhKda", row[5] + " / " + row[6] + " / " + row[7]);
			if (row[9]) addLabel(info, "gameDuration", formatDuration(row[9]));
			addLabel(info, "gameDate", formatTime(row[2]));
			addHeroImage(content, hero);
			if (row[8] !== null) addLabel(content, "gameNetworth", formatNumber(row[8]));
			var overlay = addPanel(block, "", "Overlay");
			var details = addPanel(overlay, "viewDetails");
			addLabel(details, "", viewDetailsText());
			addPanel(details, "arrowIcon");
			addLabel(overlay, "cmhMatchId", "Match " + matchId);
		} catch (e) {
			setStatus("Could not draw a match card: " + e);
			log("card draw failed: " + e);
		}
		if (removable) addRemoveButton(wrap, String(matchId));
	}

	// The first click asks for a second one, so a stray click can't remove a match.
	function addRemoveButton(parent, matchId) {
		var button = $.CreatePanel("Panel", parent, "");
		button.AddClass("cmhRemove");
		button.hittest = true;
		var label = addLabel(button, "", "Remove");
		button.SetPanelEvent("onactivate", function () {
			if (state.confirmRemove !== matchId) {
				state.confirmRemove = matchId;
				button.AddClass("cmhConfirm");
				label.text = "Confirm";
				setStatus("Click Confirm to remove match " + matchId + " from your list.");
				$.Schedule(CONFIRM_SECONDS, function () {
					if (state.confirmRemove === matchId) state.confirmRemove = "";
					try {
						if (button.IsValid && !button.IsValid()) return;
						button.RemoveClass("cmhConfirm");
						label.text = "Remove";
					} catch (e) {}
				});
				return;
			}
			state.confirmRemove = "";
			removeMatch(matchId);
		});
	}

	function renderList(rows) {
		var list = find("CmhList");
		list.RemoveAndDeleteChildren();
		// Only the logged-in player's own list can be changed.
		var removable = state.listedAccount !== "" && state.listedAccount === localAccount();
		for (var i = 0; i < rows.length; i++) addCard(list, rows[i], removable);
		if (!rows.length) {
			setStatus(state.listedAccount === localAccount() ? "No custom matches saved yet. Play one, or paste a match ID above." : "No custom matches found for this player.");
			return;
		}
		setStatus(rows.length + (rows.length === 1 ? " custom match" : " custom matches") + ". Click one to open it.");
	}

	// ---- actions ----

	function finishLoading() {
		state.loading = false;
		if (state.reloadWhenDone) {
			state.reloadWhenDone = false;
			loadMatches();
		}
	}

	function loadMatches() {
		if (state.loading) {
			state.reloadWhenDone = true;
			return;
		}
		var account = viewedAccount();
		if (!account) {
			setStatus("Could not find your account ID. Click Custom Matches twice to try again.");
			return;
		}
		// Don't leave one player's cards on another player's profile if the load fails.
		if (account !== state.listedAccount) find("CmhList").RemoveAndDeleteChildren();
		state.listedAccount = account;
		state.loading = true;
		setStatus("Loading custom matches...");
		browserRequest(
			(account === localAccount() ? "list:" : "view:") + account,
			function (rows) {
				state.lastLoadTime = Date.now();
				log("loaded " + rows.length + " matches");
				renderList(rows);
				finishLoading();
			},
			function (reason) {
				setStatus("Could not load the list, but pasting a match ID still works. Click Custom Matches twice to retry.");
				log("load failed: " + reason);
				finishLoading();
			}
		);
	}

	// Removes a saved match and hides it if the Deadlock API lists it, on this PC only.
	function removeMatch(matchId) {
		var account = localAccount();
		if (!account || state.loading) {
			setStatus("Wait for the list to finish loading, then try again.");
			return;
		}
		state.loading = true;
		setStatus("Removing match " + matchId + "...");
		browserRequest(
			"hide:" + account + ":" + matchId,
			function (rows) {
				state.lastLoadTime = Date.now();
				log("removed match " + matchId);
				renderList(rows);
				setStatus("Removed match " + matchId + ". To add it back, paste its ID above and open it.");
				finishLoading();
			},
			function (reason) {
				setStatus("Could not remove match " + matchId + ". Try again.");
				log("remove failed: " + reason);
				finishLoading();
			}
		);
	}

	function openMatch(matchId) {
		var id = String(matchId);
		log("opening match " + id);
		try {
			$.DispatchEvent("CitadelShowMatchDetails", id);
		} catch (e) {
			setStatus("Could not open match " + id + ": " + e);
			log("open failed: " + e);
		}
	}

	function onOpenTyped() {
		var entry = find("CmhIdEntry");
		var match = String(entry ? entry.text : "").match(/[0-9]{6,20}/);
		if (!match) {
			setStatus("Paste a match ID first. It's the number at the top right of the match screen.");
			return;
		}
		openMatch(match[0]);
	}

	function onToggle() {
		var active = !root.BHasClass("CmhActive");
		root.SetHasClass("CmhActive", active);
		log("toggle " + (active ? "on" : "off"));
		// The other copy of the script may have saved a match since the last load.
		if (active && (Date.now() - state.lastLoadTime > RELOAD_AFTER_MS || viewedAccount() !== state.listedAccount)) loadMatches();
	}

	// A save only answers with saved matches, so the full list has to be loaded again.
	function onMatchSaved() {
		state.lastLoadTime = 0;
		if (root.BHasClass("CmhActive")) loadMatches();
	}

	// ---- saving custom matches when they end ----

	function textOf(panel) {
		return panel && panel.text !== undefined ? String(panel.text) : "";
	}

	// English shows "Standard Match (Lobby)" and "Street Brawl (Lobby)". Other languages
	// haven't been checked, so any bracketed label counts.
	function isCustomLabel(label) {
		return /\(.+\)/.test(label);
	}

	function classCount(page, className) {
		return page.FindChildrenWithClassTraverse ? (page.FindChildrenWithClassTraverse(className) || []).length : 0;
	}

	// The same history page is reused for other players' profiles.
	function checkViewedAccount() {
		if (root.BHasClass("CmhActive") && state.listedAccount && viewedAccount() !== state.listedAccount) loadMatches();
	}

	function checkPostGame() {
		var top = topRoot();
		var page = top && top.FindChildTraverse ? top.FindChildTraverse("CitadelPostGameNew") : null;
		var pages = page ? [page] : top && top.FindChildrenWithClassTraverse ? top.FindChildrenWithClassTraverse("DashboardPage") : [];
		for (var i = 0; i < pages.length; i++) {
			if (!pages[i].FindChildTraverse) continue;
			var match = textOf(pages[i].FindChildTraverse("MatchID")).match(/[0-9]{6,}/);
			if (!match || state.seenPostGameIds[match[0]]) continue;
			var modes = pages[i].FindChildrenWithClassTraverse ? pages[i].FindChildrenWithClassTraverse("MatchMode") : [];
			var label = textOf(modes[0]);
			if (!isCustomLabel(label)) {
				state.seenPostGameIds[match[0]] = true;
				log("post-game match id " + match[0] + " mode label '" + label + "' is not custom");
				continue;
			}
			// The scoreboard marks the local player's row. Wait a little in case the rows are still
			// loading, then skip a match the player wasn't in. With no rows at all there is nothing
			// to check, and keeping the match is the safer mistake.
			var inMatch = classCount(pages[i], "IsLocalPlayer") > 0;
			var waits = (state.postGameWaits[match[0]] || 0) + 1;
			state.postGameWaits[match[0]] = waits;
			if (!inMatch && waits < POST_GAME_WAIT_POLLS) continue;
			state.seenPostGameIds[match[0]] = true;
			var rows = classCount(pages[i], "Player");
			log("post-game match id " + match[0] + " mode label '" + label + "' in match=" + inMatch + " rows=" + rows);
			if (inMatch || !rows) {
				saveMatch(match[0], label.replace(/\s*\(.*$/, ""), onMatchSaved);
			}
		}
	}

	function watchPostGame() {
		try {
			checkPostGame();
			checkViewedAccount();
		} catch (e) {
			log("post-game check failed: " + e);
		}
		$.Schedule(POST_GAME_POLL_SECONDS, watchPostGame);
	}

	// ---- start ----

	function init() {
		log("loaded, version " + VERSION);
		localAccount();
		var toggle = find("CmhToggle");
		if (toggle) toggle.SetPanelEvent("onactivate", onToggle);
		var open = find("CmhIdOpen");
		if (open) open.SetPanelEvent("onactivate", onOpenTyped);
		watchPostGame();
	}

	$.Schedule(0.1, init);
})();
