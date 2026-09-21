/**
 * Abstrakce nad filesystemem.
 *
 *  - V Tauri: vlastni Rust commandy (read_file / write_file) + dialog plugin.
 *  - V prohlizeci: File System Access API (fallback pro vyvoj a testovani).
 *
 * Diky teto vrstve jde cely frontend ladit v obycejnem Chrome bez Tauri buildu.
 */

export interface LoadedFile {
  path: string;
  content: string;
  /** Puvodni soubor mel CRLF konce radku - pri ulozeni je zachovame. */
  crlf: boolean;
  /** Obsah nebyl validni UTF-8 a nacetl se se ztratou. */
  lossy: boolean;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/* ------------------------------------------------------------------ */
/* Web fallback                                                        */
/* ------------------------------------------------------------------ */

const webHandles = new Map<string, FileSystemFileHandle>();

function hasFilePicker(): boolean {
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}

/* ------------------------------------------------------------------ */
/* Verejne API                                                         */
/* ------------------------------------------------------------------ */

export async function readFile(path: string): Promise<LoadedFile> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LoadedFile>('read_file', { path });
  }
  const handle = webHandles.get(path);
  if (!handle) throw new Error(`Soubor není otevřen: ${path}`);
  const file = await handle.getFile();
  const text = await file.text();
  const crlf = text.includes('\r\n');
  return { path, content: crlf ? text.replace(/\r\n/g, '\n') : text, crlf, lossy: false };
}

export async function writeFile(path: string, content: string, crlf: boolean): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_file', { path, content, crlf });
    return;
  }
  const handle = webHandles.get(path);
  if (!handle) throw new Error(`Soubor není otevřen: ${path}`);
  const writable = await handle.createWritable();
  await writable.write(crlf ? content.replace(/\n/g, '\r\n') : content);
  await writable.close();
}

/** Otevre dialog a vrati cestu (Tauri) nebo klic handlu (web). */
export async function pickOpenPath(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    return typeof selected === 'string' ? selected : null;
  }
  if (!hasFilePicker()) {
    throw new Error('Prohlížeč nepodporuje File System Access API.');
  }
  const picker = (window as unknown as {
    showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker;
  const [handle] = await picker({
    multiple: false,
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
  });
  if (!handle) return null;
  webHandles.set(handle.name, handle);
  return handle.name;
}

export async function pickSavePath(defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    return selected ?? null;
  }
  if (!hasFilePicker()) return null;
  const picker = (window as unknown as {
    showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  const handle = await picker({
    suggestedName: defaultPath ?? 'dokument.md',
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
  });
  webHandles.set(handle.name, handle);
  return handle.name;
}

/** Cesta predana pres argv pri studenem startu; jednorazove odebere z fronty. */
export async function takePendingFile(): Promise<string | null> {
  if (!isTauri) {
    // Pro vyvoj: ?file=... nacte ukazkovy dokument z dev serveru
    return null;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<string | null>('take_pending_file');
}

/** Druhe spusteni appky (dvojklik na dalsi .md) posle cestu sem. */
export async function onOpenFile(cb: (path: string) => void): Promise<void> {
  if (!isTauri) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<string>('open-file', (e) => cb(e.payload));
}

export async function setWindowTitle(title: string): Promise<void> {
  if (!isTauri) {
    document.title = title;
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

/** Zavolá cb misto zavreni okna; cb rozhodne, zda se ma opravdu zavrit. */
export async function onCloseRequested(cb: () => Promise<boolean>): Promise<void> {
  if (!isTauri) {
    window.addEventListener('beforeunload', (e) => {
      // V prohlizeci jen standardni "opravdu odejit?"
      if (!document.body.dataset.clean) {
        e.preventDefault();
      }
    });
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    const allow = await cb();
    if (!allow) event.preventDefault();
  });
}

/** Zavre okno aplikace (posledni tab byl zavren). */
export async function closeWindow(): Promise<void> {
  if (!isTauri) {
    window.close();
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().destroy();
}

export async function confirmDiscard(name: string): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return await ask(`Soubor „${name}" má neuložené změny. Zahodit je?`, {
      title: 'Neuložené změny',
      kind: 'warning',
      okLabel: 'Zahodit',
      cancelLabel: 'Zrušit',
    });
  }
  return window.confirm(`Soubor „${name}" má neuložené změny. Zahodit je?`);
}

/** Potvrzeni pri zavirani okna s vice rozpracovanymi dokumenty. */
export async function confirmDiscardAll(count: number): Promise<boolean> {
  const text =
    count === 1
      ? 'Jeden dokument má neuložené změny. Zavřít i tak?'
      : `${count} dokumenty mají neuložené změny. Zavřít i tak?`;
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return await ask(text, {
      title: 'Neuložené změny',
      kind: 'warning',
      okLabel: 'Zavřít',
      cancelLabel: 'Zrušit',
    });
  }
  return window.confirm(text);
}
