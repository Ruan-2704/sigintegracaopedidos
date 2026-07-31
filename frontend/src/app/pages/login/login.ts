import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class LoginComponent {
  apiUrl = '';
  usuario = 'admin';
  token = '';
  carregando = false;
  erro = '';

  constructor(
    private service: IntegracaoService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {
    const apiUrlAtual = this.service.getApiUrl();
    this.apiUrl = /^https?:\/\//.test(apiUrlAtual) && !apiUrlAtual.includes('localhost:3001')
      ? apiUrlAtual
      : 'http://localhost:3300';
    this.service.setApiUrl(this.apiUrl);

    if (this.route.snapshot.queryParamMap.get('sessionExpired')) {
      this.erro = 'Sua sessao expirou. Entre novamente para continuar.';
    }
  }

  entrar(): void {
    this.erro = '';

    if (this.usuario.trim().toLowerCase() !== 'admin') {
      this.erro = 'Usuario invalido.';
      return;
    }

    this.carregando = true;
    this.service.setApiUrl(this.apiUrl);

    this.service.login(this.token).subscribe({
      next: (res) => {
        this.service.salvarToken(res.data.accessToken);
        this.carregando = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        const mensagem = err?.error?.message || '';
        this.erro = mensagem.toLowerCase().includes('token')
          ? 'Senha invalida.'
          : mensagem || 'Senha invalida ou backend indisponivel.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }
}
