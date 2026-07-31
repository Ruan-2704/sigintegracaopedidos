import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private router: Router) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = localStorage.getItem('sig_integracao_access_token');

    if (!token || req.url.indexOf('/auth/login') >= 0) {
      return next.handle(req);
    }

    return next.handle(req.clone({
      setHeaders: {
        Authorization: 'Bearer ' + token
      }
    })).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401 || err.status === 403) {
          localStorage.removeItem('sig_integracao_access_token');
          this.router.navigate(['/login'], {
            queryParams: { sessionExpired: '1' }
          });
        }

        return throwError(() => err);
      })
    );
  }
}
