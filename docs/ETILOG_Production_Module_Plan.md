# ETILOG – Production Plan modul
### Kompletný plán aplikácie, architektúra, tech stack a odporúčania

> Interný výrobný plánovač integrovaný do `portal.etilog.com`.
> Nahrádza `Productiondistributor.xlsx` (12 výrobných hárkov, ~2 700 týždňových blokov, dáta 2018–2027).
> Rozhranie aplikácie: **EN**. Tento dokument: SK + EN technické termíny.

---

## 0. Zhrnutie odporúčaného prístupu

- **Nie samostatná appka, ale modul** existujúceho portálu: zdieľaný login, session, navigácia, permissions. Nová dlaždica **Production Plan** v rozcestníku, route `portal.etilog.com/production`.
- **Zachovať mentálny model Excelu** (CW → dni → smeny → notes), ale ako **interaktívny grid**, nie ako Excel v prehliadači.
- **Custom CSS Grid + dnd-kit**, nie kalendárový plugin. Layout je príliš špecifický (smeny, swap, multi-week, urgent dni).
- **Draft / Publish s revíziami + append-only audit** — jedna sumárna notifikácia na publish, nie e-mail za každé kliknutie.
- **Flexibilné smeny a slot s viacerými položkami** — potvrdené reálnymi dátami (staršie týždne majú 3 dvojice Produkt/Soll vrátane prototypov).
- **Import celej histórie z Excelu** — marker-driven, s dry-run náhľadom a anomaly logom.
- **Stack zladený s existujúcim portálom** (Next.js + Prisma + PostgreSQL + Docker na Infomaniak VPS). Žiadny nový cudzí stack.
- **SAP pripraviť architektonicky, neintegrovať teraz.**

---

## 1. Zistenia z reálneho Excelu (formujú dizajn)

Analýza priamo zo súboru, nie zo screenshotu:

| Zistenie | Dopad na dizajn |
|---|---|
| **Blok týždňa nemá fixnú výšku.** 2018: 3 dvojice `Produkt:`/`Soll` (vrátane `Produkt: (Prototy.)`). 2026: 2 dvojice. | Importer musí ísť podľa markerov, nie podľa fixného kroku riadkov. Smeny/sloty = flexibilná entita, nie natvrdo morning/afternoon. |
| **Label sa menil `KW` → `WK`.** Staré roky nemecké `KW 43`, nové `WK 34`. | Regex importera akceptuje oba: `^(KW\|WK)\s*\d+`. |
| **Farba nesie význam.** Žltá `FFFF00` = urgent/špeciál (`TESLA ABD`), zelená `92D050` = `FREI`/voľno. Časť zelených je theme-indexed. | Farba → dátové pole `priority` + `status`, nie CSS. Import mapuje fill color na priority. |
| **Voľný text je bežný.** `TESLA ABD`, `Daimler B-Säule`, `Blocker Daimler Gefacheumbau`, `C/X118 Dachh. Cover...`. | „Custom / non-SAP" produkt je plnohodnotná cesta od začiatku, nie edge-case. |
| **FG má dve podoby.** Staré `FG100217`, nové `FG100829_00_GLT_70A541155_Sicherheitsg_VO_EBSS_ESD`. | FG master + autocomplete parsuje FG prefix (`^FG\d+`) z dlhého stringu; zvyšok = description. |
| **Množstvo má viac formátov.** `30`, string `130+22`, alebo osamotené `37` v poobednom riadku. | `planned_quantity` (numeric) + `quantity_breakdown` (jsonb) + `raw_quantity` (text, pre fidelity importu). |
| **Notizen môžu byť viacriadkové.** Napr. `*USES:\nPolybrush single: 1715 meters`. | `notes` text pole, zachovať newlines. |
| **Hlavička hárku = kapacitné dáta.** `Produktionsband: Presov`, `58 Leute`, `435 Brutto / 390 Netto Tagesstunden`, `Meisterin`. | Uložiť do Location entity ako metadata (zíde sa pre budúci capacity planning). |
| **FREI je per-deň, nie per-slot.** Zelený stĺpec = celý deň voľno (víkend, ale nie automaticky — v sobotu môže byť výroba). | Model: default work calendar + exceptions. Žiadne natvrdo „So/Ne = voľno". |
| **Objem:** ~2 700 týždňových blokov, ~7 900 `Produkt:` riadkov, 12 hárkov, 2018–2027. Pár smetí (dátumy 1900). | Import je zvládnuteľný na jeden beh; treba filtrovať nevalidné dátumy. |

