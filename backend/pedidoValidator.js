function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(',', '.'));
}

function isPositiveNumber(value) {
  const n = toNumber(value);
  return Number.isFinite(n) && n > 0;
}

function normalizarTexto(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function rotuloPrazo(codigo) {
  const texto = cleanText(codigo);
  if (texto === '1') return 'a vista';
  if (texto === '2') return 'a prazo';
  return texto || '-';
}

function inferirCodigoPrazoCampanha(campanha = {}) {
  const entradas = Object.entries(campanha || {});
  const candidatos = entradas
    .filter(([key]) => /prazo|condicao|pagamento|forma|tipo/i.test(key))
    .map(([key, value]) => `${key}: ${value}`)
    .concat([campanha.OPL_DESCRICAO, campanha.DESCRICAO, campanha.NOME].filter(Boolean));

  const texto = normalizarTexto(candidatos.join(' '));

  if (/\b(a\s*vista|avista|vista)\b/.test(texto)) {
    return {
      codigo: '1',
      descricao: 'a vista',
      origem: candidatos.filter(Boolean).slice(0, 3),
    };
  }

  if (/\b(prazo|mensal|boleto|parcel|faturad)\b/.test(texto)) {
    return {
      codigo: '2',
      descricao: 'a prazo',
      origem: candidatos.filter(Boolean).slice(0, 3),
    };
  }

  return null;
}

function safeDbName(name) {
  const db = String(name || '').trim().toLowerCase();

  if (!/^[a-z0-9_]+$/.test(db)) {
    throw new Error('Base/rede inválida. Use apenas letras, números e underscore.');
  }

  return db;
}

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  return undefined;
}

function pushIssue(list, severity, code, field, message, suggestion, extra = {}) {
  list.push({
    severity,
    code,
    field,
    message,
    suggestion,
    ...extra,
  });
}

function normalizePedido(payload) {
  const body = payload || {};
  const info = body.informacoes || body.Informacoes || body.info || {};

  const produtos = Array.isArray(body.produtos)
    ? body.produtos
    : Array.isArray(body.Produtos)
      ? body.Produtos
      : Array.isArray(info.produtos)
        ? info.produtos
        : Array.isArray(info.Produtos)
          ? info.Produtos
          : [];

  return {
    raw: body,
    informacoes: {
      cnpjDistribuidor: firstDefined(info, ['cnpjDistribuidor', 'CnpjDistribuidor', 'cnpjCD', 'CnpjCD']),
      cnpjCliente: firstDefined(info, ['cnpjCliente', 'CnpjCliente']),
      cotacaoCotefacil: firstDefined(info, ['cotacaoCotefacil', 'CotacaoCotefacil']),
      pedidoCotefacil: firstDefined(info, ['pedidoCotefacil', 'PedidoCotefacil', 'pedidoIntegradora', 'pedidoCoteFacil']),
      pedidoCliente: firstDefined(info, ['pedidoCliente', 'PedidoCliente']),
      idCampanha: firstDefined(info, ['idCampanha', 'IdCampanha', 'idCampanhaPc']),
      nomeCampanha: firstDefined(info, ['nomeCampanha', 'NomeCampanha']),
      idOL: firstDefined(info, ['idOL', 'IdOL', 'idOl', 'IdOl']),
      codigoPrazoCd: firstDefined(info, ['codigoPrazoCd', 'CodigoPrazoCd']),
      descricaoPrazoCd: firstDefined(info, ['descricaoPrazoCd', 'DescricaoPrazoCd']),
      quantidadeParcelaPrazo: firstDefined(info, ['quantidadeParcelaPrazo', 'QuantidadeParcelaPrazo']),
      diasParcelaPrazo: firstDefined(info, ['diasParcelaPrazo', 'DiasParcelaPrazo']),
      totalPrazo: firstDefined(info, ['totalPrazo', 'TotalPrazo']),
    },
    produtos: produtos.map((p, index) => ({
      index,
      idItemPedido: firstDefined(p, ['idItemPedido', 'IdItemPedido']),
      ean: firstDefined(p, ['ean', 'EAN']),
      codigoProduto: firstDefined(p, ['codigoProduto', 'CodigoProduto', 'MED_CODIGO', 'medCodigo']),
      descricaoProduto: firstDefined(p, ['descricaoProduto', 'DescricaoProduto', 'MED_NOME', 'medNome']),
      qtdeSolicitada: firstDefined(p, ['qtdeSolicitada', 'QtdeSolicitada', 'quantidadeSolicitada']),
      valorUnitarioProduto: firstDefined(p, ['valorUnitarioProduto', 'ValorUnitarioProduto']),
      descontoComercial: firstDefined(p, ['descontoComercial', 'DescontoComercial']),
      valorDescontoComercial: firstDefined(p, ['valorDescontoComercial', 'ValorDescontoComercial']),
      descontoComercialAdicional: firstDefined(p, ['descontoComercialAdicional', 'DescontoComercialAdicional']),
      valorDescontoComercialAdicional: firstDefined(p, ['valorDescontoComercialAdicional', 'ValorDescontoComercialAdicional']),
      totalDescontosComerciais: firstDefined(p, ['totalDescontosComerciais', 'TotalDescontosComerciais']),
      valorTotalDescontosComerciais: firstDefined(p, ['valorTotalDescontosComerciais', 'ValorTotalDescontosComerciais']),
      valorUnitarioFinalProduto: firstDefined(p, ['valorUnitarioFinalProduto', 'ValorUnitarioFinalProduto']),
      valorUnitarioNFe: firstDefined(p, ['valorUnitarioNFe', 'ValorUnitarioNFe']),
      descontoFinanceiro: firstDefined(p, ['descontoFinanceiro', 'DescontoFinanceiro']),
      valorDescontoFinanceiro: firstDefined(p, ['valorDescontoFinanceiro', 'ValorDescontoFinanceiro']),
      valorUnitarioBoleto: firstDefined(p, ['valorUnitarioBoleto', 'ValorUnitarioBoleto']),
      raw: p,
    })),
  };
}

