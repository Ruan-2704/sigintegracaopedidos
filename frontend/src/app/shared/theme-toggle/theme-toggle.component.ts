import { ChangeDetectorRef, Component } from '@angular/core';
import { ThemePreference, ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  templateUrl: './theme-toggle.component.html',
  styleUrls: ['./theme-toggle.component.scss']
})
export class ThemeToggleComponent {
  readonly options: { value: ThemePreference; label: string; path: string }[] = [
    { value: 'light', label: 'Claro', path: 'M12 3v1m0 16v1M3 12h1m16 0h1M5.6 5.6l.7.7m11.4 11.4.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
    { value: 'system', label: 'Sistema', path: 'M4 4h16a1 1 0 0 1 1 1v12H3V5a1 1 0 0 1 1-1ZM12 17v4m-4 0h8' },
    { value: 'dark', label: 'Escuro', path: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z' }
  ];
  constructor(public theme: ThemeService, private cdr: ChangeDetectorRef) {}

  setTheme(preference: ThemePreference): void {
    this.theme.setPreference(preference);
    this.cdr.detectChanges();
  }
}
