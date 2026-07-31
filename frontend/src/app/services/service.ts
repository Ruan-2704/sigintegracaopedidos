import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  message?: string;
  error?: string;
}

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  campanha?: string;
  cnpj?: string;
  integradora?: string;
  dataInicio?: string;
  dataFim?: string;
  dataInicial?: string;
  dataFinal?: string;
  linhas?: number;
  force?: boolean;
  acao?: string;
  status?: string;
}

export interface ServicoStatus {
  chave: string;
  nome: string;
  porta?: number;
  online: boolean;
  pids: string[];
  emExecucaoPainel: boolean;
  pidPainel?: number | null;
  script?: string | null;
  jar?: string | null;
  servidor?: string | null;
}

@Injectable({ providedIn: 'root' })
export class IntegracaoService {
  private api = localStorage.getItem('sig_integracao_api_url') || 'http://localhost:3300';

  constructor(private http: HttpClient) {}

  getApiUrl(): string {
    return this.api;
  }

  setApiUrl(url: string): void {
    this.api = (url || 'http://localhost:3300').replace(/\/$/, '');
    localStorage.setItem('sig_integracao_api_url', this.api);
  }

  isLogado(): boolean {
    const token = localStorage.getItem('sig_integracao_access_token');

    if (!token) return false;

    try {
      const base64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=')));

      if (payload?.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        this.sair();
        return false;
      }
    } catch {
      this.sair();
      return false;
    }

    return true;
  }

  salvarToken(accessToken: string): void {
    localStorage.setItem('sig_integracao_access_token', accessToken);
  }

  sair(): void {
    localStorage.removeItem('sig_integracao_access_token');
    this.limparCacheOperacional();
  }

  limparCacheOperacional(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sig_integracao_') && key !== 'sig_integracao_api_url')
      .forEach((key) => localStorage.removeItem(key));
  }

  login(token: string): Observable<ApiResponse<{ accessToken: string; expiresIn: number }>> {
    return this.http.post<ApiResponse<{ accessToken: string; expiresIn: number }>>(`${this.api}/auth/login`, { token }).pipe(
      timeout(30000),
      catchError((err) => {
        console.error('Erro no login:', err);
        return throwError(err);
      })
    );
  }

  private buildParams(params?: ListParams): HttpParams {
    let httpParams = new HttpParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    });
    return httpParams;
  }

  private withDateAliases(params?: ListParams): ListParams | undefined {
    if (!params) return params;

    return {
      ...params,
      dataInicio: params.dataInicio || params.dataInicial,
      dataFim: params.dataFim || params.dataFinal,
      dataInicial: params.dataInicial || params.dataInicio,
      dataFinal: params.dataFinal || params.dataFim
    };
  }

  private getRaw<T>(rota: string, params?: ListParams): Observable<T> {
    return this.http.get<T>(`${this.api}${rota}`, { params: this.buildParams(this.withDateAliases(params)) }).pipe(
      timeout(30000),
      catchError((err) => {
        console.error(`Erro na rota ${rota}:`, err);
        return throwError(err);
      })
    );
  }

  private postRaw<T>(rota: string, body: any = {}): Observable<T> {
    return this.http.post<T>(`${this.api}${rota}`, body).pipe(
      timeout(30000),
      catchError((err) => {
        console.error(`Erro na rota ${rota}:`, err);
        return throwError(err);
      })
    );
  }

  private deleteRaw<T>(rota: string): Observable<T> {
    return this.http.delete<T>(`${this.api}${rota}`).pipe(
      timeout(30000),
      catchError((err) => {
        console.error(`Erro na rota ${rota}:`, err);
        return throwError(err);
      })
    );
  }

  getHealth(): Observable<ApiResponse<any>> {
    return this.getRaw<ApiResponse<any>>('/health');
  }

  getDashboard(params?: ListParams): Observable<any> {
    return this.getRaw<ApiResponse<any>>('/dashboard', params).pipe(map((res) => res.data));
  }

  getArquivos(params?: ListParams): Observable<ApiResponse<any[]>> {
    return this.getRaw<ApiResponse<any[]>>('/arquivos', params);
  }

  getArquivoPreview(nomeArquivo: string): Observable<any> {
    return this.getRaw<ApiResponse<any>>(`/arquivos/${encodeURIComponent(nomeArquivo)}/preview`).pipe(map((res) => res.data));
  }

  excluirArquivo(nomeArquivo: string): Observable<any> {
    return this.deleteRaw<ApiResponse<any>>(`/arquivos/${encodeURIComponent(nomeArquivo)}`);
  }

  getPedidos(params?: ListParams): Observable<ApiResponse<any[]>> {
    return this.getRaw<ApiResponse<any[]>>('/pedidos', params);
  }

  getPedidoDetalhe(codigo: number): Observable<any> {
    return this.getRaw<ApiResponse<any>>(`/pedidos/${codigo}`).pipe(map((res) => res.data));
  }

  getLogs(params?: ListParams): Observable<ApiResponse<any[]>> {
    return this.getRaw<ApiResponse<any[]>>('/logs', params);
  }

  getServicosStatus(force = false): Observable<ApiResponse<any>> {
    return this.getRaw<ApiResponse<any>>('/servicos/status', { force } as any);
  }

  iniciarServico(servico: string): Observable<ApiResponse<any>> {
    return this.postRaw<ApiResponse<any>>(`/servicos/${servico}/start`);
  }

  pararServico(servico: string): Observable<ApiResponse<any>> {
    return this.postRaw<ApiResponse<any>>(`/servicos/${servico}/stop`);
  }

  getLogsServico(servico: string, linhas = 300): Observable<ApiResponse<string[]>> {
    return this.getRaw<ApiResponse<string[]>>(`/servicos/${servico}/logs`, { linhas, limit: linhas } as any);
  }

  streamLogsServico(servico: string): EventSource {
    const token = localStorage.getItem('sig_integracao_access_token') || '';
    const params = new URLSearchParams();
    if (token) params.set('token', token);

    return new EventSource(`${this.api}/servicos/${encodeURIComponent(servico)}/logs/stream?${params.toString()}`);
  }

  getCron(): Observable<ApiResponse<{ crontab: string; linhas: string[]; escritaLiberada: boolean }>> {
    return this.getRaw<ApiResponse<{ crontab: string; linhas: string[]; escritaLiberada: boolean }>>('/cron');
  }

  getDiagnosticoLogsCron(): Observable<ApiResponse<any[]>> {
    return this.getRaw<ApiResponse<any[]>>('/cron/logs/diagnostico');
  }

  getLogsCron(linhas = 200, force = false): Observable<ApiResponse<any[]>> {
    return this.getRaw<ApiResponse<any[]>>('/cron/logs', { linhas, limit: linhas, force } as any);
  }

  getAcoesPainel(params?: ListParams): Observable<ApiResponse<any[]>> {
    return this.getRaw<ApiResponse<any[]>>('/painel/acoes', params);
  }

  salvarCron(crontab: string): Observable<ApiResponse<any>> {
    return this.postRaw<ApiResponse<any>>('/cron', { crontab });
  }

  validarPedido(
    payload: any,
    options: { rede?: string; validarBanco?: boolean } = {}
  ): Observable<ApiResponse<any>> {
    return this.postRaw<ApiResponse<any>>('/validador/pedido', {
      payload,
      rede: options.rede,
      validarBanco: options.validarBanco !== false
    });
  }
}
