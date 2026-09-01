# 🚀 Migrácia Teams App na Infomaniak VPS

Kompletný návod na migráciu Teams Approval App z Hetzner Cloud na Infomaniak VPS.

---

## 📋 Predpoklady

Na Infomaniak VPS už máš:
- ✅ Docker & Docker Compose
- ✅ Traefik v3 (reverse proxy)
- ✅ `proxy` network vytvorená
- ✅ Let's Encrypt certifikáty cez Traefik

---

## 🔧 Krok 1: Príprava na Hetzner (starý server)

### 1.1 Export databázy (ak máš existujúce dáta)

```bash
# SSH na Hetzner server
ssh root@hetzner-vps-ip

# Export PostgreSQL databázy
docker exec teams-approval-db pg_dump -U postgres teams_approval > /tmp/teams_approval_backup.sql

# Stiahni backup na lokálny počítač
scp root@hetzner-vps-ip:/tmp/teams_approval_backup.sql ./
```

### 1.2 Skopíruj .env súbor

```bash
# Na Hetzner serveri
cat /path/to/teams-app/.env
```

Ulož si tieto hodnoty:
- `MICROSOFT_APP_ID`
- `MICROSOFT_APP_PASSWORD`
- `BOT_ID`
- `DB_PASSWORD`

---

## 🖥️ Krok 2: Setup na Infomaniak VPS

### 2.1 SSH na Infomaniak

```bash
ssh root@infomaniak-vps-ip
```

### 2.2 Vytvor adresár pre aplikáciu

```bash
mkdir -p /srv/stacks/apps/teams-app
cd /srv/stacks/apps/teams-app
```

### 2.3 Naklonuj repozitár

```bash
git clone https://github.com/your-org/etilogteamsapp.git .
# ALEBO ak je privátny repo:
git clone git@github.com:your-org/etilogteamsapp.git .
```

### 2.4 Vytvor .env súbor

```bash
# Skopíruj template
cp .env.infomaniak.template .env

# Uprav hodnoty
nano .env
```

**Dôležité hodnoty na zmenu:**
```env
# Skopíruj z Hetzner .env:
MICROSOFT_APP_ID=xxxxx
MICROSOFT_APP_PASSWORD=xxxxx
BOT_ID=xxxxx

# Vytvor nové DB heslo (alebo použi rovnaké):
DB_PASSWORD=silne-heslo-tu

# Aktualizuj URL:
APP_BASE_URL=https://teams.etilog.com
TEAMS_APP_URL=https://teams.etilog.com
```

---

## 🐳 Krok 3: Spustenie aplikácie

### 3.1 Build a spustenie

```bash
cd /srv/stacks/apps/teams-app

# Build Docker image
docker compose -f docker-compose.infomaniak.yml build

# Spusti kontajnery
docker compose -f docker-compose.infomaniak.yml up -d
```

### 3.2 Over status

```bash
# Skontroluj či kontajnery bežia
docker compose -f docker-compose.infomaniak.yml ps

# Pozri logy
docker compose -f docker-compose.infomaniak.yml logs -f teams-app
```

### 3.3 Spusti databázové migrácie

```bash
# Spusti migrácie
docker compose -f docker-compose.infomaniak.yml exec teams-app npm run migrate
```

---

## 📦 Krok 4: Import existujúcich dát (voliteľné)

Ak si exportoval dáta z Hetzner:

```bash
# Nahraj backup na server
scp teams_approval_backup.sql root@infomaniak-vps-ip:/srv/stacks/apps/teams-app/

# Import do PostgreSQL
docker compose -f docker-compose.infomaniak.yml exec -T teams-app-db \
  psql -U postgres -d teams_approval < /srv/stacks/apps/teams-app/teams_approval_backup.sql
```

---

## 🌐 Krok 5: DNS konfigurácia

### V Microsoft 365 DNS (alebo kde máš domény):

Pridaj A záznam:
```
teams.etilog.com  →  IP_ADRESA_INFOMANIAK_VPS
```

**TTL:** Nastav na 300 (5 minút) počas migrácie

---

## 🔄 Krok 6: Aktualizácia Azure Bot

### V Azure Portal:

