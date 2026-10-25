/*
 * Further Research Finder: community prototype.
 *
 * Two lists for one place and period:
 *  1. Open requests: profiles in the tracking category that carry the proposed
 *     {{Further Research}} template, parsed from the biography wiki text.
 *  2. Data gaps: profiles born or died in the place, alive in the period,
 *     with no birth date, no death date, no parents, or marked unsourced.
 *
 * Data sources:
 *  - WikiTree+ text search (plus.wikitree.com) to find candidate profile IDs.
 *  - WikiTree API getPeople to load live profile fields and biographies.
 *
 * The WikiTree API only accepts browser requests from apps.wikitree.com.
 * When the page runs anywhere else, it uses the local proxy in dev-server.py.
 */
"use strict";

const APP_ID = "FurtherResearchFinder";
const ON_WIKITREE = /(^|\.)wikitree\.com$/.test(location.hostname);
const API = ON_WIKITREE ? "https://api.wikitree.com/api.php" : "/wt-api";
const PLUS = ON_WIKITREE ? "https://plus.wikitree.com" : "/wt-plus";
const TRACKING_CATEGORY = "Further_Research_Requests"; // proposed, see README
const TEMPLATE_RE = /\{\{\s*Further[ _]Research\s*(?=\||\}\})/gi;
const PEOPLE_CHUNK = 500;

const PERSON_FIELDS = [
  "Id", "Name", "FirstName", "LastNameAtBirth", "LastNameCurrent",
  "BirthDate", "DeathDate", "BirthLocation", "DeathLocation",
  "Father", "Mother", "Manager", "Privacy",
].join(",");

// Words people may use in the "wanted" parameter, grouped by record type.
const WANTED_GROUPS = {
  baptism: ["birth", "baptism", "christening", "geburt", "taufe", "nascimento", "batismo", "batizado"],
  marriage: ["marriage", "wedding", "banns", "heirat", "trauung", "ehe", "aufgebot", "casamento", "matrimonio"],
  death: ["death", "burial", "tod", "sterbe", "begrabnis", "beerdigung", "obito", "falecimento", "sepultamento"],
  parents: ["parents", "father", "mother", "origin", "eltern", "vater", "mutter", "herkunft", "pais", "pai", "mae", "origem"],
};
const WANTED_LABELS = { baptism: "birth or baptism", marriage: "marriage", death: "death or burial", parents: "parents" };

const $ = (id) => document.getElementById(id);
const state = { requests: [], gaps: [], managers: {}, surname: null, query: null, dataDate: "" };

/* ---------- small helpers ---------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function year(d) {
  const y = parseInt(String(d ?? "").slice(0, 4), 10);
  return Number.isFinite(y) && y > 0 ? y : null;
}
function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}
function profileUrl(name) {
  return "https://www.wikitree.com/wiki/" + encodeURIComponent(name);
}
function displayName(p) {
  const first = p.FirstName || "";
  const last = p.LastNameAtBirth || p.LastNameCurrent || "";
  return (first + " " + last).trim() || p.Name;
}
function surnameOf(p) {
  return p.LastNameAtBirth || p.LastNameCurrent || "?";
}

/* ---------- place matching ---------- */

// Region names written in several languages on WikiTree. A qualifier matches if
// any variant in its group appears in the location. Extend as needed.
const PLACE_VARIANTS = [
  ["sachsen", "saxony", "saxe", "saxonia"],
  ["deutschland", "germany", "allemagne", "alemanha", "heiliges romisches reich", "holy roman empire"],
  ["bayern", "bavaria"], ["preussen", "prussia"], ["thuringen", "thuringia"], ["bohmen", "bohemia"],
  ["brasil", "brazil"], ["portugal"], ["italia", "italy"],
];
function variantsOf(q) {
  const n = norm(q);
  return PLACE_VARIANTS.find((g) => g.includes(n)) || [n];
}

