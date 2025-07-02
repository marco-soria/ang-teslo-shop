import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@auth/services/auth.service';

@Component({
  selector: 'app-front-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './front-navbar.component.html',
})
export class FrontNavbarComponent {
  authService = inject(AuthService);
  router = inject(Router);

  isLoggingOut = signal(false);

  async onLogout() {
    this.isLoggingOut.set(true);

    try {
      this.authService.logout();
      await this.router.navigateByUrl('/auth/login');
    } finally {
      this.isLoggingOut.set(false);
    }
  }
}
