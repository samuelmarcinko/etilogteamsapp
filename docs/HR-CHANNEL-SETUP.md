# HR Channel Setup Guide

Návod ako nastaviť HR kanál pre posielanie schvaľovacích kariet.

## 🎯 Konfigurácia

Aplikácia je nastavená tak aby:
- ✅ **Schvaľovacie karty** posielala do **HR kanála** (všetci členovia ich vidia)
- ✅ **Notifikácie tvorcom** posielala cez **DM** (priame správy - súkromné)
- ✅ **Len jeden kanál** - HR kanál pokrýva všetko

---

## 📋 Krok 1: Vytvor alebo nájdi HR kanál v Teams

### Ak už máš HR kanál:
1. V Teams choď do tvojho HR tímu
2. Nájdi HR kanál (alebo akýkoľvek kanál ktorý chceš použiť)

### Ak ešte nemáš HR kanál:
1. V Teams choď do tvojho tímu (napr. "ETILOG HR")
2. Klikni na **"⋯"** (More options) vedľa tímu
3. Klikni **"Add channel"**
4. Názov: **"HR Approvals"** alebo **"Schvaľovanie"**
5. Description: "Kanál pre schvaľovacie procesy"
6. Privacy: **Standard** (všetci členovia tímu môžu vidieť)
7. Klikni **"Add"**

---

## 🔑 Krok 2: Získaj Channel ID

### Metóda 1: Cez link na kanál (Najjednoduchšie)

1. V Teams choď do HR kanála
2. Klikni na **"⋯"** (More options) vedľa názvu kanála
3. Klikni **"Get link to channel"**
4. Skopíruj link, bude vyzerať ako:

```
https://teams.microsoft.com/l/channel/19%3Aabc123def456...%40thread.tacv2/HR%20Approvals?groupId=xxx&tenantId=yyy
```

5. **Dekóduj URL** (urob to online alebo v browseri):
   - Časť medzi `/channel/` a `/HR%20Approvals`
   - `19%3Aabc123...%40thread.tacv2` → `19:abc123...@thread.tacv2`

6. **Toto je tvoje Channel ID**: `19:abc123...@thread.tacv2`

### Metóda 2: Cez Graph Explorer (Pokročilé)

