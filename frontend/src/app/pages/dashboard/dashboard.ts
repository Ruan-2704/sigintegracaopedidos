import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_dashboard_cache';
  dados: any = null;
  carregando = false;
  erro = '';
  ultimaAtualizacao: Date | null = null;
  dataInicial = '';
  dataFinal = '';
  periodoLabel = 'Geral';

  constructor(
    private service: IntegracaoService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.definirPeriodoPadrao();
    this.restaurarCacheLocal();
    this.carregar();
  }

  carregar(force = false): void {
    this.atualizarPeriodoLabel();

    const temCache = !force && this.restaurarCacheLocal();

    if (!force && !temCache) {
      this.dados = null;
    }

    this.carregando = force || !this.dados;
    this.erro = '';

    this.service.getDashboard({
      dataInicio: this.dataInicial,
      dataFim: this.dataFinal,
      force
    }).subscribe({
      next: (res) => {
        this.dados = res;
        this.ultimaAtualizacao = new Date();
        this.salvarCacheLocal();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar dashboard:', err);
        this.erro = 'Erro ao carregar dashboard.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  textoLimpo(valor: any): string {
    let texto = String(valor || '');
    const lower = texto.toLowerCase();

    if (lower.includes('api inser') && lower.includes('pedido')) {
      if (lower.includes('erro identificado')) return 'Erro identificado no log do servico API insercao de pedidos.';
      if (lower.includes('offline') || lower.includes('jar')) return 'O servico API insercao de pedidos esta offline ou o processo Java/JAR nao foi encontrado.';
      return 'API insercao de pedidos';
    }

    const substituicoes: Array<[RegExp, string]> = [
      [/servi.+?o/gi, 'servico'],
      [/inser.+?o/gi, 'insercao'],
      [/execu.+?o/gi, 'execucao'],
      [/gera.+?o/gi, 'geracao'],
      [/exclus.+?o/gi, 'exclusao'],
      [/n.+?o/gi, 'nao'],
      [/est.+?/gi, 'esta'],
      [/\u00c3[^\s]*/g, ''],
      [/\u00c2/g, ''],
      [/\u00e2[^\s]*/g, '-']
    ];

    substituicoes.forEach(([regex, replacement]) => {
      texto = texto.replace(regex, replacement);
    });

    return texto.replace(/\s+/g, ' ').trim();
  }

  tipoAlerta(alerta: any): string {
    return this.textoLimpo(alerta?.tipo || 'INFO');
  }

  alertaQueryParams(alerta: any): any {
    const servicoTexto = this.textoLimpo(alerta?.servico || '').toLowerCase();
    const tipo = alerta?.tipo || '';

    if (servicoTexto.includes('api insercao') || servicoTexto.includes('pedido')) {
      return { aba: 'operacionais', servico: 'pedidos', tipo: tipo || 'ERRO_LOG', status: 'ERRO' };
    }

    if (servicoTexto.includes('geracao')) {
      return { aba: 'operacionais', servico: 'geracao', tipo: tipo || 'ERRO_LOG', status: 'ERRO' };
    }

    if (servicoTexto.includes('exclusao')) {
      return { aba: 'operacionais', servico: 'exclusao', tipo: tipo || 'ERRO_LOG', status: 'ERRO' };
    }

    return { aba: 'operacionais', tipo: tipo || undefined, status: alerta?.status || 'ERRO', search: this.textoLimpo(alerta?.mensagem || alerta?.servico || '') };
  }

  private definirPeriodoPadrao(): void {
    if (this.dataInicial || this.dataFinal) return;

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth();
    const primeiroDia = new Date(ano, mes, 1);
    const ultimoDia = new Date(ano, mes + 1, 0);

    this.dataInicial = this.formatarInputData(primeiroDia);
    this.dataFinal = this.formatarInputData(ultimoDia);
    this.atualizarPeriodoLabel();
  }

  private formatarInputData(data: Date): string {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  private atualizarPeriodoLabel(): void {
    this.periodoLabel = this.dataInicial || this.dataFinal
      ? `${this.dataInicial || 'inicio'} ate ${this.dataFinal || 'hoje'}`
      : 'Geral';
  }

  private cacheId(): string {
    return `${this.dataInicial || ''}:${this.dataFinal || ''}`;
  }

  private restaurarCacheLocal(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      const item = cache?.[this.cacheId()];

      if (item?.dados) {
        this.dados = item.dados;
        this.ultimaAtualizacao = item.atualizadoEm ? new Date(item.atualizadoEm) : null;
        this.atualizarPeriodoLabel();
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
        dados: this.dados,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.cacheKey);
    }
  }
}