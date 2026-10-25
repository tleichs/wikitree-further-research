# Further Research: a proposal and prototype for WikiTree

**For:** the WikiTree team, the Templates and Stickers Project, the Categorization Project and the Apps team.
**Status:** community proposal with a working prototype. Nothing has been added to WikiTree yet.
**Prepared by:** Tiago Leichsenring, WikiTree contributor.

## In short

Researchers often travel to an archive or a family history center to read the books of one parish for a few decades. Today they can only look for their own surnames. Other contributors may have open questions in exactly the same books, but nobody can find them by place.

This proposal has two parts:

1. **A `{{Further Research}}` template.** A contributor adds it to a profile with a concrete open question. It says where and when the answer might be found, what is missing, and optionally which source might help. It puts the profile into a tracking category.
2. **The Further Research Finder.** A small web app for apps.wikitree.com. You enter a place and a period and get every open request there. It also lists profiles from that place and period with missing data. You can print the list or download it before your archive visit.

The template works on its own through category pages. The app adds filtering by place, period and record type.

## The problem, with examples

**A trip to a parish archive.** A researcher has an appointment at the church archive in Zwickau to read the books from 1750 to 1800. WikiTree has 22 profiles born or died in the town of Zwickau in that period with missing parents, dates or sources. Nothing on WikiTree points the researcher to them.

**Three kinds of open questions** come up again and again:

- **A vague hint.** A Brazilian marriage record says only "filho de Fulano, natural de Portugal". The answer is in records the manager has not identified yet.
- **A known source the manager cannot reach.** For example, a privately held family book for one village. Someone who owns it could answer in minutes.
- **A lost relative.** Nine of eleven siblings are documented, but two disappear. This is not a brick wall, because the family continues through the other siblings. It is still an open question.

**Contributors already write this down, but it cannot be found.** These counts come from WikiTree+ text search, with data from 18 October 2026:

| Text in biography | Profiles |
|---|---|
| "Research Notes" | 1,653,750 |
| "Further Research" | 2,597 |
| "Brick Wall" | 1,463 |

