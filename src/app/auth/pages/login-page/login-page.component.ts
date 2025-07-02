import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '@auth/services/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './login-page.component.html',
})
export class LoginPageComponent {
  fb = inject(FormBuilder);
  hasError = signal(false);
  errorMessage = signal('');
  errorType = signal<'general' | 'credentials' | 'not-found' | 'validation'>(
    'general'
  );
  isPosting = signal(false);
  router = inject(Router);

  authService = inject(AuthService);

  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  onSubmit() {
    if (this.loginForm.invalid) {
      this.showError('Please review the information entered.', 'validation');
      return;
    }

    const { email = '', password = '' } = this.loginForm.value;

    this.isPosting.set(true);
    this.hasError.set(false); // Limpiar errores previos

    this.authService.login(email!, password!).subscribe({
      next: (result) => {
        this.isPosting.set(false);
        if (result.success) {
          this.router.navigateByUrl('/');
          return;
        }
        this.showError(result.message);
      },
      error: () => {
        this.isPosting.set(false);
        this.showError(
          "We're having trouble connecting to our servers. Please check your internet connection and try again.",
          'general'
        );
      },
    });
  }

  private showError(
    message: string,
    type?: 'general' | 'credentials' | 'not-found' | 'validation'
  ) {
    this.errorMessage.set(message);

    // Si se especifica un tipo, usarlo, sino detectar automáticamente
    if (type) {
      this.errorType.set(type);
    } else {
      // Detectar tipo de error para mostrar UI apropiada
      if (
        message.toLowerCase().includes('not found') ||
        message.toLowerCase().includes('no account')
      ) {
        this.errorType.set('not-found');
      } else if (
        message.toLowerCase().includes('invalid') &&
        (message.toLowerCase().includes('password') ||
          message.toLowerCase().includes('credentials') ||
          message.toLowerCase().includes('incorrect'))
      ) {
        this.errorType.set('credentials');
      } else if (
        message.toLowerCase().includes('validation') ||
        message.toLowerCase().includes('check') ||
        message.toLowerCase().includes('review') ||
        message.toLowerCase().includes('required')
      ) {
        this.errorType.set('validation');
      } else {
        this.errorType.set('general');
      }
    }

    this.hasError.set(true);
    setTimeout(() => {
      this.hasError.set(false);
      this.errorMessage.set('');
      this.errorType.set('general');
    }, 5000);
  }
}
