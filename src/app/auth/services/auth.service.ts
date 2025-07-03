/**
 * Servicio de Autenticación con Caché Inteligente
 *
 * Características del caché:
 * - Duración del caché: 5 minutos
 * - Auto-refresh cuando el token está cerca de expirar (10 min antes)
 * - Validación local de expiración del token JWT
 * - Invalidación automática en login/logout/errores
 *
 * Métodos públicos adicionales:
 * - forceAuthCheck(): Fuerza una verificación ignorando el caché
 * - getCacheInfo(): Obtiene información del estado del caché (debugging)
 *
 * Logging:
 * - 🟢 Using cached auth status
 * - 🔄 Checking auth status with backend / Token near expiration, refreshing...
 * - 🔴 Token expired locally, logging out
 */

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, map, Observable, of, timer } from 'rxjs';
import { environment } from 'src/environments/environment';

import { AuthResponse } from '@auth/interfaces/auth-response.interface';
import { AuthResult } from '@auth/interfaces/auth-result.interface';
import { User } from '@auth/interfaces/user.interface';

type AuthStatus = 'checking' | 'authenticated' | 'not-authenticated';

interface AuthCache {
  isValid: boolean;
  lastChecked: number;
  tokenExpiration: number | null;
}

const baseUrl = environment.baseUrl;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _authStatus = signal<AuthStatus>('checking');
  private _user = signal<User | null>(null);
  private _token = signal<string | null>(localStorage.getItem('token'));

  private http = inject(HttpClient);

  // Configuración del caché
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutos en millisegundos
  private readonly TOKEN_REFRESH_THRESHOLD = 10 * 60 * 1000; // 10 minutos antes de expirar

  private authCache: AuthCache = {
    isValid: false,
    lastChecked: 0,
    tokenExpiration: null,
  };

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
  isAdmin = computed(() => this._user()?.roles.includes('admin') ?? false);

  constructor() {
    // Configurar auto-refresh del token cuando esté cerca de expirar
    this.setupTokenAutoRefresh();
  }

  login(email: string, password: string): Observable<AuthResult> {
    return this.http
      .post<AuthResponse>(`${baseUrl}/auth/login`, {
        email: email,
        password: password,
      })
      .pipe(
        map((resp) => {
          this.handleAuthSuccess(resp);
          this.updateCache(true); // Actualizar caché con estado válido
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
          this.updateCache(true); // Actualizar caché con estado válido
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
      this.invalidateCache();
      return of(false);
    }

    // Verificar si el caché es válido y no ha expirado
    if (this.isCacheValid()) {
      console.log('🟢 Using cached auth status');
      return of(this.authCache.isValid);
    }

    // Verificar si el token ha expirado localmente
    if (this.isTokenExpiredLocally()) {
      console.log('🔴 Token expired locally, logging out');
      this.logout();
      this.invalidateCache();
      return of(false);
    }

    console.log('🔄 Checking auth status with backend');
    return this.http
      .get<AuthResponse>(`${baseUrl}/auth/check-status`, {
        // headers: {
        //   Authorization: `Bearer ${token}`,
        // },
      })
      .pipe(
        map((resp) => {
          const isValid = this.handleAuthSuccess(resp);
          this.updateCache(isValid);
          return isValid;
        }),
        catchError((error: any) => {
          this.handleAuthError(error);
          this.updateCache(false);
          return of(false);
        })
      );
  }

  logout() {
    this._user.set(null);
    this._token.set(null);
    this._authStatus.set('not-authenticated');

    localStorage.removeItem('token');
    this.invalidateCache();
  }

  private handleAuthSuccess({ token, user }: AuthResponse) {
    this._user.set(user);
    this._authStatus.set('authenticated');
    this._token.set(token);

    localStorage.setItem('token', token);

    // Extraer la expiración del token JWT si está disponible
    const tokenExpiration = this.extractTokenExpiration(token);
    this.authCache.tokenExpiration = tokenExpiration;

    return true;
  }

  private handleAuthError(error: any): Observable<boolean> {
    this.logout();
    this.invalidateCache();
    return of(false);
  }

  private handleRegisterError(
    error: HttpErrorResponse
  ): Observable<AuthResult> {
    this.logout();
    this.invalidateCache();

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
    this.invalidateCache();

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

  /**
   * Métodos para manejo del caché de autenticación
   */

  /**
   * Verifica si el caché es válido basado en el tiempo transcurrido
   */
  private isCacheValid(): boolean {
    const now = Date.now();
    const timeSinceLastCheck = now - this.authCache.lastChecked;

    // El caché es válido si:
    // 1. Ha sido marcado como válido
    // 2. No ha pasado el tiempo de duración del caché
    // 3. El token no está cerca de expirar
    return (
      this.authCache.isValid &&
      timeSinceLastCheck < this.CACHE_DURATION &&
      !this.isTokenNearExpiration()
    );
  }

  /**
   * Actualiza el estado del caché
   */
  private updateCache(isValid: boolean): void {
    this.authCache.isValid = isValid;
    this.authCache.lastChecked = Date.now();
  }

  /**
   * Invalida el caché forzando una nueva verificación en la próxima consulta
   */
  private invalidateCache(): void {
    this.authCache.isValid = false;
    this.authCache.lastChecked = 0;
    this.authCache.tokenExpiration = null;
  }

  /**
   * Verifica si el token ha expirado localmente
   */
  private isTokenExpiredLocally(): boolean {
    if (!this.authCache.tokenExpiration) {
      return false; // Si no tenemos la expiración, no podemos verificar localmente
    }

    return Date.now() >= this.authCache.tokenExpiration;
  }

  /**
   * Verifica si el token está cerca de expirar
   */
  private isTokenNearExpiration(): boolean {
    if (!this.authCache.tokenExpiration) {
      return false;
    }

    const timeUntilExpiration = this.authCache.tokenExpiration - Date.now();
    return timeUntilExpiration <= this.TOKEN_REFRESH_THRESHOLD;
  }

  /**
   * Extrae la fecha de expiración del token JWT
   */
  private extractTokenExpiration(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp) {
        return payload.exp * 1000; // Convertir de segundos a millisegundos
      }
    } catch (error) {
      console.warn('Error al extraer expiración del token:', error);
    }
    return null;
  }

  /**
   * Configura el auto-refresh del token
   */
  private setupTokenAutoRefresh(): void {
    // Verificar cada minuto si el token necesita ser refrescado
    timer(0, 60000).subscribe(() => {
      if (
        this._authStatus() === 'authenticated' &&
        this.isTokenNearExpiration()
      ) {
        console.log('🔄 Token near expiration, refreshing...');
        this.invalidateCache();
        // Trigger a new status check
        this.checkStatus().subscribe();
      }
    });
  }

  /**
   * Método público para forzar una verificación del estado de autenticación
   */
  forceAuthCheck(): Observable<boolean> {
    this.invalidateCache();
    return this.checkStatus();
  }

  /**
   * Método público para obtener información del caché (útil para debugging)
   */
  getCacheInfo(): AuthCache & { timeSinceLastCheck: number } {
    return {
      ...this.authCache,
      timeSinceLastCheck: Date.now() - this.authCache.lastChecked,
    };
  }
}
