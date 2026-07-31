import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-logs',
  templateUrl: './logs.html',
  styleUrls: ['./logs.scss']
})
export class LogsComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_logs_cache';
  logs: any[] = [];
  carregando = false;
  erro = '';
  filtro = '';
  ultimaAtualizacao: Date | null = null;
  paginaAtual = 1;
  itensPorPagina = 20;
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
      this.logs = [];
      this.totalRegistros = 0;
      this.totalPaginas = 1;
    }

    this.carregando = !this.logs.length;
    this.erro = '';
    this.service.getLogs({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro,
      force
    }).subscribe({
      next: (res) => {
        this.logs = res.data || [];
        this.totalRegistros = res.meta?.total || this.logs.length;
        this.totalPaginas = res.meta?.totalPages || 1;
        this.ultimaAtualizacao = new Date();
        this.salvarCacheLocal();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar logs:', err);
        this.erro = 'Erro ao carregar logs operacionais.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltro(): void { this.paginaAtual = 1; this.carregar(); }
  limparFiltro(): void { this.filtro = ''; this.paginaAtual = 1; this.carregar(); }
  paginaAnterior(): void { if (this.paginaAtual > 1) { this.paginaAtual--; this.carregar(); } }
  proximaPagina(): void { if (this.paginaAtual < this.totalPaginas) { this.paginaAtual++; this.carregar(); } }

  private cacheId(): string {
    return JSON.stringify({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro || ''
    });
  }

  private restaurarCacheLocal(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      const item = cache?.[this.cacheId()];

      if (item?.data) {
        this.logs = item.data || [];
        this.totalRegistros = item.meta?.total || this.logs.length;
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
        data: this.logs,
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
}
