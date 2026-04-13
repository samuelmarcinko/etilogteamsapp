# M365 Prospector

Nástroj na identifikáciu firiem používajúcich Microsoft 365 pomocou kontroly MX záznamov.

## Inštalácia

```bash
pip install -r requirements.txt
```

## Použitie

### Kontrola jednej domény
```bash
python m365_prospector.py check firma.sk
```

### Spracovanie CSV súboru s doménami
```bash
python m365_prospector.py csv domains.csv --domain-col domain --company-col company --workers 20
```

### Export M365 prospektov
```bash
python m365_prospector.py export --output leads.csv
```

### Štatistiky
```bash
python m365_prospector.py stats
```

### Demo režim
```bash
python m365_prospector.py demo
```

## Ako získať zoznamy firiem/domén

### 1. Slovenské/České firmy

**Finstat.sk (SK)** - https://finstat.sk
- Export firiem podľa odvetvia, regiónu, obratu
- Obsahuje domény a kontakty
- Platená služba, ale má aj free trial

**Bisnode/Dun & Bradstreet** - https://www.bisnode.sk
- Profesionálna databáza firiem
- Vysoká kvalita dát

**ORSR.sk** - https://orsr.sk
- Obchodný register SR (zadarmo)
- Nutný web scraping pre domény

**Justice.cz** - https://or.justice.cz
- Obchodný register ČR (zadarmo)

### 2. Medzinárodné zdroje

**Apollo.io** - https://apollo.io
- Lead database s emailmi a doménami
- Free tier: 50 exportov/mesiac
- Filtrovanie podľa technológií, veľkosti firmy

**Hunter.io** - https://hunter.io
- Vyhľadávanie emailov podľa domény
- Overenie emailov

**Crunchbase** - https://crunchbase.com
- Startupy a tech firmy
- API prístup

**LinkedIn Sales Navigator**
- Najlepší zdroj B2B kontaktov
- Export do CSV pomocou nástrojov ako Phantombuster

### 3. Industry-specific

**Clutch.co** - https://clutch.co
- IT a marketingové agentúry
- Ľahko scrape-ovateľné

**G2.com** - https://g2.com
- SaaS firmy (tvoji konkurenti aj potenciálni klienti)

### 4. Scraping verejných zdrojov

**Firmy.sk** - https://www.firmy.sk
**Zlatestranky.sk** - https://www.zlatestranky.sk
**Heureka.sk** - E-commerce firmy

### 5. LinkedIn + Sales Navigator workflow

1. Vyhľadaj firmy podľa odvetvia/veľkosti
2. Exportuj pomocou Phantombuster alebo podobného nástroja
3. Použi Hunter.io na nájdenie domén
4. Spusti M365 Prospector

## Príklad workflow

```bash
# 1. Priprav CSV s doménami
# Formát: domain,company,country,industry

# 2. Spusti kontrolu
python m365_prospector.py csv firmy_sk.csv --workers 20

# 3. Skontroluj štatistiky
python m365_prospector.py stats

# 4. Exportuj M365 leads
python m365_prospector.py export --output m365_leads_sk.csv

# 5. Môžeš teraz osloviť tieto firmy!
```

## Databáza

Výsledky sa ukladajú do SQLite databázy `prospects.db`:

```sql
SELECT domain, company_name, mx_records
FROM prospects
WHERE uses_m365 = TRUE
ORDER BY checked_at DESC;
```

## Tipy pre outreach

1. **Personalizuj** - Spomenieš, že vieš, že používajú M365
2. **Hodnota** - Vysvetli, ako Etilog Teams zlepší ich workflow
3. **Case study** - Ak máš, použi reálne príklady
4. **Demo** - Ponúkni bezplatnú demo session
5. **Timing** - Firmy často menia nástroje na začiatku kvartálu

## Právne upozornenie

- MX záznamy sú verejné DNS dáta
- Dodržuj GDPR pri spracovaní osobných údajov
- Rešpektuj opt-out požiadavky
