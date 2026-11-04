/* Help popup + guided onboarding.  Edit the two blocks below; the engine at the bottom needs no changes.
 *
 * Step fields (all optional except title/text):
 *   title, text     shown in the step card (text may contain HTML)
 *   highlight       what to spotlight, one of:
 *                     "#cssSelector"                          an element on the page
 *                     { rect: [x, y, w, h] }                  fractions of the viewport, e.g. [0.3, 0.3, 0.4, 0.3]
 *                     { bbox: [west, south, east, north] }    a geographic box on the map; the map is fitted to it
 *                                                             (unless map.center is set) and the spotlight follows the map
 *                                                             at any screen size. Elements are scrolled into view first.
 *                     null                                    no spotlight (dim only)
 *   map             { center: [lon, lat], zoom, basemap: "osm"|"sat"|"none", opacity: 0..1 } – moves the map first
 *                   (when a step has `point` but no map.center, the map pans to the point, or fits several points)
 *   point           [lon, lat] for one point, or [[lon, lat], [lon, lat], ...] for several (the last is selected);
 *                   null clears all points; leave it out to keep the current points
 *   (highlight may also be an array of selectors – the box covers all of them)
 *   panel           "layers" | "legend" | null – which side panel to open (null closes them)
 *   card            "top" | "bottom" – where the step card sits (default: auto, opposite the spotlight)
 */
const HELP_INTRO = {
  title: "Proposed Road Circulation Map - Bengaluru",
  html: `
    <p>The government has notified Road Circulation Maps inviting suggestions from the public before the final approval. This is an important step in designing mobility solutions for Bengaluru.</p><p>You can use this tool to explore the maps shared by GBA and BDA and share your feedback on email. </p>
    <p><button class="btn" id="helpMore" aria-expanded="false" aria-controls="helpMoreBody">Read more</button></p>
    <div id="helpMoreBody" hidden>
    <b>What is a Road Circulation Map?</b>
    <p>A circulation plan is a structured spatial and traffic management scheme that organizes how people, vehicles, and goods move through a city or specific urban district. It forms part of the city’s master plan and includes a comprehensive road network comprising major and minor roads and highways, along with traffic circulation patterns to meet present and future transportation needs and proposals for network improvements.</p>
    <b>What can you do with this tool?</b>
    <ul>
        <li>Locate your area on the relevant grid and study proposed/existing roads around you. Check which proposed roads already exist on the ground. Identify alignments that cut through builtup areas, lakes, parks or other conflicts. Note mobility gaps: congestion points, unsafe stretches, poor connectivity to public transport</li>
        <li>Write your suggestions/objections clearly, with specific locations and requests. State whether each point is an objection, a suggestion, or a request for clarity (e.g. existing vs new roads, rationale for new roads). Add evidence if possible – Photos, maps and location details of conflicts or ground conditions</li>
        <li>Send feedback based on the jurisdiction you fall under — GBA (erstwhile BBMP area) or BDA (surrounding area)</li>
    </ul>
    <b>Government Notifications</b>
    <p>The Greater Bengaluru Authority (GBA) notified the Road Circulation Map on October 12, 2026, inviting suggestions and objections The Road Circulation Map forms one of the components of the Master Plan under this statutory framework. The Road Circulation Maps can be inspected at all five city corporation offices and online, and written representations go to the Office of the Chief Town Planner, GBA Head Office, NR Square, Bengaluru – 560002 (in person, registered post, or email to gba.masterplan@gmail.com). Deadline: Dec 11, 2026 GBA</p>
    <p>Bangalore Development Authority (BDA), which covers the surrounding jurisdiction, has its maps online and accepts submissions through its Town Planner Member (bdarmp2041@gmail.com). Deadline: Dec 8th, 2026</p><br>
    <p><a href="https://citizenmatters.in/bengalurus-road-circulation-plans-have-your-say-to-fix-the-citys-mobility-problems/" target="_blank">Click here</a> for more details about the proposal and the feedback process.</p>
    </div>`,
};

