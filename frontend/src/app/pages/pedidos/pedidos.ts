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
  private readonly cacheKey = 'sig_integracao_pedidos_cache';
  private readonly detalheCacheKey = 'sig_integracao_pedidos_detalhe_cache';
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
  ngOnInit(): void {
    this.restaurarCacheLocal();
    this.carregar();
  }

  carregar(force = false): void {
    const temCache = !force && this.restaurarCacheLocal();

    if (!force && !temCache) {
      this.pedidos = [];
      this.totalRegistros = 0;
      this.totalPaginas = 1;
    }

    this.carregando = !this.pedidos.length;
    this.erro = '';
    this.service.getPedidos({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro,
      campanha: this.filtroCampanha,
      cnpj: this.filtroCnpj,
      integradora: this.filtroIntegradora,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
      force
    }).subscribe({
      next: (res) => {
        this.pedidos = res.data || [];
        this.totalRegistros = res.meta?.total || 0;
        this.totalPaginas = res.meta?.totalPages || 1;
        this.ultimaAtualizacao = new Date();
        this.salvarCacheLocal();
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
    const cache = this.obterCacheDetalhes();
    const detalheSalvo = cache?.[item.codigo];

    if (detalheSalvo?.data) {
      this.selecionado = detalheSalvo.data;
      this.cdr.detectChanges();
    }

    this.carregando = !this.selecionado;
    this.service.getPedidoDetalhe(item.codigo).subscribe({
      next: (res) => {
        this.selecionado = res;
        this.salvarCacheDetalhe(item.codigo, res);
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => { console.error(err); this.carregando = false; this.cdr.detectChanges(); }
    });
  }

  fechar(): void { this.selecionado = null; this.cdr.detectChanges(); }
  paginaAnterior(): void { if (this.paginaAtual > 1) { this.paginaAtual--; this.carregar(); } }
  proximaPagina(): void { if (this.paginaAtual < this.totalPaginas) { this.paginaAtual++; this.carregar(); } }

  private cacheId(): string {
    return JSON.stringify({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro || '',
      campanha: this.filtroCampanha || '',
      cnpj: this.filtroCnpj || '',
      integradora: this.filtroIntegradora || '',
      dataInicio: this.dataInicio || '',
      dataFim: this.dataFim || ''
    });
  }

  private restaurarCacheLocal(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      const item = cache?.[this.cacheId()];

      if (item?.data) {
        this.pedidos = item.data || [];
        this.totalRegistros = item.meta?.total || 0;
        this.totalPaginas = item.meta?.totalPages || 1;
        this.ultimaAtualizacao = item.atualizadoEm ? new Date(item.atualizadoEm) : null;
        return true;
      }
    } catch {
      localStorage.removeItem(this.cacheKey);
    }

    return false;
  }

  private salvarCacheLocal(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      cache[this.cacheId()] = {
        data: this.pedidos,
        meta: {
          total: this.totalRegistros,
          totalPages: this.totalPaginas
        },
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKey);
    }
  }

  private obterCacheDetalhes(): any {
    try {
      return JSON.parse(localStorage.getItem(this.detalheCacheKey) || '{}');
    } catch {
      localStorage.removeItem(this.detalheCacheKey);
      return {};
    }
  }

  private salvarCacheDetalhe(codigo: number, data: any): void {
    try {
      const cache = this.obterCacheDetalhes();
      cache[codigo] = {
        data,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.detalheCacheKey, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.detalheCacheKey);
    }
  }
}