Rozsahy dát podľa hárku (pre plánovanie importu):

```
DS-2 inactive     159 týždňov   2018-10 .. 2021-11   (→ location active=false)
DS-1              274 týždňov   2021-03 .. 2027-01
PO1               391 týždňov   .. 2026-11           (hlavná pobočka Prešov)
Kandrac           391 týždňov   .. 2026-11           (externé šitie)
Mirand 1          161 týždňov   2023-08 .. 2027-01
Mirand 2          122 týždňov   2024-01 .. 2026-11
Parada             35 týždňov   2026-03 .. 2026-11
TexOps PO1        371 týždňov   2018-11 .. 2027-05
Assembly PO1      357 týždňov   .. 2027-04
Assembly ASPF     357 týždňov   2018-11 .. 2027-04
Assembly PO2 VIET 357 týždňov   2018-11 .. 2027-04
Prot. Area         80 týždňov   2024-12 .. 2026-10
```

---

## 2. Architektúra integrácie do portálu

- **Route group** vo vnútri existujúcej Next.js aplikácie: `/production/*`. Žiadna druhá appka, žiadny druhý stack.
- Znovupoužiť: existujúci **auth/session**, **layout/sidebar**, **DB connection**, **M365 Graph** integráciu (už ju vo firme máte).
- Nová dlaždica **Production Plan** v rozcestníku (vedľa Sklad / Vozový park / HR).
- Po otvorení modulu → **rovno aktuálny výrobný plán**, nie generický dashboard s grafmi. Toto je pracovný nástroj, nie BI.

### Roly a permissions

Aj keď teraz stačia dve role, technicky rieš cez **permissions + location scope** (flexibilnejšie než rigidné role):

| Rola | Permissions |
|---|---|
| System Admin | všetko + `production.settings`, správa users |
| Production Planner (šéf výroby / majiteľ) | `production.view`, `production.manage`, `production.publish` |
| Production Viewer (pracovník výroby) | `production.view` |
| External Partner Viewer (napr. Kandrac) | `production.view` len na **scope = vlastná location** |

Permissions:
```
production.view       production.manage
production.publish    production.settings
```
+ `location_scope: [locationId, ...]` — externý partner vidí len svoju pobočku, nie PO1/DS1/financie.

**Autorizácia musí byť na API/backend vrstve**, nie iba schovaným buttonom v UI.

---

## 3. Dátový model

Entity:

```
production_locations
production_shifts
products

production_plan_entries        ← najdôležitejšia tabuľka
production_day_flags            (urgent/critical/free per deň)

production_weeks
production_week_revisions       (snapshoty pri publish)

production_change_log           (append-only audit)
production_calendar_exceptions  (holidays / shutdown / extra working day)

notifications
notification_subscriptions
email_outbox                    (jednoduchý outbox namiesto BullMQ – viď §6)
```

### 3.1 production_plan_entries (jadro)

```
id
location_id            FK
production_date        date
shift_id               FK          -- flexibilné, NIE natvrdo morning/afternoon

product_id             FK  nullable -- FG z master tabuľky
custom_product_name    text nullable -- pre TESLA ABD a spol.

planned_quantity       numeric nullable
quantity_breakdown     jsonb nullable  -- napr. {"parts":[130,22]}
raw_quantity           text nullable   -- fidelity importu ("130+22")

priority               enum(normal, high, urgent, blocked)
status                 enum(planned, in_progress, done, cancelled)
notes                  text nullable

sort_order             int             -- poradie kariet v jednom slote

-- import fidelity (počas migrácie)
source_sheet           text
source_cell            text
source_file            text

created_by  created_at
updated_by  updated_at
version                int             -- optimistic concurrency
deleted_at             timestamp       -- soft delete
```