// "Zwickau, Sachsen" -> town "zwickau", qualifiers ["sachsen"]
function parsePlace(input) {
  const parts = String(input).split(",").map((s) => s.trim()).filter(Boolean);
  return { label: parts.join(", "), town: parts[0] || "", qualifiers: parts.slice(1) };
}

// exact: the first element of the location is the town ("Bethlehem, Northampton, Pennsylvania").
// area:  the town appears anywhere ("Bethlehem Township, Northampton, Pennsylvania" also matches).
function placeMatches(location, place, scope) {
  if (!location) return false;
  const loc = norm(location);
  const town = norm(place.town);
  if (!town) return false;
  const first = loc.split(",")[0].trim();
  const townOk = scope === "area"
    ? loc.includes(town)
    : first === town || first.startsWith(town + " (") || first.startsWith(town + " in ") || first.startsWith(town + " bei ");
  // "Northampton/Lehigh" means either one may appear.
  return townOk && place.qualifiers.every((q) =>
    q.split("/").some((alt) => variantsOf(alt).some((v) => loc.includes(v))));
}

// Was the person plausibly alive between from and to?
function aliveInRange(p, from, to) {
  const b = year(p.BirthDate);
  const d = year(p.DeathDate);
  if (!b && !d) return false;
  const lo = b ?? d - 60;
  const hi = d ?? b + 70;
  return lo <= to && hi >= from;
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  const lo = aFrom ?? -Infinity;
  const hi = aTo ?? Infinity;
  return lo <= bTo && hi >= bFrom;
}

/* ---------- data access ---------- */

async function plusSearch(query) {
  const url = `${PLUS}/function/WTWebProfileSearch/${APP_ID}.json?Query=${encodeURIComponent(query)}&MaxProfiles=20000&Format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WikiTree+ search failed (${res.status})`);
  const data = await res.json();
  if (data.debug?.dataDate) state.dataDate = data.debug.dataDate;
  const list = data.response?.profiles || [];
  return list.map((p) => (typeof p === "number" ? p : p.UserID)).filter(Boolean).map((n) => Math.trunc(n));
}

async function getPeople(ids, fields, withBio = false) {
  const out = {};
  const unique = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += PEOPLE_CHUNK) {
    const body = new URLSearchParams({
      action: "getPeople",
      appId: APP_ID,
      keys: unique.slice(i, i + PEOPLE_CHUNK).join(","),
      fields: withBio ? fields + ",Bio" : fields,
    });
    if (withBio) body.set("bioFormat", "wiki");
    const res = await fetch(API, {
      method: "POST",
      body,
      credentials: ON_WIKITREE ? "include" : "same-origin",
    });
    if (!res.ok) throw new Error(`WikiTree API failed (${res.status})`);
    const data = await res.json();
    const people = Array.isArray(data) ? data[0]?.people : data.people;
    if (!people && (Array.isArray(data) ? data[0]?.status : data.status)) {
      throw new Error("WikiTree API: " + (Array.isArray(data) ? data[0].status : data.status));
    }
    for (const p of Object.values(people || {})) if (p && p.Name) out[p.Id] = p;
    if (unique.length > PEOPLE_CHUNK) setStatus(`Loading profiles… ${Math.min(i + PEOPLE_CHUNK, unique.length)} of ${unique.length}`);
  }
  return out;
}

// WikiTree+ query value: quote it when it contains spaces.
function plusValue(s) {
  return /\s/.test(s) ? `"${s}"` : s;
}

/* ---------- template parsing ---------- */

