-- Migration 006: Fix Slovak holiday names - add proper diacritics (mäkčene a dĺžne)

UPDATE holidays SET name = 'Deň vzniku Slovenskej republiky' WHERE name = 'Den vzniku Slovenskej republiky';
UPDATE holidays SET name = 'Zjavenie Pána' WHERE name = 'Zjavenie Pana';
UPDATE holidays SET name = 'Veľký piatok' WHERE name = 'Velky piatok';
UPDATE holidays SET name = 'Veľkonočný pondelok' WHERE name = 'Velkonocny pondelok';
UPDATE holidays SET name = 'Sviatok práce' WHERE name = 'Sviatok prace';
UPDATE holidays SET name = 'Deň víťazstva nad fašizmom' WHERE name = 'Den vitazstva nad fasizmom';
UPDATE holidays SET name = 'Sviatok sv. Cyrila a Metoda' WHERE name = 'Sviatok sv. Cyrila a Metoda';
UPDATE holidays SET name = 'Výročie SNP' WHERE name = 'Vyrocie SNP';
UPDATE holidays SET name = 'Deň Ústavy SR' WHERE name = 'Den Ustavy SR';
UPDATE holidays SET name = 'Sedembolestná Panna Mária' WHERE name = 'Sedembolestna Panna Maria';
UPDATE holidays SET name = 'Sviatok všetkých svätých' WHERE name = 'Sviatok vsetkych svatych';
UPDATE holidays SET name = 'Deň boja za slobodu a demokraciu' WHERE name = 'Den boja za slobodu a demokraciu';
UPDATE holidays SET name = 'Štedrý deň' WHERE name = 'Stedry den';
UPDATE holidays SET name = 'Prvý sviatok vianočný' WHERE name = 'Prvy sviatok vianocny';
UPDATE holidays SET name = 'Druhý sviatok vianočný' WHERE name = 'Druhy sviatok vianocny';
