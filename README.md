# MD Viewer

Jednoduchý Markdown viewer/editor pro Windows. Postavený na **Tauri 2** (WebView2),
takže se registruje jako nativní aplikace pro `.md` soubory a jde nastavit jako výchozí.

Po otevření souboru se dokument zobrazí v režimu **View**.

---

## Build

### Jednorázová příprava prostředí

1. **Node.js 20+** — https://nodejs.org
2. **Rust toolchain** — https://rustup.rs (ve Windows stáhni `rustup-init.exe`)
3. **Visual Studio Build Tools** s workloadem *Desktop development with C++*
   (stačí komponenty MSVC + Windows SDK) — https://visualstudio.microsoft.com/visual-cpp-build-tools/
4. **WebView2** — na Windows 11 je součástí systému, na Win10 doinstaluje installer sám.

Ověření:

```powershell
node -v
cargo --version
```

### Sestavení

```powershell
npm install
npm run tauri:build
```

Výsledek: `src-tauri\target\release\bundle\nsis\MD Viewer_0.1.0_x64-setup.exe`

Vývojový režim s hot reloadem:

```powershell
npm run tauri:dev
```

---

## Vydání nové verze

```powershell
npm run set-version 0.3.1
git commit -am "0.3.1"
git tag v0.3.1
git push --follow-tags
```

