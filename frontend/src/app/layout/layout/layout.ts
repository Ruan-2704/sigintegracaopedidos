import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-layout',
  templateUrl: './layout.html',
  styleUrls: ['./layout.scss']
})
export class LayoutComponent implements OnInit {
  menuAberto = window.matchMedia('(min-width: 981px)').matches;
  readonly navItems = [
    { route: '/dashboard', label: 'Dashboard', icon: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z' },
    ...[
      { route: '/arquivos', label: 'Arquivos gerados', icon: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3ZM8 12h8m-8 4h5' },
      { route: '/logs', label: 'Logs e auditoria', icon: 'M5 3h14v18H5Zm4 5h6m-6 4h6m-6 4h4' },
      { route: '/pedidos', label: 'Pedidos da integração', icon: 'M8 3H4v18h16V3h-4M8 2h8v4H8Zm0 9h8m-8 4h5' },
      { route: '/redes', label: 'Redes da integração', icon: 'M9 3h6v6H9Zm-6 12h6v6H3Zm12 0h6v6h-6ZM12 9v3M6 15v-3h12v3' },
      { route: '/servicos', label: 'Serviços e execuções', icon: 'M3 12h4l3-8 4 16 3-8h4' },
      { route: '/validador-pedido', label: 'Validador de pedido', icon: 'm12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Zm-4 9 3 3 5-6' }
    ].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  ];
  status = 'Verificando...';
  banco = '...';
  bucket = '...';
  ultimaVerificacao: Date | null = null;

  constructor(
    private service: IntegracaoService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.verificarStatus();
  }

  verificarStatus(): void {
    this.service.getHealth().subscribe({
      next: (res) => {
        const data = res.data || {};
        this.status = data.api || 'online';
        this.banco = data.banco || 'desconhecido';
        this.bucket = data.bucket || 'desconhecido';
        this.ultimaVerificacao = new Date();
        this.cdr.detectChanges();
      },
      error: () => {
        this.status = 'erro';
        this.banco = 'erro';
        this.bucket = 'erro';
        this.ultimaVerificacao = new Date();
        this.cdr.detectChanges();
      }
    });
  }

  toggleMenu(): void {
    this.menuAberto = !this.menuAberto;
    this.cdr.detectChanges();
  }

  fecharMenuMobile(): void {
    if (window.matchMedia('(max-width: 980px)').matches) {
      this.menuAberto = false;
      this.cdr.detectChanges();
    }
  }

  sair(): void {
    this.service.sair();
    this.router.navigate(['/login']);
  }
}