function validateStructure(normalized) {
  const issues = [];
  const info = normalized.informacoes;

  if (!normalized.raw || typeof normalized.raw !== 'object' || Array.isArray(normalized.raw)) {
    pushIssue(
      issues,
      'erro',
      'JSON_INVALIDO',
      '$',
      'O conteúdo informado precisa ser um objeto JSON.',
      'Cole o JSON completo enviado para /estoque/enviapedido.'
    );

    return issues;
  }

  if (!normalized.raw.informacoes && !normalized.raw.Informacoes && !normalized.raw.info) {
    pushIssue(
      issues,
      'erro',
      'INFORMACOES_AUSENTE',
      'informacoes',
      'Bloco informacoes não encontrado.',
      'Inclua o objeto informacoes no JSON do pedido.'
    );
  }

  const requiredInfo = [
    ['cnpjDistribuidor', 'CNPJ do distribuidor usado para localizar o fornecedor.'],
    ['cnpjCliente', 'CNPJ da loja usado para conferir a farmácia.'],
    ['idCampanha', 'Código da campanha/OL enviado como OPL_CODIGO.'],
    ['idOL', 'Codigo da operacao logistica/OL usado no contexto da integracao.'],
    ['codigoPrazoCd', 'Informe a condicao de pagamento: 1 para a vista ou 2 para a prazo. Com banco ativo, o validador tenta sugerir pela campanha.'],
  ];

  for (const [field, help] of requiredInfo) {
    if (isBlank(info[field])) {
      pushIssue(
        issues,
        'erro',
        'CAMPO_OBRIGATORIO',
        `informacoes.${field}`,
        `${field} não foi informado.`,
        help
      );
    }
  }

  const cnpjDistribuidor = onlyDigits(info.cnpjDistribuidor);
  const cnpjCliente = onlyDigits(info.cnpjCliente);

  if (!isBlank(info.cnpjDistribuidor) && cnpjDistribuidor.length !== 14) {
    pushIssue(
      issues,
      'erro',
      'CNPJ_DISTRIBUIDOR_INVALIDO',
      'informacoes.cnpjDistribuidor',
      'CNPJ do distribuidor deve ter 14 dígitos.',
      'Revise pontuação/dígitos do cnpjDistribuidor.',
      { valorAtual: info.cnpjDistribuidor }
    );
  }

  if (!isBlank(info.cnpjCliente) && cnpjCliente.length !== 14) {
    pushIssue(
      issues,
      'erro',
      'CNPJ_CLIENTE_INVALIDO',
      'informacoes.cnpjCliente',
      'CNPJ do cliente deve ter 14 dígitos.',
      'Revise pontuação/dígitos do cnpjCliente.',
      { valorAtual: info.cnpjCliente }
    );
  }

  if (!Array.isArray(normalized.produtos) || normalized.produtos.length === 0) {
    pushIssue(
      issues,
      'erro',
      'PRODUTOS_AUSENTES',
      'produtos',
      'Lista produtos está vazia ou ausente.',
      'A API Java usa enviaPedidoDTO.getProdutos().get(0). Se produtos vier vazio, gera IndexOutOfBoundsException.'
    );

    return issues;
  }

  normalized.produtos.forEach((produto, index) => {
    const prefix = `produtos[${index}]`;

    if (isBlank(produto.codigoProduto)) {
      pushIssue(
        issues,
        'erro',
        'PRODUTO_SEM_CODIGO',
        `${prefix}.codigoProduto`,
        'Produto sem codigoProduto.',
        'Informe o MED_CODIGO/código do produto da campanha.'
      );
    }

    if (isBlank(produto.qtdeSolicitada) || !isPositiveNumber(produto.qtdeSolicitada)) {
      pushIssue(
        issues,
        'erro',
        'PRODUTO_QTDE_INVALIDA',
        `${prefix}.qtdeSolicitada`,
        'Quantidade solicitada ausente, zero ou inválida.',
        'Informe qtdeSolicitada maior que zero.'
      );
    }

    if (isBlank(produto.ean)) {
      pushIssue(
        issues,
        'erro',
        'PRODUTO_SEM_EAN',
        `${prefix}.EAN`,
        'EAN nao informado.',
        'Informe o codigo de barras/EAN do produto para permitir conferencia e sugestao do codigoProduto correto.'
      );
    }

    [
      'valorUnitarioProduto',
      'descontoComercial',
      'valorDescontoComercial',
      'descontoComercialAdicional',
      'valorDescontoComercialAdicional',
      'totalDescontosComerciais',
      'valorTotalDescontosComerciais',
      'valorUnitarioFinalProduto',
      'valorUnitarioNFe',
      'descontoFinanceiro',
      'valorDescontoFinanceiro',
      'valorUnitarioBoleto',
    ].forEach((field) => {
      if (!isBlank(produto[field]) && !Number.isFinite(toNumber(produto[field]))) {
        pushIssue(
          issues,
          'erro',
          'VALOR_NUMERICO_INVALIDO',
          `${prefix}.${field}`,
          `${field} não é numérico.`,
          'Use número válido. Exemplo: 12.34'
        );
      }
    });
  });

  const codigos = normalized.produtos.map((p) => cleanText(p.codigoProduto)).filter(Boolean);
  const duplicados = codigos.filter((codigo, index) => codigos.indexOf(codigo) !== index);

  [...new Set(duplicados)].forEach((codigo) => {
    pushIssue(
      issues,
      'aviso',
      'PRODUTO_DUPLICADO',
      'produtos.codigoProduto',
      `Produto ${codigo} aparece mais de uma vez no pedido.`,
      'Verifique se a integradora enviou itens duplicados.'
    );
  });

  return issues;
}