Push tagu `v*` spustí workflow **release**: Windows runner sestaví instalátor
a vyvěsí ho do [Releases](https://github.com/balu74656/simple-md-viewer/releases).
První běh trvá ~8 minut, další díky cache Rustu ~3. Ručně jde spustit i bez tagu
přes *Actions → release → Run workflow*.

Lokální build bez vydání:

```powershell
npm run set-version 0.3.1
npm run tauri:build
```

Verze žije ve **třech souborech** a musí si odpovídat — `package.json`,
`src-tauri/tauri.conf.json` (z té se generuje název instalátoru) a
`src-tauri/Cargo.toml`. Skript `scripts/set-version.mjs` přepíše všechny tři
a odmítne vstup, který není semver.

> Nezkoušej `"version": "../package.json"` v `tauri.conf.json`. Schéma to sice
> dovoluje, ale relativní cesta se vyhodnocuje jinak, než by člověk čekal —
> build pak projde a vyrobí instalátor se starým číslem verze, aniž by varoval.

Bez bumpu vznikne instalátor se stejným názvem jako ten předchozí a v
*Nastavení → Aplikace* nepoznáš, která verze je nainstalovaná.

---

## Nastavení jako výchozí aplikace pro `.md`

Installer zapíše asociaci do registru, Windows si ale výchozí aplikaci nechává
potvrdit uživatelem:

1. Nainstaluj `.exe` z `bundle\nsis\`.
2. Pravý klik na libovolný `.md` soubor → **Otevřít v programu** → **Zvolit jinou aplikaci**
3. Vyber **MD Viewer** a zaškrtni **Vždy používat tuto aplikaci**.

Alternativně: *Nastavení → Aplikace → Výchozí aplikace → Zvolit výchozí podle typu souboru → `.md`*

Podporované přípony: `.md`, `.markdown`, `.mdown`, `.mkd`

> Installer není podepsaný, takže při první instalaci vyskočí SmartScreen.
> Přes **Další informace → Přesto spustit**.

### Proč je instalátor anglicky

`bundle.windows.nsis.languages` je nastaven na `["English"]` záměrně. S `"Czech"`
sice NSIS přeloží vlastní tlačítka, ale **vlastní hlášky Tauri do češtiny přeložené
nejsou** — přepínače na stránce instalace pak nemají žádný popisek a instalátor je
nepoužitelný. Build na to upozorňuje hláškou *„Custom tauri messages for Czech are
not translated"*.

Češtinu lze doplnit přes `bundle.windows.nsis.customLanguageFiles` vlastním `.nsh`
souborem s překlady, ale pro interní nástroj to nestojí za údržbu.

---

## Klávesové zkratky

| Zkratka | Akce |
|---|---|
| `Ctrl+O` | Otevřít soubor v novém tabu |
| `Ctrl+T` | Nový prázdný tab |
| `Ctrl+W` | Zavřít tab (poslední zavře okno) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Další / předchozí tab |
| `Ctrl+1`–`8`, `Ctrl+9` | Skok na N-tý / poslední tab |
| `Ctrl+S` | Uložit |
| `Ctrl+Shift+S` | Uložit jako |
| `Ctrl+E` | Přepnout View / Edit |
| `Ctrl+\` | Přepnout Split |
| `Ctrl+F` | Hledat (Enter / Shift+Enter = další / předchozí) |
| `Ctrl+Shift+O` | Osnova (TOC) |
| `Esc` | Zavřít vyhledávání |

Tab zavírá i prostřední tlačítko myši.

---

## Taby

Každý otevřený dokument je samostatný tab. **Per tab** si aplikace pamatuje obsah,
undo historii, režim View/Edit/Split, pozici scrollu v obou panelech, stav
neuložených změn i rozepsaný dotaz ve vyhledávání. Globální zůstává motiv,
nastavení a otevřenost panelu osnovy.

Lišta tabů se zobrazí, teprve když jsou otevřené alespoň dva dokumenty — při
běžném dvojkliku na jeden soubor tak nepřekáží.

Otevření souboru, který už otevřený je, **nezaloží druhý tab**, jen přepne na ten
stávající. Porovnání cest je case-insensitive a nezávislé na směru lomítek, takže
`C:\Docs\a.md` a `c:/docs/A.MD` jsou týž soubor. Dva taby nad jedním souborem by
znamenaly, že po uložení z jednoho drží druhý zastaralý obsah.

### Jak je to postavené

Editor je **jedna instance CodeMirroru a N stavů** — `EditorState` nese obsah
i undo historii, takže přepnutí tabu je `view.setState(tab.editorState)`.
Pozor: compartmenty (motiv, zalamování) patří stavu, ne pohledu, proto se po
každém přepnutí znovu aplikují na nově aktivní stav.

Náhled má **vlastní DOM uzel na tab**, neaktivní jsou skryté. Přepnutí tak
nevyžaduje překreslení — u dokumentu s desítkami diagramů by to bylo přes půl
sekundy čekání pokaždé. Cena je paměť, řádově jednotky MB na otevřený dokument.

Relace se mezi spuštěními **nepamatuje** záměrně: u aplikace, která je výchozí
pro `.md`, chceš po dvojkliku vidět ten soubor, na který jsi klikl.

---

## Editor

Editační režim běží na **CodeMirror 6**: čísla řádků, zvýraznění Markdown syntaxe
(včetně obsahu fenced bloků podle jazyka), undo/redo historie a odsazování Tabem.

Zalamování dlouhých řádků se přepíná v **Nastavení** — vypnuté se hodí na dokumenty
s širokými tabulkami.

Klávesové zkratky aplikace (`Ctrl+F`, `Ctrl+E`, `Ctrl+S`, …) mají přednost před
klávesovou mapou CodeMirroru; odchytává je posluchač v capture fázi.

---

## Co náhled umí

- **GFM**: tabulky, task listy, strikethrough, autolinky
- **Zvýraznění syntaxe** (highlight.js, common sada jazyků)
- **Mermaid** — bloky ```` ```mermaid ````
- **PlantUML** — bloky ```` ```plantuml ````, ```` ```puml ````, ```` ```uml ````
- **Matematika** — `$inline$` a `$$blok$$` (KaTeX)

PlantUML se renderuje přes server, který si nastavíš v **Nastavení**. Zdroj
diagramu se na něj odesílá — pro citlivou dokumentaci použij interní instanci,
ne veřejnou.

### Předvyplnění PlantUML serveru

V repozitáři není natvrdo žádná konkrétní URL. Pro lokální build si ji dej do
`.env.local` (soubor je v `.gitignore`):

```
VITE_PLANTUML_SERVER=https://plantuml.firma.cz
```

Bez této proměnné aplikace nastartuje s prázdným polem a server si doplníš
v Nastavení — volba se uloží a build-time hodnotu už dál nepotřebuje. Instalátory
sestavené v GitHub Actions ji záměrně nemají, takže z veřejného buildu žádná
interní adresa neodchází. Vzor je v `.env.example`.

---

## Chování při práci se soubory

- **Konce řádků** se zachovávají: soubor s CRLF se uloží zpět s CRLF.
- **BOM** se při čtení odstraní, ukládá se čisté UTF-8.
- **Atomický zápis**: obsah jde nejdřív do dočasného souboru vedle cíle a teprve
  pak se přejmenuje. Pád uprostřed ukládání nepoškodí originál.
- Soubor, který není validní UTF-8, se načte se ztrátou a ve stavovém řádku se objeví varování.
- Při zavření okna s neuloženými změnami se aplikace zeptá.
- Dvojklik na další `.md`, když už aplikace běží, nespustí druhý proces —
  cestu převezme běžící okno (`tauri-plugin-single-instance`).

---

## Struktura projektu

```
src/
  main.ts              wiring: aktivní tab, režimy, zkratky, scroll sync
  tabs.ts              kolekce tabů, lišta, zavírání, duplicity
  settings.ts          persistentní nastavení (localStorage)
  render/
    markdown.ts        marked + highlight.js + sanitizace
    postprocess.ts     lazy render Mermaid / KaTeX / PlantUML
    plantuml.ts        deflate + PlantUML base64 encoder
  ui/
    editor.ts          CodeMirror 6 — fasáda nad editorem
    toc.ts             osnova + scroll-spy
    find.ts            hledání (CSS Custom Highlight API)
    theme.ts           light / dark / auto
  fs/
    bridge.ts          abstrakce Tauri ↔ prohlížeč
src-tauri/
  src/lib.rs           read_file / write_file / take_pending_file, argv, single instance
  tauri.conf.json      fileAssociations, CSP, NSIS bundle
```

### Poznámka k renderování diagramů

Zdroje diagramů **nesmí** cestovat v `data-*` atributu. DOMPurify 3.1+ v rámci
ochrany proti mXSS zahazuje atributy, jejichž hodnota obsahuje `-->`, což potká
prakticky každý Mermaid flowchart. Placeholder proto nese jen ID a skutečný text
si postprocessor vyzvedne z mapy vrácené vedle HTML.

### Poznámka k rozvržení

`#app` i `#workspace` mají **napevno přiřazené grid řádky a sloupce**
(`grid-row` / `grid-column`). Bez toho skrytý prvek (`#findbar`, `#toc`) uvolní
svůj track a zbylé prvky se posunou do cizích — projeví se to jako editor
vysoký jeden řádek nebo rozjetý poměr panelů ve splitu.

---

## Ladění bez Tauri buildu

Frontend běží i v obyčejném Chrome — `bridge.ts` v takovém případě sáhne po
File System Access API:

```powershell
npm run dev
```

Otevři `http://localhost:1420`. Otevírání a ukládání funguje přes prohlížečové
dialogy, zbytek aplikace se chová stejně.

---

## Známá omezení

- Bez podepsaného certifikátu hlásí SmartScreen při instalaci varování.
- PlantUML vyžaduje dostupný server; při výpadku se místo diagramu zobrazí chybový box.
- Sledování změn souboru na disku (auto-reload) zatím není.
- Export do PDF/HTML zatím není.
- Taby nejdou přetahovat a zavřený tab nelze obnovit.
- Otevřené dokumenty se nepamatují mezi spuštěními (záměr, viz výše).
