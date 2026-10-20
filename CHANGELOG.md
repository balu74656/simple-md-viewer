# Changelog

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování ze [semver](https://semver.org/lang/cs/).

Historie Gitu začíná u 0.3.0 — starší verze jsou zaznamenané zpětně,
jejich zdrojový kód v repozitáři není.

## [0.6.0]

### Přidáno

- **OpenAPI / Swagger náhled.** Soubory `.yaml`, `.yml` a `.json` se
  specifikací OpenAPI 3.0/3.1 nebo Swagger 2.0 se v náhledu zobrazí jako
  dokumentace ve stylu Swagger UI (jen ke čtení): operace podle tagů,
  rozbalovací detail s parametry, tělem požadavku a odpověďmi, přepínač
  Příklad / Schéma, sekce Autorizace a Schémata. Klik na název schématu
  skočí na jeho definici.
- **Externí `$ref`.** Odkazy do jiných souborů (`common.yaml#/...`) se
  načtou relativně k souboru, ve kterém stojí.
- **Zvýraznění YAML a JSON v editoru.** Při psaní ve Split režimu zůstane
  rozbalené, co bylo rozbalené; rozbitý OpenAPI soubor ukáže chybu s číslem
  řádku. Jiný YAML/JSON se v náhledu zobrazí jako zvýrazněný kód.
- Asociace `.yaml`, `.yml` a `.json` s aplikací v instalátoru.

## [0.5.1]

### Opraveno

- **Kontrola syntaxe PlantUML označovala o řádek výš.** plantuml-server
  (běžná firemní instalace i plantuml.com) posílá číslo chybného řádku od 0,
  PicoWeb z `plantuml.jar` od 1. Aplikace teď rozliší server podle hlavičky
  `Server` a značka sedí na správném řádku u obou.

## [0.5.0]

### Přidáno

- **Zoom diagramů.** Klik na PlantUML nebo Mermaid diagram (samostatný `.puml`
  i blok v Markdownu) ho otevře přes celé okno. Kolečko zoomuje ke kurzoru,
  tažení posouvá, pinch na touchpadu, dvojklik vrátí velikost okna. Ovládání
  i z klávesnice (`+`, `−`, `0`, `1`, šipky, `Esc`).
- **Zvýraznění PlantUML v editoru** — v `.puml` souborech i v blocích
  ```` ```plantuml ```` / ```` ```puml ```` uvnitř Markdownu.
- **Kontrola syntaxe PlantUML.** Sekundu po psaní se diagramy ověří na
  nastaveném serveru. Chybný řádek je podtržený a označený v okraji, text
  chyby v tooltipu, stav ve stavovém řádku (klik skočí na chybu).

### Změněno

- Rust část má nově závislost `reqwest` (native-tls + systémová proxy) pro
  dotaz na PlantUML server.

## [0.4.0]

### Přidáno

- **Samostatné PlantUML soubory.** `.puml`, `.plantuml`, `.pu` a `.iuml` se
  v náhledu vykreslí rovnou jako diagram přes nastavený PlantUML server,
  místo aby se zobrazily jako Markdown text. Soubor s více páry
  `@startuml … @enduml` se vykreslí jako víc diagramů pod sebou.
- Instalátor registruje tyto přípony, takže se otevírají dvojklikem.
- Dialog **Otevřít** nabízí Markdown i PlantUML soubory.

### Změněno

- **Uložit jako** u PlantUML souboru předvolí filtr PlantUML. Změna přípony
  přes *Uložit jako* přepne i způsob vykreslení náhledu.

## [0.3.1]

### Přidáno

- **Nativní instalátor pro ARM Windows.** Release workflow staví matici dvou
  architektur — x64 na `windows-latest`, ARM64 nativně na `windows-11-arm`.
  Bez cross-compilace, takže odpadá ARM64 komponenta v MSVC i `rustup target add`.
  Joby běží sériově, aby se nepraly o tentýž Release.

### Změněno

- README a popis vydání rozlišují x64 a ARM64 včetně toho, jak zjistit,
  co má člověk za procesor.

## [0.3.0]

### Přidáno

- **Taby.** Každý dokument je samostatný tab. Per tab se drží obsah, undo
  historie, režim View/Edit/Split, pozice scrollu v obou panelech, stav
  neuložených změn i rozepsaný dotaz ve vyhledávání.
- Lišta tabů se objeví až u druhého otevřeného dokumentu.
- Otevření souboru, který už otevřený je, přepne na jeho tab místo založení
  druhého. Porovnání cest nezávisí na velikosti písmen ani směru lomítek.
- Zkratky `Ctrl+T`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+1`–`9`; tab zavírá i prostřední
  tlačítko myši.
- Zavření okna s více rozepsanými dokumenty se zeptá jednou se souhrnem.
- `npm run set-version` — nastaví verzi naráz v `package.json`,
  `tauri.conf.json` i `Cargo.toml`.

### Změněno

- Výchozí PlantUML server se bere z build-time proměnné `VITE_PLANTUML_SERVER`
  (viz `.env.example`), v repozitáři žádná konkrétní URL není.
- Identifikátor aplikace na `io.github.balu74656.mdviewer`.
- Instalátor je anglicky. S češtinou v `nsis.languages` neměly přepínače na
  stránce instalace žádné popisky — Tauri vlastní hlášky česky nedodává.

## [0.2.0]

### Přidáno

- **Editor postavený na CodeMirror 6**: čísla řádků, zvýraznění Markdownu
  i obsahu fenced bloků podle jazyka, undo historie, odsazování Tabem.
- Volba zalamování dlouhých řádků v Nastavení.

### Opraveno

- **Editační režim byl vysoký jeden řádek.** Skrytý `#findbar` uvolnil svůj
  grid řádek a zbylé prvky se posunuly — `#workspace` dostal `auto` místo `1fr`
  a stavový řádek spolkl zbytek okna. Každý prvek má teď svůj řádek přiřazený
  napevno.

## [0.1.0]

První verze. Tauri 2 + WebView2, registrace jako výchozí aplikace pro `.md`.

### Přidáno

- Režimy View / Edit / Split se synchronním scrollem.
- GFM, zvýraznění syntaxe, Mermaid, PlantUML, KaTeX.
- Osnova dokumentu se sledováním aktivní sekce, hledání, tmavý a světlý motiv.
- Atomický zápis souboru, zachování konců řádků a odstranění BOM.
- Jediná instance aplikace — další dvojklik převezme otevřené okno.

### Opraveno před vydáním

Tři chyby, které našla automatická verifikace:

- Mermaid diagramy se šipkou `-->` se vykreslovaly jako prázdné místo.
  DOMPurify 3.1+ kvůli ochraně proti mXSS zahazuje atributy, jejichž hodnota
  tuto dvojici znaků obsahuje. Zdroje diagramů se proto předávají mimo HTML.
- Task listy neměly zaškrtávátka — formulářové prvky byly zakázané plošně.
- Při skryté osnově se panely ve splitu rozdělily v poměru 1:4 místo na půl.
