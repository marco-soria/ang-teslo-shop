import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '@auth/services/auth.service';

@Component({
  selector: 'app-register-page',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './register-page.component.html',
})
export class RegisterPageComponent {
  fb = inject(FormBuilder);
  hasError = signal(false);
  errorMessage = signal('');
  errorType = signal<'general' | 'email-exists' | 'validation'>('general');
  isPosting = signal(false);
  router = inject(Router);

  authService = inject(AuthService);

  registerForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    fullName: ['', [Validators.required, Validators.minLength(3)]],
  });

  onSubmit() {
    if (this.registerForm.invalid) {
      this.showError('Please review the information entered.', 'validation');
      return;
    }

    const {
      email = '',
      password = '',
      fullName = '',
    } = this.registerForm.value;

    this.isPosting.set(true);
    this.hasError.set(false); // Limpiar errores previos

    this.authService.register(email!, password!, fullName!).subscribe({
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
    type?: 'general' | 'email-exists' | 'validation'
  ) {
    this.errorMessage.set(message);

    // Si se especifica un tipo, usarlo, sino detectar automáticamente
    if (type) {
      this.errorType.set(type);
    } else {
      // Detectar tipo de error para mostrar UI apropiada
      if (
        message.toLowerCase().includes('email') &&
        (message.toLowerCase().includes('already') ||
          message.toLowerCase().includes('registered') ||
          message.toLowerCase().includes('exists'))
      ) {
        this.errorType.set('email-exists');
      } else if (
        message.toLowerCase().includes('validation') ||
        message.toLowerCase().includes('check') ||
        message.toLowerCase().includes('filled') ||
        message.toLowerCase().includes('review') ||
        message.toLowerCase().includes('invalid')
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
    }, 5000); // Aumentado a 5 segundos para errores importantes
  }
}
