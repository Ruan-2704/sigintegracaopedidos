import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IntegracaoService } from '../../services/service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  dados: any = null;
  carregando = false;
  erro = '';
  ultimaAtualizacao: Date | null = null;
  dataInicial = '';
  dataFinal = '';

  constructor(
    private service: IntegracaoService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando = true;
    this.erro = '';

    this.service.getDashboard({ dataInicio: this.dataInicial, dataFim: this.dataFinal, dataInicial: this.dataInicial, dataFinal: this.dataFinal } as any).subscribe({
      next: (res) => {
        this.dados = res;
        this.ultimaAtualizacao = new Date();
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
}
