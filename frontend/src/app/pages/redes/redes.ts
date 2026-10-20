import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IntegracaoService } from '../../services/service';

@Component({ selector: 'app-redes', templateUrl: './redes.html', styleUrls: ['./redes.scss'] })
export class RedesComponent implements OnInit {
  redes: any[] = [];
  catalogo: any[] = [];
  carregando = false;
  salvando = false;
  verificando = false;
  disponivel = false;
  erro = '';
  aviso = '';
  mensagem = '';
  busca = '';
  filtro = '';
  uso = '';
  pagina = 1;
  limite = 20;
  formulario: any = null;
  diagnostico: any = null;
  erroFormulario = '';
  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef,
    private route: ActivatedRoute, private router: Router) {}
  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    this.busca = this.filtro = q.get('search') || '';
    this.uso = ['geracao', 'validador', 'desabilitadas'].includes(q.get('uso') || '') ? q.get('uso')! : '';
    this.pagina = Math.max(1, Number(q.get('page')) || 1);
    this.limite = [10,20,50].includes(Number(q.get('limit'))) ? Number(q.get('limit')) : 20;
    this.carregar();
  }
  get filtradas(): any[] {
    const termo = this.filtro.toLocaleLowerCase('pt-BR');
    return this.redes.filter(r => `${r.codigo} ${r.nome} ${r.schemaNome}`.toLocaleLowerCase('pt-BR').includes(termo)
      && (!this.uso || (this.uso === 'desabilitadas' ? !r.geracao && !r.validador : r[this.uso])));
  }
  get totalPaginas(): number { return Math.max(1, Math.ceil(this.filtradas.length / this.limite)); }
  get linhas(): any[] { return this.filtradas.slice((this.pagina - 1) * this.limite, this.pagina * this.limite); }
  get opcoes(): any[] { return this.catalogo.filter(r => !this.redes.some(c => c.codigo === r.codigo) || r.codigo === this.formulario?.codigo); }
  get redeSelecionada(): any { return this.catalogo.find(r => r.codigo === this.formulario?.codigo); }
  carregar(): void {
    this.carregando = true; this.erro = '';
    this.service.getRedesIntegracao().subscribe({ next: res => {
      this.redes = res.data.redes; this.catalogo = res.data.catalogo;
      this.disponivel = res.data.configuracaoDisponivel; this.aviso = res.data.aviso || '';
      this.pagina = Math.min(this.pagina, this.totalPaginas); this.carregando = false; this.cdr.detectChanges();
    }, error: e => { this.erro = this.descreverErro(e); this.carregando = false; this.cdr.detectChanges(); } });
  }
  aplicar(): void { this.filtro = this.busca.trim(); this.mudarPagina(1); }
  limpar(): void { this.busca = ''; this.uso = ''; this.aplicar(); }
  mudarPagina(p: number): void {
    this.pagina = Math.min(Math.max(1,p),this.totalPaginas);
    this.router.navigate([], { relativeTo: this.route, queryParams: { search: this.filtro || null, uso: this.uso || null,
      page: this.pagina, limit: this.limite }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  editar(rede?: any): void {
    this.formulario = rede ? { codigo: rede.codigo, geracao: rede.geracao, validador: rede.validador, versao: rede.versao }
      : { codigo: null, geracao: false, validador: false, versao: 0 };
    this.diagnostico = null; this.erroFormulario = ''; this.mensagem = '';
    if (rede) this.verificar();
  }
  trocarRede(): void { this.diagnostico = null; this.erroFormulario = ''; }
  fechar(): void { if (!this.salvando) { this.formulario = null; this.diagnostico = null; } }
  verificar(): void {
    const codigo = this.formulario?.codigo;
    if (!codigo || this.verificando) return;
    this.verificando = true; this.erroFormulario = ''; this.diagnostico = null;
    this.service.validarRedeIntegracao(codigo).subscribe({ next: res => {
      if (this.formulario?.codigo === codigo) this.diagnostico = res.data;
      this.verificando = false; this.cdr.detectChanges();
    }, error: e => { this.erroFormulario = this.descreverErro(e); this.verificando = false; this.cdr.detectChanges(); } });
  }
  get podeSalvar(): boolean {
    return this.disponivel && !!this.formulario?.codigo && !this.salvando && !this.verificando
      && (!this.formulario.geracao || !!this.diagnostico?.geracao)
      && (!this.formulario.validador || !!this.diagnostico?.validador);
  }
  salvar(): void {
    if (!this.podeSalvar) return;
    this.salvando = true; this.erroFormulario = '';
    this.service.salvarRedeIntegracao(this.formulario).subscribe({ next: res => {
      this.salvando = false; this.formulario = null; this.mensagem = res.message || 'Configuração salva.';
      this.carregar(); this.cdr.detectChanges();
    }, error: e => { this.salvando = false; this.erroFormulario = this.descreverErro(e); this.cdr.detectChanges(); } });
  }
  private descreverErro(e: any): string { return e?.error?.error || e?.error?.message || e?.message || 'Não foi possível concluir a operação.'; }
}
