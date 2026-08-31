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
- **Stack zladený s existujúcim portálom** (Express + PostgreSQL raw SQL + Docker na Infomaniak VPS). Production frontend = samostatná React/Vite SPA na `/production/` servovaná tým istým Expressom. Žiadny nový backend, žiadna Prisma, žiadny Next.js. (Detail a odôvodnenie: §10.)
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
| **Množstvo má viac formátov.** `30`, string `130+22`, alebo osamotené `37` v poobednom riadku. | ~~`planned_quantity` + `quantity_breakdown` + `raw_quantity`~~ → **revidované (migrácia 029):** množstvo je jedno celé číslo (`planned_quantity integer`). `130+22` boli dve dodávky vtlačené do jednej bunky, lebo Excel nič iné nemal — tu sú to dve karty (alebo jedna rozdelená cez Split). |
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

- **Samostatná React/Vite SPA na `/production/`**, servovaná **tým istým Express serverom** (vlastný `index.html` + SPA fallback). NIE mount do `portal.js` hash-view, NIE druhý backend. Rovnaký origin ako `/portal/` → zdieľa JWT z localStorage.
- Znovupoužiť: existujúce **Azure AD JWT auth** (Bearer z localStorage, server-side `verifyToken`/`requireDbRole`), **PostgreSQL `teams_approval`**, **M365 Graph** na maily.
- Nová dlaždica **Production Plan** v hube (`portal.js` renderHub) smerujúca na `/production/`; zmena len na dvoch miestach portálu (dlaždica + `hasModuleAccess`).
- Po otvorení modulu → **rovno aktuálny výrobný plán**, nie generický dashboard s grafmi. Toto je pracovný nástroj, nie BI.

### Roly a prístup k modulom — dynamický, admin-spravovateľný systém (ZVOLENÁ CESTA)

> **Kontext z auditu.** Dnes je prístup jeden **exkluzívny** string `users.role` (`user`, `spravca`, `sklad`, `sklad_read`, `admin`), **hardkódovaný** v `hasModuleAccess()` (frontend, kozmetika) a `requireDbRole(...)` per API route (server, skutočná ochrana). Matica ani checkboxy v DB neexistujú.

**Rozhodnutie:** nahradiť to **dátovým modelom rola → prístup do modulov**, ktorý si admin spravuje v UI. **Kritická podmienka: nič, čo dnes funguje, sa nesmie pokaziť** — existujúce roly a ich súčasný prístup musia ostať 1:1 zachované (parity).

**Požiadavky (produktové):**
- Admin vie v admin UI **vytvoriť rolu** — je to len **label/názov**.
- Pre každú rolu **checkboxy** zapínajú prístup do modulov.
- **HR = default pre každého (must-have)**, always-on, nedá sa vypnúť.
- **Fleet, Warehouse, Production** = prístup cez checkbox.
- Bohatšie moduly majú viac než jeden checkbox (zachovať granularitu): **Warehouse** `read` / `write`, **Production** `view` / `manage`. **Fleet** jeden (`access`).
- Priradenie roly používateľovi ostáva v existujúcej správe userov.

**Dátový model (len NOVÉ tabuľky; existujúce sa nemenia):**
```
roles (id, name, label, is_system, created_at, updated_at)
  ← seed existujúcich rolí ako is_system=true (nedajú sa zmazať/premenovať)
role_permissions (role_id, permission_key)
  ← matica; permission_key ∈ {hr.access, hr.manage, fleet.access,
     warehouse.read, warehouse.write, production.view, production.manage}
users.role  ← OSTÁVA (string = roles.name); hodnoty existujúcich userov sa NEMENIA
```

