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
  menuAberto = true;
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

  sair(): void {
    this.service.sair();
    this.router.navigate(['/login']);
  }
}
