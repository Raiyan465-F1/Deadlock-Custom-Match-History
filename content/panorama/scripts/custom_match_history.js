"use strict";
// Custom Match History, test build 5.
//
// Loaded by two layouts:
//  - hud_match_end: notices a custom match when it ends and saves its ID.
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
	var REQUEST_TIMEOUT_SECONDS = 15;
	// Hero names from the Deadlock API's assets list. New heroes show as "Hero <id>".
	var HERO_NAMES = {
		1: "Infernus", 2: "Seven", 3: "Vindicta", 4: "Lady Geist", 6: "Abrams", 7: "Wraith", 8: "McGinnis", 10: "Paradox",
		11: "Dynamo", 12: "Kelvin", 13: "Haze", 14: "Holliday", 15: "Bebop", 16: "Calico", 17: "Grey Talon", 18: "Mo & Krill",
		19: "Shiv", 20: "Ivy", 25: "Warden", 27: "Yamato", 31: "Lash", 35: "Viscous", 50: "Pocket", 52: "Mirage", 58: "Vyper",
		60: "Sinclair", 63: "Mina", 64: "Drifter", 65: "Venator", 66: "Victor", 67: "Paige", 69: "The Doorman", 72: "Billy",
		76: "Graves", 77: "Apollo", 78: "Deadman Danny", 79: "Rem", 80: "Silver", 81: "Celeste", 84: "Rat King", 85: "Solomon",
		86: "Violet", 87: "Nurse Harrow", 88: "Baba",
	};

	var root = $.GetContextPanel();
	var state = {
		context: root.FindChildTraverse("CmhToggle") ? "history page" : "match end",
		account: "",
		accountSource: "",
		loaded: false,
		loading: false,
		requestCount: 0,
		seenPostGameIds: {},
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

	function accountFromGameApi() {
		if (typeof Game === "undefined" || !Game || typeof Game.GetLocalPlayerInfo !== "function") return "";
		var info = Game.GetLocalPlayerInfo();
		if (!info) return "";
		var keys = ["player_steamid", "steamid", "steamid64", "steamid32", "xuid", "account_id"];
		for (var i = 0; i < keys.length; i++) {
			var account = toAccountId(info[keys[i]]);
			if (account) return account;
		}
		return "";
	}

	function accountFromProfileLabels() {
		var top = topRoot();
		if (!top || !top.FindChildrenWithClassTraverse) return "";
		var labels = top.FindChildrenWithClassTraverse("FriendID") || [];
		for (var i = 0; i < labels.length; i++) {
			var match = String(labels[i].text || "").match(/[0-9]{6,}/);
			if (match) {
				var account = toAccountId(match[0]);
				if (account) return account;
			}
		}
		return "";
	}

	function resolveAccount() {
		if (state.account) return state.account;
		var sources = [
			["profile label", accountFromProfileLabels],
			["game api", accountFromGameApi],
		];
		for (var i = 0; i < sources.length; i++) {
			var account = "";
			try {
				account = sources[i][1]();
			} catch (e) {
				log("account source failed: " + sources[i][0] + ": " + e);
			}
			log("account source " + sources[i][0] + " -> " + (account || "none"));
			if (account) {
				state.account = account;
				state.accountSource = sources[i][0];
				return account;
			}
		}
		return "";
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
		var account = resolveAccount() || UNKNOWN_ACCOUNT;
		browserRequest(
			"save:" + account + ":" + matchId + ":" + encodeURIComponent(label),
			function (rows) {
				log("saved match " + matchId + " under account " + account + ", page now lists " + rows.length);
				if (onDone) onDone(rows);
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
	function addCard(list, row) {
		var matchId = row[0];
		var won = row[3];
		var block = $.CreatePanel("Panel", list, "");
		block.AddClass("cmhBlock");
		if (won === 1) block.AddClass("win");
		if (won === 0) block.AddClass("loss");
		// Attach the click first, so a drawing problem can't leave a dead card.
		block.hittest = true;
		block.SetPanelEvent("onactivate", function () {
			openMatch(matchId);
		});
		try {
			var stripe = $.CreatePanel("Panel", block, "");
			stripe.AddClass("teamStripe");
			stripe.hittest = false;
			var info = $.CreatePanel("Panel", block, "");
			info.AddClass("gameInfo");
			info.hittest = false;
			addLabel(info, "cmhResult", won === 1 ? "Win" : won === 0 ? "Loss" : row[1] || "Custom Match");
			if (row[4] !== null) addLabel(info, "cmhLine", HERO_NAMES[row[4]] || "Hero " + row[4]);
			if (row[5] !== null) addLabel(info, "cmhLine", row[5] + " / " + row[6] + " / " + row[7] + "    " + formatNumber(row[8]) + " souls");
			addLabel(info, "cmhDim", String(row[2] || "") + (row[9] ? "    " + formatDuration(row[9]) : ""));
			addLabel(info, "cmhDim", "Match " + matchId);
		} catch (e) {
			setStatus("Could not draw a match card: " + e);
			log("card draw failed: " + e);
		}
	}

	function renderList(rows) {
		var list = find("CmhList");
		list.RemoveAndDeleteChildren();
		for (var i = 0; i < rows.length; i++) addCard(list, rows[i]);
		setStatus(rows.length ? rows.length + " custom matches. Click one to open it." : "No custom matches saved yet. Play one, or paste a match ID above.");
	}

	// ---- actions ----

	function loadMatches() {
		if (state.loading) return;
		var account = resolveAccount();
		if (!account) {
			setStatus("Could not find your account ID. Open your profile page first, then try again.");
			return;
		}
		state.loading = true;
		setStatus("Loading custom matches...");
		browserRequest(
			"list:" + account,
			function (rows) {
				state.loading = false;
				state.loaded = true;
				log("loaded " + rows.length + " matches");
				renderList(rows);
			},
			function (reason) {
				state.loading = false;
				setStatus("Could not load the list, but pasting a match ID still works. Click Custom Matches twice to retry.");
				log("load failed: " + reason);
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
		if (active && !state.loaded) loadMatches();
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
			state.seenPostGameIds[match[0]] = true;
			var custom = isCustomLabel(label);
			log("post-game match id " + match[0] + " mode label '" + label + "' custom=" + custom);
			if (custom) {
				saveMatch(match[0], label.replace(/\s*\(.*$/, ""), function (rows) {
					if (find("CmhList")) renderList(rows);
				});
			}
		}
	}

	function watchPostGame() {
		try {
			checkPostGame();
		} catch (e) {
			log("post-game check failed: " + e);
		}
		$.Schedule(POST_GAME_POLL_SECONDS, watchPostGame);
	}

	// ---- start ----

	function init() {
		log("loaded, test build 5");
		var toggle = find("CmhToggle");
		if (toggle) toggle.SetPanelEvent("onactivate", onToggle);
		var open = find("CmhIdOpen");
		if (open) open.SetPanelEvent("onactivate", onOpenTyped);
		watchPostGame();
	}

	$.Schedule(0.1, init);
})();
