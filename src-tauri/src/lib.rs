use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

/// Soubory k otevreni, ktere prisly driv, nez si je frontend vyzvedl:
/// z argv (Windows) nebo z Finderu pres Apple Event (macOS).
/// `ready` = frontend uz zavolal take_pending_file a posloucha `open-file`,
/// dalsi soubory se mu tedy posilaji rovnou udalosti.
#[derive(Default)]
struct PendingFile(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    paths: Vec<String>,
    ready: bool,
}

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

#[derive(Serialize)]
struct PlantUmlError {
    /// Radek v textu poslanem na server, od 1.
    line: u32,
    message: String,
}

/// Kontrola syntaxe diagramu na PlantUML serveru. Server chybu hlasi
/// v hlavickach X-PlantUML-Diagram-Error(-Line). Dotaz jde pres Rust, protoze
/// WebView bez Access-Control-Expose-Headers na serveru hlavicky neprecte.
/// native-tls = certifikaty z Windows store, takze projde i firemni CA.
#[tauri::command]
async fn plantuml_check(url: String) -> Result<Option<PlantUmlError>, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Neplatná URL PlantUML serveru".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("PlantUML server nedostupný: {e}"))?;

    let header = |name: &str| {
        res.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let Some(message) = header("X-PlantUML-Diagram-Error") else {
        return Ok(None);
    };
    let pos: u32 = header("X-PlantUML-Diagram-Error-Line")
        .and_then(|l| l.trim().parse().ok())
        .unwrap_or(0);
    // plantuml-server (Jetty/Tomcat, i plantuml.com) posila pozici od 0,
    // PicoWeb vestaveny v plantuml.jar (-picoweb) od 1.
    let picoweb = header("Server").is_some_and(|s| s.contains("PicoWeb"));
    let line = if picoweb { pos.max(1) } else { pos + 1 };
    Ok(Some(PlantUmlError { line, message }))
}

/// Frontend zavola jednou pri startu, az po registraci posluchace `open-file`.
/// Prvni soubor vrati, pripadne dalsi (vic souboru naraz z Finderu) posle
/// udalosti.
#[tauri::command]
fn take_pending_file(app: tauri::AppHandle, state: State<'_, PendingFile>) -> Option<String> {
    let paths = match state.0.lock() {
        Ok(mut guard) => {
            guard.ready = true;
            std::mem::take(&mut guard.paths)
        }
        Err(_) => return None,
    };
    let mut paths = paths.into_iter();
    let first = paths.next();
    for path in paths {
        let _ = app.emit("open-file", path);
    }
    first
}

/// Soubor otevreny za behu: frontend uz posloucha -> udalost, jinak do fronty.
#[cfg(target_os = "macos")]
fn open_or_queue(app: &tauri::AppHandle, path: String) {
    let state = app.state::<PendingFile>();
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if guard.ready {
        drop(guard);
        let _ = app.emit("open-file", path);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
            let _ = window.unminimize();
        }
    } else {
        guard.paths.push(path);
    }
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
                        guard.paths.push(path);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            plantuml_check,
            take_pending_file
        ])
        .build(tauri::generate_context!())
        .expect("chyba při startu aplikace")
        .run(|_app, _event| {
            // macOS nepredava soubor z Finderu (dvojklik, Otevrit v aplikaci)
            // v argv, ale Apple Eventem, ktery Tauri hlasi jako RunEvent::Opened.
            // Prichazi pri studenem startu i za behu.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if path.is_file() {
                            open_or_queue(_app, path.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        });
}
