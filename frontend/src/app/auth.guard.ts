import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { IntegracaoService } from './services/service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router, private service: IntegracaoService) {}

  canActivate(): boolean {
    if (this.service.isLogado()) {
      return true;
    }
    this.router.navigate(['/login']);
    return false;
  }
}
