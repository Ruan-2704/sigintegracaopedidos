import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService, ServicoStatus } from '../../services/service';

@Component({
  selector: 'app-servicos',
  templateUrl: './servicos.html',
  styleUrls: ['./servicos.scss']
})
export class ServicosComponent implements OnInit, OnDestroy {
  private readonly cacheKeyServicos = 'sig_integracao_servicos_cache';
  private readonly cacheKeyLogs = 'sig_integracao_servicos_logs_cache';
  servicos: ServicoStatus[] = [];
  servicoLogSelecionado = 'geracao';
  logs: string[] = [];
  carregando = false;
  carregandoLogs = false;
  erro = '';
  ultimaAtualizacao: Date | null = null;
  private timer?: number;
  private logsStream?: EventSource;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.restaurarCacheLocal();
    this.carregar(!this.servicos.length);
    this.timer = window.setInterval(() => this.carregar(false), 60000);
  }

  ngOnDestroy(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.fecharStreamLogs();
  }

  private normalizarServicos(data: any): ServicoStatus[] {
    if (Array.isArray(data)) {
      return data.map((item: any) => this.normalizarItem(item?.chave, item)).filter(Boolean) as ServicoStatus[];
    }

    const obj = data || {};
    return [
      this.normalizarItem('geracao', obj.geracao),
      this.normalizarItem('exclusao', obj.exclusao),
      this.normalizarItem('pedidos', obj.pedidos),
    ].filter(Boolean) as ServicoStatus[];
  }

  private normalizarItem(chavePadrao: string, item: any): ServicoStatus | null {
    if (!item) return null;

    const chave = item.chave || chavePadrao;

    return {
      chave,
      nome: item.nome || this.nomePadrao(chave),
      porta: item.porta,
      servidor: item.servidor,
      online: !!item.online,
      pids: Array.isArray(item.pids) ? item.pids : [],
      emExecucaoPainel: !!(item.emExecucaoPainel || item.rodandoPainel || item.pidPainel),
      pidPainel: item.pidPainel || null,
      script: item.script || item.scriptPath || null,
      jar: item.jar || item.jarPath || null,
    };
  }

  private nomePadrao(chave: string): string {
    if (chave === 'geracao') return 'Geração de arquivos';
    if (chave === 'exclusao') return 'Exclusão de arquivos';
    if (chave === 'pedidos') return 'API inserção de pedidos';
    return chave;
  }

  carregar(mostrarLoading = true, force = false): void {
    if (mostrarLoading && !this.servicos.length) this.carregando = true;

    this.service.getServicosStatus(force).subscribe({
      next: (res: any) => {
        this.servicos = this.normalizarServicos(res.data);
        this.salvarCacheLocalServicos();

        if (!this.servicos.find((item) => item.chave === this.servicoLogSelecionado) && this.servicos.length) {
          this.servicoLogSelecionado = this.servicos[0].chave;
        }

        this.ultimaAtualizacao = new Date();
        this.carregando = false;
        this.erro = '';
        if (!this.logsStream) {
          this.conectarStreamLogs();
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Erro ao consultar status dos serviços.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  iniciar(servico: string): void {
    if (!confirm(`Confirmar início do serviço: ${this.nomePadrao(servico)}?`)) return;
    this.carregando = true;
    this.service.iniciarServico(servico).subscribe({
      next: () => {
        this.servicoLogSelecionado = servico;
        this.carregando = false;
        this.carregar();
        this.conectarStreamLogs();
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Erro ao iniciar serviço.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  parar(servico: string): void {
    if (!confirm(`Confirmar parada do serviço: ${this.nomePadrao(servico)}?`)) return;
    this.carregando = true;
    this.service.pararServico(servico).subscribe({
      next: () => {
        setTimeout(() => {
          this.carregando = false;
          this.carregar(true, true);
        }, 1200);
      },
      error: (err) => {
        console.error('Erro ao parar serviço:', err);
        this.erro = err?.error?.message || 'Erro ao parar serviço.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  selecionarLog(chave: string): void {
    this.servicoLogSelecionado = chave;
    this.restaurarCacheLocalLogs();
    this.conectarStreamLogs();
  }

  carregarLogs(mostrarErro = true): void {
    if (!this.servicoLogSelecionado) return;
    this.carregandoLogs = true;

    this.service.getLogsServico(this.servicoLogSelecionado, 300).subscribe({
      next: (res: any) => {
        const data = res.data;
        this.logs = Array.isArray(data) ? data.filter(Boolean) : String(res.content || '').split('\n').filter(Boolean);
        this.salvarCacheLocalLogs();
        this.carregandoLogs = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (mostrarErro) this.erro = err?.error?.message || 'Erro ao carregar logs do serviço.';
        this.carregandoLogs = false;
        this.cdr.detectChanges();
      }
    });
  }

  conectarStreamLogs(): void {
    if (!this.servicoLogSelecionado) return;

    this.fecharStreamLogs();
    this.carregandoLogs = true;

    try {
      const stream = this.service.streamLogsServico(this.servicoLogSelecionado);
      this.logsStream = stream;

      stream.onmessage = (event) => {
        const payload = JSON.parse(event.data || '{}');

        if (Array.isArray(payload.linhas)) {
          this.logs = payload.linhas.filter(Boolean);
          this.salvarCacheLocalLogs();
        }

        if (Array.isArray(payload.novasLinhas) && payload.novasLinhas.length) {
          this.logs = [...this.logs, ...payload.novasLinhas.filter(Boolean)].slice(-500);
          this.salvarCacheLocalLogs();
        }

        this.carregandoLogs = false;
        this.cdr.detectChanges();
      };

      stream.onerror = () => {
        this.fecharStreamLogs();
        this.carregarLogs(false);
      };
    } catch {
      this.carregarLogs(false);
    }
  }

  private fecharStreamLogs(): void {
    if (this.logsStream) {
      this.logsStream.close();
      this.logsStream = undefined;
    }
  }

  trackServico(_: number, item: ServicoStatus): string {
    return item.chave;
  }

  private restaurarCacheLocal(): void {
    try {
      const cacheServicos = JSON.parse(localStorage.getItem(this.cacheKeyServicos) || 'null');

      if (cacheServicos?.data) {
        this.servicos = this.normalizarServicos(cacheServicos.data);
        this.ultimaAtualizacao = cacheServicos.atualizadoEm ? new Date(cacheServicos.atualizadoEm) : null;
      }

      this.restaurarCacheLocalLogs();
    } catch {
      localStorage.removeItem(this.cacheKeyServicos);
      localStorage.removeItem(this.cacheKeyLogs);
    }
  }

  private salvarCacheLocalServicos(): void {
    localStorage.setItem(this.cacheKeyServicos, JSON.stringify({
      data: this.servicos,
      atualizadoEm: new Date().toISOString()
    }));
  }

  private salvarCacheLocalLogs(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyLogs) || '{}');
      cache[this.servicoLogSelecionado] = {
        logs: this.logs.slice(-500),
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKeyLogs, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKeyLogs);
    }
  }

  private restaurarCacheLocalLogs(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyLogs) || '{}');
      const item = cache?.[this.servicoLogSelecionado];

      if (Array.isArray(item?.logs)) {
        this.logs = item.logs;
      }
    } catch {
      localStorage.removeItem(this.cacheKeyLogs);
    }
  }
}
