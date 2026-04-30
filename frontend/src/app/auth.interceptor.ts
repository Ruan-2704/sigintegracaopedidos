import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = localStorage.getItem('sig_integracao_access_token');

    if (!token || req.url.indexOf('/auth/login') >= 0) {
      return next.handle(req);
    }

    return next.handle(req.clone({
      setHeaders: {
        Authorization: 'Bearer ' + token
      }
    }));
  }
}