**Dôležité rozhodnutia:**
- **Žiadny UNIQUE constraint na jeden product per slot.** Slot (deň + smena) môže mať viac kariet — reálne dáta to už majú (prototypy ako 3. dvojica). UI defaultne ukáže jednu, ale DB to zvládne bez prerábania o rok.
- **`version` na optimistic concurrency** — dvaja plánovači si potichu neprepíšu zmeny.
- **`custom_product_name` vedľa `product_id`** — buď FG z master, alebo voľný text.
- **`raw_quantity` + `planned_quantity`** — DB má čisté číslo (pre budúci reporting/SAP), ale nič sa nestratí.

### 3.2 production_shifts (flexibilné smeny)

```
id  location_id  name  sort_order  active
```
Pre PO1: `Morning`, `Afternoon`. Keď o rok pribudne `Night`, len sa pridá v Settings — nič sa neprerába. Prototype riadok z histórie sa naimportuje ako smena `Prototype` (alebo ako druhá karta v rámci smeny — rozhodnúť pri importe).

### 3.3 products (FG master)

```
id  fg_number  description  sap_item_code  active
```
Naplní sa z importu (dedup FG prefixov). Autocomplete na `FG100...`. `custom` produkcia nevyžaduje záznam v master tabuľke.

### 3.4 production_calendar_exceptions

```
id  location_id  date  type(holiday|shutdown|extra_working_day)  note
```
Model = **default work calendar + exceptions**. Žiadne „So/Ne = automaticky voľno". Import z hárku `BANK HOLIDAYS`.

---

## 4. Hlavný Production Planner (UI/UX)

### 4.1 Grid

Zachovať layout Excelu, ale ako moderné **stacked week blocks**:

```
PRODUCTION PLAN
[ PO1 ] [ DS-1 ] [ Kandrac ] [ Mirand 1 ] [ Mirand 2 ] [ Parada ] ...
        <  Today  >     CW 34 | 17–23 Aug 2026        [1w] [4w] [8w]

┌───────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│           │ MON 17 │ TUE 18 │ WED 19 │ THU 20 │ FRI 21 │ SAT 22 │ SUN 23 │
├───────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┤
│ MORNING   │ [card] │ [card] │        │ [card] │ [card] │ [card] │  FREE  │
│ AFTERNOON │ [card] │        │ [card] │ [card] │        │        │        │
│ NOTES     │  ...   │  ...   │ URGENT │  ...   │  ...   │  ...   │        │
└───────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
```

- **Multi-week prepínač: 1 / 4 / 8 týždňov**, týždne pod sebou (ako v Exceli). Default pre šéfa výroby: 4 týždne. Drag & drop funguje **aj medzi týždňami** — kľúčové pre presúvanie výroby na budúci týždeň.
- **CW label** viditeľný (calendar week + rozsah dátumov).
- Location tabs hore = prepínanie pobočiek.

### 4.2 Production Card

Namiesto textu natlačeného do bunky — malá karta:

```
FG100865          [URGENT]
Outside mirror AU310
30 pcs
```

Po kliknutí/hoveri detail: full FG, product name, planned qty (+ breakdown `130 + 22`), shift, location, notes, priority, last modified, modified by, change history. FG číslo dominantné (ľudia pracujú podľa neho).

### 4.3 Drag & Drop (jadro appky) — dnd-kit

- Bežný presun `Mon Morning → Wed Afternoon` = okamžitý move.
- **Ak je cieľ obsadený**, dialóg:
  ```
  Wed Morning already contains FG100899. What to do?
  ○ Swap productions
  ○ Add below existing
  ○ Replace existing
  ○ Move existing to Unscheduled
  ○ Cancel
  ```
- Všetko ako **jedna DB transakcia**.
- Po každom presune **Undo** toast: `FG100735 moved from Mon AM to Wed PM · [Undo]`.

### 4.4 Unscheduled queue (bočný drawer)

Odkladisko zákaziek, ktoré sa musia vyrobiť, ale ešte nie je jasné kedy:
```
FG100735  250 pcs  Due 31 Aug  HIGH
FG100829   80 pcs  Due 4 Sep   NORMAL
```
Kartu odtiaľ potiahneš na deň/smenu; alebo výrobu z kalendára „odhodíš" späť do Unscheduled. Veľké zlepšenie oproti Excelu.