1. Choď na **Azure Bot** > **Configuration**
2. Zmeň **Messaging endpoint** na:
   ```
   https://teams.etilog.com/api/messages
   ```
3. Ulož zmeny

---

## ✅ Krok 7: Testovanie

### 7.1 Over HTTPS

```bash
curl -I https://teams.etilog.com/health
# Mal by vrátiť HTTP 200
```

### 7.2 Over v Traefik dashboarde

Choď na `https://traefik.etilog.com` a over že:
- `teams-app` router je zelený
- Certifikát je platný

### 7.3 Test v Teams

1. Otvor Microsoft Teams
2. Choď do General kanála v Human Resources
3. Vytvor testovací tiket cez API alebo UI
4. Over že sa zobrazí Adaptive Card
5. Otestuj Approve/Reject

---

## 🛑 Krok 8: Vypnutie Hetzner servera

**Až keď všetko funguje:**

```bash
# SSH na Hetzner
ssh root@hetzner-vps-ip

# Zastav kontajnery
docker compose down

# Zálohuj data (pre istotu)
tar -czvf /tmp/teams-app-backup.tar.gz /path/to/teams-app
```

---

## 📊 Užitočné príkazy

### Správa kontajnerov

```bash
cd /srv/stacks/apps/teams-app

# Reštart
docker compose -f docker-compose.infomaniak.yml restart

# Zastavenie
docker compose -f docker-compose.infomaniak.yml down

# Logy
docker compose -f docker-compose.infomaniak.yml logs -f

# Rebuild po zmene kódu
docker compose -f docker-compose.infomaniak.yml build --no-cache
docker compose -f docker-compose.infomaniak.yml up -d
```

### Prístup do kontajnerov

```bash
# Shell v app kontajneri
docker compose -f docker-compose.infomaniak.yml exec teams-app sh

# PostgreSQL CLI
docker compose -f docker-compose.infomaniak.yml exec teams-app-db psql -U postgres -d teams_approval
```

### Zálohovanie databázy

```bash
docker compose -f docker-compose.infomaniak.yml exec teams-app-db \
  pg_dump -U postgres teams_approval > backup_$(date +%Y%m%d).sql
```

---

## 🔍 Troubleshooting

### Kontajner sa nespúšťa

```bash
# Pozri logy
docker compose -f docker-compose.infomaniak.yml logs teams-app

# Najčastejšie problémy:
# - Chýba .env súbor
# - Nesprávne DB_PASSWORD
# - Port 3978 už obsadený
```

### Traefik neroute-uje

1. Over že kontajner je v `proxy` sieti:
   ```bash
   docker network inspect proxy | grep teams-app
   ```

2. Over Traefik labels:
   ```bash
   docker inspect teams-app | grep -A 50 Labels
   ```

### Certifikát nefunguje

- Over že DNS A záznam smeruje na správnu IP
- Počkaj 5-10 minút na propagáciu DNS
- Skontroluj Traefik logy: `docker logs traefik`

### Bot neodpovedá

1. Over Azure Bot messaging endpoint
2. Over že `MICROSOFT_APP_ID` a `MICROSOFT_APP_PASSWORD` sú správne
3. Skontroluj logy: `docker compose -f docker-compose.infomaniak.yml logs teams-app`

---

## 📝 Zhrnutie súborov

| Súbor | Účel |
|-------|------|
| `Dockerfile` | Multi-stage production build |
| `docker-compose.infomaniak.yml` | Deployment konfigurácia pre Infomaniak |
| `.env.infomaniak.template` | Template pre environment variables |
| `.env` | Aktívna konfigurácia (nekomitovaťdo git!) |

---

## 🎯 Checklist

- [ ] Export DB z Hetzner (ak treba)
- [ ] Vytvor adresár `/srv/stacks/apps/teams-app`
- [ ] Naklonuj repo
- [ ] Vytvor `.env` z template
- [ ] Build a spusti kontajnery
- [ ] Spusti migrácie
- [ ] Import starých dát (ak treba)
- [ ] Pridaj DNS A záznam
- [ ] Aktualizuj Azure Bot endpoint
- [ ] Otestuj v Teams
- [ ] Vypni Hetzner server

---

**Potrebuješ pomoc?** Kontaktuj admina alebo pozri logy v Portainer: `https://portainer.etilog.com`
