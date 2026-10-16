import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-logs',
  templateUrl: './logs.html',
  styleUrls: ['./logs.scss'],
})
export class LogsComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_logs_cache';
  private readonly cacheKeyPedidosApi = 'sig_integracao_pedidos_api_eventos_v2';
  logs: any[] = [];
  logsPedidosApi: any[] = [];
  metaLogsPedidosApi: any = null;
  arquivoLogsPedidosApi: any = null;
  carregando = false;
  carregandoPedidosApi = false;
  erro = '';
  erroPedidosApi = '';
  filtro = '';
  filtroPedidosApi = '';
  rastreioPedidosApi = '';
  somenteErrosPedidosApi = false;
  nivelPedidosApi = '';
  niveisPedidosApi: string[] = [];
  categoriasPedidosApi: string[] = [];
  readonly categoriasApi = [
    {valor:'PEDIDOS',nome:'Pedidos'}, {valor:'CAMPANHAS_ARQUIVOS',nome:'Campanhas e arquivos'},
    {valor:'AUTENTICACAO_API',nome:'Autenticação da API'}, {valor:'REQUISICOES_API',nome:'Falhas de requisição'},
    {valor:'INFRAESTRUTURA',nome:'Infraestrutura'}, {valor:'APLICACAO',nome:'Aplicação e inicialização'}
  ];
  alternarCategoria(valor: string): void {
    this.categoriasPedidosApi = this.categoriasPedidosApi.includes(valor)
      ? this.categoriasPedidosApi.filter(item=>item!==valor) : [...this.categoriasPedidosApi,valor];
  }
  alternarNivel(valor: string): void {
    this.niveisPedidosApi = this.niveisPedidosApi.includes(valor)
      ? this.niveisPedidosApi.filter(item=>item!==valor) : [...this.niveisPedidosApi,valor];
  }
  nomeCategoria(valor: string): string { return this.categoriasApi.find(item=>item.valor===valor)?.nome || valor; }
  get somenteAcessosAuditoria(): boolean {
    const acoes = this.filtroAcaoAuditoria.split(',').filter(Boolean);
    return acoes.length > 0 && acoes.every(item=>item==='LOGIN_ACEITO' || item==='LOGIN_RECUSADO');
  }
  abrirAcessos(): void {
    this.filtroAcaoAuditoria = 'LOGIN_ACEITO,LOGIN_RECUSADO'; this.filtroStatusAuditoria='';
    this.abaAtiva='auditoria'; this.carregarAuditoria(true);
  }
  abrirAcoes(): void { this.filtroAcaoAuditoria=''; this.abaAtiva='auditoria'; this.carregarAuditoria(true); }
  inicioPedidosApi = '';
  fimPedidosApi = '';
  pedidoPedidosApi = '';
  campanhaPedidosApi = '';
  paginaPedidosApi = 1;
  private consultaPedidosApi = 0;

  filtrarPedidosApi(): void { this.paginaPedidosApi = 1; this.carregarLogErrosPedidos(true); }
  mudarPaginaPedidosApi(delta: number): void {
    this.paginaPedidosApi = Math.max(1,this.paginaPedidosApi+delta);
    this.carregarLogErrosPedidos();
  }
  baixarPedidosApi(): void {
    const blob = new Blob([JSON.stringify(this.logsPedidosApi,null,2)],{type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = 'sigcotacao-eventos-pagina-'+this.paginaPedidosApi+'.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  servico = '';
  status = '';
  tipo = '';
  dataInicio = '';
  dataFim = '';
  ultimaAtualizacao: Date | null = null;
  paginaAtual = 1;
  itensPorPagina = 20;
  totalRegistros = 0;
  totalPaginas = 1;
  abaAtiva: 'operacionais' | 'pedidos-api' | 'cron' | 'auditoria' = 'pedidos-api';
  logsCron: any[] = [];
  logsCompletosAbertos: { [key: string]: boolean } = {};
  carregandoLogsCron = false;
  linhasLogCron = 200;
  erroLogsCron = '';
  acoesPainel: any[] = [];
  carregandoAuditoria = false;
  erroAuditoria = '';
  filtroAcaoAuditoria = '';
  filtroStatusAuditoria = '';
  limiteAuditoria = 50;
  ultimaAtualizacaoAuditoria: Date | null = null;
  private readonly cacheKeyLogsCron = 'sig_integracao_cron_logs_cache';
  private readonly cacheKeyAuditoria = 'sig_integracao_auditoria_cache';

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.definirAbaInicial();
    this.restaurarCacheLocal();
    this.restaurarCachePedidosApi();
    this.restaurarCacheLogsCron();
    this.restaurarCacheAuditoria();
    this.carregarDadosAba(false);
  }

  trocarAba(aba: 'operacionais' | 'pedidos-api' | 'cron' | 'auditoria'): void {
    this.abaAtiva = aba;
    this.carregarDadosAba(false);
  }

  atualizarAba(): void {
    this.carregarDadosAba(true);
  }

  private definirAbaInicial(): void {
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const aba = params.get('aba');

    if (path.includes('/auditoria') || aba === 'acoes' || aba === 'auditoria') {
      this.abaAtiva = 'auditoria';
    } else if (path.includes('/cron') || aba === 'cron') {
      this.abaAtiva = 'cron';
    } else if (aba === 'pedidos-api') {
      this.abaAtiva = 'pedidos-api';
    } else if (aba === 'operacionais') {
      this.abaAtiva = 'operacionais';
    }

    this.filtro = params.get('search') || this.filtro;
    this.servico = params.get('servico') || this.servico;
    this.tipo = params.get('tipo') || this.tipo;
    this.status = params.get('status') || this.status;
    this.dataInicio = params.get('dataInicio') || this.dataInicio;
    this.dataFim = params.get('dataFim') || this.dataFim;
    this.filtroPedidosApi = params.get('pedidoSearch') || params.get('searchPedidos') || this.filtroPedidosApi;
    this.rastreioPedidosApi = params.get('rastreio') || this.rastreioPedidosApi;
  }

  private carregarDadosAba(force = false): void {
    if (this.abaAtiva === 'operacionais') this.carregar(force);
    if (this.abaAtiva === 'pedidos-api') this.carregarLogErrosPedidos(force);
    if (this.abaAtiva === 'cron') this.carregarLogsCron(force);
    if (this.abaAtiva === 'auditoria') this.carregarAuditoria(force);
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
      servico: this.servico,
      status: this.status,
      tipo: this.tipo,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
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

  aplicarFiltro(): void {
    this.paginaAtual = 1;
    this.carregar();
  }

  limparFiltro(): void {
    this.filtro = '';
    this.servico = '';
    this.status = '';
    this.tipo = '';
    this.dataInicio = '';
    this.dataFim = '';
    this.paginaAtual = 1;
    this.carregar();
  }

  carregarLogErrosPedidos(force = false): void {
    const consulta = ++this.consultaPedidosApi;
    this.carregandoPedidosApi = true;
    this.erroPedidosApi = '';
    this.service.getHistoricoPedidos({
      page:this.paginaPedidosApi,limit:50,search:this.filtroPedidosApi,
      rastreio:this.rastreioPedidosApi,niveis:this.niveisPedidosApi.join(','),categorias:this.categoriasPedidosApi.join(','),
      dataInicio:this.inicioPedidosApi,dataFim:this.fimPedidosApi,
      pedido:this.pedidoPedidosApi,campanha:this.campanhaPedidosApi,force
    }).subscribe({
      next: (res:any) => {
        if (consulta !== this.consultaPedidosApi) return;
        this.logsPedidosApi = res.data || [];
        this.metaLogsPedidosApi = res.meta || null;
        this.arquivoLogsPedidosApi = res.arquivo || null;
        this.carregandoPedidosApi = false;
        this.cdr.detectChanges();
      },
      error: err => {
        if (consulta !== this.consultaPedidosApi) return;
        this.erroPedidosApi = err?.error?.error || err?.error?.message || 'Não foi possível consultar o histórico.';
        this.carregandoPedidosApi = false;
        this.cdr.detectChanges();
      }
    });
  }

  limparLogErrosPedidos(): void {
    this.filtroPedidosApi=''; this.rastreioPedidosApi=''; this.nivelPedidosApi='';
    this.niveisPedidosApi=[]; this.categoriasPedidosApi=[];
    this.inicioPedidosApi=''; this.fimPedidosApi=''; this.pedidoPedidosApi=''; this.campanhaPedidosApi='';
    this.filtrarPedidosApi();
  }

  paginaAnterior(): void {
    if (this.paginaAtual > 1) {
      this.paginaAtual--;
      this.carregar();
    }
  }

  proximaPagina(): void {
    if (this.paginaAtual < this.totalPaginas) {
      this.paginaAtual++;
      this.carregar();
    }
  }

  temFiltroAtivo(): boolean {
    return Boolean(this.filtro || this.servico || this.status || this.tipo || this.dataInicio || this.dataFim);
  }

  classeStatus(status: string): string {
    const valor = String(status || '').toUpperCase();
    if (valor === 'SUCESSO') return 'good';
    if (valor === 'ERRO') return 'bad';
    if (valor === 'ALERTA') return 'warn';
    return 'neutral';
  }

  rotuloServico(log: any): string {
    if (log.nomeServico) return log.nomeServico;
    if (log.servico === 'geracao') return 'Geração de arquivos';
    if (log.servico === 'exclusao') return 'Exclusão de arquivos';
    if (log.servico === 'pedidos') return 'API inserção de pedidos';
    return log.origem || '-';
  }

  rotuloTipo(tipo: string): string {
    const tipos: { [key: string]: string } = {
      INICIAR_SERVICO: 'Início de serviço',
      PARAR_SERVICO: 'Parada de serviço',
      CONSULTA_LOG: 'Consulta de log',
      STREAM_LOG: 'Stream de log',
      ERRO_LOG: 'Erro no log',
      SERVICO_OFFLINE: 'Serviço offline',
      TENTATIVA_ENVIO_PEDIDO: 'Tentativa de pedido',
      PEDIDO_INSERIDO: 'Pedido inserido',
      ARQUIVO_GERADO: 'Arquivo gerado'
    };

    return tipos[tipo] || tipo || 'Evento';
  }

  detalheFormatado(log: any): string {
    const detalhe = log.erro || log.detalhe;
    if (!detalhe) return '';

    if (typeof detalhe !== 'string') {
      return JSON.stringify(detalhe, null, 2);
    }

    try {
      return JSON.stringify(JSON.parse(detalhe), null, 2);
    } catch {
      return detalhe;
    }
  }

  linhaPedidoApiErro(linha: string): boolean {
    return /(ERROR|erro|falha|exception|unauthorized|token|login|payloadRecebido|n[ãa]o inserid|inexistente|timeout|refused)/i.test(linha || '');
  }

  linhaPedidoApiAlerta(linha: string): boolean {
    return !this.linhaPedidoApiErro(linha) && /(WARN|alerta|payloadSigrede|rastreio|motivo|bucket|campanha)/i.test(linha || '');
  }

  carregarLogsCron(force = false): void {
    const temCache = !force && this.restaurarCacheLogsCron();

    if (!force && !temCache) this.logsCron = [];

    this.carregandoLogsCron = force || !this.logsCron.length;
    this.erroLogsCron = '';

    this.service.getLogsCron(this.linhasLogCron, force).subscribe({
      next: (res) => {
        this.logsCron = res.data || [];
        this.salvarCacheLogsCron();
        this.carregandoLogsCron = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar logs do crontab:', err);
        this.erroLogsCron = 'Erro ao carregar logs do crontab.';
        this.carregandoLogsCron = false;
        this.cdr.detectChanges();
      }
    });
  }

  alternarLogCronCompleto(chave: string): void {
    this.logsCompletosAbertos[chave] = !this.logsCompletosAbertos[chave];
    this.cdr.detectChanges();
  }

  resumoLogCron(item: any): string {
    const linhas = item?.linhas || [];
    if (!linhas.length) return 'Nenhuma linha de log encontrada.';
    return linhas.slice(-this.linhasLogCron).join('\n');
  }

  eventosLogCron(item: any): any[] {
    return item?.resumo?.eventos || [];
  }

  statusResumoCron(item: any): string {
    if (!item?.arquivo?.existe) return 'Log nao encontrado';
    if (item?.resumo?.erros) return `${item.resumo.erros} erro(s)`;
    if (item?.resumo?.alertas) return `${item.resumo.alertas} alerta(s)`;
    return `${item?.resumo?.totalEventos || 0} evento(s)`;
  }

  carregarAuditoria(force = false): void {
    const temCache = !force && this.restaurarCacheAuditoria();

    if (!force && !temCache) this.acoesPainel = [];

    this.carregandoAuditoria = force || !this.acoesPainel.length;
    this.erroAuditoria = '';

    this.service.getAcoesPainel({
      limit: this.limiteAuditoria,
      acao: this.filtroAcaoAuditoria,
      status: this.filtroStatusAuditoria,
      force
    }).subscribe({
      next: (res) => {
        this.acoesPainel = (res.data || []).map((item: any) => ({
          ...item,
          detalheFormatado: this.formatarDetalheAuditoria(item.detalhe)
        }));
        this.ultimaAtualizacaoAuditoria = new Date();
        this.salvarCacheAuditoria();
        this.carregandoAuditoria = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar acoes do painel:', err);
        this.erroAuditoria = 'Erro ao carregar acoes do painel.';
        this.carregandoAuditoria = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltroAuditoria(): void {
    this.carregarAuditoria(true);
  }

  limparFiltroAuditoria(): void {
    this.filtroAcaoAuditoria = '';
    this.filtroStatusAuditoria = '';
    this.limiteAuditoria = 50;
    this.carregarAuditoria(true);
  }

  get acoesAuditoriaSelecionadas(): string[] { return this.filtroAcaoAuditoria.split(',').filter(Boolean); }
  set acoesAuditoriaSelecionadas(value: string[]) { this.filtroAcaoAuditoria = value.filter(Boolean).join(','); }
  get resultadosAuditoriaSelecionados(): string[] { return this.filtroStatusAuditoria.split(',').filter(Boolean); }
  set resultadosAuditoriaSelecionados(value: string[]) { this.filtroStatusAuditoria = value.filter(Boolean).join(','); }

  filtrosAuditoriaAtivos(): number {
    return [this.filtroAcaoAuditoria, this.filtroStatusAuditoria].filter(Boolean).length;
  }

  trackAcao(_: number, item: any): string {
    return String(item.id || `${item.criado_em}-${item.acao}-${item.alvo}`);
  }

  formatarDetalheAuditoria(detalhe: any): string {
    if (!detalhe) return '-';

    if (typeof detalhe !== 'string') return JSON.stringify(detalhe, null, 2);

    try {
      return JSON.stringify(JSON.parse(detalhe), null, 2);
    } catch {
      return detalhe;
    }
  }

  private cacheId(): string {
    return JSON.stringify({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro || '',
      servico: this.servico || '',
      status: this.status || '',
      tipo: this.tipo || '',
      dataInicio: this.dataInicio || '',
      dataFim: this.dataFim || ''
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

  private cacheIdPedidosApi(): string {
    return JSON.stringify({
      search: this.filtroPedidosApi || '',
      rastreio: this.rastreioPedidosApi || '',
      somenteErros: this.somenteErrosPedidosApi
    });
  }

  private restaurarCachePedidosApi(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyPedidosApi) || '{}');
      const item = cache?.[this.cacheIdPedidosApi()];

      if (item?.data) {
        this.logsPedidosApi = item.data || [];
        this.metaLogsPedidosApi = item.meta || null;
        this.arquivoLogsPedidosApi = item.arquivo || null;
        return true;
      }
    } catch {
      localStorage.removeItem(this.cacheKeyPedidosApi);
    }

    return false;
  }

  private cacheIdLogsCron(): string {
    return String(this.linhasLogCron);
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

  private cacheIdAuditoria(): string {
    return JSON.stringify({
      acao: this.filtroAcaoAuditoria || '',
      status: this.filtroStatusAuditoria || '',
      limit: this.limiteAuditoria
    });
  }

  private restaurarCacheAuditoria(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyAuditoria) || '{}');
      const item = cache?.[this.cacheIdAuditoria()];

      if (item?.data) {
        this.acoesPainel = (item.data || []).map((acao: any) => ({
          ...acao,
          detalheFormatado: acao.detalheFormatado || this.formatarDetalheAuditoria(acao.detalhe)
        }));
        this.ultimaAtualizacaoAuditoria = item.atualizadoEm ? new Date(item.atualizadoEm) : null;
        return true;
      }
    } catch {
      localStorage.removeItem(this.cacheKeyAuditoria);
    }

    return false;
  }

  private salvarCacheAuditoria(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyAuditoria) || '{}');
      cache[this.cacheIdAuditoria()] = {
        data: this.acoesPainel,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKeyAuditoria, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKeyAuditoria);
    }
  }

  private salvarCachePedidosApi(): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKeyPedidosApi) || '{}');
      cache[this.cacheIdPedidosApi()] = {
        data: this.logsPedidosApi,
        meta: this.metaLogsPedidosApi,
        arquivo: this.arquivoLogsPedidosApi,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKeyPedidosApi, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKeyPedidosApi);
    }
  }
}
