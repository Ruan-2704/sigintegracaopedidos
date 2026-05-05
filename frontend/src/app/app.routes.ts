import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout/layout';
import { DashboardComponent } from './pages/dashboard/dashboard';
import { ArquivosComponent } from './pages/arquivos/arquivos';
import { PedidosComponent } from './pages/pedidos/pedidos';
import { LogsComponent } from './pages/logs/logs';
import { LoginComponent } from './pages/login/login';
import { ServicosComponent } from './pages/servicos/servicos';
import { CronComponent } from './pages/cron/cron';
import { AuthGuard } from './auth.guard';
import { ValidadorPedidoComponent } from './pages/validador-pedido/validador-pedido';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'servicos', component: ServicosComponent },
      { path: 'arquivos', component: ArquivosComponent },
      { path: 'pedidos', component: PedidosComponent },
      { path: 'logs', component: LogsComponent },
      { path: 'cron', component: CronComponent },
      { path: 'validador-pedido', component: ValidadorPedidoComponent },
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
