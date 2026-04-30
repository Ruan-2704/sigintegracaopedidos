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
  arquivos: any[] = [];
  selecionado: any = null;
  previewArquivo: any = null;
  carregando = false;
  carregandoPreview = false;
  erro = '';
  filtro = '';
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
    this.service.getArquivos({ page: this.paginaAtual, limit: this.itensPorPagina, search: this.filtro }).subscribe({
      next: (res) => {
        this.arquivos = res.data || [];
        this.totalRegistros = res.meta?.total || 0;
        this.totalPaginas = res.meta?.totalPages || 1;
        this.ultimaAtualizacao = new Date();
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

  aplicarFiltro(): void { this.paginaAtual = 1; this.carregar(); }
  limparFiltro(): void { this.filtro = ''; this.paginaAtual = 1; this.carregar(); }
  alterarItensPorPagina(): void { this.paginaAtual = 1; this.carregar(); }

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
        this.previewArquivo = { erro: 'Não foi possível carregar a prévia do arquivo.' };
        this.carregandoPreview = false;
        this.cdr.detectChanges();
      }
    });
  }

  excluir(item: any): void {
    if (!confirm(`Deseja realmente excluir o arquivo ${item.nomeArquivo}?`)) return;
    this.carregando = true;
    this.service.excluirArquivo(item.nomeArquivo).subscribe({
      next: () => this.carregar(),
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
}
