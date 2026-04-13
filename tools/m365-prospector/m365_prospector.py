#!/usr/bin/env python3
"""
M365 Prospector - Nástroj na identifikáciu firiem používajúcich Microsoft 365
Kontroluje MX záznamy domén a hľadá mail.protection.outlook.com
"""

import dns.resolver
import csv
import json
import sqlite3
import argparse
import time
import concurrent.futures
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import Optional, List
from pathlib import Path


@dataclass
class CompanyRecord:
    """Záznam o firme"""
    domain: str
    company_name: str = ""
    uses_m365: bool = False
    mx_records: str = ""
    spf_has_microsoft: bool = False
    checked_at: str = ""
    country: str = ""
    industry: str = ""
    contact_email: str = ""
    notes: str = ""


class M365Prospector:
    """Hlavná trieda pre vyhľadávanie M365 firiem"""

    M365_INDICATORS = [
        "mail.protection.outlook.com",
        "outlook.com",
        "microsoft.com"
    ]

    def __init__(self, db_path: str = "prospects.db"):
        self.db_path = db_path
        self.resolver = dns.resolver.Resolver(configure=False)
        # Použitie verejných DNS serverov (Google, Cloudflare)
        self.resolver.nameservers = ['8.8.8.8', '8.8.4.4', '1.1.1.1']
        self.resolver.timeout = 5
        self.resolver.lifetime = 10
        self._init_database()

    def _init_database(self):
        """Inicializácia SQLite databázy"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS prospects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT UNIQUE NOT NULL,
                company_name TEXT,
                uses_m365 BOOLEAN DEFAULT FALSE,
                mx_records TEXT,
                spf_has_microsoft BOOLEAN DEFAULT FALSE,
                checked_at TIMESTAMP,
                country TEXT,
                industry TEXT,
                contact_email TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_uses_m365 ON prospects(uses_m365)
        """)

        conn.commit()
        conn.close()
        print(f"[OK] Databáza inicializovaná: {self.db_path}")

    def check_mx_records(self, domain: str) -> tuple[bool, List[str]]:
        """Kontrola MX záznamov domény"""
        mx_records = []
        uses_m365 = False

        try:
            answers = self.resolver.resolve(domain, 'MX')
            for rdata in answers:
                mx_host = str(rdata.exchange).lower().rstrip('.')
                mx_records.append(f"{rdata.preference} {mx_host}")

                for indicator in self.M365_INDICATORS:
                    if indicator in mx_host:
                        uses_m365 = True
                        break

        except dns.resolver.NXDOMAIN:
            pass  # Doména neexistuje
        except dns.resolver.NoAnswer:
            pass  # Žiadne MX záznamy
        except dns.resolver.NoNameservers:
            pass  # Žiadne nameservery
        except Exception as e:
            mx_records.append(f"Error: {str(e)}")

        return uses_m365, mx_records

    def check_spf_record(self, domain: str) -> bool:
        """Kontrola SPF záznamu pre Microsoft"""
        try:
            answers = self.resolver.resolve(domain, 'TXT')
            for rdata in answers:
                txt = str(rdata).lower()
                if 'spf' in txt and ('include:spf.protection.outlook.com' in txt or
                                      'include:outlook.com' in txt):
                    return True
        except Exception:
            pass
        return False

    def check_domain(self, domain: str, company_name: str = "") -> CompanyRecord:
        """Komplexná kontrola domény"""
        domain = domain.lower().strip()

        uses_m365, mx_records = self.check_mx_records(domain)
        spf_has_microsoft = self.check_spf_record(domain)

        # Ak má Microsoft v SPF ale nie v MX, stále môže byť M365 zákazník
        if spf_has_microsoft and not uses_m365:
            uses_m365 = True  # Pravdepodobne používa M365 pre iné služby

        return CompanyRecord(
            domain=domain,
            company_name=company_name,
            uses_m365=uses_m365,
            mx_records="; ".join(mx_records),
            spf_has_microsoft=spf_has_microsoft,
            checked_at=datetime.now().isoformat()
        )

    def save_to_database(self, record: CompanyRecord):
        """Uloženie záznamu do databázy"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            INSERT OR REPLACE INTO prospects
            (domain, company_name, uses_m365, mx_records, spf_has_microsoft,
             checked_at, country, industry, contact_email, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            record.domain, record.company_name, record.uses_m365,
            record.mx_records, record.spf_has_microsoft, record.checked_at,
            record.country, record.industry, record.contact_email, record.notes
        ))

        conn.commit()
        conn.close()

    def process_domains_from_csv(self, csv_path: str, domain_column: str = "domain",
                                  company_column: str = "company", max_workers: int = 10):
        """Spracovanie domén z CSV súboru"""
        domains_to_check = []

        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                domain = row.get(domain_column, "").strip()
                company = row.get(company_column, "").strip()
                if domain:
                    domains_to_check.append((domain, company))

        print(f"[INFO] Načítaných {len(domains_to_check)} domén na kontrolu")

        m365_count = 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self.check_domain, domain, company): (domain, company)
                for domain, company in domains_to_check
            }

            for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
                try:
                    record = future.result()
                    self.save_to_database(record)

                    status = "✓ M365" if record.uses_m365 else "✗"
                    if record.uses_m365:
                        m365_count += 1

                    print(f"[{i}/{len(domains_to_check)}] {record.domain}: {status}")

                except Exception as e:
                    domain, _ = futures[future]
                    print(f"[ERROR] {domain}: {e}")

        print(f"\n[HOTOVO] Nájdených {m365_count} firiem používajúcich M365")

    def process_single_domain(self, domain: str):
        """Kontrola jednej domény"""
        record = self.check_domain(domain)
        self.save_to_database(record)

        print(f"\n{'='*50}")
        print(f"Doména: {record.domain}")
        print(f"Používa M365: {'ÁNO ✓' if record.uses_m365 else 'NIE ✗'}")
        print(f"MX záznamy: {record.mx_records}")
        print(f"SPF obsahuje Microsoft: {'Áno' if record.spf_has_microsoft else 'Nie'}")
        print(f"{'='*50}\n")

        return record

    def export_m365_prospects(self, output_path: str = "m365_prospects.csv"):
        """Export M365 prospektov do CSV"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT domain, company_name, mx_records, spf_has_microsoft,
                   checked_at, country, industry, contact_email, notes
            FROM prospects
            WHERE uses_m365 = TRUE
            ORDER BY checked_at DESC
        """)

        rows = cursor.fetchall()
        conn.close()

        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                'domain', 'company_name', 'mx_records', 'spf_has_microsoft',
                'checked_at', 'country', 'industry', 'contact_email', 'notes'
            ])
            writer.writerows(rows)

        print(f"[OK] Exportovaných {len(rows)} M365 prospektov do {output_path}")

    def get_stats(self):
        """Štatistiky databázy"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM prospects")
        total = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM prospects WHERE uses_m365 = TRUE")
        m365 = cursor.fetchone()[0]

        conn.close()

        print(f"\n{'='*40}")
        print(f"ŠTATISTIKY DATABÁZY")
        print(f"{'='*40}")
        print(f"Celkom domén: {total}")
        print(f"Používa M365: {m365}")
        print(f"Nepoužíva M365: {total - m365}")
        if total > 0:
            print(f"Pomer M365: {m365/total*100:.1f}%")
        print(f"{'='*40}\n")


