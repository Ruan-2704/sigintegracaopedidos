import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-pedidos',
  templateUrl: './pedidos.html',
  styleUrls: ['./pedidos.scss']
})
export class PedidosComponent implements OnInit {
  pedidos: any[] = [];
  selecionado: any = null;
  carregando = false;
  erro = '';
  filtro = '';
  filtroCampanha = '';
  filtroCnpj = '';
  filtroIntegradora = '';
  dataInicio = '';
  dataFim = '';
  ultimaAtualizacao: Date | null = null;
  paginaAtual = 1;
  itensPorPagina = 10;
  totalRegistros = 0;
  totalPaginas = 1;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}
  ngOnInit(): void { this.carregar(); }

  carregar(): void {
    this.carregando = true;
    this.erro = '';
    this.service.getPedidos({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro,
      campanha: this.filtroCampanha,
      cnpj: this.filtroCnpj,
      integradora: this.filtroIntegradora,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim
    }).subscribe({
      next: (res) => {
        this.pedidos = res.data || [];
        this.totalRegistros = res.meta?.total || 0;
        this.totalPaginas = res.meta?.totalPages || 1;
        this.ultimaAtualizacao = new Date();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar pedidos:', err);
        this.erro = 'Erro ao carregar pedidos.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltro(): void { this.paginaAtual = 1; this.carregar(); }
  limparFiltro(): void {
    this.filtro = '';
    this.filtroCampanha = '';
    this.filtroCnpj = '';
    this.filtroIntegradora = '';
    this.dataInicio = '';
    this.dataFim = '';
    this.paginaAtual = 1;
    this.carregar();
  }
  alterarItensPorPagina(): void { this.paginaAtual = 1; this.carregar(); }

  visualizar(item: any): void {
    this.carregando = true;
    this.service.getPedidoDetalhe(item.codigo).subscribe({
      next: (res) => { this.selecionado = res; this.carregando = false; this.cdr.detectChanges(); },
      error: (err) => { console.error(err); this.carregando = false; this.cdr.detectChanges(); }
    });
  }

  fechar(): void { this.selecionado = null; this.cdr.detectChanges(); }
  paginaAnterior(): void { if (this.paginaAtual > 1) { this.paginaAtual--; this.carregar(); } }
  proximaPagina(): void { if (this.paginaAtual < this.totalPaginas) { this.paginaAtual++; this.carregar(); } }
}
