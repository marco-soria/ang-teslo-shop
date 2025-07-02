import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, map, Observable, of } from 'rxjs';
import { environment } from 'src/environments/environment';

import { AuthResponse } from '@auth/interfaces/auth-response.interface';
import { AuthResult } from '@auth/interfaces/auth-result.interface';
import { User } from '@auth/interfaces/user.interface';

type AuthStatus = 'checking' | 'authenticated' | 'not-authenticated';
const baseUrl = environment.baseUrl;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _authStatus = signal<AuthStatus>('checking');
  private _user = signal<User | null>(null);
  private _token = signal<string | null>(localStorage.getItem('token'));

  private http = inject(HttpClient);

  checkStatusResource = rxResource({
    stream: () => this.checkStatus(),
  });

  authStatus = computed<AuthStatus>(() => {
    if (this._authStatus() === 'checking') return 'checking';

    if (this._user()) {
      return 'authenticated';
    }

    return 'not-authenticated';
  });

  user = computed(() => this._user());
  token = computed(this._token);

  login(email: string, password: string): Observable<AuthResult> {
    return this.http
      .post<AuthResponse>(`${baseUrl}/auth/login`, {
        email: email,
        password: password,
      })
      .pipe(
        map((resp) => {
          this.handleAuthSuccess(resp);
          return {
            success: true,
            message: 'Welcome! You have successfully signed in.',
          };
        }),
        catchError((error: HttpErrorResponse) => this.handleLoginError(error))
      );
  }
  //register(){}
  register(
    email: string,
    password: string,
    fullName: string
  ): Observable<AuthResult> {
    return this.http
      .post<AuthResponse>(`${baseUrl}/auth/register`, {
        email: email,
        password: password,
        fullName: fullName,
      })
      .pipe(
        map((resp) => {
          this.handleAuthSuccess(resp);
          return {
            success: true,
            message: 'Account created successfully! Welcome to our store.',
          };
        }),
        catchError((error: HttpErrorResponse) =>
          this.handleRegisterError(error)
        )
      );
  }

  checkStatus(): Observable<boolean> {
    const token = localStorage.getItem('token');
    if (!token) {
      this.logout();
      return of(false);
    }

    return this.http
      .get<AuthResponse>(`${baseUrl}/auth/check-status`, {
        // headers: {
        //   Authorization: `Bearer ${token}`,
        // },
      })
      .pipe(
        map((resp) => this.handleAuthSuccess(resp)),
        catchError((error: any) => this.handleAuthError(error))
      );
  }

  logout() {
    this._user.set(null);
    this._token.set(null);
    this._authStatus.set('not-authenticated');

    localStorage.removeItem('token');
  }

  private handleAuthSuccess({ token, user }: AuthResponse) {
    this._user.set(user);
    this._authStatus.set('authenticated');
    this._token.set(token);

    localStorage.setItem('token', token);

    return true;
  }

  private handleAuthError(error: any) {
    this.logout();
    return of(false);
  }

  private handleRegisterError(
    error: HttpErrorResponse
  ): Observable<AuthResult> {
    this.logout();

    let message = "We couldn't create your account. Please try again.";

    if (error.status === 400) {
      // Usuario ya existe o datos inválidos
      if (error.error?.message) {
        const errorMessage = error.error.message.toLowerCase();
        const cleanedMessage = this.cleanErrorMessage(error.error.message);

        // Detectar errores de email duplicado
        if (
          errorMessage.includes('email') &&
          (errorMessage.includes('already exists') ||
            errorMessage.includes('duplicate') ||
            (errorMessage.includes('key') && errorMessage.includes('exists')))
        ) {
          message =
            'This email is already registered. Please try signing in instead or use a different email address.';
        }
        // Detectar errores de validación específicos
        else if (
          errorMessage.includes('validation') ||
          errorMessage.includes('invalid')
        ) {
          if (errorMessage.includes('email')) {
            message = 'Please enter a valid email address.';
          } else if (errorMessage.includes('password')) {
            message = 'Password must be at least 6 characters long.';
          } else if (
            errorMessage.includes('fullname') ||
            errorMessage.includes('name')
          ) {
            message = 'Please enter your full name.';
          } else {
            message =
              cleanedMessage ||
              'Please check that all fields are filled correctly.';
          }
        }
        // Otros errores específicos del backend - usar mensaje limpio
        else {
          message =
            cleanedMessage || 'Please verify your information and try again.';
        }
      } else if (
        error.error?.error?.includes('duplicate') ||
        error.error?.error?.includes('already exists') ||
        error.error?.error?.includes('E11000')
      ) {
        message =
          'This email is already registered. Please try signing in instead or use a different email address.';
      } else {
        message = 'Please check that all required fields are filled correctly.';
      }
    } else if (error.status === 409) {
      // Conflicto - usuario duplicado
      message =
        'This email is already registered. Please try signing in instead or use a different email address.';
    } else if (error.status === 422) {
      // Entidad no procesable - validación falló
      message =
        'Some information appears to be invalid. Please review your details and try again.';
    } else if (error.status >= 500) {
      // Error del servidor
      message =
        "We're experiencing technical difficulties. Please try again in a few moments.";
    } else if (error.status === 0) {
      // Sin conexión
      message =
        'Unable to connect to our servers. Please check your internet connection and try again.';
    }

    return of({ success: false, message: this.cleanErrorMessage(message) });
  }

  private handleLoginError(error: HttpErrorResponse): Observable<AuthResult> {
    this.logout();

    let message = "We couldn't sign you in. Please try again.";

    if (error.status === 401) {
      // Credenciales incorrectas
      if (error.error?.message) {
        const errorMessage = error.error.message.toLowerCase();
        const cleanedMessage = this.cleanErrorMessage(error.error.message);

        // Detectar diferentes tipos de errores de autenticación
        if (
          errorMessage.includes('password') &&
          errorMessage.includes('incorrect')
        ) {
          message =
            'Incorrect password. Please check your password and try again.';
        } else if (
          errorMessage.includes('user') &&
          errorMessage.includes('not found')
        ) {
          message =
            'No account found with this email. Please check your email address or create a new account.';
        } else if (
          errorMessage.includes('invalid credentials') ||
          errorMessage.includes('unauthorized')
        ) {
          message =
            'Invalid email or password. Please double-check your credentials and try again.';
        } else {
          message =
            cleanedMessage ||
            'Invalid email or password. Please double-check your credentials and try again.';
        }
      } else {
        message =
          'Invalid email or password. Please double-check your credentials and try again.';
      }
    } else if (error.status === 400) {
      // Datos inválidos
      if (error.error?.message) {
        const errorMessage = error.error.message.toLowerCase();
        const cleanedMessage = this.cleanErrorMessage(error.error.message);

        if (
          errorMessage.includes('email') &&
          errorMessage.includes('invalid')
        ) {
          message = 'Please enter a valid email address.';
        } else if (
          errorMessage.includes('password') &&
          errorMessage.includes('required')
        ) {
          message = 'Password is required. Please enter your password.';
        } else if (
          errorMessage.includes('email') &&
          errorMessage.includes('required')
        ) {
          message = 'Email is required. Please enter your email address.';
        } else {
          message =
            cleanedMessage ||
            'Please check that all fields are filled correctly.';
        }
      } else {
        message = 'Please check that all fields are filled correctly.';
      }
    } else if (error.status === 404) {
      // Usuario no encontrado
      message =
        'No account found with this email. Please check your email address or create a new account.';
    } else if (error.status === 429) {
      // Demasiados intentos
      message =
        'Too many login attempts. Please wait a few minutes before trying again.';
    } else if (error.status >= 500) {
      // Error del servidor
      message =
        "We're experiencing technical difficulties. Please try again in a few moments.";
    } else if (error.status === 0) {
      // Sin conexión
      message =
        'Unable to connect to our servers. Please check your internet connection and try again.';
    }

    return of({ success: false, message: this.cleanErrorMessage(message) });
  }

  private cleanErrorMessage(message: string): string {
    // Limpiar mensajes técnicos del backend para hacerlos más amigables
    const cleanMessage = message
      .replace(/Key \([^)]+\)=\([^)]+\)/g, 'This email address') // "Key (email)=(test@google.com)" -> "This email address"
      .replace(/already exists\.?/g, 'is already registered.')
      .replace(
        /duplicate key error/gi,
        'This email address is already registered.'
      )
      .replace(/E11000[^.]*\./g, 'This email address is already registered.')
      .replace(/validation failed/gi, 'Please check your information.')
      .replace(/ValidationError:/gi, '')
      .replace(/Path `([^`]+)` is required/g, '$1 is required.')
      .replace(/is not a valid email/gi, 'Please enter a valid email address.')
      .replace(
        /password too short/gi,
        'Password must be at least 6 characters long.'
      )
      .replace(/invalid email format/gi, 'Please enter a valid email address.')
      .replace(/user not found/gi, 'No account found with this email address.')
      .replace(/unauthorized access/gi, 'Invalid credentials.')
      .replace(
        /internal server error/gi,
        "We're experiencing technical difficulties."
      )
      .replace(
        /network error/gi,
        'Unable to connect. Please check your internet connection.'
      )
      .trim();

    // Capitalizar la primera letra y asegurar que termine con punto
    const capitalized =
      cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1);
    return capitalized.endsWith('.') ||
      capitalized.endsWith('!') ||
      capitalized.endsWith('?')
      ? capitalized
      : capitalized + '.';
  }
}
