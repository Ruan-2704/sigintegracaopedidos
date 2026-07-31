import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-auditoria',
  templateUrl: './auditoria.html',
  styleUrls: ['./auditoria.scss']
})
export class AuditoriaComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_auditoria_cache';
  acoes: any[] = [];
  carregando = false;
  erro = '';
  filtroAcao = '';
  filtroStatus = '';
  ultimaAtualizacao: Date | null = null;
  limite = 50;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.restaurarCacheLocal();
    this.carregar();
  }

  carregar(force = false): void {
    const temCache = !force && this.restaurarCacheLocal();

    if (!force && !temCache) {
      this.acoes = [];
    }

    this.carregando = force || !this.acoes.length;
    this.erro = '';

    this.service.getAcoesPainel({
      limit: this.limite,
      acao: this.filtroAcao,
      status: this.filtroStatus,
      force
    }).subscribe({
      next: (res) => {
        this.acoes = res.data || [];
        this.ultimaAtualizacao = new Date();
        this.salvarCacheLocal();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar ações do painel:', err);
        this.erro = 'Erro ao carregar ações do painel.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltro(): void {
    this.carregar();
  }

  limparFiltro(): void {
    this.filtroAcao = '';
    this.filtroStatus = '';
    this.limite = 50;
    this.carregar();
  }

  formatarDetalhe(detalhe: any): string {
    if (!detalhe) return '-';

    if (typeof detalhe !== 'string') {
      return JSON.stringify(detalhe, null, 2);
    }

    try {
      return JSON.stringify(JSON.parse(detalhe), null, 2);
    } catch {
      return detalhe;
    }
  }

  private cacheId(): string {
    return JSON.stringify({
      acao: this.filtroAcao || '',
      status: this.filtroStatus || '',
      limit: this.limite
    });
  }

  private restaurarCacheLocal(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      const item = cache?.[this.cacheId()];

      if (item?.data) {
        this.acoes = item.data || [];
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
        data: this.acoes,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKey);
    }
  }
}
