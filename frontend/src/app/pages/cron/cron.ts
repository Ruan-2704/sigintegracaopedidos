import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-cron',
  templateUrl: './cron.html',
  styleUrls: ['./cron.scss']
})
export class CronComponent implements OnInit {
  private readonly cacheKeyLogsCron = 'sig_integracao_cron_logs_cache';
  private readonly cacheKeyCron = 'sig_integracao_crontab_cache';
  crontab = '';
  diagnosticoLogs: any[] = [];
  logsCron: any[] = [];
  logsCompletosAbertos: { [key: string]: boolean } = {};
  escritaLiberada = false;
  crontabCarregado = false;
  carregando = false;
  carregandoDiagnostico = false;
  carregandoLogs = false;
  erro = '';
  sucesso = '';
  linhasLog = 200;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.restaurarCacheCron();
    this.restaurarCacheLogsCron();
    this.carregar();
  }

  carregar(): void {
    this.carregando = true;
    this.erro = '';
    this.sucesso = '';
    this.service.getCron().subscribe({
      next: (res) => {
        this.crontab = res.data?.crontab || '';
        this.escritaLiberada = !!res.data?.escritaLiberada;
        this.crontabCarregado = true;
        this.salvarCacheCron();
        this.carregando = false;
        this.carregarDiagnosticoLogs();
        this.carregarLogsCron();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Erro ao carregar crontab.';
        this.crontabCarregado = true;
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  salvar(): void {
    if (!this.escritaLiberada) return;
    if (!confirm('Confirmar alteracao do crontab do servidor?')) return;

    this.carregando = true;
    this.service.salvarCron(this.crontab).subscribe({
      next: () => {
        this.sucesso = 'Crontab salvo com sucesso.';
        this.salvarCacheCron();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Erro ao salvar crontab.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  carregarDiagnosticoLogs(): void {
    this.carregandoDiagnostico = true;

    this.service.getDiagnosticoLogsCron().subscribe({
      next: (res) => {
        this.diagnosticoLogs = res.data || [];
        this.carregandoDiagnostico = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao diagnosticar logs do crontab:', err);
        this.carregandoDiagnostico = false;
        this.cdr.detectChanges();
      }
    });
  }

  carregarLogsCron(force = false): void {
    const temCache = !force && this.restaurarCacheLogsCron();

    if (!force && !temCache) {
      this.logsCron = [];
    }

    this.carregandoLogs = force || !this.logsCron.length;

    this.service.getLogsCron(this.linhasLog, force).subscribe({
      next: (res) => {
        this.logsCron = res.data || [];
        this.salvarCacheLogsCron();
        this.carregandoLogs = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar logs do crontab:', err);
        this.carregandoLogs = false;
        this.cdr.detectChanges();
      }
    });
  }

  melhorArquivoLog(item: any): any {
    return (item?.arquivos || []).find((arquivo: any) => arquivo.existe) || item?.arquivos?.[0] || null;
  }

  resumoLog(item: any): string {
    const linhas = item?.linhas || [];
    if (!linhas.length) return 'Nenhuma linha de log encontrada.';
    return linhas.slice(-this.linhasLog).join('\n');
  }

  eventosLog(item: any): any[] {
    return item?.resumo?.eventos || [];
  }

  alternarLogCompleto(chave: string): void {
    this.logsCompletosAbertos[chave] = !this.logsCompletosAbertos[chave];
    this.cdr.detectChanges();
  }

  statusResumo(item: any): string {
    if (!item?.arquivo?.existe) return 'Log não encontrado';
    if (item?.resumo?.erros) return `${item.resumo.erros} erro(s)`;
    if (item?.resumo?.alertas) return `${item.resumo.alertas} alerta(s)`;
    return `${item?.resumo?.totalEventos || 0} evento(s)`;
  }

  private restaurarCacheCron(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyCron) || 'null');

      if (cache?.crontab) {
        this.crontab = cache.crontab;
        this.escritaLiberada = !!cache.escritaLiberada;
        this.crontabCarregado = true;
      }
    } catch {
      localStorage.removeItem(this.cacheKeyCron);
    }
  }

  private salvarCacheCron(): void {
    try {
      localStorage.setItem(this.cacheKeyCron, JSON.stringify({
        crontab: this.crontab,
        escritaLiberada: this.escritaLiberada,
        atualizadoEm: new Date().toISOString()
      }));
    } catch {
      localStorage.removeItem(this.cacheKeyCron);
    }
  }

  private cacheIdLogsCron(): string {
    return String(this.linhasLog);
  }

  private restaurarCacheLogsCron(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyLogsCron) || '{}');
      const item = cache?.[this.cacheIdLogsCron()];

      if (item?.data) {
        this.logsCron = item.data || [];
        return true;
      }
    } catch {
      localStorage.removeItem(this.cacheKeyLogsCron);
    }

    return false;
  }

  private salvarCacheLogsCron(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyLogsCron) || '{}');
      cache[this.cacheIdLogsCron()] = {
        data: this.logsCron,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKeyLogsCron, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKeyLogsCron);
    }
  }
}
