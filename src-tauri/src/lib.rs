use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

/// Cesta predana pres argv, nez se stihl nacist frontend.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

#[derive(Serialize)]
struct LoadedFile {
    path: String,
    content: String,
    /// Puvodni soubor pouzival CRLF - pri ulozeni je vratime zpet.
    crlf: bool,
    /// Obsah nebyl validni UTF-8 a byl nacten se ztratou.
    lossy: bool,
}

/// Vytahne z argv prvni argument, ktery vypada jako cesta k souboru.
fn path_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
        .cloned()
}

#[tauri::command]
fn read_file(path: String) -> Result<LoadedFile, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Čtení selhalo: {e}"))?;

    let (text, lossy) = match String::from_utf8(bytes.clone()) {
        Ok(s) => (s, false),
        Err(_) => (String::from_utf8_lossy(&bytes).into_owned(), true),
    };

    // BOM by se jinak objevil jako neviditelny znak na zacatku dokumentu.
    let text = text.strip_prefix('\u{feff}').map(str::to_owned).unwrap_or(text);

    let crlf = text.contains("\r\n");
    let content = if crlf { text.replace("\r\n", "\n") } else { text };

    Ok(LoadedFile {
        path,
        content,
        crlf,
        lossy,
    })
}

#[tauri::command]
fn write_file(path: String, content: String, crlf: bool) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dir = target
        .parent()
        .ok_or_else(|| "Neplatná cesta k souboru".to_string())?;

    let body = if crlf {
        content.replace('\n', "\r\n")
    } else {
        content
    };

    // Zapis pres docasny soubor + rename: pad uprostred zapisu
    // nesmi poskodit puvodni dokument. fs::rename na Windows i Linuxu
    // existujici cil prepise.
    let stem = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("dokument");
    let tmp = dir.join(format!(".{stem}.mdviewer.tmp"));

    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("Zápis selhal: {e}"))?;

    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Uložení selhalo: {e}"));
    }
    Ok(())
}

#[tauri::command]
fn take_pending_file(state: State<'_, PendingFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Druhe spusteni (dvojklik na dalsi .md) nezaklada novy proces -
    // jen posle cestu do uz beziciho okna a vytahne ho dopredu.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                if let Some(path) = path_from_args(&argv) {
                    let _ = app.emit("open-file", path);
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFile::default())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = path_from_args(&args) {
                if let Some(state) = app.try_state::<PendingFile>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(path);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            take_pending_file
        ])
        .run(tauri::generate_context!())
        .expect("chyba při startu aplikace");
}
