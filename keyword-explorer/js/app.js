/* Keyword Explorer by Delf Studio
   Free layer: Google, YouTube and Amazon autocomplete, called straight from the browser.
   Paid layer: the visitor's own DataForSEO account (Labs and SERP APIs). The login is kept
   in this browser and sent only to api.dataforseo.com. No server, no build step. */
(function () {
  "use strict";

  // ---------- small helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) {
    if (n == null || isNaN(n)) return "";
    n = Number(n);
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e4) return Math.round(n / 1e3) + "K";
    return Math.round(n).toLocaleString("en-US");
  }
  function money(n) { return n == null || isNaN(n) ? "" : "$" + Number(n).toFixed(2); }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ""; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function cleanKw(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function show(el, on) { el.classList.toggle("hidden", !on); }
  function say(id, text, kind) {
    var el = $(id);
    el.className = "msg" + (text ? " " + (kind || "info") : "");
    el.textContent = text || "";
  }

  var store = {
    get: function (k, area) {
      try { var v = (area || localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (k, v, area) {
      try { (area || localStorage).setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
      try { sessionStorage.removeItem(k); } catch (e) {}
    }
  };

  // ---------- markets ----------
  // code: DataForSEO location_code. gl: Google country for autocomplete.
  var LOCATIONS = [
    { code: 2784, gl: "ae", name: "United Arab Emirates" },
    { code: 2840, gl: "us", name: "United States" },
    { code: 2826, gl: "gb", name: "United Kingdom" },
    { code: 2608, gl: "ph", name: "Philippines" },
    { code: 2392, gl: "jp", name: "Japan" },
    { code: 2634, gl: "qa", name: "Qatar" },
    { code: 2682, gl: "sa", name: "Saudi Arabia" },
    { code: 2356, gl: "in", name: "India" },
    { code: 2036, gl: "au", name: "Australia" },
    { code: 2124, gl: "ca", name: "Canada" },
    { code: 2702, gl: "sg", name: "Singapore" },
    { code: 2276, gl: "de", name: "Germany" },
    { code: 2250, gl: "fr", name: "France" }
  ];
  var LANGS = [
    { code: "en", name: "English" },
    { code: "ar", name: "Arabic" },
    { code: "ja", name: "Japanese" },
    { code: "tl", name: "Filipino" },
    { code: "fr", name: "French" },
    { code: "de", name: "German" },
    { code: "es", name: "Spanish" },
    { code: "hi", name: "Hindi" }
  ];
  function fillSelect(sel, items, val) {
    sel.innerHTML = items.map(function (o) {
      return '<option value="' + esc(o.code) + '">' + esc(o.name) + "</option>";
    }).join("");
    if (val != null) sel.value = String(val);
  }
  var prefs = store.get("ks-prefs") || { loc: 2784, lang: "en" };
  fillSelect($("loc"), LOCATIONS, prefs.loc);
  fillSelect($("site-loc"), LOCATIONS, prefs.loc);
  fillSelect($("lang"), LANGS, prefs.lang);
  function market() {
    var code = Number($("loc").value);
    var loc = LOCATIONS.filter(function (l) { return l.code === code; })[0] || LOCATIONS[0];
    return { loc: loc, lang: $("lang").value };
  }
  function savePrefs() { store.set("ks-prefs", { loc: Number($("loc").value), lang: $("lang").value }); }
  $("loc").addEventListener("change", function () { $("site-loc").value = $("loc").value; savePrefs(); });
  $("site-loc").addEventListener("change", function () { $("loc").value = $("site-loc").value; savePrefs(); });
  $("lang").addEventListener("change", savePrefs);

  // ---------- tabs ----------
  var tabs = document.querySelectorAll("nav.tabs button");
  function openTab(name) {
    tabs.forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("section.tab").forEach(function (s) { s.classList.toggle("on", s.id === "tab-" + name); });
    if (name === "lists") renderLists();
  }
  tabs.forEach(function (b) { b.addEventListener("click", function () { openTab(b.dataset.tab); }); });
  document.addEventListener("click", function (e) {
    var go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); openTab(go.dataset.go); }
  });

  // ---------- DataForSEO ----------
  var CRED_KEY = "ks-d4";
  var sessionCost = 0;
  function getCreds() { return store.get(CRED_KEY) || store.get(CRED_KEY, sessionStorage); }
  function hasCreds() { var c = getCreds(); return !!(c && c.login && c.pass); }
  function updateConn() {
    var on = hasCreds();
    $("conn-note").textContent = on ? "DataForSEO connected" : "Free mode";
    $("conn-note").classList.toggle("on", on);
    $("cost-note").textContent = sessionCost > 0 ? "This visit: $" + sessionCost.toFixed(4) : "";
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }

  function d4(path, body) {
    var c = getCreds();
    if (!c) return Promise.reject(new Error("Connect your DataForSEO account first (Connect data tab)."));
    var opts = {
      method: body ? "POST" : "GET",
      headers: { "Authorization": "Basic " + b64(c.login + ":" + c.pass) }
    };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch("https://api.dataforseo.com/v3/" + path, opts).catch(function () {
      throw new Error("Could not reach DataForSEO. Check your internet connection. If it keeps happening, a browser extension or your network may be blocking api.dataforseo.com.");
    }).then(function (r) {
      if (r.status === 401) throw new Error("DataForSEO did not accept the login. Use the API login and API password from the API Access page, not your dashboard password.");
      if (r.status === 402) throw new Error("Your DataForSEO balance has run out. Top it up in the DataForSEO dashboard.");
      return r.json().catch(function () { throw new Error("DataForSEO sent back something unexpected (HTTP " + r.status + ")."); });
    }).then(function (j) {
      if (typeof j.cost === "number") { sessionCost += j.cost; updateConn(); }
      if (j.status_code !== 20000) throw new Error("DataForSEO: " + (j.status_message || "request failed"));
      var t = j.tasks && j.tasks[0];
      if (!t) throw new Error("DataForSEO returned no result.");
      if (t.status_code !== 20000) throw new Error("DataForSEO: " + (t.status_message || "request failed"));
      return t.result || [];
    });
  }

  // Turn a DataForSEO Labs keyword object into one flat row.
  function fromLabs(o) {
    o = o || {};
    var ki = o.keyword_info || {}, kp = o.keyword_properties || {}, si = o.search_intent_info || {};
    return {
      keyword: cleanKw(o.keyword),
      vol: ki.search_volume, cpc: ki.cpc, comp: ki.competition_level,
      kd: kp.keyword_difficulty, intent: si.main_intent,
      trend: (ki.monthly_searches || []).slice()
    };
  }

  // ---------- connect tab ----------
  (function () {
    var c = getCreds();
    if (c) { $("d4-login").value = c.login || ""; $("d4-pass").value = c.pass || ""; $("d4-remember").checked = !!store.get(CRED_KEY); }
  })();
  $("d4-save").addEventListener("click", function () {
    var login = $("d4-login").value.trim(), pass = $("d4-pass").value.trim();
    if (!login || !pass) { say("d4-msg", "Enter both the API login and the API password.", "err"); return; }
    store.del(CRED_KEY);
    store.set(CRED_KEY, { login: login, pass: pass }, $("d4-remember").checked ? localStorage : sessionStorage);
    say("d4-msg", "Checking...", "info");
    d4("appendix/user_data").then(function (res) {
      var m = res[0] && res[0].money;
      updateConn();
      say("d4-msg", "Connected." + (m && m.balance != null ? " Balance: $" + Number(m.balance).toFixed(2) + "." : "") + " Go back to Keyword Explorer and search again to see the full data.", "ok");
    }).catch(function (e) {
      store.del(CRED_KEY); updateConn();
      say("d4-msg", e.message, "err");
    });
  });
  $("d4-clear").addEventListener("click", function () {
    store.del(CRED_KEY); $("d4-pass").value = ""; updateConn();
    say("d4-msg", "Disconnected. Your login has been removed from this browser.", "ok");
  });
  updateConn();

  // ---------- autocomplete (free) ----------
  function jsonp(url, ms) {
    return new Promise(function (resolve, reject) {
      var cb = "ksjp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var s = document.createElement("script");
      var timer = setTimeout(function () { done(); reject(new Error("timeout")); }, ms || 8000);
      function done() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
      window[cb] = function (data) { done(); resolve(data); };
      s.onerror = function () { done(); reject(new Error("blocked")); };
      s.src = url + "&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  var ENGINES = {
    google: function (q, m) {
      return jsonp("https://suggestqueries.google.com/complete/search?client=firefox&hl=" + m.lang + "&gl=" + m.loc.gl + "&q=" + encodeURIComponent(q))
        .then(function (d) { return (d && d[1]) || []; });
    },
    youtube: function (q, m) {
      return jsonp("https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=" + m.lang + "&gl=" + m.loc.gl + "&q=" + encodeURIComponent(q))
        .then(function (d) { return ((d && d[1]) || []).map(function (x) { return Array.isArray(x) ? x[0] : x; }); });
    },
    amazon: function (q) {
      return fetch("https://completion.amazon.com/api/2017/suggestions?limit=11&prefix=" + encodeURIComponent(q) +
        "&suggestion-type=KEYWORD&page-type=Gateway&lop=en_US&site-variant=desktop&client-info=amazon-search-ui&mid=ATVPDKIKX0DER&alias=aps")
        .then(function (r) { return r.json(); })
        .then(function (d) { return ((d && d.suggestions) || []).map(function (x) { return x.value; }); });
    }
  };
  var QWORDS = ["how", "what", "why", "where", "when", "which", "who", "can", "is", "are", "does", "best"];
  var TAILS = ["for", "with", "without", "near", "vs", "or", "to", "in", "like", "and", "cost", "2026"];
  function acQueries(seed) {
    var q = [seed];
    "abcdefghijklmnopqrstuvwxyz".split("").forEach(function (c) { q.push(seed + " " + c); });
    QWORDS.forEach(function (w) { q.push(w + " " + seed); });
    TAILS.forEach(function (w) { q.push(seed + " " + w); });
    return q;
  }
  function pool(items, size, fn, onStep) {
    var i = 0, doneCount = 0;
    function next() {
      if (i >= items.length) return Promise.resolve();
      var item = items[i++];
      return fn(item).then(function () {}, function () {}).then(function () {
        doneCount++; if (onStep) onStep(doneCount, items.length);
        return sleep(60).then(next);
      });
    }
    var workers = [];
    for (var k = 0; k < Math.min(size, items.length); k++) workers.push(next());
    return Promise.all(workers);
  }

  // ---------- explorer state ----------
  var S = {
    seed: "", runId: 0,
    ideas: [], ticked: new Set(),
    sort: { key: null, dir: "desc" },
    cache: {}
  };
  var QRE = /^(how|what|why|where|when|which|who|whom|whose|can|could|is|are|was|does|do|did|should|will|would)\b/;
  var CRE = /\b(vs|versus|or|alternative|alternatives|compared|comparison|better than)\b/;

  function ideaType(k) {
    if (QRE.test(k) || /\?$/.test(k)) return "q";
    if (CRE.test(k)) return "cmp";
    return "";
  }

  $("kw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    explore(cleanKw($("kw-in").value));
  });

  function explore(kw) {
    if (!kw) return;
    $("kw-in").value = kw;
    savePrefs();
    S.seed = kw; S.runId++; S.ideas = []; S.ticked = new Set(); S.sort = { key: null, dir: "desc" };
    $("ideas-filter").value = ""; $("ideas-type").value = "all";
    say("kw-msg", ""); say("ideas-msg", "");
    show($("kw-out"), true);
    var m = market();
    $("trends-link").href = "https://trends.google.com/trends/explore?q=" + encodeURIComponent(kw) + "&geo=" + m.loc.gl.toUpperCase();

    if (!hasCreds()) {
      var src = document.querySelector('input[name=src]:checked');
      if (src.value !== "auto") document.querySelector('input[name=src][value=auto]').checked = true;
    }
    renderStatsLoading();
    loadIdeas();

    if (hasCreds()) {
      loadOverview(kw, m, S.runId);
      loadSerp(kw, m, S.runId);
    } else {
      $("serp-box").innerHTML = '<p class="empty">Connect DataForSEO to see who ranks for this keyword right now. <a href="#" data-go="connect">Connect data</a></p>';
    }
    $("kw-out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- overview ----------
  function kdInfo(v) {
    if (v == null) return ["", "var(--muted)"];
    if (v < 15) return ["Very easy", "var(--kd1)"];
    if (v < 30) return ["Easy", "var(--kd2)"];
    if (v < 50) return ["Possible", "var(--kd3)"];
    if (v < 70) return ["Hard", "var(--kd4)"];
    if (v < 85) return ["Very hard", "var(--kd5)"];
    return ["Super hard", "var(--kd6)"];
  }
  function kdHtml(v, big) {
    if (v == null) return "";
    var i = kdInfo(v);
    return '<span class="kd' + (big ? " big" : "") + '" style="--kdc:' + i[1] + '" title="' + esc(i[0]) + '">' + Math.round(v) + "</span>";
  }
  function trendHtml(months) {
    var list = (months || []).filter(function (x) { return x && x.year; }).sort(function (a, b) {
      return a.year - b.year || a.month - b.month;
    }).slice(-12);
    if (!list.length) return '<small>No trend data</small>';
    var max = Math.max.apply(null, list.map(function (x) { return x.search_volume || 0; })) || 1;
    var mn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var bars = list.map(function (x) {
      var h = Math.max(4, Math.round(((x.search_volume || 0) / max) * 100));
      return '<i style="height:' + h + '%" title="' + mn[x.month - 1] + " " + x.year + ": " + num(x.search_volume || 0) + '"></i>';
    }).join("");
    var a = list[0], b = list[list.length - 1];
    return '<div class="trend">' + bars + '</div><div class="trend-lbl"><span>' + mn[a.month - 1] + " " + a.year + "</span><span>" + mn[b.month - 1] + " " + b.year + "</span></div>";
  }
  function renderStatsLoading() {
    if (!hasCreds()) {
      $("kw-stats").innerHTML =
        '<div class="stat" style="grid-column:1/-1"><span>Free mode</span><small style="font-size:14px;margin-top:6px">You are seeing autocomplete ideas only. To add search volume, keyword difficulty, CPC, a 12-month trend and the top 10 results, <a href="#" data-go="connect">connect your DataForSEO account</a>.</small></div>';
      return;
    }
    $("kw-stats").innerHTML = ["Monthly searches", "Keyword difficulty", "Cost per click", "Search intent", "Last 12 months"].map(function (l) {
      return '<div class="stat"><b>...</b><span>' + l + "</span></div>";
    }).join("");
  }
  function loadOverview(kw, m, run) {
    d4("dataforseo_labs/google/keyword_overview/live", [{ keywords: [kw], location_code: m.loc.code, language_code: m.lang }])
      .then(function (res) {
        if (run !== S.runId) return;
        var item = res[0] && res[0].items && res[0].items[0];
        if (!item) {
          $("kw-stats").innerHTML = '<div class="stat" style="grid-column:1/-1"><b>No data yet</b><span>DataForSEO has no figures for this keyword in ' + esc(m.loc.name) + '. It may be very new or very rare. Autocomplete ideas below still show what people type.</span></div>';
          return;
        }
        var r = fromLabs(item), k = kdInfo(r.kd);
        $("kw-stats").innerHTML =
          '<div class="stat"><b>' + (r.vol != null ? num(r.vol) : "0") + '</b><span>Monthly searches</span><small>' + esc(m.loc.name) + "</small></div>" +
          '<div class="stat">' + (r.kd != null ? kdHtml(r.kd, true) : "<b>n/a</b>") + '<span>Keyword difficulty</span><small>' + esc(k[0] || "Not enough data") + "</small></div>" +
          '<div class="stat"><b>' + (r.cpc != null ? money(r.cpc) : "n/a") + '</b><span>Cost per click</span><small>' + (r.comp ? "Ad competition: " + esc(cap(r.comp)) : "Google Ads, USD") + "</small></div>" +
          '<div class="stat"><b class="word">' + esc(cap(r.intent) || "n/a") + '</b><span>Search intent</span><small>' + esc(intentNote(r.intent)) + "</small></div>" +
          '<div class="stat"><span>Last 12 months</span>' + trendHtml(r.trend) + "</div>";
      })
      .catch(function (e) {
        if (run !== S.runId) return;
        $("kw-stats").innerHTML = "";
        say("kw-msg", e.message, "err");
      });
  }
  function intentNote(i) {
    return { informational: "People want to learn", navigational: "Looking for a site", commercial: "Comparing before buying", transactional: "Ready to buy or book" }[String(i || "").toLowerCase()] || "";
  }

  // ---------- SERP ----------
  var FEATURE_NAMES = {
    featured_snippet: "Featured snippet", people_also_ask: "People also ask", local_pack: "Map pack", images: "Images",
    video: "Videos", top_stories: "Top stories", knowledge_graph: "Knowledge panel", ai_overview: "AI overview",
    shopping: "Shopping", related_searches: "Related searches", twitter: "X posts", perspectives: "Perspectives",
    discussions_and_forums: "Forums", short_videos: "Short videos", hotels_pack: "Hotels", map: "Map", paid: "Ads"
  };
  function loadSerp(kw, m, run) {
    $("serp-box").innerHTML = '<p class="empty">Loading the top 10...</p>';
    d4("serp/google/organic/live/regular", [{ keyword: kw, location_code: m.loc.code, language_code: m.lang, depth: 10 }])
      .then(function (res) {
        if (run !== S.runId) return;
        var r = res[0] || {}, items = r.items || [];
        var org = items.filter(function (x) { return x.type === "organic"; }).slice(0, 10);
        var paa = [];
        items.forEach(function (x) {
          if (x.type === "people_also_ask" && x.items) x.items.forEach(function (q) { if (q.title) paa.push(q.title); });
        });
        var feats = (r.item_types || []).filter(function (t) { return t !== "organic"; }).map(function (t) {
          return '<span class="pill">' + esc(FEATURE_NAMES[t] || cap(t.replace(/_/g, " "))) + "</span>";
        }).join(" ");
        var html = feats ? '<p class="hint" style="margin-bottom:10px">On this results page: ' + feats + "</p>" : "";
        if (!org.length) html += '<p class="empty">No organic results came back.</p>';
        else {
          html += '<div class="tablewrap"><table><tr><th class="num">#</th><th>Page</th></tr>' + org.map(function (x) {
            return '<tr><td class="num">' + esc(x.rank_group) + '</td><td><div style="font-weight:500">' + esc(x.title || x.domain) +
              '</div><div class="url" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:13px"><a href="' + esc(x.url) + '" target="_blank" rel="noopener nofollow">' + esc(x.domain) + esc(pathOf(x.url)) + "</a></div></td></tr>";
          }).join("") + "</table></div>";
        }
        if (paa.length) {
          html += '<h3>People also ask</h3><ul>' + paa.map(function (q) {
            return '<li><button class="kwlink" type="button" data-explore="' + esc(cleanKw(q)) + '">' + esc(q) + "</button></li>";
          }).join("") + "</ul>";
          addIdeas(paa.map(function (q) { return { keyword: cleanKw(q.replace(/\?$/, "")) }; }), true);
        }
        $("serp-box").innerHTML = html;
      })
      .catch(function (e) {
        if (run !== S.runId) return;
        $("serp-box").innerHTML = '<p class="msg err" style="display:block">' + esc(e.message) + "</p>";
      });
  }
  function pathOf(u) { try { var p = new URL(u).pathname; return p === "/" ? "" : p; } catch (e) { return ""; } }

  // ---------- ideas ----------
  function addIdeas(rows, keepOrder) {
    var map = {};
    S.ideas.forEach(function (r) { map[r.keyword] = r; });
    rows.forEach(function (r) {
      if (!r.keyword) return;
      if (map[r.keyword]) {
        ["vol", "kd", "cpc", "comp", "intent", "trend"].forEach(function (k) { if (r[k] != null) map[r.keyword][k] = r[k]; });
      } else {
        map[r.keyword] = r; S.ideas.push(r);
      }
    });
    renderIdeas();
  }
  function loadIdeas() {
    var src = document.querySelector('input[name=src]:checked').value;
    var m = market(), run = S.runId, seed = S.seed;
    show($("ac-engine"), src === "auto");
    say("ideas-msg", "");
    if (!seed) return;
    if (src !== "auto" && !hasCreds()) {
      document.querySelector('input[name=src][value=auto]').checked = true;
      say("ideas-msg", "Matching and related terms come from DataForSEO. Connect your account in the Connect data tab to use them.", "warn");
      return loadIdeas();
    }
    var cacheKey = src + "|" + (src === "auto" ? document.querySelector('input[name=engine]:checked').value + "|" : "") + seed + "|" + m.loc.code + "|" + m.lang;
    S.ideas = []; S.ticked = new Set();
    if (S.cache[cacheKey]) { addIdeas(S.cache[cacheKey].map(function (r) { return Object.assign({}, r); })); setHint(src); return; }
    setHint(src);
    renderIdeas();

    if (src === "auto") {
      var engine = document.querySelector('input[name=engine]:checked').value;
      var qs = acQueries(seed), found = [], seen = {}, ok = 0;
      var prog = $("ideas-prog"), bar = prog.querySelector("i");
      show(prog, true); bar.style.width = "0";
      var fn = ENGINES[engine];
      // Try the plain keyword first. If the engine does not answer at all, stop instead of sending 50 more requests.
      var first = qs.shift();
      fn(first, m).then(function (list) { return list; }, function () {
        return fn(first, m).then(function (list) { return list; }, function () { return null; });
      }).then(function (firstList) {
      if (run !== S.runId) return;
      if (firstList === null) { qs = []; }
      else {
        ok++;
        var b0 = [];
        firstList.forEach(function (s) { var k = cleanKw(s); if (k && !seen[k]) { seen[k] = 1; var row = { keyword: k }; found.push(row); b0.push(row); } });
        if (b0.length) addIdeas(b0);
      }
      return pool(qs, engine === "amazon" ? 2 : 3, function (q) {
        return fn(q, m).then(function (list) {
          ok++;
          if (run !== S.runId) return;
          var batch = [];
          list.forEach(function (s) {
            var k = cleanKw(s);
            if (k && !seen[k]) { seen[k] = 1; var row = { keyword: k }; found.push(row); batch.push(row); }
          });
          if (batch.length) addIdeas(batch);
        });
      }, function (d, t) { if (run === S.runId) bar.style.width = Math.round((d / t) * 100) + "%"; })
        .then(function () {
          if (run !== S.runId) return;
          show(prog, false);
          if (!ok) {
            say("ideas-msg", engine === "amazon"
              ? "Amazon did not answer from this browser. Amazon sometimes blocks requests from other websites. Try Google or YouTube instead."
              : "Autocomplete did not answer. A browser extension (such as a tracker or ad blocker) may be blocking suggestqueries.google.com, or Google is limiting quick repeat requests. Wait a minute and try again.", "err");
          } else {
            S.cache[cacheKey] = found.map(function (r) { return Object.assign({}, r); });
            if (!found.length) say("ideas-msg", "No suggestions came back for this phrase. Try a shorter or more general keyword.", "warn");
          }
        });
      });
      return;
    }

    say("ideas-msg", "Loading from DataForSEO...", "info");
    var req = src === "match"
      ? d4("dataforseo_labs/google/keyword_suggestions/live", [{ keyword: seed, location_code: m.loc.code, language_code: m.lang, limit: 300, include_seed_keyword: false, order_by: ["keyword_info.search_volume,desc"] }])
        .then(function (res) { return ((res[0] && res[0].items) || []).map(fromLabs); })
      : d4("dataforseo_labs/google/related_keywords/live", [{ keyword: seed, location_code: m.loc.code, language_code: m.lang, depth: 2, limit: 300, order_by: ["keyword_data.keyword_info.search_volume,desc"] }])
        .then(function (res) { return ((res[0] && res[0].items) || []).map(function (x) { return fromLabs(x.keyword_data); }); });
    req.then(function (rows) {
      if (run !== S.runId) return;
      rows = rows.filter(function (r) { return r.keyword && r.keyword !== seed; });
      S.cache[cacheKey] = rows.map(function (r) { return Object.assign({}, r); });
      S.sort = { key: "vol", dir: "desc" };
      addIdeas(rows);
      say("ideas-msg", rows.length ? "" : "DataForSEO has no " + (src === "match" ? "matching" : "related") + " terms for this keyword in this country.", rows.length ? "" : "warn");
    }).catch(function (e) { if (run === S.runId) say("ideas-msg", e.message, "err"); });
  }
  function setHint(src) {
    $("ideas-hint").textContent = {
      auto: "Phrases people actually type, collected by adding letters, question words and common endings to your keyword. Free. Tick the ones you like to get their numbers.",
      match: "Keywords that contain your words, sorted by search volume.",
      related: "Keywords Google shows as related searches, two levels deep. Good for finding angles you had not thought of."
    }[src];
  }
  document.querySelectorAll('input[name=src], input[name=engine]').forEach(function (r) {
    r.addEventListener("change", function () { if (S.seed) loadIdeas(); else show($("ac-engine"), document.querySelector('input[name=src]:checked').value === "auto"); });
  });

  function visibleIdeas() {
    var f = cleanKw($("ideas-filter").value), t = $("ideas-type").value;
    var rows = S.ideas.filter(function (r) {
      if (f && r.keyword.indexOf(f) < 0) return false;
      if (t === "q" && ideaType(r.keyword) !== "q") return false;
      if (t === "cmp" && ideaType(r.keyword) !== "cmp") return false;
      if (t === "long" && r.keyword.split(" ").length < 4) return false;
      return true;
    });
    if (S.sort.key) {
      var k = S.sort.key, d = S.sort.dir === "asc" ? 1 : -1;
      rows = rows.slice().sort(function (a, b) {
        var x = a[k], y = b[k];
        if (k === "keyword" || k === "intent") return d * String(x || "").localeCompare(String(y || ""));
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return d * (x - y);
      });
    }
    return rows;
  }
  function sortTh(key, label, cls) {
    var dir = S.sort.key === key ? S.sort.dir : "";
    return '<th class="sort ' + (cls || "") + '" data-sort="' + key + '"' + (dir ? ' data-dir="' + dir + '"' : "") + ">" + label + "</th>";
  }
  function renderIdeas() {
    var rows = visibleIdeas(), shown = rows.slice(0, 600);
    $("ideas-count").textContent = S.ideas.length ? rows.length + " of " + S.ideas.length + " ideas" + (S.ticked.size ? ", " + S.ticked.size + " ticked" : "") : "";
    if (!S.ideas.length) { $("ideas-table").innerHTML = '<p class="empty">Ideas will appear here.</p>'; return; }
    if (!rows.length) { $("ideas-table").innerHTML = '<p class="empty">Nothing matches that filter.</p>'; return; }
    var allOn = shown.every(function (r) { return S.ticked.has(r.keyword); });
    $("ideas-table").innerHTML = '<table><thead><tr><th class="cb"><input type="checkbox" id="ideas-all" aria-label="Tick all shown"' + (allOn ? " checked" : "") + "></th>" +
      sortTh("keyword", "Keyword") + sortTh("vol", "Volume", "num") + sortTh("kd", "KD", "num") + sortTh("cpc", "CPC", "num") + sortTh("intent", "Intent") +
      "</tr></thead><tbody>" + shown.map(function (r) {
        return '<tr><td class="cb"><input type="checkbox" data-kw="' + esc(r.keyword) + '"' + (S.ticked.has(r.keyword) ? " checked" : "") + ' aria-label="Tick ' + esc(r.keyword) + '"></td>' +
          '<td class="kw"><button class="kwlink" type="button" data-explore="' + esc(r.keyword) + '" title="Explore this keyword">' + esc(r.keyword) + "</button></td>" +
          '<td class="num">' + num(r.vol) + '</td><td class="num">' + kdHtml(r.kd) + '</td><td class="num">' + money(r.cpc) + "</td>" +
          "<td>" + (r.intent ? '<span class="pill">' + esc(cap(r.intent)) + "</span>" : "") + "</td></tr>";
      }).join("") + "</tbody></table>" + (rows.length > shown.length ? '<p class="hint">Showing the first 600. Use the filter or export the CSV for the rest.</p>' : "");
  }
  $("ideas-filter").addEventListener("input", renderIdeas);
  $("ideas-type").addEventListener("change", renderIdeas);
  $("ideas-table").addEventListener("click", function (e) {
    var th = e.target.closest("th[data-sort]");
    if (th) {
      var k = th.dataset.sort;
      var text = k === "keyword" || k === "intent";
      var dir = S.sort.key === k ? (S.sort.dir === "asc" ? "desc" : "asc") : (text ? "asc" : "desc");
      S.sort = { key: k, dir: dir };
      renderIdeas();
    }
  });
  $("ideas-table").addEventListener("change", function (e) {
    if (e.target.id === "ideas-all") {
      visibleIdeas().slice(0, 600).forEach(function (r) { if (e.target.checked) S.ticked.add(r.keyword); else S.ticked.delete(r.keyword); });
      renderIdeas();
    } else if (e.target.dataset.kw) {
      if (e.target.checked) S.ticked.add(e.target.dataset.kw); else S.ticked.delete(e.target.dataset.kw);
      $("ideas-count").textContent = visibleIdeas().length + " of " + S.ideas.length + " ideas" + (S.ticked.size ? ", " + S.ticked.size + " ticked" : "");
    }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-explore]");
    if (b) { e.preventDefault(); openTab("explore"); explore(b.dataset.explore); }
  });

  function tickedOrVisible() {
    var t = S.ideas.filter(function (r) { return S.ticked.has(r.keyword); });
    return t.length ? t : null;
  }

  // Fetch volume and difficulty for a set of keywords, 700 at a time.
  function fetchMetrics(keywords, m) {
    var batches = [];
    for (var i = 0; i < keywords.length; i += 700) batches.push(keywords.slice(i, i + 700));
    var out = [];
    return batches.reduce(function (p, b) {
      return p.then(function () {
        return d4("dataforseo_labs/google/keyword_overview/live", [{ keywords: b, location_code: m.loc.code, language_code: m.lang }])
          .then(function (res) { ((res[0] && res[0].items) || []).forEach(function (x) { out.push(fromLabs(x)); }); });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  $("ideas-metrics").addEventListener("click", function () {
    if (!hasCreds()) { say("ideas-msg", "Volume and difficulty come from DataForSEO. Connect your account in the Connect data tab first.", "warn"); return; }
    var rows = tickedOrVisible();
    if (!rows) { say("ideas-msg", "Tick the keywords you want numbers for first.", "warn"); return; }
    var kws = rows.map(function (r) { return r.keyword; }), m = market(), run = S.runId;
    say("ideas-msg", "Getting numbers for " + kws.length + " keywords...", "info");
    $("ideas-metrics").disabled = true;
    fetchMetrics(kws, m).then(function (res) {
      if (run !== S.runId) return;
      var got = {};
      res.forEach(function (r) { got[r.keyword] = 1; });
      kws.forEach(function (k) { if (!got[k]) res.push({ keyword: k, vol: 0 }); });
      S.sort = { key: "vol", dir: "desc" };
      addIdeas(res);
      say("ideas-msg", "Done. Keywords with no data are shown with 0 searches.", "ok");
    }).catch(function (e) { say("ideas-msg", e.message, "err"); })
      .then(function () { $("ideas-metrics").disabled = false; });
  });

  // ---------- export and copy ----------
  function csvCell(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadCsv(name, cols, rows) {
    var lines = [cols.map(function (c) { return csvCell(c[1]); }).join(",")];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(r[c[0]]); }).join(",")); });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function copyText(text, msgId) {
    var done = function () { say(msgId, "Copied to the clipboard.", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) { say(msgId, "Could not copy. Select and copy the keywords from the CSV instead.", "err"); }
      t.remove();
    }
  }
  var IDEA_COLS = [["keyword", "Keyword"], ["vol", "Monthly searches"], ["kd", "Keyword difficulty"], ["cpc", "CPC (USD)"], ["comp", "Ad competition"], ["intent", "Intent"]];
  $("ideas-csv").addEventListener("click", function () {
    var rows = tickedOrVisible() || visibleIdeas();
    if (!rows.length) { say("ideas-msg", "There are no ideas to export yet.", "warn"); return; }
    downloadCsv("keywords-" + S.seed, IDEA_COLS, rows);
  });
  $("ideas-copy").addEventListener("click", function () {
    var rows = tickedOrVisible() || visibleIdeas();
    if (!rows.length) { say("ideas-msg", "There are no ideas to copy yet.", "warn"); return; }
    copyText(rows.map(function (r) { return r.keyword; }).join("\n"), "ideas-msg");
  });

  // ---------- lists ----------
  function getLists() {
    var L = store.get("ks-lists");
    if (!L || !L.lists) L = { lists: {}, current: "" };
    return L;
  }
  function saveLists(L) { store.set("ks-lists", L); }
  function saveToList(rows, msgId) {
    if (!rows || !rows.length) { say(msgId, "Tick the keywords you want to save first.", "warn"); return; }
    var L = getLists();
    if (!L.current || !L.lists[L.current]) {
      var names = Object.keys(L.lists);
      L.current = names[0] || "My keywords";
      if (!L.lists[L.current]) L.lists[L.current] = [];
    }
    var list = L.lists[L.current], have = {}, m = market(), added = 0;
    list.forEach(function (r) { have[r.keyword] = r; });
    rows.forEach(function (r) {
      var item = { keyword: r.keyword, vol: r.vol, kd: r.kd, cpc: r.cpc, intent: r.intent, pos: r.pos, url: r.url, country: m.loc.name, added: new Date().toISOString().slice(0, 10) };
      if (have[r.keyword]) {
        ["vol", "kd", "cpc", "intent"].forEach(function (k) { if (item[k] != null) have[r.keyword][k] = item[k]; });
      } else { list.push(item); added++; }
    });
    saveLists(L);
    say(msgId, "Saved " + added + " new keyword" + (added === 1 ? "" : "s") + ' to "' + L.current + '". Pick a different list in My lists to save somewhere else.', "ok");
  }
  $("ideas-save").addEventListener("click", function () { saveToList(tickedOrVisible(), "ideas-msg"); });

  var listTicked = new Set();
  function renderLists() {
    var L = getLists(), names = Object.keys(L.lists);
    if (!names.length) { L.lists["My keywords"] = []; L.current = "My keywords"; saveLists(L); names = ["My keywords"]; }
    if (!L.lists[L.current]) { L.current = names[0]; saveLists(L); }
    $("list-pick").innerHTML = names.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + " (" + L.lists[n].length + ")</option>";
    }).join("");
    $("list-pick").value = L.current;
    var rows = L.lists[L.current];
    if (!rows.length) { $("list-table").innerHTML = '<p class="empty">This list is empty. Tick keywords in Keyword Explorer or Site Explorer and choose "Save ticked to a list".</p>'; return; }
    $("list-table").innerHTML = '<table><thead><tr><th class="cb"><input type="checkbox" id="list-all" aria-label="Tick all"></th><th>Keyword</th><th class="num">Volume</th><th class="num">KD</th><th class="num">CPC</th><th>Intent</th><th>Country</th><th>Added</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="cb"><input type="checkbox" data-lkw="' + esc(r.keyword) + '"' + (listTicked.has(r.keyword) ? " checked" : "") + "></td>" +
          '<td class="kw"><button class="kwlink" type="button" data-explore="' + esc(r.keyword) + '">' + esc(r.keyword) + "</button></td>" +
          '<td class="num">' + num(r.vol) + '</td><td class="num">' + kdHtml(r.kd) + '</td><td class="num">' + money(r.cpc) + "</td><td>" +
          (r.intent ? '<span class="pill">' + esc(cap(r.intent)) + "</span>" : "") + '</td><td class="hint">' + esc(r.country || "") + '</td><td class="hint">' + esc(r.added || "") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  $("list-pick").addEventListener("change", function () { var L = getLists(); L.current = this.value; saveLists(L); listTicked = new Set(); say("list-msg", ""); renderLists(); });
  $("list-new").addEventListener("click", function () {
    var n = (prompt("Name for the new list, for example Wonders of Japan:") || "").trim();
    if (!n) return;
    var L = getLists();
    if (L.lists[n]) { say("list-msg", "A list with that name already exists.", "warn"); return; }
    L.lists[n] = []; L.current = n; saveLists(L); renderLists();
    say("list-msg", 'Created "' + n + '". New saves go here.', "ok");
  });
  $("list-rename").addEventListener("click", function () {
    var L = getLists(), old = L.current;
    var n = (prompt("New name for this list:", old) || "").trim();
    if (!n || n === old) return;
    if (L.lists[n]) { say("list-msg", "A list with that name already exists.", "warn"); return; }
    L.lists[n] = L.lists[old]; delete L.lists[old]; L.current = n; saveLists(L); renderLists();
  });
  $("list-del").addEventListener("click", function () {
    var L = getLists();
    if (!confirm('Delete the list "' + L.current + '" and its ' + L.lists[L.current].length + " keywords?")) return;
    delete L.lists[L.current]; L.current = Object.keys(L.lists)[0] || ""; saveLists(L); renderLists();
  });
  $("list-table").addEventListener("change", function (e) {
    if (e.target.id === "list-all") {
      getLists().lists[getLists().current].forEach(function (r) { if (e.target.checked) listTicked.add(r.keyword); else listTicked.delete(r.keyword); });
      renderLists();
    } else if (e.target.dataset.lkw) {
      if (e.target.checked) listTicked.add(e.target.dataset.lkw); else listTicked.delete(e.target.dataset.lkw);
    }
  });
  $("list-remove").addEventListener("click", function () {
    if (!listTicked.size) { say("list-msg", "Tick the keywords to remove first.", "warn"); return; }
    var L = getLists();
    L.lists[L.current] = L.lists[L.current].filter(function (r) { return !listTicked.has(r.keyword); });
    var n = listTicked.size; listTicked = new Set(); saveLists(L); renderLists();
    say("list-msg", "Removed " + n + ".", "ok");
  });
  $("list-csv").addEventListener("click", function () {
    var L = getLists(), rows = L.lists[L.current] || [];
    if (!rows.length) { say("list-msg", "This list is empty.", "warn"); return; }
    downloadCsv(L.current, IDEA_COLS.concat([["country", "Country"], ["added", "Added"]]), rows);
  });
  $("list-copy").addEventListener("click", function () {
    var L = getLists(), rows = L.lists[L.current] || [];
    if (!rows.length) { say("list-msg", "This list is empty.", "warn"); return; }
    copyText(rows.map(function (r) { return r.keyword; }).join("\n"), "list-msg");
  });
  $("list-refresh").addEventListener("click", function () {
    if (!hasCreds()) { say("list-msg", "Connect DataForSEO in the Connect data tab to refresh the numbers.", "warn"); return; }
    var L = getLists(), name = L.current, rows = L.lists[name] || [];
    if (!rows.length) { say("list-msg", "This list is empty.", "warn"); return; }
    var m = market();
    say("list-msg", "Refreshing " + rows.length + " keywords for " + m.loc.name + "...", "info");
    fetchMetrics(rows.map(function (r) { return r.keyword; }), m).then(function (res) {
      var by = {};
      res.forEach(function (r) { by[r.keyword] = r; });
      var L2 = getLists();
      (L2.lists[name] || []).forEach(function (r) {
        var n = by[r.keyword];
        if (n) { r.vol = n.vol; r.kd = n.kd; r.cpc = n.cpc; r.intent = n.intent; r.country = m.loc.name; }
      });
      saveLists(L2); renderLists();
      say("list-msg", "Updated with the latest numbers for " + m.loc.name + ".", "ok");
    }).catch(function (e) { say("list-msg", e.message, "err"); });
  });

  // ---------- site explorer ----------
  var SITE = { domain: "", rows: [], offset: 0, total: 0, ticked: new Set(), loc: null };
  function cleanDomain(s) {
    s = String(s || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
    return s.split(/[\/?#]/)[0];
  }
  $("site-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var d = cleanDomain($("site-in").value);
    if (!d || d.indexOf(".") < 0) { say("site-msg", "Enter a website address, for example wondersofjapan.com.", "err"); return; }
    if (!hasCreds()) { say("site-msg", "Site Explorer needs DataForSEO. Connect your account in the Connect data tab first.", "warn"); return; }
    $("site-in").value = d;
    var code = Number($("site-loc").value);
    var loc = LOCATIONS.filter(function (l) { return l.code === code; })[0];
    SITE = { domain: d, rows: [], offset: 0, total: 0, ticked: new Set(), loc: loc, lang: $("lang").value };
    say("site-msg", "Analysing " + d + " in " + loc.name + "...", "info"); say("site-msg2", "");
    $("site-go").disabled = true;
    Promise.all([
      d4("dataforseo_labs/google/domain_rank_overview/live", [{ target: d, location_code: loc.code, language_code: SITE.lang }]),
      loadSiteKeywords()
    ]).then(function (res) {
      var item = res[0][0] && res[0][0].items && res[0][0].items[0];
      var o = (item && item.metrics && item.metrics.organic) || {};
      $("site-stats").innerHTML =
        '<div class="stat"><b>' + num(o.count || 0) + '</b><span>Organic keywords</span><small>' + esc(loc.name) + "</small></div>" +
        '<div class="stat"><b>' + num(o.etv || 0) + '</b><span>Estimated monthly visits</span><small>From Google search</small></div>' +
        '<div class="stat"><b>' + num((o.pos_1 || 0) + (o.pos_2_3 || 0)) + '</b><span>In the top 3</span></div>' +
        '<div class="stat"><b>' + num(o.pos_4_10 || 0) + '</b><span>Positions 4 to 10</span><small>Rest of page 1</small></div>' +
        '<div class="stat"><b>' + num(o.pos_11_20 || 0) + '</b><span>Positions 11 to 20</span><small>Page 2, worth pushing</small></div>';
      show($("site-out"), true);
      say("site-msg", SITE.total ? "" : d + " has no Google rankings in DataForSEO for " + loc.name + " yet. New sites can take a few months to show up. Try another country.", SITE.total ? "" : "warn");
    }).catch(function (e) { say("site-msg", e.message, "err"); })
      .then(function () { $("site-go").disabled = false; });
  });
  function loadSiteKeywords() {
    return d4("dataforseo_labs/google/ranked_keywords/live", [{
      target: SITE.domain, location_code: SITE.loc.code, language_code: SITE.lang,
      limit: 100, offset: SITE.offset, order_by: ["ranked_serp_element.serp_item.etv,desc"]
    }]).then(function (res) {
      var r = res[0] || {};
      SITE.total = r.total_count || 0;
      (r.items || []).forEach(function (x) {
        var k = fromLabs(x.keyword_data), si = (x.ranked_serp_element && x.ranked_serp_element.serp_item) || {};
        k.pos = si.rank_group; k.url = si.url; k.etv = si.etv;
        SITE.rows.push(k);
      });
      SITE.offset += 100;
      renderSite();
    });
  }
  function siteVisible() {
    var f = cleanKw($("site-filter").value), p = $("site-pos").value;
    return SITE.rows.filter(function (r) {
      if (f && r.keyword.indexOf(f) < 0 && String(r.url || "").toLowerCase().indexOf(f) < 0) return false;
      if (p === "3" && !(r.pos <= 3)) return false;
      if (p === "10" && !(r.pos >= 4 && r.pos <= 10)) return false;
      if (p === "20" && !(r.pos >= 11 && r.pos <= 20)) return false;
      return true;
    });
  }
  function renderSite() {
    var rows = siteVisible();
    $("site-count").textContent = SITE.rows.length + " of " + num(SITE.total) + " loaded";
    show($("site-more"), SITE.rows.length < SITE.total);
    if (!rows.length) { $("site-table").innerHTML = '<p class="empty">' + (SITE.rows.length ? "Nothing matches that filter." : "No keywords yet.") + "</p>"; return; }
    $("site-table").innerHTML = '<table><thead><tr><th class="cb"></th><th>Keyword</th><th class="num">Position</th><th class="num">Volume</th><th class="num">KD</th><th class="num">Traffic</th><th>Page</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="cb"><input type="checkbox" data-skw="' + esc(r.keyword) + '"' + (SITE.ticked.has(r.keyword) ? " checked" : "") + "></td>" +
          '<td class="kw"><button class="kwlink" type="button" data-explore="' + esc(r.keyword) + '">' + esc(r.keyword) + "</button></td>" +
          '<td class="num">' + esc(r.pos) + '</td><td class="num">' + num(r.vol) + '</td><td class="num">' + kdHtml(r.kd) + '</td><td class="num">' + num(r.etv) + "</td>" +
          '<td class="url"><a href="' + esc(r.url) + '" target="_blank" rel="noopener nofollow" title="' + esc(r.url) + '">' + esc(pathOf(r.url) || "/") + "</a></td></tr>";
      }).join("") + "</tbody></table>";
  }
  $("site-filter").addEventListener("input", renderSite);
  $("site-pos").addEventListener("change", renderSite);
  $("site-table").addEventListener("change", function (e) {
    var k = e.target.dataset.skw;
    if (k) { if (e.target.checked) SITE.ticked.add(k); else SITE.ticked.delete(k); }
  });
  $("site-more").addEventListener("click", function () {
    say("site-msg2", "Loading more...", "info");
    loadSiteKeywords().then(function () { say("site-msg2", ""); }, function (e) { say("site-msg2", e.message, "err"); });
  });
  $("site-save").addEventListener("click", function () {
    saveToList(SITE.rows.filter(function (r) { return SITE.ticked.has(r.keyword); }), "site-msg2");
  });
  $("site-csv").addEventListener("click", function () {
    var rows = siteVisible();
    if (!rows.length) { say("site-msg2", "There is nothing to export yet.", "warn"); return; }
    downloadCsv(SITE.domain + "-keywords", [["keyword", "Keyword"], ["pos", "Position"], ["vol", "Monthly searches"], ["kd", "Keyword difficulty"], ["etv", "Estimated traffic"], ["cpc", "CPC (USD)"], ["url", "Page"]], rows);
  });

  // ---------- start ----------
  show($("ac-engine"), true);
  setHint("auto");
  var q = new URLSearchParams(location.search).get("q");
  if (q) explore(cleanKw(q));
})();
