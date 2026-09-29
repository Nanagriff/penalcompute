/*
 * Administration page. Plain DOM, no libraries, no inline script or style (the
 * page's Content-Security-Policy allows neither). Everything that came from a
 * reviewer or a device is written with textContent, never as HTML.
 */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var SVG = "http://www.w3.org/2000/svg";
  var state = { view: "usage", days: 30, filter: "all", usage: null, reports: null, statuses: [], engine: false };
  var redraws = [];

  var SCENARIOS = {
    simple: "Single sentence",
    additional: "Additional sentence",
    counts: "Several counts",
    reduction: "Reduction or pardon",
    single_escape: "Escape and recapture",
    double_escape: "Two escapes",
    bailed_out: "Bailed out and re-admitted",
    hospital: "Hospital",
    forfeiture: "Forfeiture",
    date_diff: "Difference between dates",
    duration_sub: "Subtracting periods",
    one_third: "One third",
    punishment_loss: "Loss by punishment",
    licence: "Licence"
  };
  var STATUS = {
    open: "Open",
    engine_right: "Engine was right",
    reviewer_right: "Reviewer was right",
    fixed: "Fixed"
  };
  var INPUTS = {
    date_of_sentence: "Date of sentence", sentence: "Sentence", offence_class: "Offence",
    first: "First sentence", first_class: "First offence", second: "Second sentence", second_class: "Second offence",
    cut: "Reduced by", groups: "Counts", extra_sentence: "Sentence for escaping",
    date_of_escape: "Date of escape", date_of_recapture: "Date of recapture",
    date_of_escape_1: "First escape", date_of_recapture_1: "First recapture",
    date_of_escape_2: "Second escape", date_of_recapture_2: "Second recapture",
    date_of_bail: "Date of bail", date_of_readmission: "Date of re-admission",
    hospital_from: "In hospital from", hospital_to: "In hospital to",
    forfeited_days: "Days forfeited", close_days: "Close confinement, days", diet_days: "Reduced diet, days",
    same_date: "Awarded on the same date", later: "Later date", earlier: "Earlier date",
    a: "From", b: "Take away", n: "Days", sex: "Sex", offence: "Offence"
  };
  var POLICY = {
    leap_rule: ["Leap year rule", "gregorian", { gregorian: "true rule", divide_by_4: "booklet rule, divisible by 4" }],
    month_end_preservation: ["Month end kept", true, { "true": "yes", "false": "no" }],
    escape_remission_base: ["Remission after escape on", "original", { original: "the original sentence", residue: "the residue" }]
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- small helpers -------------------------------------------------------

  function h(tag, attrs) {
    var el = document.createElement(tag);
    fill(el, attrs, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(SVG, tag);
    fill(el, attrs, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function fill(el, attrs, kids) {
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") el.textContent = String(v);
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    kids.forEach(function add(kid) {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) return kid.forEach(add);
      el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    });
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function num(n) { return Number(n || 0).toLocaleString("en-GB"); }
  function plural(n, one, many) { return num(n) + " " + (n === 1 ? one : many); }
  function percent(part, whole) { return whole ? Math.round((100 * part) / whole) + "%" : "0%"; }
  function dayParts(iso) { var p = iso.split("-"); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function shortDay(iso) { var p = dayParts(iso); return p.d + " " + MONTHS[p.m - 1]; }
  function longDay(iso) { var p = dayParts(iso); return p.d + " " + MONTHS[p.m - 1] + " " + p.y; }
  function weekday(iso) {
    var p = dayParts(iso);
    return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 Sunday
  }
  function moment(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", " +
      two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + " GMT";
  }
  /** A shorter moment for table cells: "28 Sep 2026 17:01". */
  function stamp(iso) { return moment(iso).replace(",", "").replace(" GMT", ""); }
  function duration(v) {
    var bits = [];
    if (v.years) bits.push(v.years + (v.years > 1 ? "yrs" : "yr"));
    if (v.months) bits.push(v.months + (v.months > 1 ? "mths" : "mth"));
    if (v.days) bits.push(v.days + (v.days > 1 ? "days" : "day"));
    return bits.length ? bits.join(" ") : "nil";
  }
  function isDuration(v) { return v && typeof v === "object" && !Array.isArray(v) && ("days" in v || "months" in v || "years" in v); }
  function inputValue(key, v) {
    if (key === "groups" && Array.isArray(v)) {
      return v.map(function (g, i) {
        return "Group " + String.fromCharCode(65 + i) + ": " + g.map(duration).join(", ");
      }).join("; ");
    }
    if (Array.isArray(v) && v.length === 3) return v.join("-");
    if (isDuration(v)) return duration(v);
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }
  function label(map, key) {
    if (map[key]) return map[key];
    var t = String(key).replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function api(path, options) {
    options = options || {};
    var init = { method: options.method || "GET", credentials: "same-origin", headers: {} };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(function (res) {
      if (res.status === 401 && !options.login) {
        showLogin(true, "Your session has ended. Sign in again.");
        throw new Error("signed out");
      }
      if (res.status === 204) return { ok: true, status: 204, data: null };
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  // ---- sign in -------------------------------------------------------------

  function showLogin(configured, message) {
    redraws = [];
    clear(app);
    var error = h("p", { class: "alert", role: "alert", text: message || "", hidden: !message });
    var sheet = h("section", { class: "sheet login" }, h("h2", { text: "Sign in" }));
    if (!configured) {
      sheet.appendChild(h("p", { text: "No admin password has been set on the server yet. On the machine you deploy from, run:" }));
      sheet.appendChild(h("pre", { class: "mono", text: "./deploy/set-admin-password.sh" }));
      sheet.appendChild(h("p", { class: "quiet-note", text: "Then reload this page." }));
      app.appendChild(sheet);
      return;
    }
    var password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true, maxlength: 256 });
    var button = h("button", { type: "submit", text: "Sign in" });
    var form = h("form", {
      onsubmit: function (e) {
        e.preventDefault();
        button.disabled = true;
        error.hidden = true;
        api("/admin/api/login", { method: "POST", body: { password: password.value }, login: true }).then(function (r) {
          if (r.ok) return start();
          button.disabled = false;
          password.value = "";
          password.focus();
          error.hidden = false;
          error.textContent = r.status === 429 ? "Too many failed attempts. Try again in an hour."
            : r.status === 401 ? "That password is not right."
            : r.status === 503 ? "No admin password has been set on the server."
            : "The server could not sign you in (" + r.status + ").";
        }).catch(function () {
          button.disabled = false;
          error.hidden = false;
          error.textContent = "The server could not be reached.";
        });
      }
    },
      h("label", { class: "stack" }, h("span", { text: "Admin password" }), password),
      button, error);
    sheet.appendChild(h("p", { class: "quiet-note", text: "One password, shared by the people who look after the tool." }));
    sheet.appendChild(form);
    app.appendChild(sheet);
    password.focus();
  }

  // ---- shell ---------------------------------------------------------------

  var body;

  function shell() {
    clear(app);
    var open = state.reports ? state.reports.filter(function (r) { return r.status === "open"; }).length : 0;
    var tab = function (id, text, count) {
      return h("button", {
        type: "button", role: "tab", id: "tab-" + id, "aria-selected": state.view === id ? "true" : "false",
        "aria-controls": "panel",
        onclick: function () { state.view = id; shell(); }
      }, text, count ? h("span", { class: "count", text: " (" + count + " open)" }) : null);
    };
    app.appendChild(h("div", { class: "topbar" },
      h("div", { class: "tabs", role: "tablist", "aria-label": "Sections" }, tab("usage", "Usage"), tab("reports", "Reports", open)),
      h("button", {
        type: "button", class: "quiet", text: "Sign out",
        onclick: function () {
          api("/admin/api/logout", { method: "POST" }).then(function () { showLogin(true); }, function () { showLogin(true); });
        }
      })));
    body = h("div", { id: "panel", role: "tabpanel", "aria-labelledby": "tab-" + state.view });
    app.appendChild(body);
    redraws = [];
    if (state.view === "usage") usageView(); else reportsView();
  }

  // ---- usage ---------------------------------------------------------------

  var RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]];

  function usageView() {
    clear(body);
    var content = h("div", {});
    var ranges = h("div", { class: "segmented", role: "group", "aria-label": "Period" }, RANGES.map(function (r) {
      return h("button", {
        type: "button", text: r[1], "aria-pressed": state.days === r[0] ? "true" : "false",
        onclick: function () {
          if (state.days === r[0]) return;
          state.days = r[0];
          Array.prototype.forEach.call(ranges.children, function (b) {
            b.setAttribute("aria-pressed", b === this ? "true" : "false");
          }, this);
          content.classList.add("is-stale");   // hold the last render while the new one loads
          loadUsage().then(function () { content.classList.remove("is-stale"); drawUsage(content); });
        }
      });
    }));
    body.appendChild(h("div", { class: "filters" }, h("span", { class: "legend", text: "Period, ending today" }), ranges));
    body.appendChild(content);
    if (state.usage) drawUsage(content);
    else content.appendChild(h("p", { class: "quiet-note", text: "Loading." }));
  }

  function loadUsage() {
    return api("/admin/api/usage?days=" + state.days).then(function (r) {
      if (r.ok) state.usage = r.data;
    });
  }

  function tile(text, value, note, cls) {
    return h("div", { class: "tile" + (cls ? " " + cls : "") },
      h("p", { class: "label", text: text }),
      h("p", { class: "value", text: value }),
      note ? h("p", { class: "note", text: note }) : null);
  }

  function drawUsage(root) {
    var u = state.usage;
    redraws = [];
    clear(root);
    var period = "the last " + (u.days === 365 ? "year" : u.days + " days");

    root.appendChild(h("div", { class: "tiles" },
      tile("Computations in " + period, num(u.total),
        u.first_day ? num(u.all_time) + " since counting began on " + longDay(u.first_day) : "Nothing counted yet", "hero"),
      tile("Today", num(u.today)),
      tile("Last 7 days", num(u.last_7_days)),
      tile("Devices in " + period, num(u.devices), num(u.devices_all_time) + " in all"),
      tile("Open reports", num(u.reports_open), "of " + plural(u.reports_total, "report", "reports"), u.reports_open ? "attention" : "")));

    if (!u.all_time) {
      root.appendChild(h("section", { class: "sheet" },
        h("h2", { text: "Nothing has been counted yet" }),
        h("p", { class: "empty", text: "Counting starts when officers load a build of the tool that includes it. A device that still has an older build keeps working and is not counted until it updates." })));
      return;
    }

    // computations over time
    var weekly = u.days > 90;
    var bins = weekly ? byWeek(u.daily) : u.daily.map(function (d) {
      return { key: d.day, n: d.n, tick: shortDay(d.day), title: longDay(d.day) };
    });
    var time = h("section", { class: "sheet" },
      h("h2", { text: weekly ? "Computations per week" : "Computations per day" }),
      h("p", { class: "caption", text: longDay(u.from) + " to " + longDay(u.to) + (weekly ? ". Weeks begin on Monday." : ".") }));
    var fig = h("figure", { class: "chart" });
    time.appendChild(fig);
    time.appendChild(tableToggle("Show the days as a table", function () {
      return dataTable(["Day", "Computations", "Devices"], u.daily.slice().reverse().map(function (d) {
        return [longDay(d.day), num(d.n), num(d.devices)];
      }), [1, 2]);
    }));
    root.appendChild(time);
    chart(fig, function (width) { return columns(fig, bins, width); });

    // kinds, and how the tool is reached
    var kinds = h("section", { class: "sheet" },
      h("h2", { text: "Kind of computation" }),
      h("p", { class: "caption", text: "What was computed in " + period + ", most used first." }));
    var kfig = h("figure", { class: "chart" });
    kinds.appendChild(kfig);
    var rows = u.scenarios.map(function (r) { return { name: label(SCENARIOS, r.scenario), n: r.n }; });

    var how = h("section", { class: "sheet" },
      h("h2", { text: "How the tool is reached" }),
      h("p", { class: "caption", text: "Out of " + plural(u.total, "computation", "computations") + " in " + period + "." }));
    var hfig = h("figure", { class: "chart" });
    how.appendChild(hfig);
    var meters = [
      { name: "From the app installed on the device", n: u.installed },
      { name: "While the device was offline", n: u.offline },
      { name: "Refused by the engine", n: u.failed }
    ];
    how.appendChild(h("p", { class: "chart-foot quiet-note", text: "A refusal is an order the engine would not compute, such as a recapture dated before the escape." }));

    // attach first, then draw: a figure has no width until it is in the page
    root.appendChild(h("div", { class: "pair" }, kinds, how));
    chart(kfig, function (width) { return bars(kfig, rows, u.total, width, "computation", "computations"); });
    chart(hfig, function (width) { return bars(hfig, meters, u.total, width, "computation", "computations", true); });

    // versions in the field
    var versions = h("section", { class: "sheet" },
      h("h2", { text: "Versions in use" }),
      h("p", { class: "caption", text: "A device keeps its build until the officer accepts the update, so older builds stay in the field for a while." }));
    versions.appendChild(h("div", { class: "table-wrap free" }, dataTable(
      ["Engine", "Built", "Computations", "Devices", "Last used"],
      u.versions.map(function (v) {
        return [v.engine_version, v.build_date ? stamp(v.build_date) : "unknown", num(v.n), num(v.devices), stamp(v.last_at)];
      }), [2, 3], "nowrap")));
    root.appendChild(versions);
  }

  function byWeek(daily) {
    var weeks = [];
    daily.forEach(function (d) {
      var last = weeks[weeks.length - 1];
      if (!last || weekday(d.day) === 1) {
        last = { key: d.day, n: 0, from: d.day, to: d.day };
        weeks.push(last);
      }
      last.n += d.n;
      last.to = d.day;
    });
    weeks.forEach(function (w) {
      w.tick = shortDay(w.from);
      w.title = w.from === w.to ? longDay(w.from) : shortDay(w.from) + " to " + longDay(w.to);
    });
    return weeks;
  }

  // ---- charts --------------------------------------------------------------

  /** Draw now, and again whenever the figure's width changes. */
  function chart(fig, draw) {
    var drawn = 0;
    var go = function () {
      var width = Math.floor(fig.clientWidth);
      if (!width || width === drawn) return;
      drawn = width;
      clear(fig);
      fig.appendChild(draw(width));
      fig.appendChild(h("div", { class: "tooltip", hidden: true, role: "status" }));
    };
    redraws.push(go);
    go();
  }

  function tip(fig, target, value, text) {
    var box = fig.querySelector(".tooltip");
    if (!box) return;
    clear(box);
    box.appendChild(h("b", { text: value }));
    box.appendChild(h("span", { text: text }));
    box.hidden = false;
    var f = fig.getBoundingClientRect();
    var t = target.getBoundingClientRect();
    var left = t.left - f.left + t.width / 2 - box.offsetWidth / 2;
    left = Math.max(0, Math.min(left, f.width - box.offsetWidth));
    var top = t.top - f.top - box.offsetHeight - 8;
    box.style.left = left + "px";
    box.style.top = Math.max(-box.offsetHeight, top) + "px";
  }
  function untip(fig) {
    var box = fig.querySelector(".tooltip");
    if (box) box.hidden = true;
  }

  /** A top for the axis that lands on a round number, with whole-number steps. */
  function scale(max) {
    if (max <= 4) return { top: Math.max(max, 4), step: 1 };
    var rough = max / 4;
    var pow = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * pow; }).filter(function (v) {
      return v >= rough && v === Math.round(v);
    })[0] || 10 * pow;
    return { top: Math.ceil(max / step) * step, step: step };
  }

  /** Column chart, one series. The top of each column is rounded, the foot is square on the baseline. */
  function columns(fig, bins, width) {
    var max = bins.reduce(function (m, b) { return Math.max(m, b.n); }, 0);
    var sc = scale(max);
    var pad = { top: 22, right: 8, bottom: 26, left: String(num(sc.top)).length * 7 + 14 };
    var plotH = 200;
    var height = pad.top + plotH + pad.bottom;
    var plotW = Math.max(60, width - pad.left - pad.right);
    var band = plotW / bins.length;
    var bar = Math.max(1, Math.min(24, band - 2));
    var y = function (v) { return pad.top + plotH - (v / sc.top) * plotH; };
    var root = s("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "img",
      "aria-label": "Column chart of computations over time. The same figures are in the table below." });

    for (var v = 0; v <= sc.top + 1e-9; v += sc.step) {
      root.appendChild(s("line", { class: v === 0 ? "axis-line" : "grid-line", x1: pad.left, x2: pad.left + plotW, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 }));
      root.appendChild(s("text", { class: "tick", x: pad.left - 8, y: y(v) + 4, "text-anchor": "end", text: num(v) }));
    }

    // about six date ticks, always including the last column
    var every = Math.max(1, Math.ceil(bins.length / Math.max(2, Math.floor(plotW / 72))));
    var peak = -1;
    bins.forEach(function (b, i) { if (b.n > 0 && (peak < 0 || b.n > bins[peak].n)) peak = i; });

    bins.forEach(function (b, i) {
      var cx = pad.left + band * i + band / 2;
      var top = y(b.n);
      var hgt = pad.top + plotH - top;
      var r = Math.min(4, bar / 2, hgt);
      var x0 = cx - bar / 2;
      var g = s("g", { class: "col" });
      g.appendChild(s("rect", { class: "band", x: pad.left + band * i, y: pad.top, width: band, height: plotH }));
      var mark = null;
      if (b.n > 0) {
        mark = s("path", { class: "mark", d:
          "M" + x0 + "," + (top + hgt) + " V" + (top + r) + " Q" + x0 + "," + top + " " + (x0 + r) + "," + top +
          " H" + (x0 + bar - r) + " Q" + (x0 + bar) + "," + top + " " + (x0 + bar) + "," + (top + r) +
          " V" + (top + hgt) + " Z" });
        g.appendChild(mark);
      }
      var words = plural(b.n, "computation", "computations");
      var hit = s("rect", { class: "hit", x: pad.left + band * i, y: pad.top, width: band, height: plotH + pad.bottom,
        tabindex: 0, role: "img", "aria-label": b.title + ": " + words });
      var on = function () { if (mark) mark.classList.add("is-on"); tip(fig, mark || hit, num(b.n), b.title); };
      var off = function () { if (mark) mark.classList.remove("is-on"); untip(fig); };
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("pointerleave", off);
      hit.addEventListener("focus", on);
      hit.addEventListener("blur", off);
      g.appendChild(hit);
      root.appendChild(g);

      if ((bins.length - 1 - i) % every === 0) {
        var anchor = i === bins.length - 1 && band < 40 ? "end" : "middle";
        root.appendChild(s("text", { class: "tick", x: anchor === "end" ? pad.left + plotW : cx, y: pad.top + plotH + 18, "text-anchor": anchor, text: b.tick }));
      }
      if (i === peak) {
        var lx = Math.max(pad.left + 12, Math.min(cx, pad.left + plotW - 12));
        root.appendChild(s("text", { class: "value-label", x: lx, y: top - 6, "text-anchor": "middle", text: num(b.n) }));
      }
    });
    return root;
  }

  /**
   * Horizontal bars, one colour: the rows are names, not a scale. The name sits
   * above its bar so a long name never squeezes the bar on a phone. With
   * `meter` each bar is a share of the whole and rides on a track.
   */
  function bars(fig, rows, total, width, one, many, meter) {
    var rowH = 46;
    var valueW = 92;
    var barW = Math.max(40, width - valueW);
    var max = meter ? total : rows.reduce(function (m, r) { return Math.max(m, r.n); }, 0);
    var height = rows.length * rowH;
    var root = s("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "img",
      "aria-label": "Bar chart. Every figure is written beside its bar." });
    rows.forEach(function (r, i) {
      var top = i * rowH;
      var len = max ? Math.max(r.n ? 2 : 0, (r.n / max) * barW) : 0;
      var rad = Math.min(4, len / 2);
      var share = percent(r.n, total);
      var g = s("g", { class: "col" });
      g.appendChild(s("text", { class: "row-label", x: 0, y: top + 15, text: r.name }));
      var by = top + 23;
      if (meter) g.appendChild(s("rect", { class: "track", x: 0, y: by, width: barW, height: 12, rx: 4 }));
      var hit = s("rect", { class: "hit", x: 0, y: top, width: width, height: rowH, tabindex: 0, role: "img",
        "aria-label": r.name + ": " + plural(r.n, one, many) + ", " + share + " of the period" });
      g.appendChild(hit);
      var mark = null;
      if (len > 0) {
        mark = s("path", { class: "mark", d:
          "M0," + by + " H" + (len - rad) + " Q" + len + "," + by + " " + len + "," + (by + rad) +
          " V" + (by + 12 - rad) + " Q" + len + "," + (by + 12) + " " + (len - rad) + "," + (by + 12) + " H0 Z" });
        g.appendChild(mark);
      }
      var vx = meter ? barW + 10 : len + 8;
      var value = s("text", { class: "row-value", x: vx, y: by + 11, text: num(r.n) });
      value.appendChild(s("tspan", { class: "row-share", dx: 6, text: share }));
      g.appendChild(value);
      var on = function () { tip(fig, mark || hit, num(r.n), r.name + " · " + share + " of the period"); };
      var off = function () { untip(fig); };
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("pointerleave", off);
      hit.addEventListener("focus", on);
      hit.addEventListener("blur", off);
      root.appendChild(g);
    });
    return root;
  }

  function dataTable(heads, rows, numeric, cls) {
    numeric = numeric || [];
    var isNum = function (i) { return numeric.indexOf(i) >= 0; };
    return h("table", { class: "data" + (cls ? " " + cls : "") },
      h("thead", {}, h("tr", {}, heads.map(function (t, i) { return h("th", { scope: "col", class: isNum(i) ? "num" : null, text: t }); }))),
      h("tbody", {}, rows.map(function (r) {
        return h("tr", {}, r.map(function (c, i) {
          return i === 0 ? h("th", { scope: "row", text: c }) : h("td", { class: isNum(i) ? "num" : null, text: c });
        }));
      })));
  }

  function tableToggle(text, build) {
    var wrap = h("div", { class: "table-wrap", hidden: true });
    var button = h("button", {
      type: "button", class: "link", text: text, "aria-expanded": "false",
      onclick: function () {
        var show = wrap.hidden;
        if (show && !wrap.firstChild) wrap.appendChild(build());
        wrap.hidden = !show;
        button.setAttribute("aria-expanded", show ? "true" : "false");
        button.textContent = show ? "Hide the table" : text;
      }
    });
    return h("div", {}, h("p", { class: "chart-foot" }, button), wrap);
  }

  // ---- reports -------------------------------------------------------------

  function reportsView() {
    clear(body);
    var all = state.reports || [];
    var count = function (id) { return id === "all" ? all.length : all.filter(function (r) { return r.status === id; }).length; };
    var filters = h("div", { class: "segmented", role: "group", "aria-label": "Show" },
      ["all"].concat(state.statuses).map(function (id) {
        return h("button", {
          type: "button", "aria-pressed": state.filter === id ? "true" : "false",
          text: (id === "all" ? "All" : label(STATUS, id)) + " (" + count(id) + ")",
          onclick: function () { state.filter = id; reportsView(); }
        });
      }));
    body.appendChild(h("div", { class: "filters" }, filters, h("span", { class: "spacer" }),
      h("a", { href: "/admin/api/reports/vectors", download: "reviewer.json", text: "Download as test vectors" })));

    if (!all.length) {
      body.appendChild(h("section", { class: "sheet" }, h("h2", { text: "No reports yet" }),
        h("p", { class: "empty", text: "A report arrives when an officer presses “This answer is wrong” under a computation and gives the dates from their own working." })));
      return;
    }
    var shown = all.filter(function (r) { return state.filter === "all" || r.status === state.filter; });
    if (!shown.length) body.appendChild(h("p", { class: "quiet-note", text: "No reports with this status." }));
    shown.forEach(function (r) { body.appendChild(report(r)); });
  }

  function report(r) {
    var card = h("article", { class: "sheet report" });
    var badge = h("span", { class: "badge " + r.status, text: label(STATUS, r.status) });
    card.appendChild(h("header", {},
      h("h2", { text: "Report " + r.id + " · " + label(SCENARIOS, r.scenario) }),
      h("p", { class: "when" }, moment(r.received_at) + " ", badge)));

    card.appendChild(h("h3", { text: "The order as entered" }));
    var dl = h("dl", { class: "inputs" });
    Object.keys(r.inputs).forEach(function (k) {
      dl.appendChild(h("dt", { text: label(INPUTS, k) }));
      dl.appendChild(h("dd", { text: inputValue(k, r.inputs[k]) }));
    });
    Object.keys(r.policy || {}).forEach(function (k) {
      var p = POLICY[k];
      if (p && r.policy[k] === p[1]) return;   // the default: nothing to say
      dl.appendChild(h("dt", { text: p ? p[0] : label({}, k) }));
      dl.appendChild(h("dd", { text: p ? (p[2][String(r.policy[k])] || String(r.policy[k])) : String(r.policy[k]) }));
    });
    card.appendChild(dl);

    card.appendChild(h("h3", { text: "The answers" }));
    var now = r.engine_now;
    var rowHead = function (text, sub) { return h("th", { scope: "row" }, text, sub ? h("span", { class: "sub", text: sub }) : null); };
    var cell = function (v) { return h("td", { text: v || "not given" }); };
    var tbody = h("tbody", {},
      h("tr", {}, rowHead("Engine at the time", "engine " + r.engine_version + (r.build_date ? ", build of " + moment(r.build_date) : "")),
        cell(r.engine_lpd), cell(r.engine_epd)),
      h("tr", {}, rowHead("Reviewer", r.reviewer_token ? "token " + r.reviewer_token : null), cell(r.reviewer_lpd), cell(r.reviewer_epd)));
    if (now && !now.error) {
      tbody.appendChild(h("tr", { class: "now" }, rowHead("Engine now", now.remission && now.remission !== "nil" ? "remission " + now.remission : null),
        cell(now.lpd), cell(now.epd)));
    }
    card.appendChild(h("div", { class: "table-wrap" },
      h("table", { class: "data answers" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "" }), h("th", { scope: "col", text: "LPD" }), h("th", { scope: "col", text: "EPD or D/R" }))),
        tbody)));
    if (now && now.error) {
      card.appendChild(h("p", { class: "verdict differs", text: "The engine now refuses this order: " + now.error }));
    } else if (r.engine_now_agrees === true) {
      card.appendChild(h("p", { class: "verdict agrees", text: "The engine now gives the reviewer's dates." }));
    } else if (r.engine_now_agrees === false) {
      card.appendChild(h("p", { class: "verdict differs", text: "The engine still gives different dates from the reviewer." }));
    }
    if (now && now.flags && now.flags.length) {
      now.flags.forEach(function (f) { card.appendChild(h("p", { class: "quiet-note", text: "Flag: " + f })); });
    }

    card.appendChild(h("h3", { text: "The reviewer's reason" }));
    card.appendChild(r.comment ? h("blockquote", { class: "comment", text: r.comment }) : h("p", { class: "quiet-note", text: "No reason was given." }));

    if (now && now.render) {
      card.appendChild(h("details", { class: "working" },
        h("summary", { text: "The working as the engine sets it out now" }),
        h("pre", { text: now.render })));
    }

    var select = h("select", { name: "status" }, state.statuses.map(function (id) {
      return h("option", { value: id, selected: id === r.status, text: label(STATUS, id) });
    }));
    var note = h("input", { type: "text", name: "note", maxlength: 500, value: r.status_note, placeholder: "For example: fixed in engine 1.1.0" });
    var saved = h("p", { class: "saved", role: "status", text: r.status_at ? "Last changed " + moment(r.status_at) + "." : "" });
    var save = h("button", { type: "submit", text: "Save" });
    card.appendChild(h("form", {
      class: "status",
      onsubmit: function (e) {
        e.preventDefault();
        save.disabled = true;
        api("/admin/api/reports/" + r.id + "/status", { method: "POST", body: { status: select.value, note: note.value } }).then(function (res) {
          save.disabled = false;
          if (!res.ok) { saved.textContent = "Not saved (" + res.status + ")."; return; }
          r.status = res.data.status;
          r.status_note = res.data.status_note;
          r.status_at = res.data.status_at;
          saved.textContent = "Saved " + moment(r.status_at) + ".";
          badge.className = "badge " + r.status;
          badge.textContent = label(STATUS, r.status);
          refreshCounts();
        }).catch(function () { save.disabled = false; saved.textContent = "Not saved: the server could not be reached."; });
      }
    },
      h("label", { class: "stack" }, h("span", { text: "Status" }), select),
      h("label", { class: "stack" }, h("span", { text: "Note" }), note),
      save, saved));
    return card;
  }

  /** After a status change: the counts in the tab and the filter row, without redrawing the cards. */
  function refreshCounts() {
    var all = state.reports || [];
    var open = all.filter(function (r) { return r.status === "open"; }).length;
    var tab = document.getElementById("tab-reports");
    if (tab) {
      clear(tab);
      tab.appendChild(document.createTextNode("Reports"));
      if (open) tab.appendChild(h("span", { class: "count", text: " (" + open + " open)" }));
    }
    var buttons = body.querySelectorAll(".filters .segmented button");
    ["all"].concat(state.statuses).forEach(function (id, i) {
      var n = id === "all" ? all.length : all.filter(function (r) { return r.status === id; }).length;
      if (buttons[i]) buttons[i].textContent = (id === "all" ? "All" : label(STATUS, id)) + " (" + n + ")";
    });
    if (state.usage) state.usage.reports_open = open;
  }

  // ---- start ---------------------------------------------------------------

  function start() {
    clear(app);
    app.appendChild(h("p", { class: "quiet-note", text: "Loading." }));
    return Promise.all([
      loadUsage(),
      api("/admin/api/reports").then(function (r) {
        if (r.ok) {
          state.reports = r.data.reports;
          state.statuses = r.data.statuses;
          state.engine = r.data.engine_available;
        }
      })
    ]).then(shell).catch(function (e) {
      if (e && e.message === "signed out") return;
      clear(app);
      app.appendChild(h("p", { class: "alert", role: "alert", text: "The server could not be reached. Reload to try again." }));
    });
  }

  var pending = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(pending);
    pending = window.setTimeout(function () { redraws.forEach(function (f) { f(); }); }, 120);
  });

  api("/admin/api/session", { login: true }).then(function (r) {
    if (r.ok && r.data.authenticated) return start();
    showLogin(r.ok ? r.data.configured : true, r.ok ? "" : "The server could not be reached.");
  }).catch(function () {
    showLogin(true, "The server could not be reached.");
  });
})();
