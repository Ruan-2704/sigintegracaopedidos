import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-validador-pedido',
  templateUrl: './validador-pedido.html',
  styleUrls: ['./validador-pedido.scss']
})
export class ValidadorPedidoComponent implements OnInit {
  jsonPedido = '';
  rede = 'redecomprecerto';
  bases: any[] = [];
  carregandoBases = false;

  validarBanco = true;
  carregando = false;
  erro = '';
  resultado: any = null;

  constructor(
    private service: IntegracaoService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.carregarBases();
  }

  carregarBases(): void {
    this.carregandoBases = true;

    this.http.get<any>('https://api.sigcotacao.sigrede.com.br/validador/bases').subscribe({
      next: (res: any) => {
        this.bases = res?.data || res || [];

        const existeRedeAtual = this.bases.some((base: any) => base.nome === this.rede);

        if (!existeRedeAtual && this.bases.length) {
          const redeCompreCerto = this.bases.find((base: any) => base.nome === 'redecomprecerto');
          this.rede = redeCompreCerto ? redeCompreCerto.nome : this.bases[0].nome;
        }

        this.carregandoBases = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.carregandoBases = false;
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
      this.erro = `JSON inválido: ${error.message}`;
      this.cdr.detectChanges();
      return;
    }

    if (!this.rede) {
      this.erro = 'Selecione uma rede/base antes de validar.';
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
        cnpjDistribuidor: '61940292001290',
        cnpjCliente: '19606664000127',
        cotacaoCotefacil: 11765944,
        pedidoCotefacil: 50179963,
        pedidoCliente: 11765944,
        idCampanha: 58,
        nomeCampanha: 'OL SERVIER - JANEIRO 2025',
        idOL: 58,
        codigoPrazoCd: '1',
        descricaoPrazoCd: '',
        quantidadeParcelaPrazo: '',
        diasParcelaPrazo: '',
        totalPrazo: ''
      },
      produtos: [
        {
          idItemPedido: 1,
          EAN: '7898029557154',
          codigoProduto: 6885,
          descricaoProduto: 'PROCORALAN 7,5MG CX 56 COMP',
          qtdeSolicitada: 2,
          valorUnitarioProduto: 148.75
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
