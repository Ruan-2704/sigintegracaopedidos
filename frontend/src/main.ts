import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { applyInitialTheme } from './app/services/theme.service';

applyInitialTheme();

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(function (err) { console.error(err); });
