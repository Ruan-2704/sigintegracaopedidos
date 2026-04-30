import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { RouterModule } from '@angular/router';

import { AppComponent } from './app';
import { routes } from './app.routes';
import { AuthInterceptor } from './auth.interceptor';
import { LayoutComponent } from './layout/layout/layout';
import { DashboardComponent } from './pages/dashboard/dashboard';
import { ArquivosComponent } from './pages/arquivos/arquivos';
import { PedidosComponent } from './pages/pedidos/pedidos';
import { LogsComponent } from './pages/logs/logs';
import { LoginComponent } from './pages/login/login';
import { ServicosComponent } from './pages/servicos/servicos';
import { CronComponent } from './pages/cron/cron';

@NgModule({
  declarations: [
    AppComponent,
    LayoutComponent,
    DashboardComponent,
    ArquivosComponent,
    PedidosComponent,
    LogsComponent,
    LoginComponent,
    ServicosComponent,
    CronComponent
  ],
  imports: [
    BrowserModule,
    CommonModule,
    FormsModule,
    HttpClientModule,
    RouterModule.forRoot(routes, { relativeLinkResolution: 'legacy' })
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
