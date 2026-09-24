import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-pedidos',
  templateUrl: './pedidos.html',
  styleUrls: ['./pedidos.scss']
})
export class PedidosComponent implements OnInit {
  private readonly cacheKey = 'sig_integracao_pedidos_cache';
  private readonly detalheCacheKey = 'sig_integracao_pedidos_detalhe_cache';
  pedidos: any[] = [];
  selecionado: any = null;
  abaDetalhe: 'resumo' | 'recebido' | 'sigrede' | 'retorno' | 'validacao' = 'resumo';
  copiadoAba: 'recebido' | 'sigrede' | 'retorno' | '' = '';
  validacoesSelecionado: any[] = [];
  carregando = false;
  erro = '';
  filtro = '';
  filtroCampanha = '';
  filtroCnpj = '';
  filtroIntegradora = '';
  filtroStatus = '';
  dataInicio = '';
  dataFim = '';
  ultimaAtualizacao: Date | null = null;
  paginaAtual = 1;
  itensPorPagina = 200;
  ordenarCampo = 'data';
  ordenarDirecao: 'asc' | 'desc' = 'desc';
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
      this.pedidos = [];
      this.totalRegistros = 0;
      this.totalPaginas = 1;
    }

    this.carregando = !this.pedidos.length;
    this.erro = '';
    this.service.getPedidos({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro,
      campanha: this.filtroCampanha,
      cnpj: this.filtroCnpj,
      integradora: this.filtroIntegradora,
      status: this.filtroStatus,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
      force
    }).subscribe({
      next: (res) => {
        this.pedidos = this.aplicarOrdenacao(res.data || []);
        this.totalRegistros = res.meta?.total || 0;
        this.totalPaginas = res.meta?.totalPages || 1;
        this.ultimaAtualizacao = new Date();
        this.salvarCacheLocal();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao carregar pedidos:', err);
        this.erro = 'Erro ao carregar pedidos.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltro(): void { this.paginaAtual = 1; this.carregar(true); }

  limparFiltro(): void {
    this.filtro = '';
    this.filtroCampanha = '';
    this.filtroCnpj = '';
    this.filtroIntegradora = '';
    this.filtroStatus = '';
    this.dataInicio = '';
    this.dataFim = '';
    this.paginaAtual = 1;
    this.carregar(true);
  }

  alterarItensPorPagina(): void { this.paginaAtual = 1; this.carregar(true); }

  ordenarPor(campo: string): void {
    if (this.ordenarCampo === campo) {
      this.ordenarDirecao = this.ordenarDirecao === 'asc' ? 'desc' : 'asc';
    } else {
      this.ordenarCampo = campo;
      this.ordenarDirecao = 'asc';
    }

    this.pedidos = this.aplicarOrdenacao(this.pedidos);
    this.salvarCacheLocal();
    this.cdr.detectChanges();
  }

  indicadorOrdenacao(campo: string): string {
    if (this.ordenarCampo !== campo) return '';
    return this.ordenarDirecao === 'asc' ? '↑' : '↓';
  }

  visualizar(item: any, validar = false): void {
    const id = item.id || item.codigo;
    const cache = this.obterCacheDetalhes();
    const detalheSalvo = cache?.[id];
    this.abaDetalhe = 'resumo';
    this.validacoesSelecionado = [];

    if (detalheSalvo?.data) {
      this.selecionado = detalheSalvo.data;
      if (validar) this.validarErro();
      this.cdr.detectChanges();
    } else {
      this.selecionado = item;
      this.cdr.detectChanges();
    }

    this.carregando = !this.selecionado;
    this.service.getPedidoDetalhe(id).subscribe({
      next: (res) => {
        this.selecionado = res || item;
        this.salvarCacheDetalhe(id, this.selecionado);
        if (validar) this.validarErro();
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => { console.error(err); this.carregando = false; this.cdr.detectChanges(); }
    });
  }

  fechar(): void {
    this.selecionado = null;
    this.validacoesSelecionado = [];
    this.abaDetalhe = 'resumo';
    this.cdr.detectChanges();
  }

  paginaAnterior(): void { if (this.paginaAtual > 1) { this.paginaAtual--; this.carregar(); } }
  proximaPagina(): void { if (this.paginaAtual < this.totalPaginas) { this.paginaAtual++; this.carregar(); } }

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
      status: this.rotuloStatus(item),
      data: new Date(item?.dataPedidoFormatada || item?.dataHora || item?.dataPedido || 0).getTime(),
      pedido: item?.pedidoIntegrador || item?.pedidoIntegradora || '',
      cliente: item?.cnpjCliente || item?.CnpjCliente || '',
      distribuidor: item?.cnpjDistribuidor || item?.CnpjDistribuidor || '',
      campanha: item?.idCampanha || item?.IdCampanha || '',
      itens: Number(item?.itens || 0),
      motivo: item?.motivo || item?.mensagem || '',
      integradora: item?.integradora || ''
    };

    return mapa[campo] ?? '';
  }

  formatarDataPedido(item: any): string {
    const valor = item?.dataPedidoFormatada || item?.dataHora || item?.dataPedido;
    if (!valor) return '-';

    const texto = String(valor);
    const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/);

    if (match) {
      return `${match[3]}/${match[2]}/${match[1]} ${match[4] || '00'}:${match[5] || '00'}`;
    }

    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return texto;

    return `${data.toLocaleDateString('pt-BR')} ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  statusPedido(item: any): string {
    return String(item?.status || 'INSERIDO').toUpperCase();
  }

  classeStatus(item: any): string {
    const status = this.statusPedido(item);
    if (status === 'INSERIDO') return 'good';
    if (status === 'ERRO') return 'bad';
    if (status === 'REJEITADO') return 'warn';
    if (status === 'DUPLICADO') return 'neutral';
    return 'neutral';
  }

  rotuloStatus(item: any): string {
    const status = this.statusPedido(item);
    const rotulos: any = {
      INSERIDO: 'Inserido',
      REJEITADO: 'Rejeitado',
      ERRO: 'Erro',
      DUPLICADO: 'Duplicado'
    };
    return rotulos[status] || status;
  }

  classeIntegradora(item: any): string {
    const integradora = String(item?.integradora || '').toLowerCase().replace(/\s+/g, '');

    if (integradora.includes('smart')) return 'integradora-smart';
    if (integradora.includes('cotefacil') || integradora.includes('cote')) return 'integradora-cotefacil';

    return 'integradora-outra';
  }

  podeValidar(item = this.selecionado): boolean {
    const status = this.statusPedido(item);
    return status === 'ERRO' || status === 'REJEITADO' || status === 'DUPLICADO';
  }

  selecionarAba(aba: 'resumo' | 'recebido' | 'sigrede' | 'retorno' | 'validacao'): void {
    this.abaDetalhe = aba;
    this.copiadoAba = '';
    this.cdr.detectChanges();
  }

  validarErro(): void {
    if (!this.selecionado) return;
    this.validacoesSelecionado = this.montarValidacoes(this.selecionado);
    this.abaDetalhe = 'validacao';
    this.cdr.detectChanges();
  }

  montarValidacoes(item: any): any[] {
    const checks: any[] = [];
    const motivo = String(item?.motivo || '').toLowerCase();
    const mensagem = String(item?.mensagem || '').toLowerCase();
    const recebido = this.parseJsonSeguro(item?.payloadRecebido || item?.payload_recebido);
    const produtos = recebido?.produtos || [];

    if (motivo.includes('fornecedor') || mensagem.includes('fornecedor')) {
      checks.push({ nivel: 'erro', titulo: 'Fornecedor nao encontrado na campanha', detalhe: `Verifique se o CNPJ ${item.cnpjDistribuidor || item.CnpjDistribuidor || '-'} esta vinculado na campanha/OL ${item.idCampanha || item.IdCampanha || '-'}.` });
    }

    if (motivo.includes('farmacia') || mensagem.includes('farmacia')) {
      checks.push({ nivel: 'erro', titulo: 'Farmacia nao encontrada na OL', detalhe: `Verifique se o CNPJ ${item.cnpjCliente || item.CnpjCliente || '-'} esta cadastrado na OL ${item.idOl || item.IdOL || '-'}.` });
    }

    if (motivo.includes('campanha') || motivo.includes('rede')) {
      checks.push({ nivel: 'erro', titulo: 'Campanha ou rede nao encontrada', detalhe: `Confira idCampanha=${item.idCampanha || item.IdCampanha || '-'} e idOL=${item.idOl || item.IdOL || '-'}.` });
    }

    if (motivo.includes('medicamento') || mensagem.includes('medicamento')) {
      checks.push({ nivel: 'erro', titulo: 'Medicamento nao encontrado', detalhe: 'Revise os codigos dos produtos do payload recebido e o cadastro da OL na SIGREDE.' });
    }

    if (this.statusPedido(item) === 'DUPLICADO') {
      checks.push({ nivel: 'alerta', titulo: 'Pedido duplicado', detalhe: 'Esse pedido integrador ja consta no historico. Reenvie apenas se for uma nova tentativa com identificador ajustado.' });
    }

    if (!item?.payloadRecebido && !item?.payload_recebido) {
      checks.push({ nivel: 'alerta', titulo: 'Payload recebido ausente', detalhe: 'Nao ha JSON recebido salvo neste evento para reprocessamento direto.' });
    }

    if (recebido && (!Array.isArray(produtos) || produtos.length === 0)) {
      checks.push({ nivel: 'erro', titulo: 'Pedido sem produtos', detalhe: 'O payload recebido nao possui lista de produtos valida.' });
    }

    if (Array.isArray(produtos)) {
      const semCodigo = produtos.filter((p: any) => !p.codigoProduto && !p.CodigoProduto);
      const semQuantidade = produtos.filter((p: any) => !p.qtdeSolicitada && !p.QuantidadeSolicitada);
      if (semCodigo.length) checks.push({ nivel: 'erro', titulo: 'Produto sem codigo', detalhe: `${semCodigo.length} item(ns) sem codigoProduto.` });
      if (semQuantidade.length) checks.push({ nivel: 'erro', titulo: 'Produto sem quantidade', detalhe: `${semQuantidade.length} item(ns) sem qtdeSolicitada.` });
    }

    if (!checks.length) {
      checks.push({ nivel: 'ok', titulo: 'Nenhum erro conhecido identificado automaticamente', detalhe: 'Revise mensagem, payload SIGREDE e retorno antes de reenviar.' });
    }

    return checks;
  }

  formatarJson(valor: any): string {
    if (!valor) return 'Nao informado.';
    if (typeof valor !== 'string') return JSON.stringify(valor, null, 2);
    try {
      return JSON.stringify(JSON.parse(valor), null, 2);
    } catch {
      return valor;
    }
  }

  payloadDetalhe(tipo: 'recebido' | 'sigrede' | 'retorno'): any {
    if (!this.selecionado) return null;

    const campos: Record<string, any> = {
      recebido: this.selecionado.payloadRecebido || this.selecionado.payload_recebido,
      sigrede: this.selecionado.payloadSigrede || this.selecionado.payload_sigrede,
      retorno: this.selecionado.payloadRetorno || this.selecionado.payload_retorno
    };

    return campos[tipo] || null;
  }

  jsonDetalhe(tipo: 'recebido' | 'sigrede' | 'retorno'): string {
    return this.formatarJson(this.payloadDetalhe(tipo));
  }

  temPayloadJson(tipo: 'recebido' | 'sigrede' | 'retorno'): boolean {
    return !!this.payloadDetalhe(tipo);
  }

  async copiarJson(tipo: 'recebido' | 'sigrede' | 'retorno'): Promise<void> {
    const texto = this.jsonDetalhe(tipo);
    if (!texto || texto === 'Nao informado.') return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        this.copiarTextoFallback(texto);
      }

      this.copiadoAba = tipo;
      window.setTimeout(() => {
        if (this.copiadoAba === tipo) {
          this.copiadoAba = '';
          this.cdr.detectChanges();
        }
      }, 1600);
    } catch {
      this.copiarTextoFallback(texto);
      this.copiadoAba = tipo;
    }

    this.cdr.detectChanges();
  }

  private copiarTextoFallback(texto: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  parseJsonSeguro(valor: any): any {
    if (!valor) return null;
    if (typeof valor !== 'string') return valor;
    try { return JSON.parse(valor); } catch { return null; }
  }

  private cacheId(): string {
    return JSON.stringify({
      page: this.paginaAtual,
      limit: this.itensPorPagina,
      search: this.filtro || '',
      campanha: this.filtroCampanha || '',
      cnpj: this.filtroCnpj || '',
      integradora: this.filtroIntegradora || '',
      status: this.filtroStatus || '',
      dataInicio: this.dataInicio || '',
      dataFim: this.dataFim || ''
    });
  }

  private restaurarCacheLocal(): boolean {
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      const item = cache?.[this.cacheId()];

      if (item?.data) {
        this.pedidos = item.data || [];
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
        data: this.pedidos,
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

  private obterCacheDetalhes(): any {
    try {
      return JSON.parse(localStorage.getItem(this.detalheCacheKey) || '{}');
    } catch {
      localStorage.removeItem(this.detalheCacheKey);
      return {};
    }
  }

  private salvarCacheDetalhe(codigo: number, data: any): void {
    try {
      const cache = this.obterCacheDetalhes();
      cache[codigo] = {
        data,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(this.detalheCacheKey, JSON.stringify(cache));
    } catch {
      localStorage.removeItem(this.detalheCacheKey);
    }
  }
}