I checked a random sample of 400 "Further Research" matches. 84% contain the phrase, and 42% use it as a section heading, such as "Further Research" or "Further Research Required". Examples include [Tuttle-50](https://www.wikitree.com/wiki/Tuttle-50) and [Hatfield-53](https://www.wikitree.com/wiki/Hatfield-53). These sections describe open questions in free text, with no place attached. A researcher working in the right records has no way to find them.

**Research Notes is not the right place.** Many contributors use Research Notes to record what they have already checked, so that nobody searches the same books twice. Further Research records what is still wanted. Keeping them apart keeps both useful.

**Why not just a category.** A category can say "open question in Saxony". It cannot say which period, which record is missing, or which source might help. The template carries those details and still adds the category.

## Part 1: the template

The draft is in [template/Template_Further_Research.wiki](template/Template_Further_Research.wiki), with documentation.

```
== Further Research ==
{{Further Research
|place=Zwickau, Sachsen, Deutschland
|region=Saxony
|period=1750-1800
|wanted=death, marriage
|source=Stammbuch der Familie Fritz, Wildbach bei Zwickau
|note=9 of 11 siblings found. No trace of him after his confirmation.
}}
```

| Parameter | Required | Meaning |
|---|---|---|
| place | yes | Town or parish, written like a WikiTree location field |
| place2, place3 | no | Other places, such as a neighbouring parish or an emigration destination |
| region | no | Region with an existing location category, which adds a regional category |
| period | no | Years in which the record is expected, such as 1750-1800 |
| wanted | no | birth, baptism, marriage, death, burial, parents, origin |
| source | no | A specific source that may hold the answer |
| note | no | One or two sentences of context |

**Categories it adds:**

- Always **Further Research Requests**, as the tracking category the app reads.
- With `region`, **Region, Further Research Requests**. This mirrors how `{{Unsourced|Germany}}` feeds "Germany, Unsourced Profiles".
- Without `place`, **Further Research Requests, Missing Place**, as a maintenance category.

**Lessons from the Unsourced template.** WikiTree+ shows 989,907 profiles in Unsourced Profiles, but only 87 in Brazil, Unsourced Profiles and 10,552 in Germany, Unsourced Profiles. Most unsourced templates carry no place, mainly because the add-person form inserts the template automatically. For Further Research the place is the whole point, so it is required, and the template flags profiles without it.

**A pilot can start before the template exists.** The app finds requests in two ways: through the tracking category, and through a WikiTree+ text search for "Further Research" together with the town. It then reads the template parameters from each biography. So a few contributors can add the template text to their profiles as a trial, and the app finds them after the next WikiTree+ update. Until the template page exists, the profile shows a red template link instead of the box.

**When to use it.** Use it only on profiles with a concrete open question and at least a guess of where the answer may be. That covers brick walls and lost relatives. It is not meant for every profile.

**Questions for the Templates and Categorization projects:**

1. Is the name `Further Research` free and acceptable? I could not check existing templates through the API.
2. Is one tracking category plus optional regional categories acceptable, or would you prefer another structure?
3. Should the `region` value be limited to existing location categories, as with Unsourced?
4. Should it be a template, a sticker or a research note box, in your terms?
5. Would a per-source category be welcome later? For example, everyone hoping for an answer from one specific book or archive collection.

## Part 2: the Further Research Finder

### What it does

You enter a place, a period and optionally a record type. The app shows two lists:

- **Open requests.** Profiles in the tracking category whose `{{Further Research}}` template matches the place and period. These are questions someone is actively asking. The list is empty until the template exists. A checkbox shows clearly labelled example rows.
- **Data gaps.** Profiles born or died in the place and alive in the period, with no birth date, no death date, no parents, or the Unsourced category. Nobody necessarily asked for these, but the books may answer them.

Above both lists, a **surname summary** shows which surnames to watch for in the books, sorted by number of open questions. Each row links to the profile and its manager. The list can be **printed** for the archive visit or **downloaded** as CSV. The search is kept in the link, so a category page or Space page can link straight to a ready-made search:

```
https://apps.wikitree.com/apps/<account>/further-research/?place=Zwickau,%20Sachsen/Germany&from=1750&to=1800
```

### Results from live data

These searches ran against live WikiTree data on 25 October 2026:

| Search | Profiles with gaps |
|---|---|
| Zwickau, 1750-1800, town only | 22 |
| Zwickau, Sachsen/Germany, 1750-1800, town only | 15 |
| Zwickau and villages in its district, 1750-1800 | 114 |
| Icó, Ceará, 1850-1900 | 5 |

The first two rows show why the place qualifier matters. Six of the 22 "Zwickau" profiles are from **Zwickau in Bohemia**, now Cvikov in Czechia, written "Zwickau, Gabel, Böhmen, Österreich". One more has only "Zwickau" with no region. The qualifier "Sachsen/Germany" removes all seven. The app also treats common language variants as equal, such as Sachsen and Saxony, or Brasil and Brazil.

### How it works

- **WikiTree+ text search** finds candidate profile IDs: `BirthLocation=<town>`, `DeathLocation=<town>`, the same with `CategoryFull=Unsourced_Profiles`, and `CategoryFull=Further_Research_Requests` for requests.
- **WikiTree API `getPeople`** loads live dates, places, parents and managers, up to 500 profiles per call. For requests it also loads the biography and parses the template parameters.
- All filtering by place, period and record type happens in the browser.
- Every API call sends `appId=FurtherResearchFinder`.

It reads public data only and writes nothing. When it runs on apps.wikitree.com and the user is logged in, the API also returns profiles where the user is on the Trusted List, as with other apps.

### Try it locally

Python 3 is required. Nothing needs to be installed.

```
cd WikiTree_Further_Research
python3 dev-server.py
```

Then open `http://localhost:8765/?place=Zwickau,%20Sachsen/Germany&from=1750&to=1800`.

The WikiTree API only accepts browser requests from apps.wikitree.com. The small local server forwards requests to the WikiTree API and WikiTree+, and only to those two hosts. It also works around WikiTree+ offering only older TLS 1.2 ciphers, which current Python rejects by default. Certificates are still verified.

### Hosting on apps.wikitree.com

Copy `index.html`, `app.js` and `style.css` into a folder on an apps.wikitree.com account. The app detects that it runs on wikitree.com and calls the API and WikiTree+ directly. `dev-server.py` is not needed there.

### Known limitations

- **WikiTree+ data is a few days old.** A newly added template appears in the app after the next WikiTree+ update. The page shows the date of the data.
- **Missing marriages cannot be detected** from profile fields, only from requests.
- **Private profiles hide dates,** so some apparent gaps are not real gaps.
- **"Data gaps" are not requests.** A missing field may be known to the manager but not entered. The template is what shows that someone actually wants help.
- **The tracking category is read as a whole.** That is fine for thousands of requests. With far more, the app should first narrow the search with the place.
- **Place matching is text-based.** It cannot know that two differently written parish names are the same place.

## Possible next steps

1. Discussion with the Templates and Categorization projects, and a G2G post for community feedback.
2. A trial with a few contributors and one project, for example the Germany or Brazil project.
3. Hosting the app on apps.wikitree.com and linking it from the category page.
4. Later, a WikiTree Browser Extension feature that shows "open questions in this place" on profile pages.
5. Later, a "sources cited for this place and period" view, built from the citations in existing biographies. It would help researchers discover collections they did not know existed.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | The app, plain HTML and JavaScript with no build step |
| `dev-server.py` | Local demo server, not needed on apps.wikitree.com |
| `template/Template_Further_Research.wiki` | Draft template with documentation |
| `README.md` | This document |
