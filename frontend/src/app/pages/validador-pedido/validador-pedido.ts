import { ChangeDetectorRef, Component } from '@angular/core';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-validador-pedido',
  templateUrl: './validador-pedido.html',
  styleUrls: ['./validador-pedido.scss']
})
export class ValidadorPedidoComponent {
  jsonPedido = '';
  rede = 'redemgfarma';
  validarBanco = true;
  carregando = false;
  erro = '';
  resultado: any = null;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  validar(): void {
    this.erro = '';
    this.resultado = null;

    let payload: any;

    try {
      payload = JSON.parse(this.jsonPedido || '{}');
    } catch (error: any) {
      this.erro = `JSON inválido: ${error.message}`;
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