const HELP_STEPS = [
  { title: "1 · Find your area",
    text: "Search for a place, or tap the location button, to find your area on the grid. Study the proposed and existing roads around you.",
    highlight: "#searchbar", panel: null, point: null,
    map: { center: [77.5946, 12.9716], zoom: 12, basemap: "osm" } },
  { title: "2 · Read the legend",
    text: "Check the legend. Purple roads are proposed; compare them with what already exists on the ground.",
    highlight: "#pLegend", panel: "legend" },
  { title: "3 · Adjust the opacity",
    text: "Use the opacity slider to fade the plan against the current reality, e.g. satellite imagery below.",
    highlight: "#gop", panel: "layers",
    map: { basemap: "sat", opacity: 0.6 } },
  { title: "4 · Spot conflicts",
    text: "Look for proposed alignments that cut through built-up areas, lakes, parks or other conflicts.",
    highlight: { bbox: [77.5402, 12.8621, 77.5425, 12.8643] }, panel: null,
    map: { basemap: "sat", opacity: 0.6 } },
  { title: "5 · Click a point",
    text: "Click anywhere on the map to get information about that point: the sheet overlay, grid number, corporation and source.",
    highlight: "#card", point: [77.5946, 12.9716], card: "top" },
  { title: "6 · Add more points",
    text: "Add more points if you want to compare locations side by side or provide feedback relevant to multiple points.",
    highlight: '#card [data-a="add"]', card: "top",
    point: [[77.5946, 12.9716], [77.6010, 12.9780]] },
  { title: "7 · Send your feedback",
    text: "For points under GBA, use the email buttons to draft a message to GBA. \"Email all points\" sends GBA a single email and copies BDA if some of your points fall under BDA. Add your own feedback before sending.",
    highlight: ['#card [data-a="mail1"]', '#card [data-a="mailall"]'], card: "top" },
  { title: "8 · BDA uses a feedback form",
    text: "BDA collects feedback on its own form rather than by email directly. For points in BDA's area, <b>Download Suggestions Form</b> gives you the official blank form. Fill it in with your details, locations and comments, sign it, then hand it in or email it to <b>bdarmp2041@gmail.com</b> before the deadline.",
    highlight: '#card [data-a="bdaform"]', card: "top",
    point: [77.6858, 12.8288] },
];

//const HELP_TIPS = [
//  "Write your suggestions or objections clearly, with specific requests relevant to the locations.",
//  "Note mobility gaps you experience: congestion points, unsafe stretches, poor bus/metro feeder access.",
//  "State whether each point is an <b>objection</b>, a <b>suggestion</b>, or a <b>request for clarity</b> (e.g. existing vs new roads, rationale for new roads).",
//  "Add evidence: attach photos, maps and details of conflicts or ground conditions.",
//  "The plan is based on ~2007 data. Point out where proposed roads already exist, conflict with built area or lakes, or no longer match ground conditions, and ask for clarity on existing vs. newly proposed roads.",
//  "Bring in the public transport angle: connectivity to bus/metro, access to employment centres, and whether the network works with, not against, public transport.",
//];

const HELP_SEEN_KEY = "gba-help-seen";