1. Otvor [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
2. Prihlás sa
3. Zadaj query:
```
GET https://graph.microsoft.com/v1.0/teams/{team-id}/channels
```
4. Nájdi svoj kanál v response
5. Skopíruj `id` field

---

## ⚙️ Krok 3: Nakonfiguruj aplikáciu

### V `.env` súbore na VPS serveri pridaj:

```env
# Teams Channels Configuration
HR_CHANNEL_ID=19:abc123def456...@thread.tacv2
SEND_TO_HR_CHANNEL=true
CREATOR_NOTIFICATION_DM=true
```

**Vysvetlenie:**
- `HR_CHANNEL_ID` - ID tvojho HR kanála (získaš v kroku 2)
- `SEND_TO_HR_CHANNEL=true` - Tikety sa pošlú do kanála (nie DM)
- `CREATOR_NOTIFICATION_DM=true` - Notifikácie tvorcom cez DM

---

## 🤖 Krok 4: Pridaj bota do HR kanála

**Dôležité**: Bot musí byť pridaný do kanála aby mohol posielať správy!

### Po inštalácii aplikácie do Teams:

1. V Teams choď do HR kanála
2. Klikni na **"+"** (Add a tab) hore
3. Vyhľadaj **"Approval Bot"** (alebo názov tvojej aplikácie)
4. Klikni **"Add"**
5. Potvrď dialóg

**Alternatívne:**
1. V HR kanáli napíš: `@Approval Bot`
2. Mention bot v správe
3. Bot sa automaticky pridá do kanála

---

## ✅ Krok 5: Testovanie

### Test 1: Vytvor testovací tiket

```bash
curl -X POST https://your-server.com/api/tickets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "TEST: Schvaľovací proces",
    "description": "Toto je testovací tiket",
    "ticketType": "HR",
    "priority": "Medium",
    "assignedApprover": {
      "id": "tvoj-aad-id",
      "name": "Tvoje Meno",
      "email": "tvoj@email.com"
    }
  }'
```

### Čo by sa malo stať:

1. ✅ **V HR kanáli** sa objaví Adaptive Card s tiketom
2. ✅ **Všetci členovia** kanála vidia kartu
3. ✅ **Priradený manažér** môže kliknúť Approve/Reject
4. ✅ Po schválení/zamietnutí sa **karta aktualizuje**
5. ✅ **Tvorkyňa tiketu** dostane **DM notifikáciu**

---

## 🔧 Riešenie problémov

### Bot nemôže poslať správu do kanála

**Problém**: `Forbidden` alebo `Unauthorized` error

**Riešenie:**
1. Over že bot je pridaný do kanála (krok 4)
2. Over že Channel ID je správne
3. Over že bot má permissions v Teams App manifest:
   ```json
   "permissions": [
     "identity",
     "messageTeamMembers"
   ]
   ```
4. Reštartuj aplikáciu na VPS: `pm2 restart teams-approval-app`

### Nesprávne Channel ID

**Problém**: Channel ID nezačína `19:` alebo končí `@thread.tacv2`

**Riešenie:**
1. Over že si skopíroval celý ID
2. Skús metódu 2 (Graph Explorer)
3. Skontroluj či si dekódoval URL správne

### Karty sa neaktualizujú po schválení

**Problém**: Po kliknutí na Approve/Reject sa karta nezmení

**Riešenie:**
1. Over že `activityId` sa ukladá do databázy
2. Skontroluj logy: `pm2 logs teams-approval-app`
3. Over že bot má prístup aktualizovať správy v kanáli

---

## 📊 Ako to funguje

```
┌────────────────────────────────────┐
│  Jana vytvorí tiket cez API       │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│  Backend spracuje a uloží do DB    │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│  Bot pošle kartu do HR kanála      │
│  (SEND_TO_HR_CHANNEL=true)         │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│  Všetci v HR kanáli vidia kartu:   │
│  - Jana (tvorkyňa)                 │
│  - Peter (schvaľovateľ)            │
│  - Ostatní HR zamestnanci          │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│  Peter klikne "Approve"            │
│  (len on môže, je priradený)       │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│  Backend:                          │
│  - Aktualizuje DB                  │
│  - Aktualizuje kartu v kanáli      │
│  - Pošle DM notifikáciu Jane       │
└────────────────────────────────────┘
```

---

## 🎨 Príklad ako vyzerá karta v HR kanáli

```
═══════════════════════════════════════
HR Approvals                    🔔 1
═══════════════════════════════════════

📅 Today at 10:30 AM

🤖 Approval Bot

╔════════════════════════════════════╗
║ 🎫 New Approval Request            ║
║ Ticket ID: TKT-ABC123              ║
╠════════════════════════════════════╣
║ Title: Schváliť novú pozíciu       ║
║ Type: HR                           ║
║ Priority: High                     ║
║ Created By: Jana Nováková          ║
║ Assigned To: Peter Hlavný          ║
╠════════════════════════════════════╣
║ Description:                       ║
║ Potrebujeme Senior Programátor... ║
╠════════════════════════════════════╣
║  [✅ Approve]  [❌ Reject]         ║
╚════════════════════════════════════╝

    💬 Reply   ↗️ Share   ⋯ More
```

---

## 💡 Tipy a best practices

### 1. Pomenuj kanál jasne
- ✅ Dobré: "HR Approvals", "Schvaľovanie HR"
- ❌ Zlé: "Všeobecné", "General"

### 2. Nastav správne permissions
- Všetci HR zamestnanci by mali mať prístup do kanála
- Len manažéri môžu schvaľovať (aplikácia to kontroluje)

### 3. Pridaj popis kanála
Napríklad:
```
Tento kanál slúži na schvaľovacie procesy HR.
Karty môžu schvaľovať len priradení manažéri.
Pre vytvorenie tiketu kontaktuj IT.
```

### 4. Notifikácie
- Karty v kanáli neobťažujú všetkých s notifikáciou
- Len tvorkyňa dostane DM notifikáciu po schválení
- Manažéri dostanú @mention ak chceš

### 5. Archivovanie
- Staré tikety ostanú v kanáli ako história
- Môžeš ich neskôr vyhľadávať
- Považuj kanál ako audit log

---

## 🔄 Zmena konfigurácie neskôr

### Chceš zmeniť na DM namiesto kanála?

V `.env` súbore zmeň:
```env
SEND_TO_HR_CHANNEL=false
```

A reštartuj: `pm2 restart teams-approval-app`

### Chceš pridať Accounting kanál?

1. Vytvor Accounting kanál v Teams
2. Získaj jeho Channel ID
3. V `.env` pridaj:
```env
ACCOUNTING_CHANNEL_ID=19:def456...@thread.tacv2
```
4. Kontaktuj vývojára pre úpravu kódu (podporiť oba kanály)

---

## 📞 Pomoc

Ak máš problémy:
1. Skontroluj `.env` konfiguráciu
2. Over že Channel ID je správne
3. Over že bot je v kanáli
4. Pozri logy: `pm2 logs teams-approval-app`
5. Skontroluj dokumentáciu: `docs/TROUBLESHOOTING.md`

---

**Hotovo!** Teraz máš HR kanál nakonfigurovaný a ready na používanie! 🎉
