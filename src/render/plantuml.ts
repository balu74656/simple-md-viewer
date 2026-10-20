import { deflateRaw } from 'pako';
import { isTauri } from '../fs/bridge';

/**
 * PlantUML pouziva vlastni base64 abecedu (poradi znaku se lisi od standardu).
 * Postup: text -> UTF-8 -> deflate raw -> encode6bit.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode6bit(b: number): string {
  return ALPHABET[b & 0x3f];
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

function encode64(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      out += append3bytes(data[i], data[i + 1], 0);
    } else if (i + 1 === data.length) {
      out += append3bytes(data[i], 0, 0);
    } else {
      out += append3bytes(data[i], data[i + 1], data[i + 2]);
    }
  }
  return out;
}

/** Zakoduje zdroj diagramu do PlantUML URL fragmentu. */
export function encodePlantUml(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const compressed = deflateRaw(bytes, { level: 9 });
  return encode64(compressed);
}

/**
 * Text, ktery se posila na server. Zdroj nemusi obsahovat @startuml/@enduml -
 * server si poradi s obojim, ale doplnujeme je, aby fungovaly i bloky psane
 * bez nich. `lineOffset` = kolik radku jsme pridali pred zdroj (pro mapovani
 * cisla chybneho radku zpet do editoru).
 */
export function plantUmlBody(source: string): { body: string; lineOffset: number } {
  return /@start\w+/.test(source)
    ? { body: source, lineOffset: 0 }
    : { body: `@startuml\n${source}\n@enduml`, lineOffset: 1 };
}

/** Sestavi URL obrazku. Vraci null, kdyz server neni nakonfigurovan. */
export function plantUmlUrl(
  source: string,
  server: string,
  format: 'svg' | 'png',
): string | null {
  if (!server) return null;
  return `${server}/${format}/${encodePlantUml(plantUmlBody(source).body)}`;
}

export interface PlantUmlError {
  /** Cislo radku v textu poslanem na server, od 1. */
  line: number;
  message: string;
}

/**
 * Zeptá se serveru na syntaxi diagramu. Server pri chybe vraci hlavicky
 * X-PlantUML-Diagram-Error a X-PlantUML-Diagram-Error-Line.
 *
 * V Tauri jde dotaz pres Rust: prohlizec by bez Access-Control-Expose-Headers
 * na serveru vlastni hlavicky neprecetl. V prohlizeci (vyvoj) zkousime fetch.
 * Vraci null, kdyz je diagram v poradku. Vyjimka = server nedostupny.
 */
export async function checkPlantUml(body: string, server: string): Promise<PlantUmlError | null> {
  const url = `${server}/svg/${encodePlantUml(body)}`;
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<PlantUmlError | null>('plantuml_check', { url });
  }
  const res = await fetch(url);
  const message = res.headers.get('X-PlantUML-Diagram-Error');
  if (!message) return null;
  return { line: Number(res.headers.get('X-PlantUML-Diagram-Error-Line')) || 1, message };
}
