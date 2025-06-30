import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../../interfaces/product.interface';
import { SlicePipe } from '@angular/common';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, SlicePipe],
  templateUrl: './product-card.component.html',
})
export class ProductCardComponent {
  product = input.required<Product>();

  imageUrl = computed(() => {
    return `http://localhost:3003/api/files/product/${
      this.product().images[0]
    }`;
  });
}
