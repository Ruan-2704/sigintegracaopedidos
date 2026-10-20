// Corrige UTF-8 interpretado como Windows-1252 apenas nos textos de apresentação.
const windows1252 = new TextDecoder('windows-1252');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const bytesPorCaractere = new Map<string, number>();
for (let byte = 128; byte < 160; byte++) {
  bytesPorCaractere.set(windows1252.decode(new Uint8Array([byte])), byte);
}

export function corrigirCodificacaoTexto(value: unknown): string {
  return String(value ?? '').replace(/[^\s]+/g, (palavra) => {
    let texto = palavra;
    for (let tentativa = 0; tentativa < 6 && /[ÃÂâ]/.test(texto); tentativa++) {
      const bytes: number[] = [];
      for (const caractere of texto) {
        const byte = bytesPorCaractere.get(caractere) ?? caractere.charCodeAt(0);
        if (byte > 255) return texto;
        bytes.push(byte);
      }
      try {
        const corrigido = utf8.decode(new Uint8Array(bytes));
        if (corrigido === texto) break;
        texto = corrigido;
      } catch { break; }
    }
    return texto;
  });
}