/* ---------------------------------------------------------------- engine */
(() => {
  const $h = id => document.getElementById(id);
  const seen = () => { try { return localStorage.getItem(HELP_SEEN_KEY) === "1"; } catch (e) { return false; } };
  const markSeen = () => { try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch (e) {} };

  /* intro popup */
  $h("helpBody").innerHTML = HELP_INTRO.html;
  $h("helpTitle").textContent = HELP_INTRO.title;
  $h("helpMore").onclick = () => {
    const hid = $h("helpMoreBody").hidden = !$h("helpMoreBody").hidden;
    $h("helpMore").textContent = hid ? "Read more" : "Show less";
    $h("helpMore").setAttribute("aria-expanded", String(!hid));
  };
  const openHelp = () => { $h("help").hidden = false; $h("bHelp").classList.add("on"); $h("helpGo").focus(); };
  const closeHelp = () => { $h("help").hidden = true; $h("bHelp").classList.remove("on"); markSeen(); };
  $h("bHelp").onclick = () => ($h("help").hidden ? openHelp() : closeHelp());
  $h("helpClose").onclick = closeHelp;
  $h("helpSkip").onclick = closeHelp;
  $h("help").addEventListener("click", e => { if (e.target === $h("help")) closeHelp(); });
  $h("helpGo").onclick = () => { closeHelp(); start(0); };

  /* tour */
  let i = -1;
  const tour = $h("tour"), spot = $h("spot"), stepCard = $h("stepCard");
  const nav = () => typeof map !== "undefined" && map;

  function rectOf(h) {
    if (!h) return null;
    if (typeof h === "string" || Array.isArray(h)) {
      const rs = [].concat(h).map(q => document.querySelector(q)).filter(el => el && !el.hidden && el.getClientRects().length)
        .map(el => el.getBoundingClientRect());
      if (!rs.length) return null;
      const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top));
      return { x: x0, y: y0, w: Math.max(...rs.map(r => r.right)) - x0, h: Math.max(...rs.map(r => r.bottom)) - y0 };
    }
    if (h.rect) { const [x, y, w, hh] = h.rect; return { x: x * innerWidth, y: y * innerHeight, w: w * innerWidth, h: hh * innerHeight }; }
    if (h.bbox && nav()) {
      const [w, s, e, n] = h.bbox, a = map.project([w, n]), b = map.project([e, s]);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    }
    return null;
  }

  function scrollToHighlight(h) {                       // bring DOM targets into view (scrollable panels / small screens)
    if (typeof h !== "string" && !Array.isArray(h)) return;
    const el = [].concat(h).map(q => document.querySelector(q)).find(e => e && !e.hidden && e.getClientRects().length);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest" });
  }

  function place() {
    const s = HELP_STEPS[i]; if (!s) return;
    scrollToHighlight(s.highlight);
    const r = rectOf(s.highlight), pad = 6;
    if (r) {
      if (fromPage) {                                    // first highlight of the tour: start from the whole page and shrink onto the target
        fromPage = false;
        Object.assign(spot.style, { display: "block", transition: "none", left: "0px", top: "0px", width: innerWidth + "px", height: innerHeight + "px" });
        spot.getBoundingClientRect();                    // commit the full-page box before animating
        spot.style.transition = "all .7s ease";
        setTimeout(() => { spot.style.transition = ""; }, 750);
      }
      Object.assign(spot.style, { display: "block", left: r.x - pad + "px", top: r.y - pad + "px", width: r.w + 2 * pad + "px", height: r.h + 2 * pad + "px" });
      tour.classList.remove("nohl");
    } else { spot.style.display = "none"; tour.classList.add("nohl"); }
    const wide = innerWidth > 620;
    stepCard.style.top = stepCard.style.bottom = stepCard.style.left = stepCard.style.right = "";
    let where = s.card || (r && r.y + r.h / 2 > innerHeight / 2 ? "top" : "bottom");
    if (wide) {                                          // on desktop, avoid the highlighted area horizontally too
      stepCard.style.left = (r && r.x + r.w / 2 < innerWidth / 2 ? innerWidth - 400 - 24 : 24) + "px";
      if (!r) stepCard.style.left = "50%", stepCard.style.transform = "translateX(-50%)"; else stepCard.style.transform = "";
    }
    stepCard.style[where === "top" ? "top" : "bottom"] = (where === "top" ? 70 : 24) + "px";
  }

  function apply(s) {
    if ("panel" in s) {
      for (const [k, [p, b]] of Object.entries(PANELS)) {
        const want = s.panel === k;
        if (want !== !$h(p).hidden) togglePanel(want ? k : null);
      }
      if (!s.panel) togglePanel(null);
    }
    if (s.point === null) { if (P.length) clearSelection(); }
    else if (s.point) {
      if (P.length) clearSelection();
      const pts = typeof s.point[0] === "number" ? [s.point] : s.point;
      pts.forEach(c => addPoint(c[0], c[1]));
      if (!(s.map && s.map.center)) {                      // no explicit map position: bring the point(s) into view
        if (pts.length === 1) map.jumpTo({ center: pts[0], zoom: Math.max(s.map && s.map.zoom != null ? s.map.zoom : map.getZoom(), 14) });
        else { const b = new maplibregl.LngLatBounds(); pts.forEach(c => b.extend(c));
          map.fitBounds(b, { padding: { top: 140, bottom: 140, left: 80, right: 80 }, maxZoom: s.map && s.map.zoom != null ? s.map.zoom : 17, duration: 0 }); }
      }
    }
    const m = s.map;
    if (s.highlight && s.highlight.bbox && !(m && m.center)) {   // fit the geographic highlight, leaving room for the step card
      const [w, so, e, n] = s.highlight.bbox, wide = innerWidth > 620;
      map.fitBounds([[w, so], [e, n]], { duration: 0, maxZoom: 18,
        padding: wide ? { top: 80, bottom: 80, left: 80, right: 440 } : { top: 80, bottom: Math.round(innerHeight * 0.45), left: 30, right: 30 } });
    }
    if (m) {
      if (m.basemap) setBase(m.basemap);
      if (m.opacity != null) { gOp = m.opacity; $h("gop").value = m.opacity; order.forEach(applyVisibility); }
      if (m.center) map.jumpTo({ center: m.center, zoom: m.zoom != null ? m.zoom : map.getZoom() });
      else if (m.zoom != null) map.jumpTo({ zoom: m.zoom });
    }
  }

  function show(n) {
    i = n; const s = HELP_STEPS[i];
    apply(s);
    $h("stepTitle").textContent = s.title; $h("stepText").innerHTML = s.text;
    $h("stepCount").textContent = (i + 1) + " / " + HELP_STEPS.length;
    $h("stepNext").textContent = i === HELP_STEPS.length - 1 ? "Done" : "Next";
    $h("stepBack").hidden = i === 0;
    $h("stepDots").innerHTML = HELP_STEPS.map((_, k) => '<i class="' + (k === i ? "on" : "") + '"></i>').join("");
    requestAnimationFrame(() => requestAnimationFrame(place));   // wait for panels/card to lay out
    map.once("moveend", place);
  }
  const follow = () => { if (i >= 0 && HELP_STEPS[i].highlight && HELP_STEPS[i].highlight.bbox) place(); };
  (function hook() { if (nav()) map.on("move", follow); else setTimeout(hook, 300); })();
  let fromPage = false;                                  // true until the first spotlight of a tour has been drawn
  let before = null;                                     // view/basemap/opacity when the tour began, restored at the end
  function start(n) {
    if (!nav()) return void setTimeout(() => start(n), 300);
    if (!before) before = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), base: baseKind, op: gOp };
    fromPage = true; spot.style.display = "none";
    tour.hidden = false; show(n || 0);
  }
  function end() {
    tour.hidden = true; i = -1; markSeen();
    togglePanel(null);
    if (P.length) clearSelection();
    if (before) {
      setBase(before.base);
      gOp = before.op; $h("gop").value = before.op; order.forEach(applyVisibility);
      map.jumpTo({ center: before.center, zoom: before.zoom, bearing: before.bearing, pitch: before.pitch });
      before = null;
    }
  }
  $h("stepNext").onclick = () => (i >= HELP_STEPS.length - 1 ? end() : show(i + 1));
  $h("stepBack").onclick = () => i > 0 && show(i - 1);
  $h("stepSkip").onclick = end;
  addEventListener("resize", () => { if (i >= 0) place(); });
  document.addEventListener("keydown", e => {
    if (i >= 0) {
      if (e.key === "Escape") { e.stopImmediatePropagation(); end(); }
      else if (e.key === "ArrowRight") $h("stepNext").click();
      else if (e.key === "ArrowLeft") $h("stepBack").click();
    } else if (e.key === "Escape" && !$h("help").hidden) { e.stopImmediatePropagation(); closeHelp(); }
  }, true);

  window.startOnboarding = start;                        // handy from the console: startOnboarding(3)
  if (!seen()) openHelp();
})();
