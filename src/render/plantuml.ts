import { deflateRaw } from 'pako';

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
 * Sestavi URL obrazku. Vraci null, kdyz server neni nakonfigurovan.
 * Zdroj nemusi obsahovat @startuml/@enduml - server si poradi s obojim,
 * ale doplnujeme je, aby fungovaly i bloky psane bez nich.
 */
export function plantUmlUrl(
  source: string,
  server: string,
  format: 'svg' | 'png',
): string | null {
  if (!server) return null;
  const body = /@start\w+/.test(source) ? source : `@startuml\n${source}\n@enduml`;
  return `${server}/${format}/${encodePlantUml(body)}`;
}
