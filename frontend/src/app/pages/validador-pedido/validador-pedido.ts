import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-validador-pedido',
  templateUrl: './validador-pedido.html',
  styleUrls: ['./validador-pedido.scss']
})
export class ValidadorPedidoComponent implements OnInit {
  jsonPedido = '';
  rede = 'redecomprecerto';
  integradoraReenvio = 'SMART';
  validarBanco = true;
  carregando = false;
  reenviando = false;
  carregandoMetadados = false;
  detectandoRede = false;
  erro = '';
  erroReenvio = '';
  avisoDeteccao = '';
  resultado: any = null;
  resultadoReenvio: any = null;
  redes: any[] = [];
  private detectarTimer: any = null;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.carregarMetadados();
  }

  carregarMetadados(): void {
    this.carregandoMetadados = true;

    this.service.getValidadorMetadados().subscribe({
      next: (res: any) => {
        const data = res.data || res;
        this.redes = data.redes || [];
        if (!this.redes.length) { this.rede = ''; this.avisoDeteccao = 'Nenhuma rede habilitada para o validador. Consulte Redes da integração.'; }

        if (!this.redes.some((item) => item.schema === this.rede) && this.redes.length) {
          this.rede = this.redes[0].schema;
        }

        this.carregandoMetadados = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.redes = [];
        this.rede = '';
        this.erro = 'Não foi possível consultar as redes habilitadas. Atualize a página ou verifique a configuração da integração.';
        this.carregandoMetadados = false;
        this.cdr.detectChanges();
      }
    });
  }

  onJsonChange(value: string): void {
    this.jsonPedido = value;
    this.resultado = null;
    this.resultadoReenvio = null;
    this.erroReenvio = '';
    this.avisoDeteccao = '';

    clearTimeout(this.detectarTimer);
    this.detectarTimer = setTimeout(() => this.detectarRedePorJson(), 450);
  }

  detectarRedePorJson(): void {
    let payload: any;

    try {
      payload = JSON.parse(this.jsonPedido || '{}');
    } catch {
      return;
    }

    const info = payload?.informacoes || payload || {};

    if (!info.cnpjCliente && !info.CnpjCliente && !info.idOL && !info.IdOL && !info.idCampanha && !info.IdCampanha) {
      return;
    }

    this.detectandoRede = true;

    this.service.detectarRedePedido(payload).subscribe({
      next: (res: any) => {
        const data = res.data || res;

        if (data.rede) {
          this.rede = data.rede;
          this.avisoDeteccao = `Base identificada: ${data.nome || data.rede}`;
        } else {
          this.avisoDeteccao = 'Nao consegui identificar a base automaticamente. Escolha uma base na lista.';
        }

        this.detectandoRede = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.detectandoRede = false;
        this.cdr.detectChanges();
      }
    });
  }

  validar(): void {
    this.erro = '';
    this.resultado = null;

    let payload: any;

    try {
      payload = JSON.parse(this.jsonPedido || '{}');
    } catch (error: any) {
      this.erro = `JSON invalido: ${error.message}`;
      this.cdr.detectChanges();
      return;
    }

    this.carregando = true;

    this.service.validarPedido(payload, {
      rede: this.rede,
      validarBanco: this.validarBanco
    }).subscribe({
      next: (res: any) => {
        this.resultado = this.prepararResultado(res.data || res);
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.erro = err?.error?.message || err?.error?.error || 'Erro ao validar pedido.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  reenviarPedido(): void {
    this.erro = '';
    this.erroReenvio = '';
    this.resultadoReenvio = null;

    let payload: any;

    try {
      payload = JSON.parse(this.jsonPedido || '{}');
    } catch (error: any) {
      this.erroReenvio = `JSON invalido: ${error.message}`;
      this.cdr.detectChanges();
      return;
    }

    this.reenviando = true;

    this.service.reenviarPedido(payload, { integradora: this.integradoraReenvio }).subscribe({
      next: (res: any) => {
        this.resultadoReenvio = res.data || res;
        this.reenviando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        const data = err?.error?.data || null;
        this.resultadoReenvio = data;
        this.erroReenvio =
          err?.error?.message ||
          err?.error?.error ||
          data?.mensagem ||
          'Erro ao reenviar pedido.';
        this.reenviando = false;
        this.cdr.detectChanges();
      }
    });
  }

  limpar(): void {
    this.jsonPedido = '';
    this.resultado = null;
    this.resultadoReenvio = null;
    this.erro = '';
    this.erroReenvio = '';
    this.avisoDeteccao = '';
    this.cdr.detectChanges();
  }

  carregarExemplo(): void {
    this.jsonPedido = JSON.stringify({
      informacoes: {
        cnpjDistribuidor: '00000000000000',
        cnpjCliente: '00000000000000',
        cotacaoCotefacil: '123456',
        pedidoCotefacil: '123456',
        pedidoCliente: '123456',
        idCampanha: '1234',
        nomeCampanha: 'Campanha exemplo',
        idOL: '1234',
        codigoPrazoCd: '1',
        descricaoPrazoCd: 'A prazo',
        quantidadeParcelaPrazo: '1',
        diasParcelaPrazo: '28',
        totalPrazo: '28'
      },
      produtos: [
        {
          idItemPedido: 1,
          EAN: '7890000000000',
          codigoProduto: 123456,
          descricaoProduto: 'Produto exemplo',
          qtdeSolicitada: 10,
          valorUnitarioProduto: 1.23,
          descontoComercial: 0,
          valorDescontoComercial: 0,
          descontoComercialAdicional: 0,
          valorDescontoComercialAdicional: 0,
          totalDescontosComerciais: 0,
          valorTotalDescontosComerciais: 0,
          valorUnitarioFinalProduto: 1.23,
          valorUnitarioNFe: 1.23,
          descontoFinanceiro: 0,
          valorDescontoFinanceiro: 0,
          valorUnitarioBoleto: 1.23
        }
      ]
    }, null, 2);

    this.onJsonChange(this.jsonPedido);
    this.cdr.detectChanges();
  }

  badgeClass(severity: string): string {
    if (severity === 'erro') return 'danger';
    if (severity === 'aviso') return 'warn';
    return 'info';
  }

  private prepararResultado(resultado: any): any {
    if (!resultado) return resultado;

    return {
      ...resultado,
      issues: (resultado.issues || []).map((issue: any) => this.comReferenciaCampo(issue))
    };
  }

  private comReferenciaCampo(issue: any): any {
    const referencia = this.referenciaCampo(issue?.field);

    return {
      ...issue,
      fieldTecnico: issue?.field,
      fieldLabel: referencia.nome,
      tabela: referencia.tabela,
      coluna: referencia.coluna,
      referenciaBanco: referencia.referenciaBanco,
      valorAtual: issue?.valorAtual ?? issue?.codigoProdutoAtual ?? issue?.ean ?? issue?.cnpjCliente ?? issue?.cnpjDistribuidor,
      valorSugerido: issue?.valorSugerido ?? issue?.codigoProdutoSugerido
    };
  }

  private referenciaCampo(campo?: string): any {
    const original = String(campo || '').trim();
    const normalizado = original
      .replace(/\[\d+\]/g, '[]')
      .replace(/\s+/g, '')
      .toLowerCase();

    const referencias: Record<string, any> = {
      'informacoes.cnpjcliente': {
        nome: 'CNPJ da loja/cliente',
        tabela: 'farmacias',
        coluna: 'FAR_CNPJ',
        referenciaBanco: 'farmacias.FAR_CNPJ; farmacias_opl.FAR_CODIGO'
      },
      'informacoes.cnpjdistribuidor': {
        nome: 'CNPJ do fornecedor/distribuidor',
        tabela: 'fornecedores',
        coluna: 'FOR_CNPJ',
        referenciaBanco: 'fornecedores.FOR_CNPJ; fornecedores_participa_operacao_logistica.FOR_CODIGO'
      },
      'informacoes.idcampanha': {
        nome: 'Codigo da campanha/OL',
        tabela: 'operacoes_logisticas',
        coluna: 'OPL_CODIGO',
        referenciaBanco: 'operacoes_logisticas.OPL_CODIGO'
      },
      'informacoes.idol': {
        nome: 'Codigo da operacao logistica',
        tabela: 'operacoes_logisticas',
        coluna: 'OPL_CODIGO',
        referenciaBanco: 'operacoes_logisticas.OPL_CODIGO'
      },
      'informacoes.codigoprazocd': {
        nome: 'Condicao de pagamento',
        tabela: 'operacoes_logisticas',
        coluna: 'OPL_DESCRICAO',
        referenciaBanco: 'operacoes_logisticas.OPL_DESCRICAO/DESCRICAO/NOME'
      },
      'informacoes.pedidocotefacil': {
        nome: 'Numero do pedido da integradora',
        tabela: 'integracao_pedido_evento',
        coluna: 'pedido_integrador',
        referenciaBanco: 'integracao_pedido_evento.pedido_integrador; pedidoconfirmaintegracao.pedidoIntegradora'
      },
      'informacoes.pedidointegrador': {
        nome: 'Numero do pedido da integradora',
        tabela: 'integracao_pedido_evento',
        coluna: 'pedido_integrador',
        referenciaBanco: 'integracao_pedido_evento.pedido_integrador; pedidoconfirmaintegracao.pedidoIntegradora'
      },
      'produtos.codigoproduto': {
        nome: 'Codigo do produto/medicamento',
        tabela: 'medicamentos',
        coluna: 'MED_CODIGO',
        referenciaBanco: 'medicamentos.MED_CODIGO; medicamentos_opl.MED_CODIGO'
      },
      'produtos[].codigoproduto': {
        nome: 'Codigo do produto/medicamento',
        tabela: 'medicamentos',
        coluna: 'MED_CODIGO',
        referenciaBanco: 'medicamentos.MED_CODIGO; medicamentos_opl.MED_CODIGO'
      },
      'produtos.ean': {
        nome: 'EAN/codigo de barras do produto',
        tabela: 'medicamentos',
        coluna: 'MED_COD_BARRAS',
        referenciaBanco: 'medicamentos.MED_COD_BARRAS'
      },
      'produtos[].ean': {
        nome: 'EAN/codigo de barras do produto',
        tabela: 'medicamentos',
        coluna: 'MED_COD_BARRAS',
        referenciaBanco: 'medicamentos.MED_COD_BARRAS'
      },
      'produtos.qtdesolicitada': {
        nome: 'Quantidade solicitada do item',
        tabela: 'payload do pedido',
        coluna: 'qtdeSolicitada',
        referenciaBanco: 'produtos[].qtdeSolicitada'
      },
      'produtos[].qtdesolicitada': {
        nome: 'Quantidade solicitada do item',
        tabela: 'payload do pedido',
        coluna: 'qtdeSolicitada',
        referenciaBanco: 'produtos[].qtdeSolicitada'
      }
    };

    if (referencias[normalizado]) return referencias[normalizado];

    if (normalizado.startsWith('produtos[].valor') || normalizado.startsWith('produtos.valor')) {
      return {
        nome: 'Valor comercial do produto',
        tabela: 'payload do pedido',
        coluna: original.split('.').pop() || original,
        referenciaBanco: original || 'produtos[]'
      };
    }

    return {
      nome: original || 'Informacao do pedido',
      tabela: 'payload do pedido',
      coluna: original || '-',
      referenciaBanco: original || '-'
    };
  }

  trackIssue(index: number, item: any): string {
    return `${item.code}-${item.field}-${index}`;
  }

  trackCheck(index: number, item: any): string {
    return `${item.nome}-${index}`;
  }
}
