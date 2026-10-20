function criarConsultaArquivo(bucket, formatar) {
  const cache = new Map(), pendentes = new Map();
  async function buscar(nome, force = false) {
    if (!/^[a-zA-Z0-9_.-]{1,150}\.json$/.test(String(nome))) throw Object.assign(new Error('Nome de arquivo inválido.'), { status: 400 });
    const atual = cache.get(nome);
    if (!force && atual && Date.now() - atual.ts < 60000) return atual.data;
    if (pendentes.has(nome)) return pendentes.get(nome);
    const consulta = (async () => {
      let data;
      try { const [metadata] = await bucket.file(nome).getMetadata(); data = [formatar({ name: nome, metadata })]; }
      catch (e) { if (Number(e.code) !== 404) throw e; data = []; }
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(nome, { ts: Date.now(), data }); return data;
    })();
    pendentes.set(nome, consulta);
    try { return await consulta; } finally { pendentes.delete(nome); }
  }
  return { buscar, invalidar: nome => cache.delete(nome) };
}
module.exports = { criarConsultaArquivo };