// Returns [{place, place2, place3, from, to, wanted, source, note, ...}] for each
// {{Further Research|...}} in the wiki text. Handles nested {{ }} and [[ ]].
function parseTemplates(wikitext) {
  const found = [];
  if (!wikitext) return found;
  TEMPLATE_RE.lastIndex = 0;
  let m;
  while ((m = TEMPLATE_RE.exec(wikitext))) {
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < wikitext.length - 1; i++) {
      const two = wikitext.slice(i, i + 2);
      if (two === "{{") { depth++; i++; }
      else if (two === "}}") { depth--; i++; if (depth === 0) { end = i - 1; break; } }
    }
    if (end < 0) break;
    const inner = wikitext.slice(m.index + 2, end);
    TEMPLATE_RE.lastIndex = end + 2;

    const pieces = [];
    let buf = "", curly = 0, square = 0;
    for (let i = 0; i < inner.length; i++) {
      const two = inner.slice(i, i + 2);
      if (two === "{{") { curly++; buf += two; i++; continue; }
      if (two === "}}") { curly--; buf += two; i++; continue; }
      if (two === "[[") { square++; buf += two; i++; continue; }
      if (two === "]]") { square--; buf += two; i++; continue; }
      if (inner[i] === "|" && curly === 0 && square === 0) { pieces.push(buf); buf = ""; continue; }
      buf += inner[i];
    }
    pieces.push(buf);

    const params = {};
    for (const piece of pieces.slice(1)) {
      const eq = piece.indexOf("=");
      if (eq < 0) continue;
      const key = piece.slice(0, eq).trim().toLowerCase();
      const value = piece.slice(eq + 1).trim();
      if (key && value) params[key] = value;
    }
    found.push(params);
  }
  return found;
}

// period=1850-1900, period=1850–1900, period=1850, or from= / to=
function periodOf(t) {
  if (t.period) {
    const ys = String(t.period).match(/\d{3,4}/g) || [];
    if (ys.length) return { from: +ys[0], to: +(ys[1] ?? ys[0]) };
  }
  return { from: year(t.from), to: year(t.to) };
}

function wantedGroups(text) {
  const t = norm(text);
  return Object.entries(WANTED_GROUPS)
    .filter(([, words]) => words.some((w) => t.includes(w)))
    .map(([group]) => group);
}

