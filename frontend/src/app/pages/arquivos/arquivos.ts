import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-arquivos',
  templateUrl: './arquivos.html',
  styleUrls: ['./arquivos.scss']
})
export class ArquivosComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_arquivos_cache';
  arquivos: any[] = [];
  selecionado: any = null;
  previewArquivo: any = null;
  carregando = false;
  carregandoPreview = false;
  erro = '';
  filtro = '';
  ultimaAtualizacao: Date | null = null;
  paginaAtual = 1;
  itensPorPagina = 200;
  totalRegistros = 0;
  totalPaginas = 1;
  ordenarCampo = 'atualizadoEm';
  ordenarDirecao: 'asc' | 'desc' = 'desc';

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    const search = new URLSearchParams(window.location.search).get('search');
    if (search) {
      this.filtro = search;
      this.paginaAtual = 1;
    }
    this.restaurarCacheLocal();
    this.carregar(Boolean(search));
  }

  carregar(force = false): void {
    const temCache = !force && this.restaurarCacheLocal();

    if (!force && !temCache) {
      this.arquivos = [];
      this.totalRegistros = 0;
      this.totalPaginas = 1;
    }

    this.carregando = !this.arquivos.length;
    this.erro = '';
    this.service.getArquivos({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro,
      force
    }).subscribe({
      next: (res) => {
        this.arquivos = this.aplicarOrdenacao(res.data || []);
        this.totalRegistros = res.meta?.total || 0;
        this.totalPaginas = res.meta?.totalPages || 1;
        this.ultimaAtualizacao = new Date();
        this.salvarCacheLocal();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar arquivos:', err);
        this.erro = 'Erro ao carregar arquivos do bucket.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltro(): void { this.paginaAtual = 1; this.carregar(true); }
  limparFiltro(): void { this.filtro = ''; this.paginaAtual = 1; this.carregar(true); }
  alterarItensPorPagina(): void { this.paginaAtual = 1; this.carregar(true); }

  ordenarPor(campo: string): void {
    if (this.ordenarCampo === campo) {
      this.ordenarDirecao = this.ordenarDirecao === 'asc' ? 'desc' : 'asc';
    } else {
      this.ordenarCampo = campo;
      this.ordenarDirecao = 'asc';
    }

    this.arquivos = this.aplicarOrdenacao(this.arquivos);
    this.salvarCacheLocal();
    this.cdr.detectChanges();
  }

  indicadorOrdenacao(campo: string): string {
    if (this.ordenarCampo !== campo) return '';
    return this.ordenarDirecao === 'asc' ? '↑' : '↓';
  }

  private aplicarOrdenacao(lista: any[]): any[] {
    const direcao = this.ordenarDirecao === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = this.valorOrdenacao(a, this.ordenarCampo);
      const vb = this.valorOrdenacao(b, this.ordenarCampo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * direcao;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' }) * direcao;
    });
  }

  private valorOrdenacao(item: any, campo: string): any {
    const mapa: any = {
      nomeArquivo: item?.nomeArquivo || '',
      campanha: item?.campanha || '',
      tamanhoBytes: Number(item?.tamanhoBytes || 0),
      criadoEm: new Date(item?.criadoEm || 0).getTime(),
      atualizadoEm: new Date(item?.atualizadoEm || 0).getTime()
    };

    return mapa[campo] ?? '';
  }

  formatarTamanho(bytes: number): string {
    if (!bytes) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }

  visualizar(item: any): void {
    this.selecionado = item;
    this.previewArquivo = null;
    this.carregandoPreview = true;
    this.service.getArquivoPreview(item.nomeArquivo).subscribe({
      next: (res) => {
        this.previewArquivo = res;
        this.carregandoPreview = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao visualizar arquivo:', err);
        this.previewArquivo = { erro: 'Nao foi possivel carregar a previa do arquivo.' };
        this.carregandoPreview = false;
        this.cdr.detectChanges();
      }
    });
  }

  excluir(item: any): void {
    if (!confirm(`Deseja realmente excluir o arquivo ${item.nomeArquivo}?`)) return;
    this.carregando = true;
    this.service.excluirArquivo(item.nomeArquivo).subscribe({
      next: () => this.carregar(true),
      error: (err) => {
        console.error('Erro ao excluir arquivo:', err);
        this.erro = 'Erro ao excluir arquivo.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  fechar(): void { this.selecionado = null; this.previewArquivo = null; this.cdr.detectChanges(); }
  paginaAnterior(): void { if (this.paginaAtual > 1) { this.paginaAtual--; this.carregar(); } }
  proximaPagina(): void { if (this.paginaAtual < this.totalPaginas) { this.paginaAtual++; this.carregar(); } }

  private cacheId(): string {
    return JSON.stringify({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro || '',
      ordenarCampo: this.ordenarCampo || '',
      ordenarDirecao: this.ordenarDirecao || ''
    });
  }

  private restaurarCacheLocal(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      const item = cache?.[this.cacheId()];

      if (item?.data) {
        this.arquivos = this.aplicarOrdenacao(item.data || []);
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
        data: this.arquivos,
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