async function querySafe(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);

    return {
      ok: true,
      rows: Array.isArray(rows) ? rows : [],
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: error.message,
    };
  }
}

async function validateDatabase(pool, normalized, options = {}) {
  const issues = [];
  const checks = [];

  const rede = safeDbName(options.rede || process.env.VALIDADOR_REDE_DEFAULT || 'redemgfarma');
  const info = normalized.informacoes;

  const cnpjCliente = onlyDigits(info.cnpjCliente);
  const cnpjDistribuidor = onlyDigits(info.cnpjDistribuidor);
  const idCampanha = cleanText(info.idCampanha);
  const idOL = cleanText(info.idOL);

  if (!pool) {
    return { issues, checks };
  }

  const addCheck = (nome, ok, message, rows = [], error = null) => {
    checks.push({
      nome,
      ok,
      message,
      total: rows.length,
      amostra: rows.slice(0, 5),
      error,
    });
  };

  let farmaciaCliente = null;

  if (cnpjCliente.length === 14) {
    const farmacia = await querySafe(
      pool,
      `
      SELECT FAR_CODIGO, FAR_NOME, FAR_NOME_FANTASIA, FAR_CNPJ, FAR_UF, FAR_ATIVO
      FROM \`${rede}\`.farmacias
      WHERE REPLACE(REPLACE(REPLACE(FAR_CNPJ, '.', ''), '/', ''), '-', '') = ?
      LIMIT 10
      `,
      [cnpjCliente]
    );

    addCheck(
      'Farmácia por CNPJ',
      farmacia.ok && farmacia.rows.length > 0,
      farmacia.rows.length ? 'Farmácia localizada pelo CNPJ.' : 'Farmácia não localizada pelo CNPJ.',
      farmacia.rows,
      farmacia.error
    );

    farmaciaCliente = farmacia.rows[0] || null;

    if (farmacia.ok && farmacia.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'FARMACIA_NAO_ENCONTRADA',
        'informacoes.cnpjCliente',
        'CNPJ da loja não encontrado na base da rede.',
        'Revise cnpjCliente ou confirme se a loja está cadastrada/ativa na rede.',
        { rede, cnpjCliente }
      );
    }
  }

  if (idCampanha) {
    const campanha = await querySafe(
      pool,
      `
      SELECT *
      FROM \`${rede}\`.operacoes_logisticas
      WHERE OPL_CODIGO = ?
      LIMIT 5
      `,
      [idCampanha]
    );

    addCheck(
      'Campanha/OL por idCampanha',
      campanha.ok && campanha.rows.length > 0,
      campanha.rows.length ? 'Campanha localizada.' : 'Campanha não localizada.',
      campanha.rows,
      campanha.error
    );

    if (campanha.ok && campanha.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'CAMPANHA_NAO_ENCONTRADA',
        'informacoes.idCampanha',
        'idCampanha não encontrado em operacoes_logisticas.',
        'Revise o código da campanha enviada pela integradora.',
        { rede, idCampanha }
      );
    }

    if (campanha.ok && campanha.rows.length > 0) {
      const camp = campanha.rows[0];
      const prazoCampanha = inferirCodigoPrazoCampanha(camp);
      const codigoPrazoInformado = cleanText(info.codigoPrazoCd);

      if (prazoCampanha && !codigoPrazoInformado) {
        pushIssue(
          issues,
          'erro',
          'CODIGO_PRAZO_NAO_INFORMADO',
          'informacoes.codigoPrazoCd',
          `codigoPrazoCd nao foi informado. Pela campanha, o esperado parece ser ${prazoCampanha.codigo} (${prazoCampanha.descricao}).`,
          `Preencha informacoes.codigoPrazoCd com ${prazoCampanha.codigo}. Regra geral: 1 = a vista, 2 = a prazo.`,
          { rede, idCampanha, valorSugerido: prazoCampanha.codigo, prazoCampanha }
        );
      }

      if (prazoCampanha && codigoPrazoInformado && codigoPrazoInformado !== prazoCampanha.codigo) {
        pushIssue(
          issues,
          'erro',
          'CODIGO_PRAZO_DIVERGENTE',
          'informacoes.codigoPrazoCd',
          `codigoPrazoCd informado (${codigoPrazoInformado} - ${rotuloPrazo(codigoPrazoInformado)}) parece diferente da campanha (${prazoCampanha.codigo} - ${prazoCampanha.descricao}).`,
          `Confirme a regra da campanha e, se estiver correto, ajuste codigoPrazoCd para ${prazoCampanha.codigo}.`,
          { rede, idCampanha, valorAtual: codigoPrazoInformado, valorSugerido: prazoCampanha.codigo, prazoCampanha }
        );
      }

      if (String(camp.OPL_ATIVO) !== '1') {
        pushIssue(
          issues,
          'erro',
          'CAMPANHA_INATIVA',
          'informacoes.idCampanha',
          'A campanha existe, mas está inativa.',
          'Ative a campanha ou use uma campanha válida.',
          { rede, idCampanha, campanha: camp }
        );
      }

      if (camp.OPL_DT_FIM) {
        const fim = new Date(camp.OPL_DT_FIM);
        const hoje = new Date();

        if (!Number.isNaN(fim.getTime()) && fim < hoje) {
          pushIssue(
            issues,
            'aviso',
            'CAMPANHA_VENCIDA',
            'informacoes.idCampanha',
            'A campanha parece estar vencida pela data final.',
            'Confirme se essa campanha ainda aceita pedido.',
            { rede, idCampanha, dataFim: camp.OPL_DT_FIM }
          );
        }
      }
    }
  }

  if (idCampanha && farmaciaCliente?.FAR_CODIGO) {
    const farmaciaOpl = await querySafe(
      pool,
      `
      SELECT fol.CODIGO, fol.FAR_CODIGO, fol.OPL_CODIGO
      FROM \`${rede}\`.farmacias_opl fol
      WHERE fol.FAR_CODIGO = ?
        AND fol.OPL_CODIGO = ?
      LIMIT 5
      `,
      [farmaciaCliente.FAR_CODIGO, idCampanha]
    );

    addCheck(
      'Loja/CNPJ vinculada a campanha',
      farmaciaOpl.ok && farmaciaOpl.rows.length > 0,
      farmaciaOpl.rows.length
        ? 'Loja/CNPJ vinculada a campanha.'
        : 'Loja/CNPJ nao esta vinculada a campanha.',
      farmaciaOpl.rows,
      farmaciaOpl.error
    );

    if (farmaciaOpl.ok && farmaciaOpl.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'FARMACIA_OPL_NAO_ENCONTRADA',
        'informacoes.cnpjCliente',
        'A farmacia do cnpjCliente nao esta vinculada a OL/campanha informada.',
        'Revise cnpjCliente e idCampanha/OL. Esse caso pode retornar FAR_OPL_NOT_FOUND na API SIG.',
        { rede, cnpjCliente, farCodigo: farmaciaCliente.FAR_CODIGO, idCampanha }
      );
    }
  }

  if (cnpjDistribuidor.length === 14) {
    const fornecedorBase = await querySafe(
      pool,
      `
      SELECT FOR_CODIGO, FOR_NOME, FOR_CNPJ, FOR_UF, FOR_ATIVO, FOR_TIPO, CODIGO_REDE
      FROM \`${rede}\`.fornecedores
      WHERE REPLACE(REPLACE(REPLACE(FOR_CNPJ, '.', ''), '/', ''), '-', '') = ?
      LIMIT 10
      `,
      [cnpjDistribuidor]
    );

    addCheck(
      'Fornecedor por CNPJ',
      fornecedorBase.ok && fornecedorBase.rows.length > 0,
      fornecedorBase.rows.length ? 'Fornecedor localizado pelo CNPJ.' : 'Fornecedor não localizado pelo CNPJ.',
      fornecedorBase.rows,
      fornecedorBase.error
    );

    if (fornecedorBase.ok && fornecedorBase.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'FORNECEDOR_NAO_ENCONTRADO',
        'informacoes.cnpjDistribuidor',
        'CNPJ do distribuidor não encontrado na base de fornecedores.',
        'Revise cnpjDistribuidor ou cadastre/vincule o fornecedor na rede.',
        { rede, cnpjDistribuidor }
      );
    }
  }

  if (cnpjDistribuidor.length === 14 && idCampanha) {
    const fornecedorCampanha = await querySafe(
      pool,
      `
      SELECT f.FOR_CODIGO, f.FOR_NOME, f.FOR_CNPJ, f.FOR_UF, f.FOR_ATIVO, f.FOR_TIPO, fpol.OPL_CODIGO
      FROM \`${rede}\`.fornecedores f
      INNER JOIN \`${rede}\`.fornecedores_participa_operacao_logistica fpol
        ON f.FOR_CODIGO = fpol.FOR_CODIGO
      WHERE REPLACE(REPLACE(REPLACE(f.FOR_CNPJ, '.', ''), '/', ''), '-', '') = ?
        AND fpol.OPL_CODIGO = ?
        AND f.FOR_TIPO = '1'
        AND f.FOR_ATIVO = '1'
      LIMIT 10
      `,
      [cnpjDistribuidor, idCampanha]
    );

    addCheck(
      'Fornecedor participante da campanha',
      fornecedorCampanha.ok && fornecedorCampanha.rows.length > 0,
      fornecedorCampanha.rows.length
        ? 'Fornecedor localizado e participante da campanha.'
        : 'Fornecedor não localizado/participante para a campanha.',
      fornecedorCampanha.rows,
      fornecedorCampanha.error
    );

    if (fornecedorCampanha.ok && fornecedorCampanha.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'FORNECEDOR_CAMPANHA_NAO_ENCONTRADO',
        'informacoes.cnpjDistribuidor',
        'Fornecedor do cnpjDistribuidor não participa da campanha informada.',
        'Revise cnpjDistribuidor, idCampanha ou vincule o fornecedor à OL.',
        { rede, cnpjDistribuidor, idCampanha }
      );
    }
  }

  const produtosComEan = normalized.produtos
    .map((produto) => ({ ...produto, eanLimpo: onlyDigits(produto.ean) }))
    .filter((produto) => produto.eanLimpo);

  if (produtosComEan.length) {
    const eans = [...new Set(produtosComEan.map((p) => p.eanLimpo))];
    const placeholders = eans.map(() => '?').join(',');
    const params = idCampanha
      ? [idCampanha, ...eans]
      : [null, ...eans];

    const produtosPorEan = await querySafe(
      pool,
      `
      SELECT
        m.MED_CODIGO,
        m.MED_NOME,
        m.MED_COD_BARRAS,
        m.MED_ATIVO,
        mo.OPL_CODIGO
      FROM \`${rede}\`.medicamentos m
      LEFT JOIN \`${rede}\`.medicamentos_opl mo
        ON mo.MED_CODIGO = m.MED_CODIGO
        AND mo.OPL_CODIGO = ?
      WHERE REPLACE(REPLACE(REPLACE(m.MED_COD_BARRAS, '.', ''), '/', ''), '-', '') IN (${placeholders})
      LIMIT 500
      `,
      params
    );

    addCheck(
      'Produtos localizados por EAN',
      produtosPorEan.ok && produtosPorEan.rows.length > 0,
      produtosPorEan.rows.length
        ? `${produtosPorEan.rows.length} produto(s) localizados pelo EAN.`
        : 'Nenhum produto foi localizado pelos EANs informados.',
      produtosPorEan.rows,
      produtosPorEan.error
    );

    if (produtosPorEan.ok) {
      const porEan = new Map(
        produtosPorEan.rows.map((row) => [onlyDigits(row.MED_COD_BARRAS), row])
      );

      produtosComEan.forEach((produto) => {
        const encontrado = porEan.get(produto.eanLimpo);
        const prefix = `produtos[${produto.index}]`;

        if (!encontrado) {
          pushIssue(
            issues,
            'erro',
            'PRODUTO_EAN_NAO_LOCALIZADO',
            `${prefix}.EAN`,
            `EAN ${produto.eanLimpo} nao foi localizado no cadastro de medicamentos.`,
            'Revise o EAN informado ou cadastre/vincule o produto correto na rede.',
            { rede, ean: produto.eanLimpo, idCampanha }
          );
          return;
        }

        const codigoEncontrado = cleanText(encontrado.MED_CODIGO);
        const codigoInformado = cleanText(produto.codigoProduto);

        if (isBlank(produto.codigoProduto)) {
          pushIssue(
            issues,
            'erro',
            'PRODUTO_CODIGO_SUGERIDO_PELO_EAN',
            `${prefix}.codigoProduto`,
            `Produto sem codigoProduto. Pelo EAN ${produto.eanLimpo}, o codigoProduto correto parece ser ${codigoEncontrado}.`,
            `Preencha produtos[${produto.index}].codigoProduto com ${codigoEncontrado}.`,
            { rede, ean: produto.eanLimpo, codigoProdutoSugerido: codigoEncontrado, produto: encontrado }
          );
        } else if (codigoInformado !== codigoEncontrado) {
          pushIssue(
            issues,
            'erro',
            'PRODUTO_CODIGO_DIVERGE_DO_EAN',
            `${prefix}.codigoProduto`,
            `codigoProduto ${codigoInformado} nao confere com o EAN ${produto.eanLimpo}. Pelo cadastro, o correto parece ser ${codigoEncontrado}.`,
            `Ajuste codigoProduto para ${codigoEncontrado} ou revise o EAN enviado.`,
            { rede, ean: produto.eanLimpo, codigoProdutoAtual: codigoInformado, codigoProdutoSugerido: codigoEncontrado, produto: encontrado }
          );
        }

        if (idCampanha && !encontrado.OPL_CODIGO) {
          pushIssue(
            issues,
            'erro',
            'PRODUTO_EAN_FORA_DA_CAMPANHA',
            `${prefix}.EAN`,
            `Produto ${codigoEncontrado} localizado pelo EAN ${produto.eanLimpo}, mas nao esta vinculado a campanha ${idCampanha}.`,
            'Inclua o produto na campanha ou gere novamente o arquivo da campanha com esse medicamento.',
            { rede, ean: produto.eanLimpo, codigoProduto: codigoEncontrado, idCampanha }
          );
        }
      });
    }
  }

  const produtosValidos = normalized.produtos.filter((p) => !isBlank(p.codigoProduto));

  if (idCampanha && produtosValidos.length) {
    const codigos = [...new Set(produtosValidos.map((p) => cleanText(p.codigoProduto)))];
    const placeholders = codigos.map(() => '?').join(',');

    const produtosCampanha = await querySafe(
      pool,
      `
      SELECT
        mo.MED_CODIGO,
        mo.OPL_CODIGO,
        mo.MED_QTDE_MIN,
        mo.MED_PRECO_FINAL,
        mo.UF_CODIGO,
        m.MED_NOME,
        m.MED_COD_BARRAS,
        m.MED_ATIVO
      FROM \`${rede}\`.medicamentos_opl mo
      LEFT JOIN \`${rede}\`.medicamentos m
        ON m.MED_CODIGO = mo.MED_CODIGO
      WHERE mo.OPL_CODIGO = ?
        AND mo.MED_CODIGO IN (${placeholders})
      LIMIT 500
      `,
      [idCampanha, ...codigos]
    );

    addCheck(
      'Produtos vinculados à campanha',
      produtosCampanha.ok && produtosCampanha.rows.length > 0,
      produtosCampanha.rows.length
        ? `${produtosCampanha.rows.length} produto(s) encontrados na campanha.`
        : 'Nenhum produto do pedido foi localizado na campanha.',
      produtosCampanha.rows,
      produtosCampanha.error
    );

    if (produtosCampanha.ok) {
      const encontrados = new Map(produtosCampanha.rows.map((r) => [String(r.MED_CODIGO), r]));

      codigos.forEach((codigo) => {
        if (!encontrados.has(String(codigo))) {
          pushIssue(
            issues,
            'erro',
            'PRODUTO_FORA_DA_CAMPANHA',
            'produtos.codigoProduto',
            `Produto ${codigo} não foi localizado na campanha ${idCampanha}.`,
            'Revise codigoProduto ou gere novamente o arquivo da campanha com esse medicamento.',
            { rede, idCampanha, codigoProduto: codigo }
          );
        }
      });

      produtosCampanha.rows.forEach((row) => {
        if (String(row.MED_ATIVO) !== '1') {
          pushIssue(
            issues,
            'erro',
            'PRODUTO_INATIVO',
            'produtos.codigoProduto',
            `Produto ${row.MED_CODIGO} está inativo no cadastro de medicamentos.`,
            'Ative o medicamento ou remova o item do pedido/campanha.',
            { rede, idCampanha, codigoProduto: row.MED_CODIGO }
          );
        }
      });

    }
  }

  const pedidoIntegrador =
    cleanText(info.pedidoCotefacil) ||
    cleanText(info.pedidoCliente) ||
    cleanText(info.cotacaoCotefacil);

  if (pedidoIntegrador || (cnpjCliente.length === 14 && idCampanha)) {
    const duplicado = await querySafe(
      pool,
      `
      SELECT numeroCarrinhoDeCompras, CnpjDistribuidor, CnpjCliente, IdCampanha, NomeCampanha, pedidoIntegradora, integradora, dataPedido
      FROM pedidoconfirmaintegracao
      WHERE
        (? <> '' AND pedidoIntegradora = ?)
        OR (
          ? <> ''
          AND REPLACE(REPLACE(REPLACE(CnpjCliente, '.', ''), '/', ''), '-', '') = ?
          AND IdCampanha = ?
        )
      ORDER BY dataPedido DESC
      LIMIT 10
      `,
      [pedidoIntegrador, pedidoIntegrador, cnpjCliente, cnpjCliente, idCampanha]
    );

    addCheck(
      'Possível duplicidade de pedido',
      duplicado.ok,
      duplicado.rows.length
        ? 'Encontramos pedido(s) já gravados com identificadores semelhantes.'
        : 'Nenhuma duplicidade encontrada pelos critérios disponíveis.',
      duplicado.rows,
      duplicado.error
    );

    if (duplicado.ok && duplicado.rows.length > 0) {
      pushIssue(
        issues,
        'aviso',
        'PEDIDO_POSSIVELMENTE_DUPLICADO',
        'informacoes.pedidoCotefacil',
        'Já existe pedido gravado com identificadores semelhantes.',
        'Antes de reenviar, confirme se não é reprocessamento do mesmo pedido.',
        { pedidoIntegrador, registros: duplicado.rows.slice(0, 3) }
      );
    }
  }

  return { issues, checks };
}

