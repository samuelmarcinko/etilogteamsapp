-- 037: vlastné položky kód mať nemusia
--
-- Kód je identifikátor niečoho, čo sa dá niekde vyhľadať. `RM102750` sa dá
-- nájsť v SAPe. `POLICE-FG100866` sa nedá nájsť nikde - to je reťazec, ktorý
-- sme si vymysleli, a prvý, kto ho uvidí v stĺpci „Kód", ho pôjde hľadať do
-- SAPu a nenájde.
--
-- Poznámka skladu žiadny identifikátor nemá a nepotrebuje. Nesie dve veci:
-- ku ktorému projektu patrí (`project_fg`) a čo to je (`name`). Obe už majú
-- svoj stĺpec.
--
-- Vedľajší zisk: kód, ktorý neexistuje, nemôže kolidovať. Dve poznámky o
-- policiach k tomu istému projektu môžu pokojne existovať vedľa seba, bez
-- POLICE-2 a podobných výmyslov.
--
-- Položky zo SAPu kód majú vždy - je to ich kód v SAPe. Vynútiť sa to však
-- nedá databázovým obmedzením bez toho, aby sa nedali uložiť rozrobené riadky,
-- tak to stráži aplikácia pri zápise.

ALTER TABLE materials ALTER COLUMN code DROP NOT NULL;

-- Kontrola duplicity beží nad LOWER(code) a NULL sa v nej nikdy nezhoduje sám
-- so sebou, takže žiadny index netreba meniť. Tento je tu len na to, aby sa
-- vlastné položky bez kódu dali rýchlo vyhľadať podľa projektu - stĺpec
-- project_fg indexovala už 036, takže sa tu nič nepridáva a nič neduplikuje.
