# 🎯 ETILOG Teams Approval App - Setup Checklist

Kompletný prehľad čo máme hotové a čo ešte treba urobiť.

---

## ✅ ČO UŽ MÁME HOTOVÉ

### 1. **Aplikačný kód** ✅
- ✅ Backend API (Node.js + Express)
- ✅ Bot Framework integrácia
- ✅ Adaptive Cards templates
- ✅ PostgreSQL databázová schéma
- ✅ Azure AD autentifikácia
- ✅ HR Channel podpora
- ✅ Kompletná dokumentácia

### 2. **Teams konfigurácia** ✅
- ✅ **Tím**: Human Resources
- ✅ **Kanál**: General
- ✅ **Channel ID**: `19:4141e6983e924871be8dc35dfd2c5ff1@thread.tacv2`
- ✅ **Tenant ID**: `68fad620-da38-42f1-bff7-f02d56a8b293`
- ✅ **Team ID**: `336ee481-6e08-4963-86c8-1abe0a884068`

### 3. **Dokumentácia** ✅
- ✅ README.md - Celkový prehľad
- ✅ SETUP.md - Setup guide
- ✅ DEPLOYMENT.md - Deployment guide
- ✅ API.md - API dokumentácia
- ✅ DATABASE.md - Databázová dokumentácia
- ✅ HR-CHANNEL-SETUP.md - HR kanál setup

---

## ⏳ ČO EŠTE POTREBUJEME

### 1. **Azure Subscription** 🔄 (Práve vytváraš)
- ⏳ Pay-As-You-Go subscription
- ⏳ Pridanie platobnej metódy

### 2. **Azure Bot Registration** ⏸️ (Ďalší krok)
Po dokončení subscription:
- ⏸️ Vytvoriť Azure Bot
- ⏸️ Získať MICROSOFT_APP_ID
- ⏸️ Získať MICROSOFT_APP_PASSWORD
- ⏸️ Aktivovať Teams channel
- ⏸️ Nastaviť messaging endpoint

### 3. **VPS Server Setup** ⏸️
Potrebujem od teba:
- ⏸️ IP adresa VPS
- ⏸️ SSH prístup (root alebo sudo user)
- ⏸️ Doména (voliteľné) alebo použijeme IP

### 4. **Deployment na VPS** ⏸️
- ⏸️ Nainštalovať Node.js, PostgreSQL, Nginx
- ⏸️ Naklónovať git repo
- ⏸️ Nakonfigurovať .env súbor
- ⏸️ Spustiť databázové migrácie
- ⏸️ Nastaviť SSL certifikát
- ⏸️ Spustiť aplikáciu cez PM2

### 5. **Teams App Package** ⏸️
- ⏸️ Vytvoriť ikony (color.png, outline.png)
- ⏸️ Vygenerovať manifest.json
- ⏸️ Zabaliť do .zip súboru

### 6. **Teams Admin Center** ⏸️
- ⏸️ Nahrať app package
- ⏸️ Schváliť aplikáciu
- ⏸️ Sprístupniť používateľom
- ⏸️ Pridať bota do General kanála

---

## 📋 POSTUP - FÁZA PO FÁZE

### **FÁZA 1: Azure Subscription** 🔄 PREBIEHA
```
Čas: 5-10 minút
Status: Práve vytváraš v incognito okne
```
- Vyplniť údaje
- Pridať platobnú metódu
- Aktivovať subscription

### **FÁZA 2: Azure Bot Creation** ⏭️ ĎALŠIA
```
Čas: 10-15 minút
Status: Hneď ako bude subscription hotová
```
**Postup:**
1. Azure Portal → "Azure Bot" → Create
2. Vyplniť:
   - Bot handle: `etilog-approval-bot`
   - Resource group: `teams-approval-rg`
   - Pricing: **F0 (Free)**
   - Region: West Europe
3. Získať credentials:
   - MICROSOFT_APP_ID
   - MICROSOFT_APP_PASSWORD
4. Aktivovať Teams channel
5. API permissions v App Registration

### **FÁZA 3: VPS Preparation** ⏭️
```
Čas: 20-30 minút
Status: Hneď ako budeme mať Azure Bot
```
**Postup:**
1. SSH na VPS
2. Update systému
3. Nainštalovať:
   - Node.js 18
   - PostgreSQL
   - Nginx
   - PM2
4. Vytvoriť PostgreSQL databázu
5. Nastaviť firewall