**Seed = presná kópia dnešného správania (parity):**
- `admin` → všetky permissions (admin ostáva „všetko").
- `sklad` → `warehouse.read` + `warehouse.write`.
- `sklad_read` → `warehouse.read`.
- `spravca` → `hr.access` + **`hr.manage`**. Dnes vidí `admin-employees`, `admin-quotas`,
  `admin-sick-notes`, `admin-tickets` (allowlist `spravcaPages` v `portal.js`) a 12 API routes
  cez `requireDbRole('admin','spravca')`. Bez samostatného kľúča by splynul s `user`.
- `user` → len `hr.access`.
- Fleet má dnes iba admin → žiadna non-admin rola nedostane `fleet.access`.
- `hr.access` je grant-nutý **vždy** (resolver + UI locked).

**Resolver + enforcement (jeden zdroj pravdy):**
- Helper `getUserPermissions(user)`: ak `role === 'admin'` → všetko; inak `hr.access ∪ role_permissions[role]`.
- Backend middleware `requirePermission('production.manage')` na `/api/production/*`. Existujúce `requireDbRole(...)` ostáva funkčné počas prechodu (role stringy stále existujú).
- Frontend endpoint `GET /api/me/permissions` → zoznam; `hasModuleAccess` číta z neho namiesto hardkódu (seed = rovnaké výsledky).
- **Parity test:** každá existujúca rola vidí presne tie isté moduly a má rovnaké práva ako dnes.

**Bezpečná migrácia (fázovo):**
1. Pridať tabuľky + seed + resolver + `GET /api/me/permissions` (nič nezmení správanie — len nový zdroj).
2. Prepnúť frontend `hasModuleAccess` na resolver; overiť parity.
3. Postupne prepnúť routy z `requireDbRole` na `requirePermission`; overiť parity po každom module.
4. Admin UI na správu rolí a checkbox-matice.
Migrácia **reverzibilná**, nemení `users.role`, nič nemaže.

> **Poznámka – externí partneri (napr. Kandrac):** „len svoja pobočka" sa rolou/permission nevyjadrí; na to treba **location scope** ako atribút používateľa, ktorý Production API zohľadní pri filtrovaní. Nie je súčasť MVP; dá sa doplniť neskôr bez prerábania.

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

planned_quantity       integer nullable -- celé kusy, nič iné (migrácia 029)

priority               enum(normal, urgent)            -- migrácia 028
color                  enum(10 farieb) nullable        -- migrácia 028, vlastné zoskupenie
status                 enum(planned, done)             -- migrácia 029
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
- **Množstvo je jedno celé číslo** — pôvodne to mali byť tri stĺpce (`planned_quantity` + `quantity_breakdown` + `raw_quantity`), aby sa zachovala vernosť importu. V praxi každý breakdown sedel presne na súčet vedľa seba, takže sa nič nestratilo a stĺpce zmizli (029). Kusy sa počítajú, nemerajú: `integer`, nie `numeric(12,2)`.
- **Dva stavy, dve priority** — štyri stavy boli dedičstvo generického workflow; plán sa číta na jeden pohľad a tretí odtieň „rozrobené" ho len spomaľoval. Zostalo `planned` / `done`. Rovnako priority: jeden alarm (`urgent`) a farba na zoskupenie príbuznej práce (028).

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
Notizen (ak sú)
```

Hotová karta ostáva v týždni — týždeň je aj záznam, nielen plán — ale povie to naraz tromi tichými spôsobmi: zelený ✓ badge **DONE**, jemné prečiarknutie FG čísla a menší kontrast. Ktorýkoľvek z nich sám sa cez vytlačený osemtýždňový prehľad stratí.

Po kliknutí detail: full FG, product description, planned qty, shift, location, notes, priority, status, last modified, modified by, change history. FG číslo dominantné (ľudia pracujú podľa neho). V detaile sú aj akcie: zelený **Mark as Done** (resp. **Reopen**), **Split** a **Edit** — zatvorenie karty je najčastejší zápis v celom module a nemá zmysel ho posielať cez editačný formulár. **Product description** sa dá opraviť pri každom FG; patrí k FG master záznamu, takže sa prejaví na všetkých kartách s tým číslom (Excel master prišiel s popismi, ktoré sa nedali opraviť).

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

Priority `normal` / `urgent` (migrácia 028). Urgent je červený a pevný — ten signál nesmie byť na nikoho vkuse. Všetko ostatné dostane **vlastnú farbu z palety 10 farieb**: rovnaká farba = príbuzná práca, čitateľná naprieč týždňom. Naviac **Mark day as important** — celý stĺpec dňa dostane jemné zvýraznenie (nahrádza Excel žlté/farebné bunky, ale so sémantikou v dátach).

---

## 5. Draft / Publish + audit + revízie

Jedna z najdôležitejších vecí projektu — inak notifikácie každý ignoruje.

**Fáza 1 hotová (migrácia 030).** Viewer túto potrebu vytvoril: odkedy sa sám obnovuje každú minútu, dielňa vidí každý medzikrok plánovača a nerozozná rozhodnutie od rozmýšľania nahlas.

Riešenie zámerne **nemá draft stav na kartách**. Plánovač pracuje na živých riadkoch presne ako doteraz; revízia je *kópia* týždňa odložená vedľa, v novej tabuľke `production_plan_revisions` (lokalita, týždeň, číslo revízie, JSONB snapshot, kto a kedy). Žiaden existujúci dotaz sa nemusel zmeniť a niet druhého stavu, ktorý by sa mohol rozísť.

„Nepublikované zmeny" preto nie je príznak, ktorý treba udržiavať — je to rozdiel medzi týždňom teraz a týždňom pri poslednom publikovaní, počítaný na požiadanie. Ráta sa tak, ako by to rátal človek: pribudnutá karta, zmiznutá karta, karta, ktorá nie je čo bola, plus denné príznaky a poznámky smien. Presunutá karta je **jedna** zmena, nie odobratie plus pridanie. Dotknúť sa karty a vrátiť ju späť nie je zmena vôbec.

Snapshot je **denormalizovaný**: FG čísla, popisy a názvy smien tak, ako zneli v momente publikovania. Revízia je to, čo dielňa dostala, nie odkaz na to, čo master dáta hovoria dnes.

Týždeň bez revízie viewer nevykreslí ako prázdny, ale povie **„Not published yet"** — fallback na živé riadky by dielňu vrátil k pozeraniu sa plánovačovi cez rameno, čo je práve to, čo revízie riešia. Migrácia preto vytvorí Revision 1 pre každý týždeň, ktorý už nejaké karty má; robí sa to v migrácii a nie skriptom, lebo na skript sa dá zabudnúť.

**Retencia** ide rovnakým vzorom ako change log (snapshot 90 dní, hlavička 3 roky, oboje cez env) s jednou tvrdou výnimkou: **najnovšia revízia každého týždňa sa nemaže nikdy** — to nie je história, to je to, čo viewer vykresľuje.

Zostáva: **fáza 2** compare `Rev 5 vs Rev 6` + restore, **fáza 3** notifikácie (§6).

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
6. Množstvo: číslo → `planned_quantity` (celé kusy). `130+22` v bunke = dve dodávky → **dve karty**, nie jeden reťazec (029).
7. Uchovaj `source_sheet` / `source_cell` / `source_file`.
8. Filtruj nevalidné dátumy (1900).

**Dôležité:** urob **dry-run / preview import** s diff reportom a **anomaly logom** predtým, než sa commitne. Keď sa objaví divný záznam, hneď vieš dohľadať pôvodnú bunku. Import z `BANK HOLIDAYS` → `production_calendar_exceptions`.

**Kam patrí zdrojový Excel:** `Productiondistributor.xlsx` **necommitovať do repa** — obsahuje reálne firemné/zákaznícke dáta (~3,5 MB), nafukuje repo a je to zbytočné GDPR/data-hygiene riziko. Pridať `*.xlsx` do `.gitignore`. Reálny súbor podávať importeru **až v runtime** cez cestu/upload (lokálne alebo na VPS). Pre vývoj a testy importera commitni len malý **anonymizovaný sample** (2–3 týždne z 1–2 hárkov) do `tests/fixtures/`.

---

## 9. Production Viewer (pre výrobu)

**Hotové.** Beží na `/production/view/PO1` (bez kódu lokality na prvej lokalite). Vlastná stránka v tom istom buildi — Express už každú `/production/*` cestu vracia na to isté `index.html`, takže rozdelenie rieši `main.jsx` podľa cesty. Žiadny nový server, žiadna nová appka.

Zjednodušené UI: žiadne edit/drag/settings, žiaden Unscheduled/History/Print, žiaden prepínač 1/4/8 týždňov — jeden týždeň, lebo zmena robí na jeden týždeň. Len location, aktuálny týždeň, plán, FG, popis, množstvo, notes, priority, status, poznámky smien, voľné a dôležité dni, posledná zmena.

Väčšie písmo než v plánovači — číta sa postojačky pri stole, nie posediačky. Farebná reč je zámerne identická s plánovačom (rovnaký pruh, tint, červená pre urgent, prečiarknutá zelená pre done): kto používa oba, nemá si čo prekladať.

**1 / 4 / 8 týždňov** vpravo hore — jeden týždeň sa číta postojačky pri linke, štyri a osem odpovedajú na otázku „čo prichádza". Karta sa pri hustejších layoutoch dvakrát zmenší (najprv zmizne popis, potom poznámky, badge sa scvrknú na ikonu), inak sedem stĺpcov osemkrát pod sebou nikto neprečíta. Zvolený layout drží v hashi (`#span=4`), takže prežije reload.

**Sama sa obnovuje** každú minútu a v hlavičke hovorí, kedy naposledy počula server. Plán na tablete pri linke, ktorý potichu zostarol, je horší než žiadny plán.

**Changes since your last visit** — karta zmenená za posledných 24 h nesie modrý badge `RECENTLY UPDATED` na vlastnom riadku pod FG číslom (je to najdlhší popis na karte a horný riadok patrí FG), hore je počet („1 card changed"), a po kliknutí panel **What changed**: `PRODUCT FG100735 → FG100865`, `QUANTITY 120 pcs → 150 pcs`. Vypíšu sa len polia, ktoré sa naozaj líšia. Dáta idú z `production_change_log`; `findActivity` dorozlišuje FG čísla z oboch snapshotov, lebo „produkt 41 sa zmenil na produkt 58" čitateľovi nepovie nič.

**Responsive od začiatku** — pod `md` sa sedem stĺpcov zmení na sedem sekcií pod sebou. Skrolovať do strany, aby človek porovnal utorok so štvrtkom, nie je čítanie.

**Cesta doň:** dlaždica v portáli posiela človeka bez `production.manage` rovno sem; v plánovači je odznak „View only" odkazom na viewer; z viewera vedie tlačidlo Planner späť, ale len tomu, kto tam má čo robiť.

---

## 10. Tech stack

> **Opravené podľa auditu reálneho portálu (nie predpoklad).** Portál je **jedna vanilla-JS SPA** (`portal.js`, hash-routing) servovaná **Express** serverom, backend **PostgreSQL cez `pg` pool + raw parametrizované SQL, žiadny ORM**, číslované `.sql` migrácie. Auth = **Azure AD JWT v localStorage** (Bearer), validovaný na serveri cez JWKS. **Žiadna Prisma, žiadny Next.js.**

Zladený s existujúcim portálom — **nič cudzie do backendu nepridávať**:

| Vrstva | Voľba |
|---|---|
| Production frontend | **Samostatná React (Vite) SPA na `/production/`**, servovaná tým istým Express serverom (vlastný `index.html` + SPA fallback). NIE mount do `portal.js` hash-view. |
| UI | Tailwind CSS + **shadcn/ui** (scoped na production bundle, aby neunikal do `portal.css`) |
| Planner grid | Custom CSS Grid + **dnd-kit** |
| Server state | TanStack Query |
| Tables | TanStack Table |
| Forms/validácia | Zod (+ react-hook-form) |
| Backend | **Existujúci Express app** — `productionRoutes.js` + modely podľa vzoru `warehouseRoutes.js`; middleware `verifyToken` / `attachDbRole` / `requireDbRole` znovupoužiť |
| DB | **PostgreSQL `teams_approval`** (postgres:15), zdieľaná; **raw SQL cez `pg` pool, žiadny ORM** |
| Migrácie | Číslované `.sql` v `src/database/migrations/` (napr. `0NN_add_production.sql`) — ako `021_add_warehouse.sql` |
| Auth | Znovupoužiť Azure AD JWT z localStorage (rovnaký origin `/production/` = `/portal/`); MSAL silent refresh s rovnakým clientId; redirect na portal login pri 401 |
| Dátumy | date-fns |
| Emaily | **M365 Graph / SMTP** + `email_outbox` tabuľka (BullMQ až podľa potreby) |
| Notif realtime | polling (MVP) → SSE (neskôr) |
| Deploy | Ten istý Docker image / Express proces za Traefik; pribudne **Vite build krok** pre production frontend (výstup do `public/production/`, ktorý sa COPY-uje do image ako zvyšok `public`) |
| Future | SAP Integration Service (samostatný adapter) |

### Admin template — odporúčanie s dôležitým upozornením

Chceš hotové komponenty na šetrenie Claude Code kreditov — rozumný cieľ. Kľúčové zistenie z auditu tu veci **zjednodušuje**: portál je vanilla JS, ale Production frontend je **samostatná React/Vite SPA** vo vlastnom bundle, takže má vlastný build aj vlastný CSS scope. Nič sa nemieša s `portal.css`, žiadny version-clash s portálom (portál nemá React ani Tailwind).

- **shadcn/ui + Tailwind sadnú do production bundle natívne** — sú to komponenty kopírované do repa, plná kontrola nad verziami. Použi ich pre dialógy, menu, tooltip, command palette (FG autocomplete cez `cmdk`), tabs, badges, drawer, skeleton.
- **Nestavaj na celom dashboard starteri** (Kiranism/TailAdmin ako fundament) — pre jeden modul je to zbytočná záťaž a cudzia navigácia/layout, ktoré aj tak zahodíš. Použi ich nanajvýš ako **referenciu na okopírovanie patternov** (data table setup, form patterns, React Query recipes).
- Vizuálne zosúlaď s ETILOG portálom: prevezmi jeho farby (ETILOG červená ako primary/urgent akcent), spacing a typografiu, aby `/production/` pôsobil ako súčasť portálu, nie cudzia appka.

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
- Dynamický systém rolí podľa §2 — admin si rolu vytvorí sám a checkboxami jej zapne `production.view` / `production.manage` · admin má default všetko · autorizácia cez `requirePermission` na API vrstve
- (Location scope pre externých partnerov aj prípadná matica prístupov až neskôr — viď §2)

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

**Cesta:** existujúci ETILOG portál (Express + PostgreSQL raw SQL + Docker/Traefik/Infomaniak) + Production ako samostatná React/Vite SPA na `/production/` (shadcn/ui + Tailwind, dnd-kit, TanStack) servovaná tým istým Expressom + Production API v tom istom Express+PG podľa vzoru `warehouseRoutes.js` + Draft/Publish revízie + M365 email outbox.