function buildResumo(issues, checks) {
  const erros = issues.filter((i) => i.severity === 'erro').length;
  const avisos = issues.filter((i) => i.severity === 'aviso').length;
  const checksOk = checks.filter((c) => c.ok).length;
  const checksTotal = checks.length;

  return {
    valido: erros === 0,
    erros,
    avisos,
    checksOk,
    checksTotal,
    status: erros === 0 ? 'APTO_PARA_TESTE' : 'CORRIGIR_ANTES_DE_REENVIAR',
  };
}

function montarProximosPassos(issues) {
  if (!issues.length) {
    return ['JSON passou nas validações disponíveis. Pode testar o reenvio do pedido.'];
  }

  const passos = [];
  const codes = new Set(issues.map((i) => i.code));

  if (codes.has('PRODUTOS_AUSENTES')) {
    passos.push('Solicitar novo payload à integradora: a API Java quebra com IndexOutOfBoundsException se produtos vier vazio.');
  }
  if (codes.has('FARMACIA_OPL_NAO_ENCONTRADA')) {
    passos.push('Validar vinculo da farmacia do cnpjCliente com a OL/campanha em farmacias_opl.');
  }

  if (codes.has('FORNECEDOR_CAMPANHA_NAO_ENCONTRADO')) {
    passos.push('Validar fornecedor da campanha: CNPJ distribuidor precisa estar vinculado à OL.');
  }

  if (codes.has('PRODUTO_FORA_DA_CAMPANHA')) {
    passos.push('Validar produtos enviados: existem itens cujo codigoProduto não está na campanha informada.');
  }

  if (codes.has('PEDIDO_POSSIVELMENTE_DUPLICADO')) {
    passos.push('Validar se o pedido já foi inserido antes de reenviar.');
  }

  if (!passos.length) {
    passos.push('Corrigir os campos apontados em erros/avisos e testar novamente.');
  }

  return passos;
}

