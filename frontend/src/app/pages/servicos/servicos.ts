import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { IntegracaoService, ServicoStatus } from '../../services/service';

type LogMode = 'ultimo' | 'aovivo' | 'pausado';

interface LogCacheItem {
  logs: string[];
  atualizadoEm: string;
  meta?: any;
  diagnostico?: any;
}

@Component({
  selector: 'app-servicos',
  templateUrl: './servicos.html',
  styleUrls: ['./servicos.scss']
})
export class ServicosComponent implements OnInit, OnDestroy {
  private readonly cacheKeyServicos = 'sig_integracao_servicos_cache';
  private readonly cacheKeyLogs = 'sig_integracao_servicos_logs_cache';
  private readonly logCacheTtlMs = 60000;
  servicos: ServicoStatus[] = [];
  servicoLogSelecionado = 'geracao';
  logs: string[] = [];
  logMeta: any = null;
  diagnosticoLogs: any[] = [];
  carregando = false;
  carregandoLogs = false;
  erro = '';
  modoLog: LogMode = 'ultimo';
  terminalAberto = false;
  ultimaAtualizacao: Date | null = null;
  ultimaAtualizacaoLog: Date | null = null;
  executionIds: Record<string, string> = {};
  private timer?: number;
  private logsStream?: EventSource;

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.restaurarCacheLocal();
    this.carregar(!this.servicos.length);
    this.carregarDiagnosticoLogs(false);
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

