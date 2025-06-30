import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ProductsResponse } from '../interfaces/product.interface';
import { Observable, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);

  getProducts(): Observable<ProductsResponse> {
    return this.http
      .get<ProductsResponse>('http://localhost:3003/api/products')
      .pipe(tap((resp) => console.log(resp)));
  }
}
