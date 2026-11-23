// Email Click Heatmap by Delf Studio.
// Everything pasted here stays in the browser. Nothing is uploaded.
(function(){
"use strict";
var $ = function(s){ return document.querySelector(s); };
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
function store(k,v){ try{ localStorage.setItem("ehm_"+k, v); }catch(e){} }
function load(k){ try{ return localStorage.getItem("ehm_"+k); }catch(e){ return null; } }
function msg(el, type, html){ el.className = "msg " + type; el.innerHTML = html; }
function clearMsg(el){ el.className = "msg"; el.innerHTML = ""; }
function fmt(n){ return (Math.round(n)).toLocaleString("en-US"); }
function pct(n){ return (n*100 >= 10 ? Math.round(n*100) : Math.round(n*1000)/10) + "%"; }

/* ---------- tabs ---------- */
function showTab(t){
  document.querySelectorAll("nav.tabs button").forEach(function(b){ var on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  document.querySelectorAll("section.tab").forEach(function(s){ s.classList.toggle("on", s.id === "tab-" + t); });
  var nav = $("nav.tabs");
  if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView();
}
document.querySelectorAll("nav.tabs button").forEach(function(b){ b.addEventListener("click", function(){ showTab(b.dataset.tab); }); });

/* ---------- copy buttons ---------- */
function copyText(text, btn){
  var done = function(){ var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function(){ btn.textContent = o; }, 1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text); done(); });
  } else { fallbackCopy(text); done(); }
}
function fallbackCopy(text){
  var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
  try{ document.execCommand("copy"); }catch(e){} document.body.removeChild(t);
}
document.querySelectorAll("[data-copy]").forEach(function(b){ b.addEventListener("click", function(){ copyText(document.getElementById(b.dataset.copy).value, b); }); });

/* ---------- shared link helpers ---------- */
var SKIP_RE = /^(mailto:|tel:|sms:|#|javascript:)/i;
var SYS_RE = /%%(unsub_center_url|profile_center_url|subscription_center_url|view_email_url|ftaf_url|=\s*RedirectTo\s*\(\s*@?unsub)/i;
var MSO_OPEN = "<!-" + "-[if mso]>", MSO_CLOSE = "<![endif]-" + "->";
var NOTMSO_OPEN = "<!-" + "-[if !mso]><!-" + "->", NOTMSO_CLOSE = "<!-" + "-<![endif]-" + "->";

function normHref(h){ return String(h || "").replace(/&amp;/g, "&").trim(); }
function normUrl(u){
  u = normHref(u).toLowerCase();
  u = u.replace(/([?&])hm_id=[^&#]*&?/g, "$1").replace(/[?&]+(#|$)/, "$1").replace(/#.*$/, "");
  u = u.replace(/\/+$/, "");
  return u;
}
function slug(s){
  return String(s || "").toLowerCase().replace(/^image:\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "link";
}
function innerLabel(inner){
  var txt = inner.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#?[a-z0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (txt) return txt.slice(0, 80);
  var alt = /alt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(inner);
  if (alt) { var a = (alt[2] !== undefined ? alt[2] : alt[3]); return a ? "Image: " + a : "Image (no alt text)"; }
  return /<img/i.test(inner) ? "Image (no alt text)" : "(no text)";
}
function addParam(raw, k, v){
  var hash = "", hi = raw.indexOf("#");
  if (hi > -1) { hash = raw.slice(hi); raw = raw.slice(0, hi); }
  var re = new RegExp("(\\?|&amp;|&)" + k + "=[^&#]*");
  if (re.test(raw)) return raw.replace(re, "$1" + k + "=" + v) + hash;
  var amp = raw.indexOf("&amp;") > -1 ? "&amp;" : "&";
  return raw + (raw.indexOf("?") > -1 ? amp : "?") + k + "=" + v + hash;
}

/* ---------- tagger ---------- */
function tagHtml(html, opts){
  var re = /<(a|v:roundrect|v:rect)\b[^>]*>/gi, tags = [], m;
  while ((m = re.exec(html))) {
    var full = m[0];
    var hm = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(full);
    if (!hm) continue;
    var raw = hm[2] !== undefined ? hm[2] : hm[3];
    var name = m[1].toLowerCase();
    tags.push({ name:name, isVml:name !== "a", start:m.index, end:m.index + full.length, full:full, hm:hm, raw:raw, href:normHref(raw) });
  }
  tags.forEach(function(t){
    var h = t.href;
    if (!h || SKIP_RE.test(h)) t.skip = "Not a web link";
    else if (SYS_RE.test(h)) t.skip = "SFMC system link (already tracked)";
    else if (opts.mode === "outlook" && h.indexOf("%%") > -1) t.skip = "Contains AMPscript, which won't work in Outlook";
    else if (!/^https?:\/\//i.test(h) && h.indexOf("%%") < 0) t.skip = "Not an http(s) link";
  });
  // pair each Outlook VML button with the nearest normal link to the same URL
  var anchors = tags.filter(function(t){ return !t.isVml && !t.skip; });
  tags.filter(function(t){ return t.isVml && !t.skip; }).forEach(function(v){
    var best = null, bd = 1e9;
    anchors.forEach(function(a){
      if (a.pair || a.href !== v.href) return;
      var d = Math.abs(a.start - v.start);
      if (d < bd && d < 6000) { bd = d; best = a; }
    });
    if (best) { best.pair = v; v.pair = best; }
  });
  var n = 0;
  tags.forEach(function(t){
    if (t.skip || t.id) return;
    n++; t.id = "hm" + (n < 10 ? "0" + n : String(n));
    if (t.pair) t.pair.id = t.id;
  });
  tags.forEach(function(t){
    var close = html.toLowerCase().indexOf(t.isVml ? "</v:" : "</a", t.end);
    t.label = close > -1 ? innerLabel(html.slice(t.end, close)) : "(no text)";
  });
  var out = html;
  tags.slice().sort(function(a,b){ return b.start - a.start; }).forEach(function(t){
    if (t.skip) return;
    var tag = t.full, q = t.hm[1].charAt(0), newHref;
    if (opts.mode === "outlook") {
      var sep = opts.base.indexOf("?") > -1 ? "&" : "?";
      newHref = (opts.base + sep + "t=c&e=" + encodeURIComponent(opts.emailId) + "&l=" + t.id + "&u=" + encodeURIComponent(t.href)).replace(/&/g, "&amp;");
    } else if (t.href.indexOf("%%") > -1) {
      newHref = t.raw; t.note = "AMPscript link: alias only";
    } else {
      newHref = addParam(t.raw, "hm_id", t.id);
    }
    tag = tag.slice(0, t.hm.index) + " href=" + q + newHref + q + tag.slice(t.hm.index + t.hm[0].length);
    if (!t.isVml && opts.mode === "sfmc") {
      var alias = t.id + "-" + slug(t.label);
      var am = /\salias\s*=\s*("[^"]*"|'[^']*')/i.exec(tag);
      if (am) { t.note = (t.note ? t.note + "; " : "") + "replaced alias " + am[1]; tag = tag.slice(0, am.index) + ' alias="' + alias + '"' + tag.slice(am.index + am[0].length); }
      else tag = tag.replace(/^<a\b/i, '<a alias="' + alias + '"');
      t.alias = alias;
    }
    out = out.slice(0, t.start) + tag + out.slice(t.end);
  });
  if (opts.mode === "outlook" && opts.pixel) {
    var s2 = opts.base.indexOf("?") > -1 ? "&amp;" : "?";
    var px = '<img src="' + opts.base + s2 + "t=o&amp;e=" + encodeURIComponent(opts.emailId) + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />';
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, px + "</body>") : out + px;
  }
  return { html: out, tags: tags };
}

function currentMode(){ return document.querySelector('input[name=mode]:checked').value; }
function syncMode(){
  var o = currentMode() === "outlook";
  $("#outlook-fields").classList.toggle("hidden", !o);
  $("#mode-hint-outlook").classList.toggle("hidden", !o);
  $("#mode-hint-sfmc").classList.toggle("hidden", o);
}
document.querySelectorAll("input[name=mode]").forEach(function(r){ r.addEventListener("change", syncMode); });
$("#tag-base").value = load("base") || "";

function runTag(){
  var box = $("#tag-msg"); clearMsg(box);
  var html = $("#tag-in").value;
  if (!html.trim()) { msg(box, "err", "Paste the email HTML first."); return; }
  var mode = currentMode(), opts = { mode: mode };
  if (mode === "outlook") {
    opts.base = $("#tag-base").value.trim();
    opts.emailId = $("#tag-eid").value.trim();
    opts.pixel = $("#tag-pixel").checked;
    if (!/^https:\/\//i.test(opts.base)) { msg(box, "err", "Add your tracker CloudPage URL (starting with https://). See the Setup tab."); return; }
    if (!opts.emailId) { msg(box, "err", "Give this send a short Email ID, for example 2026-11-open-day."); return; }
    store("base", opts.base);
  }
  var res = tagHtml(html, opts);
  var tracked = res.tags.filter(function(t){ return !t.skip && !(t.isVml && t.pair); });
  var skipped = res.tags.filter(function(t){ return t.skip; });
  var rows = tracked.map(function(t){
    var extra = t.pair ? '<span class="pill">+ Outlook button</span>' : (t.isVml ? '<span class="pill w">Outlook-only button</span>' : "");
    return "<tr><td class='mono'>" + t.id + "</td><td>" + esc(t.label) + extra + (t.note ? '<br><span class="hint">' + esc(t.note) + "</span>" : "") + "</td><td class='url' title='" + esc(t.href) + "'>" + esc(t.href) + "</td></tr>";
  }).join("");
  var skipRows = skipped.map(function(t){ return "<tr><td>-</td><td>" + esc(t.label) + '<br><span class="hint">' + esc(t.skip) + "</span></td><td class='url' title='" + esc(t.href) + "'>" + esc(t.href) + "</td></tr>"; }).join("");
  $("#tag-table").innerHTML = "<table><tr><th>ID</th><th>Link</th><th>Destination</th></tr>" + rows + (skipRows ? "<tr><th colspan='3'>Not tracked</th></tr>" + skipRows : "") + "</table>";
  $("#tag-out").value = res.html;
  $("#tag-result").classList.remove("hidden");
  if (!tracked.length) msg(box, "warn", "No trackable links found.");
  else msg(box, "ok", tracked.length + " links tagged" + (skipped.length ? ", " + skipped.length + " left as they are" : "") + ".");
  return res;
}
$("#tag-go").addEventListener("click", runTag);
$("#tag-copy").addEventListener("click", function(){ copyText($("#tag-out").value, this); });
$("#tag-to-report").addEventListener("click", function(){ $("#rep-html").value = $("#tag-out").value; showTab("report"); });

/* ---------- demo (an invented school, on example.com) ---------- */
function demoEmail(){
  var site = "https://www.example.com";
  return '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Day</title>\n' +
  '<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.col{display:block!important;width:100%!important}.pad{padding:20px!important}}</style></head>\n' +
  '<body style="margin:0;padding:0;background:#f2f4f7;">\n' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f4f7;"><tr><td align="center" style="padding:20px 10px;">\n' +
  '<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;background:#ffffff;border:1px solid #e3e6eb;">\n' +
  '<tr><td align="center" style="padding:24px;"><a href="' + site + '/"><img src="demo-logo.png" width="180" height="54" alt="Northfield School" style="display:block;border:0;"></a></td></tr>\n' +
  '<tr><td><a href="' + site + '/open-day"><img src="demo-hero.jpg" width="600" height="300" alt="Open Day this Saturday" style="display:block;width:100%;height:auto;border:0;"></a></td></tr>\n' +
  '<tr><td class="pad" style="padding:30px 40px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#1c2333;">\n' +
  '<h1 style="margin:0 0 12px;font-size:26px;line-height:32px;">Come and see us this Saturday</h1>\n' +
  '<p style="margin:0 0 20px;">Meet our teachers, tour the classrooms and ask anything about admissions. Places are limited, so book your slot today.</p>\n' +
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#1f5eff" style="border-radius:6px;">\n' +
  MSO_OPEN + '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="' + site + '/open-day/book" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="12%" stroke="f" fillcolor="#1f5eff"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Book your slot</center></v:roundrect>' + MSO_CLOSE + '\n' +
  NOTMSO_OPEN + '<a href="' + site + '/open-day/book" style="display:inline-block;padding:14px 34px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Book your slot</a>' + NOTMSO_CLOSE + '\n' +
  '</td></tr></table></td></tr>\n' +
  '<tr><td style="padding:0 30px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>\n' +
  '<td class="col" width="50%" valign="top" style="padding:10px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#1c2333;"><a href="' + site + '/curriculum"><img src="demo-curriculum.jpg" width="250" height="150" alt="Our curriculum" style="display:block;width:100%;height:auto;border:0;"></a><p style="margin:10px 0 4px;font-weight:bold;">Our curriculum</p><a href="' + site + '/curriculum" style="color:#1f5eff;">Explore subjects</a></td>\n' +
  '<td class="col" width="50%" valign="top" style="padding:10px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#1c2333;"><a href="' + site + '/fees"><img src="demo-fees.jpg" width="250" height="150" alt="Fees and scholarships" style="display:block;width:100%;height:auto;border:0;"></a><p style="margin:10px 0 4px;font-weight:bold;">Fees and scholarships</p><a href="' + site + '/fees" style="color:#1f5eff;">See fees</a></td>\n' +
  '</tr></table></td></tr>\n' +
  '<tr><td class="pad" style="padding:10px 40px 30px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#1c2333;">Can\'t make it on Saturday? <a href="' + site + '/open-day" style="color:#1f5eff;">Book a private tour</a> on a day that suits you.</td></tr>\n' +
  '<tr><td align="center" style="padding:20px;background:#f7f8fa;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#5b6578;">\n' +
  '<a href="' + site + '/news" style="color:#5b6578;">School news</a> &nbsp;|&nbsp; <a href="' + site + '/contact" style="color:#5b6578;">Contact us</a><br>\n' +
  'You received this email because you enquired about admissions. <a href="%%unsub_center_url%%" style="color:#5b6578;">Unsubscribe</a></td></tr>\n' +
  '</table></td></tr></table>\n</body></html>';
}
var DEMO_WEIGHTS = [38, 268, 412, 96, 151, 64, 120, 88, 17, 9];
function demoData(tags){
  var lines = ["LinkName,LinkContent,Clicks,UniqueClicks"];
  tags.filter(function(t){ return !t.skip && !t.isVml; }).forEach(function(t, i){
    var c = DEMO_WEIGHTS[i] || 5;
    var href = addParam(t.raw, "hm_id", t.id).replace(/&amp;/g, "&");
    lines.push(t.alias + "," + href + "," + c + "," + Math.round(c * 0.81));
  });
  return lines.join("\n");
}
function loadDemo(toReport){
  document.querySelector('input[name=mode][value=sfmc]').checked = true; syncMode();
  $("#tag-in").value = demoEmail();
  var res = runTag();
  if (toReport) {
    $("#rep-html").value = res.html;
    $("#rep-data").value = demoData(res.tags);
    showTab("report");
    buildReport();
  }
}
$("#tag-demo").addEventListener("click", function(){ loadDemo(false); });
$("#rep-demo").addEventListener("click", function(){ loadDemo(true); });

/* ---------- data parsing ---------- */
function parseTable(text){
  text = text.replace(/^﻿/, "");
  var first = text.split(/\r?\n/)[0] || "";
  var tabs = (first.match(/\t/g) || []).length, commas = (first.match(/,/g) || []).length, semis = (first.match(/;/g) || []).length;
  var d = tabs ? "\t" : (semis > commas ? ";" : ",");
  var rows = [], row = [], field = "", q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"' && field === "") q = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function(r){ return r.some(function(c){ return c.trim() !== ""; }); });
}
function parseData(text){
  var rows = parseTable(text);
  if (rows.length < 2) throw new Error("Paste a table with a header row and at least one data row.");
  var head = rows[0].map(function(h){ return h.toLowerCase().replace(/[^a-z0-9]/g, ""); });
  function find(list){ for (var i = 0; i < list.length; i++) { var x = head.indexOf(list[i]); if (x > -1) return x; } return -1; }
  var keyCols = ["linkid","linkname","alias","link","linkcontent","url","linkurl","destination"].map(function(n){ return head.indexOf(n); }).filter(function(i){ return i > -1; });
  if (!keyCols.length) throw new Error("Couldn't find a link column. Use a header such as LinkName, LinkContent, URL or LinkID.");
  var ci = find(["clicks","totalclicks","count","clickcount","total","events"]);
  var ui = find(["uniqueclicks","unique","uniques","uniqueclickers"]);
  var ti = find(["eventtype","type"]);
  var ai = find(["useragent","ua"]);
  var di = find(["eventdate","clickdate","date","timestamp","eventtime","time"]);
  var ri = find(["recipient","subscriberkey","subscriber","contactkey","emailaddress"]);
  var num = function(v){ return parseFloat(String(v || "").replace(/,/g, "")) || 0; };
  var recs = rows.slice(1).map(function(r){
    var tv = ti > -1 ? String(r[ti] || "").trim().toLowerCase() : "c";
    return {
      keys: keyCols.map(function(i){ return String(r[i] || "").trim(); }),
      count: ci > -1 ? num(r[ci]) : 1,
      unique: ui > -1 ? num(r[ui]) : null,
      type: tv.charAt(0) === "o" ? "o" : "c",
      ua: ai > -1 ? String(r[ai] || "") : null,
      date: di > -1 ? Date.parse(r[di]) : NaN,
      rcp: ri > -1 ? String(r[ri] || "").trim() : ""
    };
  });
  return { recs: recs, hasUa: ai > -1, hasDate: di > -1, hasUniqueCol: ui > -1 };
}

/* ---------- bots and devices ---------- */
var BOT_UA = /(bot\b|bot\/|crawl|spider|slurp|scanner|preview|python|curl|wget|java\/|go-http|okhttp|libwww|headless|phantom|proofpoint|mimecast|barracuda|safelinks|symantec|forcepoint|trendmicro|office existence discovery|office protocol discovery)/i;
function device(ua){
  if (!ua) return null;
  if (/ipad|tablet/i.test(ua)) return "Tablet";
  if (/mobi|iphone|android/i.test(ua)) return "Mobile";
  return "Desktop";
}
function flagBots(recs, hasDate){
  recs.forEach(function(r){ var ua = (r.ua || "").trim(); if (!ua || BOT_UA.test(ua)) r.bot = true; });
  if (!hasDate) return;
  var groups = {};
  recs.forEach(function(r){ if (r.bot || isNaN(r.date)) return; var k = (r.ua || "") + "|" + r.rcp; (groups[k] = groups[k] || []).push(r); });
  Object.keys(groups).forEach(function(k){
    var g = groups[k].sort(function(a,b){ return a.date - b.date; });
    for (var i = 0; i < g.length; i++) {
      var links = {}, j = i;
      while (j < g.length && g[j].date - g[i].date <= 3000) { links[g[j].keys.join("|")] = 1; j++; }
      if (Object.keys(links).length >= 3) for (var x = i; x < j; x++) g[x].bot = true;
    }
  });
}

/* ---------- images ---------- */
var imageMap = {};
$("#rep-imgs").addEventListener("change", function(e){
  var files = Array.prototype.slice.call(e.target.files || []);
  var left = files.length;
  if (!left) return;
  files.forEach(function(f){
    var rd = new FileReader();
    rd.onload = function(){ imageMap[f.name.toLowerCase()] = rd.result; if (--left === 0) { $("#img-count").textContent = Object.keys(imageMap).length + " image(s) loaded"; if (!$("#rep-out").classList.contains("hidden")) buildReport(); } };
    rd.readAsDataURL(f);
  });
});
$("#rep-file").addEventListener("change", function(e){
  var f = e.target.files && e.target.files[0]; if (!f) return;
  var rd = new FileReader(); rd.onload = function(){ $("#rep-data").value = rd.result; }; rd.readAsText(f);
});
function xmlEsc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
function placeholder(w, h, label, guessed){
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><rect width="' + w + '" height="' + h + '" fill="#ece6da"/>' +
    '<rect x="1" y="1" width="' + (w-2) + '" height="' + (h-2) + '" fill="none" stroke="#bdb5a6" stroke-width="2"' + (guessed ? ' stroke-dasharray="7 5"' : "") + '/>' +
    '<text x="50%" y="50%" font-family="Arial" font-size="' + Math.max(10, Math.min(15, Math.round(w/18))) + '" fill="#6b7268" text-anchor="middle" dominant-baseline="middle">' + xmlEsc(String(label).slice(0, 50)) + '</text></svg>';
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
// Gets the email ready to preview. Scripts are removed, and the preview frame is sandboxed as well.
// Images: files you chose win; online images load from their own address when allowed; the rest become labelled boxes.
function prepareHtml(html, loadOnline){
  html = html.replace(new RegExp("<scr" + "ipt[\\s\\S]*?</scr" + "ipt>", "gi"), "");
  var info = { placeholders: 0, real: 0, guessed: 0, online: 0 };
  html = html.replace(/<img\b[^>]*>/gi, function(tag){
    var sm = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (!sm) return tag;
    var src = sm[2] !== undefined ? sm[2] : sm[3];
    if (/^data:/i.test(src)) return tag;
    var base = src.split(/[?#]/)[0].split("/").pop();
    try { base = decodeURIComponent(base); } catch(e) {}
    var wm = /\swidth\s*=\s*["']?(\d+)/i.exec(tag) || /[\s;"']width\s*:\s*(\d+)px/i.exec(tag);
    var hm = /\sheight\s*=\s*["']?(\d+)/i.exec(tag) || /[\s;"']height\s*:\s*(\d+)px/i.exec(tag);
    var w = wm ? Math.min(+wm[1], 900) : 600, h = hm ? +hm[1] : Math.round(w * 0.45);
    // Tracking pixels are always blanked, so building a report never logs a false open.
    if (w <= 2 && h <= 2) return tag.slice(0, sm.index) + ' src=""' + tag.slice(sm.index + sm[0].length);
    var newSrc = imageMap[base.toLowerCase()];
    if (newSrc) info.real++;
    else if (loadOnline && /^https?:\/\//i.test(src) && src.indexOf("%%") < 0) { info.online++; return tag; }
    else {
      var am = /\salt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
      var alt = am ? (am[2] !== undefined ? am[2] : am[3]) : "";
      newSrc = placeholder(w, h, alt || base || "image", !hm);
      info.placeholders++; if (!hm) info.guessed++;
    }
    tag = tag.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/i, "");
    sm = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    return tag.slice(0, sm.index) + ' src="' + newSrc + '"' + tag.slice(sm.index + sm[0].length);
  });
  return { html: html, info: info };
}

/* ---------- report ---------- */
function heatColor(i, a){ var hue = Math.round(210 - 210 * i); return "hsla(" + hue + ",88%," + (i > 0.4 && i < 0.75 ? 46 : 50) + "%," + a + ")"; }
function elRect(el){
  var ok = function(r){ return r.width > 0 && r.height > 0; };
  var rs = [];
  el.querySelectorAll("*").forEach(function(c){ rs.push(c.getBoundingClientRect()); });
  rs = rs.filter(ok);
  var hasText = Array.prototype.some.call(el.childNodes, function(nd){ return nd.nodeType === 3 && nd.textContent.trim(); });
  if (!rs.length || hasText) { var own = el.getBoundingClientRect(); if (ok(own)) rs.push(own); }
  if (!rs.length) return null;
  var l = Math.min.apply(null, rs.map(function(r){ return r.left; })), t = Math.min.apply(null, rs.map(function(r){ return r.top; }));
  var rr = Math.max.apply(null, rs.map(function(r){ return r.right; })), b = Math.max.apply(null, rs.map(function(r){ return r.bottom; }));
  return { left:l, top:t, width:rr - l, height:b - t };
}
function labelOf(el){
  var t = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (t) return t.slice(0, 80);
  var img = el.querySelector("img");
  if (img) return img.getAttribute("alt") ? "Image: " + img.getAttribute("alt") : "Image (no alt text)";
  return "(no text)";
}

var lastData = null;
function buildReport(){
  var box = $("#rep-msg"); clearMsg(box);
  var html = $("#rep-html").value, dataText = $("#rep-data").value;
  if (!html.trim()) { msg(box, "err", "Paste the tagged email HTML."); return; }
  if (!dataText.trim()) { msg(box, "err", "Paste your click data, or choose a CSV file."); return; }
  try { lastData = parseData(dataText); } catch (e) { msg(box, "err", esc(e.message)); return; }
  var prep = prepareHtml(html, $("#opt-online").checked);
  var width = +document.querySelector("input[name=width]:checked").value;
  var frame = $("#frame");
  $("#rep-out").classList.remove("hidden");
  frame.style.width = width + "px"; frame.style.height = "400px";
  frame.onload = function(){ setTimeout(function(){ analyse(frame, width, prep.info); }, 60); };
  frame.srcdoc = prep.html;
}

function analyse(frame, width, imgInfo){
  var box = $("#rep-msg");
  var doc = frame.contentDocument;
  if (!doc || !doc.documentElement) { msg(box, "err", "The email preview could not be rendered in this browser."); return; }
  frame.style.height = doc.documentElement.scrollHeight + "px";
  var docH = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
  frame.style.height = docH + "px";

  // links in the email
  var idInfo = {}, order = [], urlIndex = {};
  Array.prototype.forEach.call(doc.querySelectorAll("a[href]"), function(el, i){
    var href = el.getAttribute("href") || "";
    if (SKIP_RE.test(href.trim())) return;
    var id = null, al = el.getAttribute("alias") || "";
    var m1 = al.match(/\bhm\d{2,}\b/i), m2 = href.match(/[?&]hm_id=(hm\d{2,})/i), m3 = href.match(/[?&]l=(hm\d{2,})/i);
    if (m1) id = m1[0].toLowerCase(); else if (m2) id = m2[1].toLowerCase(); else if (m3) id = m3[1].toLowerCase();
    var dest = href, um = href.match(/[?&]u=([^&]+)/);
    if (m3 && um) { try { dest = decodeURIComponent(um[1]); } catch (e) {} }
    if (/%%/.test(href) && !id) return;
    if (!id) id = "link" + (i + 1);
    var nu = normUrl(dest);
    (urlIndex[nu] = urlIndex[nu] || []);
    if (urlIndex[nu].indexOf(id) < 0) urlIndex[nu].push(id);
    if (!idInfo[id]) { idInfo[id] = { id:id, label:labelOf(el), url:dest, els:[] }; order.push(id); }
    idInfo[id].els.push(el);
  });
  if (!order.length) { msg(box, "err", "No links found in the email HTML."); return; }

  // aggregate data
  var data = lastData, filterBots = $("#opt-bots").checked;
  var clicks = data.recs.filter(function(r){ return r.type === "c"; });
  var openRecs = data.recs.filter(function(r){ return r.type === "o"; });
  clicks.forEach(function(r){ r.bot = false; });
  if (filterBots && data.hasUa) flagBots(clicks, data.hasDate);
  var agg = {}, unmatched = {}, ambiguous = {}, bots = 0, devices = {}, days = {}, anyRcp = false;
  clicks.forEach(function(r){
    if (r.bot) { bots += r.count; return; }
    var id = null, amb = false, um = null;
    for (var i = 0; i < r.keys.length && !id; i++) { var m = r.keys[i].match(/\bhm\d{2,}\b/i); if (m && idInfo[m[0].toLowerCase()]) id = m[0].toLowerCase(); else if (m) um = r.keys[i]; }
    if (!id) for (var j = 0; j < r.keys.length && !id; j++) {
      var k = r.keys[j];
      if (/^https?:/i.test(k)) { var ids = urlIndex[normUrl(k)]; if (ids && ids.length) { id = ids[0]; amb = ids.length > 1; } else um = um || k; }
    }
    if (!id) { var key = um || r.keys.filter(Boolean)[0] || "(empty)"; unmatched[key] = (unmatched[key] || 0) + r.count; return; }
    if (amb) ambiguous[id] = urlIndex[normUrl(idInfo[id].url)] ? urlIndex[normUrl(idInfo[id].url)].length : 2;
    var a = agg[id] = agg[id] || { total:0, unique:0, rcp:{} };
    a.total += r.count;
    if (r.unique != null) a.unique += r.unique;
    if (r.rcp) { a.rcp[r.rcp] = 1; anyRcp = true; }
    var dv = device(r.ua); if (dv) devices[dv] = (devices[dv] || 0) + r.count;
    if (!isNaN(r.date)) { var dt = new Date(r.date); var dk = dt.getFullYear() + "-" + ("0" + (dt.getMonth()+1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2); days[dk] = (days[dk] || 0) + r.count; }
  });
  var uniqueAvail = data.hasUniqueCol || anyRcp;
  var wantUnique = document.querySelector("input[name=metric]:checked").value === "unique";
  var useUnique = wantUnique && uniqueAvail;
  var val = function(id){ var a = agg[id]; if (!a) return 0; return useUnique ? (data.hasUniqueCol ? a.unique : Object.keys(a.rcp).length) : a.total; };
  var uval = function(id){ var a = agg[id]; if (!a || !uniqueAvail) return null; return data.hasUniqueCol ? a.unique : Object.keys(a.rcp).length; };

  var totalAll = 0, max = 0;
  order.forEach(function(id){ var v = val(id); totalAll += v; if (v > max) max = v; });
  var ranked = order.slice().sort(function(a,b){ return val(b) - val(a); });
  var rankOf = {}; ranked.forEach(function(id, i){ rankOf[id] = i + 1; });

  // overlay
  var ov = $("#overlay"); ov.innerHTML = "";
  ov.style.width = (width + 150) + "px"; ov.style.height = docH + "px";
  $("#stage").style.width = width + "px";
  var showLabels = $("#opt-labels").checked, showZero = $("#opt-zero").checked;
  var bands = [0,0,0,0], bandNames = ["Top quarter","Upper middle","Lower middle","Bottom quarter"], shortNames = ["Top","Upper mid","Lower mid","Bottom"], hiddenIds = {};
  var drawList = [];
  order.forEach(function(id){
    var v = val(id), info = idInfo[id];
    var rects = info.els.map(elRect).filter(Boolean);
    if (!rects.length) { hiddenIds[id] = 1; return; }
    rects.forEach(function(r){ bands[Math.min(3, Math.floor(((r.top + r.height/2) / docH) * 4))] += v / rects.length; });
    drawList.push({ id:id, v:v, rects:rects });
  });
  drawList.sort(function(a,b){ return a.v - b.v; }).forEach(function(d){
    var i = max ? d.v / max : 0;
    d.rects.forEach(function(r, n){
      var pad = 3;
      if (d.v <= 0) {
        if (!showZero) return;
        var z = document.createElement("div"); z.className = "zbox";
        z.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad*2) + "px;height:" + (r.height + pad*2) + "px";
        z.title = d.id + ": 0 clicks"; ov.appendChild(z); return;
      }
      var b = document.createElement("div"); b.className = "hbox";
      var glow = 8 + Math.round(26 * i);
      b.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad*2) + "px;height:" + (r.height + pad*2) + "px;" +
        "background:" + heatColor(i, 0.16 + 0.36 * i) + ";border:2px solid " + heatColor(i, 0.95) + ";box-shadow:0 0 " + glow + "px " + Math.round(glow/3) + "px " + heatColor(i, 0.55);
      ov.appendChild(b);
      if (showLabels && n === 0) {
        var t = document.createElement("div"); t.className = "hbadge";
        t.style.left = Math.max(0, r.left - pad) + "px"; t.style.top = Math.max(16, r.top - pad - 2) + "px";
        t.style.background = heatColor(i, 1); t.style.color = (i > 0.35 && i < 0.8) ? "#1c2420" : "#fff";
        t.textContent = "#" + rankOf[d.id] + "  " + fmt(d.v) + " (" + pct(totalAll ? d.v / totalAll : 0) + ")";
        t.title = idInfo[d.id].label + "\n" + idInfo[d.id].url;
        ov.appendChild(t);
      }
    });
  });
  var bandMax = Math.max.apply(null, bands) || 1;
  for (var bi = 0; bi < 4; bi++) {
    var y0 = Math.round(docH * bi / 4), y1 = Math.round(docH * (bi + 1) / 4);
    if (bi > 0) { var ln = document.createElement("div"); ln.className = "band"; ln.style.top = y0 + "px"; ln.style.width = (width + 140) + "px"; ov.appendChild(ln); }
    var dp = document.createElement("div"); dp.className = "depth";
    var share = totalAll ? bands[bi] / totalAll : 0;
    dp.style.cssText = "left:" + (width + 12) + "px;top:" + y0 + "px;height:" + (y1 - y0) + "px;width:128px;border-left-color:" + heatColor(bands[bi] / bandMax, 0.9);
    dp.innerHTML = "<b>" + pct(share) + "</b>" + bandNames[bi] + "<br><span class='hint'>of clicks</span>";
    ov.appendChild(dp);
  }
  $("#stage").style.marginRight = "150px";

  // stats
  var clickedLinks = order.filter(function(id){ return val(id) > 0; }).length;
  var stats = [];
  stats.push(["" + fmt(totalAll), useUnique ? "Unique clicks" : "Total clicks"]);
  if (!useUnique && uniqueAvail) { var tu = 0; order.forEach(function(id){ tu += uval(id) || 0; }); stats.push([fmt(tu), "Unique clicks (sum per link)"]); }
  stats.push([clickedLinks + " of " + order.length, "Links clicked"]);
  if (ranked.length && val(ranked[0]) > 0) stats.push([pct(totalAll ? val(ranked[0]) / totalAll : 0), "Top link: " + esc(idInfo[ranked[0]].label.slice(0, 40))]);
  stats.push([pct(totalAll ? bands[0] / totalAll : 0), "Clicks in the top quarter"]);
  if (openRecs.length) { var oc = 0, orc = {}; openRecs.forEach(function(r){ oc += r.count; if (r.rcp) orc[r.rcp] = 1; }); stats.push([fmt(oc), "Opens logged" + (Object.keys(orc).length ? " (" + fmt(Object.keys(orc).length) + " unique)" : "")]); }
  if (data.hasUa) stats.push([fmt(bots), filterBots ? "Suspected bot clicks removed" : "Bot filter is off"]);
  var devTotal = 0; Object.keys(devices).forEach(function(k){ devTotal += devices[k]; });
  if (devTotal) stats.push([pct((devices.Mobile || 0) / devTotal), "Clicks from mobile"]);
  $("#rep-stats").innerHTML = stats.map(function(s){ return '<div class="stat"><b>' + s[0] + "</b><span>" + s[1] + "</span></div>"; }).join("");

  // ranked table
  var rows = ranked.map(function(id){
    var v = val(id), i = max ? v / max : 0, u = uval(id), info = idInfo[id];
    var notes = [];
    if (hiddenIds[id]) notes.push('<span class="pill">hidden in this view</span>');
    if (ambiguous[id]) notes.push('<span class="pill w">same URL in ' + ambiguous[id] + ' places, tag the email to split</span>');
    var rc = info.els.map(elRect).filter(Boolean)[0];
    var pos = rc ? shortNames[Math.min(3, Math.floor(((rc.top + rc.height/2) / docH) * 4))] : "";
    return "<tr><td class='num'>" + rankOf[id] + "</td><td><span class='sw' style='background:" + (v > 0 ? heatColor(i, 1) : "#d8d1c4") + "'></span> " + esc(info.label) +
      " <span class='hint mono'>" + esc(id) + "</span>" + (notes.length ? "<br>" + notes.join(" ") : "") + "<div class='url' title='" + esc(info.url) + "'>" + esc(info.url) + "</div></td>" +
      "<td class='num'>" + fmt(useUnique ? (agg[id] ? agg[id].total : 0) : v) + "</td>" + (uniqueAvail ? "<td class='num'>" + (u == null ? "-" : fmt(u)) + "</td>" : "") +
      "<td class='num'>" + pct(totalAll ? v / totalAll : 0) + "</td><td>" + pos + "</td></tr>";
  }).join("");
  $("#rep-table").innerHTML = "<table><tr><th class='num'>#</th><th>Link</th><th class='num'>Clicks</th>" + (uniqueAvail ? "<th class='num'>Unique</th>" : "") + "<th class='num'>Share</th><th>Position</th></tr>" + rows + "</table>";

  // extra: devices, days, unmatched
  var extra = "";
  if (devTotal) {
    extra += "<h2>Devices</h2><table>" + ["Mobile","Desktop","Tablet"].filter(function(k){ return devices[k]; }).map(function(k){
      return "<tr><td style='width:90px'>" + k + "</td><td><div class='bar' style='width:" + Math.round(devices[k] / devTotal * 100) + "%'></div></td><td class='num'>" + fmt(devices[k]) + " (" + pct(devices[k] / devTotal) + ")</td></tr>"; }).join("") + "</table>";
  }
  var dayKeys = Object.keys(days).sort();
  if (dayKeys.length) {
    var dmax = Math.max.apply(null, dayKeys.map(function(k){ return days[k]; }));
    extra += "<h2 style='margin-top:18px'>Clicks by day</h2><table>" + dayKeys.slice(0, 31).map(function(k){
      return "<tr><td style='width:100px' class='mono'>" + k + "</td><td><div class='bar' style='width:" + Math.round(days[k] / dmax * 100) + "%'></div></td><td class='num'>" + fmt(days[k]) + "</td></tr>"; }).join("") + "</table>";
  }
  var umKeys = Object.keys(unmatched);
  if (umKeys.length) {
    extra += "<h2 style='margin-top:18px'>Clicks not found in this email</h2><p class='hint'>These rows didn't match a link in the HTML. Check that the HTML is the version you sent.</p><table>" +
      umKeys.sort(function(a,b){ return unmatched[b] - unmatched[a]; }).slice(0, 30).map(function(k){ return "<tr><td class='url' title='" + esc(k) + "'>" + esc(k) + "</td><td class='num'>" + fmt(unmatched[k]) + "</td></tr>"; }).join("") + "</table>";
  }
  if (!extra) extra = "<h2>More detail</h2><p class='hint'>Device split, clicks by day and bot filtering appear when your data includes UserAgent and EventDate columns (Outlook tracker exports).</p>";
  $("#rep-extra").innerHTML = extra;

  var notes = [];
  if (wantUnique && !uniqueAvail) notes.push("This data has no unique click column or recipient, so total clicks are shown.");
  if (imgInfo.placeholders) notes.push(imgInfo.placeholders + " image(s) shown as labelled boxes" + (imgInfo.real ? ", " + imgInfo.real + " loaded from your files" : "") + ". " + (imgInfo.guessed ? "Dashed boxes have a guessed height, so spots below them may sit slightly off. " : "") + "Add the image files above to see the real email.");
  var totalRaw = 0; clicks.forEach(function(r){ totalRaw += r.count; });
  if (!totalRaw) msg(box, "warn", "No click rows found in the data.");
  else if (notes.length) msg(box, "warn", notes.map(esc).join("<br>"));
  else msg(box, "ok", "Heatmap built from " + fmt(totalRaw) + " clicks.");
}
$("#rep-go").addEventListener("click", buildReport);
["metric","width"].forEach(function(n){ document.querySelectorAll("input[name=" + n + "]").forEach(function(r){ r.addEventListener("change", function(){ if (!$("#rep-out").classList.contains("hidden")) buildReport(); }); }); });
["#opt-labels","#opt-zero","#opt-bots","#opt-online"].forEach(function(s){ $(s).addEventListener("change", function(){ if (!$("#rep-out").classList.contains("hidden")) buildReport(); }); });

window.__ehm = { tagHtml: tagHtml, parseData: parseData, normUrl: normUrl, demoEmail: demoEmail, demoData: demoData, flagBots: flagBots };
})();