// Strip wiki markup for display: [[Id|label]] -> label, [url label] -> label, '' and ''' removed.
function plainText(s) {
  return String(s ?? "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[(https?:[^\s\]]+)\s+([^\]]*)\]/g, "$2")
    .replace(/'{2,}/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "");
}

/* ---------- searches ---------- */

// Candidates: profiles in the tracking category, plus profiles whose biography
// text mentions "Further Research" and the town. The text search also finds
// templates added before the template page and its category exist (a pilot).
// Every candidate is then checked by parsing the template itself.
async function findRequests(q) {
  setStatus("Looking for Further Research requests…");
  const plain = q.place.town.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const searches = [`CategoryFull=${TRACKING_CATEGORY}`,
    ...new Set([q.place.town, plain].map((t) => `"Further Research" ${plusValue(t)}`)),
    // Radius requests name a different town, so find them by the word "radius".
    `"Further Research" radius`];
  const ids = [...new Set((await Promise.all(searches.map(plusSearch))).flat())];
  if (!ids.length) return [];
  const people = await getPeople(ids, PERSON_FIELDS, true);

  let searchedPoint; // geocoded lazily, only if a radius request needs it
  const searched = async () => (searchedPoint ??= await geocode(geocodeQuery(q.place)));

  const rows = [];
  for (const p of Object.values(people)) {
    for (const t of parseTemplates(p.bio)) {
      const { from, to } = periodOf(t);
      if (!rangesOverlap(from, to, q.from, q.to)) continue;
      const groups = wantedGroups(t.wanted);
      if (q.wanted && !groups.includes(q.wanted)) continue;

      const places = [t.place, t.place2, t.place3].filter(Boolean);
      const radius = parseFloat(String(t.radius ?? "").replace(",", "."));
      let where = { place: places.find((pl) => placeMatches(pl, q.place, q.scope)) };

      if (!where.place && radius > 0) {
        setStatus("Looking up places on OpenStreetMap…");
        const target = await searched();
        if (!target) continue;
        const fixed = parseCoords(t.coords);
        const centres = [];
        if (fixed) centres.push({ place: places[0] || t.coords, point: { ...fixed, name: `${fixed.lat}, ${fixed.lon}` } });
        else for (const pl of places) centres.push({ place: pl, point: await geocode(pl) });
        const near = centres
          .filter((c) => c.point)
          .map((c) => ({ ...c, km: distanceKm(c.point, target) }))
          .filter((c) => c.km <= radius)
          .sort((a, b) => a.km - b.km)[0];
        if (!near) continue;
        where = { place: near.place, km: near.km, resolved: near.point.name, target: target.name };
      }
      if (!where.place) continue;
      rows.push({ kind: "request", person: p, where, places, radius: radius > 0 ? radius : null,
        from, to, wanted: t.wanted || "", groups, source: t.source || "", note: t.note || "" });
    }
  }
  return rows;
}

/* ---------- distances (radius requests) ---------- */

// OpenStreetMap Nominatim. Usage policy: at most one request per second,
// cache results, show attribution. Fine for a prototype; a hosted app with
// many users should use its own geocoder or a coordinates table.
const GEOCODER = "https://nominatim.openstreetmap.org/search";
const geoCache = new Map();
let geoQueue = Promise.resolve();

function geocodeQuery(place) {
  // "Zwickau, Sachsen/Germany" -> "Zwickau, Sachsen" (first alternative)
  return [place.town, ...place.qualifiers.map((x) => x.split("/")[0].trim())].join(", ");
}

function parseCoords(s) {
  const m = String(s ?? "").match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: +m[1], lon: +m[2] } : null;
}

function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function geocode(text) {
  const key = norm(text);
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const stored = localStorage.getItem("frf-geo:" + key);
    if (stored) { const v = JSON.parse(stored); geoCache.set(key, v); return v; }
  } catch { /* storage unavailable */ }
  const job = geoQueue.then(async () => {
    const url = `${GEOCODER}?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(text)}`;
    let result = null;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const hit = (await res.json())[0];
        if (hit) result = { lat: +hit.lat, lon: +hit.lon, name: hit.display_name };
      }
    } catch { /* network error: treat as not found */ }
    await new Promise((r) => setTimeout(r, 1100)); // one request per second
    return result;
  });
  geoQueue = job.catch(() => null);
  const result = await job;
  geoCache.set(key, result);
  try { if (result) localStorage.setItem("frf-geo:" + key, JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

async function findGaps(q) {
  setStatus(`Searching WikiTree+ for profiles in ${q.place.label}…`);
  const term = plusValue(q.place.town);
  const plain = q.place.town.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const terms = [...new Set([term, plusValue(plain)])];
  const queries = [];
  for (const t of terms) queries.push(`BirthLocation=${t}`, `DeathLocation=${t}`);
  const idLists = await Promise.all(queries.map(plusSearch));
  const ids = [...new Set(idLists.flat())];

  const unsourcedLists = await Promise.all(
    terms.flatMap((t) => [`BirthLocation=${t} CategoryFull=Unsourced_Profiles`, `DeathLocation=${t} CategoryFull=Unsourced_Profiles`]).map(plusSearch)
  );
  const unsourced = new Set(unsourcedLists.flat());

  setStatus(`Loading ${ids.length} profiles from the WikiTree API…`);
  const people = await getPeople(ids, PERSON_FIELDS);

  const rows = [];
  for (const p of Object.values(people)) {
    if (!placeMatches(p.BirthLocation, q.place, q.scope) && !placeMatches(p.DeathLocation, q.place, q.scope)) continue;
    if (!aliveInRange(p, q.from, q.to)) continue;
    const missing = [];
    if (p.BirthDate !== undefined && !year(p.BirthDate)) missing.push("baptism");
    if (p.DeathDate !== undefined && !year(p.DeathDate)) missing.push("death");
    if (p.Father !== undefined && !p.Father && !p.Mother) missing.push("parents");
    if (unsourced.has(p.Id)) missing.push("unsourced");
    if (!missing.length) continue;
    if (q.wanted && !missing.includes(q.wanted)) continue;
    rows.push({ kind: "gap", person: p, missing });
  }
  return rows;
}

async function loadManagers(rows) {
  const ids = [...new Set(rows.map((r) => r.person.Manager).filter(Boolean))];
  if (!ids.length) return {};
  const people = await getPeople(ids, "Id,Name,FirstName,RealName,LastNameCurrent");
  return people;
}

function exampleRequests(q) {
  const mk = (first, last, b, d, wanted, source, note) => ({
    kind: "request", example: true,
    person: { Id: 0, Name: "", FirstName: first, LastNameAtBirth: last, BirthDate: b, DeathDate: d, BirthLocation: q.place.label },
    where: { place: q.place.label }, places: [q.place.label], radius: null,
    from: q.from, to: q.to, wanted, groups: wantedGroups(wanted), source, note,
  });
  return [
    mk("John", "Example", `${q.from + 12}-00-00`, "", "death, marriage",
      "", "9 of 11 siblings found. No trace of him after 1770."),
    mk("Mary", "Sample", "", `${q.from + 40}-00-00`, "parents, baptism",
      "Family Bible, privately held", "Burial entry gives age 63 but no parents. Possibly from a neighbouring congregation."),
    mk("Jacob", "Specimen", `${q.from + 25}-00-00`, "", "baptism, origin",
      "", "Burial record says only 'a native of Germany'."),
  ].filter((r) => !q.wanted || r.groups.includes(q.wanted));
}

/* ---------- rendering ---------- */

function yearsText(p) {
  const b = year(p.BirthDate), d = year(p.DeathDate);
  if (!b && !d) return "";
  return `${b ?? "?"}–${d ?? "?"}`;
}

function personCell(r) {
  const p = r.person;
  const name = esc(displayName(p));
  const link = p.Name ? `<a href="${profileUrl(p.Name)}" target="_blank" rel="noopener">${name}</a>` : name;
  const id = p.Name ? `<br><small>${esc(p.Name)}</small>` : "";
  return link + (r.example ? '<span class="example">EXAMPLE</span>' : "") + id;
}

function managerCell(r) {
  const m = state.managers[r.person.Manager];
  if (!m) return r.example ? "<small>profile manager</small>" : "";
  const label = esc(m.RealName || m.FirstName || m.Name);
  return `<a href="${profileUrl(m.Name)}" target="_blank" rel="noopener">${label}</a>`;
}

function tags(groups, extra = []) {
  return groups.map((g) => `<span class="tag">${esc(WANTED_LABELS[g] || g)}</span>`).join("")
    + extra.map((e) => `<span class="tag unsourced">${esc(e)}</span>`).join("");
}

function visible(rows) {
  return state.surname ? rows.filter((r) => surnameOf(r.person) === state.surname) : rows;
}

// "Zschocken or Thierfeld", or for radius requests:
// "within 20 km of Oelsnitz/Erzgeb. (6 km away)" with the resolved place names.
function whereCell(r) {
  const list = esc(r.places.join(" or "));
  if (r.where.km == null) return r.radius ? `${list}<br><small>within ${esc(r.radius)} km</small>` : list;
  const title = `Found as: ${r.where.resolved}. Search place found as: ${r.where.target}. Source: OpenStreetMap.`;
  return `within ${esc(r.radius)} km of ${esc(r.where.place)}<br><small title="${esc(title)}">${Math.round(r.where.km)} km from ${esc(state.query.place.town)}</small>`;
}

function whereText(r) {
  if (r.where.km == null) return r.places.join(" or ") + (r.radius ? ` (within ${r.radius} km)` : "");
  return `within ${r.radius} km of ${r.where.place} (${Math.round(r.where.km)} km away)`;
}

function renderRequests() {
  const rows = visible(state.requests);
  $("count-requests").textContent = state.requests.length;
  if (!rows.length) {
    $("requests").innerHTML = `<div class="empty">No open requests for this place and period yet.
      The <code>{{Further Research}}</code> template is a proposal, so there are no real requests on WikiTree yet.
      Tick “Show example requests” to see how they would look.</div>`;
    return;
  }
  $("requests").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Person</th><th>Years</th><th>Where</th><th>Looking for</th><th>Period</th><th>Possible source</th><th>Note</th><th>Contact</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${personCell(r)}</td>
      <td class="years">${esc(yearsText(r.person))}</td>
      <td>${whereCell(r)}</td>
      <td>${r.groups.length ? tags(r.groups) : esc(r.wanted)}</td>
      <td class="years">${esc(r.from ?? "?")}–${esc(r.to ?? "?")}</td>
      <td>${esc(plainText(r.source))}</td>
      <td>${esc(plainText(r.note))}</td>
      <td>${managerCell(r)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderGaps() {
  const rows = visible(state.gaps).slice().sort((a, b) =>
    surnameOf(a.person).localeCompare(surnameOf(b.person)) || (year(a.person.BirthDate) ?? 0) - (year(b.person.BirthDate) ?? 0));
  $("count-gaps").textContent = state.gaps.length;
  if (!rows.length) {
    const marriageNote = state.query?.wanted === "marriage"
      ? " Missing marriages cannot be detected from profile data, only from requests." : "";
    $("gaps").innerHTML = `<div class="empty">No profiles with missing data for this place and period.${marriageNote}</div>`;
    return;
  }
  $("gaps").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Person</th><th>Years</th><th>Birth place</th><th>Death place</th><th>Missing</th><th>Contact</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${personCell(r)}</td>
      <td class="years">${esc(yearsText(r.person))}</td>
      <td>${esc(r.person.BirthLocation)}</td>
      <td>${esc(r.person.DeathLocation)}</td>
      <td>${tags(r.missing.filter((m) => m !== "unsourced"), r.missing.includes("unsourced") ? ["unsourced"] : [])}</td>
      <td>${managerCell(r)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderSurnames() {
  const counts = new Map();
  for (const r of [...state.requests, ...state.gaps]) {
    if (r.example) continue;
    const s = surnameOf(r.person);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("surnames-card").hidden = !sorted.length;
  const chip = (s, n, pressed) =>
    `<button type="button" class="chip" data-surname="${esc(s)}" aria-pressed="${pressed}">${esc(s)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
  $("surnames").innerHTML = chip("", null, !state.surname).replace(">", ">All") +
    sorted.map(([s, n]) => chip(s, n, state.surname === s)).join("");
}

function renderAll() {
  renderSurnames();
  renderRequests();
  renderGaps();
  const q = state.query;
  $("print-head").innerHTML = `<h2>${esc(q.place.label)}, ${q.from}–${q.to}</h2><p>Printed ${new Date().toLocaleDateString()} from the Further Research Finder.</p>`;
  $("source-note").textContent =
    `Search index: WikiTree+ data from ${state.dataDate || "unknown date"}. Profile details: live from the WikiTree API. ` +
    `Only public data is shown. Private profiles may hide dates, so some gaps are not real gaps.`;
  $("results").hidden = false;
}

/* ---------- CSV ---------- */

function csvCell(v) {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv() {
  const head = ["List", "Surname", "Name", "WikiTree ID", "Born", "Died", "Birth place", "Death place", "Where", "Looking for / missing", "Period", "Possible source", "Note", "Manager", "Link"];
  const lines = [head];
  for (const r of visible(state.requests)) {
    const p = r.person;
    lines.push(["Request" + (r.example ? " (EXAMPLE)" : ""), surnameOf(p), displayName(p), p.Name, year(p.BirthDate) ?? "", year(p.DeathDate) ?? "",
      p.BirthLocation || "", p.DeathLocation || "", whereText(r), r.wanted, `${r.from ?? ""}-${r.to ?? ""}`, plainText(r.source), plainText(r.note),
      state.managers[p.Manager]?.Name || "", p.Name ? profileUrl(p.Name) : ""]);
  }
  for (const r of visible(state.gaps)) {
    const p = r.person;
    lines.push(["Data gap", surnameOf(p), displayName(p), p.Name, year(p.BirthDate) ?? "", year(p.DeathDate) ?? "",
      p.BirthLocation || "", p.DeathLocation || "", "", r.missing.map((m) => WANTED_LABELS[m] || m).join(", "), "", "", "",
      state.managers[p.Manager]?.Name || "", profileUrl(p.Name)]);
  }
  const csv = "﻿" + lines.map((l) => l.map(csvCell).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const q = state.query;
  a.download = `further-research_${q.place.town.replace(/[^\p{L}\p{N}]+/gu, "-")}_${q.from}-${q.to}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- wiring ---------- */

function readForm() {
  const from = parseInt($("from").value, 10) || 1000;
  const to = parseInt($("to").value, 10) || 2100;
  return {
    place: parsePlace($("place").value),
    from: Math.min(from, to),
    to: Math.max(from, to),
    scope: $("scope").value,
    wanted: $("wanted").value,
  };
}

function saveToUrl(q) {
  const params = new URLSearchParams({ place: q.place.label, from: q.from, to: q.to });
  if (q.scope !== "exact") params.set("scope", q.scope);
  if (q.wanted) params.set("wanted", q.wanted);
  history.replaceState(null, "", "?" + params);
}

async function runSearch(ev) {
  ev?.preventDefault();
  const q = readForm();
  if (!q.place.town) return;
  state.query = q;
  state.surname = null;
  saveToUrl(q);
  $("go").disabled = true;
  try {
    const [requests, gaps] = await Promise.all([findRequests(q), findGaps(q)]);
    state.requests = $("examples").checked ? [...exampleRequests(q), ...requests] : requests;
    state.realRequests = requests;
    state.gaps = gaps;
    setStatus("Loading profile managers…");
    state.managers = await loadManagers([...requests, ...gaps]);
    renderAll();
    if (!requests.length && gaps.length && !$("examples").checked) selectTab("tab-gaps");
    else selectTab("tab-requests");
    setStatus(`${requests.length} open requests and ${gaps.length} profiles with gaps in ${q.place.label}, ${q.from}–${q.to}.`);
  } catch (err) {
    console.error(err);
    setStatus(err.message + (ON_WIKITREE ? "" : " Is dev-server.py running?"), true);
  } finally {
    $("go").disabled = false;
  }
}

function selectTab(id) {
  document.querySelectorAll(".tabs [role=tab]").forEach((t) => {
    const on = t.id === id;
    t.setAttribute("aria-selected", on);
    $(t.dataset.panel).hidden = !on;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  $("search").addEventListener("submit", runSearch);
  $("csv").addEventListener("click", downloadCsv);
  $("print").addEventListener("click", () => window.print());
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[role=tab]");
    if (t) selectTab(t.id);
  });
  $("surnames").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    state.surname = c.dataset.surname || null;
    renderAll();
  });
  $("examples").addEventListener("change", () => {
    if (!state.query) return;
    state.requests = $("examples").checked ? [...exampleRequests(state.query), ...(state.realRequests || [])] : (state.realRequests || []);
    renderAll();
  });

  const params = new URLSearchParams(location.search);
  if (params.get("place")) {
    $("place").value = params.get("place");
    if (params.get("from")) $("from").value = params.get("from");
    if (params.get("to")) $("to").value = params.get("to");
    if (params.get("scope")) $("scope").value = params.get("scope");
    if (params.get("wanted")) $("wanted").value = params.get("wanted");
    runSearch();
  }
});
