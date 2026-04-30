import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class LoginComponent {
  apiUrl = '';
  token = '';
  carregando = false;
  erro = '';

  constructor(
    private service: IntegracaoService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.apiUrl = this.service.getApiUrl();
  }

  entrar(): void {
    this.erro = '';
    this.carregando = true;
    this.service.setApiUrl(this.apiUrl);

    this.service.login(this.token).subscribe({
      next: (res) => {
        this.service.salvarToken(res.data.accessToken);
        this.carregando = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Token invalido ou backend indisponivel.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }
}