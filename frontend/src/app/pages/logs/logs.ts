import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-logs',
  templateUrl: './logs.html',
  styleUrls: ['./logs.scss'],
})
export class LogsComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_logs_cache';
  logs: any[] = [];
  carregando = false;
  erro = '';
  filtro = '';
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
}
