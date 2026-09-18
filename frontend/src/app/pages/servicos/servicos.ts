import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IntegracaoService, ServicoStatus } from '../../services/service';

type LogMode = 'aovivo';

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
export class ServicosComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('terminalRef') terminalRef?: ElementRef<HTMLElement>;
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
  modoLog: LogMode = 'aovivo';
  terminalAberto = false;
  filtroLogTexto = '';
  filtroLogDias: number | null = null;
  ultimaAtualizacao: Date | null = null;
  ultimaAtualizacaoLog: Date | null = null;
  executionIds: Record<string, string> = {};
  editorAberto = false;
  editorCarregando = false;
  editorSalvando = false;
  editorServico: ServicoStatus | null = null;
  editorConteudo = '';
  editorErro = '';
  editorMeta: any = null;
  editorTipo: 'script' | 'cron' = 'script';
  arquivosGeradosModalAberto = false;
  private timer?: number;
  private logsStream?: EventSource;
  private deveRolarTerminal = false;
  private seguirTerminal = false;

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

  ngAfterViewChecked(): void {
    if (!this.deveRolarTerminal) return;

    this.deveRolarTerminal = false;
    this.rolarTerminalParaBaixo();
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
      statusOperacional: item.statusOperacional || null,
      pids: Array.isArray(item.pids) ? item.pids : [],
      emExecucaoPainel: !!(item.emExecucaoPainel || item.rodandoPainel || item.pidPainel),
      pidPainel: item.pidPainel || null,
      script: item.script || item.scriptPath || null,
      jar: item.jar || item.jarPath || null,
    };
  }
  private marcarServicoIniciando(chave: string): void {
    this.servicos = this.servicos.map((item) => item.chave === chave
      ? { ...item, online: false, statusOperacional: 'iniciando', emExecucaoPainel: true }
      : item);
    this.ultimaAtualizacao = new Date();
    this.cdr.detectChanges();
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
        this.marcarServicoIniciando(servico);
        this.limparTerminal(false);
        this.carregando = false;
        this.carregarDiagnosticoLogs(false);
        this.ativarAoVivo(true);
        window.setTimeout(() => this.carregar(false, true), 8000);
        window.setTimeout(() => this.carregar(false, true), 20000);
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
    this.modoLog = 'aovivo';
    this.restaurarCacheLocalLogs(false);
    this.ativarAoVivo(true);
  }

  carregarLogs(mostrarErro = true, force = false): void {
    if (!this.servicoLogSelecionado) return;

    if (!this.filtrosLogAtivos() && !force && this.restaurarCacheLocalLogs(true)) {
      this.carregandoLogs = false;
      return;
    }

    this.carregandoLogs = true;

    this.service.getLogsServico(this.servicoLogSelecionado, 300, force, this.executionIdAtual(), this.filtrosLog()).subscribe({
      next: (res: any) => {
        const data = res.data;
        this.logs = Array.isArray(data) ? data.filter(Boolean) : String(res.content || '').split('\n').filter(Boolean);
        this.logMeta = res.meta || null;
        if (this.logMeta?.executionId) {
          this.executionIds[this.servicoLogSelecionado] = this.logMeta.executionId;
        }
        this.ultimaAtualizacaoLog = new Date();
        if (!this.filtrosLogAtivos()) {
          this.salvarCacheLocalLogs();
        }
        this.carregandoLogs = false;
        this.agendarRolagemTerminal();
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
    this.filtroLogTexto = '';
    this.filtroLogDias = null;
    this.ativarAoVivo(true);
  }

  aplicarFiltroLog(): void {
    if (!this.servicoLogSelecionado) return;

    this.terminalAberto = true;
    this.fecharStreamLogs();
    this.carregarLogs(true, true);
  }

  limparFiltroLog(): void {
    this.filtroLogTexto = '';
    this.filtroLogDias = null;
    this.ativarAoVivo(true);
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

  abrirEditorCrontab(): void {
    this.editorTipo = 'cron';
    this.editorAberto = true;
    this.editorCarregando = true;
    this.editorSalvando = false;
    this.editorServico = null;
    this.editorConteudo = '';
    this.editorErro = '';
    this.editorMeta = { script: 'crontab', path: 'Crontab do servidor' };

    this.service.getCron().subscribe({
      next: (res: any) => {
        const data = res.data || {};
        this.editorConteudo = data.crontab || data.content || '';
        this.editorMeta = {
          script: 'crontab',
          path: 'Crontab do servidor',
          workdir: data.servidor || 'servidor da integracao',
          escritaLiberada: !!data.escritaLiberada
        };
        this.editorCarregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.editorErro = this.mensagemErroEditor(err, 'Erro ao carregar crontab.');
        this.editorCarregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  abrirEditorScript(item: ServicoStatus): void {
    if (!item.script) return;

    this.editorAberto = true;
    this.editorCarregando = true;
    this.editorSalvando = false;
    this.editorServico = item;
    this.editorConteudo = '';
    this.editorErro = '';
    this.editorMeta = null;

    this.service.getScriptServico(item.chave).subscribe({
      next: (res: any) => {
        const data = res.data || {};
        this.editorConteudo = data.content || '';
        this.editorMeta = data;
        this.editorCarregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.editorErro = this.mensagemErroEditor(err, 'Erro ao carregar script.');
        this.editorCarregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  fecharEditorScript(): void {
    this.editorAberto = false;
    this.editorCarregando = false;
    this.editorSalvando = false;
    this.editorServico = null;
    this.editorConteudo = '';
    this.editorErro = '';
    this.editorMeta = null;
    this.editorTipo = 'script';
  }

  salvarEditorScript(): void {
    if (this.editorSalvando) return;

    if (this.editorTipo === 'cron') {
      this.salvarEditorCrontab();
      return;
    }

    if (!this.editorServico) return;

    this.editorSalvando = true;
    this.editorErro = '';

    this.service.salvarScriptServico(this.editorServico.chave, this.editorConteudo).subscribe({
      next: (res: any) => {
        this.editorMeta = res.data || this.editorMeta;
        this.editorSalvando = false;
        this.fecharEditorScript();
        this.carregar(true, true);
      },
      error: (err) => {
        this.editorErro = this.mensagemErroEditor(err, 'Erro ao salvar script.');
        this.editorSalvando = false;
        this.cdr.detectChanges();
      }
    });
  }

  private salvarEditorCrontab(): void {
    this.editorSalvando = true;
    this.editorErro = '';

    this.service.salvarCron(this.editorConteudo).subscribe({
      next: (res: any) => {
        this.editorMeta = res.data || this.editorMeta;
        this.editorSalvando = false;
        this.fecharEditorScript();
        this.carregarDiagnosticoLogs(false);
      },
      error: (err) => {
        this.editorErro = this.mensagemErroEditor(err, 'Erro ao salvar crontab.');
        this.editorSalvando = false;
        this.cdr.detectChanges();
      }
    });
  }

  arquivosGerados(): string[] {
    const encontrados = new Set<string>();
    const olsProcessadas = new Set<string>();
    let houveGeracao = false;

    for (const linha of this.logs) {
      const texto = String(linha || '');
      const matches = texto.match(/[A-Za-z0-9_.-]+\.json\b/gi) || [];
      matches.forEach((arquivo) => encontrados.add(arquivo.split('/').pop() || arquivo));

      const olMatch = texto.match(/(?:FIM PROCESSAMENTO OL|Concluindo OL|INICIO PROCESSAMENTO OL(?: MULTI-REDE)?|An[a�]lise OL)\s*:?\s*(\d+)/i);
      if (olMatch?.[1]) {
        olsProcessadas.add(olMatch[1]);
      }

      if (/(Status:\s*GERAD|Finalizado|upload GCS)/i.test(texto)) {
        houveGeracao = true;
      }
    }

    if (!encontrados.size && houveGeracao) {
      olsProcessadas.forEach((ol) => encontrados.add(`${ol}.json`));
    }

    return Array.from(encontrados).sort();
  }

  abrirArquivosGerados(): void {
    this.arquivosGeradosModalAberto = true;
    this.cdr.detectChanges();
  }

  fecharArquivosGerados(): void {
    this.arquivosGeradosModalAberto = false;
    this.cdr.detectChanges();
  }

  abrirArquivoGerado(arquivo: string): void {
    window.location.href = `/arquivos?search=${encodeURIComponent(arquivo)}`;
  }

  acompanharTerminal(): void {
    this.seguirTerminal = true;
    this.agendarRolagemTerminal();
    this.cdr.detectChanges();
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

  filtrosLogAtivos(): boolean {
    return Boolean(String(this.filtroLogTexto || '').trim() || Number(this.filtroLogDias || 0) > 0);
  }

  filtrosLog(): { dias?: number | null; search?: string | null } {
    const dias = Math.min(Math.max(Number(this.filtroLogDias || 0), 0), 30);

    return {
      dias: dias > 0 ? dias : null,
      search: String(this.filtroLogTexto || '').trim() || null,
    };
  }

  resumoOperacional(): any {
    const linhas = this.logs.filter(Boolean);
    const inicio = linhas.find((linha) => /(SIG_PANEL_START|iniciando|inicio|início|starting|INICIO PROCESSAMENTO)/i.test(linha || ''));
    const finalizacao = [...linhas].reverse().find((linha) => /(finalizado|finalizada|concluido|concluído|started .* in|FIM PROCESSAMENTO)/i.test(linha || ''));
    const fila = linhas.find((linha) => /Nenhuma OL na fila/i.test(linha || ''));
    const ultimoEvento = [...linhas].reverse().find((linha) => !this.linhaRuidoResumo(linha));

    return {
      inicio: this.formatarInicioResumo(inicio),
      finalizacao: finalizacao || fila || '-',
      arquivos: this.arquivosGerados().length,
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
        let alterouLogs = false;

        if (Array.isArray(payload.linhas)) {
          this.logs = payload.linhas.filter(Boolean).slice(-500);
          alterouLogs = true;
        } else if (Array.isArray(payload.novasLinhas) && payload.novasLinhas.length) {
          this.logs = [...this.logs, ...payload.novasLinhas.filter(Boolean)].slice(-500);
          alterouLogs = true;
        }

        if (payload.meta) {
          this.logMeta = payload.meta;
          if (payload.meta.executionId) {
            this.executionIds[this.servicoLogSelecionado] = payload.meta.executionId;
          }
        }

        this.ultimaAtualizacaoLog = new Date();
        if (!this.filtrosLogAtivos()) {
          this.salvarCacheLocalLogs();
        }
        this.carregandoLogs = false;
        if (alterouLogs && this.seguirTerminal) this.agendarRolagemTerminal();
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

  private agendarRolagemTerminal(): void {
    this.deveRolarTerminal = true;
  }

  private rolarTerminalParaBaixo(): void {
    const el = this.terminalRef?.nativeElement;
    if (!el) return;

    window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
  }

  private mensagemErroEditor(err: any, fallback: string): string {
    const detalhe = err?.error?.error || err?.error?.message || err?.message || '';
    return detalhe ? `${fallback} ${detalhe}` : fallback;
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
