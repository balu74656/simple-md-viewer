; Hooky NSIS instalatoru (bundle.windows.nsis.installerHooks v tauri.conf.json).
;
; Ikony podle typu souboru. Tauri zapise pro kazdou asociaci jako DefaultIcon
; ikonu exe, vlastni ikonu pro typ nastavit neumi. Po instalaci ji proto
; prepiseme na .ico, ktere se instaluji jako resources do $INSTDIR\filetypes.
;
; Klic tridy = "name" asociace v tauri.conf.json, vsechny pripony skupiny
; (.md, .markdown, ...) sdileji jednu tridu, a tedy i ikonu. Pri prejmenovani
; asociace je nutne upravit i tenhle soubor. Odinstalace tridy maze cele,
; vcetne DefaultIcon, takze hook pro odinstalaci neni potreba.
;
; Zdroj ikon: scripts/build-file-icons.mjs

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Markdown Document\DefaultIcon" "" "$\"$INSTDIR\filetypes\md.ico$\""
  WriteRegStr SHCTX "Software\Classes\PlantUML Diagram\DefaultIcon" "" "$\"$INSTDIR\filetypes\puml.ico$\""
  WriteRegStr SHCTX "Software\Classes\YAML Document\DefaultIcon" "" "$\"$INSTDIR\filetypes\yaml.ico$\""
  WriteRegStr SHCTX "Software\Classes\JSON Document\DefaultIcon" "" "$\"$INSTDIR\filetypes\json.ico$\""

  ; Pruzkumnik si ikony cachuje, SHCNE_ASSOCCHANGED ho donuti je nacist znovu
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
