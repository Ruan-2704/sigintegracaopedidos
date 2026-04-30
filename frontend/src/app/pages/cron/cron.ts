import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-cron',
  templateUrl: './cron.html',
  styleUrls: ['./cron.scss']
})
export class CronComponent implements OnInit {
  crontab = '';
  escritaLiberada = false;
  carregando = false;
  erro = '';
  sucesso = '';

  constructor(private service: IntegracaoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando = true;
    this.erro = '';
    this.sucesso = '';
    this.service.getCron().subscribe({
      next: (res) => {
        this.crontab = res.data?.crontab || '';
        this.escritaLiberada = !!res.data?.escritaLiberada;
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Erro ao carregar crontab.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }

  salvar(): void {
    if (!this.escritaLiberada) return;
    if (!confirm('Confirmar alteracao do crontab do servidor?')) return;

    this.carregando = true;
    this.service.salvarCron(this.crontab).subscribe({
      next: () => {
        this.sucesso = 'Crontab salvo com sucesso.';
        this.carregando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.erro = err?.error?.message || 'Erro ao salvar crontab.';
        this.carregando = false;
        this.cdr.detectChanges();
      }
    });
  }
}