def main():
    parser = argparse.ArgumentParser(
        description="M365 Prospector - Nájdi firmy používajúce Microsoft 365"
    )

    subparsers = parser.add_subparsers(dest="command", help="Dostupné príkazy")

    # Check single domain
    check_parser = subparsers.add_parser("check", help="Skontroluj jednu doménu")
    check_parser.add_argument("domain", help="Doména na kontrolu")

    # Process CSV
    csv_parser = subparsers.add_parser("csv", help="Spracuj domény z CSV")
    csv_parser.add_argument("file", help="Cesta k CSV súboru")
    csv_parser.add_argument("--domain-col", default="domain", help="Názov stĺpca s doménou")
    csv_parser.add_argument("--company-col", default="company", help="Názov stĺpca s názvom firmy")
    csv_parser.add_argument("--workers", type=int, default=10, help="Počet paralelných workerov")

    # Export
    export_parser = subparsers.add_parser("export", help="Exportuj M365 prospekty")
    export_parser.add_argument("--output", default="m365_prospects.csv", help="Výstupný súbor")

    # Stats
    subparsers.add_parser("stats", help="Zobraz štatistiky")

    # Demo
    subparsers.add_parser("demo", help="Demo s ukážkovými doménami")

    parser.add_argument("--db", default="prospects.db", help="Cesta k databáze")

    args = parser.parse_args()

    prospector = M365Prospector(db_path=args.db)

    if args.command == "check":
        prospector.process_single_domain(args.domain)

    elif args.command == "csv":
        prospector.process_domains_from_csv(
            args.file,
            domain_column=args.domain_col,
            company_column=args.company_col,
            max_workers=args.workers
        )

    elif args.command == "export":
        prospector.export_m365_prospects(args.output)

    elif args.command == "stats":
        prospector.get_stats()

    elif args.command == "demo":
        print("\n[DEMO] Kontrolujem ukážkové domény...\n")
        demo_domains = [
            ("microsoft.com", "Microsoft"),
            ("google.com", "Google"),
            ("amazon.com", "Amazon"),
            ("github.com", "GitHub"),
            ("linkedin.com", "LinkedIn"),
        ]
        for domain, company in demo_domains:
            record = prospector.check_domain(domain, company)
            prospector.save_to_database(record)
            status = "✓ M365" if record.uses_m365 else "✗ Iný provider"
            print(f"  {company} ({domain}): {status}")

        print("\n")
        prospector.get_stats()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
