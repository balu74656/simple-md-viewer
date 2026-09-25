# Changelog

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování ze [semver](https://semver.org/lang/cs/).

Historie Gitu začíná u 0.3.0 — starší verze jsou zaznamenané zpětně,
jejich zdrojový kód v repozitáři není.

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