  nomePadrao(chave: string): string {
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
      next: (res: any) => {
        this.servicoLogSelecionado = servico;
        this.executionIds[servico] = res?.data?.executionId || '';
        this.terminalAberto = true;
        this.limparTerminal(false);
        this.carregando = false;
        this.carregar(true, true);
        this.carregarDiagnosticoLogs(false);
        this.ativarAoVivo(true);
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
    this.terminalAberto = true;
    this.modoLog = 'ultimo';
    this.fecharStreamLogs();

    const temCacheValido = this.restaurarCacheLocalLogs(true);
    this.carregarLogs(!temCacheValido, !temCacheValido);
  }

  carregarLogs(mostrarErro = true, force = false): void {
    if (!this.servicoLogSelecionado) return;

    if (!force && this.restaurarCacheLocalLogs(true)) {
      this.carregandoLogs = false;
      return;
    }

    this.carregandoLogs = true;

    this.service.getLogsServico(this.servicoLogSelecionado, 300, force, this.executionIdAtual()).subscribe({
      next: (res: any) => {
        const data = res.data;
        this.logs = Array.isArray(data) ? data.filter(Boolean) : String(res.content || '').split('\n').filter(Boolean);
        this.logMeta = res.meta || null;
        if (this.logMeta?.executionId) {
          this.executionIds[this.servicoLogSelecionado] = this.logMeta.executionId;
        }
        this.ultimaAtualizacaoLog = new Date();
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

  atualizarLog(): void {
    this.terminalAberto = true;
    this.fecharStreamLogs();
    this.modoLog = 'ultimo';
    this.carregarLogs(true, true);
  }

  ativarAoVivo(ignorarCache = false): void {
    if (!this.servicoLogSelecionado) return;

    this.terminalAberto = true;
    this.modoLog = 'aovivo';
    if (!ignorarCache) {
      this.restaurarCacheLocalLogs(false);
    }
    this.conectarStreamLogs();
  }

  pausarLog(): void {
    this.fecharStreamLogs();
    this.modoLog = 'pausado';
    this.carregandoLogs = false;
  }

  limparTerminal(salvar = true): void {
    this.logs = [];
    this.logMeta = null;
    this.ultimaAtualizacaoLog = null;
    if (salvar) {
      this.salvarCacheLocalLogs();
    }
  }

  carregarDiagnosticoLogs(mostrarErro = true): void {
    this.service.getDiagnosticoLogsCron().subscribe({
      next: (res: any) => {
        this.diagnosticoLogs = res.data || [];
        this.salvarCacheLocalLogs();
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (mostrarErro) this.erro = err?.error?.message || 'Erro ao diagnosticar logs do crontab.';
      }
    });
  }

  diagnosticoLogSelecionado(): any {
    return this.diagnosticoLogs.find((item) => item.chave === this.servicoLogSelecionado) || null;
  }

  executionIdAtual(): string | null {
    return this.executionIds[this.servicoLogSelecionado] || this.logMeta?.executionId || null;
  }

  arquivoLogPrincipal(): any {
    const diagnostico = this.diagnosticoLogSelecionado();
    if (!diagnostico?.arquivos?.length) return null;
    return diagnostico.arquivos.find((arquivo: any) => arquivo.existe && arquivo.source === 'crontab')
      || diagnostico.arquivos.find((arquivo: any) => arquivo.existe)
      || diagnostico.arquivos[0];
  }

  resumoOperacional(): any {
    const linhas = this.logs.filter(Boolean);
    const inicio = linhas.find((linha) => /(SIG_PANEL_START|iniciando|inicio|início|starting|INICIO PROCESSAMENTO)/i.test(linha || ''));
    const finalizacao = [...linhas].reverse().find((linha) => /(finalizado|finalizada|concluido|concluído|started .* in|FIM PROCESSAMENTO)/i.test(linha || ''));
    const fila = linhas.find((linha) => /Nenhuma OL na fila/i.test(linha || ''));
    const quantidadeOls = this.extrairValorResumo(/Quantidade de OLS:\s*(\d+)/i);
    const olsUnicas = this.extrairValorResumo(/OLS unicas.*?:\s*(\d+)/i);
    const registrosBrutos = this.extrairValorResumo(/total registros brutos:\s*(\d+)/i);
    const arquivos = linhas.filter((linha) => /\.json\b/i.test(linha || '') && /(arquivo|gerad|bucket|disponivel|disponível)/i.test(linha || '')).length;
    const erros = this.resumoErros();
    const ultimoEvento = [...linhas].reverse().find((linha) => !this.linhaRuidoResumo(linha));

    return {
      inicio: this.formatarInicioResumo(inicio),
      finalizacao: finalizacao || fila || '-',
      quantidadeOls: quantidadeOls ?? '-',
      olsUnicas: olsUnicas ?? '-',
      registrosBrutos: registrosBrutos ?? '-',
      arquivos,
      erros,
      status: erros ? 'Verificar erros' : (fila ? 'Sem OL na fila' : 'Operacional'),
      ultimoEvento: ultimoEvento || '-',
    };
  }

  private extrairValorResumo(regex: RegExp): string | null {
    for (const linha of this.logs) {
      const match = String(linha || '').match(regex);
      if (match?.[1]) return match[1];
    }

    return null;
  }

  private formatarInicioResumo(linha?: string): string {
    if (!linha) return '-';

    const data = String(linha).match(/data=([^\s]+)/)?.[1];
    const executionId = String(linha).match(/executionId=([^\s]+)/)?.[1];

    if (!data) return linha;

    const quando = new Date(data);
    const hora = Number.isNaN(quando.getTime())
      ? data
      : `${quando.toLocaleDateString('pt-BR')} ${quando.toLocaleTimeString('pt-BR')}`;

    return executionId ? `${hora} (${executionId})` : hora;
  }

  private linhaRuidoResumo(linha: string): boolean {
    return /^\s*$/.test(linha || '') || /^[-=_]+$/.test(linha || '');
  }

  resumoErros(): number {
    return this.logs.filter((linha) => this.linhaErro(linha)).length;
  }

  linhaErro(linha: string): boolean {
    return /(exception|erro|error|falha|failed|timeout|timed out|refused|unauthorized|nullpointer|sqlexception)/i.test(linha || '');
  }

  linhaAlerta(linha: string): boolean {
    return !this.linhaErro(linha) && /(warn|warning|alerta|atenção|atencao)/i.test(linha || '');
  }

  trackServico(_: number, item: ServicoStatus): string {
    return item.chave;
  }

  trackLinha(index: number): number {
    return index;
  }

  private conectarStreamLogs(): void {
    if (!this.servicoLogSelecionado) return;

    this.fecharStreamLogs();
    this.carregandoLogs = !this.logs.length;

    try {
      const stream = this.service.streamLogsServico(this.servicoLogSelecionado, this.executionIdAtual());
      this.logsStream = stream;

      stream.onmessage = (event) => {
        const payload = JSON.parse(event.data || '{}');

        if (Array.isArray(payload.linhas)) {
          this.logs = payload.linhas.filter(Boolean);
        }

        if (Array.isArray(payload.novasLinhas) && payload.novasLinhas.length) {
          this.logs = [...this.logs, ...payload.novasLinhas.filter(Boolean)].slice(-500);
        }

        if (payload.meta) {
          this.logMeta = payload.meta;
          if (payload.meta.executionId) {
            this.executionIds[this.servicoLogSelecionado] = payload.meta.executionId;
          }
        }

        this.ultimaAtualizacaoLog = new Date();
        this.salvarCacheLocalLogs();
        this.carregandoLogs = false;
        this.cdr.detectChanges();
      };

      stream.onerror = () => {
        this.fecharStreamLogs();
        if (this.modoLog === 'aovivo') {
          this.modoLog = 'pausado';
        }
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

  private restaurarCacheLocal(): void {
    try {
      const cacheServicos = JSON.parse(localStorage.getItem(this.cacheKeyServicos) || 'null');

      if (cacheServicos?.data) {
        this.servicos = this.normalizarServicos(cacheServicos.data);
        this.ultimaAtualizacao = cacheServicos.atualizadoEm ? new Date(cacheServicos.atualizadoEm) : null;
      }

      this.restaurarCacheLocalLogs(false);
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
        meta: this.logMeta,
        diagnostico: this.diagnosticoLogSelecionado(),
        atualizadoEm: new Date().toISOString()
      };
      cache.__diagnostico = this.diagnosticoLogs;
      cache.__executionIds = this.executionIds;
      localStorage.setItem(this.cacheKeyLogs, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKeyLogs);
    }
  }

  private restaurarCacheLocalLogs(exigirValidade: boolean): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyLogs) || '{}');
      const item: LogCacheItem = cache?.[this.servicoLogSelecionado];

      if (Array.isArray(cache?.__diagnostico)) {
        this.diagnosticoLogs = cache.__diagnostico;
      }

      if (cache?.__executionIds && typeof cache.__executionIds === 'object') {
        this.executionIds = cache.__executionIds;
      }

      if (!Array.isArray(item?.logs)) {
        return false;
      }

      const atualizadoEm = item.atualizadoEm ? new Date(item.atualizadoEm) : null;
      const cacheValido = Boolean(atualizadoEm && Date.now() - atualizadoEm.getTime() < this.logCacheTtlMs);

      if (exigirValidade && !cacheValido) {
        this.logs = item.logs;
        this.logMeta = item.meta || null;
        this.ultimaAtualizacaoLog = atualizadoEm;
        return false;
      }

      this.logs = item.logs;
      this.logMeta = item.meta || null;
      this.ultimaAtualizacaoLog = atualizadoEm;
      return cacheValido || !exigirValidade;
    } catch {
      localStorage.removeItem(this.cacheKeyLogs);
      return false;
    }
  }
}
