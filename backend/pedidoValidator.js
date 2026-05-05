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
    ['idOL', 'No Java atual, esse campo é enviado como FAR_CODIGO para criar o rascunho.'],
    ['codigoPrazoCd', 'Condição/método de pagamento enviada pela integradora.'],
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

  if (normalized.produtos.length > 1) {
    pushIssue(
      issues,
      'aviso',
      'API_UTILIZA_PRIMEIRO_PRODUTO',
      'produtos',
      'A API Java atual usa principalmente produtos[0] na criação do rascunho e no retorno gravado.',
      'Valide se o comportamento de enviar apenas o primeiro produto é realmente o esperado.'
    );
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
        'aviso',
        'PRODUTO_SEM_EAN',
        `${prefix}.EAN`,
        'EAN não informado.',
        'Não costuma impedir o rascunho, mas dificulta auditoria/conferência.'
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

  let farmaciaPorCodigo = null;

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

  if (idOL) {
    const farmaciaCodigo = await querySafe(
      pool,
      `
      SELECT FAR_CODIGO, FAR_NOME, FAR_NOME_FANTASIA, FAR_CNPJ, FAR_UF, FAR_ATIVO
      FROM \`${rede}\`.farmacias
      WHERE FAR_CODIGO = ?
      LIMIT 5
      `,
      [idOL]
    );

    farmaciaPorCodigo = farmaciaCodigo.rows[0] || null;

    addCheck(
      'Farmácia por idOL/FAR_CODIGO',
      farmaciaCodigo.ok && farmaciaCodigo.rows.length > 0,
      farmaciaCodigo.rows.length
        ? 'idOL localizado como FAR_CODIGO.'
        : 'idOL não localizado como FAR_CODIGO.',
      farmaciaCodigo.rows,
      farmaciaCodigo.error
    );

    if (farmaciaCodigo.ok && farmaciaCodigo.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'IDOL_FAR_CODIGO_NAO_ENCONTRADO',
        'informacoes.idOL',
        'O campo idOL não corresponde a uma farmácia/FAR_CODIGO existente.',
        'No Java atual, idOL é enviado como farCodigo para criar rascunho. Revise o idOL.',
        { rede, idOL }
      );
    }

    if (farmaciaCodigo.ok && farmaciaCodigo.rows.length > 0 && cnpjCliente.length === 14) {
      const cnpjFarmacia = onlyDigits(farmaciaCodigo.rows[0].FAR_CNPJ);

      if (cnpjFarmacia !== cnpjCliente) {
        pushIssue(
          issues,
          'erro',
          'IDOL_NAO_BATE_COM_CNPJ',
          'informacoes.idOL',
          'O idOL/FAR_CODIGO informado pertence a outra farmácia.',
          'Revise se idOL e cnpjCliente pertencem à mesma loja.',
          {
            rede,
            idOL,
            cnpjClientePayload: cnpjCliente,
            cnpjFarmaciaEncontrada: cnpjFarmacia,
            farmaciaEncontrada: farmaciaCodigo.rows[0],
          }
        );
      }
    }
  }

  if (idCampanha) {
    const campanha = await querySafe(
      pool,
      `
      SELECT OPL_CODIGO, OPL_DESCRICAO, OPL_ATIVO, OPL_DT_INICIO, OPL_DT_FIM, UTILIZA_EDI, CODIGO_REDE
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

  if (idCampanha && idOL) {
    const farmaciaOpl = await querySafe(
      pool,
      `
      SELECT fol.CODIGO, fol.FAR_CODIGO, fol.OPL_CODIGO
      FROM \`${rede}\`.farmacias_opl fol
      WHERE fol.FAR_CODIGO = ?
        AND fol.OPL_CODIGO = ?
      LIMIT 5
      `,
      [idOL, idCampanha]
    );

    addCheck(
      'Loja vinculada à campanha',
      farmaciaOpl.ok && farmaciaOpl.rows.length > 0,
      farmaciaOpl.rows.length
        ? 'Loja vinculada à campanha.'
        : 'Loja não está vinculada à campanha.',
      farmaciaOpl.rows,
      farmaciaOpl.error
    );

    if (farmaciaOpl.ok && farmaciaOpl.rows.length === 0) {
      pushIssue(
        issues,
        'erro',
        'FARMACIA_OPL_NAO_ENCONTRADA',
        'informacoes.idOL',
        'A loja/idOL não está vinculada à campanha informada.',
        'Revise idOL e idCampanha. Esse caso pode retornar FAR_OPL_NOT_FOUND na API SIG.',
        { rede, idOL, idCampanha }
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

      if (farmaciaPorCodigo?.FAR_UF) {
        produtosCampanha.rows.forEach((row) => {
          if (
            row.UF_CODIGO &&
            String(row.UF_CODIGO).length === 2 &&
            String(row.UF_CODIGO).toUpperCase() !== String(farmaciaPorCodigo.FAR_UF).toUpperCase()
          ) {
            pushIssue(
              issues,
              'aviso',
              'UF_PRODUTO_DIFERENTE_DA_LOJA',
              'produtos.codigoProduto',
              `Produto ${row.MED_CODIGO} tem UF ${row.UF_CODIGO}, mas a loja é ${farmaciaPorCodigo.FAR_UF}.`,
              'Confirme se a campanha permite essa UF para a loja. Esse tipo de caso pode gerar UF_MISMATCH.',
              {
                rede,
                idCampanha,
                codigoProduto: row.MED_CODIGO,
                ufProduto: row.UF_CODIGO,
                ufLoja: farmaciaPorCodigo.FAR_UF,
              }
            );
          }
        });
      }
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

  if (codes.has('IDOL_FAR_CODIGO_NAO_ENCONTRADO') || codes.has('IDOL_NAO_BATE_COM_CNPJ')) {
    passos.push('Validar idOL: no Java atual, ele é enviado como FAR_CODIGO para criar o rascunho.');
  }

  if (codes.has('FARMACIA_OPL_NAO_ENCONTRADA')) {
    passos.push('Validar vínculo da loja com a campanha em farmacias_opl.');
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