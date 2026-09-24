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
  validarBanco = true;
  carregando = false;
  carregandoMetadados = false;
  detectandoRede = false;
  erro = '';
  avisoDeteccao = '';
  resultado: any = null;
  redes: any[] = this.redesFallback();
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
        this.redes = data.redes?.length ? data.redes : this.redesFallback();

        if (!this.redes.some((item) => item.schema === this.rede) && this.redes.length) {
          this.rede = this.redes[0].schema;
        }

        this.carregandoMetadados = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.redes = this.redesFallback();
        this.carregandoMetadados = false;
        this.cdr.detectChanges();
      }
    });
  }

  onJsonChange(value: string): void {
    this.jsonPedido = value;
    this.resultado = null;
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

  private tabelasReferenciaFallback(): string[] {
    return [
      'farmacias',
      'operacoes_logisticas',
      'farmacias_opl',
      'fornecedores',
      'fornecedores_participa_operacao_logistica',
      'medicamentos',
      'medicamentos_opl'
    ];
  }

  private redesFallback(): any[] {
    const tabelas = this.tabelasReferenciaFallback().map((nome) => ({ nome, referencia: true }));

    return [
      { schema: 'redecomprecerto', nome: 'Grupo Compre Certo', tabelas },
      { schema: 'drogarede', nome: 'Droga Rede', tabelas },
      { schema: 'nossarede', nome: 'Nossa Rede', tabelas },
      { schema: 'farmelhor', nome: 'FarMelhor', tabelas },
      { schema: 'redefarma', nome: 'RedeFarma', tabelas },
      { schema: 'redemgfarma', nome: 'Rede MG Farma', tabelas },
      { schema: 'mercaweb', nome: 'Merca Web', tabelas },
      { schema: 'vidafarmacias', nome: 'Vida Farmacias', tabelas },
      { schema: 'grupoadmpharma', nome: 'Grupo ADM Pharma', tabelas }
    ];
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
        this.resultado = res.data || res;
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

  limpar(): void {
    this.jsonPedido = '';
    this.resultado = null;
    this.erro = '';
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

  trackIssue(index: number, item: any): string {
    return `${item.code}-${item.field}-${index}`;
  }

  trackCheck(index: number, item: any): string {
    return `${item.nome}-${index}`;
  }
}