### **FÁZA 4: Application Deployment** ⏭️
```
Čas: 15-20 minút
Status: Po VPS preparation
```
**Postup:**
1. Git clone repo na VPS
2. Vytvoriť .env súbor (máme template pripravený!)
3. `npm install`
4. `npm run migrate` (databáza)
5. Nastaviť Nginx reverse proxy
6. Nastaviť SSL (Let's Encrypt)
7. Spustiť cez PM2

### **FÁZA 5: Azure Bot Configuration** ⏭️
```
Čas: 5 minút
Status: Po deployment
```
**Postup:**
1. V Azure Bot nastaviť Messaging endpoint:
   - `https://your-server.com/api/messages`
2. Otestovať connection

### **FÁZA 6: Teams App Package** ⏭️
```
Čas: 10-15 minút
Status: Po deployment
```
**Postup:**
1. Vytvoriť ikony (pomôžem ti)
2. Spustiť: `node scripts/prepare-manifest.js`
3. Zabaliť manifest + ikony do .zip

### **FÁZA 7: Teams Installation** ⏭️
```
Čas: 10 minút
Status: Finálny krok
```
**Postup:**
1. Teams Admin Center → Manage apps
2. Upload app package
3. Approve app
4. Make available to users
5. Pridať bota do General kanála v Human Resources

### **FÁZA 8: Testing** ⏭️
```
Čas: 10 minút
Status: Overenie funkčnosti
```
**Postup:**
1. Vytvoriť testovací tiket cez API
2. Overiť že karta sa zobrazí v General kanáli
3. Otestovať Approve/Reject
4. Overiť notifikácie

---

## 📊 Časová estimácia

| Fáza | Čas | Status |
|------|-----|--------|
| 1. Azure Subscription | 10 min | 🔄 Prebieha |
| 2. Azure Bot | 15 min | ⏸️ Čaká |
| 3. VPS Preparation | 30 min | ⏸️ Čaká |
| 4. Deployment | 20 min | ⏸️ Čaká |
| 5. Bot Config | 5 min | ⏸️ Čaká |
| 6. App Package | 15 min | ⏸️ Čaká |
| 7. Teams Install | 10 min | ⏸️ Čaká |
| 8. Testing | 10 min | ⏸️ Čaká |
| **CELKOM** | **~2 hodiny** | |

---

## 🎯 ČO POTREBUJEM OD TEBA TERAZ

### **1. Azure Subscription (práve robíš)** ✅
Pokračuj s vytváraním subscription v incognito okne.

### **2. VPS informácie**
Priprav mi prosím:
```
IP adresa VPS: _________________
SSH user: _____________________ (root alebo sudo user)
SSH funguje? Áno / Nie
OS: __________________________ (Ubuntu 22.04?)
Doména: ______________________ (voliteľné)
```

### **3. PostgreSQL heslo**
Vymysli si silné heslo pre databázu:
```
DB_PASSWORD: _________________
(min. 16 znakov, mix písmen, čísiel, špeciálnych znakov)
```

---

## 📝 PRIPRAVENÉ SÚBORY PRE TEBA

V repozitári máš pripravené:

### **1. .env.etilog.template**
Template s už vyplnenými hodnotami:
- ✅ TENANT_ID (ETILOG)
- ✅ HR_CHANNEL_ID (General kanál)
- ⏸️ MICROSOFT_APP_ID (doplníme z Azure Bot)
- ⏸️ MICROSOFT_APP_PASSWORD (doplníme z Azure Bot)
- ⏸️ DB_PASSWORD (vymyslíš ty)
- ⏸️ APP_BASE_URL (tvoj VPS)

### **2. Dokumentácia**
Všetko pripravené v `docs/` priečinku.

### **3. Deployment skripty**
- `scripts/prepare-manifest.js` - Príprava Teams manifestu
- `src/database/migrate.js` - Databázové migrácie

---

## 🚀 AKO POKRAČUJEME

### **Teraz:**
1. ✅ Dokončíš Azure subscription
2. ✅ Pošleš mi VPS informácie (IP, SSH prístup)
3. ✅ Vymyslíš DB heslo

### **Hneď potom (spoločne):**
1. Vytvoríme Azure Bot (15 min)
2. Pripojíme sa na VPS (SSH)
3. Nainštalujeme potrebné veci (30 min)
4. Deploynem aplikáciu (20 min)
5. Vytvoríme Teams app package (10 min)
6. Nahráme do Teams (10 min)
7. Otestujeme (10 min)

**Celkovo: ~2 hodiny práce**

---

## 💡 OTÁZKY A ODPOVEDE

**Q: Koľko to bude stáť?**
A: Azure Bot F0 = 0 € mesačne. Platíš len VPS (už máš).

**Q: Potrebujem doménu?**
A: Nie je nutná, môžeme začať s IP adresou. Doménu pridáme neskôr.

**Q: Môžem to otestovať pred finálnym deploymentom?**
A: Áno, všetko najprv otestujeme v testovacom režime.

**Q: Čo keď niečo pokazím?**
A: Všetko je verzionované v gite, vždy sa dá vrátiť späť.

**Q: Budem to vedieť sám spravovať?**
A: Áno, pripravím ti kompletnú dokumentáciu + cheat sheet.

---

## 📞 KONTAKT NA MŇA

Daj vedieť keď:
- ✅ Bude subscription hotová
- ✅ Budeš mať VPS info
- ❓ Budeš mať akúkoľvek otázku

Pokračujeme krok za krokom! 🚀