async function validarPedido(payload, { pool, rede, validarBanco = true } = {}) {
  const normalized = normalizePedido(payload);
  const structureIssues = validateStructure(normalized);

  let databaseResult = {
    issues: [],
    checks: [],
  };

  const erroBloqueanteEstrutura = structureIssues.some((i) =>
    ['JSON_INVALIDO', 'INFORMACOES_AUSENTE'].includes(i.code)
  );

  if (validarBanco && !erroBloqueanteEstrutura) {
    databaseResult = await validateDatabase(pool, normalized, { rede });
  }

  const issues = [...structureIssues, ...databaseResult.issues];
  const checks = databaseResult.checks || [];

  return {
    resumo: buildResumo(issues, checks),
    rede: rede || process.env.VALIDADOR_REDE_DEFAULT || 'redemgfarma',
    normalizado: {
      informacoes: normalized.informacoes,
      totalProdutos: normalized.produtos.length,
      primeiroProduto: normalized.produtos[0] ? {
        ...normalized.produtos[0],
        raw: undefined,
      } : null,
      produtos: normalized.produtos.map(({ raw, ...p }) => p),
    },
    issues,
    checks,
    proximosPassos: montarProximosPassos(issues),
  };
}

module.exports = {
  validarPedido,
  normalizePedido,
  validateStructure,
};