### 4.5 Bulk operácie

Keďže sa plán často kompletne prehadzuje, nestačí ťahať kartu po karte:
- **Swap days** (Mon ↔ Tue — celý deň vrátane oboch smien)
- **Move day** (Mon → Wed)
- **Shift range** (vyber 20.–27. Aug → „Move everything +1 day") — extrémne užitočné, keď deň vypadne
- **Copy day / Copy week / Duplicate production**
- **Split quantity** (FG100735 200 pcs → 120 Mon + 80 Tue)

### 4.6 Urgent / Priority + urgent dni

Priority `normal/high/urgent/blocked` s farebným akcentom (urgent červený, high oranžový, blocked žltý). Naviac **Mark day as critical** — celý stĺpec dňa dostane jemné urgent zvýraznenie (nahrádza Excel žlté/farebné bunky, ale so sémantikou v dátach).

---

## 5. Draft / Publish + audit + revízie

Jedna z najdôležitejších vecí projektu — inak notifikácie každý ignoruje.

- Planner pracuje v **DRAFT**, zmeny sa autosave-ujú. Výroba stále vidí **poslednú publikovanú verziu**.
- Po dokončení: **Publish changes** → vznikne revízia `PO1 · CW34 · Revision 6`, zobrazí sa výrobe a odošle **jedna sumárna notifikácia**:
  ```
  Production plan PO1 – CW34 updated · 4 changes
  Mon AM: FG100865 → FG100899
  Tue PM: FG100735 moved to Wed PM
  Wed AM: Quantity 80 → 120 pcs
  ```
- Pri urgentnej zmene: **Publish now**.
- **Audit log = append-only** (žiadne prepisovanie histórie):
  ```
  25 Aug 2026 14:38 · John Smith
  PO1 · CW35 · Mon Morning · FG100735 → moved to Wed Afternoon · qty 120 → 150
  ```
- Pri publish → **snapshot revízie**. Možnosť porovnať `Rev 5 vs Rev 6` a `Restore Rev 5` (restore tiež vytvorí nový audit event).

---

## 6. Notifikácie (zjednodušené oproti ChatGPT)

Dve vrstvy:

**In-app** — bell v headeri, podľa location prístupu používateľa.
**Email** — cez **existujúci M365 (Graph / SMTP)**, žiadny nový SaaS.

**Odklon od BullMQ pre MVP:** na tvojom objeme (pár interných users, zopár publishov denne) je Redis + BullMQ + ďalší container zbytočná réžia. Namiesto toho:
```
email_outbox tabuľka (pending/sent/failed, attempts, next_retry_at)
→ jednoduchý worker (interval / node-cron alebo /api/cron route)
→ M365 Graph sendMail, retry pri zlyhaní
```
BullMQ + Redis pridáš neskôr, len ak objem/latencia vynúti. **SSE realtime tiež odložiť** — pre MVP stačí TanStack Query polling na bell endpoint.

**Subscriptions** — používateľ dostáva len to, čo ho týka:
```
PO1 ✓   DS1 ✓   Kandrac ✕   Assembly ASPF ✕
```
PO1 pracovník nepotrebuje zmeny na Kandrac.

---

## 7. História, search, filtre

Samostatná stránka **Production History**. Search podľa `FG100735` →
```
Date         Location  Shift      FG         Qty  Status
17 Aug 2026  PO1       Morning    FG100735   120  Completed
04 Aug 2026  Kandrac   Afternoon  FG100735    80  Completed
```
Filtre: FG, Location, Internal/External, Date from/to, Shift, Priority, Changed by, Planned/Historic.

Použi **TanStack Table** (headless, natívne filtering/sorting/pagination). Neaktívne pobočky (`DS-2 inactive`) ostávajú prehľadávateľné — `active=false`, história dostupná, nič sa nemaže.

---

## 8. Import Excelu

Rob ho — nemá zmysel štartovať s prázdnou DB, keď máte roky histórie.

**Stratégia (marker-driven, kvôli variabilnej výške bloku):**
1. Pre každý hárok → Location (+ metadata z hlavičky: line, headcount, hours).
2. Skenuj riadky, hľadaj marker `^(KW|WK)\s*\d+` → nasledujúci riadok = dátumy (Mon–Sun).
3. Zbieraj dvojice `Produkt:` / `Soll Stückzahl:` až po `Notizen:` alebo ďalší week marker. **Počet dvojíc je variabilný** (2 alebo 3) — prvá = Morning, druhá = Afternoon, tretia (`(Prototy.)`) = Prototype/extra karta.
4. Mapuj fill color → priority/status (žltá → urgent, zelená/FREI → day flag free).
5. Parsuj FG prefix z dlhých stringov; voľný text → `custom_product_name`.
6. Množstvo: číslo → `planned_quantity`; `130+22` → `raw_quantity` + `quantity_breakdown`.
7. Uchovaj `source_sheet` / `source_cell` / `source_file`.
8. Filtruj nevalidné dátumy (1900).

**Dôležité:** urob **dry-run / preview import** s diff reportom a **anomaly logom** predtým, než sa commitne. Keď sa objaví divný záznam, hneď vieš dohľadať pôvodnú bunku. Import z `BANK HOLIDAYS` → `production_calendar_exceptions`.

---

## 9. Production Viewer (pre výrobu)

Zjednodušené UI: žiadne edit/drag/settings. Len location, aktuálny týždeň, plán, FG, množstvo, notes, priority, posledná zmena.

**Changes since your last visit** — novozmenená karta zobrazí 24 h badge `UPDATED`; po kliknutí `Previously: FG100735 – 120 pcs → Now: FG100899 – 150 pcs`. Výroba nemusí študovať email, aby zistila čo sa zmenilo.

**Responsive od začiatku** — výroba pozrie plán aj z mobilu/tabletu (lacné, vysoká hodnota).

---

## 10. Tech stack

Zladený s existujúcim portálom — **nič cudzie nepridávať**:

| Vrstva | Voľba |
|---|---|
| Frontend/Backend | Next.js + TypeScript (App Router) — **verzie ako existujúci portál** |
| UI | Tailwind CSS + **shadcn/ui** (copy-paste komponenty) |
| Planner grid | Custom CSS Grid + **dnd-kit** |
| Server state | TanStack Query |
| Tables | TanStack Table |
| Forms/validácia | Zod (+ react-hook-form) |
| DB | PostgreSQL (už používaš PG 15) |
| ORM | Prisma (už používaš) |
| Dátumy | date-fns |
| Emaily | **M365 Graph / SMTP** + `email_outbox` (BullMQ až podľa potreby) |
| Notif realtime | polling (MVP) → SSE (neskôr) |
| Deploy | Docker na Infomaniak VPS, za Traefik (ako zvyšok portálu) |
| Future | SAP Integration Service (samostatný adapter) |

### Admin template — odporúčanie s dôležitým upozornením

Chceš hotové komponenty na šetrenie Claude Code kreditov — rozumný cieľ. Ale **pozor na version-clash**:

- ChatGPT odporúča **Kiranism Next Shadcn Dashboard Starter**. Ten však beží na novšom Next/React/Tailwind, než má tvoj portál (Next.js 14). Ak by si ho postavil ako základ vedľa/do portálu, riskuješ nekompatibilitu (Tailwind v4 vs v3, React 19 vs 18, App Router zmeny).
- **Keďže modul patrí DO existujúceho portálu** (jeden rozcestník, zdieľaný auth/nav), **neber celý starter ako base.** Namiesto toho:
  - Adoptuj **shadcn/ui** priamo do portálu — to nie sú npm dependency, ale komponenty kopírované do repa, sadnú do Next 14 / Tailwind v3.
  - Kiranism / TailAdmin použi len ako **referenciu na okopírovanie patternov** (data table setup, form patterns, layout, React Query recipes), nie ako fundament.
- Tým máš „hotové komponenty" **bez** roztrhaného stacku a **bez** druhého vizuálneho systému v portáli. To je najlacnejšia a najbezpečnejšia cesta.

**Prečo nie FullCalendar:** tvoj layout (CW → Mon–Sun → Morning/PM → Notes + swap/split/multi-week/urgent) je príliš špecifický. Custom grid + dnd-kit ti dá plnú kontrolu. FullCalendar Premium Scheduler (Resource Timeline) by dával zmysel až keby si plánoval stroje/linky/operátorov/hodiny — a je to platená licencia. Teraz zbytočné.

---

## 11. SAP – pripraviť teraz, integrovať neskôr

Integráciu nerob teraz, ale DB/backend navrhni tak, aby neskôr vzniklo:
```
Production Plan → Material Check Service → SAP Business One Adapter → SAP API
```
Kontrola nikdy z browsera priamo do SAP. Backend zistí BOM + sklad a pri karte ukáže `🟢 Material available` / `🟠 Material shortage (MAT-00132: need 600, have 480, missing 120)`. **Výsledok ukladať ako snapshot** (`Material check: 25 Aug 2026 14:42`), lebo sklad SAP sa mení. Preto už teraz `products.sap_item_code` a čisté numerické množstvá.

---

## 12. MVP scope

Prvá produkčná verzia:

**Planner**
- Locations (tabs) · 1/4/8 week view · flexibilné smeny · Notes
- FG autocomplete · planned quantity (+ breakdown) · custom product text
- priority + urgent day · drag & drop · swap · copy/move day · **shift range**
- Unscheduled queue · Undo

**Workflow**
- Draft · Publish · revisions · append-only audit · restore

**Users**
- Admin / Planner / Viewer / External Partner (location scope) na API vrstve

**Notifications**
- in-app (polling) · email cez M365 (`email_outbox`) · sumárne zmeny · subscriptions

**History**
- search podľa FG · filtre · neaktívne locations

**Migration**
- import histórie z Excelu (dry-run + anomaly log) · import BANK HOLIDAYS

**Navyše do MVP (lacné, vysoká hodnota):**
- **Print / PDF „tento týždeň"** (print CSS) — priamo nahrádza tlač Excelu
- **Responsive viewer** pre mobil/tablet

---

## 13. Fáza 2

Až keď základný planner funguje:
- SAP B1 material availability · Planned vs Actual · actual produced qty · completion
- downtime/reason codes · partner logins · **TV / shop-floor display** (`/production/display/po1`, fullscreen, auto-refresh, veľké písmo)
- PWA/tablet mode · capacity planning · machine/workstation assignment · cycle times · capacity warnings
- attachments / work instructions · SSE realtime · (BullMQ ak objem vynúti)

---

## 14. Čo NErobiť

- **Nerobiť Excel v prehliadači** (5 000 riadkov, editovateľné bunky, voľné farbenie). To by len prenieslo problémy Excelu na web. Zachovať jeho najlepšiu vlastnosť (vizuálny týždňový plán), ale s reálnou štruktúrou, históriou, permissions, auditom.
- **Nerobiť druhý login / druhú appku.** Modul do existujúceho portálu.
- **Nepridávať Redis/BullMQ/SSE do MVP** len preto, že to „vyzerá profesionálne". Pridať, keď to objem vynúti.
- **Nestavať na dashboard starteri s cudzím stackom.** shadcn/ui komponenty áno, celý starter ako base nie.

---

## 15. Zhrnutie cieľa

Production modul má byť predovšetkým **veľmi rýchly planner**. Šéf výroby otvorí PO1, vidí 4 týždne, potiahne FG z utorka na štvrtok, vymení dve smeny, označí FG ako urgent, klikne **Publish 4 changes**, koniec. Výroba dostane jednu notifikáciu, otvorí ten istý týždeň a hneď vidí čo sa zmenilo. O pol roka zadá do searchu `FG100829` a systém ukáže kompletnú históriu — kedy, kde a v akom množstve bolo plánované.

**Cesta:** existujúci ETILOG portál (Next.js 14 + Prisma + PostgreSQL + Docker/Traefik/Infomaniak) + shadcn/ui komponenty + custom Production Grid + dnd-kit + Draft/Publish revízie + M365 email outbox.
